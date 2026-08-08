// npm run reset — wipes all app data (users, sessions, predictions, txns, daily, games).
// Games and the demo account are re-seeded automatically on next server start.
'use strict';
const { db, DB_PATH } = require('./db');
db.exec('DELETE FROM sessions');
db.exec('DELETE FROM predictions');
db.exec('DELETE FROM txns');
db.exec('DELETE FROM daily');
db.exec('DELETE FROM games');
db.exec('DELETE FROM users');
console.log('DB reset complete at', DB_PATH);