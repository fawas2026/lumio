// Lumio server: serves the website from /public and the JSON API under /api.
const http = require('http');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const auth = require('./auth');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' };

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (status, msg) => { throw new HttpError(status, msg); };
const send = (res, status, obj) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
};
const readBody = (req) => new Promise((ok, no) => {
  let data = '';
  req.on('data', (c) => { data += c; if (data.length > 10_000) { no(new HttpError(413, 'Request too large')); req.destroy(); } });
  req.on('end', () => { try { ok(data ? JSON.parse(data) : {}); } catch { no(new HttpError(400, 'Invalid JSON')); } });
});

// Simple brute-force guard: 10 login or signup attempts per IP every 15 minutes.
const attempts = new Map();
const tooMany = (ip) => {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < 15 * 60_000);
  list.push(now); attempts.set(ip, list);
  return list.length > 10;
};

const currentUser = (req) => {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  const uid = m && auth.verifyToken(m[1]);
  return uid ? db.get('SELECT * FROM users WHERE id = ?', uid) : null;
};
const requireUser = (req) => currentUser(req) || fail(401, 'Please log in first.');

const profile = (u) => ({
  name: u.name, email: u.email,
  list: db.all('SELECT title_id id FROM watchlist WHERE user_id = ? ORDER BY rowid', u.id).map((r) => r.id),
  prog: Object.fromEntries(db.all('SELECT title_id id, percent FROM progress WHERE user_id = ?', u.id).map((r) => [r.id, r.percent])),
});
const sessionFor = (u) => ({ token: auth.signToken(u.id), user: profile(u) });

const titleExists = (id) => db.get('SELECT 1 x FROM titles WHERE id = ?', id) || fail(404, 'Title not found.');

async function api(req, res, url) {
  const method = req.method, p = url.pathname.replace(/^\/api/, '');
  let m;

  if (method === 'POST' && (p === '/signup' || p === '/login')) {
    if (tooMany(req.socket.remoteAddress)) fail(429, 'Too many attempts. Try again in a few minutes.');
    const b = await readBody(req);
    const email = String(b.email || '').trim().toLowerCase(), password = String(b.password || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) fail(400, 'Enter a valid email address.');
    if (p === '/signup') {
      const name = String(b.name || '').trim();
      if (!name || name.length > 60) fail(400, 'Enter your name (up to 60 characters).');
      if (password.length < 6 || password.length > 100) fail(400, 'Password must be 6 to 100 characters.');
      if (db.get('SELECT 1 x FROM users WHERE email = ?', email)) fail(409, 'That email already has an account. Log in instead.');
      const r = db.run('INSERT INTO users (name, email, pw) VALUES (?,?,?)', name, email, auth.hashPassword(password));
      return send(res, 201, sessionFor(db.get('SELECT * FROM users WHERE id = ?', r.lastInsertRowid)));
    }
    const u = db.get('SELECT * FROM users WHERE email = ?', email);
    if (!u || !auth.checkPassword(password, u.pw)) fail(401, 'Email or password is incorrect.');
    return send(res, 200, sessionFor(u));
  }

  if (method === 'GET' && p === '/me') return send(res, 200, profile(requireUser(req)));

  if (method === 'GET' && p === '/titles') {
    const q = url.searchParams, where = [], args = [];
    if (q.get('q')) { where.push('t LIKE ?'); args.push(`%${q.get('q')}%`); }
    if (q.get('type')) { where.push('type = ?'); args.push(q.get('type')); }
    if (q.get('country')) { where.push('c = ?'); args.push(q.get('country')); }
    if (q.get('genre')) { where.push('g LIKE ?'); args.push(`%"${q.get('genre')}"%`); }
    const sql = `SELECT * FROM titles ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id`;
    return send(res, 200, db.all(sql, ...args).map(db.toTitle));
  }
  if (method === 'GET' && (m = /^\/titles\/(\d+)$/.exec(p))) {
    const row = db.get('SELECT * FROM titles WHERE id = ?', +m[1]);
    return row ? send(res, 200, db.toTitle(row)) : fail(404, 'Title not found.');
  }
  if (method === 'GET' && p === '/regions')
    return send(res, 200, db.all('SELECT c country, COUNT(*) count FROM titles GROUP BY c ORDER BY c'));

  if ((m = /^\/watchlist\/(\d+)$/.exec(p)) && (method === 'PUT' || method === 'DELETE')) {
    const u = requireUser(req), id = +m[1];
    if (method === 'PUT') { titleExists(id); db.run('INSERT OR IGNORE INTO watchlist (user_id, title_id) VALUES (?,?)', u.id, id); }
    else db.run('DELETE FROM watchlist WHERE user_id = ? AND title_id = ?', u.id, id);
    return send(res, 200, { list: profile(u).list });
  }
  if (method === 'PUT' && (m = /^\/progress\/(\d+)$/.exec(p))) {
    const u = requireUser(req), id = +m[1], pct = Math.round(Number((await readBody(req)).percent));
    if (!(pct >= 0 && pct <= 100)) fail(400, 'Percent must be between 0 and 100.');
    titleExists(id);
    db.run(`INSERT INTO progress (user_id, title_id, percent) VALUES (?,?,?)
            ON CONFLICT (user_id, title_id) DO UPDATE SET percent = excluded.percent, updated = CURRENT_TIMESTAMP`, u.id, id, pct);
    return send(res, 200, { id, percent: pct });
  }
  fail(404, 'Not found.');
}

function serveStatic(req, res, url) {
  const file = path.join(PUBLIC, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    res.end(data);
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else serveStatic(req, res, url);
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message });
    console.error(e);
    send(res, 500, { error: 'Something went wrong on our side. Try again.' });
  }
}).listen(PORT, () => console.log(`Lumio running at http://localhost:${PORT}`));
