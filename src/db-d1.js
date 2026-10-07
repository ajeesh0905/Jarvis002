// Database adapter for Cloudflare D1 (SQLite). Same async interface as the Node adapter.
export function d1Db(DB) {
  return {
    async all(sql, ...p) { return (await DB.prepare(sql).bind(...p).all()).results; },
    async get(sql, ...p) { return (await DB.prepare(sql).bind(...p).first()) || undefined; },
    async run(sql, ...p) { await DB.prepare(sql).bind(...p).run(); },
    async batch(stmts) { await DB.batch(stmts.map(([sql, p]) => DB.prepare(sql).bind(...p))); }, // atomic
  };
}
