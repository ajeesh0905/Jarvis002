'use strict';
const $app = document.getElementById('app');
let me = null, users = [];
const ROLE_LABEL = { admin: 'Admin', photographer: 'Photographer', social: 'Social media' };
const PLATFORMS = ['instagram', 'facebook', 'youtube', 'tiktok', 'x', 'linkedin', 'whatsapp', 'other'];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const canShoot = () => me.role === 'admin' || me.role === 'photographer';
const canPost = () => me.role === 'admin' || me.role === 'social';

// tiny DOM helper: h('div', {class:'x', onclick:fn}, 'text', child...) — text is never parsed as HTML
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(k));
  return el;
}
async function api(method, url, body, raw) {
  const r = await fetch(url, { method, headers: raw ? {} : { 'Content-Type': 'application/json' }, body: raw || (body ? JSON.stringify(body) : undefined) });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && me) { me = null; render(); }
  if (!r.ok) throw new Error(j.error || 'Something went wrong');
  return j;
}
function toast(msg) { const t = h('div', { class: 'toast' }, msg); document.body.append(t); setTimeout(() => t.remove(), 2200); }
async function guard(fn) { try { return await fn(); } catch (e) { toast(e.message); } }
const badge = (s) => h('span', { class: 'badge b-' + s }, cap(s));
const fmtDate = (d) => new Date(d + 'T00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const field = (label, input) => h('div', {}, h('label', {}, label), input);

// ---------- shell ----------
function shell(active, ...content) {
  const tabs = [['#/', 'Home'], ['#/shoots', 'Shoots'], ...(canShoot() ? [['#/directory', 'Directory']] : []), ['#/posts', 'Posts'], ['#/board', 'Board'], me.role === 'admin' ? ['#/admin', 'Admin'] : ['#/me', 'Me']];
  return h('div', {}, h('main', {}, ...content), h('nav', {}, tabs.map(([href, t]) => h('a', { href, class: active === href ? 'on' : '' }, t))));
}
async function render() {
  const hash = location.hash || '#/';
  if (!me) {
    try { me = await api('GET', '/api/me'); } catch { return $app.replaceChildren(loginView()); }
  }
  if (!users.length) users = await api('GET', '/api/users').catch(() => []);
  const [, a, b] = hash.match(/^#\/([^/]*)\/?(.*)$/) || [];
  try {
    let v;
    if (!a) v = await dashboardView();
    else if (a === 'shoots') v = b === 'new' ? await shootForm() : b ? await shootView(parseInt(b, 10)) : await shootsView();
    else if (a === 'posts') v = b === 'new' ? await postForm() : b ? await postForm(+b) : await postsView();
    else if (a === 'team' && me.role === 'admin') v = await teamView();
    else if (a === 'directory') v = await directoryView(b);
    else if (a === 'board') v = await boardView(b);
    else if (a === 'day') v = await dayView(b);
    else if (a === 'admin' && me.role === 'admin') v = adminHub();
    else if (a === 'reports' && me.role === 'admin') v = await reportsView(b);
    else if (a === 'me') v = meView();
    else v = shell('', h('p', {}, 'Page not found'));
    $app.replaceChildren(v);
  } catch (e) { $app.replaceChildren(shell('', h('div', { class: 'err' }, e.message))); }
}
window.addEventListener('hashchange', render);

function loginView() {
  const err = h('div', { class: 'err' });
  const u = h('input', { placeholder: 'Username', autocomplete: 'username', autocapitalize: 'none' });
  const p = h('input', { placeholder: 'PIN', type: 'password', inputmode: 'numeric', autocomplete: 'current-password' });
  const go = async (e) => {
    e.preventDefault(); err.textContent = '';
    try { me = await api('POST', '/api/login', { username: u.value, pin: p.value }); users = []; render(); } catch (x) { err.textContent = x.message; }
  };
  return h('form', { class: 'login card', onsubmit: go }, h('h1', {}, '📷 Studio'), field('Username', u), field('PIN', p), err, h('button', { class: 'pri', style: 'width:100%;margin-top:8px' }, 'Log in'));
}

// ---------- dashboard ----------
async function dashboardView() {
  const d = await api('GET', '/api/dashboard');
  const stat = (n, label, href) => h('a', { href, class: 'card grow', style: 'text-align:center;color:inherit' }, h('div', { style: 'font-size:1.6rem;font-weight:700' }, n), h('div', { class: 'mute' }, label));
  const shootRow = (s) => h('a', { href: '#/shoots/' + s.id, class: 'card row spread', style: 'color:inherit' }, h('div', {}, h('b', {}, s.title), h('div', { class: 'mute' }, fmtDate(s.shoot_date), s.start_time && ' · ' + s.start_time, s.location && ' · ' + s.location)));
  const postRow = (p) => h('a', { href: '#/posts/' + p.id, class: 'card row spread', style: 'color:inherit' }, h('div', {}, h('b', {}, p.title), h('div', { class: 'mute' }, cap(p.platform), ' · ', fmtDate(p.post_date))), badge(p.status));
  const notes = await api('GET', '/api/notifications').catch(() => []);
  const unread = notes.filter(n => !n.read);
  const inbox = unread.length ? [h('h2', {}, `Messages (${unread.length} new)`), unread.map(n => h('a', { href: n.shoot_id ? '#/shoots/' + n.shoot_id : '#/', class: 'card', style: 'display:block;color:inherit;white-space:pre-wrap' }, n.text)),
    h('button', { onclick: () => guard(async () => { await api('POST', '/api/notifications/read'); render(); }) }, 'Mark all read')] : null;
  return shell('#/', h('div', { class: 'row spread' }, h('h1', {}, 'Hi ' + me.name), h('a', { class: 'btn', href: '#/day/' + d.today }, '📅 Day view')), inbox,
    h('div', { class: 'row' }, stat(d.to_edit, 'To edit', '#/shoots'), stat(d.to_approve, 'To approve', '#/shoots'), stat(d.approved_unused, 'Approved, not posted', '#/posts')),
    d.overdue_posts.length ? [h('h2', {}, 'Overdue posts'), d.overdue_posts.map(postRow)] : null,
    h('h2', {}, 'Upcoming shoots'), d.upcoming_shoots.length ? d.upcoming_shoots.map(shootRow) : h('p', { class: 'mute' }, 'No upcoming shoots.'),
    h('h2', {}, 'Upcoming posts'), d.upcoming_posts.length ? d.upcoming_posts.map(postRow) : h('p', { class: 'mute' }, 'Nothing planned.'));
}

// ---------- shoots ----------
async function shootsView() {
  const list = await api('GET', '/api/shoots'), t = today();
  const row = (s) => h('a', { href: '#/shoots/' + s.id, class: 'card', style: 'display:block;color:inherit' },
    h('div', { class: 'row spread' }, h('b', {}, s.title), badge(s.status)),
    h('div', { class: 'mute' }, fmtDate(s.shoot_date), s.start_time && ' · ' + s.start_time, s.location && ' · ' + s.location, s.client && ' · ' + s.client),
    h('div', { class: 'mute' }, `📷 ${s.photo_count} photos · ${s.approved_count} approved · ✅ ${s.shots_done}/${s.shots_total} shots`, s.members.length ? ' · ' + s.members.map(m => m.name).join(', ') : ''));
  const up = list.filter(s => s.shoot_date >= t).reverse(), past = list.filter(s => s.shoot_date < t);
  return shell('#/shoots', h('div', { class: 'row spread' }, h('h1', {}, 'Photo shoots'), canShoot() && h('a', { class: 'btn pri', href: '#/shoots/new' }, '+ New shoot')),
    h('h2', {}, 'Upcoming'), up.length ? up.map(row) : h('p', { class: 'mute' }, 'None.'), h('h2', {}, 'Past'), past.length ? past.map(row) : h('p', { class: 'mute' }, 'None.'));
}
const RSVP = { pending: '⏳ Waiting', going: '✅ Going', not_going: "❌ Can't go" };
const waLink = (phone, text) => 'https://wa.me/' + phone.replace(/\D/g, '') + (text ? '?text=' + encodeURIComponent(text) : '');
const shootText = (s) => `📷 ${s.title}\n📅 ${s.shoot_date}${s.start_time ? ' at ' + s.start_time : ''}\n📍 ${s.location || 'TBC'}`;
const safeHref = (u) => /^https?:\/\//i.test(u) ? u : '#';

async function shootForm(existing) {
  const exId = existing?.id || 0, dirFor = (d) => api('GET', `/api/resources?date=${d}&exclude=${exId}`).catch(() => []);
  const dir = await dirFor(existing?.shoot_date || today());
  const s = existing || { title: '', client: me.client, shoot_date: today(), start_time: '', location: '', notes: '', status: 'planned', location_link: '', members: [], models: [], plan: [], resources: [] };
  const f = {
    title: h('input', { value: s.title, maxlength: 120 }), client: h('input', { value: s.client }), date: h('input', { type: 'date', value: s.shoot_date }),
    time: h('input', { type: 'time', value: s.start_time }), loc: h('input', { value: s.location }), locLink: h('input', { value: s.location_link || '', placeholder: 'Map link (optional)' }), notes: h('textarea', {}),
    shots: h('textarea', { placeholder: 'One shot per line' }),
    models: h('textarea', { placeholder: 'One model per line:\nName | phone | portfolio link | note' }),
    plan: h('textarea', { placeholder: 'One step per line:\n08:30 Setup & lights\n10:00 Model look 1' }),
  };
  f.notes.value = s.notes;
  f.models.value = s.models.map(m => [m.name, m.phone, m.portfolio, m.note].join(' | ').replace(/( \| )+$/, '')).join('\n');
  f.plan.value = s.plan.map(i => (i.at_time ? i.at_time + ' ' : '') + i.text).join('\n');
  const places = dir.filter(r => r.kind === 'studio' || r.kind === 'resort');
  const placeSel = h('select', { onchange: (e) => { const r = places.find(p => p.id === +e.target.value); if (r) { f.loc.value = r.name + (r.city ? ', ' + r.city : ''); f.locLink.value = r.maps || ''; } } },
    h('option', { value: '' }, '— pick a studio / resort, or type below —'), ['studio', 'resort'].map(k => h('optgroup', { label: KIND_UI[k] }, places.filter(p => p.kind === k).map(p => h('option', { value: p.id }, p.name + (p.city ? ' · ' + p.city : '') + (p.distance ? ' · ' + p.distance : ''))))));
  const resIds = new Set((s.resources || []).map(r => r.id));
  let people = dir.filter(r => r.kind !== 'studio' && r.kind !== 'resort');
  let textFilter = '';
  const freeOnly = h('input', { type: 'checkbox', checked: true, onchange: () => drawList() });
  const rlist = h('div', { style: 'max-height:260px;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:4px 8px' });
  const drawList = () => {
    const kinds = Object.keys(KIND_UI).filter(k => k !== 'studio' && k !== 'resort');
    const visible = (r) => resIds.has(r.id) || ((!freeOnly.checked || !(r.busy || []).length) && (!textFilter || (r.name + ' ' + r.city + ' ' + r.category).toLowerCase().includes(textFilter)));
    const busyCount = people.filter(r => (r.busy || []).length && !resIds.has(r.id)).length;
    freeNote.textContent = busyCount ? `${busyCount} already booked on this date` : '';
    rlist.replaceChildren(...kinds.map(k => { const g = people.filter(r => r.kind === k && visible(r)); return g.length ? [h('div', { class: 'mute', style: 'margin-top:6px;font-weight:600' }, KIND_UI[k]),
      g.map(r => h('label', { class: 'chk', style: 'margin:0' }, h('input', { type: 'checkbox', checked: resIds.has(r.id), onchange: (e) => e.target.checked ? resIds.add(r.id) : resIds.delete(r.id) }),
        r.name + (r.city ? ' · ' + r.city : '') + (r.phone ? '' : ' (no phone)') + ((r.busy || []).length ? ' ⚠ busy: ' + r.busy[0].title : '')))] : null; }).flat(Infinity).filter(Boolean));
    if (!rlist.children.length) rlist.append(h('p', { class: 'mute' }, 'Nobody to show' + (freeOnly.checked && busyCount ? ' — untick "only free people" to see everyone.' : '.')));
  };
  const freeNote = h('span', { class: 'mute' });
  const rsearch = h('input', { type: 'search', placeholder: 'Search the directory…', oninput: (e) => { textFilter = e.target.value.toLowerCase(); drawList(); } });
  f.date.addEventListener('change', async () => { if (!f.date.value) return; const d = await dirFor(f.date.value); people = d.filter(r => r.kind !== 'studio' && r.kind !== 'resort'); drawList(); });
  drawList();
  const memberIds = new Set(s.members.map(m => m.id));
  const crew = users.filter(u => u.role !== 'social' || memberIds.has(u.id) || true).map(u => h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: memberIds.has(u.id), onchange: (e) => e.target.checked ? memberIds.add(u.id) : memberIds.delete(u.id) }), u.name + ' (' + ROLE_LABEL[u.role] + ')'));
  const parseModels = () => f.models.value.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const [name, phone, portfolio, ...note] = l.split('|').map(x => x.trim()); return { name, phone, portfolio, note: note.join(' | ') }; });
  const parsePlan = () => f.plan.value.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const m = l.match(/^(\d{1,2}:\d{2})\s+(.*)$/); if (!m) return { time: '', text: l }; return { time: m[1].padStart(5, '0'), text: m[2] }; });
  const save = () => guard(async () => {
    const body = { title: f.title.value, client: f.client.value, shoot_date: f.date.value, start_time: f.time.value, location: f.loc.value, notes: f.notes.value, members: [...memberIds], models: parseModels(), plan: parsePlan(), location_link: f.locLink.value, ...(dir.length || existing?.resources?.length ? { resources: [...resIds] } : {}) };
    if (existing) { await api('PUT', '/api/shoots/' + s.id, body); location.hash = '#/shoots/' + s.id; render(); }
    else { body.shots = f.shots.value.split('\n'); const r = await api('POST', '/api/shoots', body); location.hash = '#/shoots/' + r.id; }
  });
  return shell('#/shoots', h('h1', {}, existing ? 'Edit shoot' : 'New shoot'), h('div', { class: 'card' },
    field('Title', f.title), field('Client / brand', f.client), h('div', { class: 'grid2' }, field('Date', f.date), field('Start time', f.time)),
    places.length ? field('Place from directory', placeSel) : null, field('Place', f.loc), field('Map link', f.locLink), field('Notes (look, props, contact)', f.notes), field('Models (name | phone | portfolio link | note)', f.models), field('Day plan (time + step)', f.plan), dir.length ? [h('label', {}, 'Book from directory (photographers, makeup, models…)'), rsearch, h('label', { class: 'chk' }, freeOnly, 'Only people free on the shoot date ', freeNote), rlist] : h('p', { class: 'mute' }, 'Tip: add people in the Directory to book them here.'),
    !existing && field('Shot list', f.shots), h('label', {}, 'Who is going (team)'), crew,
    h('p', { class: 'mute' }, me.auto_messages ? '📨 New people and any date / time / place change are messaged automatically.' : '📨 New people are notified in the app. WhatsApp is not connected yet (see WHATSAPP.md).'),
    h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'pri', onclick: save }, 'Save'), h('a', { class: 'btn', href: existing ? '#/shoots/' + s.id : '#/shoots' }, 'Cancel'))));
}

async function shootView(id) {
  const s = await api('GET', '/api/shoots/' + id), mine = canShoot();
  if (location.hash.endsWith('/edit')) return shootForm(s);
  const reload = () => render();
  const statusSel = h('select', { disabled: !mine, onchange: (e) => guard(async () => { await api('PUT', '/api/shoots/' + id, { status: e.target.value }); reload(); }) },
    ['planned', 'shot', 'editing', 'done', 'cancelled'].map(v => h('option', { value: v, selected: v === s.status }, cap(v))));
  const shotsBox = h('div', {}, s.shots.map(t => h('div', { class: 'chk' },
    h('input', { type: 'checkbox', checked: !!t.done, disabled: !mine, onchange: (e) => guard(() => api('PUT', '/api/shots/' + t.id, { done: e.target.checked })) }),
    h('span', { class: 'grow' }, t.text), mine && h('button', { class: 'bad', onclick: () => guard(async () => { await api('DELETE', '/api/shots/' + t.id); reload(); }) }, '✕'))));
  const newShot = h('input', { placeholder: 'Add a shot…' });
  const upload = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: async (e) => {
    const files = [...e.target.files]; let n = 0;
    for (const f of files) {
      toast(`Uploading ${++n}/${files.length}…`);
      try { await api('POST', `/api/shoots/${id}/photos?name=${encodeURIComponent(f.name)}`, null, f); } catch (x) { toast(f.name + ': ' + x.message); await new Promise(r => setTimeout(r, 2200)); }
    }
    reload();
  } });
  const grid = h('div', { class: 'photos' }, s.photos.map(p => h('button', { class: 'ph', onclick: () => openPhoto(p, reload) }, h('img', { src: '/files/' + p.id, loading: 'lazy', alt: p.name }), badge(p.status))));

  const myRow = s.members.find(m => m.id === me.id);
  const rsvp = myRow && h('div', { class: 'card row spread' }, h('b', {}, 'Are you going?'), h('div', { class: 'row' },
    ['going', 'not_going'].map(v => h('button', { class: myRow.response === v ? 'pri' : '', onclick: () => guard(async () => { await api('PUT', `/api/shoots/${id}/rsvp`, { response: v }); reload(); }) }, v === 'going' ? '✅ Going' : "❌ Can't go"))));
  const people = s.members.length ? h('div', { class: 'card' }, s.members.map(m => h('div', { class: 'row spread', style: 'padding:3px 0' }, h('span', {}, m.name), h('span', { class: 'mute' }, RSVP[m.response])))) : h('p', { class: 'mute' }, 'Nobody assigned yet.');
  const models = s.models.length ? h('div', { class: 'card' }, s.models.map(m => h('div', { style: 'padding:4px 0' }, h('div', { class: 'row spread' }, h('b', {}, m.name),
    h('div', { class: 'row' }, m.portfolio && h('a', { class: 'btn', href: safeHref(m.portfolio), target: '_blank', rel: 'noopener noreferrer' }, '🔗 Portfolio'),
      m.phone && h('a', { class: 'btn', href: waLink(m.phone, `Hi ${m.name}, ${shootText(s)}`), target: '_blank', rel: 'noopener noreferrer' }, 'WhatsApp'))),
    (m.phone || m.note) && h('div', { class: 'mute' }, [m.phone, m.note].filter(Boolean).join(' · '))))) : h('p', { class: 'mute' }, 'No models added.');
  const plan = s.plan.length ? h('div', { class: 'card' }, s.plan.map(i => h('div', { class: 'row', style: 'padding:3px 0;flex-wrap:nowrap' }, h('b', { style: 'min-width:52px' }, i.at_time || '—'), h('span', {}, i.text)))) : h('p', { class: 'mute' }, 'No day plan yet.');

  const fbKind = h('select', {}, h('option', { value: 'suggestion' }, '💡 Suggestion'), h('option', { value: 'feedback' }, '💬 Feedback'));
  const fbText = h('textarea', { placeholder: 'Ideas for the shoot, or feedback on how it went…', style: 'min-height:60px' });
  const feedback = h('div', { class: 'card' }, s.feedback.length ? s.feedback.map(f => h('div', { class: 'cmt' }, h('div', { class: 'row spread' }, h('span', {}, h('b', {}, f.name), ' ', h('span', { class: 'badge' }, f.kind === 'suggestion' ? '💡 Suggestion' : '💬 Feedback'), ' ', h('span', { class: 'mute' }, new Date(f.created).toLocaleString())),
    (f.user_id === me.id || me.role === 'admin') && h('button', { class: 'bad', onclick: () => guard(async () => { await api('DELETE', '/api/feedback/' + f.id); reload(); }) }, '✕')), h('div', { style: 'white-space:pre-wrap' }, f.text))) : h('p', { class: 'mute' }, 'Nothing yet.'),
    h('div', { class: 'row', style: 'margin-top:8px' }, fbKind), fbText, h('div', { style: 'margin-top:6px' }, h('button', { onclick: () => guard(async () => { await api('POST', `/api/shoots/${id}/feedback`, { kind: fbKind.value, text: fbText.value }); reload(); }) }, 'Post')));
  const log = s.messages.length ? [h('h2', {}, 'Messages sent'), h('div', { class: 'card' }, s.messages.map(m => h('div', { class: 'row spread mute', style: 'padding:2px 0' }, h('span', {}, m.to_name + ' · ' + new Date(m.created).toLocaleString()),
    h('span', { class: m.status === 'sent' ? '' : 'err', style: 'margin:0' }, m.status === 'sent' ? '✓ sent' : m.status + (m.error ? ' (' + m.error + ')' : '')))))] : null;

  return shell('#/shoots', h('a', { href: '#/shoots' }, '← All shoots'),
    h('div', { class: 'row spread' }, h('h1', {}, s.title), mine && h('a', { class: 'btn', href: '#/shoots/' + id + '/edit' }, 'Edit')),
    h('div', { class: 'card' }, h('div', { class: 'row spread' }, h('div', {}, h('b', {}, h('a', { href: '#/day/' + s.shoot_date }, fmtDate(s.shoot_date)), s.start_time && ' · ' + s.start_time), h('div', { class: 'mute' }, [s.location && '📍 ' + s.location, s.client].filter(Boolean).join(' · '), ' ', s.location_link && safeLink(s.location_link) && h('a', { href: s.location_link, target: '_blank', rel: 'noopener noreferrer' }, 'Open map'))), statusSel),
      s.notes ? h('p', { style: 'white-space:pre-wrap' }, s.notes) : null),
    rsvp, s.resources.length ? [h('h2', {}, 'Booked crew'), h('div', { class: 'card' }, s.resources.map(r => {
      const place = r.kind === 'studio' || r.kind === 'resort';
      const st = h('select', { disabled: !mine || place, onchange: (e) => guard(async () => { await api('PUT', `/api/shoots/${id}/resources/${r.id}`, { status: e.target.value }); reload(); }) }, Object.entries(BOOK_STATUS).map(([v, l]) => h('option', { value: v, selected: v === r.status }, l)));
      return h('div', { style: 'padding:6px 0;border-top:1px solid var(--line)' }, h('div', { class: 'row spread' }, h('span', {}, h('b', {}, r.name), ' ', h('span', { class: 'mute' }, KIND_ONE[r.kind] + (r.fee ? ' · ₹ ' + r.fee : r.charge ? ' · listed ' + r.charge : ''))), !place && st),
        r.note ? h('div', { class: 'mute' }, r.note) : null, h('div', { class: 'row', style: 'margin-top:4px' }, contactLinks(r, `Hi ${r.name}, ${shootText(s)}`)));
    }))] : null,
    h('h2', {}, 'Who is going'), people, h('h2', {}, 'Models'), models, h('h2', {}, 'Day plan'), plan,
    h('h2', {}, `Shot list (${s.shots.filter(t => t.done).length}/${s.shots.length})`), h('div', { class: 'card' }, shotsBox,
      mine && h('div', { class: 'row' }, h('div', { class: 'grow' }, newShot), h('button', { onclick: () => newShot.value.trim() && guard(async () => { await api('POST', `/api/shoots/${id}/shots`, { text: newShot.value }); reload(); }) }, 'Add'))),
    h('div', { class: 'row spread' }, h('h2', {}, `Photos (${s.photos.length})`), mine && [upload, h('button', { class: 'pri', onclick: () => upload.click() }, '⬆ Upload photos')]),
    s.photos.length ? grid : h('p', { class: 'mute' }, 'No photos yet.'),
    h('h2', {}, 'Suggestions & feedback'), feedback, log,
    me.role === 'admin' && h('p', {}, h('button', { class: 'bad', onclick: () => confirm('Delete this shoot and all its photos?') && guard(async () => { await api('DELETE', '/api/shoots/' + id); location.hash = '#/shoots'; }) }, 'Delete shoot')));
}

// ---------- directory (studios, resorts, crew, models) ----------
const KIND_UI = { studio: 'Studios', resort: 'Resorts', photographer: 'Photographers', product_photographer: 'Product photographers', makeup: 'Makeup artists', art_director: 'Art directors', costume: 'Costume designers', props: 'Props', model: 'Models' };
const KIND_ONE = { studio: 'Studio', resort: 'Resort', photographer: 'Photographer', product_photographer: 'Product photographer', makeup: 'Makeup artist', art_director: 'Art director', costume: 'Costume designer', props: 'Props', model: 'Model' };
const safeLink = (u) => /^https?:\/\//i.test(u || '') ? u : null;
const linkLabel = (u) => /instagram\.com/i.test(u) ? '📷 Instagram' : /behance\.net/i.test(u) ? 'Behance' : '🔗 Link';
function contactLinks(r, text) {
  return [r.link && safeLink(r.link) && h('a', { class: 'btn', href: r.link, target: '_blank', rel: 'noopener noreferrer' }, linkLabel(r.link)),
    r.maps && safeLink(r.maps) && h('a', { class: 'btn', href: r.maps, target: '_blank', rel: 'noopener noreferrer' }, '📍 Map'),
    r.phone && h('a', { class: 'btn', href: waLink(r.phone, text || ''), target: '_blank', rel: 'noopener noreferrer' }, 'WhatsApp'),
    r.phone && h('a', { class: 'btn', href: 'tel:' + r.phone }, '📞 Call'),
    r.email && h('a', { class: 'btn', href: 'mailto:' + r.email }, '✉ Email')];
}
function resForm(r, kind, done) {
  const f = {}; const F = (k, label, attrs = {}) => { f[k] = h(attrs.area ? 'textarea' : 'input', { value: r[k] || '', ...attrs.attrs }); if (attrs.area) f[k].value = r[k] || ''; return field(label, f[k]); };
  const kindSel = h('select', {}, Object.entries(KIND_ONE).map(([k, l]) => h('option', { value: k, selected: k === (r.kind || kind) }, l)));
  const modal = h('div', { class: 'modal', onclick: (e) => e.target === modal && modal.remove() });
  const save = () => guard(async () => {
    const body = { kind: kindSel.value }; for (const k of Object.keys(f)) body[k] = f[k].value;
    if (r.id) await api('PUT', '/api/resources/' + r.id, body); else await api('POST', '/api/resources', body);
    modal.remove(); done();
  });
  modal.append(h('div', { class: 'box' }, h('h2', { style: 'margin-top:0' }, r.id ? 'Edit' : 'Add to directory'), field('Type', kindSel), F('name', 'Name'), F('city', 'City / area'),
    h('div', { class: 'grid2' }, F('phone', 'Phone (+91…)', { attrs: { type: 'tel' } }), F('email', 'Email')), F('link', 'Instagram / website link', { attrs: { placeholder: 'https://…' } }), F('maps', 'Map link (for places)'),
    h('div', { class: 'grid2' }, F('category', 'Category'), F('style', 'Work style')), h('div', { class: 'grid2' }, F('rating', 'Rating'), F('charge', 'Charge / rate')), F('distance', 'Distance (e.g. 12 Kms)'), F('notes', 'Notes', { area: true }),
    h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'pri', onclick: save }, 'Save'), h('button', { onclick: () => modal.remove() }, 'Cancel'),
      r.id && me.role === 'admin' && h('button', { class: 'bad', onclick: () => confirm('Delete from directory? It is also removed from shoots it was booked on.') && guard(async () => { await api('DELETE', '/api/resources/' + r.id); modal.remove(); done(); }) }, 'Delete'))));
  document.body.append(modal);
}
function importPanel(kind, done) {
  const file = h('input', { type: 'file', accept: '.csv,text/csv' }), status = h('div', { class: 'mute' });
  const go = () => guard(async () => {
    if (!file.files[0]) throw new Error('Choose a CSV file first');
    const r = await api('POST', '/api/resources/import', { kind, csv: await file.files[0].text() });
    toast(`Imported: ${r.added} new, ${r.updated} updated, ${r.skipped} skipped`); done();
  });
  return h('details', { class: 'card' }, h('summary', {}, `⬆ Import ${KIND_UI[kind]} from Google Sheet`),
    h('p', { class: 'mute' }, `In your Google Sheet open the "${KIND_UI[kind]}" tab → File → Download → Comma-separated values (.csv), then choose that file here. Existing names are kept and only their empty fields are filled.`), file, h('div', { style: 'margin-top:8px' }, h('button', { class: 'pri', onclick: go }, 'Import')), status);
}
const BOOK_STATUS = { requested: '⏳ Requested', confirmed: '✅ Confirmed', declined: '❌ Declined' };
async function bookModal(r, done) {
  const shoots = (await api('GET', '/api/shoots')).filter(s => s.shoot_date >= today() && s.status !== 'cancelled' && s.status !== 'done').reverse();
  const modal = h('div', { class: 'modal', onclick: (e) => e.target === modal && modal.remove() });
  const sel = h('select', {}, shoots.map(s => h('option', { value: s.id }, fmtDate(s.shoot_date) + ' · ' + s.title + (s.start_time ? ' · ' + s.start_time : ''))));
  const fee = h('input', { placeholder: r.charge ? 'Listed: ' + r.charge : 'e.g. 5000/day' }), note = h('input', { placeholder: 'e.g. bring 85mm lens, arrive 8:30' });
  const warn = h('div', { class: 'err' });
  const check = () => { const s = shoots.find(x => x.id === +sel.value); const clash = s && (r.upcoming || []).find(u => u.shoot_date === s.shoot_date); warn.textContent = clash ? `⚠ ${r.name} is already booked that day: ${clash.title} (${BOOK_STATUS[clash.status]})` : ''; };
  sel.addEventListener('change', check); check();
  const go = () => guard(async () => {
    const res = await api('POST', `/api/shoots/${sel.value}/book`, { resource_id: r.id, fee: fee.value, note: note.value });
    modal.remove(); toast(res.messaged ? (me.auto_messages ? 'Booked — sending WhatsApp message (see Messages sent on the shoot)' : 'Booked — WhatsApp is not connected yet, so no message was sent. Use the WhatsApp button.') : 'Booked — no phone number, contact them on Instagram / email'); done();
  });
  modal.append(h('div', { class: 'box', style: 'max-width:420px' }, h('h2', { style: 'margin-top:0' }, 'Book ' + r.name), h('div', { class: 'mute' }, KIND_ONE[r.kind] + (r.city ? ' · ' + r.city : '')),
    shoots.length ? [field('Which shoot?', sel), warn, field('Agreed fee (optional)', fee), field('Note for them (optional)', note),
      h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'pri', onclick: go }, r.phone ? 'Book & send message' : 'Book'), h('button', { onclick: () => modal.remove() }, 'Cancel'))]
      : [h('p', {}, 'No upcoming shoots to book on. Create a shoot first.'), h('a', { class: 'btn pri', href: '#/shoots/new', onclick: () => modal.remove() }, '+ New shoot')]));
  document.body.append(modal);
}
async function directoryView(kind) {
  if (!canShoot()) return shell('#/directory', h('p', {}, 'Not available for your role.'));
  kind = KIND_UI[kind] ? kind : 'photographer';
  const q = sessionStorage.getItem('dq') || '';
  const list = await api('GET', `/api/resources?kind=${kind}&q=${encodeURIComponent(q)}`);
  const search = h('input', { type: 'search', placeholder: 'Search name, city, category…', value: q, onchange: (e) => { sessionStorage.setItem('dq', e.target.value); render(); } });
  const card = (r) => h('div', { class: 'card' }, h('div', { class: 'row spread' }, h('b', {}, r.name), h('div', { class: 'row' }, kind !== 'studio' && kind !== 'resort' && h('button', { class: 'pri', onclick: () => bookModal(r, render) }, 'Book'), h('button', { onclick: () => resForm(r, kind, render) }, 'Edit'))),
    h('div', { class: 'mute' }, [r.city, r.category, r.style, r.rating && '⭐ ' + r.rating, r.charge && '₹ ' + r.charge, r.distance].filter(Boolean).join(' · ')),
    r.phone || r.email ? h('div', { class: 'mute' }, [r.phone, r.email].filter(Boolean).join(' · ')) : (r.link ? h('div', { class: 'mute' }, 'Contact via Instagram DM') : null),
    r.upcoming?.length ? h('div', { style: 'font-size:.9rem;margin-top:4px' }, r.upcoming.map(u => h('div', {}, '📅 ', h('a', { href: '#/shoots/' + u.shoot_id }, fmtDate(u.shoot_date) + ' · ' + u.title), ' ', h('span', { class: 'mute' }, BOOK_STATUS[u.status])))) : null,
    r.notes ? h('div', { class: 'mute', style: 'white-space:pre-wrap' }, r.notes) : null, h('div', { class: 'row', style: 'margin-top:6px' }, contactLinks(r)));
  return shell('#/directory', h('div', { class: 'row spread' }, h('h1', {}, 'Directory'), h('button', { class: 'pri', onclick: () => resForm({}, kind, render) }, '+ Add')),
    h('div', { class: 'row', style: 'gap:6px;margin-bottom:8px' }, Object.entries(KIND_UI).map(([k, l]) => h('a', { class: 'btn' + (k === kind ? ' pri' : ''), href: '#/directory/' + k }, l))),
    search, h('p', { class: 'mute' }, `${list.length} ${KIND_UI[kind].toLowerCase()}`), importPanel(kind, render), list.length ? list.map(card) : h('p', { class: 'mute' }, 'Nothing here yet — add one or import your sheet tab.'));
}

// ---------- board (monthly reels + statics for the client) ----------
const monthShift = (m, n) => { const d = new Date(m + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7); };
const monthLabel = (m) => new Date(m + '-01T00:00:00Z').toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
async function boardView(month) {
  month = month || today().slice(0, 7);
  const d = await api('GET', '/api/board?month=' + month), edit = canPost();
  const slot = (type, n) => d.slots.find(x => x.type === type && x.slot === n);
  const open = (type, n) => {
    const cur = slot(type, n) || { done: 0, tag: '', extra: n > d.target[type === 'reel' ? 'reels' : 'statics'] };
    const tag = h('input', { value: cur.tag, maxlength: 6, placeholder: 'tag (optional, e.g. N, R, V)' });
    const modal = h('div', { class: 'modal', onclick: (e) => e.target === modal && modal.remove() });
    const put = (body) => guard(async () => { await api('PUT', '/api/board/slot', { month, type, slot: n, ...body }); modal.remove(); render(); });
    modal.append(h('div', { class: 'box', style: 'max-width:340px' }, h('h2', { style: 'margin-top:0' }, `${cap(type)} ${n}${cur.extra ? ' (extra)' : ''}`),
      cur.done_at ? h('p', { class: 'mute' }, 'Done ' + new Date(cur.done_at).toLocaleString()) : null, edit ? [tag,
        h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'pri', onclick: () => put({ done: !cur.done, tag: tag.value }) }, cur.done ? 'Mark not done' : '✓ Mark done'), h('button', { onclick: () => put({ tag: tag.value }) }, 'Save tag'),
          cur.extra && h('button', { class: 'bad', onclick: () => guard(async () => { await api('DELETE', `/api/board/slot?month=${month}&type=${type}&slot=${n}`); modal.remove(); render(); }) }, 'Remove'))] : h('p', {}, cur.done ? 'Done' : 'Not done yet'),
      h('p', {}, h('button', { onclick: () => modal.remove() }, 'Close'))));
    document.body.append(modal);
  };
  const line = (type, label, count) => {
    const extras = d.slots.filter(x => x.type === type && x.slot > count).map(x => x.slot), nums = [...Array(count).keys()].map(i => i + 1).concat(extras);
    const done = d.slots.filter(x => x.type === type && x.done).length;
    return h('div', { class: 'card' }, h('div', { class: 'row spread' }, h('b', {}, label), h('span', { class: 'mute' }, `${done}/${count}` + (extras.length ? ` +${extras.length} extra` : ''))),
      h('div', { class: 'row', style: 'margin-top:8px;gap:6px' }, nums.map(n => { const x = slot(type, n); return h('button', { class: 'slot' + (x?.done ? ' done' : '') + (n > count ? ' extra' : ''), onclick: () => open(type, n) }, String(n), x?.tag && h('small', {}, x.tag)); }),
        edit && h('button', { class: 'slot add', title: 'Add extra', onclick: () => guard(async () => { await api('PUT', '/api/board/slot', { month, type, slot: Math.max(count, ...extras) + 1, add: true }); render(); }) }, '+')));
  };
  const setTarget = () => { const r = prompt('Reels this month?', d.target.reels); if (r === null) return; const st = prompt('Statics this month?', d.target.statics); if (st === null) return; guard(async () => { await api('PUT', '/api/board/target', { month, reels: r, statics: st }); render(); }); };
  const rd = d.slots.filter(x => x.type === 'reel' && x.done).length, sd = d.slots.filter(x => x.type === 'static' && x.done).length;
  return shell('#/board', h('div', { class: 'row spread' }, h('h1', {}, d.client + ' · Board'), edit && h('button', { onclick: setTarget }, 'Set targets')),
    h('div', { class: 'row spread' }, h('a', { class: 'btn', href: '#/board/' + monthShift(month, -1) }, '‹'), h('b', {}, monthLabel(month)), h('a', { class: 'btn', href: '#/board/' + monthShift(month, 1) }, '›')),
    h('p', { class: 'mute' }, `Reels ${rd}/${d.target.reels} · Statics ${sd}/${d.target.statics}. Tap a number to mark it done.`),
    line('reel', 'Reels', d.target.reels), line('static', 'Statics', d.target.statics));
}

// ---------- day by day ----------
const dayShift = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
async function dayView(date) {
  date = date || today();
  const d = await api('GET', '/api/day?date=' + date);
  const shoot = (s) => h('a', { href: '#/shoots/' + s.id, class: 'card', style: 'display:block;color:inherit' },
    h('div', { class: 'row spread' }, h('b', {}, s.title), badge(s.status)),
    h('div', { class: 'mute' }, [s.start_time, s.location && '📍 ' + s.location, s.client].filter(Boolean).join(' · ')),
    s.members.length ? h('div', { class: 'mute' }, 'Going: ' + s.members.map(m => m.name + (m.response === 'going' ? ' ✅' : m.response === 'not_going' ? ' ❌' : ' ⏳')).join(', ')) : null,
    s.models.length ? h('div', { class: 'mute' }, 'Models: ' + s.models.map(m => m.name).join(', ')) : null,
    s.plan.map(i => h('div', { style: 'font-size:.9rem' }, h('b', {}, (i.at_time || '—') + ' '), i.text)));
  const post = (p) => h('a', { href: '#/posts/' + p.id, class: 'card row spread', style: 'color:inherit' }, h('div', {}, h('b', {}, p.title), h('div', { class: 'mute' }, cap(p.platform), p.post_time && ' · ' + p.post_time, ' · 🖼 ' + p.photos.length)), badge(p.status));
  return shell('#/', h('div', { class: 'row spread' }, h('a', { class: 'btn', href: '#/day/' + dayShift(date, -1) }, '‹'), h('h1', { style: 'margin:0' }, fmtDate(date) + (date === today() ? ' · Today' : '')), h('a', { class: 'btn', href: '#/day/' + dayShift(date, 1) }, '›')),
    h('div', { class: 'row', style: 'margin:10px 0' }, h('span', { class: 'badge' }, `📷 ${d.photos_uploaded} photos uploaded`), h('span', { class: 'badge' }, `🎬 ${d.reels_done} reels done`), h('span', { class: 'badge' }, `🖼 ${d.statics_done} statics done`)),
    h('h2', {}, 'Shoots'), d.shoots.length ? d.shoots.map(shoot) : h('p', { class: 'mute' }, 'No shoots.'), h('h2', {}, 'Posts'), d.posts.length ? d.posts.map(post) : h('p', { class: 'mute' }, 'No posts.'),
    canShoot() && h('p', {}, h('a', { class: 'btn', href: '#/shoots/new' }, '+ New shoot')), h('p', {}, h('a', { href: '#/' }, '← Home')));
}

// ---------- admin: reports (day / week / month counts) ----------
function adminHub() {
  return shell('#/admin', h('h1', {}, 'Admin'), h('a', { class: 'card', style: 'display:block;color:inherit', href: '#/reports/week' }, h('b', {}, '📊 Reports'), h('div', { class: 'mute' }, 'Counts by day, week and month')),
    h('a', { class: 'card', style: 'display:block;color:inherit', href: '#/team' }, h('b', {}, '👥 Team'), h('div', { class: 'mute' }, 'Add people, roles, phone numbers, PINs')),
    h('a', { class: 'card', style: 'display:block;color:inherit', href: '#/me' }, h('b', {}, '🙋 My account')));
}
async function reportsView(group) {
  group = ['day', 'week', 'month'].includes(group) ? group : 'week';
  const r = await api('GET', '/api/stats?group=' + group);
  const label = (p) => group === 'month' ? monthLabel(p) : group === 'week' ? 'Week of ' + fmtDate(p) : fmtDate(p);
  const cols = [['shoots', 'Shoots'], ['photos_uploaded', 'Photos'], ['photos_approved', 'Approved'], ['posts_planned', 'Posts'], ['posts_posted', 'Posted'], ['reels_done', 'Reels'], ['statics_done', 'Statics']];
  const tbl = (head, rows) => h('div', { style: 'overflow-x:auto' }, h('table', {}, h('thead', {}, h('tr', {}, head.map(x => h('th', {}, x)))), h('tbody', {}, rows)));
  const csv = () => {
    const lines = [['Period', ...cols.map(c => c[1])].join(','), ...r.rows.map(x => [x.period, ...cols.map(c => x[c[0]])].join(','))];
    const a = h('a', { href: URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' })), download: `studio-${group}.csv` }); document.body.append(a); a.click(); a.remove();
  };
  return shell('#/admin', h('a', { href: '#/admin' }, '← Admin'), h('h1', {}, 'Reports'),
    h('div', { class: 'row' }, ['day', 'week', 'month'].map(g => h('a', { class: 'btn' + (g === group ? ' pri' : ''), href: '#/reports/' + g }, { day: 'Daily', week: 'Weekly', month: 'Monthly' }[g]))),
    h('p', { class: 'mute' }, `${r.from} → ${r.to}. Shoots/posts count by their planned date; photos by upload day; reels/statics by the day they were marked done.`),
    h('div', { class: 'row' }, cols.map(([k, l]) => h('div', { class: 'card grow', style: 'text-align:center;min-width:80px' }, h('div', { style: 'font-size:1.4rem;font-weight:700' }, r.totals[k]), h('div', { class: 'mute' }, l)))),
    tbl(['Period', ...cols.map(c => c[1])], r.rows.slice().reverse().map(x => h('tr', {}, h('td', {}, label(x.period)), cols.map(([k]) => h('td', { class: x[k] ? '' : 'mute' }, x[k]))))),
    h('h2', {}, 'By person'), r.by_person.length ? tbl(['Name', 'Photos', 'Shoots assigned', 'Going', 'Posts', 'Reels', 'Statics'], r.by_person.map(p => h('tr', {}, h('td', {}, p.name), h('td', {}, p.photos_uploaded), h('td', {}, p.shoots_assigned), h('td', {}, p.shoots_going), h('td', {}, p.posts_created), h('td', {}, p.reels_done), h('td', {}, p.statics_done)))) : h('p', { class: 'mute' }, 'No activity in this range.'),
    h('p', {}, h('button', { onclick: csv }, '⬇ Download CSV')));
}

async function openPhoto(p, done) {
  const box = h('div', { class: 'box' }), modal = h('div', { class: 'modal', onclick: (e) => e.target === modal && close() });
  const close = () => { modal.remove(); done(); };
  const draw = async () => {
    const cm = await api('GET', `/api/photos/${p.id}/comments`).catch(() => []);
    const cur = p.status;
    const set = (s) => guard(async () => { await api('PUT', '/api/photos/' + p.id, { status: s }); p.status = s; draw(); });
    const acts = [];
    if (me.role !== 'social' && cur !== 'edited' && cur !== 'approved') acts.push(h('button', { onclick: () => set('edited') }, '✎ Mark edited'));
    if (me.role !== 'social' && cur === 'edited') acts.push(h('button', { onclick: () => set('uploaded') }, 'Back to needs editing'));
    if (canPost() && cur !== 'approved') acts.push(h('button', { class: 'pri', onclick: () => set('approved') }, '✓ Approve'));
    if (canPost() && cur !== 'rejected') acts.push(h('button', { class: 'bad', onclick: () => set('rejected') }, '✕ Reject'));
    if (canPost() && (cur === 'approved' || cur === 'rejected')) acts.push(h('button', { onclick: () => set('edited') }, 'Reopen'));
    const txt = h('input', { placeholder: 'Add a comment (e.g. "crop tighter", "brighten")' });
    const send = () => txt.value.trim() && guard(async () => { await api('POST', `/api/photos/${p.id}/comments`, { text: txt.value }); p.comments++; draw(); });
    box.replaceChildren(
      h('img', { class: 'big', src: '/files/' + p.id, alt: p.name }),
      h('div', { class: 'row spread', style: 'margin:8px 0' }, h('span', { class: 'mute' }, p.name), badge(cur)),
      h('div', { class: 'row' }, acts, h('a', { class: 'btn', href: `/files/${p.id}?download=1` }, '⬇ Download'),
        (me.role === 'admin' || me.role === 'photographer') && h('button', { class: 'bad', onclick: () => confirm('Delete this photo?') && guard(async () => { await api('DELETE', '/api/photos/' + p.id); close(); }) }, 'Delete')),
      h('h2', {}, 'Comments'), h('div', {}, cm.length ? cm.map(c => h('div', { class: 'cmt' }, h('b', {}, c.name), ' ', h('span', { class: 'mute' }, new Date(c.created).toLocaleString()), h('div', {}, c.text))) : h('p', { class: 'mute' }, 'No comments.')),
      h('div', { class: 'row', style: 'margin-top:8px' }, h('div', { class: 'grow' }, txt), h('button', { onclick: send }, 'Send')),
      h('p', {}, h('button', { onclick: close }, 'Close')));
  };
  modal.append(box); document.body.append(modal); draw();
}

// ---------- posts ----------
async function postsView() {
  const list = await api('GET', '/api/posts'), t = today();
  const row = (p) => h('a', { href: '#/posts/' + p.id, class: 'card', style: 'display:block;color:inherit' },
    h('div', { class: 'row spread' }, h('b', {}, p.title), badge(p.status)),
    h('div', { class: 'mute' }, cap(p.platform), p.post_time && ' · ' + p.post_time, ' · 🖼 ' + p.photos.length));
  const byDay = {};
  for (const p of list) (byDay[p.post_date] ||= []).push(p);
  const days = Object.keys(byDay).sort();
  const upcoming = days.filter(d => d >= t), past = days.filter(d => d < t).reverse();
  const block = (ds) => ds.map(d => [h('div', { class: 'day' }, fmtDate(d) + (d === t ? ' · Today' : '')), byDay[d].map(row)]);
  return shell('#/posts', h('div', { class: 'row spread' }, h('h1', {}, me.client + ' · Content calendar'), canPost() && h('a', { class: 'btn pri', href: '#/posts/new' }, '+ New post')),
    upcoming.length ? block(upcoming) : h('p', { class: 'mute' }, 'Nothing planned.'), past.length ? [h('h2', {}, 'Earlier'), block(past)] : null);
}
async function postForm(id) {
  const p = id ? await api('GET', '/api/posts/' + id) : { title: '', platform: 'instagram', post_date: today(), post_time: '', caption: '', hashtags: '', status: 'idea', photos: [] };
  const editable = canPost();
  const approved = await api('GET', '/api/photos/approved');
  const chosen = new Set(p.photos.map(x => x.id));
  const f = {
    title: h('input', { value: p.title, disabled: !editable }), plat: h('select', { disabled: !editable }, PLATFORMS.map(v => h('option', { value: v, selected: v === p.platform }, cap(v)))),
    date: h('input', { type: 'date', value: p.post_date, disabled: !editable }), time: h('input', { type: 'time', value: p.post_time, disabled: !editable }),
    cap: h('textarea', { style: 'min-height:140px', disabled: !editable }), tags: h('input', { value: p.hashtags, placeholder: '#brand #photoshoot', disabled: !editable }),
    st: h('select', { disabled: !editable }, ['idea', 'draft', 'scheduled', 'posted'].map(v => h('option', { value: v, selected: v === p.status }, cap(v)))),
  };
  f.cap.value = p.caption;
  const pick = h('div', { class: 'photos' }, approved.map(a => {
    const b = h('button', { class: 'ph' + (chosen.has(a.id) ? ' sel' : ''), title: a.shoot, disabled: !editable, onclick: () => { chosen.has(a.id) ? chosen.delete(a.id) : chosen.add(a.id); b.classList.toggle('sel'); } }, h('img', { src: '/files/' + a.id, loading: 'lazy', alt: a.name }));
    return b;
  }));
  const copy = h('button', { onclick: () => navigator.clipboard?.writeText(f.cap.value + (f.tags.value ? '\n\n' + f.tags.value : '')).then(() => toast('Copied caption + hashtags')) }, '⧉ Copy caption');
  const save = () => guard(async () => {
    const body = { title: f.title.value, platform: f.plat.value, post_date: f.date.value, post_time: f.time.value, caption: f.cap.value, hashtags: f.tags.value, status: f.st.value, photos: [...chosen] };
    if (id) await api('PUT', '/api/posts/' + id, body); else await api('POST', '/api/posts', body);
    location.hash = '#/posts';
  });
  return shell('#/posts', h('a', { href: '#/posts' }, '← Calendar'), h('h1', {}, id ? 'Post' : 'New post'), h('div', { class: 'card' },
    field('Title / idea', f.title), h('div', { class: 'grid2' }, field('Platform', f.plat), field('Status', f.st)), h('div', { class: 'grid2' }, field('Date', f.date), field('Time', f.time)),
    field('Caption', f.cap), field('Hashtags', f.tags), h('label', {}, 'Photos (approved only — tap to select)'), approved.length ? pick : h('p', { class: 'mute' }, 'No approved photos yet. Approve photos from a shoot first.'),
    h('div', { class: 'row', style: 'margin-top:12px' }, editable && h('button', { class: 'pri', onclick: save }, 'Save'), copy, chosen.size ? p.photos.map(x => h('a', { class: 'btn', href: `/files/${x.id}?download=1` }, '⬇ ' + x.id)) : null,
      editable && id && h('button', { class: 'bad', onclick: () => confirm('Delete this post?') && guard(async () => { await api('DELETE', '/api/posts/' + id); location.hash = '#/posts'; }) }, 'Delete'))));
}

// ---------- team / me ----------
function pinCard() {
  const cur = h('input', { type: 'password', inputmode: 'numeric', placeholder: 'Current PIN' }), nw = h('input', { type: 'password', inputmode: 'numeric', placeholder: 'New PIN (4-8 digits)' });
  return h('div', { class: 'card' }, h('b', {}, 'Change my PIN'), cur, h('div', { style: 'height:6px' }), nw,
    h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { onclick: () => guard(async () => { await api('POST', '/api/me/pin', { current: cur.value, pin: nw.value }); cur.value = nw.value = ''; toast('PIN changed'); }) }, 'Change PIN')));
}
function phoneCard() {
  const ph = h('input', { type: 'tel', value: me.phone || '', placeholder: '+91…' });
  return h('div', { class: 'card' }, h('b', {}, 'My phone (for shoot messages)'), ph, h('div', { style: 'margin-top:8px' }, h('button', { onclick: () => guard(async () => { await api('PUT', '/api/me/phone', { phone: ph.value }); me.phone = ph.value; toast('Saved'); }) }, 'Save')));
}
function meView() {
  return shell(me.role === 'admin' ? '#/admin' : '#/me', h('h1', {}, me.name), h('p', { class: 'mute' }, ROLE_LABEL[me.role] + ' · @' + me.username), phoneCard(), pinCard(),
    h('button', { onclick: async () => { await api('POST', '/api/logout'); me = null; users = []; render(); } }, 'Log out'));
}
async function teamView() {
  const all = await api('GET', '/api/users');
  const roleSel = (v, dis) => h('select', { disabled: dis }, Object.entries(ROLE_LABEL).map(([k, l]) => h('option', { value: k, selected: k === v }, l)));
  const rows = all.map(u => {
    const role = roleSel(u.role, u.id === me.id), pin = h('input', { placeholder: 'New PIN', inputmode: 'numeric', style: 'max-width:110px' }), phone = h('input', { placeholder: 'Phone +91…', type: 'tel', value: u.phone || '', style: 'max-width:160px' });
    return h('div', { class: 'card' }, h('div', { class: 'row spread' }, h('b', {}, u.name, ' ', h('span', { class: 'mute' }, '@' + u.username)), !u.active && badge('cancelled')),
      h('div', { class: 'row', style: 'margin-top:6px' }, role, phone, pin,
        h('button', { onclick: () => guard(async () => { await api('PUT', '/api/users/' + u.id, { role: role.value, phone: phone.value, pin: pin.value || undefined }); users = []; toast('Saved'); render(); }) }, 'Save'),
        u.id !== me.id && h('button', { class: u.active ? 'bad' : '', onclick: () => guard(async () => { await api('PUT', '/api/users/' + u.id, { active: !u.active }); users = []; render(); }) }, u.active ? 'Deactivate' : 'Reactivate')));
  });
  const n = { name: h('input', { placeholder: 'Full name' }), un: h('input', { placeholder: 'username', autocapitalize: 'none' }), pin: h('input', { placeholder: 'PIN (4-8 digits)', inputmode: 'numeric' }), phone: h('input', { placeholder: 'Phone +91… (for messages)', type: 'tel' }), role: roleSel('photographer') };
  return shell('#/admin', h('a', { href: '#/admin' }, '← Admin'), h('h1', {}, 'Team'), rows, h('div', { class: 'card' }, h('b', {}, 'Add team member'), n.name, n.un, n.phone, n.pin, n.role,
    h('div', { style: 'margin-top:8px' }, h('button', { class: 'pri', onclick: () => guard(async () => { await api('POST', '/api/users', { name: n.name.value, username: n.un.value, pin: n.pin.value, phone: n.phone.value, role: n.role.value }); users = []; render(); }) }, 'Add'))),
    pinCard(), h('button', { onclick: async () => { await api('POST', '/api/logout'); me = null; users = []; render(); } }, 'Log out'));
}
render();
