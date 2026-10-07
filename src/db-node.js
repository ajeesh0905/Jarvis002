// Database adapter for Node (node:sqlite). Same async interface as the Cloudflare D1 adapter.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

export function nodeDb(file, schemaPath) {
  const d = new DatabaseSync(file);
  d.exec('PRAGMA journal_mode = WAL');
  d.exec(fs.readFileSync(schemaPath, 'utf8'));
  // upgrade databases created before categories existed
  if (!d.prepare('PRAGMA table_info(products)').all().some(c => c.name === 'category'))
    d.exec("ALTER TABLE products ADD COLUMN category TEXT NOT NULL DEFAULT ''");
  return {
    async all(sql, ...p) { return d.prepare(sql).all(...p).map(r => ({ ...r })); },
    async get(sql, ...p) { const r = d.prepare(sql).get(...p); return r ? { ...r } : undefined; },
    async run(sql, ...p) { d.prepare(sql).run(...p); },
    async batch(stmts) { // atomic
      d.exec('BEGIN');
      try { for (const [sql, p] of stmts) d.prepare(sql).run(...p); d.exec('COMMIT'); }
      catch (e) { d.exec('ROLLBACK'); throw e; }
    },
  };
}
