import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { HealthResponse } from '@midora/shared';
import type { Db } from './db/client';

export const healthRoutes: FastifyPluginAsync<{ version: string; db?: Db }> = async (
  app,
  { version, db },
) => {
  app.get('/api/health', async (_req, reply): Promise<HealthResponse> => {
    if (db) {
      try {
        await db.execute(sql`select 1`);
      } catch (err) {
        app.log.error({ err }, 'database health check failed');
        reply.code(503);
        return { status: 'error', version };
      }
    }
    return { status: 'ok', version };
  });
};
