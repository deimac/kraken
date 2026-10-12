import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

describe('loadConfig', () => {
  it('uses defaults', () => {
    expect(loadConfig({})).toEqual({
      port: 3000,
      host: '0.0.0.0',
      webDir: undefined,
      playerDir: undefined,
      version: 'dev',
      logLevel: 'info',
      databaseUrl: undefined,
      cookieSecure: true,
      adminEmail: undefined,
      adminPassword: undefined,
      mediaDir: './data/media',
      maxImageMb: 10,
      maxVideoMb: 200,
    });
  });

  it('reads env values', () => {
    const c = loadConfig({
      PORT: '8080', HOST: '127.0.0.1', WEB_DIR: '/w', PLAYER_DIR: '/p',
      APP_VERSION: '1.2.3', LOG_LEVEL: 'debug', DATABASE_URL: 'postgres://x',
      COOKIE_SECURE: 'true', ADMIN_EMAIL: 'a@b.com', ADMIN_PASSWORD: 'secret-pass-123',
      MEDIA_DIR: '/data/media', MAX_IMAGE_MB: '5', MAX_VIDEO_MB: '100',
    });
    expect(c).toEqual({
      port: 8080, host: '127.0.0.1', webDir: '/w', playerDir: '/p',
      version: '1.2.3', logLevel: 'debug', databaseUrl: 'postgres://x',
      cookieSecure: true, adminEmail: 'a@b.com', adminPassword: 'secret-pass-123',
      mediaDir: '/data/media', maxImageMb: 5, maxVideoMb: 100,
    });
  });

  it('only disables secure cookies when COOKIE_SECURE is exactly false', () => {
    expect(loadConfig({ COOKIE_SECURE: 'false' }).cookieSecure).toBe(false);
    expect(loadConfig({ COOKIE_SECURE: 'no' }).cookieSecure).toBe(true);
  });

  it('rejects invalid upload limits', () => {
    expect(() => loadConfig({ MAX_VIDEO_MB: '0' })).toThrow('Invalid MAX_VIDEO_MB: 0');
    expect(() => loadConfig({ MAX_IMAGE_MB: 'x' })).toThrow('Invalid MAX_IMAGE_MB: x');
  });

  it('falls back to SOURCE_COMMIT for version', () => {
    expect(loadConfig({ SOURCE_COMMIT: 'abc123' }).version).toBe('abc123');
  });

  it.each(['abc', '0', '70000', '3000.5'])('rejects invalid PORT %s', (port) => {
    expect(() => loadConfig({ PORT: port })).toThrow(`Invalid PORT: ${port}`);
  });
});
