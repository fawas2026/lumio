// Password hashing (scrypt) and signed session tokens (HMAC-SHA256). No third-party packages.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function loadSecret() {
  if (process.env.TOKEN_SECRET) return process.env.TOKEN_SECRET;
  const file = path.join(__dirname, '..', 'data', '.secret');
  try { return fs.readFileSync(file, 'utf8'); }
  catch {
    const s = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, s, { mode: 0o600 });
    return s;
  }
}
const SECRET = loadSecret();

const hashPassword = (pw) => {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
};
const checkPassword = (pw, stored) => {
  const [salt, hash] = stored.split(':');
  const a = Buffer.from(hash, 'hex');
  const b = crypto.scryptSync(pw, salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const mac = (body) => crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
const signToken = (uid, days = 30) => {
  const body = Buffer.from(JSON.stringify({ uid, exp: Date.now() + days * 864e5 })).toString('base64url');
  return `${body}.${mac(body)}`;
};
const verifyToken = (token = '') => {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const a = Buffer.from(sig), b = Buffer.from(mac(body));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() ? p.uid : null;
  } catch { return null; }
};

module.exports = { hashPassword, checkPassword, signToken, verifyToken };
