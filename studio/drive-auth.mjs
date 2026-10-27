// One-time helper: gets the refresh token that lets the app store photos in your Google Drive.
// Run on your own computer:  GDRIVE_CLIENT_ID=... GDRIVE_CLIENT_SECRET=... node drive-auth.mjs
import http from 'node:http';
const { GDRIVE_CLIENT_ID: id, GDRIVE_CLIENT_SECRET: secret } = process.env;
if (!id || !secret) { console.error('Set GDRIVE_CLIENT_ID and GDRIVE_CLIENT_SECRET first (see GOOGLE-DRIVE.md).'); process.exit(1); }
const PORT = 53682, redirect = `http://localhost:${PORT}`;
const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: id, redirect_uri: redirect, response_type: 'code', access_type: 'offline', prompt: 'consent',
  scope: 'https://www.googleapis.com/auth/drive.file',
});
console.log('\nOpen this link in your browser and allow access:\n\n' + url + '\n');
const server = http.createServer(async (req, res) => {
  const code = new URL(req.url, redirect).searchParams.get('code');
  if (!code) { res.end('Waiting…'); return; }
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: id, client_secret: secret, redirect_uri: redirect, grant_type: 'authorization_code' }),
  });
  const j = await r.json();
  res.end(j.refresh_token ? 'Done! You can close this tab and go back to the terminal.' : 'Failed — see terminal.');
  if (j.refresh_token) console.log('Success. Start the app with:\n\n  GDRIVE_REFRESH_TOKEN=' + j.refresh_token + '\n\n(keep this secret)');
  else console.error('No refresh token returned:', j);
  server.close();
});
server.listen(PORT);
