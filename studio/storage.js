// Photo storage. Google Drive when GDRIVE_* env vars are set, otherwise local disk.
// Drive uses an OAuth refresh token with the narrow "drive.file" scope: the app can only
// see files/folders it created itself (a "Studio Photos" folder in the connected account).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';

export function createStorage({ dataDir, kv }) {
  const localDir = path.join(dataDir, 'photos');
  fs.mkdirSync(localDir, { recursive: true });
  const { GDRIVE_CLIENT_ID: cid, GDRIVE_CLIENT_SECRET: secret, GDRIVE_REFRESH_TOKEN: refresh } = process.env;
  const driveOn = !!(cid && secret && refresh);

  let token = null, tokenExp = 0;
  async function accessToken() {
    if (token && Date.now() < tokenExp - 60e3) return token;
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: cid, client_secret: secret, refresh_token: refresh, grant_type: 'refresh_token' }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error('Google sign-in failed: ' + (j.error_description || j.error || r.status) + ' — re-run drive-auth.mjs');
    token = j.access_token; tokenExp = Date.now() + j.expires_in * 1000;
    return token;
  }
  async function api(url, opts = {}) {
    const r = await fetch(url, { ...opts, headers: { ...opts.headers, Authorization: 'Bearer ' + await accessToken() } });
    if (!r.ok) throw new Error('Google Drive error ' + r.status + ': ' + (await r.text()).slice(0, 300));
    return r;
  }
  async function createFolder(name, parent) {
    const r = await api('https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', ...(parent ? { parents: [parent] } : {}) }),
    });
    return (await r.json()).id;
  }
  const pending = new Map(); // avoid creating the same folder twice on concurrent uploads
  function folderFor(key, name, parentFn) {
    const have = kv.get(key); if (have) return Promise.resolve(have);
    if (!pending.has(key)) pending.set(key, (async () => {
      try { const id = await createFolder(name, parentFn && await parentFn()); kv.set(key, id); return id; } finally { pending.delete(key); }
    })());
    return pending.get(key);
  }
  const rootFolder = () => folderFor('drive_root', 'Studio Photos');
  const shootFolder = (shoot) => folderFor('drive_shoot_' + shoot.id, `${shoot.shoot_date} ${shoot.title}`.slice(0, 100), rootFolder);

  return {
    kind: driveOn ? 'drive' : 'local',
    async put({ buf, name, mime, shoot }) {
      if (!driveOn) {
        const file = crypto.randomUUID() + path.extname(name).toLowerCase();
        fs.writeFileSync(path.join(localDir, file), buf);
        return { store: 'local', file };
      }
      const parent = await shootFolder(shoot);
      const boundary = 'b' + crypto.randomBytes(12).toString('hex');
      const meta = JSON.stringify({ name, parents: [parent] });
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`),
        buf, Buffer.from(`\r\n--${boundary}--`),
      ]);
      const r = await api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
        method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body,
      });
      return { store: 'drive', file: (await r.json()).id };
    },
    // returns { stream, size } or null
    async open(photo) {
      if (photo.store === 'local') {
        const full = path.join(localDir, photo.file);
        if (!fs.existsSync(full)) return null;
        return { stream: fs.createReadStream(full), size: fs.statSync(full).size };
      }
      if (!driveOn) throw new Error('Photo is in Google Drive but Drive is not configured');
      const r = await api(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(photo.file)}?alt=media`);
      return { stream: Readable.fromWeb(r.body), size: Number(r.headers.get('content-length')) || null };
    },
    async remove(photo) {
      try {
        if (photo.store === 'local') fs.unlinkSync(path.join(localDir, photo.file));
        else if (driveOn) await api(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(photo.file)}`, { method: 'DELETE' });
      } catch (e) { console.error('remove failed:', e.message); }
    },
  };
}
