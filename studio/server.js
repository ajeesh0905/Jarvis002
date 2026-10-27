// Studio app: shoot planning + photo review + social content calendar.
// Needs Node >= 22.13 (built-in node:sqlite). No npm install required.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { createStorage } from './storage.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3100;
const DATA_DIR = process.env.DATA_DIR || path.join(here, 'data');
const PUBLIC_DIR = path.join(here, 'public');
const MAX_UPLOAD = 30 * 1024 * 1024;
const SESSION_DAYS = 30;
const CLIENT_NAME = process.env.CLIENT_NAME || 'Twin Birds'; // the one social-media client
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'studio.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));

for (const col of ["status TEXT NOT NULL DEFAULT 'requested'", "fee TEXT NOT NULL DEFAULT ''", "note TEXT NOT NULL DEFAULT ''"]) {
  try { db.exec('ALTER TABLE shoot_resources ADD COLUMN ' + col); } catch { /* already there */ }
}
const q = (sql, ...p) => db.prepare(sql).all(...p);
const q1 = (sql, ...p) => db.prepare(sql).get(...p);
const run = (sql, ...p) => db.prepare(sql).run(...p);
const now = () => Date.now();
const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10); // IST
const storage = createStorage({
  dataDir: DATA_DIR,
  kv: { get: (k) => q1('SELECT v FROM kv WHERE k = ?', k)?.v, set: (k, v) => run('INSERT OR REPLACE INTO kv VALUES (?,?)', k, v) },
});

// ---------- auth ----------
function hashPin(pin, salt = crypto.randomBytes(16).toString('hex')) {
  return salt + ':' + crypto.scryptSync(String(pin), salt, 32).toString('hex');
}
function checkPin(pin, stored) {
  const [salt, h] = stored.split(':');
  const a = Buffer.from(h, 'hex'), b = crypto.scryptSync(String(pin), salt, 32);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
if (!q1('SELECT 1 x FROM users')) {
  const pin = process.env.ADMIN_PIN || '1234';
  run('INSERT INTO users (name, username, pin_hash, role) VALUES (?,?,?,?)', 'Admin', 'admin', hashPin(pin), 'admin');
  console.log(`Created first user: username "admin", PIN "${pin}" — change it under Team.`);
}

const fails = new Map(); // ip+user -> {n, until}
function throttled(key) { const f = fails.get(key); return f && f.until > now() && f.n >= 5; }
function noteFail(key) { const f = fails.get(key) || { n: 0, until: 0 }; f.n++; f.until = now() + 10 * 60e3; fails.set(key, f); }

function cookie(req, name) {
  const m = (req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}
function userFor(req) {
  const t = cookie(req, 'sid');
  if (!t) return null;
  const s = q1('SELECT u.id, u.name, u.username, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.created > ? AND u.active = 1', t, now() - SESSION_DAYS * 864e5);
  return s || null;
}

// ---------- helpers ----------
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (m) => new HttpError(400, m);
const deny = () => new HttpError(403, 'Not allowed for your role');
const str = (v, max = 2000) => String(v ?? '').trim().slice(0, max);
const oneOf = (v, list, what) => { if (!list.includes(v)) throw bad('Invalid ' + what); return v; };
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v));
const isTime = (v) => v === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const need = (u, ...roles) => { if (!roles.includes(u.role)) throw deny(); };

const SHOOT_STATUS = ['planned', 'shot', 'editing', 'done', 'cancelled'];
const POST_STATUS = ['idea', 'draft', 'scheduled', 'posted'];
const PHOTO_STATUS = ['uploaded', 'edited', 'approved', 'rejected'];
const PLATFORMS = ['instagram', 'facebook', 'youtube', 'tiktok', 'x', 'linkedin', 'whatsapp', 'other'];
const IMG_TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.heic': 'image/heic' };

function shootOut(s) {
  s.members = q('SELECT u.id, u.name, m.response FROM shoot_members m JOIN users u ON u.id = m.user_id WHERE m.shoot_id = ?', s.id);
  const c = q1(`SELECT COUNT(*) total, SUM(status='approved') approved, SUM(status IN ('edited','approved')) edited FROM photos WHERE shoot_id = ?`, s.id);
  s.photo_count = c.total; s.approved_count = c.approved || 0; s.edited_count = c.edited || 0;
  const sh = q1('SELECT COUNT(*) total, SUM(done) done FROM shots WHERE shoot_id = ?', s.id);
  s.shots_total = sh.total; s.shots_done = sh.done || 0;
  return s;
}
function setMembers(shootId, ids) {
  const prev = new Map(q('SELECT user_id, response FROM shoot_members WHERE shoot_id = ?', shootId).map(r => [r.user_id, r.response]));
  run('DELETE FROM shoot_members WHERE shoot_id = ?', shootId);
  const added = [];
  for (const id of [...new Set((ids || []).map(Number))]) {
    if (!q1('SELECT 1 x FROM users WHERE id = ? AND active = 1', id)) continue;
    run('INSERT INTO shoot_members (shoot_id, user_id, response) VALUES (?,?,?)', shootId, id, prev.get(id) || 'pending');
    if (!prev.has(id)) added.push(id);
  }
  return added;
}
const cleanUrl = (v) => { v = str(v, 300); if (!v) return ''; if (!/^https?:\/\//i.test(v)) v = 'https://' + v; try { const u = new URL(v); if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) throw 0; return u.href; } catch { throw bad('Invalid portfolio link: ' + v); } };
const cleanPhone = (v) => { v = str(v, 30).replace(/[\s()-]/g, ''); if (v && !/^\+?\d{7,15}$/.test(v)) throw bad('Phone number looks wrong: ' + v); return v; };
// directory people/places booked on a shoot; returns newly booked resource rows
function setResources(shootId, ids) {
  const prev = new Map(q('SELECT * FROM shoot_resources WHERE shoot_id = ?', shootId).map(r => [r.resource_id, r]));
  run('DELETE FROM shoot_resources WHERE shoot_id = ?', shootId);
  const added = [];
  for (const id of [...new Set(ids.map(Number))].slice(0, 100)) {
    const r = q1('SELECT id, kind, name, phone FROM resources WHERE id = ?', id); if (!r) continue;
    const old = prev.get(id);
    run('INSERT INTO shoot_resources (shoot_id, resource_id, status, fee, note) VALUES (?,?,?,?,?)', shootId, id, old?.status || 'requested', old?.fee || '', old?.note || '');
    if (!old) added.push(r);
  }
  return added;
}
// models and day plan are replaced wholesale from the shoot form
function setModels(shootId, list) {
  const rows = list.slice(0, 50).filter(m => str(m?.name, 100)).map(m => ({ name: str(m.name, 100), phone: cleanPhone(m.phone), portfolio: cleanUrl(m.portfolio), note: str(m.note, 300) }));
  const had = new Set(q('SELECT name, phone FROM shoot_models WHERE shoot_id = ?', shootId).map(m => (m.name + '|' + m.phone).toLowerCase()));
  run('DELETE FROM shoot_models WHERE shoot_id = ?', shootId);
  for (const m of rows) run('INSERT INTO shoot_models (shoot_id, name, phone, portfolio, note) VALUES (?,?,?,?,?)', shootId, m.name, m.phone, m.portfolio, m.note);
  return rows.filter(m => !had.has((m.name + '|' + m.phone).toLowerCase()));
}
function setPlan(shootId, list) {
  run('DELETE FROM shoot_plan WHERE shoot_id = ?', shootId);
  const items = list.slice(0, 100).map(i => ({ at: str(i?.time, 5), text: str(i?.text, 300) })).filter(i => i.text);
  for (const i of items) if (!isTime(i.at)) throw bad('Invalid time in day plan: ' + i.at);
  items.sort((a, b) => (a.at || '99:99').localeCompare(b.at || '99:99'));
  for (const i of items) run('INSERT INTO shoot_plan (shoot_id, at_time, text) VALUES (?,?,?)', shootId, i.at, i.text);
}
function postOut(p) {
  p.photos = q(`SELECT ph.id, ph.status FROM post_photos pp JOIN photos ph ON ph.id = pp.photo_id WHERE pp.post_id = ?`, p.id);
  return p;
}
function setPostPhotos(postId, ids) {
  run('DELETE FROM post_photos WHERE post_id = ?', postId);
  for (const id of [...new Set((ids || []).map(Number))]) {
    const ph = q1('SELECT status FROM photos WHERE id = ?', id);
    if (!ph) continue;
    if (ph.status !== 'approved') throw bad('Only approved photos can be attached to a post');
    run('INSERT INTO post_photos VALUES (?,?)', postId, id);
  }
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { reject(new HttpError(413, 'File too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req) {
  const b = await readBody(req, 1e6);
  try { return b.length ? JSON.parse(b.toString('utf8')) : {}; } catch { throw bad('Invalid JSON'); }
}

// ---------- messaging ----------
// Team members get an in-app notification; everyone with a phone number also gets a message through
// NOTIFY_WEBHOOK_URL (POST JSON {to, name, message}) — plug in WhatsApp/SMS via your provider, Make or Zapier.
const KIND_LABEL = { photographer: 'photographer', product_photographer: 'product photographer', makeup: 'makeup artist', art_director: 'art director', costume: 'costume designer', props: 'props', model: 'model' };
const NOTIFY_URL = process.env.NOTIFY_WEBHOOK_URL || '';
const shootLines = (s) => `📷 ${s.title}${s.client ? ' (' + s.client + ')' : ''}\n📅 ${s.shoot_date}${s.start_time ? ' at ' + s.start_time : ''}\n📍 ${s.location || 'Location to be confirmed'}`;
async function deliver({ shootId, name, phone, text }) {
  let status = 'skipped', error = '';
  if (!phone) error = 'No phone number saved';
  else if (!NOTIFY_URL) error = 'Auto-send is not set up (NOTIFY_WEBHOOK_URL)';
  else {
    try {
      const r = await fetch(NOTIFY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: phone, name, message: text }), signal: AbortSignal.timeout(10000) });
      status = r.ok ? 'sent' : 'failed'; if (!r.ok) error = 'HTTP ' + r.status;
    } catch (e) { status = 'failed'; error = e.message; }
  }
  run('INSERT INTO outbox (shoot_id, to_name, to_phone, text, status, error, created) VALUES (?,?,?,?,?,?,?)', shootId, name, phone || '', text, status, error, now());
}
// kind: 'booked' | 'updated' | 'cancelled'. Never throws — messaging must not break saving a shoot.
function tell(shootId, { userIds = [], models = [], resources = [], kind, skipUser }) {
  try {
    const s = q1('SELECT * FROM shoots WHERE id = ?', shootId); if (!s) return;
    const head = { booked: "you're booked for a photo shoot", updated: 'a shoot you are on has changed', cancelled: 'this shoot is cancelled' };
    const jobs = [];
    for (const id of userIds) {
      if (id === skipUser) continue;
      const u = q1('SELECT name, phone FROM users WHERE id = ? AND active = 1', id); if (!u) continue;
      const text = `Hi ${u.name}, ${head[kind]}:\n${shootLines(s)}\nOpen the Studio app to reply going / can't go.`;
      run('INSERT INTO notifications (user_id, shoot_id, text, created) VALUES (?,?,?,?)', id, shootId, text, now());
      jobs.push(deliver({ shootId, name: u.name, phone: u.phone, text }));
    }
    for (const m of models) {
      const text = `Hi ${m.name}, ${kind === 'booked' ? "you're booked as a model for a shoot" : head[kind]}:\n${shootLines(s)}${m.note ? '\nNote: ' + m.note : ''}`;
      jobs.push(deliver({ shootId, name: m.name, phone: m.phone, text }));
    }
    for (const r of resources) {
      if (r.kind === 'studio' || r.kind === 'resort') continue; // places are not messaged
      const text = `Hi ${r.name}, ${kind === 'booked' ? `you're booked as ${KIND_LABEL[r.kind] || 'crew'} for a shoot` : head[kind]}:\n${shootLines(s)}${r.fee ? '\nAgreed fee: ' + r.fee : ''}${r.note ? '\nNote: ' + r.note : ''}${kind === 'booked' ? '\nPlease reply to confirm.' : ''}`;
      jobs.push(deliver({ shootId, name: r.name, phone: r.phone, text }));
    }
    Promise.allSettled(jobs).then(r => r.forEach(x => x.status === 'rejected' && console.error('deliver failed', x.reason)));
  } catch (e) { console.error('tell failed', e); }
}

// ---------- routes ----------
// Each route: [method, regex, handler(ctx)] where ctx = {u, m (match), body(), url, req, res}
const routes = [];
const route = (method, re, fn, { auth = true } = {}) => routes.push({ method, re: new RegExp('^' + re + '$'), fn, auth });

route('POST', '/api/login', async (c) => {
  const b = await c.body();
  const key = c.req.socket.remoteAddress + '|' + str(b.username, 60).toLowerCase();
  if (throttled(key)) throw new HttpError(429, 'Too many attempts. Try again in 10 minutes.');
  const user = q1('SELECT * FROM users WHERE username = ? AND active = 1', str(b.username, 60).toLowerCase());
  if (!user || !checkPin(str(b.pin, 100), user.pin_hash)) { noteFail(key); throw new HttpError(401, 'Wrong username or PIN'); }
  fails.delete(key);
  const token = crypto.randomBytes(32).toString('hex');
  run('INSERT INTO sessions VALUES (?,?,?)', token, user.id, now());
  c.res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}`);
  return { id: user.id, name: user.name, username: user.username, role: user.role };
}, { auth: false });
route('POST', '/api/logout', (c) => {
  const t = cookie(c.req, 'sid'); if (t) run('DELETE FROM sessions WHERE token = ?', t);
  c.res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; Max-Age=0');
  return { ok: true };
}, { auth: false });
route('GET', '/api/me', (c) => {
  if (!c.u) throw new HttpError(401, 'Not logged in');
  return { ...c.u, client: CLIENT_NAME, phone: q1('SELECT phone FROM users WHERE id = ?', c.u.id).phone, auto_messages: !!NOTIFY_URL, unread: q1('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read = 0', c.u.id).n };
}, { auth: false });
route('PUT', '/api/me/phone', async (c) => { const b = await c.body(); run('UPDATE users SET phone = ? WHERE id = ?', cleanPhone(b.phone), c.u.id); return { ok: true }; });
route('GET', '/api/notifications', (c) => q('SELECT id, shoot_id, text, read, created FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 30', c.u.id));
route('POST', '/api/notifications/read', (c) => { run('UPDATE notifications SET read = 1 WHERE user_id = ?', c.u.id); return { ok: true }; });

// users (admin)
route('GET', '/api/users', (c) => q(`SELECT id, name, username, role, active, phone FROM users ORDER BY active DESC, name`).filter(u => c.u.role === 'admin' || u.active).map(u => c.u.role === 'admin' || u.id === c.u.id ? u : { ...u, phone: '' }));
route('POST', '/api/users', async (c) => {
  need(c.u, 'admin'); const b = await c.body();
  const username = str(b.username, 60).toLowerCase();
  if (!/^[a-z0-9._-]{2,30}$/.test(username)) throw bad('Username: 2-30 letters/numbers');
  if (!/^\d{4,8}$/.test(str(b.pin, 20))) throw bad('PIN must be 4-8 digits');
  if (q1('SELECT 1 x FROM users WHERE username = ?', username)) throw bad('Username already taken');
  const r = run('INSERT INTO users (name, username, pin_hash, role, phone) VALUES (?,?,?,?,?)', str(b.name, 80) || username, username, hashPin(str(b.pin, 20)), oneOf(b.role, ['admin', 'photographer', 'social'], 'role'), cleanPhone(b.phone));
  return { id: Number(r.lastInsertRowid) };
});
route('PUT', '/api/users/(\\d+)', async (c) => {
  need(c.u, 'admin'); const id = +c.m[1], b = await c.body();
  const cur = q1('SELECT * FROM users WHERE id = ?', id); if (!cur) throw new HttpError(404, 'No such user');
  const role = b.role ? oneOf(b.role, ['admin', 'photographer', 'social'], 'role') : cur.role;
  const active = b.active === undefined ? cur.active : (b.active ? 1 : 0);
  if (id === c.u.id && (!active || role !== 'admin')) throw bad("You can't remove your own admin access");
  let hash = cur.pin_hash;
  if (b.pin) { if (!/^\d{4,8}$/.test(str(b.pin, 20))) throw bad('PIN must be 4-8 digits'); hash = hashPin(str(b.pin, 20)); }
  run('UPDATE users SET name = ?, role = ?, active = ?, pin_hash = ?, phone = ? WHERE id = ?', str(b.name, 80) || cur.name, role, active, hash, b.phone === undefined ? cur.phone : cleanPhone(b.phone), id);
  if (!active || b.pin) run('DELETE FROM sessions WHERE user_id = ?', id);
  return { ok: true };
});
route('POST', '/api/me/pin', async (c) => {
  const b = await c.body();
  const cur = q1('SELECT pin_hash FROM users WHERE id = ?', c.u.id);
  if (!checkPin(str(b.current, 100), cur.pin_hash)) throw bad('Current PIN is wrong');
  if (!/^\d{4,8}$/.test(str(b.pin, 20))) throw bad('PIN must be 4-8 digits');
  run('UPDATE users SET pin_hash = ? WHERE id = ?', hashPin(str(b.pin, 20)), c.u.id);
  return { ok: true };
});

// shoots
function shootInput(b, cur = {}) {
  const title = str(b.title ?? cur.title, 120); if (!title) throw bad('Title is required');
  const shoot_date = str(b.shoot_date ?? cur.shoot_date, 10); if (!isDate(shoot_date)) throw bad('Valid date required');
  const start_time = str(b.start_time ?? cur.start_time ?? '', 5); if (!isTime(start_time)) throw bad('Invalid time');
  return {
    title, shoot_date, start_time,
    client: str(b.client ?? cur.client ?? '', 120), location: str(b.location ?? cur.location ?? '', 200), location_link: cleanUrl(b.location_link ?? cur.location_link ?? ''), notes: str(b.notes ?? cur.notes ?? '', 4000),
    status: oneOf(b.status ?? cur.status ?? 'planned', SHOOT_STATUS, 'status'),
  };
}
route('GET', '/api/shoots', (c) => {
  const from = c.url.searchParams.get('from'), to = c.url.searchParams.get('to');
  const rows = from && to ? q('SELECT * FROM shoots WHERE shoot_date BETWEEN ? AND ? ORDER BY shoot_date, start_time', from, to) : q('SELECT * FROM shoots ORDER BY shoot_date DESC, start_time DESC LIMIT 300');
  return rows.map(shootOut);
});
route('POST', '/api/shoots', async (c) => {
  need(c.u, 'admin', 'photographer'); const b = await c.body(); const s = shootInput(b);
  const r = run('INSERT INTO shoots (title, client, shoot_date, start_time, location, location_link, notes, status, created_by, created) VALUES (?,?,?,?,?,?,?,?,?,?)', s.title, s.client, s.shoot_date, s.start_time, s.location, s.location_link, s.notes, s.status, c.u.id, now());
  const id = Number(r.lastInsertRowid);
  const addedUsers = setMembers(id, b.members);
  const addedModels = Array.isArray(b.models) ? setModels(id, b.models) : [];
  if (Array.isArray(b.plan)) setPlan(id, b.plan);
  const addedRes = Array.isArray(b.resources) ? setResources(id, b.resources) : [];
  tell(id, { userIds: addedUsers, models: addedModels, resources: addedRes, kind: 'booked', skipUser: c.u.id });
  for (const t of (b.shots || [])) if (str(t, 200)) run('INSERT INTO shots (shoot_id, text) VALUES (?,?)', id, str(t, 200));
  return { id };
});
route('GET', '/api/shoots/(\\d+)', (c) => {
  const s = q1('SELECT * FROM shoots WHERE id = ?', +c.m[1]); if (!s) throw new HttpError(404, 'No such shoot');
  shootOut(s);
  s.shots = q('SELECT id, text, done FROM shots WHERE shoot_id = ? ORDER BY id', s.id);
  s.models = q('SELECT id, name, phone, portfolio, note FROM shoot_models WHERE shoot_id = ? ORDER BY id', s.id);
  if (!(c.u.role === 'admin' || c.u.role === 'photographer')) for (const m of s.models) m.phone = '';
  s.resources = q('SELECT r.id, r.kind, r.name, r.city, r.phone, r.link, r.maps, r.category, r.charge, sr.status, sr.fee, sr.note FROM shoot_resources sr JOIN resources r ON r.id = sr.resource_id WHERE sr.shoot_id = ? ORDER BY r.kind, r.name', s.id);
  if (!(c.u.role === 'admin' || c.u.role === 'photographer')) for (const r of s.resources) r.phone = '';
  s.messages = (c.u.role === 'admin' || c.u.role === 'photographer') ? q('SELECT id, to_name, status, error, created FROM outbox WHERE shoot_id = ? ORDER BY id DESC LIMIT 30', s.id) : [];
  s.plan = q('SELECT id, at_time, text FROM shoot_plan WHERE shoot_id = ? ORDER BY id', s.id);
  s.feedback = q(`SELECT f.id, f.kind, f.text, f.created, f.user_id, u.name FROM shoot_feedback f JOIN users u ON u.id = f.user_id WHERE f.shoot_id = ? ORDER BY f.id`, s.id);
  s.photos = q(`SELECT p.id, p.name, p.status, p.created, u.name uploader, (SELECT COUNT(*) FROM comments WHERE photo_id = p.id) comments FROM photos p LEFT JOIN users u ON u.id = p.uploaded_by WHERE p.shoot_id = ? ORDER BY p.id`, s.id);
  return s;
});
route('PUT', '/api/shoots/(\\d+)', async (c) => {
  need(c.u, 'admin', 'photographer'); const id = +c.m[1], b = await c.body();
  const cur = q1('SELECT * FROM shoots WHERE id = ?', id); if (!cur) throw new HttpError(404, 'No such shoot');
  const s = shootInput(b, cur);
  run('UPDATE shoots SET title=?, client=?, shoot_date=?, start_time=?, location=?, location_link=?, notes=?, status=? WHERE id=?', s.title, s.client, s.shoot_date, s.start_time, s.location, s.location_link, s.notes, s.status, id);
  const oldUsers = q('SELECT user_id FROM shoot_members WHERE shoot_id = ?', id).map(r => r.user_id);
  const oldModels = q('SELECT name, phone, note FROM shoot_models WHERE shoot_id = ?', id);
  const addedUsers = Array.isArray(b.members) ? setMembers(id, b.members) : [];
  const addedModels = Array.isArray(b.models) ? setModels(id, b.models) : [];
  if (Array.isArray(b.plan)) setPlan(id, b.plan);
  // new people get "booked"; people already on it hear about date/time/place changes or a cancellation
  const cancelled = s.status === 'cancelled' && cur.status !== 'cancelled';
  const changed = ['shoot_date', 'start_time', 'location'].some(k => s[k] !== cur[k]);
  const oldRes = q('SELECT r.id, r.kind, r.name, r.phone FROM shoot_resources sr JOIN resources r ON r.id = sr.resource_id WHERE sr.shoot_id = ?', id);
  const addedRes = Array.isArray(b.resources) ? setResources(id, b.resources) : [];
  tell(id, { userIds: addedUsers, models: addedModels, resources: addedRes, kind: 'booked', skipUser: c.u.id });
  if ((cancelled || changed) && cur.status !== 'cancelled') {
    const keepUsers = oldUsers.filter(u => !Array.isArray(b.members) || b.members.map(Number).includes(u));
    const keepModels = oldModels.filter(m => !Array.isArray(b.models) || b.models.some(x => str(x?.name, 100).toLowerCase() === m.name.toLowerCase()));
    const keepRes = oldRes.filter(r => !Array.isArray(b.resources) || b.resources.map(Number).includes(r.id));
    tell(id, { userIds: keepUsers, models: keepModels, resources: keepRes, kind: cancelled ? 'cancelled' : 'updated', skipUser: c.u.id });
  }
  return { ok: true };
});
route('DELETE', '/api/shoots/(\\d+)', async (c) => {
  need(c.u, 'admin'); const id = +c.m[1];
  for (const p of q('SELECT * FROM photos WHERE shoot_id = ?', id)) await removePhoto(p);
  for (const t of ['shoot_models', 'shoot_plan', 'shoot_feedback', 'shoot_resources']) run(`DELETE FROM ${t} WHERE shoot_id = ?`, id);
  run('DELETE FROM shots WHERE shoot_id = ?', id); run('DELETE FROM shoot_members WHERE shoot_id = ?', id); run('DELETE FROM shoots WHERE id = ?', id);
  return { ok: true };
});

// going / can't go (the logged-in person answers for themselves)
route('PUT', '/api/shoots/(\\d+)/rsvp', async (c) => {
  const b = await c.body(); const response = oneOf(b.response, ['pending', 'going', 'not_going'], 'response');
  const r = run('UPDATE shoot_members SET response = ? WHERE shoot_id = ? AND user_id = ?', response, +c.m[1], c.u.id);
  if (!r.changes) throw bad("You're not on this shoot's team");
  return { ok: true };
});
// suggestions & feedback: anyone logged in can post on a shoot
route('POST', '/api/shoots/(\\d+)/feedback', async (c) => {
  const b = await c.body(); const text = str(b.text, 2000); if (!text) throw bad('Write something first');
  if (!q1('SELECT 1 x FROM shoots WHERE id = ?', +c.m[1])) throw new HttpError(404, 'No such shoot');
  run('INSERT INTO shoot_feedback (shoot_id, user_id, kind, text, created) VALUES (?,?,?,?,?)', +c.m[1], c.u.id, oneOf(b.kind, ['suggestion', 'feedback'], 'kind'), text, now());
  return { ok: true };
});
route('DELETE', '/api/feedback/(\\d+)', (c) => {
  const f = q1('SELECT * FROM shoot_feedback WHERE id = ?', +c.m[1]); if (!f) throw new HttpError(404, 'Not found');
  if (f.user_id !== c.u.id && c.u.role !== 'admin') throw deny();
  run('DELETE FROM shoot_feedback WHERE id = ?', f.id); return { ok: true };
});

// shot list
route('POST', '/api/shoots/(\\d+)/shots', async (c) => {
  need(c.u, 'admin', 'photographer'); const b = await c.body(); const text = str(b.text, 200); if (!text) throw bad('Text required');
  if (!q1('SELECT 1 x FROM shoots WHERE id = ?', +c.m[1])) throw new HttpError(404, 'No such shoot');
  return { id: Number(run('INSERT INTO shots (shoot_id, text) VALUES (?,?)', +c.m[1], text).lastInsertRowid) };
});
route('PUT', '/api/shots/(\\d+)', async (c) => {
  need(c.u, 'admin', 'photographer'); const b = await c.body();
  run('UPDATE shots SET done = ? WHERE id = ?', b.done ? 1 : 0, +c.m[1]); return { ok: true };
});
route('DELETE', '/api/shots/(\\d+)', (c) => { need(c.u, 'admin', 'photographer'); run('DELETE FROM shots WHERE id = ?', +c.m[1]); return { ok: true }; });

// photos
async function removePhoto(p) {
  await storage.remove(p);
  run('DELETE FROM comments WHERE photo_id = ?', p.id); run('DELETE FROM post_photos WHERE photo_id = ?', p.id); run('DELETE FROM photos WHERE id = ?', p.id);
}
route('POST', '/api/shoots/(\\d+)/photos', async (c) => {
  need(c.u, 'admin', 'photographer');
  const shoot = q1('SELECT * FROM shoots WHERE id = ?', +c.m[1]); if (!shoot) throw new HttpError(404, 'No such shoot');
  const name = path.basename(str(c.url.searchParams.get('name'), 200)) || 'photo.jpg';
  const ext = path.extname(name).toLowerCase();
  if (!IMG_TYPES[ext]) throw bad('Only JPG, PNG, WEBP, GIF or HEIC images');
  const buf = await readBody(c.req, MAX_UPLOAD);
  if (!buf.length) throw bad('Empty file');
  let saved;
  try { saved = await storage.put({ buf, name, mime: IMG_TYPES[ext], shoot }); }
  catch (e) { console.error(e); throw new HttpError(502, 'Could not save to storage: ' + e.message); }
  const r = run('INSERT INTO photos (shoot_id, file, store, name, size, uploaded_by, created) VALUES (?,?,?,?,?,?,?)', shoot.id, saved.file, saved.store, name, buf.length, c.u.id, now());
  return { id: Number(r.lastInsertRowid) };
});
route('PUT', '/api/photos/(\\d+)', async (c) => {
  const b = await c.body(); const id = +c.m[1];
  const p = q1('SELECT * FROM photos WHERE id = ?', id); if (!p) throw new HttpError(404, 'No such photo');
  const status = oneOf(b.status, PHOTO_STATUS, 'status');
  // photographers move photos uploaded<->edited; social/admin can approve or reject
  if (c.u.role === 'photographer' && !['uploaded', 'edited'].includes(status)) throw deny();
  if (c.u.role === 'photographer' && p.status === 'approved') throw new HttpError(403, 'Already approved — ask the social manager to change it');
  if (c.u.role === 'social' && !['approved', 'rejected', 'uploaded', 'edited'].includes(status)) throw deny();
  run('UPDATE photos SET status = ? WHERE id = ?', status, id);
  if (status !== 'approved') run('DELETE FROM post_photos WHERE photo_id = ?', id); // un-approved photos can't stay on posts
  return { ok: true };
});
route('DELETE', '/api/photos/(\\d+)', async (c) => {
  const p = q1('SELECT * FROM photos WHERE id = ?', +c.m[1]); if (!p) throw new HttpError(404, 'No such photo');
  if (!(c.u.role === 'admin' || (c.u.role === 'photographer' && p.uploaded_by === c.u.id))) throw deny();
  await removePhoto(p); return { ok: true };
});
route('GET', '/api/photos/(\\d+)/comments', (c) => q(`SELECT c.id, c.text, c.created, u.name FROM comments c JOIN users u ON u.id = c.user_id WHERE c.photo_id = ? ORDER BY c.id`, +c.m[1]));
route('POST', '/api/photos/(\\d+)/comments', async (c) => {
  const b = await c.body(); const text = str(b.text, 1000); if (!text) throw bad('Comment is empty');
  if (!q1('SELECT 1 x FROM photos WHERE id = ?', +c.m[1])) throw new HttpError(404, 'No such photo');
  run('INSERT INTO comments (photo_id, user_id, text, created) VALUES (?,?,?,?)', +c.m[1], c.u.id, text, now()); return { ok: true };
});
route('GET', '/api/photos/approved', (c) => q(`SELECT p.id, p.name, s.title shoot FROM photos p JOIN shoots s ON s.id = p.shoot_id WHERE p.status = 'approved' ORDER BY p.id DESC LIMIT 300`));
route('GET', '/files/(\\d+)', async (c) => {
  const p = q1('SELECT * FROM photos WHERE id = ?', +c.m[1]); if (!p) throw new HttpError(404, 'Not found');
  let f; try { f = await storage.open(p); } catch (e) { console.error(e); throw new HttpError(502, 'Storage unavailable'); }
  if (!f) throw new HttpError(404, 'File missing');
  const dl = c.url.searchParams.get('download');
  c.res.writeHead(200, {
    'Content-Type': IMG_TYPES[path.extname(p.name).toLowerCase()] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff',
    ...(f.size ? { 'Content-Length': f.size } : {}), 'Cache-Control': 'private, max-age=3600',
    'Content-Disposition': `${dl ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(p.name)}`,
  });
  f.stream.on('error', () => c.res.destroy());
  f.stream.pipe(c.res); return null;
});

// posts
function postInput(b, cur = {}) {
  const title = str(b.title ?? cur.title, 120); if (!title) throw bad('Title is required');
  const post_date = str(b.post_date ?? cur.post_date, 10); if (!isDate(post_date)) throw bad('Valid date required');
  const post_time = str(b.post_time ?? cur.post_time ?? '', 5); if (!isTime(post_time)) throw bad('Invalid time');
  return {
    title, post_date, post_time,
    platform: oneOf(b.platform ?? cur.platform ?? 'instagram', PLATFORMS, 'platform'),
    caption: str(b.caption ?? cur.caption ?? '', 4000), hashtags: str(b.hashtags ?? cur.hashtags ?? '', 1000),
    status: oneOf(b.status ?? cur.status ?? 'idea', POST_STATUS, 'status'),
  };
}
route('GET', '/api/posts', (c) => {
  const from = c.url.searchParams.get('from'), to = c.url.searchParams.get('to');
  const rows = from && to ? q('SELECT * FROM posts WHERE post_date BETWEEN ? AND ? ORDER BY post_date, post_time', from, to) : q('SELECT * FROM posts ORDER BY post_date DESC, post_time DESC LIMIT 300');
  return rows.map(postOut);
});
route('GET', '/api/posts/(\\d+)', (c) => { const p = q1('SELECT * FROM posts WHERE id = ?', +c.m[1]); if (!p) throw new HttpError(404, 'No such post'); return postOut(p); });
route('POST', '/api/posts', async (c) => {
  need(c.u, 'admin', 'social'); const b = await c.body(); const p = postInput(b);
  const r = run('INSERT INTO posts (title, platform, post_date, post_time, caption, hashtags, status, created_by, created) VALUES (?,?,?,?,?,?,?,?,?)', p.title, p.platform, p.post_date, p.post_time, p.caption, p.hashtags, p.status, c.u.id, now());
  const id = Number(r.lastInsertRowid);
  try { setPostPhotos(id, b.photos); } catch (e) { run('DELETE FROM posts WHERE id = ?', id); run('DELETE FROM post_photos WHERE post_id = ?', id); throw e; }
  return { id };
});
route('PUT', '/api/posts/(\\d+)', async (c) => {
  need(c.u, 'admin', 'social'); const id = +c.m[1], b = await c.body();
  const cur = q1('SELECT * FROM posts WHERE id = ?', id); if (!cur) throw new HttpError(404, 'No such post');
  const p = postInput(b, cur);
  if (p.status === 'scheduled' || p.status === 'posted') {
    const n = Array.isArray(b.photos) ? b.photos.length : q1('SELECT COUNT(*) n FROM post_photos WHERE post_id = ?', id).n;
    if (!n && !b.allow_no_photo) throw bad('Attach at least one approved photo before scheduling');
  }
  db.exec('BEGIN');
  try {
    run('UPDATE posts SET title=?, platform=?, post_date=?, post_time=?, caption=?, hashtags=?, status=? WHERE id=?', p.title, p.platform, p.post_date, p.post_time, p.caption, p.hashtags, p.status, id);
    if (Array.isArray(b.photos)) setPostPhotos(id, b.photos);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { ok: true };
});
route('DELETE', '/api/posts/(\\d+)', (c) => { need(c.u, 'admin', 'social'); run('DELETE FROM post_photos WHERE post_id = ?', +c.m[1]); run('DELETE FROM posts WHERE id = ?', +c.m[1]); return { ok: true }; });

// monthly deliverables board (reels + statics for the client)
const isMonth = (v) => /^\d{4}-(0[1-9]|1[0-2])$/.test(v || '');
const DEFAULT_TARGET = { reels: Number(process.env.DEFAULT_REELS) || 8, statics: Number(process.env.DEFAULT_STATICS) || 12 };
function targetFor(month) {
  // a month with no target set inherits the most recent earlier one
  return q1('SELECT reels, statics FROM month_targets WHERE month <= ? ORDER BY month DESC LIMIT 1', month) || DEFAULT_TARGET;
}
route('GET', '/api/board', (c) => {
  const month = c.url.searchParams.get('month') || today().slice(0, 7); if (!isMonth(month)) throw bad('Invalid month');
  return { month, client: CLIENT_NAME, target: targetFor(month), slots: q('SELECT type, slot, done, extra, tag, done_at FROM deliverables WHERE month = ? ORDER BY type, slot', month) };
});
route('PUT', '/api/board/target', async (c) => {
  need(c.u, 'admin', 'social'); const b = await c.body();
  if (!isMonth(b.month)) throw bad('Invalid month');
  const n = (v) => { v = Math.floor(Number(v)); if (!(v >= 0 && v <= 100)) throw bad('Targets must be 0-100'); return v; };
  run('INSERT OR REPLACE INTO month_targets VALUES (?,?,?)', b.month, n(b.reels), n(b.statics)); return { ok: true };
});
route('PUT', '/api/board/slot', async (c) => {
  need(c.u, 'admin', 'social'); const b = await c.body();
  if (!isMonth(b.month)) throw bad('Invalid month');
  const type = oneOf(b.type, ['reel', 'static'], 'type'), slot = Math.floor(Number(b.slot));
  if (!(slot >= 1 && slot <= 150)) throw bad('Invalid slot');
  const t = targetFor(b.month)[type === 'reel' ? 'reels' : 'statics'];
  const cur = q1('SELECT * FROM deliverables WHERE month = ? AND type = ? AND slot = ?', b.month, type, slot);
  const extra = slot > t ? 1 : 0;
  if (extra && !cur && !b.add) throw bad('Slot does not exist');
  const done = b.done === undefined ? (cur?.done ?? 0) : (b.done ? 1 : 0);
  const tag = b.tag === undefined ? (cur?.tag ?? '') : str(b.tag, 6);
  if (!done && !tag && !extra) run('DELETE FROM deliverables WHERE month = ? AND type = ? AND slot = ?', b.month, type, slot);
  else run('INSERT OR REPLACE INTO deliverables VALUES (?,?,?,?,?,?,?,?)', b.month, type, slot, done, extra, tag, done ? (cur?.done ? cur.done_by : c.u.id) : null, done ? (cur?.done ? cur.done_at : now()) : null);
  return { ok: true };
});
route('DELETE', '/api/board/slot', (c) => {
  need(c.u, 'admin', 'social');
  const month = c.url.searchParams.get('month'), type = c.url.searchParams.get('type'), slot = +c.url.searchParams.get('slot');
  if (!isMonth(month) || slot <= targetFor(month)[type === 'reel' ? 'reels' : 'statics']) throw bad('Only extra slots can be removed');
  run('DELETE FROM deliverables WHERE month = ? AND type = ? AND slot = ?', month, type, slot); return { ok: true };
});

// directory (vendors, studios, resorts, models) — admin + photographer team only
const KINDS = ['studio', 'resort', 'photographer', 'product_photographer', 'makeup', 'art_director', 'costume', 'props', 'model'];
const CC = process.env.DEFAULT_COUNTRY_CODE || '91';
function parseCsv(t) {
  const rows = []; let row = [], f = '', inq = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inq) { if (ch === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else inq = false; } else f += ch; }
    else if (ch === '"') inq = true;
    else if (ch === ',') { row.push(f); f = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; row.push(f); f = ''; rows.push(row); row = []; }
    else f += ch;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}
const isUrl = (v) => /^https?:\/\//i.test(String(v).trim());
const firstUrl = (v) => (String(v).match(/https?:\/\/[^\s]+/) || [''])[0];
// "98765 43210", "+91 98765-43210", "919944024152", "DM", "a@b.com" -> { phone, email }
function splitContact(v) {
  v = String(v || '').trim(); const out = { phone: '', email: '' };
  const em = v.match(/[^\s@]+@[^\s@]+\.[^\s@]+/); if (em) out.email = em[0].toLowerCase();
  const d = v.replace(/[^\d]/g, '');
  if (!em && d.length === 10) out.phone = '+' + CC + d;
  else if (!em && d.length >= 11 && d.length <= 15) out.phone = '+' + d;
  return out;
}
// header names in the sheet tabs -> our fields
const COLS = { name: ['name', 'resort/location'], city: ['city'], contact: ['phone number', 'number', 'contact', 'contact details', 'phone'],
  link: ['instagram', 'instagram id', 'instagram link', 'instagram/behance', 'works url', 'website', 'link'], maps: ['location link', 'maps'],
  category: ['category'], style: ['work style'], rating: ['rating'], charge: ['charges', 'charge per day', 'costing day', 'quotation', 'charge'], distance: ['location from cbe', 'distance'], notes: ['comments', 'note', 'notes'] };
function importRows(kind, rows) {
  if (rows.length < 2) throw bad('The file has no rows');
  const head = rows[0].map(h => h.trim().toLowerCase());
  const idx = (field) => head.findIndex(h => COLS[field].includes(h));
  const col = Object.fromEntries(Object.keys(COLS).map(f => [f, idx(f)]));
  const locIdx = head.indexOf('location');
  const used = new Set([...Object.values(col), locIdx, head.indexOf('date')]);
  if (col.name < 0) throw bad('Could not find a "Name" column in the first row');
  let added = 0, updated = 0, skipped = 0;
  for (const r of rows.slice(1, 2001)) {
    const g = (i) => (i >= 0 ? String(r[i] ?? '').trim() : '');
    const name = g(col.name).slice(0, 120); if (!name) { skipped++; continue; }
    // a "Location" column is a map link in some tabs and an area name in others
    const loc = g(locIdx);
    const rec = { city: g(col.city).slice(0, 80) || (!isUrl(loc) ? loc.slice(0, 80) : ''), maps: g(col.maps) || (isUrl(loc) ? loc : ''),
      link: firstUrl(g(col.link)) || g(col.link).slice(0, 300), category: g(col.category).slice(0, 120), style: g(col.style).slice(0, 120), rating: g(col.rating).slice(0, 40),
      charge: g(col.charge).slice(0, 120), distance: g(col.distance).slice(0, 60), ...splitContact(g(col.contact)) };
    let notes = g(col.notes);
    head.forEach((h, i) => { if (!used.has(i) && h && g(i)) notes += (notes ? '\n' : '') + `${rows[0][i].trim()}: ${g(i).slice(0, 300)}`; });
    rec.notes = notes.slice(0, 1500);
    rec.maps = isUrl(rec.maps) ? rec.maps.slice(0, 1500) : ''; if (rec.link && !isUrl(rec.link)) { rec.notes = (rec.notes ? rec.notes + '\n' : '') + rec.link; rec.link = ''; }
    const have = q1('SELECT id FROM resources WHERE kind = ? AND lower(name) = lower(?)', kind, name);
    if (have) {
      // fill gaps only — never overwrite what the team has already edited
      const cur = q1('SELECT * FROM resources WHERE id = ?', have.id);
      const m = Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, cur[k] || v]));
      run('UPDATE resources SET city=?, phone=?, email=?, link=?, maps=?, category=?, style=?, rating=?, charge=?, distance=?, notes=? WHERE id=?', m.city, m.phone, m.email, m.link, m.maps, m.category, m.style, m.rating, m.charge, m.distance, m.notes, have.id);
      updated++;
    } else {
      run('INSERT INTO resources (kind, name, city, phone, email, link, maps, category, style, rating, charge, distance, notes, created) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', kind, name, rec.city, rec.phone, rec.email, rec.link, rec.maps, rec.category, rec.style, rec.rating, rec.charge, rec.distance, rec.notes, now());
      added++;
    }
  }
  return { added, updated, skipped };
}
function resInput(b, cur = {}) {
  const name = str(b.name ?? cur.name, 120); if (!name) throw bad('Name is required');
  const link = str(b.link ?? cur.link ?? '', 300), maps = str(b.maps ?? cur.maps ?? '', 1500);
  if ((link && !isUrl(link)) || (maps && !isUrl(maps))) throw bad('Links must start with http:// or https://');
  const email = str(b.email ?? cur.email ?? '', 120); if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('Email looks wrong');
  return { kind: oneOf(b.kind ?? cur.kind, KINDS, 'type'), name, city: str(b.city ?? cur.city ?? '', 80), phone: cleanPhone(b.phone ?? cur.phone ?? ''), email, link, maps,
    category: str(b.category ?? cur.category ?? '', 120), style: str(b.style ?? cur.style ?? '', 120), rating: str(b.rating ?? cur.rating ?? '', 40), charge: str(b.charge ?? cur.charge ?? '', 120),
    distance: str(b.distance ?? cur.distance ?? '', 60), notes: str(b.notes ?? cur.notes ?? '', 1500) };
}
route('GET', '/api/resources', (c) => {
  need(c.u, 'admin', 'photographer');
  const kind = c.url.searchParams.get('kind'), qs = '%' + str(c.url.searchParams.get('q'), 60).toLowerCase() + '%';
  const rows = q(`SELECT * FROM resources WHERE (? IS NULL OR kind = ?) AND (lower(name) LIKE ? OR lower(city) LIKE ? OR lower(category) LIKE ?) ORDER BY name LIMIT 1000`, kind, kind, qs, qs, qs);
  const up = new Map();
  for (const b of q(`SELECT sr.resource_id rid, s.id shoot_id, s.title, s.shoot_date, sr.status FROM shoot_resources sr JOIN shoots s ON s.id = sr.shoot_id WHERE s.shoot_date >= ? AND s.status != 'cancelled' AND sr.status != 'declined' ORDER BY s.shoot_date`, today())) {
    if (!up.has(b.rid)) up.set(b.rid, []); up.get(b.rid).push(b);
  }
  for (const r of rows) r.upcoming = (up.get(r.id) || []).slice(0, 5);
  return rows;
});
// book one person from the directory onto a shoot (sends the message), warns about same-day clashes
route('POST', '/api/shoots/(\\d+)/book', async (c) => {
  need(c.u, 'admin', 'photographer'); const b = await c.body(); const id = +c.m[1];
  const s = q1('SELECT * FROM shoots WHERE id = ?', id); if (!s) throw new HttpError(404, 'No such shoot');
  if (s.status === 'cancelled') throw bad('This shoot is cancelled');
  const r = q1('SELECT id, kind, name, phone FROM resources WHERE id = ?', +b.resource_id); if (!r) throw new HttpError(404, 'Not in the directory');
  if (q1('SELECT 1 x FROM shoot_resources WHERE shoot_id = ? AND resource_id = ?', id, r.id)) throw bad(r.name + ' is already booked on this shoot');
  const fee = str(b.fee, 60), note = str(b.note, 300);
  const conflicts = q(`SELECT s2.id, s2.title FROM shoot_resources sr JOIN shoots s2 ON s2.id = sr.shoot_id WHERE sr.resource_id = ? AND s2.shoot_date = ? AND s2.status != 'cancelled' AND sr.status != 'declined'`, r.id, s.shoot_date);
  run('INSERT INTO shoot_resources (shoot_id, resource_id, status, fee, note) VALUES (?,?,?,?,?)', id, r.id, 'requested', fee, note);
  if (r.kind !== 'studio' && r.kind !== 'resort') tell(id, { resources: [{ ...r, fee, note }], kind: 'booked' });
  return { ok: true, conflicts, messaged: !!r.phone };
});
route('PUT', '/api/shoots/(\\d+)/resources/(\\d+)', async (c) => {
  need(c.u, 'admin', 'photographer'); const b = await c.body();
  const cur = q1('SELECT * FROM shoot_resources WHERE shoot_id = ? AND resource_id = ?', +c.m[1], +c.m[2]); if (!cur) throw new HttpError(404, 'Not booked');
  run('UPDATE shoot_resources SET status = ?, fee = ?, note = ? WHERE shoot_id = ? AND resource_id = ?', oneOf(b.status ?? cur.status, ['requested', 'confirmed', 'declined'], 'status'), b.fee === undefined ? cur.fee : str(b.fee, 60), b.note === undefined ? cur.note : str(b.note, 300), +c.m[1], +c.m[2]);
  return { ok: true };
});
route('POST', '/api/resources', async (c) => {
  need(c.u, 'admin', 'photographer'); const r = resInput(await c.body());
  return { id: Number(run('INSERT INTO resources (kind, name, city, phone, email, link, maps, category, style, rating, charge, distance, notes, created) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', r.kind, r.name, r.city, r.phone, r.email, r.link, r.maps, r.category, r.style, r.rating, r.charge, r.distance, r.notes, now()).lastInsertRowid) };
});
route('PUT', '/api/resources/(\\d+)', async (c) => {
  need(c.u, 'admin', 'photographer'); const cur = q1('SELECT * FROM resources WHERE id = ?', +c.m[1]); if (!cur) throw new HttpError(404, 'Not found');
  const r = resInput(await c.body(), cur);
  run('UPDATE resources SET kind=?, name=?, city=?, phone=?, email=?, link=?, maps=?, category=?, style=?, rating=?, charge=?, distance=?, notes=? WHERE id=?', r.kind, r.name, r.city, r.phone, r.email, r.link, r.maps, r.category, r.style, r.rating, r.charge, r.distance, r.notes, cur.id);
  return { ok: true };
});
route('DELETE', '/api/resources/(\\d+)', (c) => { need(c.u, 'admin'); run('DELETE FROM shoot_resources WHERE resource_id = ?', +c.m[1]); run('DELETE FROM resources WHERE id = ?', +c.m[1]); return { ok: true }; });
route('POST', '/api/resources/import', async (c) => {
  need(c.u, 'admin', 'photographer'); const b = await c.body();
  const kind = oneOf(b.kind, KINDS, 'type'); const text = String(b.csv || '').replace(/^﻿/, '');
  if (!text.trim()) throw bad('Paste or choose a CSV file first');
  db.exec('BEGIN'); try { const r = importRows(kind, parseCsv(text)); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
});

// day view + reports
const istDay = (ms) => new Date(ms + 5.5 * 3600e3).toISOString().slice(0, 10);
const dayRange = (d) => [Date.parse(d + 'T00:00:00+05:30'), Date.parse(d + 'T23:59:59.999+05:30')];
const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const weekStart = (d) => addDays(d, -((new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7)); // weeks start Monday
const bucketOf = (d, g) => g === 'month' ? d.slice(0, 7) : g === 'week' ? weekStart(d) : d;

route('GET', '/api/day', (c) => {
  const date = c.url.searchParams.get('date') || today(); if (!isDate(date)) throw bad('Invalid date');
  const [a, b] = dayRange(date);
  const shoots = q('SELECT * FROM shoots WHERE shoot_date = ? ORDER BY start_time, id', date).map(shootOut);
  for (const s of shoots) {
    s.plan = q('SELECT at_time, text FROM shoot_plan WHERE shoot_id = ? ORDER BY id', s.id);
    s.models = q('SELECT name, portfolio FROM shoot_models WHERE shoot_id = ? ORDER BY id', s.id);
  }
  const done = q('SELECT type, COUNT(*) n FROM deliverables WHERE done = 1 AND done_at BETWEEN ? AND ? GROUP BY type', a, b);
  return {
    date, shoots,
    posts: q('SELECT * FROM posts WHERE post_date = ? ORDER BY post_time, id', date).map(postOut),
    photos_uploaded: q1('SELECT COUNT(*) n FROM photos WHERE created BETWEEN ? AND ?', a, b).n,
    reels_done: done.find(r => r.type === 'reel')?.n || 0, statics_done: done.find(r => r.type === 'static')?.n || 0,
  };
});

route('GET', '/api/stats', (c) => {
  need(c.u, 'admin');
  const g = oneOf(c.url.searchParams.get('group') || 'day', ['day', 'week', 'month'], 'group');
  // default range ends at the end of the current day-window / week / month so planned items show up
  const t0 = today(), monthEnd = addDays(addDays(t0.slice(0, 7) + '-01', 32).slice(0, 7) + '-01', -1);
  const to = c.url.searchParams.get('to') || (g === 'day' ? addDays(t0, 6) : g === 'week' ? addDays(weekStart(t0), 6) : monthEnd);
  const from = c.url.searchParams.get('from') || addDays(to, g === 'day' ? -29 : g === 'week' ? -83 : -364);
  if (!isDate(from) || !isDate(to) || from > to) throw bad('Invalid date range');
  if (Date.parse(to) - Date.parse(from) > 400 * 864e5) throw bad('Range too long (max 400 days)');
  const [fa] = dayRange(from), [, tb] = dayRange(to);
  const rows = new Map();
  const blank = () => ({ shoots: 0, shoots_done: 0, shoots_cancelled: 0, photos_uploaded: 0, photos_approved: 0, posts_planned: 0, posts_posted: 0, reels_done: 0, statics_done: 0 });
  for (let d = from; d <= to; d = addDays(d, 1)) { const k = bucketOf(d, g); if (!rows.has(k)) rows.set(k, blank()); }
  const at = (d) => rows.get(bucketOf(d, g));
  const people = new Map();
  const person = (id) => { if (!people.has(id)) people.set(id, { photos_uploaded: 0, shoots_assigned: 0, shoots_going: 0, posts_created: 0, reels_done: 0, statics_done: 0 }); return people.get(id); };

  for (const s of q('SELECT id, shoot_date d, status FROM shoots WHERE shoot_date BETWEEN ? AND ?', from, to)) {
    const r = at(s.d); r.shoots++; if (s.status === 'done') r.shoots_done++; if (s.status === 'cancelled') r.shoots_cancelled++;
    if (s.status !== 'cancelled') for (const m of q('SELECT user_id, response FROM shoot_members WHERE shoot_id = ?', s.id)) { const p = person(m.user_id); p.shoots_assigned++; if (m.response === 'going') p.shoots_going++; }
  }
  for (const p of q('SELECT created, status, uploaded_by FROM photos WHERE created BETWEEN ? AND ?', fa, tb)) {
    const r = at(istDay(p.created)); r.photos_uploaded++; if (p.status === 'approved') r.photos_approved++; if (p.uploaded_by) person(p.uploaded_by).photos_uploaded++;
  }
  for (const p of q('SELECT post_date d, status, created_by FROM posts WHERE post_date BETWEEN ? AND ?', from, to)) {
    const r = at(p.d); r.posts_planned++; if (p.status === 'posted') r.posts_posted++; if (p.created_by) person(p.created_by).posts_created++;
  }
  for (const x of q('SELECT type, done_at, done_by FROM deliverables WHERE done = 1 AND done_at BETWEEN ? AND ?', fa, tb)) {
    const k = x.type === 'reel' ? 'reels_done' : 'statics_done'; at(istDay(x.done_at))[k]++; if (x.done_by) person(x.done_by)[k]++;
  }
  const out = [...rows.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, v]) => ({ period, ...v }));
  const totals = blank(); for (const r of out) for (const k of Object.keys(totals)) totals[k] += r[k];
  const names = new Map(q('SELECT id, name, role FROM users').map(u => [u.id, u]));
  const by_person = [...people.entries()].map(([id, v]) => ({ name: names.get(id)?.name || 'Unknown', role: names.get(id)?.role || '', ...v }))
    .sort((a, b) => (b.photos_uploaded + b.reels_done + b.statics_done + b.posts_created) - (a.photos_uploaded + a.reels_done + a.statics_done + a.posts_created));
  return { group: g, from, to, rows: out, totals, by_person };
});

// dashboard
route('GET', '/api/dashboard', (c) => {
  const today_ = today();
  return {
    today: today_,
    upcoming_shoots: q(`SELECT id, title, shoot_date, start_time, location, status FROM shoots WHERE shoot_date >= ? AND status IN ('planned') ORDER BY shoot_date, start_time LIMIT 8`, today_),
    to_edit: q1(`SELECT COUNT(*) n FROM photos WHERE status = 'uploaded'`).n,
    to_approve: q1(`SELECT COUNT(*) n FROM photos WHERE status = 'edited'`).n,
    approved_unused: q1(`SELECT COUNT(*) n FROM photos WHERE status = 'approved' AND id NOT IN (SELECT photo_id FROM post_photos)`).n,
    upcoming_posts: q(`SELECT id, title, platform, post_date, post_time, status FROM posts WHERE post_date >= ? AND status != 'posted' ORDER BY post_date, post_time LIMIT 8`, today_),
    overdue_posts: q(`SELECT id, title, platform, post_date, status FROM posts WHERE post_date < ? AND status IN ('idea','draft','scheduled') ORDER BY post_date LIMIT 8`, today_),
  };
});

// ---------- http ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' };

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...SEC });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const pathname = url.pathname;
  try {
    if (pathname.startsWith('/api/') || pathname.startsWith('/files/')) {
      // CSRF: state-changing requests must come from our own origin
      if (req.method !== 'GET') {
        const o = req.headers.origin;
        if (o && new URL(o).host !== req.headers.host) throw new HttpError(403, 'Bad origin');
      }
      const u = userFor(req);
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = pathname.match(r.re); if (!m) continue;
        if (r.auth && !u) throw new HttpError(401, 'Please log in');
        const c = { u, m, url, req, res, body: () => readJson(req) };
        const out = await r.fn(c);
        if (out === null) return; // handler streamed response itself
        return sendJson(res, 200, out);
      }
      throw new HttpError(404, 'Not found');
    }
    const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
    const full = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!full.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(full) || !fs.statSync(full).isFile()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...SEC });
    fs.createReadStream(full).pipe(res);
  } catch (e) {
    if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message });
    console.error(e); sendJson(res, 500, { error: 'Server error' });
  }
});
server.listen(PORT, process.env.HOST || '0.0.0.0', () => console.log(`Studio app running on http://localhost:${PORT}  (photo storage: ${storage.kind === 'drive' ? 'Google Drive' : 'local disk'})`));
