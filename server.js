'use strict';
// Zero-dependency server: node:http + node:sqlite (Node >= 22.13)
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'orders.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS shops (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL UNIQUE,
    pin_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY, name_en TEXT NOT NULL, name_ml TEXT NOT NULL DEFAULT '',
    price REAL NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS orders (
    shop_id INTEGER NOT NULL, product_id INTEGER NOT NULL, date TEXT NOT NULL,
    qty INTEGER NOT NULL, price REAL NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY (shop_id, product_id, date)
  );
  CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(date);
  CREATE TABLE IF NOT EXISTS holidays (date TEXT PRIMARY KEY, note TEXT NOT NULL DEFAULT '');
  CREATE TABLE IF NOT EXISTS deliveries (
    shop_id INTEGER NOT NULL, date TEXT NOT NULL, delivered INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (shop_id, date)
  );
  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY, shop_id INTEGER NOT NULL, date TEXT NOT NULL,
    amount REAL NOT NULL, note TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY, ts TEXT NOT NULL, text TEXT NOT NULL, seen INTEGER NOT NULL DEFAULT 0
  );
`);

// ---------- helpers ----------
const IST_OFFSET_MS = 5.5 * 3600 * 1000;
const istNow = () => new Date(Date.now() + IST_OFFSET_MS);
const ymd = (d) => d.toISOString().slice(0, 10);
const todayIST = () => ymd(istNow());
const tomorrowIST = () => ymd(new Date(istNow().getTime() + 86400000));

function getSetting(k, def) {
  const r = db.prepare('SELECT value FROM settings WHERE key=?').get(k);
  return r ? r.value : def;
}
function setSetting(k, v) {
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v));
}
const cutoff = () => getSetting('cutoff', '20:00');
const addDays = (d, n) => ymd(new Date(new Date(d + 'T00:00:00Z').getTime() + n * 86400000));
const weeklyOff = () => getSetting('weekly_off', '').split(',').filter(x => x !== '').map(Number);
// Why a date has no production/delivery (holiday or weekly off), or null if it is a normal day.
function offReason(d) {
  const h = db.prepare('SELECT note FROM holidays WHERE date=?').get(d);
  if (h) return h.note || 'Holiday';
  return weeklyOff().includes(new Date(d + 'T00:00:00Z').getUTCDay()) ? 'Weekly off' : null;
}
// The delivery date shops are currently ordering for: tomorrow, skipping holidays / weekly off.
function orderDate() {
  let d = tomorrowIST();
  for (let i = 0; i < 60 && offReason(d); i++) d = addDays(d, 1);
  return d;
}
// Orders for a date close at the cut-off time on the day before it.
function isLocked(od) {
  return istNow().toISOString().slice(0, 16) >= addDays(od, -1) + 'T' + cutoff();
}
function notify(text) {
  db.prepare('INSERT INTO notifications(ts,text) VALUES(?,?)').run(new Date().toISOString(), text);
  const url = process.env.NOTIFY_URL; // optional push, e.g. https://ntfy.sh/<your-secret-topic>
  if (url) fetch(url, { method: 'POST', body: text, headers: { Title: 'Ruchi Food Products' } }).catch(() => {});
}

function hashPin(pin, salt = crypto.randomBytes(8).toString('hex')) {
  return salt + ':' + crypto.scryptSync(String(pin), salt, 32).toString('hex');
}
function checkPin(pin, stored) {
  const [salt, h] = stored.split(':');
  const a = Buffer.from(hashPin(pin, salt).split(':')[1], 'hex');
  const b = Buffer.from(h, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Admin password: ADMIN_PASSWORD env var, else stored (default "admin123" - change it in the app).
if (!getSetting('admin_hash', null)) setSetting('admin_hash', hashPin(process.env.ADMIN_PASSWORD || 'admin123'));

let secret = getSetting('secret', null);
if (!secret) { secret = crypto.randomBytes(32).toString('hex'); setSetting('secret', secret); }

function sign(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 30 * 86400000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return body + '.' + sig;
}
function verify(token) {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const exp = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (sig.length !== exp.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp))) return null;
  const p = JSON.parse(Buffer.from(body, 'base64url').toString());
  return p.exp > Date.now() ? p : null;
}

// simple login throttle
const fails = new Map();
function throttled(key) {
  const f = fails.get(key);
  return f && f.count >= 8 && Date.now() - f.t < 10 * 60000;
}
function noteFail(key) {
  const f = fails.get(key);
  fails.set(key, { count: (f && Date.now() - f.t < 10 * 60000 ? f.count : 0) + 1, t: Date.now() });
}

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (m) => new HttpError(400, m);

const send = (res, status, obj, headers = {}) => {
  const body = typeof obj === 'string' ? obj : JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': typeof obj === 'string' ? 'text/plain; charset=utf-8' : 'application/json', ...headers });
  res.end(body);
};
async function readJson(req) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > 1e6) throw bad('Too large'); chunks.push(c); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw bad('Invalid JSON'); }
}
const auth = (req, role) => {
  const h = req.headers.authorization || '';
  const p = verify(h.startsWith('Bearer ') ? h.slice(7) : '');
  if (!p || p.role !== role) throw new HttpError(401, 'Not logged in');
  return p;
};
const num = (v, name, min = 0) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min) throw bad(`Invalid ${name}`);
  return n;
};
const validDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d : (() => { throw bad('Invalid date'); })();
const validMonth = (m) => /^\d{4}-\d{2}$/.test(m || '') ? m : (() => { throw bad('Invalid month'); })();

// ---------- routes ----------
const routes = [];
const route = (method, p, fn) => routes.push({ method, p, fn });

route('GET', '/api/config', () => { const od = orderDate(); return { cutoff: cutoff(), today: todayIST(), orderDate: od, locked: isLocked(od) }; });

// Shop
route('POST', '/api/shop/login', async (req) => {
  const { phone, pin } = await readJson(req);
  const key = 'shop:' + phone;
  if (throttled(key)) throw new HttpError(429, 'Too many attempts. Try later.');
  const s = db.prepare('SELECT * FROM shops WHERE phone=? AND active=1').get(String(phone || '').trim());
  if (!s || !checkPin(pin || '', s.pin_hash)) { noteFail(key); throw new HttpError(401, 'Wrong phone or PIN'); }
  return { token: sign({ role: 'shop', id: s.id }), name: s.name };
});

route('GET', '/api/shop/order', (req) => {
  const { id } = auth(req, 'shop');
  const shop = db.prepare('SELECT id,name FROM shops WHERE id=? AND active=1').get(id);
  if (!shop) throw new HttpError(401, 'Not logged in');
  const date = orderDate();
  const skipped = date !== tomorrowIST() ? offReason(tomorrowIST()) : null;
  const products = db.prepare('SELECT id,name_en,name_ml,price FROM products WHERE active=1 ORDER BY sort,id').all();
  const qty = Object.fromEntries(db.prepare('SELECT product_id,qty FROM orders WHERE shop_id=? AND date=?').all(id, date).map(r => [r.product_id, r.qty]));
  return { shop, date, skipped, cutoff: cutoff(), locked: isLocked(date), products: products.map(p => ({ ...p, qty: qty[p.id] || 0 })) };
});

route('POST', '/api/shop/order', async (req) => {
  const { id } = auth(req, 'shop');
  const date = orderDate();
  if (isLocked(date)) throw new HttpError(403, 'Order time is over');
  const { items } = await readJson(req);
  if (!Array.isArray(items)) throw bad('items required');
  const count = () => db.prepare('SELECT COUNT(*) c FROM orders WHERE shop_id=? AND date=?').get(id, date).c;
  const had = count() > 0;
  saveOrder(id, date, items);
  const lines = db.prepare('SELECT p.name_en n, o.qty q FROM orders o JOIN products p ON p.id=o.product_id WHERE o.shop_id=? AND o.date=? ORDER BY p.sort,p.id').all(id, date);
  const shop = db.prepare('SELECT name FROM shops WHERE id=?').get(id).name;
  const when = new Date(date + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  if (lines.length) notify(`${shop} ${had ? 'updated' : 'placed'} order for ${when}: ${lines.map(l => `${l.n} ${l.q}`).join(', ')}`);
  else if (had) notify(`${shop} cancelled order for ${when}`);
  return { ok: true };
});

function saveOrder(shopId, date, items) {
  const get = db.prepare('SELECT price FROM products WHERE id=? AND active=1');
  const up = db.prepare(`INSERT INTO orders(shop_id,product_id,date,qty,price,updated_at) VALUES(?,?,?,?,?,?)
    ON CONFLICT(shop_id,product_id,date) DO UPDATE SET qty=excluded.qty, price=excluded.price, updated_at=excluded.updated_at`);
  const del = db.prepare('DELETE FROM orders WHERE shop_id=? AND product_id=? AND date=?');
  db.exec('BEGIN');
  try {
    for (const it of items) {
      const pid = num(it.product_id, 'product'); const q = Math.floor(num(it.qty, 'qty'));
      if (q > 100000) throw bad('Qty too large');
      const p = get.get(pid);
      if (!p) continue;
      if (q === 0) del.run(shopId, pid, date); else up.run(shopId, pid, date, q, p.price, new Date().toISOString());
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// Admin
route('POST', '/api/admin/login', async (req) => {
  const { password } = await readJson(req);
  if (throttled('admin')) throw new HttpError(429, 'Too many attempts. Try later.');
  if (!checkPin(password || '', getSetting('admin_hash'))) { noteFail('admin'); throw new HttpError(401, 'Wrong password'); }
  return { token: sign({ role: 'admin' }) };
});
route('POST', '/api/admin/password', async (req) => {
  auth(req, 'admin');
  const { password } = await readJson(req);
  if (String(password || '').length < 6) throw bad('Min 6 characters');
  setSetting('admin_hash', hashPin(password));
  return { ok: true };
});
route('GET', '/api/admin/settings', (req) => {
  auth(req, 'admin');
  return { cutoff: cutoff(), weeklyOff: weeklyOff(), holidays: db.prepare('SELECT date,note FROM holidays WHERE date>=? ORDER BY date').all(todayIST()), orderDate: orderDate() };
});
route('POST', '/api/admin/settings', async (req) => {
  auth(req, 'admin');
  const b = await readJson(req);
  if (b.cutoff !== undefined) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.cutoff || '')) throw bad('Time must be HH:MM (24h)');
    setSetting('cutoff', b.cutoff);
  }
  if (b.weeklyOff !== undefined) {
    if (!Array.isArray(b.weeklyOff) || b.weeklyOff.some(n => !Number.isInteger(n) || n < 0 || n > 6)) throw bad('Invalid weekly off');
    setSetting('weekly_off', b.weeklyOff.join(','));
  }
  return { ok: true };
});
route('POST', '/api/admin/holidays', async (req) => {
  auth(req, 'admin');
  const b = await readJson(req);
  db.prepare('INSERT INTO holidays(date,note) VALUES(?,?) ON CONFLICT(date) DO UPDATE SET note=excluded.note').run(validDate(b.date), String(b.note || '').trim().slice(0, 60));
  return { ok: true };
});
route('POST', '/api/admin/holidays/delete', async (req) => {
  auth(req, 'admin');
  db.prepare('DELETE FROM holidays WHERE date=?').run(validDate((await readJson(req)).date));
  return { ok: true };
});

// Products
route('GET', '/api/admin/products', (req) => { auth(req, 'admin'); return db.prepare('SELECT * FROM products ORDER BY sort,id').all(); });
route('POST', '/api/admin/products', async (req) => {
  auth(req, 'admin');
  const b = await readJson(req);
  const name = String(b.name_en || '').trim(); if (!name) throw bad('English name required');
  const price = b.price === '' || b.price == null ? 0 : num(b.price, 'price'); // 0 = market price
  if (b.id) {
    db.prepare('UPDATE products SET name_en=?,name_ml=?,price=?,active=?,sort=? WHERE id=?')
      .run(name, String(b.name_ml || '').trim(), price, b.active === 0 || b.active === false ? 0 : 1, Math.floor(num(b.sort || 0, 'sort', -1e6)), num(b.id, 'id'));
  } else {
    db.prepare('INSERT INTO products(name_en,name_ml,price) VALUES(?,?,?)').run(name, String(b.name_ml || '').trim(), price);
  }
  return { ok: true };
});

// Shops
route('GET', '/api/admin/shops', (req) => { auth(req, 'admin'); return db.prepare('SELECT id,name,phone,active FROM shops ORDER BY name').all(); });
route('POST', '/api/admin/shops', async (req) => {
  auth(req, 'admin');
  const b = await readJson(req);
  const name = String(b.name || '').trim(); const phone = String(b.phone || '').trim();
  if (!name || !/^\d{10}$/.test(phone)) throw bad('Name and 10-digit phone required');
  try {
    if (b.id) {
      db.prepare('UPDATE shops SET name=?,phone=?,active=? WHERE id=?').run(name, phone, b.active === 0 || b.active === false ? 0 : 1, num(b.id, 'id'));
      if (b.pin) { if (!/^\d{4,6}$/.test(String(b.pin))) throw bad('PIN must be 4-6 digits'); db.prepare('UPDATE shops SET pin_hash=? WHERE id=?').run(hashPin(b.pin), b.id); }
    } else {
      if (!/^\d{4,6}$/.test(String(b.pin || ''))) throw bad('PIN must be 4-6 digits');
      db.prepare('INSERT INTO shops(name,phone,pin_hash) VALUES(?,?,?)').run(name, phone, hashPin(b.pin));
    }
  } catch (e) { if (/UNIQUE/.test(e.message)) throw bad('Phone already used'); throw e; }
  return { ok: true };
});

// Daily summary: totals per product + per-shop matrix
route('GET', '/api/admin/daily', (req, url) => {
  auth(req, 'admin');
  const date = validDate(url.searchParams.get('date') || orderDate());
  const rows = db.prepare(`SELECT o.shop_id, s.name shop, o.product_id, p.name_en, p.name_ml, o.qty, CASE WHEN o.price>0 THEN o.price ELSE p.price END AS price
    FROM orders o JOIN shops s ON s.id=o.shop_id JOIN products p ON p.id=o.product_id WHERE o.date=? ORDER BY s.name, p.sort, p.id`).all(date);
  const delivered = new Set(db.prepare('SELECT shop_id FROM deliveries WHERE date=? AND delivered=1').all(date).map(r => r.shop_id));
  const products = {}, shops = {};
  let total = 0;
  for (const r of rows) {
    const amt = r.qty * r.price; total += amt;
    (products[r.product_id] ||= { id: r.product_id, name_en: r.name_en, name_ml: r.name_ml, qty: 0, amount: 0 });
    products[r.product_id].qty += r.qty; products[r.product_id].amount += amt;
    (shops[r.shop_id] ||= { id: r.shop_id, name: r.shop, amount: 0, delivered: delivered.has(r.shop_id), items: [] });
    shops[r.shop_id].amount += amt; shops[r.shop_id].items.push({ product_id: r.product_id, name_en: r.name_en, name_ml: r.name_ml, qty: r.qty });
  }
  const notOrdered = db.prepare(`SELECT id,name,phone FROM shops WHERE active=1 AND id NOT IN (SELECT shop_id FROM orders WHERE date=?) ORDER BY name`).all(date);
  return { date, off: offReason(date), total, products: Object.values(products), shops: Object.values(shops), notOrdered };
});

// Admin edits a shop's order for a date
route('POST', '/api/admin/order', async (req) => {
  auth(req, 'admin');
  const b = await readJson(req);
  if (!Array.isArray(b.items)) throw bad('items required');
  saveOrder(num(b.shop_id, 'shop'), validDate(b.date), b.items);
  return { ok: true };
});

// Delivery tracking
route('POST', '/api/admin/delivered', async (req) => {
  auth(req, 'admin');
  const b = await readJson(req);
  const date = validDate(b.date), flag = b.delivered === false || b.delivered === 0 ? 0 : 1;
  const ids = b.all ? db.prepare('SELECT DISTINCT shop_id FROM orders WHERE date=?').all(date).map(r => r.shop_id) : [num(b.shop_id, 'shop')];
  const up = db.prepare('INSERT INTO deliveries(shop_id,date,delivered) VALUES(?,?,?) ON CONFLICT(shop_id,date) DO UPDATE SET delivered=excluded.delivered');
  for (const id of ids) up.run(id, date, flag);
  return { ok: true };
});

// Dues: delivered value - payments received, per shop
route('GET', '/api/admin/dues', (req) => {
  auth(req, 'admin');
  const billed = db.prepare(`SELECT o.shop_id, SUM(o.qty * CASE WHEN o.price>0 THEN o.price ELSE p.price END) amount,
      SUM(CASE WHEN (CASE WHEN o.price>0 THEN o.price ELSE p.price END)=0 THEN 1 ELSE 0 END) unpriced
    FROM orders o JOIN products p ON p.id=o.product_id
    JOIN deliveries d ON d.shop_id=o.shop_id AND d.date=o.date AND d.delivered=1 GROUP BY o.shop_id`).all();
  const paid = db.prepare('SELECT shop_id, SUM(amount) amount FROM payments GROUP BY shop_id').all();
  const b = Object.fromEntries(billed.map(r => [r.shop_id, r])), p = Object.fromEntries(paid.map(r => [r.shop_id, r.amount]));
  const shops = db.prepare('SELECT id,name,phone FROM shops ORDER BY name').all()
    .map(s => ({ ...s, billed: b[s.id]?.amount || 0, unpriced: b[s.id]?.unpriced || 0, paid: p[s.id] || 0 }))
    .map(s => ({ ...s, balance: s.billed - s.paid }))
    .filter(s => s.billed || s.paid);
  const payments = db.prepare('SELECT p.id,p.date,p.amount,p.note,s.name shop FROM payments p JOIN shops s ON s.id=p.shop_id ORDER BY p.date DESC,p.id DESC LIMIT 50').all();
  return { shops, payments, totalDue: shops.reduce((a, s) => a + s.balance, 0) };
});
route('POST', '/api/admin/payments', async (req) => {
  auth(req, 'admin');
  const b = await readJson(req);
  const amount = num(b.amount, 'amount');
  if (!amount) throw bad('Enter an amount');
  const shop = num(b.shop_id, 'shop');
  if (!db.prepare('SELECT 1 FROM shops WHERE id=?').get(shop)) throw bad('Unknown shop');
  db.prepare('INSERT INTO payments(shop_id,date,amount,note) VALUES(?,?,?,?)').run(shop, validDate(b.date || todayIST()), amount, String(b.note || '').trim().slice(0, 80));
  return { ok: true };
});
route('POST', '/api/admin/payments/delete', async (req) => {
  auth(req, 'admin');
  db.prepare('DELETE FROM payments WHERE id=?').run(num((await readJson(req)).id, 'id'));
  return { ok: true };
});

// Order alerts
route('GET', '/api/admin/notifications', (req) => {
  auth(req, 'admin');
  return { unseen: db.prepare('SELECT COUNT(*) c FROM notifications WHERE seen=0').get().c, items: db.prepare('SELECT id,ts,text,seen FROM notifications ORDER BY id DESC LIMIT 40').all() };
});
route('POST', '/api/admin/notifications/seen', (req) => {
  auth(req, 'admin');
  db.prepare('UPDATE notifications SET seen=1 WHERE seen=0').run();
  return { ok: true };
});

// Monthly analysis
function monthData(month) {
  const from = month + '-01', to = month + '-31';
  const rows = db.prepare(`SELECT o.date, o.shop_id, s.name shop, o.product_id, p.name_en, p.name_ml, o.qty, CASE WHEN o.price>0 THEN o.price ELSE p.price END AS price
    FROM orders o JOIN shops s ON s.id=o.shop_id JOIN products p ON p.id=o.product_id WHERE o.date BETWEEN ? AND ? ORDER BY o.date`).all(from, to);
  return rows;
}
route('GET', '/api/admin/monthly', (req, url) => {
  auth(req, 'admin');
  const month = validMonth(url.searchParams.get('month') || todayIST().slice(0, 7));
  const rows = monthData(month);
  const byShop = {}, byProduct = {}, byDay = {};
  let total = 0, totalQty = 0;
  for (const r of rows) {
    const amt = r.qty * r.price; total += amt; totalQty += r.qty;
    const s = (byShop[r.shop_id] ||= { id: r.shop_id, name: r.shop, qty: 0, amount: 0, days: new Set() });
    s.qty += r.qty; s.amount += amt; s.days.add(r.date);
    const p = (byProduct[r.product_id] ||= { id: r.product_id, name_en: r.name_en, name_ml: r.name_ml, qty: 0, amount: 0 });
    p.qty += r.qty; p.amount += amt;
    const d = (byDay[r.date] ||= { date: r.date, qty: 0, amount: 0 });
    d.qty += r.qty; d.amount += amt;
  }
  const shops = Object.values(byShop).map(s => ({ ...s, days: s.days.size })).sort((a, b) => b.amount - a.amount);
  const days = Object.values(byDay);
  return {
    month, total, totalQty, orderDays: days.length, avgPerDay: days.length ? total / days.length : 0,
    shops, products: Object.values(byProduct).sort((a, b) => b.qty - a.qty), days,
  };
});
route('GET', '/api/admin/export', (req, url) => {
  auth(req, 'admin');
  const month = validMonth(url.searchParams.get('month') || todayIST().slice(0, 7));
  const q = (v) => '"' + String(v).replace(/"/g, '""') + '"';
  const lines = ['Date,Shop,Product,Qty,Price,Amount'];
  for (const r of monthData(month)) lines.push([r.date, q(r.shop), q(r.name_en), r.qty, r.price, r.qty * r.price].join(','));
  return { csv: lines.join('\n'), filename: `orders-${month}.csv` };
});

// ---------- server ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const PAGES = { '/': 'index.html', '/admin': 'admin.html' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) {
      const r = routes.find(r => r.method === req.method && r.p === url.pathname);
      if (!r) throw new HttpError(404, 'Not found');
      const out = await r.fn(req, url);
      return send(res, 200, out, { 'Cache-Control': 'no-store' });
    }
    const file = PAGES[url.pathname] || url.pathname.slice(1);
    const full = path.normalize(path.join(PUBLIC_DIR, file));
    if (!full.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(full) || !fs.statSync(full).isFile()) return send(res, 404, 'Not found');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(full).pipe(res);
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    send(res, e.status || 500, { error: e.status ? e.message : 'Server error' });
  }
});
server.listen(PORT, process.env.HOST || '0.0.0.0', () => console.log(`Ruchi Food Products running on http://localhost:${PORT}  (admin: /admin)`));
