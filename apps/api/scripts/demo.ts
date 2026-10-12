// Local demo only: in-memory Postgres (PGlite), temp media dir, seeded test users.
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { buildApp } from '../src/app';
import { hashPassword } from '../src/auth/password';
import type { Db } from '../src/db/client';
import * as schema from '../src/db/schema';
import { LocalStorage } from '../src/storage/local';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/** Solid-color PNG so the demo player has something to show. */
function solidPng(width: number, height: number, [r, g, b]: [number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3).map((_, i) => [r, g, b][i % 3]!)]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
const DEMO_PASSWORD = 'demo-midora-123';

const client = new PGlite();
const pg = drizzle(client, { schema });
await migrate(pg, { migrationsFolder: here('../drizzle') });
const db = pg as unknown as Db;

const [krakenPlan] = await db.insert(schema.krakenPlans).values({ name: 'Essencial', priceCents: 9900 }).returning();
const [partner] = await db
  .insert(schema.partners)
  .values({ name: 'Academia Demo', slug: 'academia-demo', showInstitutional: true, krakenPlanId: krakenPlan!.id })
  .returning();
const [advertiser] = await db
  .insert(schema.advertisers)
  .values({ partnerId: partner!.id, name: 'Loja Demo', source: 'self_signup', email: 'anunciante@demo.test' })
  .returning();
const hash = await hashPassword(DEMO_PASSWORD);
await db.insert(schema.users).values([
  { email: 'admin@demo.test', passwordHash: hash, role: 'admin' },
  { email: 'parceiro@demo.test', passwordHash: hash, role: 'partner_user', partnerId: partner!.id },
  { email: 'anunciante@demo.test', passwordHash: hash, role: 'advertiser', partnerId: partner!.id, advertiserId: advertiser!.id },
  { email: 'tv@academia-demo', passwordHash: hash, role: 'player', partnerId: partner!.id },
]);
const [bronze, ouro] = await db
  .insert(schema.plans)
  .values([
    { partnerId: partner!.id, name: 'Bronze', frequencyLevel: 'low', description: 'Presença básica' },
    { partnerId: partner!.id, name: 'Ouro', frequencyLevel: 'high', description: 'Mais exibições' },
  ])
  .returning();

const storage = new LocalStorage(await mkdtemp(join(tmpdir(), 'midora-demo-')));
await storage.init();

// Two approved campaigns playing now, with different colors so transitions are visible.
for (const [name, plan, color, seconds] of [
  ['Esmeralda', ouro!, [14, 138, 95], 4],
  ['Âmbar', bronze!, [232, 163, 61], 4],
] as const) {
  const [c] = await db
    .insert(schema.campaigns)
    .values({
      kind: 'commercial', partnerId: partner!.id, advertiserId: advertiser!.id, planId: plan.id, name,
      status: 'approved', frequencyLevel: plan.frequencyLevel,
      startsAt: new Date(Date.now() - 86_400_000), endsAt: new Date(Date.now() + 30 * 86_400_000),
    })
    .returning();
  const png = solidPng(1280, 720, [...color]);
  const id = randomUUID();
  const key = `${partner!.id}/${id}.png`;
  const tmp = storage.tmpPath();
  await writeFile(tmp, png);
  await storage.saveFrom(tmp, key);
  await db.insert(schema.media).values({
    id, partnerId: partner!.id, campaignId: c!.id, storageKey: key, mediaType: 'image', mime: 'image/png',
    sizeBytes: png.length, sha256: randomUUID().replace(/-/g, ''), displaySeconds: seconds,
  });
  await db.update(schema.campaigns).set({ currentMediaId: id }).where(eq(schema.campaigns.id, c!.id));
}
const app = await buildApp({
  version: 'demo',
  logger: false,
  db,
  storage,
  uploadLimits: { maxImageBytes: 10 * 1024 * 1024, maxVideoBytes: 200 * 1024 * 1024, minFreeBytes: 0, uploadsPerHour: 1000 },
  webDir: here('../../web/dist'),
  playerDir: here('../../player/dist'),
});
await app.listen({ port: 3100, host: '127.0.0.1' });
console.log('Midora demo em http://localhost:3100 — usuários *@demo.test, senha em apps/api/scripts/demo.ts');
