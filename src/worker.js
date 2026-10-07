// Cloudflare Worker entry. Static pages in /public are served by Workers Assets; only /api/* reaches this code.
import { createHandler } from './app.js';
import { d1Db } from './db-d1.js';

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/api/')) return createHandler({ db: d1Db(env.DB), env })(request);
    return env.ASSETS.fetch(request);
  },
};
