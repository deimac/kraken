import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app';
import type { Db } from '../../src/db/client';
import { LocalStorage } from '../../src/storage/local';
import { createTestDb } from './db';
import { createPartner, createUser, login } from './fixtures';

export async function createTestApp(opts: { maxImageBytes?: number; maxVideoBytes?: number } = {}) {
  const { db, close: closeDb } = await createTestDb();
  const dir = await mkdtemp(join(tmpdir(), 'midora-app-'));
  const storage = new LocalStorage(dir);
  await storage.init();
  const app = await buildApp({
    version: 't',
    db,
    storage,
    uploadLimits: {
      maxImageBytes: opts.maxImageBytes ?? 1024 * 1024,
      maxVideoBytes: opts.maxVideoBytes ?? 4 * 1024 * 1024,
    },
  });
  return {
    app,
    db,
    storage,
    close: async () => {
      await app.close();
      await closeDb();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/** Two partners, each with a manager, plus an admin. */
export async function seed(app: FastifyInstance, db: Db) {
  const partnerA = await createPartner(db, 'parceiro-a');
  const partnerB = await createPartner(db, 'parceiro-b');
  await createUser(db, { email: 'admin@midora.com', password: 'senha-admin-1', role: 'admin' });
  await createUser(db, { email: 'g@a.com', password: 'senha-forte-1', role: 'partner_user', partnerId: partnerA.id });
  await createUser(db, { email: 'g@b.com', password: 'senha-forte-1', role: 'partner_user', partnerId: partnerB.id });
  return {
    partnerA,
    partnerB,
    admin: await login(app, 'admin@midora.com', 'senha-admin-1'),
    gerenteA: await login(app, 'g@a.com', 'senha-forte-1'),
    gerenteB: await login(app, 'g@b.com', 'senha-forte-1'),
  };
}

export function multipart(
  file: { filename: string; contentType: string; data: Buffer },
  fields: Record<string, string> = {},
) {
  const boundary = '----midora' + Math.random().toString(16).slice(2);
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
    ),
    file.data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}
