// Authentication — password hashing (scrypt + per-user salt) and session tokens.
'use strict';
const crypto = require('crypto');
const { db } = require('./db');

const SESSION_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days

// ---- Password hashing: random per-user salt + scrypt, stored as hex. ---- //
function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}
function makeSaltRecord(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);
  return { salt, hash };
}
function verifyPassword(password, salt, expectedHash) {
  const candidate = Buffer.from(hashPassword(password, salt), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

// ---- Session tokens (stored server-side so logout is a real revocation) ---- //
function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + SESSION_TTL;
  db.prepare('INSERT OR REPLACE INTO sessions(token, user_id, expires) VALUES(?,?,?)')
    .run(token, userId, expires);
  return token;
}
function getSessionUser(token) {
  if (!token) return null;
  const row = db.prepare('SELECT user_id, expires FROM sessions WHERE token = ?').get(token);
  if (!row) return null;
  if (row.expires < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id) || null;
}
function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}
function destroyAllSessionsForUser(userId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

// ---- Public user shape (never exposes password/salt) ---- //
function publicUser(u) {
  return {
    id: u.id, username: u.username, email: u.email,
    coins: u.coins, picks: u.picks, wins: u.wins, losses: u.losses,
    wagered: u.wagered, wp: Math.round(u.wp || 0), joined: u.joined
  };
}

module.exports = {
  hashPassword, makeSaltRecord, verifyPassword,
  createSession, getSessionUser, destroySession, destroyAllSessionsForUser,
  publicUser
};