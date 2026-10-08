// Small helpers for cloudflare/setup.mjs (kept separate so they can be tested without Cloudflare).
export const PLACEHOLDER = 'REPLACE_WITH_YOUR_DATABASE_ID';
export const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function parseDatabaseId(output) {
  const m = /database_id["']?\s*[:=]\s*["']?([0-9a-f-]{36})/i.exec(output);
  return m ? m[1] : null;
}
export function findDbInList(jsonText, name) {
  try { const row = JSON.parse(jsonText).find(d => d.name === name); return row ? (row.uuid || row.id || null) : null; } catch { return null; }
}
export function parseWorkerUrl(output) {
  const m = /https:\/\/[a-z0-9][a-z0-9.-]*\.workers\.dev/i.exec(output);
  return m ? m[0] : null;
}
export function setDatabaseId(toml, id) {
  return toml.replace(/database_id\s*=\s*"[^"]*"/, `database_id = "${id}"`);
}
export function currentDatabaseId(toml) {
  const m = /database_id\s*=\s*"([^"]*)"/.exec(toml);
  return m && UUID.test(m[1]) ? m[1] : null;
}
export function hasSecret(listOutput, name) {
  try { return JSON.parse(listOutput).some(s => s.name === name); } catch { return new RegExp(`\\b${name}\\b`).test(listOutput); }
}
