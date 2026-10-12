import type { FastifyInstance } from 'fastify';
import { hashPassword } from '../../src/auth/password';
import type { Db } from '../../src/db/client';
import { partners, users, type Role } from '../../src/db/schema';

export async function createPartner(db: Db, slug: string, status: 'active' | 'inactive' = 'active') {
  const [p] = await db.insert(partners).values({ name: `Parceiro ${slug}`, slug, status }).returning();
  return p!;
}

export async function createUser(
  db: Db,
  u: { email: string; password: string; role: Role; partnerId?: string; advertiserId?: string },
) {
  const [row] = await db
    .insert(users)
    .values({
      email: u.email,
      passwordHash: await hashPassword(u.password),
      role: u.role,
      partnerId: u.partnerId ?? null,
      advertiserId: u.advertiserId ?? null,
    })
    .returning();
  return row!;
}

export async function login(app: FastifyInstance, email: string, password: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  const c = res.cookies.find((x) => x.name === 'kraken_session');
  return `kraken_session=${c!.value}`;
}

/** Signs in on the TV endpoint; returns the TV cookie header value. */
export async function loginTv(app: FastifyInstance, email: string, password: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/player/login', payload: { email, password } });
  if (res.statusCode !== 200) throw new Error(`tv login failed: ${res.statusCode} ${res.body}`);
  const c = res.cookies.find((x) => x.name === 'kraken_tv');
  return `kraken_tv=${c!.value}`;
}

let cnpjSeq = 0;
/** A fresh valid CNPJ body for advertiser payloads (unique per call). */
export function pj(): { personType: 'pj'; document: string } {
  const base = String(10000000 + ++cnpjSeq).padStart(8, '0') + '0001';
  const dv = (d: string, w: number[]) => {
    const r = w.reduce((s, x, i) => s + Number(d[i]) * x, 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = dv(base + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return { personType: 'pj', document: `${base}${d1}${d2}` };
}
