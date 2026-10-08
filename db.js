// SQLite database (built into Node 22+, no install needed). Creates tables and seeds titles on first run.
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dir, { recursive: true });
const db = new DatabaseSync(process.env.DB_FILE || path.join(dir, 'lumio.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS titles (
  id INTEGER PRIMARY KEY, t TEXT NOT NULL, y INTEGER, g TEXT, r REAL, type TEXT,
  ng INTEGER DEFAULT 0, d TEXT, h INTEGER, actors TEXT, c TEXT
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE, pw TEXT NOT NULL, created TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS watchlist (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, title_id)
);
CREATE TABLE IF NOT EXISTS progress (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  percent INTEGER NOT NULL, updated TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, title_id)
);
`);

const all = (sql, ...a) => db.prepare(sql).all(...a);
const get = (sql, ...a) => db.prepare(sql).get(...a);
const run = (sql, ...a) => db.prepare(sql).run(...a);

// Seed the catalogue once. To add titles later, insert rows here or edit titles.json on a fresh database.
if (get('SELECT COUNT(*) n FROM titles').n === 0) {
  const ins = db.prepare('INSERT INTO titles (id,t,y,g,r,type,ng,d,h,actors,c) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  db.exec('BEGIN');
  for (const m of require('./titles.json'))
    ins.run(m.id, m.t, m.y, JSON.stringify(m.g), m.r, m.type, m.ng ? 1 : 0, m.d, m.h, JSON.stringify(m.cast), m.c);
  db.exec('COMMIT');
}

// Shape a database row the way the frontend expects it.
const toTitle = ({ id, t, y, g, r, type, ng, d, h, actors, c }) =>
  ({ id, t, y, g: JSON.parse(g), r, type, ng: !!ng, d, h, cast: JSON.parse(actors), c });

module.exports = { all, get, run, toTitle };
