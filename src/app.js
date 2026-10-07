// Ruchi Food Products – API core. Runs on Node and on Cloudflare Workers (standard Request/Response).
// createHandler({ db, env }) -> async (Request) => Response   for paths under /api/

const enc = new TextEncoder();
const dec = new TextDecoder();

// ---------- tiny utils ----------
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (m) => new HttpError(400, m);
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

const hex = (u) => [...u].map(b => b.toString(16).padStart(2, '0')).join('');
const b64u = (u) => btoa(String.fromCharCode(...u)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
async function hmac(key, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
}
function safeEq(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const randHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));

const num = (v, name, min = 0) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min) throw bad(`Invalid ${name}`);
  return n;
};
const validDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d : (() => { throw bad('Invalid date'); })();
const validMonth = (m) => /^\d{4}-\d{2}$/.test(m || '') ? m : (() => { throw bad('Invalid month'); })();

// ---------- dates (India time) ----------
const IST_OFFSET_MS = 5.5 * 3600 * 1000;
const istNow = () => new Date(Date.now() + IST_OFFSET_MS);
const ymd = (d) => d.toISOString().slice(0, 10);
const todayIST = () => ymd(istNow());
const tomorrowIST = () => ymd(new Date(istNow().getTime() + 86400000));
const addDays = (d, n) => ymd(new Date(new Date(d + 'T00:00:00Z').getTime() + n * 86400000));
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (d) => { const x = new Date(d + 'T00:00:00Z'); return `${WD[x.getUTCDay()]}, ${x.getUTCDate()} ${MN[x.getUTCMonth()]}`; };

let secretCache = null; // never changes once created

export function createHandler({ db, env }) {
  // ---------- settings ----------
  const getSetting = async (k, def) => (await db.get('SELECT value FROM settings WHERE key=?', k))?.value ?? def;
  const setSetting = (k, v) => db.run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, String(v));
  const cutoff = () => getSetting('cutoff', '20:00');
  const weeklyOff = async () => (await getSetting('weekly_off', '')).split(',').filter(x => x !== '').map(Number);

  async function getSecret() {
    if (env.APP_SECRET) return env.APP_SECRET;
    if (secretCache) return secretCache;
    await db.run('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)', 'secret', randHex(32));
    return (secretCache = await getSetting('secret'));
  }

  // Why a date has no production/delivery (holiday or weekly off), or null on a normal day.
  async function offReason(d, wo) {
    const h = await db.get('SELECT note FROM holidays WHERE date=?', d);
    if (h) return h.note || 'Holiday';
    return (wo ?? await weeklyOff()).includes(new Date(d + 'T00:00:00Z').getUTCDay()) ? 'Weekly off' : null;
  }
  // The delivery date shops order for: tomorrow, skipping holidays / weekly off days.
  async function orderDate() {
    const wo = await weeklyOff();
    let d = tomorrowIST();
    for (let i = 0; i < 60 && await offReason(d, wo); i++) d = addDays(d, 1);
    return d;
  }
  // Orders for a date close at the cut-off time on the day before it.
  async function isLocked(od) {
    return istNow().toISOString().slice(0, 16) >= addDays(od, -1) + 'T' + await cutoff();
  }
  async function notify(text) {
    await db.run('INSERT INTO notifications(ts,text) VALUES(?,?)', new Date().toISOString(), text);
    const url = env.NOTIFY_URL; // optional phone push, e.g. https://ntfy.sh/<your-secret-topic>
    if (url) { try { await fetch(url, { method: 'POST', body: text, headers: { Title: 'Ruchi Food Products' }, signal: AbortSignal.timeout(3000) }); } catch { /* alerts still stored */ } }
  }

  // ---------- passwords / tokens ----------
  // PINs and passwords are HMAC'd with a server-side secret (kept out of the database in production).
  async function hashPin(pin, salt = randHex(8)) { return salt + ':' + hex(await hmac(await getSecret(), salt + ':' + pin)); }
  async function checkPin(pin, stored) {
    if (!stored) return false;
    const [salt, h] = stored.split(':');
    return safeEq((await hashPin(String(pin), salt)).split(':')[1], h || '');
  }
  async function sign(payload) {
    const body = b64u(enc.encode(JSON.stringify({ ...payload, exp: Date.now() + 30 * 86400000 })));
    return body + '.' + b64u(await hmac(await getSecret(), body));
  }
  async function verify(token) {
    const [body, sig] = (token || '').split('.');
    if (!body || !sig) return null;
    if (!safeEq(b64u(await hmac(await getSecret(), body)), sig)) return null;
    try { const p = JSON.parse(dec.decode(unb64u(body))); return p.exp > Date.now() ? p : null; } catch { return null; }
  }
  async function auth(req, role) {
    const h = req.headers.get('authorization') || '';
    const p = await verify(h.startsWith('Bearer ') ? h.slice(7) : '');
    if (!p || p.role !== role) throw new HttpError(401, 'Not logged in');
    return p;
  }

  // login throttle (kept in the database so it works across Worker instances)
  const WINDOW = 10 * 60000;
  async function throttled(key) {
    const f = await db.get('SELECT count,t FROM login_fails WHERE key=?', key);
    return !!f && f.count >= 8 && Date.now() - f.t < WINDOW;
  }
  async function noteFail(key) {
    const f = await db.get('SELECT count,t FROM login_fails WHERE key=?', key);
    const count = f && Date.now() - f.t < WINDOW ? f.count + 1 : 1;
    await db.run('INSERT INTO login_fails(key,count,t) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count, t=excluded.t', key, count, Date.now());
  }
  const clearFails = (key) => db.run('DELETE FROM login_fails WHERE key=?', key);

  async function body(req) {
    const t = await req.text();
    if (t.length > 1e6) throw bad('Too large');
    if (!t) return {};
    try { return JSON.parse(t); } catch { throw bad('Invalid JSON'); }
  }

  async function saveOrder(shopId, date, items) {
    const prices = new Map((await db.all('SELECT id,price FROM products WHERE active=1')).map(p => [p.id, p.price]));
    const now = new Date().toISOString(), stmts = [];
    for (const it of items) {
      const pid = num(it.product_id, 'product'), q = Math.floor(num(it.qty, 'qty'));
      if (q > 100000) throw bad('Qty too large');
      if (!prices.has(pid)) continue;
      if (q === 0) stmts.push(['DELETE FROM orders WHERE shop_id=? AND product_id=? AND date=?', [shopId, pid, date]]);
      else stmts.push([`INSERT INTO orders(shop_id,product_id,date,qty,price,updated_at) VALUES(?,?,?,?,?,?)
        ON CONFLICT(shop_id,product_id,date) DO UPDATE SET qty=excluded.qty, price=excluded.price, updated_at=excluded.updated_at`, [shopId, pid, date, q, prices.get(pid), now]]);
    }
    if (stmts.length) await db.batch(stmts);
  }

  // price actually used for an order line: the saved price, or today's product price for "market price" lines
  const PRICE = 'CASE WHEN o.price>0 THEN o.price ELSE p.price END';

  async function monthData(month) {
    return db.all(`SELECT o.date, o.shop_id, s.name shop, o.product_id, p.name_en, p.name_ml, o.qty, ${PRICE} AS price
      FROM orders o JOIN shops s ON s.id=o.shop_id JOIN products p ON p.id=o.product_id WHERE o.date BETWEEN ? AND ? ORDER BY o.date`, month + '-01', month + '-31');
  }

  // ---------- routes ----------
  const routes = new Map();
  const route = (method, p, fn) => routes.set(method + ' ' + p, fn);

  route('GET', '/api/config', async () => { const od = await orderDate(); return { cutoff: await cutoff(), today: todayIST(), orderDate: od, locked: await isLocked(od) }; });

  // Shop
  route('POST', '/api/shop/login', async (req) => {
    const { phone, pin } = await body(req);
    const key = 'shop:' + phone;
    if (await throttled(key)) throw new HttpError(429, 'Too many attempts. Try later.');
    const s = await db.get('SELECT * FROM shops WHERE phone=? AND active=1', String(phone || '').trim());
    if (!s || !(await checkPin(pin || '', s.pin_hash))) { await noteFail(key); throw new HttpError(401, 'Wrong phone or PIN'); }
    await clearFails(key);
    return { token: await sign({ role: 'shop', id: s.id }), name: s.name };
  });

  route('GET', '/api/shop/order', async (req) => {
    const { id } = await auth(req, 'shop');
    const shop = await db.get('SELECT id,name FROM shops WHERE id=? AND active=1', id);
    if (!shop) throw new HttpError(401, 'Not logged in');
    const date = await orderDate();
    const skipped = date !== tomorrowIST() ? await offReason(tomorrowIST()) : null;
    const products = await db.all('SELECT id,name_en,name_ml,price FROM products WHERE active=1 ORDER BY sort,id');
    const qty = Object.fromEntries((await db.all('SELECT product_id,qty FROM orders WHERE shop_id=? AND date=?', id, date)).map(r => [r.product_id, r.qty]));
    return { shop, date, skipped, cutoff: await cutoff(), locked: await isLocked(date), products: products.map(p => ({ ...p, qty: qty[p.id] || 0 })) };
  });

  route('POST', '/api/shop/order', async (req) => {
    const { id } = await auth(req, 'shop');
    const date = await orderDate();
    if (await isLocked(date)) throw new HttpError(403, 'Order time is over');
    const { items } = await body(req);
    if (!Array.isArray(items)) throw bad('items required');
    const had = (await db.get('SELECT COUNT(*) c FROM orders WHERE shop_id=? AND date=?', id, date)).c > 0;
    await saveOrder(id, date, items);
    const lines = await db.all('SELECT p.name_en n, o.qty q FROM orders o JOIN products p ON p.id=o.product_id WHERE o.shop_id=? AND o.date=? ORDER BY p.sort,p.id', id, date);
    const shop = (await db.get('SELECT name FROM shops WHERE id=?', id)).name;
    if (lines.length) await notify(`${shop} ${had ? 'updated' : 'placed'} order for ${shortDate(date)}: ${lines.map(l => `${l.n} ${l.q}`).join(', ')}`);
    else if (had) await notify(`${shop} cancelled order for ${shortDate(date)}`);
    return { ok: true };
  });

  // Admin: login, password, settings
  route('POST', '/api/admin/login', async (req) => {
    const { password } = await body(req);
    if (await throttled('admin')) throw new HttpError(429, 'Too many attempts. Try later.');
    // first run: the admin password comes from ADMIN_PASSWORD (default "admin123" – change it in Settings)
    if (!(await getSetting('admin_hash', null))) await setSetting('admin_hash', await hashPin(env.ADMIN_PASSWORD || 'admin123'));
    if (!(await checkPin(password || '', await getSetting('admin_hash')))) { await noteFail('admin'); throw new HttpError(401, 'Wrong password'); }
    await clearFails('admin');
    return { token: await sign({ role: 'admin' }) };
  });
  route('POST', '/api/admin/password', async (req) => {
    await auth(req, 'admin');
    const { password } = await body(req);
    if (String(password || '').length < 6) throw bad('Min 6 characters');
    await setSetting('admin_hash', await hashPin(password));
    return { ok: true };
  });
  route('GET', '/api/admin/settings', async (req) => {
    await auth(req, 'admin');
    return { cutoff: await cutoff(), weeklyOff: await weeklyOff(), holidays: await db.all('SELECT date,note FROM holidays WHERE date>=? ORDER BY date', todayIST()), orderDate: await orderDate() };
  });
  route('POST', '/api/admin/settings', async (req) => {
    await auth(req, 'admin');
    const b = await body(req);
    if (b.cutoff !== undefined) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.cutoff || '')) throw bad('Time must be HH:MM (24h)');
      await setSetting('cutoff', b.cutoff);
    }
    if (b.weeklyOff !== undefined) {
      if (!Array.isArray(b.weeklyOff) || b.weeklyOff.some(n => !Number.isInteger(n) || n < 0 || n > 6)) throw bad('Invalid weekly off');
      await setSetting('weekly_off', b.weeklyOff.join(','));
    }
    return { ok: true };
  });
  route('POST', '/api/admin/holidays', async (req) => {
    await auth(req, 'admin');
    const b = await body(req);
    await db.run('INSERT INTO holidays(date,note) VALUES(?,?) ON CONFLICT(date) DO UPDATE SET note=excluded.note', validDate(b.date), String(b.note || '').trim().slice(0, 60));
    return { ok: true };
  });
  route('POST', '/api/admin/holidays/delete', async (req) => {
    await auth(req, 'admin');
    await db.run('DELETE FROM holidays WHERE date=?', validDate((await body(req)).date));
    return { ok: true };
  });

  // Products
  route('GET', '/api/admin/products', async (req) => { await auth(req, 'admin'); return db.all('SELECT * FROM products ORDER BY sort,id'); });
  route('POST', '/api/admin/products', async (req) => {
    await auth(req, 'admin');
    const b = await body(req);
    const name = String(b.name_en || '').trim(); if (!name) throw bad('English name required');
    const price = b.price === '' || b.price == null ? 0 : num(b.price, 'price'); // 0 = market price
    const ml = String(b.name_ml || '').trim();
    if (b.id) await db.run('UPDATE products SET name_en=?,name_ml=?,price=?,active=?,sort=? WHERE id=?', name, ml, price, b.active === 0 || b.active === false ? 0 : 1, Math.floor(num(b.sort || 0, 'sort', -1e6)), num(b.id, 'id'));
    else await db.run('INSERT INTO products(name_en,name_ml,price) VALUES(?,?,?)', name, ml, price);
    return { ok: true };
  });

  // Shops
  route('GET', '/api/admin/shops', async (req) => { await auth(req, 'admin'); return db.all('SELECT id,name,phone,active FROM shops ORDER BY name'); });
  route('POST', '/api/admin/shops', async (req) => {
    await auth(req, 'admin');
    const b = await body(req);
    const name = String(b.name || '').trim(), phone = String(b.phone || '').trim();
    if (!name || !/^\d{10}$/.test(phone)) throw bad('Name and 10-digit phone required');
    if (b.pin && !/^\d{4,6}$/.test(String(b.pin))) throw bad('PIN must be 4-6 digits');
    try {
      if (b.id) {
        const id = num(b.id, 'id');
        await db.run('UPDATE shops SET name=?,phone=?,active=? WHERE id=?', name, phone, b.active === 0 || b.active === false ? 0 : 1, id);
        if (b.pin) await db.run('UPDATE shops SET pin_hash=? WHERE id=?', await hashPin(String(b.pin)), id);
      } else {
        if (!b.pin) throw bad('PIN must be 4-6 digits');
        await db.run('INSERT INTO shops(name,phone,pin_hash) VALUES(?,?,?)', name, phone, await hashPin(String(b.pin)));
      }
    } catch (e) { if (/UNIQUE/.test(e.message)) throw bad('Phone already used'); throw e; }
    return { ok: true };
  });

  // Daily summary: totals per product + per-shop breakdown
  route('GET', '/api/admin/daily', async (req, url) => {
    await auth(req, 'admin');
    const date = validDate(url.searchParams.get('date') || await orderDate());
    const rows = await db.all(`SELECT o.shop_id, s.name shop, o.product_id, p.name_en, p.name_ml, o.qty, ${PRICE} AS price
      FROM orders o JOIN shops s ON s.id=o.shop_id JOIN products p ON p.id=o.product_id WHERE o.date=? ORDER BY s.name, p.sort, p.id`, date);
    const delivered = new Set((await db.all('SELECT shop_id FROM deliveries WHERE date=? AND delivered=1', date)).map(r => r.shop_id));
    const products = {}, shops = {};
    let total = 0;
    for (const r of rows) {
      const amt = r.qty * r.price; total += amt;
      (products[r.product_id] ||= { id: r.product_id, name_en: r.name_en, name_ml: r.name_ml, qty: 0, amount: 0 });
      products[r.product_id].qty += r.qty; products[r.product_id].amount += amt;
      (shops[r.shop_id] ||= { id: r.shop_id, name: r.shop, amount: 0, delivered: delivered.has(r.shop_id), items: [] });
      shops[r.shop_id].amount += amt; shops[r.shop_id].items.push({ product_id: r.product_id, name_en: r.name_en, name_ml: r.name_ml, qty: r.qty });
    }
    const notOrdered = await db.all('SELECT id,name,phone FROM shops WHERE active=1 AND id NOT IN (SELECT shop_id FROM orders WHERE date=?) ORDER BY name', date);
    return { date, off: await offReason(date), total, products: Object.values(products), shops: Object.values(shops), notOrdered };
  });

  route('POST', '/api/admin/order', async (req) => { // admin edits a shop's order
    await auth(req, 'admin');
    const b = await body(req);
    if (!Array.isArray(b.items)) throw bad('items required');
    await saveOrder(num(b.shop_id, 'shop'), validDate(b.date), b.items);
    return { ok: true };
  });

  // Delivery tracking
  route('POST', '/api/admin/delivered', async (req) => {
    await auth(req, 'admin');
    const b = await body(req);
    const date = validDate(b.date), flag = b.delivered === false || b.delivered === 0 ? 0 : 1;
    const ids = b.all ? (await db.all('SELECT DISTINCT shop_id FROM orders WHERE date=?', date)).map(r => r.shop_id) : [num(b.shop_id, 'shop')];
    if (ids.length) await db.batch(ids.map(id => ['INSERT INTO deliveries(shop_id,date,delivered) VALUES(?,?,?) ON CONFLICT(shop_id,date) DO UPDATE SET delivered=excluded.delivered', [id, date, flag]]));
    return { ok: true };
  });

  // Dues: delivered value minus payments received, per shop
  route('GET', '/api/admin/dues', async (req) => {
    await auth(req, 'admin');
    const billed = await db.all(`SELECT o.shop_id, SUM(o.qty * ${PRICE}) amount, SUM(CASE WHEN (${PRICE})=0 THEN 1 ELSE 0 END) unpriced
      FROM orders o JOIN products p ON p.id=o.product_id
      JOIN deliveries d ON d.shop_id=o.shop_id AND d.date=o.date AND d.delivered=1 GROUP BY o.shop_id`);
    const paid = await db.all('SELECT shop_id, SUM(amount) amount FROM payments GROUP BY shop_id');
    const b = Object.fromEntries(billed.map(r => [r.shop_id, r])), p = Object.fromEntries(paid.map(r => [r.shop_id, r.amount]));
    const shops = (await db.all('SELECT id,name,phone FROM shops ORDER BY name'))
      .map(s => ({ ...s, billed: b[s.id]?.amount || 0, unpriced: b[s.id]?.unpriced || 0, paid: p[s.id] || 0 }))
      .map(s => ({ ...s, balance: s.billed - s.paid }))
      .filter(s => s.billed || s.paid);
    const payments = await db.all('SELECT p.id,p.date,p.amount,p.note,s.name shop FROM payments p JOIN shops s ON s.id=p.shop_id ORDER BY p.date DESC,p.id DESC LIMIT 50');
    return { shops, payments, totalDue: shops.reduce((a, s) => a + s.balance, 0) };
  });
  route('POST', '/api/admin/payments', async (req) => {
    await auth(req, 'admin');
    const b = await body(req);
    const amount = num(b.amount, 'amount');
    if (!amount) throw bad('Enter an amount');
    const shop = num(b.shop_id, 'shop');
    if (!(await db.get('SELECT 1 x FROM shops WHERE id=?', shop))) throw bad('Unknown shop');
    await db.run('INSERT INTO payments(shop_id,date,amount,note) VALUES(?,?,?,?)', shop, validDate(b.date || todayIST()), amount, String(b.note || '').trim().slice(0, 80));
    return { ok: true };
  });
  route('POST', '/api/admin/payments/delete', async (req) => {
    await auth(req, 'admin');
    await db.run('DELETE FROM payments WHERE id=?', num((await body(req)).id, 'id'));
    return { ok: true };
  });

  // Order alerts
  route('GET', '/api/admin/notifications', async (req) => {
    await auth(req, 'admin');
    return { unseen: (await db.get('SELECT COUNT(*) c FROM notifications WHERE seen=0')).c, items: await db.all('SELECT id,ts,text,seen FROM notifications ORDER BY id DESC LIMIT 40') };
  });
  route('POST', '/api/admin/notifications/seen', async (req) => {
    await auth(req, 'admin');
    await db.run('UPDATE notifications SET seen=1 WHERE seen=0');
    return { ok: true };
  });

  // Monthly analysis
  route('GET', '/api/admin/monthly', async (req, url) => {
    await auth(req, 'admin');
    const month = validMonth(url.searchParams.get('month') || todayIST().slice(0, 7));
    const rows = await monthData(month);
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
    return { month, total, totalQty, orderDays: days.length, avgPerDay: days.length ? total / days.length : 0, shops, products: Object.values(byProduct).sort((a, b) => b.qty - a.qty), days };
  });
  route('GET', '/api/admin/export', async (req, url) => {
    await auth(req, 'admin');
    const month = validMonth(url.searchParams.get('month') || todayIST().slice(0, 7));
    const q = (v) => '"' + String(v).replace(/"/g, '""') + '"';
    const lines = ['Date,Shop,Product,Qty,Price,Amount'];
    for (const r of await monthData(month)) lines.push([r.date, q(r.shop), q(r.name_en), r.qty, r.price, r.qty * r.price].join(','));
    return { csv: lines.join('\n'), filename: `orders-${month}.csv` };
  });

  return async function handle(request) {
    const url = new URL(request.url);
    try {
      const fn = routes.get(request.method + ' ' + url.pathname);
      if (!fn) throw new HttpError(404, 'Not found');
      return json(await fn(request, url));
    } catch (e) {
      if (!(e instanceof HttpError)) console.error(e);
      return json({ error: e.status ? e.message : 'Server error' }, e.status || 500);
    }
  };
}
