// API routes — every mutation is validated server-side and keyed to the
// authenticated user. The client can never set coins or decide outcomes.
'use strict';
const { db } = require('./db');
const auth = require('./auth');
const { settleDuePredictions } = require('./settle');

const STARTING_BALANCE = parseInt(process.env.STARTING_BALANCE || '10000', 10);
const MIN_STAKE = 5;
const MAX_STAKE = 100000;
const ODDS = 1.9;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ok = (data, status = 200) => ({ status, json: data });
const err = (message, status = 400, code = 'error') => ({ status, json: { error: message, code } });
const clientErr = msg => err(msg, 400, 'validation');

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}
function requireUser(req) {
  const u = auth.getSessionUser(bearer(req));
  if (!u) return null;
  return u;
}
function nowIsoDay() {
  const d = new Date();
  return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
}

/* ---------- challenges (computed from real DB stats) ---------- */
function challenges(u) {
  return [
    { id:'c1', emoji:'🎯', name:'First Blood', desc:'Place your first prediction', target:1, prog:u.picks, reward:20 },
    { id:'c2', emoji:'🔥', name:'Hot Streak', desc:'Win 3 predictions', target:3, prog:u.wins, reward:60 },
    { id:'c3', emoji:'💸', name:'High Roller', desc:'Bet 300 coins total', target:300, prog:u.wagered, reward:100 },
    { id:'c4', emoji:'💎', name:'Sharpshooter', desc:'Reach 70% accuracy', target:70, prog:Math.round(u.wp||0), reward:80 },
    { id:'c5', emoji:'🪙', name:'Ballin', desc:'Reach 100 coins balance', target:100, prog:u.coins, reward:50 }
  ];
}

async function handleApi(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname.replace(/\/$/, '') || '/';
  const method = req.method;
  const body = req.body || {};
  let json;

  try {
    json = route(method, path, body, req);
  } catch (e) {
    console.error('API error:', e);
    return err('Internal server error', 500, 'internal');
  }
  return json;
}

function route(method, path, body, req) {
  // ---- Public ----
  if (method === 'GET' && path === '/api/health') return ok({ ok: true, time: Date.now() });

  if (method === 'GET' && path === '/api/games') {
    settleDuePredictions();
    const rows = db.prepare('SELECT * FROM games ORDER BY start_ts').all();
    return ok(rows.map(g => ({
      id:g.id, sport:g.sport, competition:g.competition, away:g.away, home:g.home, status:g.status,
      start_ts:g.start_ts, score_away:g.score_away, score_home:g.score_home, source:g.source
    })));
  }

  if (method === 'POST' && path === '/api/auth/signup') return signup(body);
  if (method === 'POST' && path === '/api/auth/login') return login(body);

  // ---- authenticated from here ----
  const u = requireUser(req);
  if (!u) return err('Not authenticated', 401, 'unauthorized');

  if (method === 'POST' && path === '/api/auth/logout') { auth.destroySession(bearer(req)); return ok({ ok: true }); }
  if (method === 'GET' && path === '/api/auth/me') { settleDuePredictions(); return ok({ user: auth.publicUser(u) }); }

  if (method === 'POST' && path === '/api/daily/claim') return dailyClaim(u);
  if (method === 'GET' && path === '/api/daily/state') return dailyState(u);
  if (method === 'GET' && path === '/api/predictions') return listPredictions(u);
  if (method === 'POST' && path === '/api/predictions') return placePrediction(u, body);
  if (method === 'GET' && path === '/api/leaderboard') return leaderboard(u);
  if (method === 'GET' && path === '/api/challenges') return ok({ challenges: challenges(u) });
  if (method === 'GET' && path === '/api/transactions') return transactions(u);
  const gm = path.match(/^\/api\/games\/(.+)$/);
  if (method === 'GET' && gm) {
    const g = db.prepare('SELECT * FROM games WHERE id = ?').get(decodeURIComponent(gm[1]));
    return g ? ok(g) : err('Game not found', 404, 'not_found');
  }

  return err('Not found', 404, 'not_found');
}

/* ---------- auth handlers ---------- */
function signup(body) {
  const username = String(body.username || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!username || username.length < 2 || username.length > 40) return clientErr('Please provide a name (2-40 characters)');
  if (!EMAIL_RE.test(email)) return clientErr('Please provide a valid email');
  if (password.length < 8) return clientErr('Password must be at least 8 characters');
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) return err('Email already registered', 409, 'email_taken');
  const id = 'u_' + require('crypto').randomBytes(8).toString('hex');
  const { salt, hash } = auth.makeSaltRecord(password);
  const joined = Date.now();
  db.prepare('INSERT INTO users(id,username,email,pass_hash,pass_salt,coins,joined) VALUES(?,?,?,?,?,?,?)')
    .run(id, username, email, hash, salt, STARTING_BALANCE, joined);
  const token = auth.createSession(id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  return ok({ token, user: auth.publicUser(user) });
}

function login(body) {
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !auth.verifyPassword(password, user.pass_salt, user.pass_hash))
    return err('Invalid email or password', 401, 'bad_credentials');
  const token = auth.createSession(user.id);
  return ok({ token, user: auth.publicUser(user) });
}

/* ---------- daily reward ---------- */
function nowIso(){ const d=new Date(); return d.getFullYear()+'-'+d.getMonth()+'-'+d.getDate(); }
function dailyState(u) {
  const today = nowIso();
  let row = db.prepare('SELECT * FROM daily WHERE user_id = ?').get(u.id);
  return ok({ claimed: !!(row && row.last === today), streak: row ? row.streak : 0 });
}
function dailyClaim(u) {
  const today = nowIso();
  let row = db.prepare('SELECT * FROM daily WHERE user_id = ?').get(u.id);
  if (row && row.last === today) return err('Already claimed today', 409, 'already_claimed');
  const yd = new Date(); yd.setDate(yd.getDate() - 1);
  const yKey = yd.getFullYear() + '-' + yd.getMonth() + '-' + yd.getDate();
  const streak = row && row.last === yKey ? row.streak + 1 : 1;
  const base = 50 + (streak - 1) * 10;
  db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').run(base, u.id);
  db.prepare('INSERT INTO txns(user_id,kind,label,amount,t) VALUES(?,?,?,?,?)')
    .run(u.id, 'reward', 'Daily reward · Day ' + streak, base, Date.now());
  db.prepare('INSERT OR REPLACE INTO daily(user_id,last,streak) VALUES(?,?,?)').run(u.id, nowIso(), streak);
  return ok({ coins: db.prepare('SELECT coins FROM users WHERE id=?').get(u.id).coins, streak, amount: base });
}

/* ---------- predictions ---------- */
function placePrediction(u, body) {
  const gameId = String(body.gameId || '');
  const side = String(body.side || '');
  const stake = Math.floor(Number(body.stake));
  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(gameId);
  if (!game) return clientErr('Unknown game');
  if (game.status === 'final') return err('Game has already ended', 400, 'game_final');
  if (side !== 'away' && side !== 'home') return clientErr('Invalid side');
  if (!Number.isFinite(stake) || stake < MIN_STAKE) return clientErr('Minimum stake is ' + MIN_STAKE + ' coins');
  if (stake > MAX_STAKE) return clientErr('Stake is too large');
  if (stake > u.coins) return err('Insufficient balance', 400, 'insufficient_balance');

  const pick = side === 'away' ? game.away : game.home;
  const pid = 'p' + require('crypto').randomBytes(10).toString('hex');
  const created = Date.now();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE users SET coins = coins - ?, picks = picks + 1, wagered = wagered + ? WHERE id = ?').run(stake, stake, u.id);
    db.prepare('INSERT INTO predictions(id,user_id,game_id,side,pick,sport,stake,odds,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(pid, u.id, gameId, side, pick, game.sport, stake, ODDS, 'pending', created);
    db.prepare('INSERT INTO txns(user_id,kind,label,amount,t) VALUES(?,?,?,?,?)')
      .run(u.id, 'bet', 'Bet on ' + pick, -stake, created);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  const fresh = db.prepare('SELECT coins FROM users WHERE id=?').get(u.id).coins;
  return ok({ prediction: predictionRow(pid), coins: fresh });
}

function predictionRow(pid) {
  const p = db.prepare('SELECT * FROM predictions WHERE id = ?').get(pid);
  return {
    id:p.id, game_id:p.game_id, side:p.side, pick:p.pick, sport:p.sport,
    stake:p.stake, odds:p.odds, status:p.status, final:p.final, payout:p.payout,
    created_at:p.created_at,
    game: p.sport === 'CL' ? `${p.pick}` : `${p.pick}`
  };
}

function listPredictions(u) {
  settleDuePredictions();
  const rows = db.prepare('SELECT * FROM predictions WHERE user_id = ? ORDER BY created_at DESC').all(u.id);
  return ok({ predictions: rows.map(p => ({
    id:p.id, game_id:p.game_id, side:p.side, pick:p.pick, sport:p.sport,
    stake:p.stake, odds:p.odds, status:p.status, final:p.final, payout:p.payout, created_at:p.created_at
  })) });
}

/* ---------- leaderboard (real DB) ---------- */
function leaderboard(u) {
  const rows = db.prepare('SELECT username, coins, wins, wp FROM users ORDER BY coins DESC LIMIT 20').all();
  return ok({ leaderboard: rows.map((r,i) => ({ rank:i+1, name:r.username, coins:r.coins, wins:r.wins, wp:Math.round(r.wp||0), me:r.username === u.username })) });
}

/* ---------- transactions ---------- */
function transactions(u) {
  const rows = db.prepare('SELECT * FROM txns WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(u.id);
  return ok({ transactions: rows });
}

/* --- body reading helper (called externally) --- */
async function readJson(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 100000) req.destroy(); });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (_) { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

module.exports = { handleApi, readJson, STARTING_BALANCE, ensureDemo };

// Seed a demo account (hashed password) so users can try the app.
function ensureDemo() {
  if (db.prepare('SELECT id FROM users WHERE email = ?').get('demo@sportz.app')) return;
  const { salt, hash } = auth.makeSaltRecord('demo1234');
  db.prepare('INSERT INTO users(id,username,email,pass_hash,pass_salt,coins,joined) VALUES(?,?,?,?,?,?,?)')
    .run('u_demo', 'Demo Player', 'demo@sportz.app', hash, salt, STARTING_BALANCE, Date.now());
}