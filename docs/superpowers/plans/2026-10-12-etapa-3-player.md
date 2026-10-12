# Etapa 3 — Player da TV — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Player web leve para TVs: a TV entra com a conta `tv@<parceiro>`, recebe as campanhas elegíveis, reproduz imagens e vídeos continuamente com rotação ponderada 1:2:3 exata, pré-carrega o próximo anúncio enquanto o atual toca (buffer duplo), faz transições configuráveis pelo parceiro (esmaecer, deslizar, corte seco) e se recupera de falhas sem tela preta.

**Architecture:** API ganha `GET /api/player/manifest` (com renovação da sessão da TV), restrição de mídia do player a itens elegíveis, configuração de transição por parceiro e validação de perfil/nível H.264. O `apps/player` deixa de usar React e vira TypeScript puro (~15–25 KB): `rotation` (round-robin ponderado suave), `manifest` (polling com última versão válida), `player` (orquestrador testável contra uma interface `Screen`), `dom-screen` (duas camadas reaproveitadas, `<video>` e `<img>`, transições só com `opacity`/`transform`), `login` e `controls` (som, tela cheia, sair, manter tela ligada).

**Tech Stack:** TypeScript, Vite (alvo `es2017`), Vitest + jsdom. Sem bibliotecas de player (análise registrada na conversa: Video.js/Plyr/hls.js/Shaka/plataformas de signage não se aplicam; Workbox fica para a Etapa 5).

**Spec:** `docs/superpowers/specs/2026-10-11-midora-mvp-design.md` (seções 7, 8, 11; critérios 6, 7, 8, 9, 14)

## Global Constraints

- Player sem framework; bundle JS do player ≤ 25 KB gzip; `build.target: 'es2017'`; nenhuma API sem detecção (`wakeLock`, `requestFullscreen`, `img.decode`).
- Sempre exatamente **dois** slots reaproveitados (cada um com 1 `<video>` + 1 `<img>`); nunca criar/destruir elementos de mídia por anúncio. Após a transição, o vídeo do slot que saiu é pausado e tem o `src` removido (libera decodificador).
- Transições apenas com `opacity` e `transform` (GPU). Tipos: `fade` (esmaecer), `slide` (deslizar), `cut` (corte seco, 0 ms). Duração 0–3000 ms, padrão `fade` 600 ms. Configuradas pelo parceiro (decisão do usuário).
- Rotação: round-robin ponderado suave com pesos do parceiro; evita repetir a mesma campanha em seguida só quando outra campanha tem crédito positivo (preserva a proporção exata).
- O próximo item é pré-carregado assim que o atual começa; o slot que saiu só é reutilizado depois que a transição termina.
- Vídeo começa mudo; som ativado por interação no controle remoto. Falha/timeout de carregamento ou travamento (sem progresso por 15 s) → pula para o próximo. Sem itens → tela de espera; nova tentativa periódica.
- Manifesto a cada 5 min (30 s quando vazio); falha mantém o último manifesto válido. 401 → recarrega e mostra o login.
- Sessão da TV renovada para 365 dias quando faltar menos de 180 (no manifesto).
- Player só baixa mídia que está no seu manifesto (elegível agora).
- Vídeo aceito: H.264 perfil Baseline (66), Main (77) ou High (100), nível ≤ 5.1, até 3840×2160; áudio AAC ou nenhum.
- Migração nova só aditiva (`0003_*`).
- Branch `feat/etapa-3-player`; Conventional Commits com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; merge autorizado após CI + revisão.
- **Decisões desta etapa:** (a) contagem de inserções é Etapa 4 — o orquestrador já expõe um callback `onPlayed(item, result)` sem uso; (b) cache offline é Etapa 5 — nesta etapa o buffer é o pré-carregamento do navegador + cabeçalhos `immutable`; (c) recomendação de produção dos anúncios: vídeo 1080p H.264 High, mesmo na Stick 4K.

## Review Focus

1. Lista com uma única campanha (imagem ou vídeo) deve tocar em loop sem tela preta entre repetições — teste na Task 5.
2. Manifesto muda enquanto um anúncio toca (campanha cancelada): o anúncio atual termina, a campanha removida não volta a tocar — teste na Task 5.
3. Todas as mídias falham ao carregar: tela de espera e nova tentativa, sem laço infinito consumindo CPU — teste na Task 5.
4. TV ligada por dias: sessão não expira (renovação) e memória estável (slots reaproveitados) — teste de renovação na Task 1; reaproveitamento verificado na Task 5 (número fixo de elementos `video`).
5. Rede cai durante o polling: player continua com o último manifesto — teste na Task 4.
6. Proporção 1:2:3 exata com 3 campanhas e sem repetição consecutiva — teste na Task 3.

---

## Estrutura de arquivos

```
apps/api/src/db/schema.ts               (mod) partners.transition, partners.transition_ms
apps/api/src/partners/partner-routes.ts (mod) PATCH /api/partner/settings
apps/api/src/auth/sessions.ts           (mod) renewSession
apps/api/src/player/routes.ts           GET /api/player/manifest
apps/api/src/media/routes.ts            (mod) player só mídia elegível
apps/api/src/campaigns/eligibility.ts   (mod) desempate por id
apps/api/src/media/mp4.ts               (mod) largura, altura, perfil, nível (avcC)
apps/api/src/media/upload.ts            (mod) valida perfil/nível/resolução
apps/web/src/pages/partner/TvAccount.tsx (mod) transições
apps/player/
  index.html  vite.config.ts  package.json  tsconfig.json
  src/main.ts        boot: sessão → login ou player
  src/api.ts         fetch + ApiError
  src/types.ts       Item, Manifest, Transition
  src/rotation.ts    round-robin ponderado suave
  src/manifest.ts    cliente com polling
  src/player.ts      orquestrador (interface Screen)
  src/dom-screen.ts  implementação DOM com buffer duplo
  src/login.ts       tela de login da TV
  src/controls.ts    som, tela cheia, sair, wake lock
  src/style.css
  test/*.test.ts
```

---

### Task 1: API do player — manifesto, renovação, mídia restrita, transição do parceiro

**Files:**
- Modify: `apps/api/src/db/schema.ts`, `apps/api/src/auth/sessions.ts`, `apps/api/src/media/routes.ts`, `apps/api/src/campaigns/eligibility.ts`, `apps/api/src/partners/partner-routes.ts`, `apps/api/src/app.ts`, `apps/api/test/media-routes.test.ts`, `apps/api/test/guard.test.ts`
- Create: `apps/api/src/player/routes.ts`, `apps/api/test/player.test.ts`, `apps/api/drizzle/0003_*.sql` (gerado)

**Interfaces:**
- Produces:
  - `partners.transition: 'fade' | 'slide' | 'cut'` (padrão `fade`), `partners.transitionMs: number` (padrão 600, 0–3000)
  - `PATCH /api/partner/settings` `{ transition?, transitionMs? }` → `{ partner }` (só `partner_user`)
  - `renewSession(db, token): Promise<Date | null>` — estende para +365 dias se faltar < 180
  - `GET /api/player/manifest` (só `player`) → `{ partner: { name, weights: { low, medium, high }, transition, transitionMs }, items: (EligibleItem & { media: { url } })[], generatedAt }`; renova sessão e cookie
  - `GET /api/media/:id` para `player`: 404 se a mídia não estiver entre as elegíveis do parceiro

- [ ] **Step 1: Branch**

```bash
cd /Users/deimac/Projetos/midora
git checkout -b feat/etapa-3-player
```

- [ ] **Step 2: Testes que falham**

`apps/api/test/player.test.ts`:
```ts
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { campaigns, sessions } from '../src/db/schema';
import { createTestApp, multipart, seed } from './helpers/app';
import { login } from './helpers/fixtures';
import { PNG_BYTES } from './helpers/mp4';

let t: Awaited<ReturnType<typeof createTestApp>>;
let s: Awaited<ReturnType<typeof seed>>;
let tv: string;
let approvedMedia: string;
let draftMedia: string;

const req = (method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, cookie?: string, payload?: unknown) =>
  t.app.inject({ method, url, headers: cookie ? { cookie } : {}, payload: payload as object });

async function campaignWithImage(name: string, approve: boolean) {
  const plan = (await req('POST', '/api/partner/plans', s.gerenteA, { name: `P ${name}`, frequencyLevel: 'high' })).json().plan.id;
  const adv = (await req('POST', '/api/partner/advertisers', s.gerenteA, { name: `A ${name}` })).json().advertiser.id;
  const id = (await req('POST', '/api/campaigns', s.gerenteA, {
    advertiserId: adv, planId: plan, name, startsAt: '2026-01-01T00:00:00Z', endsAt: '2030-01-01T00:00:00Z',
  })).json().campaign.id;
  const m = multipart({ filename: 'a.png', contentType: 'image/png', data: PNG_BYTES });
  const media = (await t.app.inject({ method: 'POST', url: `/api/campaigns/${id}/media`, headers: { cookie: s.gerenteA, ...m.headers }, payload: m.payload })).json().media.id;
  if (approve) {
    await req('POST', `/api/campaigns/${id}/submit`, s.gerenteA);
    await req('POST', `/api/campaigns/${id}/approve`, s.gerenteA);
  }
  return { id, media };
}

beforeAll(async () => {
  t = await createTestApp();
  s = await seed(t.app, t.db);
  approvedMedia = (await campaignWithImage('Aprovada', true)).media;
  draftMedia = (await campaignWithImage('Rascunho', false)).media;
  await req('PUT', '/api/partner/player-account', s.gerenteA, { password: 'senha-tv-123' });
  tv = await login(t.app, 'tv@parceiro-a', 'senha-tv-123');
});
afterAll(() => t.close());

describe('partner transition settings', () => {
  it('defaults to fade 600ms and can be changed by the partner only', async () => {
    expect((await req('GET', '/api/partner', s.gerenteA)).json().partner).toMatchObject({ transition: 'fade', transitionMs: 600 });
    const res = await req('PATCH', '/api/partner/settings', s.gerenteA, { transition: 'slide', transitionMs: 1000 });
    expect(res.json().partner).toMatchObject({ transition: 'slide', transitionMs: 1000 });
    expect((await req('PATCH', '/api/partner/settings', s.gerenteA, { transitionMs: 5000 })).statusCode).toBe(400);
    expect((await req('PATCH', '/api/partner/settings', s.gerenteA, { transition: 'zoom' })).statusCode).toBe(400);
    expect((await req('PATCH', '/api/partner/settings', tv, { transition: 'cut' })).statusCode).toBe(403);
  });
});

describe('player manifest', () => {
  it('returns weights, transition and only eligible items with media URLs', async () => {
    const res = await req('GET', '/api/player/manifest', tv);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.partner).toMatchObject({ weights: { low: 1, medium: 2, high: 3 }, transition: 'slide', transitionMs: 1000 });
    expect(body.items.map((i: { name: string }) => i.name)).toEqual(['Aprovada']);
    expect(body.items[0].media).toMatchObject({ id: approvedMedia, url: `/api/media/${approvedMedia}`, mediaType: 'image' });
  });

  it('is only for TV accounts', async () => {
    expect((await req('GET', '/api/player/manifest', s.gerenteA)).statusCode).toBe(403);
    expect((await req('GET', '/api/player/manifest')).statusCode).toBe(401);
  });

  it('renews a TV session that is close to expiring', async () => {
    const soon = new Date(Date.now() + 10 * 86_400_000);
    await t.db.update(sessions).set({ expiresAt: soon });
    const res = await req('GET', '/api/player/manifest', tv);
    expect(res.cookies.find((c) => c.name === 'midora_session')).toBeTruthy();
    const rows = await t.db.select({ e: sessions.expiresAt }).from(sessions);
    expect(rows.some((r) => r.e.getTime() > Date.now() + 300 * 86_400_000)).toBe(true);
  });
});

describe('player media access', () => {
  it('serves eligible media to the TV but not drafts', async () => {
    expect((await req('GET', `/api/media/${approvedMedia}`, tv)).statusCode).toBe(200);
    expect((await req('GET', `/api/media/${draftMedia}`, tv)).statusCode).toBe(404);
    expect((await req('GET', `/api/media/${draftMedia}`, s.gerenteA)).statusCode).toBe(200);
  });

  it('stops serving media once the campaign is cancelled', async () => {
    const [c] = await t.db.select().from(campaigns).where(eq(campaigns.currentMediaId, approvedMedia));
    await req('POST', `/api/campaigns/${c!.id}/cancel`, s.gerenteA);
    expect((await req('GET', `/api/media/${approvedMedia}`, tv)).statusCode).toBe(404);
  });
});
```

`apps/api/test/media-routes.test.ts`, teste `is visible to the same partner and its player, not to other partners`: a campanha desse arquivo é rascunho, então a TV agora recebe 404. Trocar a expectativa da TV por:
```ts
    expect((await req('GET', `/api/media/${mediaId}`, tv)).statusCode).toBe(404); // not eligible (draft)
```
e renomear o teste para `is visible to the same partner, not to other partners; TVs only see eligible media`.

`apps/api/test/guard.test.ts`: acrescentar `['GET', '/api/player/manifest']` e `['PATCH', '/api/partner/settings']`.

Run: `pnpm --filter @midora/api test -- player media-routes guard`
Expected: FAIL.

- [ ] **Step 3: Schema e migração**

`apps/api/src/db/schema.ts`, em `partners`:
```ts
    transition: text('transition', { enum: ['fade', 'slide', 'cut'] }).notNull().default('fade'),
    transitionMs: integer('transition_ms').notNull().default(600),
```
e nas constraints de `partners`:
```ts
    check('partners_transition_check', sql`${t.transition} in ('fade', 'slide', 'cut')`),
    check('partners_transition_ms_check', sql`${t.transitionMs} between 0 and 3000`),
```
Run: `pnpm --filter @midora/api db:generate --name player_settings` → `0003_player_settings.sql` sem `DROP`.

- [ ] **Step 4: Implementação**

`apps/api/src/auth/sessions.ts`:
```ts
const RENEW_BELOW_MS = 180 * DAY_MS;

/** Slides a long-lived session forward when it is getting close to expiry. Returns the new expiry, if renewed. */
export async function renewSession(db: Db, token: string): Promise<Date | null> {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS.player);
  const [row] = await db
    .update(sessions)
    .set({ expiresAt })
    .where(and(eq(sessions.id, hashToken(token)), lt(sessions.expiresAt, new Date(Date.now() + RENEW_BELOW_MS))))
    .returning({ id: sessions.id });
  return row ? expiresAt : null;
}
```
(importar `lt`).

`apps/api/src/campaigns/eligibility.ts`: `.orderBy(asc(campaigns.createdAt), asc(campaigns.id))`.

`apps/api/src/player/routes.ts`:
```ts
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { requireRole } from '../auth/guard';
import { SESSION_COOKIE, setSessionCookie } from '../auth/plugin';
import { renewSession } from '../auth/sessions';
import { listEligible } from '../campaigns/eligibility';
import type { Db } from '../db/client';
import { partners } from '../db/schema';

export const playerRoutes: FastifyPluginAsync<{ db: Db; cookieSecure: boolean }> = async (app, { db, cookieSecure }) => {
  app.get('/api/player/manifest', { preHandler: requireRole('player') }, async (req, reply) => {
    const partnerId = req.user!.partnerId!;
    const [p] = await db
      .select({
        name: partners.name, weightLow: partners.weightLow, weightMedium: partners.weightMedium,
        weightHigh: partners.weightHigh, transition: partners.transition, transitionMs: partners.transitionMs,
      })
      .from(partners)
      .where(eq(partners.id, partnerId));
    const token = req.cookies[SESSION_COOKIE];
    if (token) {
      const renewed = await renewSession(db, token);
      if (renewed) setSessionCookie(reply, token, renewed, cookieSecure);
    }
    const items = await listEligible(db, partnerId);
    return {
      partner: {
        name: p!.name,
        weights: { low: p!.weightLow, medium: p!.weightMedium, high: p!.weightHigh },
        transition: p!.transition,
        transitionMs: p!.transitionMs,
      },
      items: items.map((i) => ({ ...i, media: { ...i.media, url: `/api/media/${i.media.id}` } })),
      generatedAt: new Date().toISOString(),
    };
  });
};
```

`apps/api/src/media/routes.ts`: após carregar a linha e antes do `canRead`, para TVs:
```ts
    if (row && req.user!.role === 'player') {
      const eligible = await listEligible(db, req.user!.partnerId!);
      if (!eligible.some((i) => i.media.id === row.m.id)) return reply.code(404).send({ error: 'not_found' });
    }
```
(importar `listEligible`).

`apps/api/src/partners/partner-routes.ts`:
```ts
const Settings = z
  .object({ transition: z.enum(['fade', 'slide', 'cut']), transitionMs: z.number().int().min(0).max(3000) })
  .partial()
  .strict();
```
```ts
  app.patch('/api/partner/settings', async (req, reply) => {
    const body = parse(Settings, req.body, reply);
    if (!body) return reply;
    const [partner] = await db
      .update(partners)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(partners.id, req.user!.partnerId!))
      .returning();
    return { partner };
  });
```

`apps/api/src/app.ts`: registrar `playerRoutes` (`{ db: opts.db, cookieSecure: opts.cookieSecure ?? false }`).

- [ ] **Step 5: Rodar e commit**

Run: `pnpm --filter @midora/api test && pnpm typecheck && pnpm lint`
Expected: PASS.
```bash
git add apps/api
git commit -m "feat(api): add player manifest, TV session renewal, eligible-only media and partner transitions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Validação de perfil, nível e resolução H.264 + transições na tela do parceiro

**Files:**
- Modify: `apps/api/src/media/mp4.ts`, `apps/api/src/media/upload.ts`, `apps/api/test/helpers/mp4.ts`, `apps/api/test/media.test.ts`, `apps/api/test/media-routes.test.ts`
- Modify: `apps/web/src/types.ts`, `apps/web/src/pages/partner/TvAccount.tsx`, `apps/web/test/catalog.test.tsx`

**Interfaces:**
- Produces: `Mp4Info` ganha `width: number | null; height: number | null; videoProfile: number | null; videoLevel: number | null`; upload recusa H.264 fora de perfis 66/77/100, nível > 51 ou resolução > 3840×2160 (415 `unsupported_media`). Web: seção "Transições" em Conta da TV.

- [ ] **Step 1: Builder MP4 com avcC e testes que falham**

`apps/api/test/helpers/mp4.ts`:
- `buildMp4` aceita `profile` (padrão 100), `level` (padrão 40), `width` (1920), `height` (1080);
- `trak('vide', codec)` passa a gerar, para `avc1`/`avc3`, uma VisualSampleEntry real seguida de `avcC`:
```ts
function visualEntry(codec: string, o: { width: number; height: number; profile: number; level: number }): Buffer {
  const fixed = Buffer.alloc(78);
  fixed.writeUInt16BE(1, 6); // data_reference_index
  fixed.writeUInt16BE(o.width, 24);
  fixed.writeUInt16BE(o.height, 26);
  const avcC = box('avcC', Buffer.from([1, o.profile, 0, o.level, 0xff, 0xe0, 0x00]));
  return box(codec, fixed, avcC);
}
```
e a entrada de vídeo usa `visualEntry` quando `codec` começa com `avc`; para outros codecs mantém `box(codec, Buffer.alloc(8))`.

`apps/api/test/media.test.ts`:
- trocar os `toEqual` de `probeMp4` por `toMatchObject` (o resultado tem campos novos);
- novo teste:
```ts
  it('reads H.264 profile, level and resolution', async () => {
    const info = await probeMp4(await write('p.mp4', buildMp4({ profile: 77, level: 31, width: 1280, height: 720 })));
    expect(info).toMatchObject({ videoCodec: 'avc1', videoProfile: 77, videoLevel: 31, width: 1280, height: 720 });
    const hevc = await probeMp4(await write('h2.mp4', buildMp4({ video: 'hvc1' })));
    expect(hevc).toMatchObject({ videoProfile: null, videoLevel: null });
  });
```

`apps/api/test/media-routes.test.ts`, em `upload validation`:
```ts
  it('rejects H.264 profiles, levels and sizes TVs cannot decode', async () => {
    for (const opts of [{ profile: 110 }, { level: 52 }, { width: 4096, height: 2160 }]) {
      const res = await upload(`/api/campaigns/${campaignId}/media`, s.gerenteA, { filename: 'v.mp4', contentType: 'video/mp4', data: buildMp4(opts) });
      expect(res.json(), JSON.stringify(opts)).toEqual({ error: 'unsupported_media' });
    }
  });
```

Run: `pnpm --filter @midora/api test -- media`
Expected: FAIL (campos ausentes; uploads aceitos).

- [ ] **Step 2: Implementação API**

`apps/api/src/media/mp4.ts`:
- `Mp4Info` ganha os 4 campos;
- em `parseMoov`, para a trilha `vide`, ler a entrada inteira:
```ts
    const entry: Box = { type: codec, start: stsd.start + 16, end: stsd.start + 8 + buf.readUInt32BE(stsd.start + 8) };
    if (handler === 'vide' && !videoCodec) {
      videoCodec = codec;
      if (entry.end - entry.start >= 78) {
        width = buf.readUInt16BE(entry.start + 24);
        height = buf.readUInt16BE(entry.start + 26);
        const avcC = children(buf, entry.start + 78, entry.end).find((b) => b.type === 'avcC');
        if (avcC && avcC.end - avcC.start >= 4) {
          videoProfile = buf[avcC.start + 1]!;
          videoLevel = buf[avcC.start + 3]!;
        }
      }
    }
```
(declarar `let width: number | null = null` etc. e retornar; validar `entry.end <= stsd.end`, senão `invalid()`).

`apps/api/src/media/upload.ts`, na validação de vídeo:
```ts
const H264_PROFILES = new Set([66, 77, 100]); // Baseline, Main, High
const MAX_LEVEL = 51;
...
      const ok =
        info.durationMs > 0 &&
        info.videoCodec !== null &&
        VIDEO_CODECS.has(info.videoCodec) &&
        info.videoProfile !== null && H264_PROFILES.has(info.videoProfile) &&
        info.videoLevel !== null && info.videoLevel <= MAX_LEVEL &&
        (info.width ?? 0) <= 3840 && (info.height ?? 0) <= 2160 &&
        (info.audioCodec === null || info.audioCodec === 'mp4a');
```

Run: `pnpm --filter @midora/api test`
Expected: PASS.

- [ ] **Step 3: Teste de tela que falha**

`apps/web/test/catalog.test.tsx`, novo teste em `describe('TV account')`:
```tsx
  it('lets the partner choose the transition', async () => {
    const calls = mockApi({
      'GET /api/auth/me': { user: partnerUser },
      'GET /api/partner': { partner: { id: 'p1', name: 'Ironberg', slug: 'ironberg', transition: 'fade', transitionMs: 600 } },
      'PATCH /api/partner/settings': (b: unknown) => ({ partner: { id: 'p1', slug: 'ironberg', ...(b as object) } }),
    });
    renderAt('/parceiro/tv');
    const type = await screen.findByLabelText('Transição entre anúncios');
    expect((type as HTMLSelectElement).value).toBe('fade');
    await userEvent.selectOptions(type, 'slide');
    await userEvent.selectOptions(screen.getByLabelText('Duração'), '1000');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar transição' }));
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ transition: 'slide', transitionMs: 1000 });
    expect(await screen.findByText('Transição salva. As TVs aplicam em até 5 minutos.')).toBeTruthy();
  });
```

Run: `pnpm --filter @midora/web test -- catalog`
Expected: FAIL.

- [ ] **Step 4: Implementação web**

`apps/web/src/types.ts`: `Partner` ganha `transition: 'fade' | 'slide' | 'cut'; transitionMs: number`.

`apps/web/src/pages/partner/TvAccount.tsx`: carregar `transition`/`transitionMs` de `GET /api/partner` e acrescentar um segundo cartão:
```tsx
      <div className="card">
        <h2>Transições</h2>
        <form className="form" onSubmit={saveTransition}>
          <Field label="Transição entre anúncios">
            <select value={transition} onChange={(e) => setTransition(e.target.value as Transition)}>
              <option value="fade">Esmaecer</option>
              <option value="slide">Deslizar</option>
              <option value="cut">Corte seco</option>
            </select>
          </Field>
          <Field label="Duração">
            <select value={String(transitionMs)} onChange={(e) => setTransitionMs(Number(e.target.value))} disabled={transition === 'cut'}>
              <option value="300">0,3 s</option>
              <option value="600">0,6 s</option>
              <option value="1000">1 s</option>
              <option value="1500">1,5 s</option>
              <option value="2000">2 s</option>
            </select>
          </Field>
          <div><button className="btn btn-primary" type="submit" disabled={busy}>Salvar transição</button></div>
        </form>
      </div>
```
com
```tsx
type Transition = 'fade' | 'slide' | 'cut';
...
  const [transition, setTransition] = useState<Transition>('fade');
  const [transitionMs, setTransitionMs] = useState(600);
  // no carregamento: setTransition(r.partner.transition); setTransitionMs(r.partner.transitionMs)
  async function saveTransition(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/api/partner/settings', { method: 'PATCH', body: { transition, transitionMs } });
      setMsg({ kind: 'ok', text: 'Transição salva. As TVs aplicam em até 5 minutos.' });
    } catch (err) {
      setMsg({ kind: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }
```
(o `GET /api/partner` passa a tipar `{ partner: { slug: string; transition: Transition; transitionMs: number } }`).

- [ ] **Step 5: Rodar e commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: tudo verde.
```bash
git add apps/api apps/web
git commit -m "feat: validate H.264 profile, level and size; let partners choose TV transitions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Fundação do player — sem framework, tipos, API e rotação

**Files:**
- Modify: `apps/player/package.json`, `apps/player/vite.config.ts`, `apps/player/tsconfig.json`, `apps/player/index.html`
- Delete: `apps/player/src/App.tsx`, `apps/player/src/App.test.tsx`, `apps/player/src/main.tsx`
- Create: `apps/player/src/types.ts`, `apps/player/src/api.ts`, `apps/player/src/rotation.ts`, `apps/player/src/main.ts` (provisório), `apps/player/test/rotation.test.ts`, `apps/player/test/api.test.ts`

**Interfaces:**
- Produces:
  - `type Transition = 'fade' | 'slide' | 'cut'`; `type Level = 'low' | 'medium' | 'high'`; `interface MediaRef { id; url; mediaType: 'image' | 'video'; mime; sha256; sizeBytes; durationMs: number | null; displaySeconds: number | null }`; `interface Item { campaignId; kind; name; frequencyLevel: Level; media: MediaRef }`; `interface Manifest { partner: { name; weights: Record<Level, number>; transition: Transition; transitionMs: number }; items: Item[]; generatedAt: string }`
  - `class ApiError extends Error { status; code }`; `api<T>(path, opts?)` (igual ao web, sem listeners)
  - `interface Rotation { next(): Item | null }`; `createRotation(items: Item[], weights: Record<Level, number>): Rotation`

- [ ] **Step 1: Configuração sem React**

```bash
cd /Users/deimac/Projetos/midora
git rm -q apps/player/src/App.tsx apps/player/src/App.test.tsx apps/player/src/main.tsx
pnpm --filter @midora/player remove react react-dom @vitejs/plugin-react @testing-library/react @types/react @types/react-dom
```

`apps/player/vite.config.ts`:
```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/player/',
  build: { target: 'es2017', cssTarget: 'chrome61' },
  server: { port: 5174, proxy: { '/api': 'http://localhost:3000' } },
  test: { environment: 'jsdom', include: ['test/**/*.test.ts'] },
});
```

`apps/player/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "lib": ["ES2023", "DOM", "DOM.Iterable"], "types": ["vite/client"] },
  "include": ["src", "test", "vite.config.ts"]
}
```

`apps/player/index.html`:
```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Midora Player</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`apps/player/src/main.ts` (provisório até a Task 6):
```ts
document.getElementById('app')!.textContent = 'Midora';
```

- [ ] **Step 2: Testes que falham**

`apps/player/test/rotation.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { createRotation } from '../src/rotation';
import type { Item, Level } from '../src/types';

const W = { low: 1, medium: 2, high: 3 };
const item = (id: string, level: Level): Item => ({
  campaignId: id, kind: 'commercial', name: id, frequencyLevel: level,
  media: { id: `m-${id}`, url: `/api/media/m-${id}`, mediaType: 'image', mime: 'image/png', sha256: 'x', sizeBytes: 1, durationMs: null, displaySeconds: 10 },
});

function run(items: Item[], n: number, weights = W) {
  const r = createRotation(items, weights);
  const seq: string[] = [];
  for (let i = 0; i < n; i++) seq.push(r.next()!.campaignId);
  return seq;
}
const count = (seq: string[], id: string) => seq.filter((x) => x === id).length;
const repeats = (seq: string[]) => seq.filter((x, i) => i > 0 && x === seq[i - 1]).length;

describe('createRotation', () => {
  it('returns null when there is nothing to play', () => {
    expect(createRotation([], W).next()).toBeNull();
  });

  it('keeps the exact 1:2:3 proportion without consecutive repeats', () => {
    const seq = run([item('L', 'low'), item('M', 'medium'), item('H', 'high')], 6000);
    expect(count(seq, 'L')).toBe(1000);
    expect(count(seq, 'M')).toBe(2000);
    expect(count(seq, 'H')).toBe(3000);
    expect(repeats(seq)).toBe(0);
  });

  it('honors partner weights and repeats only when the proportion requires it', () => {
    const seq = run([item('H', 'high'), item('L', 'low')], 4000);
    expect(count(seq, 'H')).toBe(3000);
    expect(count(seq, 'L')).toBe(1000);
    const custom = run([item('L', 'low'), item('H', 'high')], 600, { low: 1, medium: 1, high: 5 });
    expect(count(custom, 'H')).toBe(500);
  });

  it('loops a single item', () => {
    expect(run([item('A', 'low')], 3)).toEqual(['A', 'A', 'A']);
  });

  it('spreads many items evenly per level', () => {
    const items = [item('L1', 'low'), item('L2', 'low'), item('M1', 'medium'), item('H1', 'high')];
    const seq = run(items, 7000);
    expect(count(seq, 'L1')).toBe(1000);
    expect(count(seq, 'L2')).toBe(1000);
    expect(count(seq, 'M1')).toBe(2000);
    expect(count(seq, 'H1')).toBe(3000);
  });
});
```

`apps/player/test/api.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../src/api';

afterEach(() => vi.unstubAllGlobals());

describe('api', () => {
  it('parses JSON and throws ApiError on failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url === '/ok'
        ? new Response(JSON.stringify({ a: 1 }), { status: 200 })
        : new Response(JSON.stringify({ error: 'unauthenticated' }), { status: 401 })));
    expect(await api('/ok')).toEqual({ a: 1 });
    await expect(api('/no')).rejects.toBeInstanceOf(ApiError);
    await expect(api('/no')).rejects.toMatchObject({ status: 401, code: 'unauthenticated' });
  });
});
```

Run: `pnpm --filter @midora/player test`
Expected: FAIL.

- [ ] **Step 3: Implementação**

`apps/player/src/types.ts`:
```ts
export type Transition = 'fade' | 'slide' | 'cut';
export type Level = 'low' | 'medium' | 'high';

export interface MediaRef {
  id: string;
  url: string;
  mediaType: 'image' | 'video';
  mime: string;
  sha256: string;
  sizeBytes: number;
  durationMs: number | null;
  displaySeconds: number | null;
}

export interface Item {
  campaignId: string;
  kind: 'commercial' | 'institutional';
  name: string;
  frequencyLevel: Level;
  media: MediaRef;
}

export interface Manifest {
  partner: { name: string; weights: Record<Level, number>; transition: Transition; transitionMs: number };
  items: Item[];
  generatedAt: string;
}
```

`apps/player/src/api.ts`:
```ts
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const init: RequestInit = { method: opts.method ?? 'GET', credentials: 'same-origin' };
  if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body);
    init.headers = { 'content-type': 'application/json' };
  }
  const res = await fetch(path, init);
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'internal');
  return data as T;
}
```

`apps/player/src/rotation.ts`:
```ts
import type { Item, Level } from './types';

export interface Rotation {
  next(): Item | null;
}

/**
 * Smooth weighted round-robin (as in nginx): exact proportions, evenly spread.
 * Avoids playing the same campaign twice in a row only when another campaign
 * is owed a turn, so the configured proportion is never distorted.
 */
export function createRotation(items: Item[], weights: Record<Level, number>): Rotation {
  const entries = items.map((item) => ({ item, weight: Math.max(1, weights[item.frequencyLevel]), credit: 0 }));
  const total = entries.reduce((sum, e) => sum + e.weight, 0);
  let last: (typeof entries)[number] | null = null;

  return {
    next() {
      if (entries.length === 0) return null;
      for (const e of entries) e.credit += e.weight;
      let best = entries[0]!;
      let second: (typeof entries)[number] | null = null;
      for (const e of entries.slice(1)) {
        if (e.credit > best.credit) {
          second = best;
          best = e;
        } else if (!second || e.credit > second.credit) {
          second = e;
        }
      }
      const pick = best === last && second && second.credit > 0 ? second : best;
      pick.credit -= total;
      last = pick;
      return pick.item;
    },
  };
}
```

- [ ] **Step 4: Rodar e commit**

Run: `pnpm --filter @midora/player test && pnpm --filter @midora/player typecheck && pnpm lint && pnpm --filter @midora/player build`
Expected: PASS; build gera `dist/index.html` com título `Midora Player`.
```bash
git add apps/player pnpm-lock.yaml
git commit -m "feat(player): drop React and add exact smooth weighted rotation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Cliente do manifesto, login da TV e controles

**Files:**
- Create: `apps/player/src/manifest.ts`, `apps/player/src/login.ts`, `apps/player/src/controls.ts`, `apps/player/src/style.css`, `apps/player/test/manifest.test.ts`, `apps/player/test/login.test.ts`, `apps/player/test/controls.test.ts`

**Interfaces:**
- Consumes: `api`, `ApiError`, `Manifest`.
- Produces:
  - `createManifestClient(fetcher: () => Promise<Manifest>, opts?: { intervalMs?: number; emptyRetryMs?: number; onUnauthorized?: () => void }): { start(): Promise<void>; stop(): void; current(): Manifest | null }`
  - `renderLogin(root: HTMLElement): Promise<void>` — resolve quando a TV entrar com sucesso
  - `mountControls(root: HTMLElement, deps: { setMuted(muted: boolean): void; logout(): Promise<void> }): { show(): void }` — barra com "Ativar som/Desativar som", "Tela cheia", "Sair"; aparece em qualquer tecla/clique, some após 8 s; na primeira interação pede `navigator.wakeLock` (se existir) e o renova ao voltar à aba

- [ ] **Step 1: Testes que falham**

`apps/player/test/manifest.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/api';
import { createManifestClient } from '../src/manifest';
import type { Manifest } from '../src/types';

const manifest = (n: number): Manifest => ({
  partner: { name: 'P', weights: { low: 1, medium: 2, high: 3 }, transition: 'fade', transitionMs: 600 },
  items: Array.from({ length: n }, (_, i) => ({
    campaignId: `c${i}`, kind: 'commercial', name: `c${i}`, frequencyLevel: 'low',
    media: { id: `m${i}`, url: `/api/media/m${i}`, mediaType: 'image', mime: 'image/png', sha256: 's', sizeBytes: 1, durationMs: null, displaySeconds: 5 },
  })),
  generatedAt: '2026-10-12T00:00:00Z',
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('manifest client', () => {
  it('polls every interval and keeps the last good manifest when the network fails', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(manifest(2)).mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(manifest(3));
    const client = createManifestClient(fetcher, { intervalMs: 1000 });
    await client.start();
    expect(client.current()!.items).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(client.current()!.items).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.current()!.items).toHaveLength(3);
    client.stop();
  });

  it('retries sooner when empty and reports 401', async () => {
    const onUnauthorized = vi.fn();
    const fetcher = vi.fn().mockResolvedValueOnce(manifest(0)).mockRejectedValueOnce(new ApiError(401, 'unauthenticated'));
    const client = createManifestClient(fetcher, { intervalMs: 60_000, emptyRetryMs: 500, onUnauthorized });
    await client.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    client.stop();
  });
});
```

`apps/player/test/login.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderLogin } from '../src/login';

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

function fill(user: string, pass: string) {
  (document.querySelector('input[name=user]') as HTMLInputElement).value = user;
  (document.querySelector('input[name=password]') as HTMLInputElement).value = pass;
  (document.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
}

describe('TV login', () => {
  it('resolves after a TV account signs in', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ user: { role: 'player' } }), { status: 200 })));
    const root = document.body.appendChild(document.createElement('div'));
    const done = renderLogin(root);
    fill('tv@ironberg', 'senha-tv-123');
    await expect(done).resolves.toBeUndefined();
  });

  it('shows errors for wrong credentials and non-TV accounts', async () => {
    const responses = [
      new Response(JSON.stringify({ error: 'invalid_credentials' }), { status: 401 }),
      new Response(JSON.stringify({ user: { role: 'partner_user' } }), { status: 200 }),
      new Response(null, { status: 204 }),
    ];
    vi.stubGlobal('fetch', vi.fn(async () => responses.shift()!));
    const root = document.body.appendChild(document.createElement('div'));
    void renderLogin(root);
    fill('tv@x', 'errada');
    await vi.waitFor(() => expect(root.textContent).toContain('Usuário ou senha incorretos.'));
    fill('g@a.com', 'senha-forte-1');
    await vi.waitFor(() => expect(root.textContent).toContain('Use a conta da TV'));
  });
});
```

`apps/player/test/controls.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountControls } from '../src/controls';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('controls', () => {
  it('appear on a remote key press, toggle sound and hide again', async () => {
    vi.useFakeTimers();
    const setMuted = vi.fn();
    const root = document.body.appendChild(document.createElement('div'));
    mountControls(root, { setMuted, logout: vi.fn() });
    const bar = root.querySelector('.overlay') as HTMLElement;
    expect(bar.classList.contains('hidden')).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(bar.classList.contains('hidden')).toBe(false);
    const sound = Array.from(bar.querySelectorAll('button')).find((b) => b.textContent === 'Ativar som')!;
    sound.click();
    expect(setMuted).toHaveBeenCalledWith(false);
    expect(sound.textContent).toBe('Desativar som');
    vi.advanceTimersByTime(8000);
    expect(bar.classList.contains('hidden')).toBe(true);
  });

  it('requests a screen wake lock on first interaction when supported', async () => {
    const request = vi.fn(async () => ({ addEventListener: vi.fn() }));
    vi.stubGlobal('navigator', { ...navigator, wakeLock: { request } });
    const root = document.body.appendChild(document.createElement('div'));
    mountControls(root, { setMuted: vi.fn(), logout: vi.fn() });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    await vi.waitFor(() => expect(request).toHaveBeenCalledWith('screen'));
  });

  it('logs out', async () => {
    const logout = vi.fn(async () => undefined);
    const root = document.body.appendChild(document.createElement('div'));
    mountControls(root, { setMuted: vi.fn(), logout });
    Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Sair')!.click();
    expect(logout).toHaveBeenCalled();
  });
});
```

Run: `pnpm --filter @midora/player test`
Expected: FAIL.

- [ ] **Step 2: Implementação**

`apps/player/src/manifest.ts`:
```ts
import { ApiError } from './api';
import type { Manifest } from './types';

export function createManifestClient(
  fetcher: () => Promise<Manifest>,
  opts: { intervalMs?: number; emptyRetryMs?: number; onUnauthorized?: () => void } = {},
) {
  const intervalMs = opts.intervalMs ?? 5 * 60_000;
  const emptyRetryMs = opts.emptyRetryMs ?? 30_000;
  let current: Manifest | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  async function refresh() {
    try {
      current = await fetcher();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) opts.onUnauthorized?.();
      // Network or server error: keep playing the last good manifest.
    }
  }

  async function tick() {
    await refresh();
    if (stopped) return;
    timer = setTimeout(() => void tick(), current && current.items.length > 0 ? intervalMs : emptyRetryMs);
  }

  return {
    start: () => tick(),
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
    current: () => current,
  };
}
```

`apps/player/src/login.ts`:
```ts
import { ApiError, api } from './api';

export function renderLogin(root: HTMLElement): Promise<void> {
  root.innerHTML = `
    <div class="login">
      <div class="brand-mark" aria-hidden="true"></div>
      <h1>Midora</h1>
      <form>
        <label>Usuário<input name="user" autocomplete="username" required /></label>
        <label>Senha<input name="password" type="password" autocomplete="current-password" required /></label>
        <p class="error" role="alert"></p>
        <button type="submit">Entrar</button>
      </form>
    </div>`;
  const form = root.querySelector('form')!;
  const error = root.querySelector('.error')!;
  (root.querySelector('input[name=user]') as HTMLInputElement).focus();

  return new Promise((resolve) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      error.textContent = '';
      const email = (form.elements.namedItem('user') as HTMLInputElement).value;
      const password = (form.elements.namedItem('password') as HTMLInputElement).value;
      try {
        const r = await api<{ user: { role: string } }>('/api/auth/login', { method: 'POST', body: { email, password } });
        if (r.user.role !== 'player') {
          await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
          error.textContent = 'Use a conta da TV (tv@seu-estabelecimento), criada em Conta da TV no painel.';
          return;
        }
        resolve();
      } catch (err) {
        error.textContent =
          err instanceof ApiError && err.status === 401
            ? 'Usuário ou senha incorretos.'
            : err instanceof ApiError && err.status === 429
              ? 'Muitas tentativas. Aguarde um pouco.'
              : 'Sem conexão. Tente de novo.';
      }
    });
  });
}
```

`apps/player/src/controls.ts`:
```ts
const HIDE_AFTER_MS = 8000;

export function mountControls(root: HTMLElement, deps: { setMuted(muted: boolean): void; logout(): Promise<void> }) {
  const bar = document.createElement('div');
  bar.className = 'overlay hidden';
  const button = (label: string, onClick: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', onClick);
    bar.appendChild(b);
    return b;
  };

  let muted = true;
  const sound = button('Ativar som', () => {
    muted = !muted;
    deps.setMuted(muted);
    sound.textContent = muted ? 'Ativar som' : 'Desativar som';
  });
  if (document.documentElement.requestFullscreen) {
    button('Tela cheia', () => void document.documentElement.requestFullscreen().catch(() => undefined));
  }
  button('Sair', () => void deps.logout());
  root.appendChild(bar);

  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let wakeLockRequested = false;
  const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<unknown> } };
  const requestWakeLock = () => {
    if (!nav.wakeLock) return;
    nav.wakeLock.request('screen').catch(() => undefined);
  };

  function show() {
    bar.classList.remove('hidden');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => bar.classList.add('hidden'), HIDE_AFTER_MS);
    if (!wakeLockRequested) {
      wakeLockRequested = true;
      requestWakeLock();
    }
    if (!bar.contains(document.activeElement)) (bar.querySelector('button') as HTMLButtonElement).focus();
  }

  document.addEventListener('keydown', show);
  document.addEventListener('click', (e) => {
    if (!bar.contains(e.target as Node)) show();
  });
  // The wake lock is released when the page is hidden; take it again on return.
  document.addEventListener('visibilitychange', () => {
    if (wakeLockRequested && document.visibilityState === 'visible') requestWakeLock();
  });
  return { show };
}
```

`apps/player/src/style.css`:
```css
html, body, #app { margin: 0; height: 100%; background: #000; color: #f2ede6; overflow: hidden; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
.stage { position: fixed; top: 0; right: 0; bottom: 0; left: 0; overflow: hidden; background: #000; }
.layer { position: absolute; top: 0; right: 0; bottom: 0; left: 0; opacity: 0; z-index: 1; transition-property: opacity, transform; transition-timing-function: ease-in-out; transition-duration: var(--t, 600ms); will-change: opacity, transform; }
.layer.on { opacity: 1; z-index: 2; }
.layer video, .layer img { position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: contain; display: none; background: #000; }
.layer .show { display: block; }
.stage.slide .layer { opacity: 1; transform: translateX(100%); }
.stage.slide .layer.on { transform: translateX(0); }
.stage.slide .layer.out { transform: translateX(-100%); }
.stage.cut .layer { transition-duration: 0ms; }
.waiting, .login { position: fixed; top: 0; right: 0; bottom: 0; left: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; background: #14120f; z-index: 5; }
.waiting p { color: #9b9288; font-size: 22px; margin: 0; }
.brand-mark { width: 64px; height: 64px; border-radius: 16px; background: #2bb37f; }
h1 { font-size: 40px; font-weight: 600; margin: 0; }
.login form { display: flex; flex-direction: column; gap: 14px; width: 420px; max-width: 90vw; font-size: 20px; }
.login label { display: flex; flex-direction: column; gap: 6px; color: #9b9288; }
.login input { font: inherit; padding: 12px 14px; border-radius: 10px; border: 2px solid #332d26; background: #211d18; color: #f2ede6; }
.login input:focus, .login button:focus, .overlay button:focus { outline: 3px solid #2bb37f; outline-offset: 2px; }
.login button, .overlay button { font: inherit; font-size: 20px; padding: 12px 22px; border: 0; border-radius: 10px; background: #2bb37f; color: #08140f; cursor: pointer; }
.login .error { color: #f0a58a; min-height: 1.4em; margin: 0; }
.overlay { position: fixed; left: 32px; bottom: 32px; display: flex; gap: 12px; z-index: 10; }
.overlay button { background: #2a251f; color: #f2ede6; }
.hidden { display: none !important; }
```

- [ ] **Step 3: Rodar e commit**

Run: `pnpm --filter @midora/player test && pnpm --filter @midora/player typecheck && pnpm lint`
Expected: PASS (manifest 2, login 2, controls 3 + anteriores).
```bash
git add apps/player
git commit -m "feat(player): add manifest polling, TV login and remote-friendly controls

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Orquestrador e tela com buffer duplo

**Files:**
- Create: `apps/player/src/player.ts`, `apps/player/src/dom-screen.ts`, `apps/player/test/player.test.ts`, `apps/player/test/dom-screen.test.ts`

**Interfaces:**
- Consumes: `createRotation`, `Manifest`, `Item`, `Transition`.
- Produces:
  - `type PlayResult = 'completed' | 'failed'`
  - `interface Screen { preload(item: Item): Promise<boolean>; present(item: Item): Promise<PlayResult>; setTransition(type: Transition, ms: number): void; setMuted(muted: boolean): void; showWaiting(on: boolean): void }`
  - `runPlayer(deps: { screen: Screen; manifest(): Manifest | null; sleep(ms: number): Promise<void>; running(): boolean; onPlayed?(item: Item, result: PlayResult): void; idleMs?: number }): Promise<void>`
  - `class DomScreen implements Screen` — `constructor(root: HTMLElement, opts?: { loadTimeoutMs?: number; stallTimeoutMs?: number })`

- [ ] **Step 1: Testes que falham**

`apps/player/test/player.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { runPlayer, type PlayResult, type Screen } from '../src/player';
import type { Item, Level, Manifest } from '../src/types';

const item = (id: string, level: Level = 'low'): Item => ({
  campaignId: id, kind: 'commercial', name: id, frequencyLevel: level,
  media: { id: `m-${id}`, url: `/api/media/m-${id}`, mediaType: 'image', mime: 'image/png', sha256: 's', sizeBytes: 1, durationMs: null, displaySeconds: 5 },
});
const manifest = (items: Item[], transition: Manifest['partner']['transition'] = 'fade'): Manifest => ({
  partner: { name: 'P', weights: { low: 1, medium: 2, high: 3 }, transition, transitionMs: 600 },
  items,
  generatedAt: 'x',
});

class FakeScreen implements Screen {
  log: string[] = [];
  failPreload = new Set<string>();
  results: PlayResult[] = [];
  preload = vi.fn(async (i: Item) => {
    this.log.push(`preload ${i.campaignId}`);
    return !this.failPreload.has(i.campaignId);
  });
  present = vi.fn(async (i: Item) => {
    this.log.push(`present ${i.campaignId}`);
    await Promise.resolve();
    this.log.push(`end ${i.campaignId}`);
    return this.results.shift() ?? 'completed';
  });
  setTransition = vi.fn();
  setMuted = vi.fn();
  showWaiting = vi.fn((on: boolean) => this.log.push(`waiting ${on}`));
}

function until(n: number) {
  let calls = 0;
  return () => calls++ < n;
}

describe('runPlayer', () => {
  it('preloads the next ad while the current one plays', async () => {
    const screen = new FakeScreen();
    await runPlayer({ screen, manifest: () => manifest([item('A'), item('B')]), sleep: async () => {}, running: until(2) });
    expect(screen.log.slice(0, 6)).toEqual(['preload A', 'waiting false', 'present A', 'preload B', 'end A', 'waiting false']);
    expect(screen.setTransition).toHaveBeenCalledWith('fade', 600);
  });

  it('loops a single ad', async () => {
    const screen = new FakeScreen();
    const played: string[] = [];
    await runPlayer({
      screen, manifest: () => manifest([item('A')]), sleep: async () => {}, running: until(3),
      onPlayed: (i) => played.push(i.campaignId),
    });
    expect(played).toEqual(['A', 'A', 'A']);
  });

  it('skips ads that fail to load and shows waiting when all fail', async () => {
    const screen = new FakeScreen();
    screen.failPreload = new Set(['A', 'B']);
    const sleep = vi.fn(async () => {});
    await runPlayer({ screen, manifest: () => manifest([item('A'), item('B')]), sleep, running: until(5), idleMs: 10_000 });
    expect(screen.present).not.toHaveBeenCalled();
    expect(screen.log).toContain('waiting true');
    expect(sleep).toHaveBeenCalledWith(10_000);
  });

  it('shows waiting when there is nothing to play', async () => {
    const screen = new FakeScreen();
    const sleep = vi.fn(async () => {});
    await runPlayer({ screen, manifest: () => manifest([]), sleep, running: until(2), idleMs: 7000 });
    expect(screen.log).toEqual(['waiting true', 'waiting true']);
    expect(sleep).toHaveBeenCalledWith(7000);
  });

  it('stops playing a campaign removed from the manifest', async () => {
    const screen = new FakeScreen();
    let current = manifest([item('A'), item('B')]);
    const played: string[] = [];
    await runPlayer({
      screen, manifest: () => current, sleep: async () => {}, running: until(6),
      onPlayed: (i) => {
        played.push(i.campaignId);
        if (played.length === 1) current = manifest([item('B')], 'cut');
      },
    });
    expect(played[0]).toBe('A');
    expect(played.slice(2)).not.toContain('A');
    expect(screen.setTransition).toHaveBeenLastCalledWith('cut', 600);
  });
});
```

`apps/player/test/dom-screen.test.ts` (jsdom não reproduz mídia; o teste cobre a estrutura e a troca de camadas com mídia simulada):
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DomScreen } from '../src/dom-screen';
import type { Item } from '../src/types';

const image = (id: string): Item => ({
  campaignId: id, kind: 'commercial', name: id, frequencyLevel: 'low',
  media: { id, url: `/api/media/${id}`, mediaType: 'image', mime: 'image/png', sha256: 's', sizeBytes: 1, durationMs: null, displaySeconds: 2 },
});

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, value: () => Promise.resolve() });
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('DomScreen', () => {
  it('uses exactly two reusable layers and alternates them', async () => {
    const root = document.body.appendChild(document.createElement('div'));
    const screen = new DomScreen(root);
    screen.setTransition('fade', 0);
    expect(root.querySelectorAll('video')).toHaveLength(2);
    expect(root.querySelectorAll('img')).toHaveLength(2);

    expect(await screen.preload(image('a'))).toBe(true);
    const first = screen.present(image('a'));
    const layers = root.querySelectorAll('.layer');
    expect(layers[0]!.classList.contains('on') || layers[1]!.classList.contains('on')).toBe(true);
    const onBefore = Array.from(layers).findIndex((l) => l.classList.contains('on'));
    await vi.advanceTimersByTimeAsync(2000);
    expect(await first).toBe('completed');

    expect(await screen.preload(image('b'))).toBe(true);
    void screen.present(image('b'));
    const onAfter = Array.from(layers).findIndex((l) => l.classList.contains('on'));
    expect(onAfter).not.toBe(onBefore);
    expect(root.querySelectorAll('video')).toHaveLength(2);
  });

  it('applies the transition type and duration to the stage', () => {
    const root = document.body.appendChild(document.createElement('div'));
    const screen = new DomScreen(root);
    screen.setTransition('slide', 1000);
    const stage = root.querySelector('.stage') as HTMLElement;
    expect(stage.classList.contains('slide')).toBe(true);
    expect(stage.style.getPropertyValue('--t')).toBe('1000ms');
    screen.setTransition('cut', 1000);
    expect(stage.classList.contains('cut')).toBe(true);
    expect(stage.classList.contains('slide')).toBe(false);
  });

  it('fails a preload that never becomes ready', async () => {
    Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, value: () => new Promise(() => {}) });
    const root = document.body.appendChild(document.createElement('div'));
    const screen = new DomScreen(root, { loadTimeoutMs: 1000 });
    const ready = screen.preload(image('slow'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(await ready).toBe(false);
  });

  it('mutes and unmutes both videos', () => {
    const root = document.body.appendChild(document.createElement('div'));
    const screen = new DomScreen(root);
    screen.setMuted(false);
    expect(Array.from(root.querySelectorAll('video')).every((v) => !v.muted)).toBe(true);
  });
});
```

Run: `pnpm --filter @midora/player test`
Expected: FAIL.

- [ ] **Step 2: Implementação**

`apps/player/src/player.ts`:
```ts
import { createRotation, type Rotation } from './rotation';
import type { Item, Manifest, Transition } from './types';

export type PlayResult = 'completed' | 'failed';

export interface Screen {
  /** Loads the item into the hidden layer; true when it can start without stalling. */
  preload(item: Item): Promise<boolean>;
  /** Transitions the preloaded item in and resolves when it finished (or failed). */
  present(item: Item): Promise<PlayResult>;
  setTransition(type: Transition, ms: number): void;
  setMuted(muted: boolean): void;
  showWaiting(on: boolean): void;
}

interface Deps {
  screen: Screen;
  manifest(): Manifest | null;
  sleep(ms: number): Promise<void>;
  running(): boolean;
  onPlayed?(item: Item, result: PlayResult): void;
  idleMs?: number;
}

/** Plays ads forever, always preloading the next one while the current one is on screen. */
export async function runPlayer(deps: Deps): Promise<void> {
  const { screen } = deps;
  const idleMs = deps.idleMs ?? 10_000;
  let source: Manifest | null = null;
  let rotation: Rotation | null = null;
  let pending: { item: Item; ready: Promise<boolean> } | null = null;
  let failures = 0;

  while (deps.running()) {
    const m = deps.manifest();
    if (!m || m.items.length === 0) {
      pending = null;
      screen.showWaiting(true);
      await deps.sleep(idleMs);
      continue;
    }
    if (m !== source) {
      source = m;
      rotation = createRotation(m.items, m.partner.weights);
      screen.setTransition(m.partner.transition, m.partner.transitionMs);
      const keep = pending && m.items.some((i) => i.campaignId === pending!.item.campaignId);
      if (!keep) pending = null;
    }
    if (!pending) {
      const first = rotation!.next()!;
      pending = { item: first, ready: screen.preload(first) };
    }

    const current = pending;
    pending = null;
    if (!(await current.ready)) {
      failures++;
      if (failures >= m.items.length) {
        failures = 0;
        screen.showWaiting(true);
        await deps.sleep(idleMs);
      }
      continue;
    }

    screen.showWaiting(false);
    const playing = screen.present(current.item);
    const next = rotation!.next()!;
    pending = { item: next, ready: screen.preload(next) };
    const result = await playing;
    failures = result === 'failed' ? failures + 1 : 0;
    deps.onPlayed?.(current.item, result);
  }
}
```

`apps/player/src/dom-screen.ts`:
```ts
import type { PlayResult, Screen } from './player';
import type { Item, Transition } from './types';

interface Layer {
  el: HTMLDivElement;
  video: HTMLVideoElement;
  img: HTMLImageElement;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const withTimeout = <T>(p: Promise<T>, ms: number, fallback: T) =>
  Promise.race([p, sleep(ms).then(() => fallback)]);

/** Two reusable layers: one on screen, one loading the next ad. */
export class DomScreen implements Screen {
  private readonly stage: HTMLDivElement;
  private readonly waiting: HTMLDivElement;
  private readonly layers: [Layer, Layer];
  private active = 1; // first present() shows layer 0
  private transitionMs = 600;
  private freeAt: Promise<void> = Promise.resolve();
  private readonly loadTimeoutMs: number;
  private readonly stallTimeoutMs: number;

  constructor(root: HTMLElement, opts: { loadTimeoutMs?: number; stallTimeoutMs?: number } = {}) {
    this.loadTimeoutMs = opts.loadTimeoutMs ?? 30_000;
    this.stallTimeoutMs = opts.stallTimeoutMs ?? 15_000;
    this.stage = document.createElement('div');
    this.stage.className = 'stage fade';
    this.layers = [this.makeLayer(), this.makeLayer()];
    this.waiting = document.createElement('div');
    this.waiting.className = 'waiting hidden';
    this.waiting.innerHTML = '<div class="brand-mark" aria-hidden="true"></div><h1>Midora</h1><p>Aguardando campanhas…</p>';
    root.append(this.stage, this.waiting);
  }

  private makeLayer(): Layer {
    const el = document.createElement('div');
    el.className = 'layer';
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.setAttribute('playsinline', '');
    const img = document.createElement('img');
    img.alt = '';
    el.append(video, img);
    this.stage.appendChild(el);
    return { el, video, img };
  }

  setTransition(type: Transition, ms: number): void {
    this.transitionMs = type === 'cut' ? 0 : ms;
    this.stage.classList.remove('fade', 'slide', 'cut');
    this.stage.classList.add(type);
    this.stage.style.setProperty('--t', `${this.transitionMs}ms`);
  }

  setMuted(muted: boolean): void {
    for (const l of this.layers) l.video.muted = muted;
  }

  showWaiting(on: boolean): void {
    this.waiting.classList.toggle('hidden', !on);
  }

  async preload(item: Item): Promise<boolean> {
    await this.freeAt; // never touch the layer that is still transitioning out
    const layer = this.layers[1 - this.active]!;
    this.release(layer);
    if (item.media.mediaType === 'image') {
      layer.img.src = item.media.url;
      const decoded = layer.img.decode ? layer.img.decode().then(() => true, () => false) : Promise.resolve(true);
      return withTimeout(decoded, this.loadTimeoutMs, false);
    }
    const video = layer.video;
    const ready = new Promise<boolean>((resolve) => {
      const done = (ok: boolean) => {
        video.removeEventListener('canplaythrough', onReady);
        video.removeEventListener('error', onError);
        resolve(ok);
      };
      const onReady = () => done(true);
      const onError = () => done(false);
      video.addEventListener('canplaythrough', onReady);
      video.addEventListener('error', onError);
    });
    video.src = item.media.url;
    video.load();
    return withTimeout(ready, this.loadTimeoutMs, false);
  }

  async present(item: Item): Promise<PlayResult> {
    const nextIndex = 1 - this.active;
    const incoming = this.layers[nextIndex]!;
    const outgoing = this.layers[this.active]!;
    this.active = nextIndex;

    const isVideo = item.media.mediaType === 'video';
    incoming.video.classList.toggle('show', isVideo);
    incoming.img.classList.toggle('show', !isVideo);
    if (isVideo) {
      incoming.video.currentTime = 0;
      try {
        await incoming.video.play();
      } catch {
        return 'failed';
      }
    }

    incoming.el.classList.remove('out');
    incoming.el.classList.add('on');
    outgoing.el.classList.remove('on');
    outgoing.el.classList.add('out');
    this.freeAt = sleep(this.transitionMs + 50).then(() => {
      outgoing.el.classList.remove('out');
      outgoing.video.pause();
    });

    if (!isVideo) {
      await sleep((item.media.displaySeconds ?? 10) * 1000);
      return 'completed';
    }
    return this.watchVideo(incoming.video);
  }

  private watchVideo(video: HTMLVideoElement): Promise<PlayResult> {
    return new Promise((resolve) => {
      let lastTime = video.currentTime;
      const watchdog = setInterval(() => {
        if (video.currentTime === lastTime) finish('failed'); // stalled
        lastTime = video.currentTime;
      }, this.stallTimeoutMs);
      const onEnded = () => finish('completed');
      const onError = () => finish('failed');
      function finish(result: PlayResult) {
        clearInterval(watchdog);
        video.removeEventListener('ended', onEnded);
        video.removeEventListener('error', onError);
        resolve(result);
      }
      video.addEventListener('ended', onEnded);
      video.addEventListener('error', onError);
    });
  }

  /** Frees the decoder of a layer that is not on screen. */
  private release(layer: Layer): void {
    layer.video.pause();
    layer.video.removeAttribute('src');
    layer.video.load();
    layer.img.removeAttribute('src');
  }
}
```

- [ ] **Step 3: Rodar e commit**

Run: `pnpm --filter @midora/player test && pnpm --filter @midora/player typecheck && pnpm lint`
Expected: player 5 + dom-screen 4 PASS (jsdom: `HTMLMediaElement.prototype.load/pause` não implementados emitem aviso; se lançarem erro, stubar com `vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})` e `pause` no `beforeEach` do `dom-screen.test.ts`).
```bash
git add apps/player
git commit -m "feat(player): add double-buffered screen and playback loop

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Montagem do player, demonstração, verificação e entrega

**Files:**
- Modify: `apps/player/src/main.ts`, `apps/api/scripts/demo.ts`, `docs/DEPLOY.md`
- Create: `docs/FIRE-TV.md`

**Interfaces:**
- Consumes: tudo das Tasks 3–5.
- Produces: player completo em `/player/`; guia de teste na Fire TV.

- [ ] **Step 1: `main.ts`**

```ts
import { ApiError, api } from './api';
import { mountControls } from './controls';
import { DomScreen } from './dom-screen';
import { renderLogin } from './login';
import { createManifestClient } from './manifest';
import { runPlayer } from './player';
import './style.css';
import type { Manifest } from './types';

const root = document.getElementById('app')!;

async function isTvSession(): Promise<boolean> {
  try {
    const r = await api<{ user: { role: string } }>('/api/auth/me');
    return r.user.role === 'player';
  } catch (err) {
    if (err instanceof ApiError) return false;
    return true; // offline at boot: try to play with whatever the server gives later
  }
}

async function start() {
  root.innerHTML = '';
  const screen = new DomScreen(root);
  screen.showWaiting(true);
  const manifest = createManifestClient(() => api<Manifest>('/api/player/manifest'), {
    onUnauthorized: () => location.reload(),
  });
  mountControls(root, {
    setMuted: (m) => screen.setMuted(m),
    logout: async () => {
      await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
      location.reload();
    },
  });
  await manifest.start();
  await runPlayer({
    screen,
    manifest: () => manifest.current(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    running: () => true,
  });
}

async function boot() {
  if (!(await isTvSession())) await renderLogin(root);
  await start();
}

void boot();
```

- [ ] **Step 2: Build e tamanho**

Run:
```bash
pnpm --filter @midora/player build
gzip -c apps/player/dist/assets/*.js | wc -c
```
Expected: ≤ 25600 bytes. Se passar, revisar imports antes de seguir.

- [ ] **Step 3: Demo com TV**

`apps/api/scripts/demo.ts`: após criar o parceiro, criar a conta da TV (`tv@academia-demo`, mesma senha de teste), uma campanha aprovada com imagem PNG (gerada no próprio script com `zlib`, 1280×720, cor esmeralda) e outra com imagem de outra cor, ambas com período cobrindo a data atual. Assim o player do demo já tem o que tocar.

- [ ] **Step 4: Verificação no navegador (agente)**

```bash
pnpm build && pnpm --filter @midora/api demo   # background
```
No navegador integrado, `http://localhost:3100/player/`:
1. Tela de login da TV; entrar com `tv@academia-demo`.
2. Anúncios alternando com esmaecer; nenhum quadro preto entre eles (capturas consecutivas).
3. Como parceiro, trocar a transição para "Deslizar 1 s"; recarregar o player e observar.
4. Tecla qualquer → barra com "Ativar som", "Tela cheia", "Sair"; some após 8 s.
5. `document.querySelectorAll('video').length` permanece 2 após vários ciclos.
6. Parar o demo com o player aberto: o anúncio atual continua; reiniciar: segue normalmente.
Encerrar o demo.

- [ ] **Step 5: Guia da Fire TV para o usuário**

`docs/FIRE-TV.md`:
````markdown
# Teste do player na Fire TV Stick 4K

1. Na Fire TV, instale/abra o navegador **Silk** (ou outro de sua preferência).
2. Acesse `http://<domínio do Midora>/player/` e entre com `tv@<seu-parceiro>` e a senha definida em **Conta da TV**.
3. Aperte qualquer botão do controle: aparecem **Ativar som**, **Tela cheia** e **Sair**. Ative som e tela cheia.
4. Deixe tocando por pelo menos 2 horas e observe:
   - os anúncios passam sem tela preta entre eles;
   - vídeos não travam no início;
   - a proteção de tela da Fire TV não aparece;
   - nada fica mais lento com o tempo.
5. Anote o que acontecer (com horário) e envie ao suporte técnico.

Recomendações para os anúncios: vídeo MP4 H.264 em 1080p (perfil High, nível até 4.2), áudio AAC; imagens em 1920×1080.
````

`docs/DEPLOY.md`: seção "Player" com o endereço `/player/`, login da TV e link para `docs/FIRE-TV.md`.

- [ ] **Step 6: Rodar tudo, commit, push**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
```bash
git add apps/player apps/api docs
git commit -m "feat(player): wire up TV player and add Fire TV test guide

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin feat/etapa-3-player
```
Depois: CI, revisão final, correções, merge (autorizado), conferir deploy (`/player/` e `/api/player/manifest` 401 sem sessão) e pedir ao usuário o teste na Fire TV com `docs/FIRE-TV.md`.

---

## Critério de aceite da Etapa 3

- Testes verdes local e no CI; bundle do player ≤ 25 KB gzip.
- No demo: TV entra, anúncios alternam com a transição configurada, pré-carregamento do próximo, 2 elementos de vídeo fixos, tela de espera quando não há campanhas.
- Proporção 1:2:3 exata e sem repetição consecutiva (teste).
- Produção atualizada; teste na Fire TV Stick 4K pelo usuário com o guia.
