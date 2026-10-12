import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { registerAuth } from './auth/plugin';
import type { Db } from './db/client';
import { healthRoutes } from './health';
import { adminPartnerRoutes } from './partners/admin-routes';
import { partnerRoutes } from './partners/partner-routes';
import { registerStatic } from './static';

export interface AppOptions {
  version: string;
  logger?: FastifyServerOptions['logger'];
  webDir?: string;
  playerDir?: string;
  db?: Db;
  cookieSecure?: boolean;
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  // Behind Coolify's Traefik: take the client IP from X-Forwarded-For.
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: true });
  app.setErrorHandler((err: { statusCode?: number }, req, reply) => {
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    if (status >= 500) {
      req.log.error({ err }, 'request failed');
      return reply.code(500).send({ error: 'internal' });
    }
    return reply.code(status).send({ error: 'invalid_request' });
  });
  await app.register(healthRoutes, { version: opts.version, db: opts.db });
  if (opts.db) {
    await registerAuth(app, { db: opts.db, cookieSecure: opts.cookieSecure ?? false });
    await app.register(adminPartnerRoutes, { db: opts.db });
    await app.register(partnerRoutes, { db: opts.db });
  }
  await registerStatic(app, { webDir: opts.webDir, playerDir: opts.playerDir });
  return app;
}
