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
  mediaDir: string;
  maxImageMb: number;
  maxVideoMb: number;
  minFreeDiskMb: number;
  uploadsPerHour: number;
}

function positiveNumber(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid ${name}: ${raw}`);
  return n;
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
    cookieSecure: env.COOKIE_SECURE !== 'false',
    adminEmail: env.ADMIN_EMAIL || undefined,
    adminPassword: env.ADMIN_PASSWORD || undefined,
    mediaDir: env.MEDIA_DIR || './data/media',
    maxImageMb: positiveNumber(env, 'MAX_IMAGE_MB', 10),
    maxVideoMb: positiveNumber(env, 'MAX_VIDEO_MB', 200),
    minFreeDiskMb: positiveNumber(env, 'MIN_FREE_DISK_MB', 2048),
    uploadsPerHour: positiveNumber(env, 'UPLOADS_PER_HOUR', 30),
  };
}
