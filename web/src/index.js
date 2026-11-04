import { verifyAccess } from './access.js';
import { runScheduled } from './cron.js';
import { handleRequest } from './routes.js';

export default {
  async fetch(request, env) {
    // Every request, static files included, needs a valid Access token.
    if (!(await verifyAccess(request, env))) {
      return new Response('Forbidden', { status: 403 });
    }
    return handleRequest(request, env);
  },

  // Cron triggers don't come through Access, so there's nothing to verify.
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runScheduled(env));
  }
};
