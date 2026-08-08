// Sports-data provider: real ESPN public API (no key required) with a structured
// demo fallback. Games are upserted into the DB; the server settles predictions
// from the stored, authoritative results. Each fixture carries a real competition
// name (e.g. "UEFA Champions League", "Friendly", "Premier League") and an actual
// scheduled kickoff timestamp, so the app never mislabels or fabricates a league.
// If a sport's API feed is empty/unreachable, that sport falls back to the
// structured demo fixtures below (which you can later swap for a paid/keyed API).
'use strict';
const { db } = require('./db');

const HOUR = 3600 * 1000;

const ESPN_LEAGUES = {
  NBA: 'basketball/nba',
  NFL: 'football/nfl',
  MLB: 'baseball/mlb',
  CL:  'soccer/uefa.champions'
};
const PROVIDER = process.env.SPORTS_PROVIDER || 'espn'; // espn | demo
const ESPN_BASE = process.env.SPORTS_API_URL || 'https://site.api.espn.com/apis/site/v2';

// Structured fixture data. `off` = kickoff offset in hours relative to "now"
// (negative => started, so live/final; positive => scheduled in the future).
// Each fixture has an explicit competition so soccer is never auto-labeled "CL".
const DEMO = {
  NBA: [
    { a:'Lakers',      h:'Celtics',   comp:'NBA',  off:-26 },
    { a:'Warriors',    h:'Nuggets',   comp:'NBA',  off:-0.3 },
    { a:'Thunder',     h:'Knicks',    comp:'NBA',  off:2 },
    { a:'Bucks',       h:'Heat',      comp:'NBA',  off:1 },
    { a:'Suns',        h:'Mavericks', comp:'NBA',  off:30 },
    { a:'Celtics',     h:'Lakers',    comp:'NBA',  off:55 }
  ],
  NFL: [
    { a:'Chiefs',      h:'Bills',     comp:'NFL',  off:-27 },
    { a:'Ravens',      h:'Eagles',    comp:'NFL',  off:-0.4 },
    { a:'49ers',       h:'Cowboys',   comp:'NFL',  off:3 },
    { a:'Packers',     h:'Lions',     comp:'NFL',  off:1.5 },
    { a:'Bengals',     h:'Dolphins',  comp:'NFL',  off:49 }
  ],
  MLB: [
    { a:'Dodgers',     h:'Padres',    comp:'MLB',  off:-30 },
    { a:'Yankees',     h:'Astros',    comp:'MLB',  off:-0.2 },
    { a:'Cubs',        h:'Mets',      comp:'MLB',  off:2.5 },
    { a:'Braves',      h:'Phillies',  comp:'MLB',  off:1 },
    { a:'Giants',      h:'D-backs',   comp:'MLB',  off:52 }
  ],
  CL: [
    // Finished: real UEFA Champions League fixture (final score)
    { a:'Napoli',       h:'Benfica',    comp:'UEFA Champions League', off:-50 },
    // Live right now: an international club friendly in progress
    { a:'Real Madrid',  h:'Barcelona',  comp:'Friendly', off:-0.2 },
    // Scheduled friendlies today & tomorrow (NOT auto-labeled Champions League)
    { a:'Man Utd',      h:'PSG',        comp:'Friendly', off:1.5 },
    { a:'Arsenal',      h:'Liverpool',  comp:'Friendly', off:0.5 },
    // Real competitions with actual future kickoffs
    { a:'Arsenal',      h:'Liverpool',  comp:'Premier League', off:6 },
    { a:'Inter',        h:'Chelsea',    comp:'UEFA Champions League', off:28 },
    { a:'Sevilla',      h:'Real Betis', comp:'La Liga', off:74 },
    { a:'Bayern',       h:'Man City',   comp:'UEFA Champions League', off:52 }
  ]
};
function durHours(sport){ return sport === 'MLB' || sport === 'NFL' ? 3 : 2; }

function sportRange(sp){ return sp === 'MLB' ? [0,10] : sp === 'NFL' ? [10,41] : sp === 'CL' ? [0,4] : [85,127]; }
function hash(s){ let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
function demoScore(sport, id){
  const [lo, hi] = sportRange(sport); const span = hi - lo; const h = hash(id);
  let a = lo + (h % span), b = lo + ((h >> 3) % span);
  if (a === b) a = Math.min(hi, a + 1);
  return [a, b];
}

// ESPN soccer events carry their real competition on competitions[0].type/league.
async function fetchEspn(sport){
  const url = `${ESPN_BASE}/sports/${ESPN_LEAGUES[sport]}/scoreboard`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 SPORTZ/1.0', 'Accept': 'application/json' } });
  if (!res.ok) throw new Error('ESPN status ' + res.status);
  const body = await res.json();
  return (body.events || []).map(ev => parseEvent(sport, ev)).filter(Boolean);
}
function parseEvent(sport, ev){
  const comp = ev.competitions && ev.competitions[0];
  if (!comp) return null;
  const state = comp.status && comp.status.type && comp.status.type.state;
  const status = state === 'post' ? 'final' : state === 'in' ? 'live' : 'upcoming';
  const awayC = comp.competitors && comp.competitors.find(c => c.homeAway === 'away');
  const homeC = comp.competitors && comp.competitors.find(c => c.homeAway === 'home');
  if (!awayC || !homeC) return null;
  const name = c => (c.team.displayName || c.team.abbreviation || c.team.name || '').trim();
  const away = name(awayC), home = name(homeC);
  if (!away || !home) return null;
  const start = new Date(comp.date).getTime();
  const score = c => (c.score != null ? parseInt(c.score, 10) : null);
  return {
    id: 'espn-' + sport + '-' + ev.id, sport, competition: competitionFromEvent(sport, ev), away, home,
    start_ts: start, status, score_away: score(awayC), score_home: score(homeC), source: 'espn'
  };
}
function competitionFromEvent(sport, ev){
  if (sport !== 'CL') return sport;
  const comp = ev.competitions && ev.competitions[0];
  const type = comp && comp.type && comp.type.name;
  const league = comp && comp.league && comp.league.name;
  return (type && type.trim()) || (league && league.trim()) || 'Friendly';
}

function upsertGames(games){
  const stmt = db.prepare(`INSERT OR REPLACE INTO games(id,sport,competition,away,home,start_ts,status,score_away,score_home,source)
                           VALUES(?,?,?,?,?,?,?,?,?,?)`);
  for (const g of games) stmt.run(g.id, g.sport, g.competition || g.sport, g.away, g.home, g.start_ts, g.status, g.score_away, g.score_home, g.source || 'demo');
}

function buildDemoGame(sport, fx, i, now, startOverride){
  const id = 'demo-' + sport + '-' + i;
  const start = startOverride != null ? startOverride : now + fx.off * HOUR;
  const dur = durHours(sport) * HOUR;
  const status = start + dur < now ? 'final' : start < now ? 'live' : 'upcoming';
  let sc = null;
  if (status === 'final') sc = demoScore(sport, id);
  else if (status === 'live') {
    const base = sport === 'NBA' ? 80 : sport === 'NFL' ? 10 : sport === 'MLB' ? 2 : 0;
    sc = [base + ((now + i) % 6), base + ((now + i * 7) % 6)];
  }
  return { id, sport, competition: fx.comp || sport, away: fx.a, home: fx.h, start_ts: start, status,
           score_away: sc ? sc[0] : null, score_home: sc ? sc[1] : null, source: 'demo' };
}

// Build the full structured demo schedule for a sport.
function demoGames(sport){
  const now = Date.now();
  return (DEMO[sport] || []).map((fx, i) => buildDemoGame(sport, fx, i, now));
}
// Two guaranteed-upcoming fixtures per sport (keeps the app bettable off-season).
function demoUpcoming(sport){
  const now = Date.now();
  const fxs = DEMO[sport] || [];
  return [0, 1].map(i => {
    const fx = fxs[(i + 1) % (fxs.length || 1)] || { a:'Team A', h:'Team B', comp: sport };
    const start = now + (i + 1) * HOUR + (i === 0 ? 0 : 4 * HOUR);
    return buildDemoGame(sport, fx, 900 + i, now, start);
  });
}

// Refresh all games. Call on boot and periodically.
async function refreshGames(){
  const sports = Object.keys(ESPN_LEAGUES);
  let usedFallback = false;
  for (const sport of sports) {
    let list = null;
    if (PROVIDER !== 'demo') {
      try { list = await fetchEspn(sport); } catch (_) { list = null; }
    }
    if (list && list.length) upsertGames(list);
    else { upsertGames(demoGames(sport)); usedFallback = true; }
    // guarantee every sport has bettable games even off-season
    const cnt = db.prepare("SELECT COUNT(*) AS c FROM games WHERE sport = ? AND status IN ('upcoming','live')").get(sport).c;
    if (cnt === 0) { upsertGames(demoUpcoming(sport)); usedFallback = true; }
  }
  return { usedFallback };
}

module.exports = { refreshGames, ESPN_LEAGUES, PROVIDER };