import { buildApp } from './app';
import { loadConfig } from './config';
import { loggerOptions } from './logger';

const config = loadConfig();
const app = await buildApp({
  version: config.version,
  logger: loggerOptions(config.logLevel),
  webDir: config.webDir,
  playerDir: config.playerDir,
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, async () => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    process.exit(0);
  });
}

await app.listen({ port: config.port, host: config.host });
