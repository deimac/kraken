import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { Pool } from 'pg';
import * as schema from './schema';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export function createDb(url: string, onPoolError: (err: Error) => void = () => {}) {
  const pool = new Pool({ connectionString: url, max: 10, connectionTimeoutMillis: 5000 });
  // Without a listener, an idle client dropped by a Postgres restart crashes the process.
  pool.on('error', onPoolError);
  const nodeDb = drizzle(pool, { schema });
  return {
    pool,
    db: nodeDb as unknown as Db,
    migrate: (migrationsFolder: string) => migrate(nodeDb, { migrationsFolder }),
    close: () => pool.end(),
  };
}
