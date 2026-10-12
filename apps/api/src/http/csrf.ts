import type { FastifyInstance } from 'fastify';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Rejects state-changing API calls initiated by another site with the user's cookie.
export function registerCsrfGuard(app: FastifyInstance): void {
  app.addHook('onRequest', async (req, reply) => {
    if (SAFE_METHODS.has(req.method) || !req.url.startsWith('/api/')) return;
    if (req.headers['sec-fetch-site'] === 'cross-site') {
      return reply.code(403).send({ error: 'forbidden' });
    }
    const origin = req.headers.origin;
    if (origin) {
      let host: string | null;
      try {
        host = new URL(origin).host;
      } catch {
        host = null;
      }
      if (host !== req.headers.host) return reply.code(403).send({ error: 'forbidden' });
    }
  });
}
