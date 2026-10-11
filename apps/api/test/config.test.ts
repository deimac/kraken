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
    });
  });

  it('reads env values', () => {
    const c = loadConfig({
      PORT: '8080', HOST: '127.0.0.1', WEB_DIR: '/w', PLAYER_DIR: '/p',
      APP_VERSION: '1.2.3', LOG_LEVEL: 'debug',
    });
    expect(c).toEqual({
      port: 8080, host: '127.0.0.1', webDir: '/w', playerDir: '/p',
      version: '1.2.3', logLevel: 'debug',
    });
  });

  it('falls back to SOURCE_COMMIT for version', () => {
    expect(loadConfig({ SOURCE_COMMIT: 'abc123' }).version).toBe('abc123');
  });

  it.each(['abc', '0', '70000', '3000.5'])('rejects invalid PORT %s', (port) => {
    expect(() => loadConfig({ PORT: port })).toThrow(`Invalid PORT: ${port}`);
  });
});
