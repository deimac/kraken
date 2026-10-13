import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, multipart, seed } from './helpers/app';
import { login, pj } from './helpers/fixtures';
import { PNG_BYTES, buildMp4 } from './helpers/mp4';

let t: Awaited<ReturnType<typeof createTestApp>>;
let s: Awaited<ReturnType<typeof seed>>;
let campaignId: string;

const req = (method: 'GET' | 'POST', url: string, cookie?: string, payload?: unknown, headers: Record<string, string> = {}) =>
  t.app.inject({ method, url, headers: { ...(cookie ? { cookie } : {}), ...headers }, payload: payload as object });

const upload = (url: string, cookie: string, file: { filename: string; contentType: string; data: Buffer }) => {
  const m = multipart(file);
  return t.app.inject({ method: 'POST', url, headers: { cookie, ...m.headers }, payload: m.payload });
};

const tmpFiles = () => readdir(join(t.storage.root, 'tmp'));

beforeAll(async () => {
  t = await createTestApp({ maxImageBytes: 1024, maxVideoBytes: 64 * 1024 });
  s = await seed(t.app, t.db);
  const plan = (await req('POST', '/api/partner/plans', s.gerenteA, { name: 'P', frequencyLevel: 'medium', maxVideos: 50, maxImages: 50, maxVideoSeconds: 300 })).json().plan.id;
  const adv = (await req('POST', '/api/partner/advertisers', s.gerenteA, { name: 'A', ...pj() })).json().advertiser.id;
  campaignId = (await req('POST', '/api/campaigns', s.gerenteA, {
    advertiserId: adv, planId: plan, name: 'Mídia', startsAt: '2026-01-01T00:00:00Z', endsAt: '2030-01-01T00:00:00Z',
  })).json().campaign.id;
});
afterAll(() => t.close());

describe('upload validation', () => {
  it('accepts a PNG with display seconds and a valid H.264 MP4', async () => {
    const img = await upload(`/api/campaigns/${campaignId}/pieces?displaySeconds=15`, s.gerenteA, { filename: 'x.png', contentType: 'image/png', data: PNG_BYTES });
    expect(img.statusCode).toBe(201);
    expect(img.json().piece).toMatchObject({ mediaType: 'image', mime: 'image/png', displaySeconds: 15, durationMs: null });

    const vid = await upload(`/api/campaigns/${campaignId}/pieces`, s.gerenteA, { filename: 'v.mp4', contentType: 'video/mp4', data: buildMp4({ durationMs: 12000 }) });
    expect(vid.statusCode).toBe(201);
    expect(vid.json().piece).toMatchObject({ mediaType: 'video', mime: 'video/mp4', durationMs: 12000, displaySeconds: null });
  });

  it('uses the partner default image duration', async () => {
    const img = await upload(`/api/campaigns/${campaignId}/pieces`, s.gerenteA, { filename: 'x.png', contentType: 'image/png', data: PNG_BYTES });
    expect(img.json().piece.displaySeconds).toBe(10);
  });

  it('rejects fake, HEVC and oversized files without leaving temp files', async () => {
    const fake = await upload(`/api/campaigns/${campaignId}/pieces`, s.gerenteA, { filename: 'v.mp4', contentType: 'video/mp4', data: Buffer.from('this is plain text, not a video') });
    expect(fake.statusCode).toBe(415);
    const hevc = await upload(`/api/campaigns/${campaignId}/pieces`, s.gerenteA, { filename: 'h.mp4', contentType: 'video/mp4', data: buildMp4({ video: 'hvc1' }) });
    expect(hevc.json()).toEqual({ error: 'unsupported_media' });
    const big = await upload(`/api/campaigns/${campaignId}/pieces`, s.gerenteA, { filename: 'big.png', contentType: 'image/png', data: Buffer.concat([PNG_BYTES, Buffer.alloc(4096)]) });
    expect(big.json()).toEqual({ error: 'file_too_large' });
    const tooLong = await upload(`/api/campaigns/${campaignId}/pieces`, s.gerenteA, { filename: 'v.mp4', contentType: 'video/mp4', data: Buffer.concat([buildMp4(), Buffer.alloc(80 * 1024)]) });
    expect(tooLong.json()).toEqual({ error: 'file_too_large' });
    const bad = await upload(`/api/campaigns/${campaignId}/pieces?displaySeconds=0`, s.gerenteA, { filename: 'x.png', contentType: 'image/png', data: PNG_BYTES });
    expect(bad.statusCode).toBe(400);
    expect(await tmpFiles()).toEqual([]);
  });

  it('rejects H.264 profiles, levels and sizes TVs cannot decode', async () => {
    for (const opts of [{ profile: 110 }, { level: 52 }, { width: 4096, height: 2160 }]) {
      const res = await upload(`/api/campaigns/${campaignId}/pieces`, s.gerenteA, { filename: 'v.mp4', contentType: 'video/mp4', data: buildMp4(opts) });
      expect(res.json(), JSON.stringify(opts)).toEqual({ error: 'unsupported_media' });
    }
  });

  it('requires a multipart file', async () => {
    expect((await req('POST', `/api/campaigns/${campaignId}/pieces`, s.gerenteA, { a: 1 })).json()).toEqual({ error: 'file_required' });
  });
});

describe('media delivery', () => {
  let mediaId: string;
  let size: number;
  beforeAll(async () => {
    const data = buildMp4({ durationMs: 3000 });
    size = data.length;
    mediaId = (await upload(`/api/campaigns/${campaignId}/pieces`, s.gerenteA, { filename: 'v.mp4', contentType: 'video/mp4', data })).json().piece.id;
  });

  it('serves the whole file with cache headers and supports ETag', async () => {
    const res = await req('GET', `/api/media/${mediaId}`, s.gerenteA);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('video/mp4');
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(Number(res.headers['content-length'])).toBe(size);
    expect(res.rawPayload.length).toBe(size);
    const etag = res.headers.etag as string;
    expect((await req('GET', `/api/media/${mediaId}`, s.gerenteA, undefined, { 'if-none-match': etag })).statusCode).toBe(304);
  });

  it('serves byte ranges and rejects invalid ones', async () => {
    const a = await req('GET', `/api/media/${mediaId}`, s.gerenteA, undefined, { range: 'bytes=0-9' });
    expect(a.statusCode).toBe(206);
    expect(a.headers['content-range']).toBe(`bytes 0-9/${size}`);
    expect(a.rawPayload.length).toBe(10);
    const b = await req('GET', `/api/media/${mediaId}`, s.gerenteA, undefined, { range: 'bytes=-5' });
    expect(b.headers['content-range']).toBe(`bytes ${size - 5}-${size - 1}/${size}`);
    const c = await req('GET', `/api/media/${mediaId}`, s.gerenteA, undefined, { range: `bytes=${size - 3}-` });
    expect(c.rawPayload.length).toBe(3);
    const d = await req('GET', `/api/media/${mediaId}`, s.gerenteA, undefined, { range: `bytes=${size + 10}-` });
    expect(d.statusCode).toBe(416);
    expect(d.headers['content-range']).toBe(`bytes */${size}`);
  });

  it('is visible to the same partner, not to other partners; TVs only see eligible media', async () => {
    await t.app.inject({ method: 'PUT', url: '/api/partner/player-account', headers: { cookie: s.gerenteA }, payload: { password: 'senha-tv-123' } });
    const tv = await login(t.app, 'tv@parceiro-a', 'senha-tv-123');
    await req('POST', `/api/campaigns/${campaignId}/pause`, s.gerenteA);
    expect((await req('GET', `/api/media/${mediaId}`, tv)).statusCode).toBe(404); // not eligible (paused)
    await req('POST', `/api/campaigns/${campaignId}/resume`, s.gerenteA);
    expect((await req('GET', `/api/media/${mediaId}`, s.gerenteB)).statusCode).toBe(404);
    expect((await req('GET', `/api/media/${mediaId}`)).statusCode).toBe(401);
  });
});

describe('institutional campaigns', () => {
  it('admin creates an approved institutional campaign with media; partners cannot', async () => {
    const res = await req('POST', '/api/admin/campaigns', s.admin, {
      name: 'Anuncie aqui', frequencyLevel: 'low', startsAt: '2026-01-01T00:00:00Z', endsAt: '2030-01-01T00:00:00Z',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().campaign).toMatchObject({ kind: 'institutional', status: 'active', partnerId: null });
    const id = res.json().campaign.id;
    const m = await upload(`/api/admin/campaigns/${id}/pieces`, s.admin, { filename: 'i.png', contentType: 'image/png', data: PNG_BYTES });
    expect(m.statusCode).toBe(201);
    expect((await req('GET', `/api/media/${m.json().piece.id}`, s.gerenteB)).statusCode).toBe(200);
    expect((await req('POST', '/api/admin/campaigns', s.gerenteA, { name: 'x', frequencyLevel: 'low', startsAt: '2026-01-01T00:00:00Z', endsAt: '2030-01-01T00:00:00Z' })).statusCode).toBe(403);
    expect((await req('POST', `/api/admin/campaigns/${id}/cancel`, s.admin)).json().campaign.status).toBe('cancelled');
    expect((await req('GET', '/api/admin/campaigns', s.admin)).json().campaigns.map((c: { id: string }) => c.id)).toContain(id);
  });

  it('advertisers only see media of their own campaigns', async () => {
    const signup = await req('POST', '/api/public/partners/parceiro-a/advertisers', undefined, {
      companyName: 'Outra', contactName: 'O', email: 'o@x.com', password: 'senha-anunc-1', ...pj(),
    });
    const cookie = `kraken_session=${signup.cookies.find((c) => c.name === 'kraken_session')!.value}`;
    const detail = (await req('GET', `/api/campaigns/${campaignId}`, s.gerenteA)).json();
    expect((await req('GET', `/api/media/${detail.pieces[0].id}`, cookie)).statusCode).toBe(404);
  });
});
