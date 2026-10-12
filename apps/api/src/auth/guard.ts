import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Role } from '../db/schema';

export function requireRole(...roles: Role[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) return reply.code(401).send({ error: 'unauthenticated' });
    if (!roles.includes(req.user.role)) return reply.code(403).send({ error: 'forbidden' });
  };
}
