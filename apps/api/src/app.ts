import multipart from '@fastify/multipart';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { registerAuth } from './auth/plugin';
import { adminCampaignRoutes } from './campaigns/admin-routes';
import { campaignRoutes } from './campaigns/routes';
import { catalogRoutes } from './catalog/routes';
import type { Db } from './db/client';
import { healthRoutes } from './health';
import { mediaRoutes } from './media/routes';
import { midoraPlanRoutes } from './midora-plans/routes';
import { registerCsrfGuard } from './http/csrf';
import type { UploadLimits } from './media/upload';
import { adminPartnerRoutes } from './partners/admin-routes';
import { partnerRoutes } from './partners/partner-routes';
import { playerRoutes } from './player/routes';
import { playRoutes } from './plays/routes';
import { publicRoutes } from './public/routes';
import { registerStatic } from './static';
import type { LocalStorage } from './storage/local';

export interface AppOptions {
  version: string;
  logger?: FastifyServerOptions['logger'];
  webDir?: string;
  playerDir?: string;
  db?: Db;
  cookieSecure?: boolean;
  storage?: LocalStorage;
  uploadLimits?: UploadLimits;
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
    registerCsrfGuard(app);
    await registerAuth(app, { db: opts.db, cookieSecure: opts.cookieSecure ?? false });
    await app.register(adminPartnerRoutes, { db: opts.db });
    await app.register(midoraPlanRoutes, { db: opts.db });
    await app.register(partnerRoutes, { db: opts.db });
    await app.register(catalogRoutes, { db: opts.db });
    await app.register(publicRoutes, { db: opts.db, cookieSecure: opts.cookieSecure ?? false });
    await app.register(playerRoutes, { db: opts.db, cookieSecure: opts.cookieSecure ?? false });
    await app.register(playRoutes, { db: opts.db });
    await app.register(multipart, { limits: { fileSize: opts.uploadLimits?.maxVideoBytes, files: 1, fields: 10 } });
    await app.register(campaignRoutes, { db: opts.db, storage: opts.storage, uploadLimits: opts.uploadLimits });
    await app.register(adminCampaignRoutes, { db: opts.db, storage: opts.storage, uploadLimits: opts.uploadLimits });
    if (opts.storage) await app.register(mediaRoutes, { db: opts.db, storage: opts.storage });
  }
  await registerStatic(app, { webDir: opts.webDir, playerDir: opts.playerDir });
  return app;
}
