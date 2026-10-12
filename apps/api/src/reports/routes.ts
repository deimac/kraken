import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../auth/guard';
import type { Db } from '../db/client';
import { parse } from '../http/validation';
import { playsReport, type ReportScope } from './query';

const MAX_DAYS = 366;
const Range = z
  .object({ from: z.iso.date(), to: z.iso.date() })
  .refine((r) => r.from <= r.to, 'to must not be before from')
  .refine((r) => (Date.parse(r.to) - Date.parse(r.from)) / 86_400_000 < MAX_DAYS, 'period too long');

function scopeFor(req: FastifyRequest): ReportScope {
  const u = req.user!;
  if (u.role === 'partner_user') return { kind: 'partner', partnerId: u.partnerId! };
  if (u.role === 'advertiser') return { kind: 'advertiser', advertiserId: u.advertiserId! };
  return { kind: 'all' };
}

/** Quotes when needed and defuses spreadsheet formulas (names come from self-signup advertisers). */
function csvCell(raw: string): string {
  const v = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[;"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export const reportRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  const guard = { preHandler: requireRole('admin', 'partner_user', 'advertiser') };

  const load = async (req: FastifyRequest, reply: FastifyReply) => {
    const range = parse(Range, req.query, reply);
    if (!range) return null;
    return { range, campaigns: await playsReport(db, scopeFor(req), range) };
  };

  app.get('/api/reports/plays', guard, async (req, reply) => {
    const r = await load(req, reply);
    if (!r) return reply;
    return { from: r.range.from, to: r.range.to, campaigns: r.campaigns };
  });

  app.get('/api/reports/plays.csv', guard, async (req, reply) => {
    const r = await load(req, reply);
    if (!r) return reply;
    const lines = ['campanha;anunciante;tipo;dia;insercoes'];
    for (const c of r.campaigns) {
      const kind = c.kind === 'institutional' ? 'institucional' : 'comercial';
      for (const d of c.days) {
        lines.push([c.name, c.advertiserName ?? 'Midora', kind, d.day, String(d.count)].map(csvCell).join(';'));
      }
    }
    reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="insercoes-${r.range.from}-a-${r.range.to}.csv"`);
    // BOM so Excel opens the accents correctly.
    return `\uFEFF${lines.join('\r\n')}\r\n`;
  });
};
