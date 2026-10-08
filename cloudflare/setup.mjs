// One-time Cloudflare setup: creates the database, tables, secrets and publishes the app.
// Run:  node cloudflare/setup.mjs   (or double-click DEPLOY-TO-CLOUDFLARE.bat on Windows)
// Safe to run again: it reuses the existing database and never replaces existing secrets.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseDatabaseId, findDbInList, parseWorkerUrl, setDatabaseId, currentDatabaseId, hasSecret } from './parse.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const win = process.platform === 'win32';
const DB = 'ruchi-db';

// run a command; show: true streams output to the screen, otherwise it is captured
function run(cmd, args, { input, show = true } = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', shell: win, input, stdio: show ? (input ? ['pipe', 'inherit', 'inherit'] : 'inherit') : ['pipe', 'pipe', 'pipe'] });
  return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || '') };
}
const npx = (args, o) => run(win ? 'npx.cmd' : 'npx', args, o);
const step = (n, t) => console.log(`\n=== Step ${n}: ${t} ===`);
function stop(msg) { console.error(`\nSTOPPED: ${msg}\nCopy the message above and send it to get help. You can run this again safely.`); process.exit(1); }

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
console.log('Ruchi Food Products - Cloudflare setup\n(Free plan, no card. Takes a few minutes.)');

step(1, 'Installing tools');
if (!fs.existsSync('node_modules/wrangler')) { if (!run(win ? 'npm.cmd' : 'npm', ['install']).ok) stop('npm install failed'); } else console.log('Already installed.');

step(2, 'Logging in to Cloudflare (a browser window will open - click Allow)');
if (!npx(['wrangler', 'whoami'], { show: false }).out.match(/associated with the email|You are logged in/i)) {
  if (!npx(['wrangler', 'login']).ok) stop('Login failed');
} else console.log('Already logged in.');

step(3, 'Creating the database');
let toml = fs.readFileSync('wrangler.toml', 'utf8');
let dbId = currentDatabaseId(toml);
if (dbId) console.log('Database already set up in wrangler.toml.');
else {
  const created = npx(['wrangler', 'd1', 'create', DB], { show: false });
  console.log(created.out);
  dbId = parseDatabaseId(created.out);
  if (!dbId) { // it may already exist from an earlier attempt
    const list = npx(['wrangler', 'd1', 'list', '--json'], { show: false });
    dbId = findDbInList(list.out, DB);
  }
  if (!dbId) stop('Could not create or find the database.');
  fs.writeFileSync('wrangler.toml', setDatabaseId(toml, dbId));
  console.log('Saved database id to wrangler.toml');
}

step(4, 'Creating the tables');
if (!npx(['wrangler', 'd1', 'execute', DB, '--remote', '--file=src/schema.sql']).ok) stop('Could not create the tables.');
// databases made before product categories existed need one extra column (harmless error if already present)
npx(['wrangler', 'd1', 'execute', DB, '--remote', '--command', "ALTER TABLE products ADD COLUMN category TEXT NOT NULL DEFAULT ''"], { show: false });

step(5, 'Publishing the app');
const dep = npx(['wrangler', 'deploy'], { show: false });
console.log(dep.out);
if (!dep.ok) stop('Publishing failed.');
const url = parseWorkerUrl(dep.out);

step(6, 'Setting your passwords');
const secrets = npx(['wrangler', 'secret', 'list'], { show: false });
if (hasSecret(secrets.out, 'APP_SECRET')) {
  console.log('Passwords were already set earlier - keeping them (changing APP_SECRET would lock everyone out).');
} else {
  let pw = '';
  while (pw.length < 6) pw = (await rl.question('Choose your ADMIN password (at least 6 characters): ')).trim();
  if (!npx(['wrangler', 'secret', 'put', 'APP_SECRET'], { input: crypto.randomBytes(32).toString('hex') + '\n' }).ok) stop('Could not save APP_SECRET.');
  if (!npx(['wrangler', 'secret', 'put', 'ADMIN_PASSWORD'], { input: pw + '\n' }).ok) stop('Could not save ADMIN_PASSWORD.');
  console.log('Saved.');
}
rl.close();

console.log('\n==============================================');
console.log(' DONE!');
console.log(url ? ` Shops open:  ${url}\n Admin page:  ${url}/admin` : ' Your address is shown above (it ends in .workers.dev). Add /admin for the admin page.');
console.log('==============================================');
console.log('Next: log in to the admin page, then Products -> + Add product, and Shops -> + Add shop.');
