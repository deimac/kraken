import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

export async function registerStatic(
  app: FastifyInstance,
  { webDir, playerDir }: { webDir?: string; playerDir?: string },
): Promise<void> {
  // Only the first registration may decorate reply.sendFile.
  let decorated = false;
  for (const [root, prefix] of [[playerDir, '/player/'], [webDir, '/']] as const) {
    if (!root) continue;
    await app.register(fastifyStatic, { root, prefix, decorateReply: !decorated, redirect: true });
    decorated = true;
  }

  app.setNotFoundHandler((req, reply) => {
    const path = req.url.split('?')[0] ?? '';
    const isApi = path === '/api' || path.startsWith('/api/');
    // A missing file (last segment has an extension) must 404, not get index.html.
    const isFile = /\.[^/]+$/.test(path);
    if (req.method !== 'GET' || isApi || isFile) {
      return reply.code(404).send({ error: 'not_found' });
    }
    if (playerDir && path.startsWith('/player')) {
      return reply.type('text/html').sendFile('index.html', playerDir);
    }
    if (webDir) {
      return reply.type('text/html').sendFile('index.html', webDir);
    }
    return reply.code(404).send({ error: 'not_found' });
  });
}
