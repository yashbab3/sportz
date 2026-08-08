# SPORTZ — Predict. Play. Win.

A **secure, multi-user, mobile-first sports prediction web app** built with a real
backend. Users sign up, predict game winners using virtual coins, and climb a
live leaderboard. **All coins are virtual — there is no real-money deposit,
withdrawal, or cash payout.**

This version replaced the browser-only (localStorage) demo with a real server,
database, authentication, and server-side settlement while keeping the exact
same dark, mobile-first design.

---

## Features

- Secure signup / login (passwords hashed with **scrypt + per-user salt**)
- User profiles with stats (wins / losses / win rate)
- Virtual coin wallet with a transaction history
- Sports games list (NBA, NFL, MLB, Soccer) from a **real sports API** (ESPN)
  with a scripted **demo fallback** when the API is unreachable
- Prediction system with **server-side validation** (stakes, balances, game ids,
  sides, payout) and **server-side settlement**
- Prediction history (pending / won / lost)
- **Real database leaderboard** (no client-side data)
- Daily reward with a streak bonus
- Progressive challenges
- Mobile-first UI, bottom tab navigation, loading states, and error messages

## Tech stack

- **Runtime:** Node.js (≥ 22.5) — **zero npm dependencies**
- **Database:** SQLite via Node's built-in `node:sqlite`
- **Auth:** scrypt password hashing; server-side session tokens (revocable)
- **Sports data:** ESPN public JSON API (keyless) with automatic fallback
- **Front-end:** single self-contained `public/index.html` (same design as the demo)

## Run locally

```bash
cd sportz
node server/index.js          # or: npm start
# open http://localhost:3000
```

Or with a custom config:

```bash
cp .env.example .env          # optional; edit values
PORT=3000 node server/index.js
```

Reset all data: `npm run reset`

## Environment variables (all optional)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `SPORTS_PROVIDER` | `espn` | `espn` (real API) or `demo` |
| `SPORTS_API_URL` | ESPN public base | Override sports API endpoint |
| `STARTING_BALANCE` | `10000` | New-user virtual coin balance |
| `DB_PATH` | `./data/sportz.db` | SQLite file location |

**No API keys are required.** ESPN is a keyless public API. If it is unreachable
or a league is off-season, the app automatically falls back to demo games so it
stays usable.

## Security

- Passwords are never stored in plain text (scrypt + per-user salt).
- Every mutation is validated on the server (stake bounds, balance, game exists,
  side, duplicate email, game already final).
- The client cannot set coin balances; only the server credits/debits.
- Prediction settlement runs **only on the server**; the browser never decides
  who won or how many coins are paid out.
- API endpoints require a valid session token (`Bearer`); unauthorized requests
  get `401`.
- Multi-user isolation: all queries are scoped to the authenticated user id.

## Deploy / publish to a public URL

The app is a standard Node HTTP server (no build step). Deploy it on any host
that can run Node:

1. **Railway / Render / Fly.io (easiest, free tier)** — point the service at
   this repo root, set the run command to `node server/index.js`, and set `PORT`.
   These providers expose a public HTTPS URL automatically.
2. **A small VPS / Cloud VM** — run `node server/index.js` behind a reverse proxy
   (e.g. Nginx or Caddy) to get HTTPS, e.g. via `www.hello` or a domain.
3. **Docker** — a `Dockerfile` with `node:22-alpine`, copy the repo, and
   `CMD ["node","server/index.js"]`.

Because state lives in a local SQLite file, for multi-instance deployments you
should keep a single instance (or move the DB to shared storage). The free
Render/Railway tiers run a single instance, which is perfect for this app.

---

Demo account (seeded at boot): `demo@sportz.app` / `demo1234`