import { expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { loggerOptions } from '../src/logger';

it('redacts secrets from logs', async () => {
  const lines: string[] = [];
  const app = await buildApp({
    version: 't',
    logger: loggerOptions('info', { write: (l) => { lines.push(l); } }),
  });
  app.log.info(
    { headers: { authorization: 'Bearer s3cr3t', cookie: 'sid=s3cr3t' }, password: 's3cr3t' },
    'probe',
  );
  const out = lines.join('');
  expect(out).toContain('probe');
  expect(out).not.toContain('s3cr3t');
  expect(out).toContain('[redacted]');
  await app.close();
});
