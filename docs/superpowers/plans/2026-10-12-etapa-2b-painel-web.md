# Etapa 2b — Painel web (admin, parceiro, anunciante, página pública) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Telas do painel sobre a API da Etapa 2a: login; super admin gerencia Planos Midora, parceiros (com o Plano Midora de cada um), usuários de parceiro e campanhas institucionais; parceiro gerencia anunciantes, planos, conta da TV e campanhas (criar, enviar mídia, aprovar, pedir correção, cancelar); anunciante cria e acompanha suas campanhas; página pública do parceiro com autocadastro. Tema claro (grafite + esmeralda) e noturno (noite + esmeralda) com botão lua/sol.

**Architecture:** `apps/web` é um SPA React + React Router servido pela API em `/`. Um cliente `api()` fino sobre `fetch` (cookie de sessão same-origin), um `AuthProvider` que carrega `/api/auth/me`, rotas protegidas por papel e páginas por área (`pages/admin`, `pages/partner`, `pages/campaigns`, `pages/public`). Estilo em CSS puro com tokens em `:root[data-theme]`. Testes com Vitest + Testing Library e `fetch` simulado. Duas pequenas adições de API para as telas.

**Tech Stack:** React 19, React Router 7, `@tabler/icons-react`, Vitest, Testing Library (`@testing-library/react`, `@testing-library/user-event`), jsdom.

**Spec:** `docs/superpowers/specs/2026-10-11-midora-mvp-design.md` (seções 4, 6, 7, 9 e critérios 1–5)

## Global Constraints

- Sem azul. Tema claro: fundo `#F5F6F4`, menu `#1E2320`, cartões `#FFFFFF`, texto `#1A1D1B`, destaque esmeralda `#0E8A5F`. Tema noturno: fundo `#14120F`, menu `#1C1915`, cartões `#211D18`, texto `#F2EDE6`, destaque esmeralda `#2BB37F` (mais claro para contraste). Mesma cor de destaque nos dois temas (decisão do usuário).
- Tema inicial: preferência salva em `localStorage['midora-theme']`; sem ela, `prefers-color-scheme`. O botão mostra o ícone do modo **para o qual** vai mudar (lua no claro, sol no noturno) e salva a escolha.
- Textos em português do Brasil, sentence case, sem "por favor"/"sucesso". Erros da API traduzidos por código (`messages.ts`).
- Cookie de sessão same-origin; nenhum token em `localStorage`. Requisições sem corpo não enviam `content-type` (Fastify rejeita JSON vazio).
- Datas: o usuário escolhe dias; `startsAt` = 00:00 local do dia inicial; `endsAt` = 00:00 local do dia seguinte ao dia final (período inclusivo).
- Upload: `POST .../media?displaySeconds=N` (só imagens), arquivo no campo `file` de `multipart/form-data`.
- TypeScript `^6`; nenhuma dependência de UI pesada (sem kit de componentes).
- Branch `feat/etapa-2b-painel-web`; Conventional Commits com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; merge autorizado após CI verde + revisão final (memória do usuário).
- **Planos Midora (decisão D8 da especificação):** só cadastro e vínculo ao parceiro — sem cobrança e sem limites. Na interface, chamar de "Planos Midora" (o que o parceiro contrata) e "Planos de anúncio" (o que o parceiro vende).
- **Decisões desta etapa:** (a) relatório de inserções fica para a Etapa 4 (ainda não há dados de reprodução); (b) edição de anunciante pela tela fica fora — cadastro e listagem bastam no MVP (API de edição existe); (c) modo demonstração local (`pnpm --filter @midora/api demo`) com PGlite e usuários de teste, só para verificação; nunca usado em produção.

## Review Focus

1. Sessão expirada no meio do uso (API devolve 401) deve levar à tela de login, não deixar a página quebrada ou em branco — teste na Task 3.
2. Anunciante digitando `/admin/parceiros` ou `/parceiro/planos` na barra deve ser levado à própria área, sem ver dados alheios — teste na Task 3.
3. Período de um dia (início = fim) deve ser aceito e virar 24 h; fim antes do início mostra erro em português — teste na Task 6.
4. Duplo clique em "Aprovar" ou "Enviar para aprovação" não deve disparar duas requisições — teste na Task 6.
5. Tema escolhido persiste ao recarregar e o painel não pisca no tema errado ao abrir — teste na Task 2 (aplicação antes do render).
6. Upload recusado (formato, tamanho, disco cheio) mostra mensagem clara e mantém a tela utilizável — teste na Task 6.

---

## Estrutura de arquivos

```
apps/api/src/campaigns/routes.ts        (mod) advertiserName nas listas/detalhe
apps/api/src/catalog/routes.ts          (mod) GET /api/advertiser/plans
apps/api/scripts/demo.ts                modo demonstração local (PGlite + seed)
apps/web/
  index.html                             (mod) script de tema inline
  src/main.tsx                           (mod) BrowserRouter + App
  src/App.tsx                            (mod) provedores + rotas
  src/styles.css                         tokens dos temas e componentes
  src/theme.ts  src/ThemeToggle.tsx
  src/api.ts  src/messages.ts  src/types.ts  src/format.ts
  src/auth.tsx                           AuthProvider, useAuth, RequireRole, homeFor
  src/ui.tsx                             Layout, Badge, Field, Notice, PageHeader
  src/pages/Login.tsx  src/pages/Home.tsx
  src/pages/admin/Partners.tsx  src/pages/admin/Institutional.tsx
  src/pages/partner/Advertisers.tsx  src/pages/partner/Plans.tsx  src/pages/partner/TvAccount.tsx
  src/pages/campaigns/CampaignList.tsx  src/pages/campaigns/CampaignForm.tsx  src/pages/campaigns/CampaignDetail.tsx
  src/pages/public/PublicPartner.tsx
  test/setup.ts  test/mock-api.ts  test/render.tsx
  test/theme.test.tsx test/api.test.ts test/auth.test.tsx test/admin.test.tsx
  test/catalog.test.tsx test/campaigns.test.tsx test/public.test.tsx
```
(remove `src/App.test.tsx` da Etapa 0, substituído pelos testes acima)

---

### Task 1: Ajustes de API para as telas

**Files:**
- Modify: `apps/api/src/campaigns/routes.ts`, `apps/api/src/catalog/routes.ts`, `apps/api/test/campaigns.test.ts`, `apps/api/test/catalog.test.ts`, `apps/api/test/guard.test.ts`

**Interfaces:**
- Produces: `GET /api/campaigns` e `GET /api/campaigns/:id` passam a incluir `advertiserName: string` em cada campanha; `GET /api/advertiser/plans` → `{ plans: { id, name, description, frequencyLevel }[] }` (planos ativos do parceiro do anunciante).

- [ ] **Step 1: Branch**

```bash
cd /Users/deimac/Projetos/midora
git checkout -b feat/etapa-2b-painel-web
```

- [ ] **Step 2: Testes que falham**

Em `apps/api/test/campaigns.test.ts`, dentro de `describe('creating campaigns')`:
```ts
  it('lists campaigns with the advertiser name', async () => {
    const list = (await req('GET', '/api/campaigns', s.gerenteA)).json().campaigns as { advertiserName: string; name: string }[];
    expect(list.find((c) => c.name === 'Verão')?.advertiserName).toBe('Manual A');
    const id = (await req('POST', '/api/campaigns', advCookie, { planId: planA, name: 'Com nome', ...period })).json().campaign.id;
    expect((await req('GET', `/api/campaigns/${id}`, advCookie)).json().campaign.advertiserName).toBe('Empresa anunc@x.com');
  });
```

Em `apps/api/test/catalog.test.ts`, novo bloco (importar `createUser`, `login` de `./helpers/fixtures` e `advertisers` de `../src/db/schema`):
```ts
describe('advertiser plans', () => {
  it('lists only active plans of the advertiser partner', async () => {
    await req('POST', '/api/partner/plans', s.gerenteA, { name: 'Prata', frequencyLevel: 'medium' });
    const off = (await req('POST', '/api/partner/plans', s.gerenteA, { name: 'Desligado', frequencyLevel: 'low' })).json().plan.id;
    await req('PATCH', `/api/partner/plans/${off}`, s.gerenteA, { active: false });
    await req('POST', '/api/partner/plans', s.gerenteB, { name: 'Do B', frequencyLevel: 'high' });
    const [adv] = await t.db.insert(advertisers).values({ partnerId: s.partnerA.id, name: 'Adv', source: 'manual' }).returning();
    await createUser(t.db, { email: 'adv@a.com', password: 'senha-forte-1', role: 'advertiser', partnerId: s.partnerA.id, advertiserId: adv!.id });
    const cookie = await login(t.app, 'adv@a.com', 'senha-forte-1');
    const names = (await req('GET', '/api/advertiser/plans', cookie)).json().plans.map((p: { name: string }) => p.name);
    expect(names).toContain('Prata');
    expect(names).not.toContain('Desligado');
    expect(names).not.toContain('Do B');
  });
});
```

`apps/api/test/helpers/fixtures.ts`: `createUser` aceita `advertiserId?: string` e grava `advertiserId: u.advertiserId ?? null`.

`apps/api/test/guard.test.ts`: acrescentar `['GET', '/api/advertiser/plans']` à lista.

Run: `pnpm --filter @midora/api test -- campaigns catalog guard`
Expected: FAIL — `advertiserName` indefinido; `/api/advertiser/plans` 404.

- [ ] **Step 3: Implementação**

`apps/api/src/campaigns/routes.ts`:
- Importar `advertisers` (já importado) e criar um select reutilizável:
```ts
const campaignWithAdvertiser = { campaign: campaigns, advertiserName: advertisers.name };
const flatten = (r: { campaign: Campaign; advertiserName: string | null }) => ({
  ...withStatus(r.campaign),
  advertiserName: r.advertiserName ?? '',
});
```
- `GET /api/campaigns`:
```ts
    const rows = await db
      .select(campaignWithAdvertiser)
      .from(campaigns)
      .leftJoin(advertisers, eq(advertisers.id, campaigns.advertiserId))
      .where(and(eq(campaigns.kind, 'commercial'), scope(req.user!)))
      .orderBy(desc(campaigns.createdAt));
    return { campaigns: rows.map(flatten) };
```
- `GET /api/campaigns/:id`: após `loadScopedCampaign`, buscar o nome:
```ts
    const [adv] = await db.select({ name: advertisers.name }).from(advertisers).where(eq(advertisers.id, c.advertiserId!));
    ...
    return { campaign: { ...withStatus(c), advertiserName: adv?.name ?? '' }, media: current ?? null, reviews };
```

`apps/api/src/catalog/routes.ts`, junto da rota `GET /api/advertiser`:
```ts
  app.get('/api/advertiser/plans', { preHandler: requireRole('advertiser') }, async (req) => ({
    plans: await db
      .select({ id: plans.id, name: plans.name, description: plans.description, frequencyLevel: plans.frequencyLevel })
      .from(plans)
      .where(and(eq(plans.partnerId, req.user!.partnerId!), eq(plans.active, true)))
      .orderBy(asc(plans.name)),
  }));
```

- [ ] **Step 4: Rodar e commit**

Run: `pnpm --filter @midora/api test && pnpm typecheck`
Expected: PASS.
```bash
git add apps/api
git commit -m "feat(api): include advertiser name in campaigns and list plans for advertisers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Fundação do web — tema, estilos, cliente da API

**Files:**
- Create: `apps/web/src/styles.css`, `apps/web/src/theme.ts`, `apps/web/src/ThemeToggle.tsx`, `apps/web/src/api.ts`, `apps/web/src/messages.ts`, `apps/web/src/types.ts`, `apps/web/src/format.ts`, `apps/web/test/setup.ts`, `apps/web/test/mock-api.ts`, `apps/web/test/theme.test.tsx`, `apps/web/test/api.test.ts`
- Modify: `apps/web/index.html`, `apps/web/vite.config.ts`, `apps/web/tsconfig.json`, `apps/web/package.json`
- Delete: `apps/web/src/App.test.tsx`

**Interfaces:**
- Produces:
  - `type Theme = 'light' | 'dark'`; `initialTheme(): Theme`; `applyTheme(t)`; `saveTheme(t)`; `<ThemeToggle />` (botão com `aria-label` "Ativar tema noturno" / "Ativar tema claro")
  - `class ApiError extends Error { status: number; code: string }`; `api<T>(path, opts?: { method?: string; body?: unknown; form?: FormData }): Promise<T>`; `onUnauthorized(fn)` (registra callback para 401)
  - `errorMessage(err: unknown): string`
  - tipos `User`, `Partner`, `Advertiser`, `Plan`, `Campaign`, `Media`, `Review`, `CampaignDetail`, `Role`, `FrequencyLevel`
  - `STATUS_LABEL`, `statusTone(s)`, `FREQUENCY_LABEL`, `formatDate(iso)`, `toApiRange(startDay, endDay)`, `fromApiRange(startsAt, endsAt)`
  - test helpers: `mockApi(routes)` → array de chamadas; `reply(status, json?)`

- [ ] **Step 1: Dependências e config de teste**

```bash
pnpm --filter @midora/web add react-router @tabler/icons-react
pnpm --filter @midora/web add -D @testing-library/user-event
git rm apps/web/src/App.test.tsx
```

`apps/web/vite.config.ts`:
```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:3000' } },
  test: { environment: 'jsdom', setupFiles: ['./test/setup.ts'], include: ['test/**/*.test.{ts,tsx}'] },
});
```

`apps/web/tsconfig.json` — `include`: `["src", "test", "vite.config.ts"]`.

`apps/web/test/setup.ts`:
```ts
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});
```

`apps/web/test/mock-api.ts`:
```ts
import { vi } from 'vitest';

type Reply = { __reply: true; status: number; json?: unknown };
export const reply = (status: number, json?: unknown): Reply => ({ __reply: true, status, json });
type Handler = unknown | ((body: unknown) => unknown);
export interface Call { method: string; path: string; body: unknown; form: FormData | null; contentType: string | null }

/** Stubs global fetch. Keys are "METHOD /path" (query string optional in the key). */
export function mockApi(routes: Record<string, Handler>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const method = (init.method ?? 'GET').toUpperCase();
      const path = String(input);
      const headers = new Headers(init.headers);
      const form = init.body instanceof FormData ? init.body : null;
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ method, path, body, form, contentType: headers.get('content-type') });
      const handler = routes[`${method} ${path}`] ?? routes[`${method} ${path.split('?')[0]}`];
      if (handler === undefined) return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
      const out = typeof handler === 'function' ? (handler as (b: unknown) => unknown)(body ?? form) : handler;
      const r: Reply = out && typeof out === 'object' && '__reply' in out ? (out as Reply) : reply(200, out);
      if (r.status === 204) return new Response(null, { status: 204 });
      return new Response(JSON.stringify(r.json ?? {}), { status: r.status, headers: { 'content-type': 'application/json' } });
    }),
  );
  return calls;
}
```

- [ ] **Step 2: Testes que falham**

`apps/web/test/theme.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ThemeToggle } from '../src/ThemeToggle';
import { initialTheme } from '../src/theme';

const stubSystem = (dark: boolean) =>
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: dark && q.includes('dark'), media: q }) as MediaQueryList);

describe('theme', () => {
  it('uses the saved choice, else the system preference', () => {
    stubSystem(true);
    expect(initialTheme()).toBe('dark');
    localStorage.setItem('midora-theme', 'light');
    expect(initialTheme()).toBe('light');
  });

  it('shows the moon in light mode, switches to dark and remembers it', async () => {
    stubSystem(false);
    render(<ThemeToggle />);
    const btn = screen.getByRole('button', { name: 'Ativar tema noturno' });
    expect(document.documentElement.dataset.theme).toBe('light');
    await userEvent.click(btn);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('midora-theme')).toBe('dark');
    expect(screen.getByRole('button', { name: 'Ativar tema claro' })).toBeTruthy();
  });

  it('index.html applies the theme before React renders', async () => {
    const { readFile } = await import('node:fs/promises');
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    expect(html).toMatch(/<script>[^<]*midora-theme[^<]*dataset\.theme/);
  });
});
```

`apps/web/test/api.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { ApiError, api, onUnauthorized } from '../src/api';
import { errorMessage } from '../src/messages';
import { mockApi, reply } from './mock-api';

describe('api', () => {
  it('sends JSON bodies with content-type and none for empty POSTs', async () => {
    const calls = mockApi({ 'POST /api/x': { ok: 1 }, 'POST /api/y': { ok: 2 } });
    expect(await api('/api/x', { method: 'POST', body: { a: 1 } })).toEqual({ ok: 1 });
    await api('/api/y', { method: 'POST' });
    expect(calls[0]).toMatchObject({ body: { a: 1 }, contentType: 'application/json' });
    expect(calls[1]!.contentType).toBeNull();
  });

  it('throws ApiError with the server code and handles 204', async () => {
    mockApi({ 'GET /api/bad': reply(409, { error: 'invalid_state' }), 'POST /api/none': reply(204) });
    await expect(api('/api/bad')).rejects.toMatchObject({ status: 409, code: 'invalid_state' });
    expect(await api('/api/none', { method: 'POST' })).toBeUndefined();
  });

  it('notifies on 401', async () => {
    mockApi({ 'GET /api/me': reply(401, { error: 'unauthenticated' }) });
    let called = 0;
    const off = onUnauthorized(() => { called++; });
    await expect(api('/api/me')).rejects.toBeInstanceOf(ApiError);
    off();
    expect(called).toBe(1);
  });
});

describe('errorMessage', () => {
  it('translates known codes and rate limits', () => {
    expect(errorMessage(new ApiError(401, 'invalid_credentials'))).toBe('E-mail ou senha incorretos.');
    expect(errorMessage(new ApiError(429, 'invalid_request'))).toBe('Muitas tentativas. Aguarde um pouco e tente de novo.');
    expect(errorMessage(new ApiError(415, 'unsupported_media'))).toContain('MP4');
    expect(errorMessage(new Error('boom'))).toBe('Algo deu errado. Tente de novo.');
  });
});
```

Run: `pnpm --filter @midora/web test`
Expected: FAIL — módulos inexistentes.

- [ ] **Step 3: Implementação**

`apps/web/src/theme.ts`:
```ts
export type Theme = 'light' | 'dark';
const KEY = 'midora-theme';

export function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* storage blocked */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* storage blocked */
  }
}
```

`apps/web/src/ThemeToggle.tsx`:
```tsx
import { IconMoon, IconSun } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { applyTheme, initialTheme, saveTheme, type Theme } from './theme';

// Shows the mode the button switches to: moon while light, sun while dark.
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  useEffect(() => applyTheme(theme), [theme]);
  const next: Theme = theme === 'light' ? 'dark' : 'light';
  return (
    <button
      type="button"
      className="btn-icon"
      aria-label={next === 'dark' ? 'Ativar tema noturno' : 'Ativar tema claro'}
      onClick={() => {
        saveTheme(next);
        setTheme(next);
      }}
    >
      {next === 'dark' ? <IconMoon size={18} /> : <IconSun size={18} />}
    </button>
  );
}
```

`apps/web/index.html` — dentro de `<head>`, antes de qualquer outro script:
```html
    <script>try{var t=localStorage.getItem('midora-theme');if(t!=='light'&&t!=='dark'){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme='light'}</script>
```
e `<title>Midora</title>`, `<meta name="color-scheme" content="light dark" />`.

`apps/web/src/api.ts`:
```ts
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

const unauthorizedListeners = new Set<() => void>();
export function onUnauthorized(fn: () => void): () => void {
  unauthorizedListeners.add(fn);
  return () => unauthorizedListeners.delete(fn);
}

export async function api<T>(
  path: string,
  opts: { method?: string; body?: unknown; form?: FormData } = {},
): Promise<T> {
  const init: RequestInit = { method: opts.method ?? 'GET', credentials: 'same-origin' };
  if (opts.form) {
    init.body = opts.form;
  } else if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body);
    init.headers = { 'content-type': 'application/json' };
  }
  const res = await fetch(path, init);
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    if (res.status === 401) unauthorizedListeners.forEach((fn) => fn());
    throw new ApiError(res.status, data.error ?? 'internal');
  }
  return data as T;
}
```

`apps/web/src/messages.ts`:
```ts
import { ApiError } from './api';

const MESSAGES: Record<string, string> = {
  invalid_credentials: 'E-mail ou senha incorretos.',
  unauthenticated: 'Sua sessão expirou. Entre de novo.',
  forbidden: 'Você não tem acesso a esta área.',
  not_found: 'Não encontrado.',
  invalid_request: 'Confira os campos e tente de novo.',
  email_taken: 'Este e-mail já está cadastrado.',
  slug_taken: 'Este endereço já está em uso por outro parceiro.',
  invalid_plan: 'Escolha um plano ativo.',
  invalid_period: 'A data de término precisa ser igual ou posterior à de início.',
  media_required: 'Envie uma imagem ou um vídeo antes de enviar para aprovação.',
  invalid_state: 'A situação desta campanha mudou. Atualize a página.',
  unsupported_media: 'Formato não aceito. Use JPEG, PNG, WebP ou vídeo MP4 (H.264).',
  file_too_large: 'O arquivo é maior que o limite permitido.',
  file_required: 'Escolha um arquivo.',
  storage_full: 'O servidor está sem espaço para novos arquivos. Avise o administrador.',
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 429) return 'Muitas tentativas. Aguarde um pouco e tente de novo.';
    return MESSAGES[err.code] ?? 'Algo deu errado. Tente de novo.';
  }
  return 'Algo deu errado. Tente de novo.';
}
```

`apps/web/src/types.ts`:
```ts
export type Role = 'admin' | 'partner_user' | 'advertiser' | 'player';
export type FrequencyLevel = 'low' | 'medium' | 'high';
export type CampaignStatus = 'draft' | 'pending_review' | 'changes_requested' | 'approved' | 'cancelled';
export type EffectiveStatus = CampaignStatus | 'scheduled' | 'active' | 'ended';

export interface User { id: string; email: string; role: Role; partnerId: string | null; advertiserId: string | null }
export interface Partner {
  id: string; name: string; slug: string; status: 'active' | 'inactive'; showInstitutional: boolean;
  weightLow: number; weightMedium: number; weightHigh: number; defaultImageSeconds: number;
}
export interface Advertiser { id: string; name: string; contactName: string | null; email: string | null; phone: string | null; source: 'manual' | 'self_signup' }
export interface Plan { id: string; name: string; description: string; frequencyLevel: FrequencyLevel; active?: boolean }
export interface Campaign {
  id: string; kind: 'commercial' | 'institutional'; name: string; status: CampaignStatus; effectiveStatus: EffectiveStatus;
  startsAt: string; endsAt: string; frequencyLevel: FrequencyLevel; currentMediaId: string | null;
  advertiserId: string | null; advertiserName?: string;
}
export interface Media { id: string; mediaType: 'image' | 'video'; mime: string; durationMs: number | null; displaySeconds: number | null }
export interface Review { action: 'submitted' | 'approved' | 'changes_requested' | 'cancelled'; reason: string | null; createdAt: string }
export interface CampaignDetail { campaign: Campaign; media: Media | null; reviews: Review[] }
```

`apps/web/src/format.ts`:
```ts
import type { EffectiveStatus, FrequencyLevel } from './types';

export const STATUS_LABEL: Record<EffectiveStatus, string> = {
  draft: 'Rascunho',
  pending_review: 'Aguardando aprovação',
  changes_requested: 'Correção pedida',
  approved: 'Aprovada',
  scheduled: 'Agendada',
  active: 'Ativa',
  ended: 'Encerrada',
  cancelled: 'Cancelada',
};

export type Tone = 'pending' | 'active' | 'changes' | 'neutral' | 'off';
export function statusTone(s: EffectiveStatus): Tone {
  if (s === 'pending_review') return 'pending';
  if (s === 'active' || s === 'approved') return 'active';
  if (s === 'changes_requested') return 'changes';
  if (s === 'ended' || s === 'cancelled') return 'off';
  return 'neutral';
}

export const FREQUENCY_LABEL: Record<FrequencyLevel, string> = { low: 'Baixa', medium: 'Média', high: 'Alta' };

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR');
}

/** Inclusive day range (YYYY-MM-DD) → [local midnight of start, local midnight after end). */
export function toApiRange(startDay: string, endDay: string): { startsAt: string; endsAt: string } {
  const start = new Date(`${startDay}T00:00:00`);
  const end = new Date(`${endDay}T00:00:00`);
  end.setDate(end.getDate() + 1);
  return { startsAt: start.toISOString(), endsAt: end.toISOString() };
}

/** Inverse of toApiRange, for display: last day included. */
export function lastDay(endsAt: string): string {
  const d = new Date(endsAt);
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString('pt-BR');
}
```

`apps/web/src/styles.css`:
```css
:root,
:root[data-theme='light'] {
  color-scheme: light;
  --bg: #f5f6f4;
  --side: #1e2320;
  --side-text: #c9d1cb;
  --side-active: #2c3430;
  --side-active-text: #ffffff;
  --card: #ffffff;
  --text: #1a1d1b;
  --muted: #6b736e;
  --border: #e3e6e2;
  --accent: #0e8a5f;
  --accent-hover: #0b744f;
  --on-accent: #ffffff;
  --soft: #f0f2ef;
  --danger: #b42318;
  --pending-bg: #fff3d6; --pending-fg: #7a5300;
  --active-bg: #ddf3e8; --active-fg: #0b5e41;
  --changes-bg: #fbe3dc; --changes-fg: #8a2f14;
  --neutral-bg: #eef0ed; --neutral-fg: #4a524d;
  --off-bg: #ececea; --off-fg: #5f5e5a;
}
:root[data-theme='dark'] {
  color-scheme: dark;
  --bg: #14120f;
  --side: #1c1915;
  --side-text: #a39a8e;
  --side-active: #2a251f;
  --side-active-text: #2bb37f;
  --card: #211d18;
  --text: #f2ede6;
  --muted: #9b9288;
  --border: #332d26;
  --accent: #2bb37f;
  --accent-hover: #3cc690;
  --on-accent: #08140f;
  --soft: #2a251f;
  --danger: #f0a58a;
  --pending-bg: #3a2e14; --pending-fg: #f2c26b;
  --active-bg: #18301f; --active-fg: #8fd9a8;
  --changes-bg: #3a1e16; --changes-fg: #f0a58a;
  --neutral-bg: #2a251f; --neutral-fg: #c9c0b4;
  --off-bg: #26221d; --off-fg: #8c8378;
}
* { box-sizing: border-box; }
html, body, #root { margin: 0; min-height: 100%; }
body { background: var(--bg); color: var(--text); font: 14px/1.5 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
a { color: var(--accent); }
h1 { font-size: 20px; font-weight: 600; margin: 0; }
h2 { font-size: 16px; font-weight: 600; margin: 0 0 12px; }
.shell { display: flex; min-height: 100vh; }
.side { width: 220px; flex-shrink: 0; background: var(--side); color: var(--side-text); padding: 18px 12px; display: flex; flex-direction: column; gap: 2px; }
.brand { display: flex; align-items: center; gap: 10px; color: var(--side-active-text); font-weight: 600; margin: 0 8px 20px; }
.brand-mark { width: 26px; height: 26px; border-radius: 7px; background: var(--accent); }
.nav-link { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 8px; color: var(--side-text); text-decoration: none; }
.nav-link:hover { background: var(--side-active); }
.nav-link.active { background: var(--side-active); color: var(--side-active-text); }
.side-foot { margin-top: auto; display: flex; flex-direction: column; gap: 8px; padding: 12px 8px 0; border-top: 1px solid rgba(255, 255, 255, 0.08); font-size: 12px; }
.side-actions { display: flex; gap: 8px; align-items: center; }
.main { flex: 1; min-width: 0; padding: 24px 28px; }
.page-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 20px; }
.card { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 16px 18px; margin-bottom: 16px; }
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; margin-bottom: 16px; }
.kpi { background: var(--soft); border-radius: 10px; padding: 10px 14px; }
.kpi span { display: block; font-size: 12px; color: var(--muted); }
.kpi strong { font-size: 22px; font-weight: 600; }
.list { background: var(--card); border: 1px solid var(--border); border-radius: 10px; }
.row { display: flex; align-items: center; gap: 12px; padding: 12px 14px; color: inherit; text-decoration: none; }
.row + .row { border-top: 1px solid var(--border); }
a.row:hover { background: var(--soft); }
.row-main { flex: 1; min-width: 0; }
.row-sub { font-size: 12px; color: var(--muted); }
.badge { font-size: 12px; padding: 3px 9px; border-radius: 999px; white-space: nowrap; }
.badge-pending { background: var(--pending-bg); color: var(--pending-fg); }
.badge-active { background: var(--active-bg); color: var(--active-fg); }
.badge-changes { background: var(--changes-bg); color: var(--changes-fg); }
.badge-neutral { background: var(--neutral-bg); color: var(--neutral-fg); }
.badge-off { background: var(--off-bg); color: var(--off-fg); }
.btn { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--border); background: var(--card); color: var(--text); border-radius: 8px; padding: 8px 14px; font: inherit; cursor: pointer; text-decoration: none; }
.btn:hover { background: var(--soft); }
.btn:disabled { opacity: 0.6; cursor: progress; }
.btn-primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.btn-primary:hover { background: var(--accent-hover); }
.btn-danger { color: var(--danger); }
.btn-icon { border: 0; background: transparent; color: inherit; cursor: pointer; padding: 6px; border-radius: 8px; display: inline-flex; }
.btn-icon:hover { background: var(--side-active); }
.form { display: grid; gap: 12px; max-width: 520px; }
.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.field { display: grid; gap: 4px; }
.field > span { font-size: 12px; color: var(--muted); }
input, select, textarea { font: inherit; color: var(--text); background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; }
input:focus, select:focus, textarea:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
.check { display: flex; gap: 8px; align-items: center; }
.notice { border-radius: 8px; padding: 10px 12px; margin-bottom: 12px; }
.notice-error { background: var(--changes-bg); color: var(--changes-fg); }
.notice-ok { background: var(--active-bg); color: var(--active-fg); }
.notice-info { background: var(--pending-bg); color: var(--pending-fg); }
.actions { display: flex; flex-wrap: wrap; gap: 8px; }
.preview { max-width: 100%; max-height: 320px; border-radius: 8px; background: #000; display: block; }
.muted { color: var(--muted); }
.center-page { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
.auth-card { width: 100%; max-width: 380px; }
.timeline { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
@media (max-width: 720px) {
  .shell { flex-direction: column; }
  .side { width: auto; flex-direction: row; flex-wrap: wrap; }
  .side-foot { margin-top: 0; border-top: 0; }
  .form-row { grid-template-columns: 1fr; }
  .main { padding: 16px; }
}
```

- [ ] **Step 4: Rodar e commit**

Run: `pnpm --filter @midora/web test && pnpm --filter @midora/web typecheck`
Expected: theme 3 e api 4 PASS.
```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): add theme tokens, light/dark toggle and API client

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Login, sessão, layout e rotas por papel

**Files:**
- Create: `apps/web/src/auth.tsx`, `apps/web/src/ui.tsx`, `apps/web/src/pages/Login.tsx`, `apps/web/src/pages/Home.tsx`, `apps/web/test/render.tsx`, `apps/web/test/auth.test.tsx`
- Modify: `apps/web/src/App.tsx`, `apps/web/src/main.tsx`

**Interfaces:**
- Consumes: Task 2.
- Produces:
  - `AuthProvider`; `useAuth(): { user: User | null; loading: boolean; login(email, password): Promise<User>; logout(): Promise<void>; setUser(u) }`
  - `RequireRole({ role, children })` — sem sessão → `/entrar?voltar=<path>`; papel errado → `homeFor(user)`
  - `homeFor(user): string` — admin `/admin/parceiros`; partner_user `/parceiro/campanhas`; advertiser `/anunciante/campanhas`; player `/tv`
  - `Layout` com menu por papel; `Badge({ status })`, `Field({ label, children })`, `Notice({ kind, children })`, `PageHeader({ title, action? })`
  - `AppRoutes` (rotas sem o router, para teste) e `App` = providers + `AppRoutes`
  - test helper `renderAt(path)` → renderiza `App` dentro de `MemoryRouter`

- [ ] **Step 1: Teste que falha**

`apps/web/test/render.tsx`:
```tsx
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { App } from '../src/App';

export function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

export const partnerUser = { id: 'u1', email: 'g@a.com', role: 'partner_user', partnerId: 'p1', advertiserId: null };
export const advertiserUser = { id: 'u2', email: 'ad@a.com', role: 'advertiser', partnerId: 'p1', advertiserId: 'a1' };
export const adminUser = { id: 'u0', email: 'admin@m.com', role: 'admin', partnerId: null, advertiserId: null };
```

`apps/web/test/auth.test.tsx`:
```tsx
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockApi, reply } from './mock-api';
import { advertiserUser, partnerUser, renderAt } from './render';

const empty = { campaigns: [] };

describe('login and session', () => {
  it('sends unauthenticated visitors to login and back after signing in', async () => {
    let me: unknown = reply(401, { error: 'unauthenticated' });
    mockApi({
      'GET /api/auth/me': () => me,
      'POST /api/auth/login': () => { me = { user: partnerUser }; return { user: partnerUser }; },
      'GET /api/campaigns': empty,
    });
    renderAt('/parceiro/campanhas');
    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeTruthy();
    await userEvent.type(screen.getByLabelText('E-mail'), 'g@a.com');
    await userEvent.type(screen.getByLabelText('Senha'), 'senha-forte-1');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('heading', { name: 'Campanhas' })).toBeTruthy();
  });

  it('shows a Portuguese message for wrong credentials', async () => {
    mockApi({
      'GET /api/auth/me': reply(401, { error: 'unauthenticated' }),
      'POST /api/auth/login': reply(401, { error: 'invalid_credentials' }),
    });
    renderAt('/entrar');
    await userEvent.type(await screen.findByLabelText('E-mail'), 'x@y.com');
    await userEvent.type(screen.getByLabelText('Senha'), 'errada');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByText('E-mail ou senha incorretos.')).toBeTruthy();
  });

  it('keeps advertisers out of partner and admin areas', async () => {
    mockApi({ 'GET /api/auth/me': { user: advertiserUser }, 'GET /api/campaigns': empty });
    renderAt('/admin/parceiros');
    expect(await screen.findByRole('heading', { name: 'Minhas campanhas' })).toBeTruthy();
    expect(screen.queryByText('Parceiros')).toBeNull();
  });

  it('returns to login when the session expires mid-use', async () => {
    let expired = false;
    mockApi({
      'GET /api/auth/me': () => (expired ? reply(401, { error: 'unauthenticated' }) : { user: partnerUser }),
      'GET /api/campaigns': empty,
      'GET /api/partner/plans': () => { expired = true; return reply(401, { error: 'unauthenticated' }); },
    });
    renderAt('/parceiro/campanhas');
    await screen.findByRole('heading', { name: 'Campanhas' });
    await userEvent.click(screen.getByRole('link', { name: /Planos/ }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Entrar' })).toBeTruthy());
  });

  it('logs out', async () => {
    let logged = true;
    mockApi({
      'GET /api/auth/me': () => (logged ? { user: partnerUser } : reply(401, { error: 'unauthenticated' })),
      'GET /api/campaigns': empty,
      'POST /api/auth/logout': () => { logged = false; return reply(204); },
    });
    renderAt('/parceiro/campanhas');
    await userEvent.click(await screen.findByRole('button', { name: 'Sair' }));
    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeTruthy();
  });
});
```

Run: `pnpm --filter @midora/web test -- auth`
Expected: FAIL.

- [ ] **Step 2: Implementação**

`apps/web/src/auth.tsx`:
```tsx
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { api, onUnauthorized } from './api';
import type { Role, User } from './types';

interface AuthState {
  user: User | null;
  loading: boolean;
  login(email: string, password: string): Promise<User>;
  logout(): Promise<void>;
  setUser(u: User | null): void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ user: User }>('/api/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
    return onUnauthorized(() => setUser(null));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api<{ user: User }>('/api/auth/login', { method: 'POST', body: { email, password } });
    setUser(r.user);
    return r.user;
  }, []);

  const logout = useCallback(async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    setUser(null);
  }, []);

  return <AuthContext.Provider value={{ user, loading, login, logout, setUser }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

export function homeFor(user: User): string {
  if (user.role === 'admin') return '/admin/parceiros';
  if (user.role === 'partner_user') return '/parceiro/campanhas';
  if (user.role === 'advertiser') return '/anunciante/campanhas';
  return '/tv';
}

export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="center-page muted">Carregando…</div>;
  if (!user) return <Navigate to={`/entrar?voltar=${encodeURIComponent(location.pathname)}`} replace />;
  if (user.role !== role) return <Navigate to={homeFor(user)} replace />;
  return <>{children}</>;
}
```

`apps/web/src/ui.tsx`:
```tsx
import {
  IconBuildingStore, IconDeviceTv, IconLogout, IconSpeakerphone, IconTags, IconUsersGroup,
} from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { useAuth } from './auth';
import { STATUS_LABEL, statusTone } from './format';
import { ThemeToggle } from './ThemeToggle';
import type { EffectiveStatus, Role } from './types';

const NAV: Record<Exclude<Role, 'player'>, { to: string; label: string; icon: ReactNode }[]> = {
  admin: [
    { to: '/admin/parceiros', label: 'Parceiros', icon: <IconUsersGroup size={18} /> },
    { to: '/admin/institucionais', label: 'Institucionais', icon: <IconSpeakerphone size={18} /> },
  ],
  partner_user: [
    { to: '/parceiro/campanhas', label: 'Campanhas', icon: <IconSpeakerphone size={18} /> },
    { to: '/parceiro/anunciantes', label: 'Anunciantes', icon: <IconBuildingStore size={18} /> },
    { to: '/parceiro/planos', label: 'Planos', icon: <IconTags size={18} /> },
    { to: '/parceiro/tv', label: 'Conta da TV', icon: <IconDeviceTv size={18} /> },
  ],
  advertiser: [{ to: '/anunciante/campanhas', label: 'Minhas campanhas', icon: <IconSpeakerphone size={18} /> }],
};

export function Layout({ role }: { role: Exclude<Role, 'player'> }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="shell">
      <nav className="side" aria-label="Menu principal">
        <div className="brand"><span className="brand-mark" aria-hidden="true" />Midora</div>
        {NAV[role].map((item) => (
          <NavLink key={item.to} to={item.to} className="nav-link">
            {item.icon}
            {item.label}
          </NavLink>
        ))}
        <div className="side-foot">
          <span>{user?.email}</span>
          <div className="side-actions">
            <ThemeToggle />
            <button
              type="button"
              className="btn-icon"
              aria-label="Sair"
              onClick={async () => {
                await logout();
                navigate('/entrar');
              }}
            >
              <IconLogout size={18} />
            </button>
          </div>
        </div>
      </nav>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}

export function Badge({ status }: { status: EffectiveStatus }) {
  return <span className={`badge badge-${statusTone(status)}`}>{STATUS_LABEL[status]}</span>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Notice({ kind, children }: { kind: 'error' | 'ok' | 'info'; children: ReactNode }) {
  return (
    <div className={`notice notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function PageHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="page-header">
      <h1>{title}</h1>
      {action}
    </div>
  );
}
```

`apps/web/src/pages/Login.tsx`:
```tsx
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { homeFor, useAuth } from '../auth';
import { errorMessage } from '../messages';
import { ThemeToggle } from '../ThemeToggle';
import { Field, Notice } from '../ui';

export function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={homeFor(user)} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u = await login(email, password);
      const back = params.get('voltar');
      navigate(back && back.startsWith('/') ? back : homeFor(u), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-page">
      <div className="card auth-card">
        <div className="page-header">
          <h1>Entrar</h1>
          <ThemeToggle />
        </div>
        {error && <Notice kind="error">{error}</Notice>}
        <form className="form" onSubmit={submit}>
          <Field label="E-mail">
            <input type="text" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Senha">
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <button className="btn btn-primary" type="submit" disabled={busy}>Entrar</button>
        </form>
      </div>
    </div>
  );
}
```
(campo de e-mail é `type="text"` porque o login da TV é `tv@<slug>`, sem domínio.)

`apps/web/src/pages/Home.tsx`:
```tsx
import { Navigate } from 'react-router';
import { homeFor, useAuth } from '../auth';

export function Home() {
  const { user, loading } = useAuth();
  if (loading) return <div className="center-page muted">Carregando…</div>;
  return <Navigate to={user ? homeFor(user) : '/entrar'} replace />;
}

export function TvNotice() {
  return (
    <div className="center-page">
      <div className="card auth-card">
        <h1>Conta da TV</h1>
        <p className="muted">Esta conta é usada pelo player. Na TV, abra o endereço <a href="/player/">/player</a>.</p>
      </div>
    </div>
  );
}
```

`apps/web/src/App.tsx` (versão inicial; as páginas das Tasks 4–7 entram nas rotas conforme são criadas — nesta task, usar componentes provisórios `Placeholder` com o título esperado para `Campanhas`, `Minhas campanhas`, `Planos`, que serão substituídos):
```tsx
import { Navigate, Route, Routes } from 'react-router';
import { AuthProvider, RequireRole } from './auth';
import { Home, TvNotice } from './pages/Home';
import { Login } from './pages/Login';
import { Layout } from './ui';

function Placeholder({ title }: { title: string }) {
  return <h1>{title}</h1>;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/entrar" element={<Login />} />
      <Route path="/tv" element={<TvNotice />} />
      <Route path="/admin" element={<RequireRole role="admin"><Layout role="admin" /></RequireRole>}>
        <Route path="parceiros" element={<Placeholder title="Parceiros" />} />
        <Route path="institucionais" element={<Placeholder title="Institucionais" />} />
      </Route>
      <Route path="/parceiro" element={<RequireRole role="partner_user"><Layout role="partner_user" /></RequireRole>}>
        <Route path="campanhas" element={<Placeholder title="Campanhas" />} />
        <Route path="anunciantes" element={<Placeholder title="Anunciantes" />} />
        <Route path="planos" element={<Placeholder title="Planos" />} />
        <Route path="tv" element={<Placeholder title="Conta da TV" />} />
      </Route>
      <Route path="/anunciante" element={<RequireRole role="advertiser"><Layout role="advertiser" /></RequireRole>}>
        <Route path="campanhas" element={<Placeholder title="Minhas campanhas" />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
```
Os placeholders não chamam a API; para o teste de sessão expirada, o placeholder de `Planos` é substituído já nesta task por uma chamada real: criar `apps/web/src/pages/partner/Plans.tsx` mínimo que faz `api('/api/partner/plans')` em `useEffect` e mostra `<h1>Planos</h1>` (a versão completa vem na Task 5). Idem `Campanhas`: criar `apps/web/src/pages/campaigns/CampaignList.tsx` mínimo com `api('/api/campaigns')` e título `Campanhas`/`Minhas campanhas` conforme o papel (versão completa na Task 6).

`apps/web/src/main.tsx`:
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
```

- [ ] **Step 3: Rodar e commit**

Run: `pnpm --filter @midora/web test && pnpm --filter @midora/web typecheck && pnpm lint`
Expected: auth 5 PASS + anteriores.
```bash
git add apps/web
git commit -m "feat(web): add login, session handling, role routes and layout

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Telas do admin — parceiros e institucionais

**Files:**
- Create: `apps/web/src/pages/admin/Partners.tsx`, `apps/web/src/pages/admin/Institutional.tsx`, `apps/web/test/admin.test.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: `api`, `errorMessage`, `Field`, `Notice`, `PageHeader`, `Badge`, `toApiRange`, `formatDate`, `lastDay`, `FREQUENCY_LABEL`.
- Produces: rotas `/admin/parceiros` e `/admin/institucionais`; helper exportado `slugify(name): string`.

- [ ] **Step 1: Teste que falha**

`apps/web/test/admin.test.tsx`:
```tsx
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { slugify } from '../src/pages/admin/Partners';
import { mockApi } from './mock-api';
import { adminUser, renderAt } from './render';

const partner = {
  id: 'p1', name: 'Ironberg', slug: 'ironberg', status: 'active', showInstitutional: false,
  weightLow: 1, weightMedium: 2, weightHigh: 3, defaultImageSeconds: 10,
};

describe('slugify', () => {
  it('builds URL-safe slugs from names', () => {
    expect(slugify('Academia São João  Fit!')).toBe('academia-sao-joao-fit');
  });
});

describe('admin partners', () => {
  it('lists partners and creates one with a generated slug', async () => {
    const calls = mockApi({
      'GET /api/auth/me': { user: adminUser },
      'GET /api/admin/partners': { partners: [partner] },
      'POST /api/admin/partners': (b: unknown) => ({ partner: { ...partner, id: 'p2', ...(b as object) } }),
    });
    renderAt('/admin/parceiros');
    expect(await screen.findByText('Ironberg')).toBeTruthy();
    await userEvent.type(screen.getByLabelText('Nome do parceiro'), 'Studio Forma');
    expect((screen.getByLabelText('Endereço (slug)') as HTMLInputElement).value).toBe('studio-forma');
    await userEvent.click(screen.getByRole('button', { name: 'Criar parceiro' }));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ name: 'Studio Forma', slug: 'studio-forma', showInstitutional: false });
  });

  it('edits weights and adds a partner user', async () => {
    const calls = mockApi({
      'GET /api/auth/me': { user: adminUser },
      'GET /api/admin/partners': { partners: [partner] },
      'PATCH /api/admin/partners/p1': (b: unknown) => ({ partner: { ...partner, ...(b as object) } }),
      'POST /api/admin/partners/p1/users': { user: { id: 'u9', email: 'g@iron.com', role: 'partner_user' } },
    });
    renderAt('/admin/parceiros');
    await userEvent.click(await screen.findByRole('button', { name: 'Editar Ironberg' }));
    const editor = screen.getByRole('region', { name: 'Editar Ironberg' });
    const high = within(editor).getByLabelText('Peso alta');
    await userEvent.clear(high);
    await userEvent.type(high, '5');
    await userEvent.click(within(editor).getByLabelText('Exibir anúncios institucionais'));
    await userEvent.click(within(editor).getByRole('button', { name: 'Salvar' }));
    expect(calls.find((c) => c.method === 'PATCH')!.body).toMatchObject({ weightHigh: 5, showInstitutional: true });
    await userEvent.type(within(editor).getByLabelText('E-mail do usuário'), 'g@iron.com');
    await userEvent.type(within(editor).getByLabelText('Senha inicial'), 'senha-forte-1');
    await userEvent.click(within(editor).getByRole('button', { name: 'Adicionar usuário' }));
    expect(await screen.findByText('Usuário g@iron.com criado.')).toBeTruthy();
  });
});

describe('admin institutional campaigns', () => {
  it('creates an institutional campaign with an inclusive date range', async () => {
    const calls = mockApi({
      'GET /api/auth/me': { user: adminUser },
      'GET /api/admin/campaigns': { campaigns: [] },
      'POST /api/admin/campaigns': (b: unknown) => ({ campaign: { id: 'c1', name: 'Anuncie aqui', status: 'approved', effectiveStatus: 'scheduled', ...(b as object) } }),
    });
    renderAt('/admin/institucionais');
    await userEvent.type(await screen.findByLabelText('Nome'), 'Anuncie aqui');
    await userEvent.type(screen.getByLabelText('Início'), '2026-11-01');
    await userEvent.type(screen.getByLabelText('Fim'), '2026-11-30');
    await userEvent.click(screen.getByRole('button', { name: 'Criar campanha' }));
    const body = calls.find((c) => c.method === 'POST')!.body as { startsAt: string; endsAt: string; frequencyLevel: string };
    expect(new Date(body.endsAt).getTime() - new Date(body.startsAt).getTime()).toBe(30 * 86_400_000);
    expect(body.frequencyLevel).toBe('low');
  });
});
```

Run: `pnpm --filter @midora/web test -- admin`
Expected: FAIL.

- [ ] **Step 2: Implementação**

`apps/web/src/pages/admin/Partners.tsx`:
```tsx
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api';
import { errorMessage } from '../../messages';
import type { Partner } from '../../types';
import { Field, Notice, PageHeader } from '../../ui';

export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function Partners() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [institutional, setInstitutional] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ partners: Partner[] }>('/api/admin/partners').then((r) => setPartners(r.partners)).catch((e) => setError(errorMessage(e)));
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ partner: Partner }>('/api/admin/partners', {
        method: 'POST',
        body: { name, slug, showInstitutional: institutional },
      });
      setPartners((list) => [...list, r.partner].sort((a, b) => a.name.localeCompare(b.name)));
      setName('');
      setSlug('');
      setSlugTouched(false);
      setInstitutional(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Parceiros" />
      {error && <Notice kind="error">{error}</Notice>}
      <div className="list" style={{ marginBottom: 16 }}>
        {partners.map((p) => (
          <div key={p.id}>
            <div className="row">
              <div className="row-main">
                <div>{p.name}</div>
                <div className="row-sub">/p/{p.slug} · institucionais {p.showInstitutional ? 'sim' : 'não'}</div>
              </div>
              <span className={`badge ${p.status === 'active' ? 'badge-active' : 'badge-off'}`}>{p.status === 'active' ? 'Ativo' : 'Inativo'}</span>
              <button className="btn" type="button" aria-label={`Editar ${p.name}`} onClick={() => setEditing(editing === p.id ? null : p.id)}>
                Editar
              </button>
            </div>
            {editing === p.id && (
              <PartnerEditor partner={p} onSaved={(np) => setPartners((list) => list.map((x) => (x.id === np.id ? np : x)))} />
            )}
          </div>
        ))}
        {partners.length === 0 && <div className="row muted">Nenhum parceiro cadastrado.</div>}
      </div>
      <div className="card">
        <h2>Novo parceiro</h2>
        <form className="form" onSubmit={create}>
          <Field label="Nome do parceiro">
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!slugTouched) setSlug(slugify(e.target.value));
              }}
              required
            />
          </Field>
          <Field label="Endereço (slug)">
            <input
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(slugify(e.target.value));
              }}
              required
            />
          </Field>
          <label className="check">
            <input type="checkbox" checked={institutional} onChange={(e) => setInstitutional(e.target.checked)} />
            Exibir anúncios institucionais
          </label>
          <div>
            <button className="btn btn-primary" type="submit" disabled={busy}>Criar parceiro</button>
          </div>
        </form>
      </div>
    </>
  );
}

function PartnerEditor({ partner, onSaved }: { partner: Partner; onSaved(p: Partner): void }) {
  const [form, setForm] = useState(partner);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const num = (k: 'weightLow' | 'weightMedium' | 'weightHigh' | 'defaultImageSeconds') => ({
    value: String(form[k]),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: Number(e.target.value) }),
    type: 'number',
    min: 1,
  });

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { name, status, showInstitutional, weightLow, weightMedium, weightHigh, defaultImageSeconds } = form;
      const r = await api<{ partner: Partner }>(`/api/admin/partners/${partner.id}`, {
        method: 'PATCH',
        body: { name, status, showInstitutional, weightLow, weightMedium, weightHigh, defaultImageSeconds },
      });
      onSaved(r.partner);
      setMsg({ kind: 'ok', text: 'Alterações salvas.' });
    } catch (err) {
      setMsg({ kind: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function addUser(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/api/admin/partners/${partner.id}/users`, { method: 'POST', body: { email, password } });
      setMsg({ kind: 'ok', text: `Usuário ${email.trim().toLowerCase()} criado.` });
      setEmail('');
      setPassword('');
    } catch (err) {
      setMsg({ kind: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-label={`Editar ${partner.name}`} style={{ margin: 12 }}>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <form className="form" onSubmit={save}>
        <Field label="Nome"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
        <Field label="Situação">
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Partner['status'] })}>
            <option value="active">Ativo</option>
            <option value="inactive">Inativo (desconecta usuários e TVs)</option>
          </select>
        </Field>
        <label className="check">
          <input type="checkbox" checked={form.showInstitutional} onChange={(e) => setForm({ ...form, showInstitutional: e.target.checked })} />
          Exibir anúncios institucionais
        </label>
        <div className="form-row">
          <Field label="Peso baixa"><input {...num('weightLow')} /></Field>
          <Field label="Peso média"><input {...num('weightMedium')} /></Field>
        </div>
        <div className="form-row">
          <Field label="Peso alta"><input {...num('weightHigh')} /></Field>
          <Field label="Segundos por imagem"><input {...num('defaultImageSeconds')} /></Field>
        </div>
        <div><button className="btn btn-primary" type="submit" disabled={busy}>Salvar</button></div>
      </form>
      <h2 style={{ marginTop: 20 }}>Usuário do parceiro</h2>
      <form className="form" onSubmit={addUser}>
        <div className="form-row">
          <Field label="E-mail do usuário"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
          <Field label="Senha inicial"><input type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
        </div>
        <div><button className="btn" type="submit" disabled={busy}>Adicionar usuário</button></div>
      </form>
    </section>
  );
}
```

`apps/web/src/pages/admin/Institutional.tsx`:
```tsx
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api';
import { FREQUENCY_LABEL, formatDate, lastDay, toApiRange } from '../../format';
import { errorMessage } from '../../messages';
import type { Campaign, FrequencyLevel } from '../../types';
import { Badge, Field, Notice, PageHeader } from '../../ui';

export function Institutional() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [name, setName] = useState('');
  const [frequency, setFrequency] = useState<FrequencyLevel>('low');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () =>
    api<{ campaigns: Campaign[] }>('/api/admin/campaigns').then((r) => setCampaigns(r.campaigns)).catch((e) => setMsg({ kind: 'error', text: errorMessage(e) }));
  useEffect(() => { void load(); }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (end < start) return setMsg({ kind: 'error', text: 'A data de término precisa ser igual ou posterior à de início.' });
    setBusy(true);
    try {
      await api('/api/admin/campaigns', { method: 'POST', body: { name, frequencyLevel: frequency, ...toApiRange(start, end) } });
      setName('');
      setStart('');
      setEnd('');
      setMsg({ kind: 'ok', text: 'Campanha criada. Envie a mídia para ela entrar na rotação.' });
      await load();
    } catch (err) {
      setMsg({ kind: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function upload(c: Campaign, file: File) {
    const form = new FormData();
    form.append('file', file);
    try {
      await api(`/api/admin/campaigns/${c.id}/media`, { method: 'POST', form });
      setMsg({ kind: 'ok', text: `Mídia enviada para ${c.name}.` });
      await load();
    } catch (err) {
      setMsg({ kind: 'error', text: errorMessage(err) });
    }
  }

  async function cancel(c: Campaign) {
    if (!window.confirm(`Cancelar ${c.name}? Ela sai da rotação.`)) return;
    try {
      await api(`/api/admin/campaigns/${c.id}/cancel`, { method: 'POST' });
      await load();
    } catch (err) {
      setMsg({ kind: 'error', text: errorMessage(err) });
    }
  }

  return (
    <>
      <PageHeader title="Institucionais" />
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <div className="list" style={{ marginBottom: 16 }}>
        {campaigns.map((c) => (
          <div className="row" key={c.id}>
            <div className="row-main">
              <div>{c.name}</div>
              <div className="row-sub">
                {formatDate(c.startsAt)} a {lastDay(c.endsAt)} · frequência {FREQUENCY_LABEL[c.frequencyLevel].toLowerCase()} · {c.currentMediaId ? 'com mídia' : 'sem mídia'}
              </div>
            </div>
            <Badge status={c.effectiveStatus} />
            {c.status === 'approved' && (
              <>
                <label className="btn">
                  Enviar mídia
                  <input hidden type="file" accept="image/jpeg,image/png,image/webp,video/mp4" onChange={(e) => e.target.files?.[0] && upload(c, e.target.files[0])} />
                </label>
                <button className="btn btn-danger" type="button" onClick={() => cancel(c)}>Cancelar</button>
              </>
            )}
          </div>
        ))}
        {campaigns.length === 0 && <div className="row muted">Nenhuma campanha institucional.</div>}
      </div>
      <div className="card">
        <h2>Nova campanha institucional</h2>
        <form className="form" onSubmit={create}>
          <Field label="Nome"><input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
          <Field label="Frequência">
            <select value={frequency} onChange={(e) => setFrequency(e.target.value as FrequencyLevel)}>
              <option value="low">Baixa</option>
              <option value="medium">Média</option>
              <option value="high">Alta</option>
            </select>
          </Field>
          <div className="form-row">
            <Field label="Início"><input type="date" value={start} onChange={(e) => setStart(e.target.value)} required /></Field>
            <Field label="Fim"><input type="date" value={end} onChange={(e) => setEnd(e.target.value)} required /></Field>
          </div>
          <div><button className="btn btn-primary" type="submit" disabled={busy}>Criar campanha</button></div>
        </form>
      </div>
    </>
  );
}
```
`apps/web/src/App.tsx`: trocar os placeholders do admin por `<Partners />` e `<Institutional />`.

- [ ] **Step 3: Rodar e commit**

Run: `pnpm --filter @midora/web test && pnpm --filter @midora/web typecheck && pnpm lint`
Expected: admin 4 PASS + anteriores.
```bash
git add apps/web
git commit -m "feat(web): add admin partner management and institutional campaigns

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4b: Planos Midora (API e tela do super admin)

**Files:**
- Modify: `apps/api/src/db/schema.ts`, `apps/api/src/partners/admin-routes.ts`, `apps/api/src/app.ts`, `apps/api/test/guard.test.ts`, `apps/api/test/schema.test.ts`
- Create: `apps/api/src/midora-plans/routes.ts`, `apps/api/test/midora-plans.test.ts`, `apps/api/drizzle/0002_*.sql` (gerado)
- Create: `apps/web/src/pages/admin/MidoraPlans.tsx`, `apps/web/test/midora-plans.test.tsx`
- Modify: `apps/web/src/pages/admin/Partners.tsx`, `apps/web/src/types.ts`, `apps/web/src/format.ts`, `apps/web/src/ui.tsx`, `apps/web/src/App.tsx`

**Interfaces:**
- Produces (API):
  - tabela `midora_plans` (`id`, `name`, `description` default `''`, `price_cents` inteiro ≥ 0 ou nulo, `active` default true, timestamps); `partners.midora_plan_id` (FK nula, `ON DELETE RESTRICT`)
  - `GET /api/admin/midora-plans` → `{ plans }`; `POST /api/admin/midora-plans` `{ name, description?, priceCents? }` → 201 `{ plan }`; `PATCH /api/admin/midora-plans/:id` `{ name?, description?, priceCents?, active? }` → `{ plan }` | 404
  - `PATCH /api/admin/partners/:id` aceita `midoraPlanId: uuid | null` (plano inexistente → 400 `invalid_plan`)
- Produces (web): rota `/admin/planos-midora`; item de menu "Planos Midora"; seletor "Plano Midora" no editor do parceiro; `formatMoney(cents)`, `parseMoney(text)`; tipo `MidoraPlan`; `Partner.midoraPlanId`.

- [ ] **Step 1: Testes de API que falham**

`apps/api/test/midora-plans.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, seed } from './helpers/app';

let t: Awaited<ReturnType<typeof createTestApp>>;
let s: Awaited<ReturnType<typeof seed>>;
beforeAll(async () => {
  t = await createTestApp();
  s = await seed(t.app, t.db);
});
afterAll(() => t.close());

const req = (method: 'GET' | 'POST' | 'PATCH', url: string, cookie?: string, payload?: unknown) =>
  t.app.inject({ method, url, headers: cookie ? { cookie } : {}, payload: payload as object });

describe('Midora plans', () => {
  it('admin creates, lists and updates plans', async () => {
    const res = await req('POST', '/api/admin/midora-plans', s.admin, { name: 'Essencial', description: 'Até 2 TVs', priceCents: 9900 });
    expect(res.statusCode).toBe(201);
    expect(res.json().plan).toMatchObject({ name: 'Essencial', priceCents: 9900, active: true });
    const id = res.json().plan.id;
    expect((await req('PATCH', `/api/admin/midora-plans/${id}`, s.admin, { active: false, priceCents: null })).json().plan)
      .toMatchObject({ active: false, priceCents: null });
    expect((await req('GET', '/api/admin/midora-plans', s.admin)).json().plans.map((p: { id: string }) => p.id)).toContain(id);
  });

  it('rejects negative prices and non-admins', async () => {
    expect((await req('POST', '/api/admin/midora-plans', s.admin, { name: 'X', priceCents: -1 })).statusCode).toBe(400);
    expect((await req('GET', '/api/admin/midora-plans', s.gerenteA)).statusCode).toBe(403);
    expect((await req('PATCH', '/api/admin/midora-plans/00000000-0000-4000-8000-000000000000', s.admin, { name: 'Y' })).statusCode).toBe(404);
  });

  it('assigns and clears a partner plan', async () => {
    const plan = (await req('POST', '/api/admin/midora-plans', s.admin, { name: 'Pro' })).json().plan;
    const upd = await req('PATCH', `/api/admin/partners/${s.partnerA.id}`, s.admin, { midoraPlanId: plan.id });
    expect(upd.json().partner.midoraPlanId).toBe(plan.id);
    const bad = await req('PATCH', `/api/admin/partners/${s.partnerA.id}`, s.admin, { midoraPlanId: '00000000-0000-4000-8000-000000000000' });
    expect(bad.json()).toEqual({ error: 'invalid_plan' });
    expect((await req('PATCH', `/api/admin/partners/${s.partnerA.id}`, s.admin, { midoraPlanId: null })).json().partner.midoraPlanId).toBeNull();
  });
});
```

`apps/api/test/guard.test.ts`: acrescentar `['GET', '/api/admin/midora-plans']`, `['POST', '/api/admin/midora-plans']`, `['PATCH', `/api/admin/midora-plans/${ID}`]`.

Run: `pnpm --filter @midora/api test -- midora-plans`
Expected: FAIL (rotas 404).

- [ ] **Step 2: Schema, migração e rotas**

`apps/api/src/db/schema.ts` — **antes** de `partners`:
```ts
export const midoraPlans = pgTable(
  'midora_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    priceCents: integer('price_cents'),
    active: boolean('active').notNull().default(true),
    ...timestamps,
  },
  (t) => [check('midora_plans_price_check', sql`${t.priceCents} is null or ${t.priceCents} >= 0`)],
);
```
e em `partners`:
```ts
    midoraPlanId: uuid('midora_plan_id').references(() => midoraPlans.id, { onDelete: 'restrict' }),
```

Run: `pnpm --filter @midora/api db:generate --name midora_plans` → `drizzle/0002_midora_plans.sql` só com `CREATE TABLE`, `ALTER TABLE "partners" ADD COLUMN`, `ADD CONSTRAINT` (sem `DROP`).

`apps/api/src/midora-plans/routes.ts`:
```ts
import { asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../auth/guard';
import type { Db } from '../db/client';
import { midoraPlans } from '../db/schema';
import { parse } from '../http/validation';

const Fields = {
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000),
  priceCents: z.number().int().min(0).max(100_000_000).nullable(),
};
const CreatePlan = z.object({ name: Fields.name, description: Fields.description.optional(), priceCents: Fields.priceCents.optional() }).strict();
const UpdatePlan = z.object({ ...Fields, active: z.boolean() }).partial().strict();
const IdParams = z.object({ id: z.uuid() });

// Plans Midora sells to partners (spec D8): catalog only, no billing or limits.
export const midoraPlanRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  app.addHook('preHandler', requireRole('admin'));

  app.get('/api/admin/midora-plans', async () => ({
    plans: await db.select().from(midoraPlans).orderBy(asc(midoraPlans.name)),
  }));

  app.post('/api/admin/midora-plans', async (req, reply) => {
    const body = parse(CreatePlan, req.body, reply);
    if (!body) return reply;
    const [plan] = await db.insert(midoraPlans).values(body).returning();
    return reply.code(201).send({ plan });
  });

  app.patch('/api/admin/midora-plans/:id', async (req, reply) => {
    const params = parse(IdParams, req.params, reply);
    if (!params) return reply;
    const body = parse(UpdatePlan, req.body, reply);
    if (!body) return reply;
    const [plan] = await db
      .update(midoraPlans)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(midoraPlans.id, params.id))
      .returning();
    if (!plan) return reply.code(404).send({ error: 'not_found' });
    return { plan };
  });
};
```

`apps/api/src/partners/admin-routes.ts`: em `UpdatePartner` acrescentar `midoraPlanId: z.uuid().nullable().optional()`; no `PATCH`, antes do update:
```ts
    if (body.midoraPlanId) {
      const [plan] = await db.select({ id: midoraPlans.id }).from(midoraPlans).where(eq(midoraPlans.id, body.midoraPlanId));
      if (!plan) return reply.code(400).send({ error: 'invalid_plan' });
    }
```
(importar `midoraPlans`). `apps/api/src/app.ts`: registrar `midoraPlanRoutes` junto de `adminPartnerRoutes`.

Run: `pnpm --filter @midora/api test && pnpm typecheck`
Expected: PASS (3 novos + guarda).

- [ ] **Step 3: Teste de tela que falha**

`apps/web/test/midora-plans.test.tsx`:
```tsx
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { formatMoney, parseMoney } from '../src/format';
import { mockApi } from './mock-api';
import { adminUser, renderAt } from './render';

describe('money', () => {
  it('formats and parses Brazilian reais', () => {
    expect(formatMoney(9900)).toMatch(/R\$\s?99,00/);
    expect(formatMoney(null)).toBe('Sem valor definido');
    expect(parseMoney('1.234,56')).toBe(123456);
    expect(parseMoney('99')).toBe(9900);
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('abc')).toBeUndefined();
  });
});

describe('Midora plans screen', () => {
  it('creates a plan with a price in reais', async () => {
    const calls = mockApi({
      'GET /api/auth/me': { user: adminUser },
      'GET /api/admin/midora-plans': { plans: [] },
      'POST /api/admin/midora-plans': (b: unknown) => ({ plan: { id: 'mp1', active: true, description: '', ...(b as object) } }),
    });
    renderAt('/admin/planos-midora');
    await userEvent.type(await screen.findByLabelText('Nome do plano'), 'Essencial');
    await userEvent.type(screen.getByLabelText('Valor mensal de referência (R$)'), '99,90');
    await userEvent.click(screen.getByRole('button', { name: 'Criar plano' }));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ name: 'Essencial', priceCents: 9990 });
    expect(await screen.findByText('Essencial')).toBeTruthy();
  });

  it('assigns a Midora plan in the partner editor', async () => {
    const partner = { id: 'p1', name: 'Ironberg', slug: 'ironberg', status: 'active', showInstitutional: false, weightLow: 1, weightMedium: 2, weightHigh: 3, defaultImageSeconds: 10, midoraPlanId: null };
    const calls = mockApi({
      'GET /api/auth/me': { user: adminUser },
      'GET /api/admin/partners': { partners: [partner] },
      'GET /api/admin/midora-plans': { plans: [{ id: 'mp1', name: 'Essencial', description: '', priceCents: 9900, active: true }] },
      'PATCH /api/admin/partners/p1': (b: unknown) => ({ partner: { ...partner, ...(b as object) } }),
    });
    renderAt('/admin/parceiros');
    await userEvent.click(await screen.findByRole('button', { name: 'Editar Ironberg' }));
    const editor = screen.getByRole('region', { name: 'Editar Ironberg' });
    await userEvent.selectOptions(within(editor).getByLabelText('Plano Midora'), 'mp1');
    await userEvent.click(within(editor).getByRole('button', { name: 'Salvar' }));
    expect(calls.find((c) => c.method === 'PATCH')!.body).toMatchObject({ midoraPlanId: 'mp1' });
    expect(await screen.findByText(/Plano Midora: Essencial/)).toBeTruthy();
  });
});
```

Run: `pnpm --filter @midora/web test -- midora-plans`
Expected: FAIL.

- [ ] **Step 4: Implementação web**

`apps/web/src/types.ts`:
```ts
export interface MidoraPlan { id: string; name: string; description: string; priceCents: number | null; active: boolean }
```
e `Partner` ganha `midoraPlanId: string | null`.

`apps/web/src/format.ts`:
```ts
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function formatMoney(cents: number | null): string {
  return cents === null ? 'Sem valor definido' : BRL.format(cents / 100);
}

/** "1.234,56" → 123456; "" → null; invalid → undefined. */
export function parseMoney(text: string): number | null | undefined {
  const t = text.trim();
  if (t === '') return null;
  if (!/^\d{1,3}(\.?\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(t)) return undefined;
  const [int, dec = ''] = t.replace(/\./g, '').split(',');
  return Number(int) * 100 + Number(dec.padEnd(2, '0'));
}
```

`apps/web/src/pages/admin/MidoraPlans.tsx`:
```tsx
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api';
import { formatMoney, parseMoney } from '../../format';
import { errorMessage } from '../../messages';
import type { MidoraPlan } from '../../types';
import { Field, Notice, PageHeader } from '../../ui';

export function MidoraPlans() {
  const [plans, setPlans] = useState<MidoraPlan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ plans: MidoraPlan[] }>('/api/admin/midora-plans').then((r) => setPlans(r.plans)).catch((e) => setError(errorMessage(e)));
  }, []);

  async function toggle(p: MidoraPlan) {
    try {
      const r = await api<{ plan: MidoraPlan }>(`/api/admin/midora-plans/${p.id}`, { method: 'PATCH', body: { active: !p.active } });
      setPlans((l) => l.map((x) => (x.id === p.id ? r.plan : x)));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    const priceCents = parseMoney(price);
    if (priceCents === undefined) return setError('Valor inválido. Use o formato 99,90.');
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ plan: MidoraPlan }>('/api/admin/midora-plans', {
        method: 'POST',
        body: { name, ...(description.trim() ? { description } : {}), ...(priceCents !== null ? { priceCents } : {}) },
      });
      setPlans((l) => [...l, r.plan].sort((a, b) => a.name.localeCompare(b.name)));
      setName('');
      setDescription('');
      setPrice('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Planos Midora" />
      <p className="muted" style={{ marginTop: -12 }}>Planos que o Midora oferece aos parceiros. Ainda sem cobrança: servem de registro do que cada parceiro contratou.</p>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="list" style={{ marginBottom: 16 }}>
        {plans.map((p) => (
          <div className="row" key={p.id}>
            <div className="row-main">
              <div>{p.name}</div>
              <div className="row-sub">{formatMoney(p.priceCents)}{p.description ? ` · ${p.description}` : ''}</div>
            </div>
            <span className={`badge ${p.active ? 'badge-active' : 'badge-off'}`}>{p.active ? 'Ativo' : 'Inativo'}</span>
            <button className="btn" type="button" aria-label={`${p.active ? 'Desativar' : 'Ativar'} ${p.name}`} onClick={() => toggle(p)}>
              {p.active ? 'Desativar' : 'Ativar'}
            </button>
          </div>
        ))}
        {plans.length === 0 && <div className="row muted">Nenhum Plano Midora cadastrado.</div>}
      </div>
      <div className="card">
        <h2>Novo Plano Midora</h2>
        <form className="form" onSubmit={create}>
          <Field label="Nome do plano"><input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
          <Field label="Valor mensal de referência (R$)"><input inputMode="decimal" placeholder="99,90" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
          <Field label="Descrição"><textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          <div><button className="btn btn-primary" type="submit" disabled={busy}>Criar plano</button></div>
        </form>
      </div>
    </>
  );
}
```

`apps/web/src/pages/admin/Partners.tsx`:
- carregar também `GET /api/admin/midora-plans` em `Partners` e passar `plans` ao `PartnerEditor`;
- na linha do parceiro, `row-sub` mostra `Plano Midora: <nome>` (ou `sem Plano Midora`);
- no `PartnerEditor`, novo campo antes dos pesos:
```tsx
        <Field label="Plano Midora">
          <select value={form.midoraPlanId ?? ''} onChange={(e) => setForm({ ...form, midoraPlanId: e.target.value || null })}>
            <option value="">Sem plano</option>
            {plans.filter((p) => p.active || p.id === form.midoraPlanId).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </Field>
```
e o `PATCH` inclui `midoraPlanId`.
- O teste da Task 4 que verifica o corpo do `PATCH` usa `toMatchObject`, então continua válido; o mock do teste da Task 4 precisa responder `GET /api/admin/midora-plans` com `{ plans: [] }` — acrescentar essa rota aos dois testes de parceiros da Task 4.

`apps/web/src/ui.tsx`: menu do admin ganha `{ to: '/admin/planos-midora', label: 'Planos Midora', icon: <IconReceipt size={18} /> }` (entre Parceiros e Institucionais).
`apps/web/src/App.tsx`: `<Route path="planos-midora" element={<MidoraPlans />} />` sob `/admin`.
Na tela de planos do parceiro (Task 5), o título passa a ser **"Planos de anúncio"** e o item de menu idem; ajustar o teste da Task 3 (link `Planos` → `/Planos de anúncio/`) e o da Task 5.

- [ ] **Step 5: Rodar e commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: tudo verde.
```bash
git add apps/api apps/web
git commit -m "feat: add Midora plans catalog and assign a plan to each partner

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Telas do parceiro — anunciantes, planos e conta da TV

**Files:**
- Create: `apps/web/src/pages/partner/Advertisers.tsx`, `apps/web/src/pages/partner/TvAccount.tsx`, `apps/web/test/catalog.test.tsx`
- Modify: `apps/web/src/pages/partner/Plans.tsx` (versão completa), `apps/web/src/App.tsx`

**Interfaces:**
- Produces: rotas `/parceiro/anunciantes`, `/parceiro/planos`, `/parceiro/tv`.

- [ ] **Step 1: Teste que falha**

`apps/web/test/catalog.test.tsx`:
```tsx
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockApi } from './mock-api';
import { partnerUser, renderAt } from './render';

describe('advertisers', () => {
  it('lists and creates advertisers', async () => {
    const calls = mockApi({
      'GET /api/auth/me': { user: partnerUser },
      'GET /api/partner/advertisers': { advertisers: [{ id: 'a1', name: 'Loja Fit', contactName: 'Bia', email: null, phone: null, source: 'self_signup' }] },
      'POST /api/partner/advertisers': (b: unknown) => ({ advertiser: { id: 'a2', source: 'manual', contactName: null, email: null, phone: null, ...(b as object) } }),
    });
    renderAt('/parceiro/anunciantes');
    expect(await screen.findByText('Loja Fit')).toBeTruthy();
    expect(screen.getByText(/autocadastro/)).toBeTruthy();
    await userEvent.type(screen.getByLabelText('Empresa'), 'Clínica Vida');
    await userEvent.click(screen.getByRole('button', { name: 'Cadastrar anunciante' }));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ name: 'Clínica Vida' });
    expect(await screen.findByText('Clínica Vida')).toBeTruthy();
  });
});

describe('plans', () => {
  it('creates plans and toggles active', async () => {
    const calls = mockApi({
      'GET /api/auth/me': { user: partnerUser },
      'GET /api/partner/plans': { plans: [{ id: 'pl1', name: 'Ouro', description: '', frequencyLevel: 'high', active: true }] },
      'POST /api/partner/plans': (b: unknown) => ({ plan: { id: 'pl2', active: true, description: '', ...(b as object) } }),
      'PATCH /api/partner/plans/pl1': { plan: { id: 'pl1', name: 'Ouro', description: '', frequencyLevel: 'high', active: false } },
    });
    renderAt('/parceiro/planos');
    expect(await screen.findByText('Ouro')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Desativar Ouro' }));
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ active: false });
    expect(await screen.findByRole('button', { name: 'Ativar Ouro' })).toBeTruthy();
    await userEvent.type(screen.getByLabelText('Nome do plano'), 'Prata');
    await userEvent.selectOptions(screen.getByLabelText('Frequência'), 'medium');
    await userEvent.click(screen.getByRole('button', { name: 'Criar plano' }));
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({ name: 'Prata', frequencyLevel: 'medium' });
  });
});

describe('TV account', () => {
  it('shows the TV login and sets a password', async () => {
    const calls = mockApi({
      'GET /api/auth/me': { user: partnerUser },
      'GET /api/partner': { partner: { id: 'p1', name: 'Ironberg', slug: 'ironberg' } },
      'PUT /api/partner/player-account': { login: 'tv@ironberg' },
    });
    renderAt('/parceiro/tv');
    expect(await screen.findByText('tv@ironberg')).toBeTruthy();
    await userEvent.type(screen.getByLabelText('Nova senha da TV'), 'senha-tv-123');
    await userEvent.click(screen.getByRole('button', { name: 'Definir senha' }));
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ password: 'senha-tv-123' });
    expect(await screen.findByText(/TVs conectadas foram desconectadas/)).toBeTruthy();
  });
});
```

Run: `pnpm --filter @midora/web test -- catalog`
Expected: FAIL.

- [ ] **Step 2: Implementação**

`apps/web/src/pages/partner/Advertisers.tsx`:
```tsx
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api';
import { errorMessage } from '../../messages';
import type { Advertiser } from '../../types';
import { Field, Notice, PageHeader } from '../../ui';

export function Advertisers() {
  const [list, setList] = useState<Advertiser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', contactName: '', email: '', phone: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ advertisers: Advertiser[] }>('/api/partner/advertisers').then((r) => setList(r.advertisers)).catch((e) => setError(errorMessage(e)));
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim() !== ''));
    try {
      const r = await api<{ advertiser: Advertiser }>('/api/partner/advertisers', { method: 'POST', body });
      setList((l) => [...l, r.advertiser].sort((a, b) => a.name.localeCompare(b.name)));
      setForm({ name: '', contactName: '', email: '', phone: '' });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <>
      <PageHeader title="Anunciantes" />
      {error && <Notice kind="error">{error}</Notice>}
      <div className="list" style={{ marginBottom: 16 }}>
        {list.map((a) => (
          <div className="row" key={a.id}>
            <div className="row-main">
              <div>{a.name}</div>
              <div className="row-sub">
                {[a.contactName, a.email, a.phone].filter(Boolean).join(' · ') || 'Sem contato'} · {a.source === 'self_signup' ? 'autocadastro' : 'cadastro manual'}
              </div>
            </div>
          </div>
        ))}
        {list.length === 0 && <div className="row muted">Nenhum anunciante ainda. Cadastre abaixo ou divulgue sua página pública.</div>}
      </div>
      <div className="card">
        <h2>Novo anunciante</h2>
        <form className="form" onSubmit={create}>
          <Field label="Empresa"><input value={form.name} onChange={set('name')} required /></Field>
          <div className="form-row">
            <Field label="Contato"><input value={form.contactName} onChange={set('contactName')} /></Field>
            <Field label="Telefone"><input value={form.phone} onChange={set('phone')} /></Field>
          </div>
          <Field label="E-mail"><input type="email" value={form.email} onChange={set('email')} /></Field>
          <div><button className="btn btn-primary" type="submit" disabled={busy}>Cadastrar anunciante</button></div>
        </form>
      </div>
    </>
  );
}
```

`apps/web/src/pages/partner/Plans.tsx`:
```tsx
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api';
import { FREQUENCY_LABEL } from '../../format';
import { errorMessage } from '../../messages';
import type { FrequencyLevel, Plan } from '../../types';
import { Field, Notice, PageHeader } from '../../ui';

export function Plans() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [frequency, setFrequency] = useState<FrequencyLevel>('low');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ plans: Plan[] }>('/api/partner/plans').then((r) => setPlans(r.plans)).catch((e) => setError(errorMessage(e)));
  }, []);

  const replace = (p: Plan) => setPlans((l) => l.map((x) => (x.id === p.id ? p : x)));

  async function toggle(p: Plan) {
    try {
      const r = await api<{ plan: Plan }>(`/api/partner/plans/${p.id}`, { method: 'PATCH', body: { active: !p.active } });
      replace(r.plan);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ plan: Plan }>('/api/partner/plans', {
        method: 'POST',
        body: { name, frequencyLevel: frequency, ...(description.trim() ? { description } : {}) },
      });
      setPlans((l) => [...l, r.plan].sort((a, b) => a.name.localeCompare(b.name)));
      setName('');
      setDescription('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Planos" />
      {error && <Notice kind="error">{error}</Notice>}
      <div className="list" style={{ marginBottom: 16 }}>
        {plans.map((p) => (
          <div className="row" key={p.id}>
            <div className="row-main">
              <div>{p.name}</div>
              <div className="row-sub">Frequência {FREQUENCY_LABEL[p.frequencyLevel].toLowerCase()}{p.description ? ` · ${p.description}` : ''}</div>
            </div>
            <span className={`badge ${p.active ? 'badge-active' : 'badge-off'}`}>{p.active ? 'Ativo' : 'Inativo'}</span>
            <button className="btn" type="button" aria-label={`${p.active ? 'Desativar' : 'Ativar'} ${p.name}`} onClick={() => toggle(p)}>
              {p.active ? 'Desativar' : 'Ativar'}
            </button>
          </div>
        ))}
        {plans.length === 0 && <div className="row muted">Crie o primeiro plano para os anunciantes escolherem.</div>}
      </div>
      <div className="card">
        <h2>Novo plano</h2>
        <form className="form" onSubmit={create}>
          <Field label="Nome do plano"><input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
          <Field label="Frequência">
            <select value={frequency} onChange={(e) => setFrequency(e.target.value as FrequencyLevel)}>
              <option value="low">Baixa</option>
              <option value="medium">Média</option>
              <option value="high">Alta</option>
            </select>
          </Field>
          <Field label="Descrição (aparece na página pública)">
            <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <div><button className="btn btn-primary" type="submit" disabled={busy}>Criar plano</button></div>
        </form>
      </div>
    </>
  );
}
```

`apps/web/src/pages/partner/TvAccount.tsx`:
```tsx
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api';
import { errorMessage } from '../../messages';
import { Field, Notice, PageHeader } from '../../ui';

export function TvAccount() {
  const [login, setLogin] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ partner: { slug: string } }>('/api/partner').then((r) => setLogin(`tv@${r.partner.slug}`)).catch((e) => setMsg({ kind: 'error', text: errorMessage(e) }));
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{ login: string }>('/api/partner/player-account', { method: 'PUT', body: { password } });
      setLogin(r.login);
      setPassword('');
      setMsg({ kind: 'ok', text: 'Senha definida. As TVs conectadas foram desconectadas e precisam entrar com a nova senha.' });
    } catch (err) {
      setMsg({ kind: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Conta da TV" />
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <div className="card">
        <p>Na TV, abra o navegador no endereço do Midora seguido de <strong>/player</strong> e entre com:</p>
        <p>Usuário: <strong>{login ?? '…'}</strong></p>
        <p className="muted">Trocar a senha desconecta todas as TVs deste estabelecimento.</p>
        <form className="form" onSubmit={save}>
          <Field label="Nova senha da TV">
            <input type="password" minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <div><button className="btn btn-primary" type="submit" disabled={busy}>Definir senha</button></div>
        </form>
      </div>
    </>
  );
}
```

`apps/web/src/App.tsx`: rotas do parceiro passam a usar `<Advertisers />`, `<Plans />`, `<TvAccount />`.

- [ ] **Step 3: Rodar e commit**

Run: `pnpm --filter @midora/web test && pnpm --filter @midora/web typecheck && pnpm lint`
Expected: catalog 3 PASS + anteriores (o teste de sessão expirada da Task 3 continua passando com o `Plans` completo).
```bash
git add apps/web
git commit -m "feat(web): add partner advertisers, plans and TV account screens

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Campanhas — lista, criação e detalhe com aprovação

**Files:**
- Modify: `apps/web/src/pages/campaigns/CampaignList.tsx` (versão completa), `apps/web/src/App.tsx`
- Create: `apps/web/src/pages/campaigns/CampaignForm.tsx`, `apps/web/src/pages/campaigns/CampaignDetail.tsx`, `apps/web/test/campaigns.test.tsx`

**Interfaces:**
- Produces: rotas `/parceiro/campanhas`, `/parceiro/campanhas/nova`, `/parceiro/campanhas/:id`, `/anunciante/campanhas`, `/anunciante/campanhas/nova`, `/anunciante/campanhas/:id`. Componentes recebem `base: '/parceiro' | '/anunciante'`.

- [ ] **Step 1: Teste que falha**

`apps/web/test/campaigns.test.tsx`:
```tsx
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockApi, reply } from './mock-api';
import { advertiserUser, partnerUser, renderAt } from './render';

const base = {
  kind: 'commercial', frequencyLevel: 'high', startsAt: '2026-11-01T03:00:00.000Z', endsAt: '2026-12-01T03:00:00.000Z',
  advertiserId: 'a1', advertiserName: 'Loja Fit', currentMediaId: 'm1',
};
const pending = { ...base, id: 'c1', name: 'Black Friday', status: 'pending_review', effectiveStatus: 'pending_review' };
const changes = { ...base, id: 'c2', name: 'Verão', status: 'changes_requested', effectiveStatus: 'changes_requested' };
const media = { id: 'm1', mediaType: 'image', mime: 'image/png', durationMs: null, displaySeconds: 10 };

describe('campaign list', () => {
  it('shows counts, advertiser names and statuses', async () => {
    mockApi({ 'GET /api/auth/me': { user: partnerUser }, 'GET /api/campaigns': { campaigns: [pending, changes] } });
    renderAt('/parceiro/campanhas');
    expect(await screen.findByText('Black Friday')).toBeTruthy();
    expect(screen.getAllByText(/Loja Fit/).length).toBe(2);
    expect(screen.getAllByText('Aguardando aprovação').length).toBeGreaterThan(0);
    expect(screen.getByText('Correção pedida')).toBeTruthy();
  });
});

describe('creating a campaign', () => {
  it('partner picks advertiser and plan; one-day period becomes 24h', async () => {
    const calls = mockApi({
      'GET /api/auth/me': { user: partnerUser },
      'GET /api/partner/advertisers': { advertisers: [{ id: 'a1', name: 'Loja Fit', source: 'manual' }] },
      'GET /api/partner/plans': { plans: [{ id: 'pl1', name: 'Ouro', description: '', frequencyLevel: 'high', active: true }, { id: 'pl2', name: 'Velho', description: '', frequencyLevel: 'low', active: false }] },
      'POST /api/campaigns': { campaign: { ...pending, id: 'c9', status: 'draft', effectiveStatus: 'draft' } },
      'GET /api/campaigns/c9': { campaign: { ...pending, id: 'c9', status: 'draft', effectiveStatus: 'draft', currentMediaId: null }, media: null, reviews: [] },
    });
    renderAt('/parceiro/campanhas/nova');
    await userEvent.selectOptions(await screen.findByLabelText('Anunciante'), 'a1');
    expect(screen.queryByRole('option', { name: /Velho/ })).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText('Plano'), 'pl1');
    await userEvent.type(screen.getByLabelText('Nome da campanha'), 'Natal');
    await userEvent.type(screen.getByLabelText('Primeiro dia'), '2026-12-24');
    await userEvent.type(screen.getByLabelText('Último dia'), '2026-12-24');
    await userEvent.click(screen.getByRole('button', { name: 'Criar campanha' }));
    const body = calls.find((c) => c.method === 'POST')!.body as Record<string, string>;
    expect(body).toMatchObject({ advertiserId: 'a1', planId: 'pl1', name: 'Natal' });
    expect(new Date(body.endsAt!).getTime() - new Date(body.startsAt!).getTime()).toBe(86_400_000);
    expect(await screen.findByRole('heading', { name: 'Black Friday' })).toBeTruthy();
  });

  it('advertiser uses its own plans and sees a Portuguese error for reversed dates', async () => {
    const calls = mockApi({
      'GET /api/auth/me': { user: advertiserUser },
      'GET /api/advertiser/plans': { plans: [{ id: 'pl1', name: 'Ouro', description: '', frequencyLevel: 'high' }] },
    });
    renderAt('/anunciante/campanhas/nova');
    expect(screen.queryByLabelText('Anunciante')).toBeNull();
    await userEvent.selectOptions(await screen.findByLabelText('Plano'), 'pl1');
    await userEvent.type(screen.getByLabelText('Nome da campanha'), 'X');
    await userEvent.type(screen.getByLabelText('Primeiro dia'), '2026-12-24');
    await userEvent.type(screen.getByLabelText('Último dia'), '2026-12-20');
    await userEvent.click(screen.getByRole('button', { name: 'Criar campanha' }));
    expect(await screen.findByText('A data de término precisa ser igual ou posterior à de início.')).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });
});

describe('campaign detail', () => {
  it('partner approves once even on double click', async () => {
    const calls = mockApi({
      'GET /api/auth/me': { user: partnerUser },
      'GET /api/campaigns/c1': { campaign: pending, media, reviews: [{ action: 'submitted', reason: null, createdAt: '2026-10-12T10:00:00Z' }] },
      'POST /api/campaigns/c1/approve': { campaign: { ...pending, status: 'approved', effectiveStatus: 'scheduled' } },
    });
    renderAt('/parceiro/campanhas/c1');
    const approve = await screen.findByRole('button', { name: 'Aprovar' });
    await userEvent.dblClick(approve);
    await waitFor(() => expect(screen.getByText('Agendada')).toBeTruthy());
    expect(calls.filter((c) => c.path === '/api/campaigns/c1/approve').length).toBe(1);
  });

  it('requesting changes needs a reason', async () => {
    const calls = mockApi({
      'GET /api/auth/me': { user: partnerUser },
      'GET /api/campaigns/c1': { campaign: pending, media, reviews: [] },
      'POST /api/campaigns/c1/request-changes': { campaign: { ...pending, status: 'changes_requested', effectiveStatus: 'changes_requested' } },
    });
    renderAt('/parceiro/campanhas/c1');
    await userEvent.click(await screen.findByRole('button', { name: 'Pedir correção' }));
    await userEvent.type(screen.getByLabelText('O que precisa ser corrigido'), 'Logo cortado');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar pedido de correção' }));
    expect(calls.find((c) => c.path.endsWith('request-changes'))!.body).toEqual({ reason: 'Logo cortado' });
  });

  it('advertiser sees the reason, uploads with display seconds and resubmits', async () => {
    const calls = mockApi({
      'GET /api/auth/me': { user: advertiserUser },
      'GET /api/campaigns/c2': {
        campaign: changes, media,
        reviews: [{ action: 'submitted', reason: null, createdAt: '2026-10-10T10:00:00Z' }, { action: 'changes_requested', reason: 'Logo cortado', createdAt: '2026-10-11T10:00:00Z' }],
      },
      'POST /api/campaigns/c2/media': { media: { ...media, id: 'm2', displaySeconds: 15 } },
      'POST /api/campaigns/c2/submit': { campaign: { ...changes, status: 'pending_review', effectiveStatus: 'pending_review' } },
    });
    renderAt('/anunciante/campanhas/c2');
    expect((await screen.findAllByText(/Logo cortado/)).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Aprovar' })).toBeNull();
    await userEvent.clear(screen.getByLabelText('Segundos na tela (imagens)'));
    await userEvent.type(screen.getByLabelText('Segundos na tela (imagens)'), '15');
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'novo.png', { type: 'image/png' });
    await userEvent.upload(screen.getByLabelText('Arquivo'), file);
    await userEvent.click(screen.getByRole('button', { name: 'Enviar arquivo' }));
    const up = calls.find((c) => c.path.startsWith('/api/campaigns/c2/media'))!;
    expect(up.path).toBe('/api/campaigns/c2/media?displaySeconds=15');
    expect((up.form!.get('file') as File).name).toBe('novo.png');
    await userEvent.click(await screen.findByRole('button', { name: 'Enviar para aprovação' }));
    expect(await screen.findByText('Aguardando aprovação')).toBeTruthy();
  });

  it('keeps the page usable when an upload is rejected', async () => {
    mockApi({
      'GET /api/auth/me': { user: advertiserUser },
      'GET /api/campaigns/c2': { campaign: changes, media, reviews: [] },
      'POST /api/campaigns/c2/media': reply(415, { error: 'unsupported_media' }),
    });
    renderAt('/anunciante/campanhas/c2');
    await userEvent.upload(await screen.findByLabelText('Arquivo'), new File(['x'], 'v.mov', { type: 'video/quicktime' }));
    await userEvent.click(screen.getByRole('button', { name: 'Enviar arquivo' }));
    expect(await screen.findByText(/Formato não aceito/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Enviar arquivo' })).toBeTruthy();
  });
});
```

Run: `pnpm --filter @midora/web test -- campaigns`
Expected: FAIL.

- [ ] **Step 2: Implementação**

`apps/web/src/pages/campaigns/CampaignList.tsx`:
```tsx
import { IconPlus } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../api';
import { FREQUENCY_LABEL, formatDate, lastDay } from '../../format';
import { errorMessage } from '../../messages';
import type { Campaign } from '../../types';
import { Badge, Notice, PageHeader } from '../../ui';

export function CampaignList({ base }: { base: '/parceiro' | '/anunciante' }) {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ campaigns: Campaign[] }>('/api/campaigns').then((r) => setCampaigns(r.campaigns)).catch((e) => setError(errorMessage(e)));
  }, []);

  const count = (pred: (c: Campaign) => boolean) => campaigns?.filter(pred).length ?? 0;
  const isPartner = base === '/parceiro';

  return (
    <>
      <PageHeader
        title={isPartner ? 'Campanhas' : 'Minhas campanhas'}
        action={<Link className="btn btn-primary" to={`${base}/campanhas/nova`}><IconPlus size={16} />Nova campanha</Link>}
      />
      {error && <Notice kind="error">{error}</Notice>}
      <div className="kpis">
        <div className="kpi"><span>Aguardando aprovação</span><strong>{count((c) => c.status === 'pending_review')}</strong></div>
        <div className="kpi"><span>Ativas</span><strong>{count((c) => c.effectiveStatus === 'active')}</strong></div>
        <div className="kpi"><span>Em preparação</span><strong>{count((c) => c.status === 'draft' || c.status === 'changes_requested')}</strong></div>
      </div>
      <div className="list">
        {campaigns?.map((c) => (
          <Link className="row" key={c.id} to={`${base}/campanhas/${c.id}`}>
            <div className="row-main">
              <div>{c.name}</div>
              <div className="row-sub">
                {isPartner && c.advertiserName ? `${c.advertiserName} · ` : ''}
                {formatDate(c.startsAt)} a {lastDay(c.endsAt)} · frequência {FREQUENCY_LABEL[c.frequencyLevel].toLowerCase()}
              </div>
            </div>
            <Badge status={c.effectiveStatus} />
          </Link>
        ))}
        {campaigns?.length === 0 && <div className="row muted">Nenhuma campanha ainda.</div>}
        {campaigns === null && !error && <div className="row muted">Carregando…</div>}
      </div>
    </>
  );
}
```

`apps/web/src/pages/campaigns/CampaignForm.tsx`:
```tsx
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../../api';
import { FREQUENCY_LABEL, toApiRange } from '../../format';
import { errorMessage } from '../../messages';
import type { Advertiser, Campaign, Plan } from '../../types';
import { Field, Notice, PageHeader } from '../../ui';

export function CampaignForm({ base }: { base: '/parceiro' | '/anunciante' }) {
  const isPartner = base === '/parceiro';
  const navigate = useNavigate();
  const [advertisers, setAdvertisers] = useState<Advertiser[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [form, setForm] = useState({ advertiserId: '', planId: '', name: '', start: '', end: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const plansUrl = isPartner ? '/api/partner/plans' : '/api/advertiser/plans';
    api<{ plans: Plan[] }>(plansUrl).then((r) => setPlans(r.plans.filter((p) => p.active !== false))).catch((e) => setError(errorMessage(e)));
    if (isPartner) {
      api<{ advertisers: Advertiser[] }>('/api/partner/advertisers').then((r) => setAdvertisers(r.advertisers)).catch((e) => setError(errorMessage(e)));
    }
  }, [isPartner]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (form.end < form.start) {
      setError('A data de término precisa ser igual ou posterior à de início.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ campaign: Campaign }>('/api/campaigns', {
        method: 'POST',
        body: {
          ...(isPartner ? { advertiserId: form.advertiserId } : {}),
          planId: form.planId,
          name: form.name,
          ...toApiRange(form.start, form.end),
        },
      });
      navigate(`${base}/campanhas/${r.campaign.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Nova campanha" />
      {error && <Notice kind="error">{error}</Notice>}
      <div className="card">
        <form className="form" onSubmit={submit}>
          {isPartner && (
            <Field label="Anunciante">
              <select value={form.advertiserId} onChange={set('advertiserId')} required>
                <option value="">Escolha…</option>
                {advertisers.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Plano">
            <select value={form.planId} onChange={set('planId')} required>
              <option value="">Escolha…</option>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name} · frequência {FREQUENCY_LABEL[p.frequencyLevel].toLowerCase()}</option>)}
            </select>
          </Field>
          <Field label="Nome da campanha"><input value={form.name} onChange={set('name')} required /></Field>
          <div className="form-row">
            <Field label="Primeiro dia"><input type="date" value={form.start} onChange={set('start')} required /></Field>
            <Field label="Último dia"><input type="date" value={form.end} onChange={set('end')} required /></Field>
          </div>
          <div><button className="btn btn-primary" type="submit" disabled={busy}>Criar campanha</button></div>
        </form>
      </div>
    </>
  );
}
```

`apps/web/src/pages/campaigns/CampaignDetail.tsx`:
```tsx
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '../../api';
import { FREQUENCY_LABEL, formatDate, lastDay } from '../../format';
import { errorMessage } from '../../messages';
import type { CampaignDetail as Detail } from '../../types';
import { Badge, Field, Notice, PageHeader } from '../../ui';

const ACTION_LABEL = {
  submitted: 'Enviada para aprovação',
  approved: 'Aprovada',
  changes_requested: 'Correção pedida',
  cancelled: 'Cancelada',
} as const;

export function CampaignDetail({ base }: { base: '/parceiro' | '/anunciante' }) {
  const { id } = useParams();
  const isPartner = base === '/parceiro';
  const [detail, setDetail] = useState<Detail | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [file, setFile] = useState<File | null>(null);
  const [seconds, setSeconds] = useState('10');
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');

  const load = useCallback(
    () => api<Detail>(`/api/campaigns/${id}`).then(setDetail).catch((e) => setMsg({ kind: 'error', text: errorMessage(e) })),
    [id],
  );
  useEffect(() => { void load(); }, [load]);

  // One request at a time, even on double clicks.
  async function run(fn: () => Promise<unknown>, ok?: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      await load();
      if (ok) setMsg({ kind: 'ok', text: ok });
    } catch (err) {
      setMsg({ kind: 'error', text: errorMessage(err) });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  if (!detail) return msg ? <Notice kind="error">{msg.text}</Notice> : <div className="muted">Carregando…</div>;
  const { campaign: c, media, reviews } = detail;
  const editable = c.status === 'draft' || c.status === 'changes_requested';
  const lastRequest = [...reviews].reverse().find((r) => r.action === 'changes_requested');

  async function upload(e: FormEvent) {
    e.preventDefault();
    if (!file) return setMsg({ kind: 'error', text: 'Escolha um arquivo.' });
    const form = new FormData();
    form.append('file', file);
    const query = file.type.startsWith('image/') ? `?displaySeconds=${encodeURIComponent(seconds)}` : '';
    await run(() => api(`/api/campaigns/${c.id}/media${query}`, { method: 'POST', form }), 'Arquivo enviado.');
    setFile(null);
  }

  return (
    <>
      <PageHeader title={c.name} action={<Badge status={c.effectiveStatus} />} />
      <p className="muted" style={{ marginTop: -12 }}>
        <Link to={`${base}/campanhas`}>Voltar para campanhas</Link>
      </p>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      {c.status === 'changes_requested' && lastRequest?.reason && (
        <Notice kind="info">Correção pedida pelo parceiro: {lastRequest.reason}</Notice>
      )}
      <div className="card">
        <p>
          {isPartner && c.advertiserName ? <>{c.advertiserName} · </> : null}
          {formatDate(c.startsAt)} a {lastDay(c.endsAt)} · frequência {FREQUENCY_LABEL[c.frequencyLevel].toLowerCase()}
        </p>
        {media ? (
          media.mediaType === 'image' ? (
            <img className="preview" src={`/api/media/${media.id}`} alt={`Anúncio ${c.name}`} />
          ) : (
            <video className="preview" src={`/api/media/${media.id}`} controls muted preload="metadata" />
          )
        ) : (
          <p className="muted">Nenhum arquivo enviado ainda.</p>
        )}
        {media && (
          <p className="muted">
            {media.mediaType === 'image' ? `Imagem · ${media.displaySeconds}s na tela` : `Vídeo · ${Math.round((media.durationMs ?? 0) / 1000)}s`}
          </p>
        )}
      </div>

      {editable && (
        <div className="card">
          <h2>{media ? 'Trocar arquivo' : 'Enviar arquivo'}</h2>
          <form className="form" onSubmit={upload}>
            <Field label="Arquivo">
              <input type="file" accept="image/jpeg,image/png,image/webp,video/mp4" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </Field>
            <Field label="Segundos na tela (imagens)">
              <input type="number" min={1} max={3600} value={seconds} onChange={(e) => setSeconds(e.target.value)} />
            </Field>
            <p className="muted">Imagens JPEG, PNG ou WebP. Vídeos MP4 (H.264).</p>
            <div><button className="btn" type="submit" disabled={busy}>Enviar arquivo</button></div>
          </form>
        </div>
      )}

      <div className="actions" style={{ marginBottom: 16 }}>
        {editable && (
          <button className="btn btn-primary" type="button" disabled={busy} onClick={() => run(() => api(`/api/campaigns/${c.id}/submit`, { method: 'POST' }), 'Campanha enviada para aprovação.')}>
            Enviar para aprovação
          </button>
        )}
        {isPartner && c.status === 'pending_review' && (
          <>
            <button className="btn btn-primary" type="button" disabled={busy} onClick={() => run(() => api(`/api/campaigns/${c.id}/approve`, { method: 'POST' }), 'Campanha aprovada.')}>
              Aprovar
            </button>
            <button className="btn" type="button" disabled={busy} onClick={() => setAsking(true)}>Pedir correção</button>
          </>
        )}
        {isPartner && c.status !== 'cancelled' && (
          <button
            className="btn btn-danger"
            type="button"
            disabled={busy}
            onClick={() => window.confirm('Cancelar esta campanha? Ela sai da rotação.') && run(() => api(`/api/campaigns/${c.id}/cancel`, { method: 'POST' }), 'Campanha cancelada.')}
          >
            Cancelar campanha
          </button>
        )}
      </div>

      {asking && (
        <div className="card">
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => api(`/api/campaigns/${c.id}/request-changes`, { method: 'POST', body: { reason } }), 'Pedido de correção enviado.').then(() => {
                setAsking(false);
                setReason('');
              });
            }}
          >
            <Field label="O que precisa ser corrigido">
              <textarea rows={3} minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} required />
            </Field>
            <div><button className="btn btn-primary" type="submit" disabled={busy}>Enviar pedido de correção</button></div>
          </form>
        </div>
      )}

      <div className="card">
        <h2>Histórico</h2>
        {reviews.length === 0 ? (
          <p className="muted">Sem movimentações ainda.</p>
        ) : (
          <ul className="timeline">
            {reviews.map((r, i) => (
              <li key={i}>
                <strong>{ACTION_LABEL[r.action]}</strong> · {new Date(r.createdAt).toLocaleString('pt-BR')}
                {r.reason ? <div className="muted">{r.reason}</div> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
```

`apps/web/src/App.tsx` — rotas de campanha para os dois papéis:
```tsx
        <Route path="campanhas" element={<CampaignList base="/parceiro" />} />
        <Route path="campanhas/nova" element={<CampaignForm base="/parceiro" />} />
        <Route path="campanhas/:id" element={<CampaignDetail base="/parceiro" />} />
```
e o equivalente com `base="/anunciante"` sob `/anunciante`.

- [ ] **Step 3: Rodar e commit**

Run: `pnpm --filter @midora/web test && pnpm --filter @midora/web typecheck && pnpm lint`
Expected: campaigns 7 PASS + anteriores.
```bash
git add apps/web
git commit -m "feat(web): add campaign list, creation and detail with approval actions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Página pública do parceiro e autocadastro

**Files:**
- Create: `apps/web/src/pages/public/PublicPartner.tsx`, `apps/web/test/public.test.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Produces: rota `/p/:slug`.

- [ ] **Step 1: Teste que falha**

`apps/web/test/public.test.tsx`:
```tsx
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockApi, reply } from './mock-api';
import { advertiserUser, renderAt } from './render';

describe('public partner page', () => {
  it('shows plans and signs up an advertiser', async () => {
    let me: unknown = reply(401, { error: 'unauthenticated' });
    const calls = mockApi({
      'GET /api/auth/me': () => me,
      'GET /api/public/partners/ironberg': {
        partner: { name: 'Ironberg', slug: 'ironberg' },
        plans: [{ id: 'pl1', name: 'Ouro', description: 'Mais exibições', frequencyLevel: 'high' }],
      },
      'POST /api/public/partners/ironberg/advertisers': () => { me = { user: advertiserUser }; return reply(201, { user: advertiserUser }); },
      'GET /api/campaigns': { campaigns: [] },
    });
    renderAt('/p/ironberg');
    expect(await screen.findByRole('heading', { name: 'Anuncie na Ironberg' })).toBeTruthy();
    expect(screen.getByText('Mais exibições')).toBeTruthy();
    await userEvent.type(screen.getByLabelText('Empresa'), 'Loja Fit');
    await userEvent.type(screen.getByLabelText('Seu nome'), 'Bia');
    await userEvent.type(screen.getByLabelText('E-mail'), 'bia@lojafit.com');
    await userEvent.type(screen.getByLabelText('Senha'), 'senha-loja-1');
    await userEvent.click(screen.getByRole('button', { name: 'Criar conta' }));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      companyName: 'Loja Fit', contactName: 'Bia', email: 'bia@lojafit.com', password: 'senha-loja-1',
    });
    expect(await screen.findByRole('heading', { name: 'Minhas campanhas' })).toBeTruthy();
  });

  it('shows a not-found message for unknown partners', async () => {
    mockApi({ 'GET /api/auth/me': reply(401, { error: 'unauthenticated' }) });
    renderAt('/p/nao-existe');
    expect(await screen.findByText('Página não encontrada.')).toBeTruthy();
  });
});
```

Run: `pnpm --filter @midora/web test -- public`
Expected: FAIL.

- [ ] **Step 2: Implementação**

`apps/web/src/pages/public/PublicPartner.tsx`:
```tsx
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { api, ApiError } from '../../api';
import { useAuth } from '../../auth';
import { FREQUENCY_LABEL } from '../../format';
import { errorMessage } from '../../messages';
import { ThemeToggle } from '../../ThemeToggle';
import type { Plan, User } from '../../types';
import { Field, Notice } from '../../ui';

interface PublicData { partner: { name: string; slug: string }; plans: Plan[] }

export function PublicPartner() {
  const { slug } = useParams();
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<PublicData | null>(null);
  const [missing, setMissing] = useState(false);
  const [form, setForm] = useState({ companyName: '', contactName: '', email: '', phone: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<PublicData>(`/api/public/partners/${encodeURIComponent(slug ?? '')}`)
      .then(setData)
      .catch((e) => (e instanceof ApiError && e.status === 404 ? setMissing(true) : setError(errorMessage(e))));
  }, [slug]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function signup(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim() !== ''));
    try {
      const r = await api<{ user: User }>(`/api/public/partners/${encodeURIComponent(slug ?? '')}/advertisers`, { method: 'POST', body });
      setUser(r.user);
      navigate('/anunciante/campanhas');
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  if (missing) return <div className="center-page"><p>Página não encontrada.</p></div>;
  if (!data) return <div className="center-page muted">{error ?? 'Carregando…'}</div>;

  return (
    <div className="main" style={{ maxWidth: 760, margin: '0 auto' }}>
      <div className="page-header">
        <h1>Anuncie na {data.partner.name}</h1>
        <ThemeToggle />
      </div>
      <p className="muted">Seu anúncio nas TVs do estabelecimento. Escolha um plano, crie sua conta e envie sua campanha para aprovação.</p>
      <div className="kpis">
        {data.plans.map((p) => (
          <div className="kpi" key={p.id}>
            <strong style={{ fontSize: 16 }}>{p.name}</strong>
            <span>Frequência {FREQUENCY_LABEL[p.frequencyLevel].toLowerCase()}</span>
            {p.description && <span>{p.description}</span>}
          </div>
        ))}
      </div>
      <div className="card">
        <h2>Criar conta de anunciante</h2>
        {error && <Notice kind="error">{error}</Notice>}
        <form className="form" onSubmit={signup}>
          <Field label="Empresa"><input value={form.companyName} onChange={set('companyName')} required /></Field>
          <div className="form-row">
            <Field label="Seu nome"><input value={form.contactName} onChange={set('contactName')} required /></Field>
            <Field label="Telefone"><input value={form.phone} onChange={set('phone')} /></Field>
          </div>
          <Field label="E-mail"><input type="email" autoComplete="email" value={form.email} onChange={set('email')} required /></Field>
          <Field label="Senha"><input type="password" minLength={8} autoComplete="new-password" value={form.password} onChange={set('password')} required /></Field>
          <div><button className="btn btn-primary" type="submit" disabled={busy}>Criar conta</button></div>
        </form>
      </div>
    </div>
  );
}
```

`apps/web/src/App.tsx`: `<Route path="/p/:slug" element={<PublicPartner />} />`.

- [ ] **Step 3: Rodar e commit**

Run: `pnpm --filter @midora/web test && pnpm --filter @midora/web typecheck && pnpm lint && pnpm build`
Expected: public 2 PASS; build OK.
```bash
git add apps/web
git commit -m "feat(web): add public partner page with advertiser self-signup

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Modo demonstração local e verificação no navegador

**Files:**
- Create: `apps/api/scripts/demo.ts`
- Modify: `apps/api/package.json` (script `demo`), `apps/api/tsconfig.json` (incluir `scripts`), `README.md`

**Interfaces:**
- Produces: `pnpm --filter @midora/api demo` → API em `http://localhost:3100` com PGlite em memória, mídia em diretório temporário, web/player buildados, e usuários de teste definidos no próprio script (nunca usados em produção).

- [ ] **Step 1: Script**

`apps/api/scripts/demo.ts`:
```ts
// Local demo only: in-memory Postgres (PGlite), temp media dir, seeded test users.
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { buildApp } from '../src/app';
import { hashPassword } from '../src/auth/password';
import type { Db } from '../src/db/client';
import * as schema from '../src/db/schema';
import { LocalStorage } from '../src/storage/local';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const DEMO_PASSWORD = 'demo-midora-123';

const client = new PGlite();
const db = drizzle(client, { schema }) as unknown as Db;
await migrate(drizzle(client, { schema }), { migrationsFolder: here('../drizzle') });

const [partner] = await db.insert(schema.partners).values({ name: 'Academia Demo', slug: 'academia-demo', showInstitutional: true }).returning();
const [advertiser] = await db.insert(schema.advertisers).values({ partnerId: partner!.id, name: 'Loja Demo', source: 'self_signup', email: 'anunciante@demo.test' }).returning();
const hash = await hashPassword(DEMO_PASSWORD);
await db.insert(schema.users).values([
  { email: 'admin@demo.test', passwordHash: hash, role: 'admin' },
  { email: 'parceiro@demo.test', passwordHash: hash, role: 'partner_user', partnerId: partner!.id },
  { email: 'anunciante@demo.test', passwordHash: hash, role: 'advertiser', partnerId: partner!.id, advertiserId: advertiser!.id },
]);
await db.insert(schema.plans).values([
  { partnerId: partner!.id, name: 'Bronze', frequencyLevel: 'low', description: 'Presença básica' },
  { partnerId: partner!.id, name: 'Ouro', frequencyLevel: 'high', description: 'Mais exibições' },
]);

const storage = new LocalStorage(await mkdtemp(join(tmpdir(), 'midora-demo-')));
await storage.init();
const app = await buildApp({
  version: 'demo',
  logger: false,
  db,
  storage,
  uploadLimits: { maxImageBytes: 10 * 1024 * 1024, maxVideoBytes: 200 * 1024 * 1024, minFreeBytes: 0, uploadsPerHour: 1000 },
  webDir: here('../../web/dist'),
  playerDir: here('../../player/dist'),
});
await app.listen({ port: 3100, host: '127.0.0.1' });
console.log('Midora demo em http://localhost:3100 — usuários *@demo.test, senha no script');
```

`apps/api/package.json`: `"demo": "tsx scripts/demo.ts"`. `apps/api/tsconfig.json`: incluir `"scripts"`.

README, seção Desenvolvimento:
```markdown
Demonstração local sem banco: `pnpm build && pnpm --filter @midora/api demo` → http://localhost:3100 (usuários `admin@demo.test`, `parceiro@demo.test`, `anunciante@demo.test`; senha em `apps/api/scripts/demo.ts`).
```

- [ ] **Step 2: Verificação no navegador (agente)**

```bash
pnpm build && pnpm --filter @midora/api demo   # em background
```
No navegador integrado, em `http://localhost:3100`:
1. Login como parceiro → criar anunciante, plano, campanha; enviar imagem PNG; enviar para aprovação; aprovar; ver "Agendada/Ativa".
2. Alternar tema (lua → noturno, sol → claro); recarregar e confirmar que o tema persiste sem piscar.
3. Login como anunciante → ver só as próprias campanhas; acessar `/admin/parceiros` e ser redirecionado.
4. `/p/academia-demo` → planos e formulário de cadastro.
5. Largura de 375 px (celular): menu e formulários utilizáveis.
Capturar screenshots dos dois temas para o relatório final. Encerrar o processo do demo ao terminar.

- [ ] **Step 3: Rodar tudo, commit e push**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
```bash
git add apps/api README.md
git commit -m "chore(api): add local demo mode with in-memory database

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin feat/etapa-2b-painel-web
```
Expected: CI verde. Depois: revisão final, correções, merge na `main` (autorizado), conferir deploy (`/entrar` e `/p/<slug>` respondem; `/api/health` com a versão nova).

---

## Critério de aceite da Etapa 2b

- Todos os testes de web e API verdes local e no CI.
- No modo demo: super admin cadastra um Plano Midora e o vincula ao parceiro; parceiro cadastra anunciante e plano, cria campanha, envia mídia, envia para aprovação e aprova; anunciante autocadastrado cria e acompanha campanha, vê motivo de correção e reenvia; admin cria parceiro, usuário e institucional.
- Temas claro e noturno com esmeralda, botão lua/sol, persistência e sem piscar.
- Produção atualizada com o painel acessível em `/entrar`.
