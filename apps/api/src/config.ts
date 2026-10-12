export interface Config {
  port: number;
  host: string;
  webDir?: string;
  playerDir?: string;
  version: string;
  logLevel: string;
  databaseUrl?: string;
  cookieSecure: boolean;
  adminEmail?: string;
  adminPassword?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const rawPort = env.PORT ?? '3000';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${rawPort}`);
  }
  return {
    port,
    host: env.HOST ?? '0.0.0.0',
    webDir: env.WEB_DIR || undefined,
    playerDir: env.PLAYER_DIR || undefined,
    version: env.APP_VERSION ?? env.SOURCE_COMMIT ?? 'dev',
    logLevel: env.LOG_LEVEL ?? 'info',
    databaseUrl: env.DATABASE_URL || undefined,
    cookieSecure: env.COOKIE_SECURE === 'true',
    adminEmail: env.ADMIN_EMAIL || undefined,
    adminPassword: env.ADMIN_PASSWORD || undefined,
  };
}
