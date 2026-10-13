import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { expect, it } from 'vitest';

const id = (n: number) => `0190a000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const [P, PLAN, ADV, U, C1, C2, C3, M1, M2, M3] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(id) as [string, string, string, string, string, string, string, string, string, string];

// Production has campaigns with a current media and older replaced media, reviews and plays when 0008 runs.
it('0008 turns campaigns into subscriptions with pieces, keeping plays', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kraken-drizzle-'));
  await cp(fileURLToPath(new URL('../drizzle', import.meta.url)), dir, { recursive: true });
  const journalPath = join(dir, 'meta/_journal.json');
  const full = await readFile(journalPath, 'utf8');
  const journal = JSON.parse(full) as { entries: { tag: string }[] };
  journal.entries = journal.entries.filter((e) => e.tag < '0008');
  await writeFile(journalPath, JSON.stringify(journal));

  const client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: dir });
  const media = (m: string, c: string, type = 'video') =>
    `insert into media (id, partner_id, campaign_id, storage_key, media_type, mime, size_bytes, duration_ms, sha256, display_seconds)
     values ('${m}', '${P}', '${c}', 'k/${m}', '${type}', 'video/mp4', 10, 15000, 'x', null);`;
  await client.exec(`
    insert into partners (id, name, slug) values ('${P}', 'A', 'a');
    insert into plans (id, partner_id, name, frequency_level, price_cents) values ('${PLAN}', '${P}', 'Ouro', 'high', 30000);
    insert into advertisers (id, partner_id, name, source) values ('${ADV}', '${P}', 'Loja', 'manual');
    insert into users (id, email, password_hash, role, partner_id) values ('${U}', 'g@a.com', 'h', 'partner_user', '${P}');
    insert into campaigns (id, partner_id, advertiser_id, plan_id, kind, name, starts_at, ends_at, status, frequency_level)
      values ('${C1}', '${P}', '${ADV}', '${PLAN}', 'commercial', 'Aprovada', now(), now() + interval '1 day', 'approved', 'high'),
             ('${C2}', '${P}', '${ADV}', '${PLAN}', 'commercial', 'Rascunho', now(), now() + interval '1 day', 'pending_review', 'high'),
             ('${C3}', '${P}', '${ADV}', '${PLAN}', 'commercial', 'Cancelada', now(), now() + interval '1 day', 'cancelled', 'high');
    ${media(M1, C1)} ${media(M2, C1)} ${media(M3, C2)}
    update campaigns set current_media_id = '${M2}' where id = '${C1}';
    update campaigns set current_media_id = '${M3}' where id = '${C2}';
    insert into campaign_reviews (campaign_id, action, actor_user_id) values ('${C1}', 'approved', '${U}');
    insert into plays (id, campaign_id, partner_id, media_id, media_type, played_at)
      values ('${id(99)}', '${C1}', '${P}', '${M1}', 'video', now());
  `);

  await writeFile(journalPath, full);
  await migrate(db, { migrationsFolder: dir });

  const { rows: camps } = await client.query('select id, status, price_cents, payment_status from campaigns order by name');
  expect(camps).toEqual([
    { id: C1, status: 'active', price_cents: 30000, payment_status: 'pending' },
    { id: C3, status: 'cancelled', price_cents: 30000, payment_status: 'pending' },
    { id: C2, status: 'paused', price_cents: 30000, payment_status: 'pending' },
  ]);
  const { rows: pieces } = await client.query('select id, status from media order by id');
  expect(pieces).toEqual([
    { id: M1, status: 'removed' },
    { id: M2, status: 'approved' },
    { id: M3, status: 'approved' },
  ]);
  const { rows: cols } = await client.query(
    `select column_name from information_schema.columns where table_name = 'campaigns' and column_name = 'current_media_id'`,
  );
  expect(cols).toEqual([]);
  expect((await client.query('select count(*)::int as n from plays')).rows).toEqual([{ n: 1 }]);
  expect((await client.query('select count(*)::int as n from campaign_reviews')).rows).toEqual([{ n: 1 }]);
  await expect(client.exec(`update campaigns set status = 'approved' where id = '${C1}'`)).rejects.toThrow();

  await client.close();
  await rm(dir, { recursive: true, force: true });
}, 60_000);
