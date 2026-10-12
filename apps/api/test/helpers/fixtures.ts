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
  const c = res.cookies.find((x) => x.name === 'midora_session');
  return `midora_session=${c!.value}`;
}
