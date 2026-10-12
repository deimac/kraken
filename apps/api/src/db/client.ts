import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { Pool } from 'pg';
import * as schema from './schema';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export function createDb(url: string) {
  const pool = new Pool({ connectionString: url, max: 10 });
  const nodeDb = drizzle(pool, { schema });
  return {
    db: nodeDb as unknown as Db,
    migrate: (migrationsFolder: string) => migrate(nodeDb, { migrationsFolder }),
    close: () => pool.end(),
  };
}
