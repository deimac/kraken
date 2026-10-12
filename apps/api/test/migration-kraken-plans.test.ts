import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { expect, it } from 'vitest';

const PLAN = '0190a000-0000-7000-8000-000000000001';

// Production already has plans and partners linked to them when 0005 runs.
it('0005 renames midora_plans to kraken_plans keeping rows and links', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kraken-drizzle-'));
  await cp(fileURLToPath(new URL('../drizzle', import.meta.url)), dir, { recursive: true });
  const journalPath = join(dir, 'meta/_journal.json');
  const full = await readFile(journalPath, 'utf8');
  const journal = JSON.parse(full) as { entries: { tag: string }[] };
  journal.entries = journal.entries.filter((e) => e.tag < '0005');
  await writeFile(journalPath, JSON.stringify(journal));

  const client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: dir });
  await client.exec(`
    insert into midora_plans (id, name, price_cents) values ('${PLAN}', 'Essencial', 9900);
    insert into partners (name, slug, midora_plan_id) values ('A', 'a', '${PLAN}');
  `);

  await writeFile(journalPath, full);
  await migrate(db, { migrationsFolder: dir });
  const { rows } = await client.query(
    'select p.slug, k.name, k.price_cents from partners p join kraken_plans k on k.id = p.kraken_plan_id',
  );
  expect(rows).toEqual([{ slug: 'a', name: 'Essencial', price_cents: 9900 }]);
  await expect(client.exec(`insert into kraken_plans (name, price_cents) values ('X', -1)`)).rejects.toThrow();

  await client.close();
  await rm(dir, { recursive: true, force: true });
}, 30_000);
