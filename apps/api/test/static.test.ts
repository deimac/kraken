import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

let root: string;
let app: FastifyInstance;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'midora-static-'));
  const web = join(root, 'web');
  const player = join(root, 'player');
  await mkdir(join(web, 'assets'), { recursive: true });
  await mkdir(player, { recursive: true });
  await writeFile(join(web, 'index.html'), '<p>WEB-INDEX</p>');
  await writeFile(join(web, 'assets', 'app.js'), 'console.log("web")');
  await writeFile(join(player, 'index.html'), '<p>PLAYER-INDEX</p>');
  app = await buildApp({ version: 't', webDir: web, playerDir: player });
});

afterAll(async () => {
  await app.close();
  await rm(root, { recursive: true, force: true });
});

const get = (url: string) => app.inject({ method: 'GET', url });

describe('static serving', () => {
  it('serves web index at /', async () => {
    expect((await get('/')).body).toContain('WEB-INDEX');
  });

  it('serves web assets', async () => {
    expect((await get('/assets/app.js')).body).toContain('console.log("web")');
  });

  it('falls back to web index for SPA routes', async () => {
    const res = await get('/parceiro/campanhas');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('WEB-INDEX');
  });

  it('serves player index at /player/', async () => {
    expect((await get('/player/')).body).toContain('PLAYER-INDEX');
  });

  it('falls back to player index for deep player routes', async () => {
    const res = await get('/player/login');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('PLAYER-INDEX');
  });

  it('returns JSON 404 for unknown API routes', async () => {
    const res = await get('/api/nao-existe');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found' });
  });

  it('returns 404 for missing asset files instead of index.html', async () => {
    for (const url of ['/assets/old-chunk.js', '/player/assets/old-chunk.js']) {
      const res = await get(url);
      expect(res.statusCode, url).toBe(404);
      expect(res.body, url).not.toContain('INDEX');
    }
  });

  it('keeps health working', async () => {
    expect((await get('/api/health')).json()).toEqual({ status: 'ok', version: 't' });
  });
});

describe('api-only mode (no static dirs)', () => {
  it('serves health and 404 JSON for /', async () => {
    const bare = await buildApp({ version: 't' });
    expect((await bare.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
    const res = await bare.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found' });
    await bare.close();
  });
});
