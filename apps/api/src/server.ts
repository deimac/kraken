import { fileURLToPath } from 'node:url';
import { buildApp } from './app';
import { ensureAdmin } from './bootstrap';
import { loadConfig } from './config';
import { createDb } from './db/client';
import { loggerOptions } from './logger';
import { findFfmpeg } from './media/tv-optimize';
import { LocalStorage } from './storage/local';

const config = loadConfig();
if (!config.databaseUrl) throw new Error('DATABASE_URL is required');

const database = createDb(config.databaseUrl);
await database.migrate(fileURLToPath(new URL('../drizzle', import.meta.url)));

const storage = new LocalStorage(config.mediaDir);
await storage.init();

const app = await buildApp({
  version: config.version,
  logger: loggerOptions(config.logLevel),
  webDir: config.webDir,
  playerDir: config.playerDir,
  db: database.db,
  cookieSecure: config.cookieSecure,
  storage,
  // TV-optimized copies of videos need ffmpeg (installed in the Docker image); without it videos play as uploaded.
  ffmpeg: process.env.TV_OPTIMIZE === 'off' ? null : findFfmpeg(),
  uploadLimits: {
    maxImageBytes: config.maxImageMb * 1024 * 1024,
    maxVideoBytes: config.maxVideoMb * 1024 * 1024,
    minFreeBytes: config.minFreeDiskMb * 1024 * 1024,
    uploadsPerHour: config.uploadsPerHour,
  },
});

database.pool.on('error', (err) => app.log.error({ err }, 'postgres pool error'));

if (config.adminEmail && config.adminPassword) {
  const result = await ensureAdmin(database.db, { email: config.adminEmail, password: config.adminPassword });
  app.log.info({ result }, 'admin bootstrap');
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, async () => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await database.close();
    process.exit(0);
  });
}

await app.listen({ port: config.port, host: config.host });
app.log.info({ tvOptimize: Boolean(app.tvOptimizer) }, 'tv optimization');
// Videos uploaded before the optimizer existed (or while it was off) are processed in the background.
void app.tvOptimizer?.backfill().catch((err) => app.log.error({ err }, 'tv optimization backfill'));
