// Settlement — runs on the server only. Decides whether a prediction won and
// credits coins. The browser never determines outcomes or payouts.
'use strict';
const { db } = require('./db');

function addTxn(userId, kind, label, amount, t = Date.now()) {
  db.prepare('INSERT INTO txns(user_id, kind, label, amount, t) VALUES(?,?,?,?,?)')
    .run(userId, kind, label, amount, t);
}
function recomputeWp(userId) {
  const r = db.prepare('SELECT wins, losses FROM users WHERE id = ?').get(userId);
  const total = r.wins + r.losses;
  db.prepare('UPDATE users SET wp = ? WHERE id = ?').run(total ? Math.round((r.wins / total) * 100) : 0, userId);
}

function settlePrediction(p, g) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const winner = g.score_away > g.score_home ? 'away' : 'home';
    const won = p.side === winner;
    const final = `${g.score_away}-${g.score_home}`;
    if (won) {
      const payout = Math.round(p.stake * p.odds);
      db.prepare('UPDATE predictions SET status=?, final=?, payout=? WHERE id=?').run('won', final, payout, p.id);
      db.prepare('UPDATE users SET coins = coins + ?, wins = wins + 1 WHERE id = ?').run(payout, p.user_id);
      addTxn(p.user_id, 'win', `Won ${p.pick} @${p.odds}`, payout);
    } else {
      db.prepare('UPDATE predictions SET status=?, final=?, payout=? WHERE id=?').run('lost', final, 0, p.id);
      db.prepare('UPDATE users SET losses = losses + 1 WHERE id = ?').run(p.user_id);
    }
    recomputeWp(p.user_id);
    db.exec('COMMIT');
    return { won, final };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// Settle every pending prediction whose game is now final. Returns count settled.
function settleDuePredictions() {
  const pending = db.prepare("SELECT * FROM predictions WHERE status = 'pending'").all();
  let settled = 0;
  for (const p of pending) {
    const g = db.prepare('SELECT * FROM games WHERE id = ?').get(p.game_id);
    if (!g || g.status !== 'final' || g.score_away == null || g.score_home == null) continue;
    settlePrediction(p, g);
    settled++;
  }
  return settled;
}

module.exports = { settleDuePredictions, settlePrediction, addTxn, recomputeWp };