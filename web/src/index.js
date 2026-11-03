import { verifyAccess } from './access.js';
import { handleRequest } from './routes.js';

export default {
  async fetch(request, env) {
    // Every request, static files included, needs a valid Access token.
    if (!(await verifyAccess(request, env))) {
      return new Response('Forbidden', { status: 403 });
    }
    return handleRequest(request, env);
  }
};
