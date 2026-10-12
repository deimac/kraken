import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { registerAuth } from './auth/plugin';
import type { Db } from './db/client';
import { healthRoutes } from './health';
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
  const app = Fastify({ logger: opts.logger ?? false });
  await app.register(healthRoutes, { version: opts.version, db: opts.db });
  if (opts.db) {
    await registerAuth(app, { db: opts.db, cookieSecure: opts.cookieSecure ?? false });
  }
  await registerStatic(app, { webDir: opts.webDir, playerDir: opts.playerDir });
  return app;
}
