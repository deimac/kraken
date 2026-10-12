// Local demo only: in-memory Postgres (PGlite), temp media dir, seeded test users.
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { buildApp } from '../src/app';
import { hashPassword } from '../src/auth/password';
import type { Db } from '../src/db/client';
import * as schema from '../src/db/schema';
import { LocalStorage } from '../src/storage/local';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const DEMO_PASSWORD = 'demo-midora-123';

const client = new PGlite();
const pg = drizzle(client, { schema });
await migrate(pg, { migrationsFolder: here('../drizzle') });
const db = pg as unknown as Db;

const [midoraPlan] = await db.insert(schema.midoraPlans).values({ name: 'Essencial', priceCents: 9900 }).returning();
const [partner] = await db
  .insert(schema.partners)
  .values({ name: 'Academia Demo', slug: 'academia-demo', showInstitutional: true, midoraPlanId: midoraPlan!.id })
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
]);
await db.insert(schema.plans).values([
  { partnerId: partner!.id, name: 'Bronze', frequencyLevel: 'low', description: 'Presença básica' },
  { partnerId: partner!.id, name: 'Ouro', frequencyLevel: 'high', description: 'Mais exibições' },
]);

const storage = new LocalStorage(await mkdtemp(join(tmpdir(), 'midora-demo-')));
await storage.init();
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
