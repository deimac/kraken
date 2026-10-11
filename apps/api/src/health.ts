import type { FastifyPluginAsync } from 'fastify';
import type { HealthResponse } from '@midora/shared';

export const healthRoutes: FastifyPluginAsync<{ version: string }> = async (app, { version }) => {
  app.get('/api/health', async (): Promise<HealthResponse> => ({ status: 'ok', version }));
};
