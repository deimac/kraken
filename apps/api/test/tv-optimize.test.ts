import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findFfmpeg, tvVideoArgs } from '../src/media/tv-optimize';
import { probeMp4 } from '../src/media/mp4';
import { createTestApp, multipart, seed } from './helpers/app';
import { pj } from './helpers/fixtures';

describe('TV video arguments', () => {
  it('produce uniform fragmented 1080p30 H.264 + AAC, adding silence when the ad has no sound', () => {
    const silent = tvVideoArgs('in.mp4', 'out.mp4', false).join(' ');
    expect(silent).toContain('anullsrc=channel_layout=stereo:sample_rate=48000');
    expect(silent).toContain('-map 1:a:0');
    expect(silent).toContain('+frag_keyframe+empty_moov+default_base_moof');
    expect(silent).toContain('-profile:v high -level:v 4.0');
    const withSound = tvVideoArgs('in.mp4', 'out.mp4', true).join(' ');
    expect(withSound).not.toContain('anullsrc');
    expect(withSound).toContain('-map 0:a:0');
  });
});

const ffmpeg = findFfmpeg();

describe.skipIf(!ffmpeg)('TV optimization with ffmpeg', () => {
  let t: Awaited<ReturnType<typeof createTestApp>>;
  let s: Awaited<ReturnType<typeof seed>>;
  let source: Buffer;

  beforeAll(async () => {
    const file = join(tmpdir(), `kraken-src-${Date.now()}.mp4`);
    // 2 s, 640×360, 25 fps, no audio: different from the TV format on purpose
    spawnSync(ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25:duration=2',
      '-c:v', 'libx264', '-profile:v', 'main', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file]);
    source = await readFile(file);
    t = await createTestApp({ maxVideoBytes: 8 * 1024 * 1024, ffmpeg: ffmpeg! });
    s = await seed(t.app, t.db);
  }, 60_000);
  afterAll(() => t.close());

  it('optimizes uploaded videos in the background and serves the TV copy and poster', async () => {
    const req = (method: 'GET' | 'POST', url: string, cookie: string, payload?: object) =>
      t.app.inject({ method, url, headers: { cookie }, payload });
    const plan = (await req('POST', '/api/partner/plans', s.gerenteA, { name: 'P', frequencyLevel: 'low' })).json().plan.id;
    const adv = (await req('POST', '/api/partner/advertisers', s.gerenteA, { name: 'A', ...pj() })).json().advertiser.id;
    const c = (await req('POST', '/api/campaigns', s.gerenteA, { advertiserId: adv, planId: plan, startsAt: '2026-01-01T00:00:00Z', endsAt: '2030-01-01T00:00:00Z' })).json().campaign.id;
    const m = multipart({ filename: 'ad.mp4', contentType: 'video/mp4', data: source });
    const up = await t.app.inject({ method: 'POST', url: `/api/campaigns/${c}/pieces`, headers: { cookie: s.gerenteA, ...m.headers }, payload: m.payload });
    expect(up.statusCode).toBe(201);
    const id = up.json().piece.id;

    await t.app.tvOptimizer!.idle();
    const tv = await req('GET', `/api/media/${id}/tv`, s.gerenteA);
    expect(tv.statusCode).toBe(200);
    expect(tv.headers['content-type']).toBe('video/mp4');
    expect(tv.rawPayload.includes(Buffer.from('moof'))).toBe(true); // fragmented: can be appended to MediaSource
    const file = join(tmpdir(), `kraken-tv-${id}.mp4`);
    await (await import('node:fs/promises')).writeFile(file, tv.rawPayload);
    const info = await probeMp4(file);
    expect(info).toMatchObject({ videoCodec: 'avc1', audioCodec: 'mp4a', width: 1920, height: 1080, videoProfile: 100, videoLevel: 40 });

    const poster = await req('GET', `/api/media/${id}/poster`, s.gerenteA);
    expect(poster.headers['content-type']).toBe('image/jpeg');
    expect(poster.rawPayload.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));

    await t.app.inject({ method: 'PUT', url: '/api/partner/player-account', headers: { cookie: s.gerenteA }, payload: { password: 'senha-tv-123' } });
    const tvLogin = await t.app.inject({ method: 'POST', url: '/api/player/login', payload: { email: 'tv@parceiro-a', password: 'senha-tv-123' } });
    const tvCookie = `kraken_tv=${tvLogin.cookies.find((x) => x.name === 'kraken_tv')!.value}`;
    const manifest = (await req('GET', '/api/player/manifest', tvCookie)).json();
    expect(manifest.items[0].media).toMatchObject({ tvUrl: `/api/media/${id}/tv`, posterUrl: `/api/media/${id}/poster` });
    expect(manifest.tvCodecs).toBe('avc1.640028, mp4a.40.2');
  }, 120_000);
});
