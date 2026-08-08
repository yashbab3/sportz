// DB layer — SQLite via Node's built-in node:sqlite (no native deps).
// Overrides DB_PATH to point at data/sportz.db unless configured.
'use strict';
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'sportz.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA busy_timeout = 5000;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id        TEXT PRIMARY KEY,
  username  TEXT NOT NULL,
  email     TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL,
  pass_salt TEXT NOT NULL,
  coins     INTEGER NOT NULL DEFAULT 0,
  picks     INTEGER NOT NULL DEFAULT 0,
  wins      INTEGER NOT NULL DEFAULT 0,
  losses    INTEGER NOT NULL DEFAULT 0,
  wagered   INTEGER NOT NULL DEFAULT 0,
  wp        REAL NOT NULL DEFAULT 0,
  joined    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions(
  token    TEXT PRIMARY KEY,
  user_id  TEXT NOT NULL,
  expires  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS games(
  id         TEXT PRIMARY KEY,
  sport      TEXT NOT NULL,
  competition TEXT NOT NULL DEFAULT '',
  away       TEXT NOT NULL,
  home       TEXT NOT NULL,
  start_ts   INTEGER NOT NULL,
  status     TEXT NOT NULL DEFAULT 'upcoming',
  score_away INTEGER,
  score_home INTEGER,
  source     TEXT NOT NULL DEFAULT 'demo'
);
CREATE TABLE IF NOT EXISTS predictions(
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  game_id    TEXT NOT NULL,
  side       TEXT NOT NULL,
  pick       TEXT NOT NULL,
  sport      TEXT NOT NULL,
  stake      INTEGER NOT NULL,
  odds       REAL NOT NULL DEFAULT 1.9,
  status     TEXT NOT NULL DEFAULT 'pending',
  final      TEXT,
  payout     INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS txns(
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  kind    TEXT NOT NULL,
  label   TEXT NOT NULL,
  amount  INTEGER NOT NULL,
  t       INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS daily(
  user_id TEXT PRIMARY KEY,
  last    TEXT,
  streak  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pred_user ON predictions(user_id);
CREATE INDEX IF NOT EXISTS idx_pred_game ON predictions(game_id);
CREATE INDEX IF NOT EXISTS idx_txn_user ON txns(user_id);
`);

// migrate older DBs that lack the competition column
const gcols = db.prepare('PRAGMA table_info(games)').all().map(c => c.name);
if (!gcols.includes('competition')) db.exec('ALTER TABLE games ADD COLUMN competition TEXT NOT NULL DEFAULT ""');

module.exports = { db, DB_PATH };