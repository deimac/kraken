# Etapa 0 — Fundação e implantação isolada — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Monorepo funcional (api + web + player + shared) com CI, imagem Docker única e o Midora rodando isolado no Coolify, respondendo `/api/health` no domínio provisório.

**Architecture:** pnpm workspaces. `apps/api` (Fastify) serve `/api/*`, o build estático de `apps/web` em `/` e de `apps/player` em `/player/`, com fallback SPA. Uma imagem Docker multi-stage; o Coolify constrói a partir da `main`. Sem banco nesta etapa.

**Tech Stack:** Node 24, pnpm 10.27.0, TypeScript (strict), Fastify 5 + @fastify/static, tsup, tsx, React + Vite, Vitest, Testing Library, ESLint (typescript-eslint), GitHub Actions, Docker, Coolify 4.4.6.

**Spec:** `docs/superpowers/specs/2026-10-11-midora-mvp-design.md` (seções 3, 10, 11, 12, 13 — Etapa 0)

## Global Constraints

- Runtime de produção: imagem `node:24-alpine`; `engines.node` `>=24`.
- Gerenciador: `pnpm@10.27.0` (campo `packageManager`); lockfile `pnpm-lock.yaml` versionado; CI usa `--frozen-lockfile`.
- Monólito modular, um contêiner; nada de microserviços.
- A aplicação escuta `PORT` (padrão 3000) em `HOST` (padrão `0.0.0.0`).
- Nenhum segredo no repositório; variáveis só no Coolify.
- Logs JSON (pino) no stdout com redação de `authorization`, `cookie`, `set-cookie` e `password`.
- Coolify: projeto `midora` dedicado, ambiente `production`, limite de memória 1 GB, domínio `*.sslip.io` provisório, healthcheck `/api/health`. Nenhum recurso existente é alterado.
- Branch de trabalho `feat/etapa-0-fundacao`; Conventional Commits; merge na `main` somente após aprovação do usuário; cada commit termina com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Docker não está instalado no Mac; a imagem é validada no CI (job `docker`) e no build do Coolify.

## Review Focus

1. Rota `/api/*` inexistente deve responder **404 JSON**, nunca o `index.html` do SPA (senão o player, na Etapa 3, interpretaria HTML como JSON) — teste na Task 3.
2. Recarregar uma URL profunda do player (`/player/qualquer`) deve devolver o `index.html` **do player**, não o do painel — teste na Task 3.
3. API iniciada sem `WEB_DIR`/`PLAYER_DIR` (modo dev) deve subir e responder `/api/health`; `/` responde 404 JSON — teste na Task 3.
4. `PORT` inválida (`abc`, `0`, `70000`) deve falhar no início com mensagem clara, não escutar em porta aleatória — teste na Task 2.
5. Logs nunca contêm valores de `authorization`, `cookie` ou `password` — teste na Task 2.

---

## Estrutura de arquivos

```
midora/
  package.json                 workspaces, scripts agregados, devDeps de lint/TS
  pnpm-workspace.yaml
  pnpm-lock.yaml               gerado
  tsconfig.base.json           opções TS comuns
  eslint.config.js
  .nvmrc                       24
  .dockerignore
  Dockerfile
  README.md
  .github/workflows/ci.yml
  docs/DEPLOY.md
  packages/shared/
    package.json  tsconfig.json
    src/index.ts               tipos compartilhados (HealthResponse)
  apps/api/
    package.json  tsconfig.json  tsup.config.ts
    src/config.ts              lê e valida env
    src/logger.ts              opções do pino (nível, redação)
    src/app.ts                 buildApp(): instancia Fastify e registra módulos
    src/health.ts              GET /api/health
    src/static.ts              arquivos estáticos + fallback SPA + 404 JSON
    src/server.ts              entrypoint: config → app → listen, sinais
    test/config.test.ts
    test/logger.test.ts
    test/health.test.ts
    test/static.test.ts
  apps/web/
    package.json  tsconfig.json  vite.config.ts  index.html
    src/main.tsx  src/App.tsx  src/App.test.tsx
  apps/player/
    package.json  tsconfig.json  vite.config.ts  index.html
    src/main.tsx  src/App.tsx  src/App.test.tsx
```

---

### Task 1: Monorepo, shared e tooling

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.js`, `.nvmrc`, `README.md`
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`
- Modify: `.gitignore` (já existe; manter)

**Interfaces:**
- Produces: pacote `@midora/shared` exportando `interface HealthResponse { status: 'ok'; version: string }`; scripts raiz `build`, `test`, `typecheck`, `lint`; `tsconfig.base.json` estendido por todos os pacotes.

- [ ] **Step 1: Criar a branch**

```bash
cd /Users/deimac/Projetos/midora
git checkout -b feat/etapa-0-fundacao
```

- [ ] **Step 2: Arquivos raiz**

`package.json`:
```json
{
  "name": "midora",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.27.0",
  "engines": { "node": ">=24" },
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck",
    "lint": "eslint .",
    "dev:api": "pnpm --filter @midora/api dev",
    "dev:web": "pnpm --filter @midora/web dev",
    "dev:player": "pnpm --filter @midora/player dev"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - apps/*
  - packages/*
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "noEmit": true
  }
}
```

`eslint.config.js`:
```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
```

`.nvmrc`:
```
24
```

`README.md`:
````markdown
# Midora

**SMART MEDIA NETWORK** — Sua mídia. Múltiplas possibilidades.

Plataforma para exibir anúncios em TVs de estabelecimentos parceiros e contabilizar inserções por campanha.

## Estrutura

- `apps/api` — API Fastify; em produção também serve `apps/web` (`/`) e `apps/player` (`/player/`).
- `apps/web` — painel (admin, parceiro, anunciante) e páginas públicas.
- `apps/player` — player web das TVs.
- `packages/shared` — tipos e schemas compartilhados.
- `docs/` — especificação, planos e implantação (`docs/DEPLOY.md`).

## Desenvolvimento

Requisitos: Node 24+, pnpm 10.

```bash
pnpm install
pnpm dev:api      # http://localhost:3000/api/health
pnpm dev:web      # painel, com proxy de /api para a API
pnpm dev:player   # player, com proxy de /api para a API
```

Verificações: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
````

- [ ] **Step 3: Pacote shared**

`packages/shared/package.json`:
```json
{
  "name": "@midora/shared",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit" }
}
```

`packages/shared/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

`packages/shared/src/index.ts`:
```ts
export interface HealthResponse {
  status: 'ok';
  version: string;
}
```

- [ ] **Step 4: Instalar devDependencies raiz e de shared**

```bash
pnpm add -Dw typescript eslint @eslint/js typescript-eslint
pnpm --filter @midora/shared add -D typescript
```
Expected: `pnpm-lock.yaml` criado, sem erros.

- [ ] **Step 5: Verificar**

Run: `pnpm lint && pnpm typecheck`
Expected: ambos terminam com código 0.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json eslint.config.js .nvmrc README.md packages/shared
git commit -m "chore: scaffold pnpm monorepo and shared package

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: API — config, logger, health

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/tsup.config.ts`
- Create: `apps/api/src/config.ts`, `apps/api/src/logger.ts`, `apps/api/src/health.ts`, `apps/api/src/app.ts`, `apps/api/src/server.ts`
- Test: `apps/api/test/config.test.ts`, `apps/api/test/logger.test.ts`, `apps/api/test/health.test.ts`

**Interfaces:**
- Consumes: `HealthResponse` de `@midora/shared`.
- Produces:
  - `loadConfig(env?: NodeJS.ProcessEnv): Config` com `interface Config { port: number; host: string; webDir?: string; playerDir?: string; version: string; logLevel: string }`
  - `loggerOptions(level: string, stream?: { write(msg: string): void })` — objeto de logger do Fastify com redação
  - `interface AppOptions { version: string; logger?: FastifyServerOptions['logger']; webDir?: string; playerDir?: string }`
  - `buildApp(opts: AppOptions): Promise<FastifyInstance>`
  - `healthRoutes: FastifyPluginAsync<{ version: string }>`

- [ ] **Step 1: Pacote e configuração**

`apps/api/package.json`:
```json
{
  "name": "@midora/api",
  "private": true,
  "type": "module",
  "files": ["dist"],
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsup",
    "start": "node dist/server.js",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

`apps/api/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "lib": ["ES2023"], "types": ["node"] },
  "include": ["src", "test", "tsup.config.ts"]
}
```

`apps/api/tsup.config.ts`:
```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  noExternal: ['@midora/shared'],
  clean: true,
});
```

```bash
pnpm --filter @midora/api add fastify @fastify/static
pnpm --filter @midora/api add -D @midora/shared@workspace:* typescript tsup tsx vitest @types/node
```

- [ ] **Step 2: Testes que falham**

`apps/api/test/config.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

describe('loadConfig', () => {
  it('uses defaults', () => {
    expect(loadConfig({})).toEqual({
      port: 3000,
      host: '0.0.0.0',
      webDir: undefined,
      playerDir: undefined,
      version: 'dev',
      logLevel: 'info',
    });
  });

  it('reads env values', () => {
    const c = loadConfig({
      PORT: '8080', HOST: '127.0.0.1', WEB_DIR: '/w', PLAYER_DIR: '/p',
      APP_VERSION: '1.2.3', LOG_LEVEL: 'debug',
    });
    expect(c).toEqual({
      port: 8080, host: '127.0.0.1', webDir: '/w', playerDir: '/p',
      version: '1.2.3', logLevel: 'debug',
    });
  });

  it('falls back to SOURCE_COMMIT for version', () => {
    expect(loadConfig({ SOURCE_COMMIT: 'abc123' }).version).toBe('abc123');
  });

  it.each(['abc', '0', '70000', '3000.5'])('rejects invalid PORT %s', (port) => {
    expect(() => loadConfig({ PORT: port })).toThrow(`Invalid PORT: ${port}`);
  });
});
```

`apps/api/test/logger.test.ts`:
```ts
import { expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { loggerOptions } from '../src/logger';

it('redacts secrets from logs', async () => {
  const lines: string[] = [];
  const app = await buildApp({
    version: 't',
    logger: loggerOptions('info', { write: (l) => { lines.push(l); } }),
  });
  app.log.info(
    { headers: { authorization: 'Bearer s3cr3t', cookie: 'sid=s3cr3t' }, password: 's3cr3t' },
    'probe',
  );
  const out = lines.join('');
  expect(out).toContain('probe');
  expect(out).not.toContain('s3cr3t');
  expect(out).toContain('[redacted]');
  await app.close();
});
```

`apps/api/test/health.test.ts`:
```ts
import { expect, it } from 'vitest';
import { buildApp } from '../src/app';

it('GET /api/health returns ok and version', async () => {
  const app = await buildApp({ version: 'test-1' });
  const res = await app.inject({ method: 'GET', url: '/api/health' });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ status: 'ok', version: 'test-1' });
  await app.close();
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm --filter @midora/api test`
Expected: FAIL — módulos `../src/config`, `../src/app`, `../src/logger` não encontrados.

- [ ] **Step 4: Implementação**

`apps/api/src/config.ts`:
```ts
export interface Config {
  port: number;
  host: string;
  webDir?: string;
  playerDir?: string;
  version: string;
  logLevel: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const rawPort = env.PORT ?? '3000';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${rawPort}`);
  }
  return {
    port,
    host: env.HOST ?? '0.0.0.0',
    webDir: env.WEB_DIR || undefined,
    playerDir: env.PLAYER_DIR || undefined,
    version: env.APP_VERSION ?? env.SOURCE_COMMIT ?? 'dev',
    logLevel: env.LOG_LEVEL ?? 'info',
  };
}
```

`apps/api/src/logger.ts`:
```ts
const REDACT_PATHS = [
  'headers.authorization',
  'headers.cookie',
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'password',
  '*.password',
];

export function loggerOptions(level: string, stream?: { write(msg: string): void }) {
  return {
    level,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    ...(stream ? { stream } : {}),
  };
}
```

`apps/api/src/health.ts`:
```ts
import type { FastifyPluginAsync } from 'fastify';
import type { HealthResponse } from '@midora/shared';

export const healthRoutes: FastifyPluginAsync<{ version: string }> = async (app, { version }) => {
  app.get('/api/health', async (): Promise<HealthResponse> => ({ status: 'ok', version }));
};
```

`apps/api/src/app.ts`:
```ts
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { healthRoutes } from './health';

export interface AppOptions {
  version: string;
  logger?: FastifyServerOptions['logger'];
  webDir?: string;
  playerDir?: string;
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });
  await app.register(healthRoutes, { version: opts.version });
  return app;
}
```

`apps/api/src/server.ts`:
```ts
import { buildApp } from './app';
import { loadConfig } from './config';
import { loggerOptions } from './logger';

const config = loadConfig();
const app = await buildApp({
  version: config.version,
  logger: loggerOptions(config.logLevel),
  webDir: config.webDir,
  playerDir: config.playerDir,
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, async () => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    process.exit(0);
  });
}

await app.listen({ port: config.port, host: config.host });
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @midora/api test && pnpm --filter @midora/api typecheck`
Expected: todos os testes PASS (config: 7, logger: 1, health: 1); typecheck sem erros.

- [ ] **Step 6: Build e smoke test local**

```bash
pnpm --filter @midora/api build
PORT=3999 node apps/api/dist/server.js &
sleep 1; curl -s http://127.0.0.1:3999/api/health; kill %1
PORT=abc node apps/api/dist/server.js; echo "exit=$?"
```
Expected: `{"status":"ok","version":"dev"}`; a segunda execução imprime `Invalid PORT: abc` e `exit=1`.

- [ ] **Step 7: Commit**

```bash
git add apps/api pnpm-lock.yaml
git commit -m "feat(api): add Fastify app with config, redacted logging and health route

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: API — arquivos estáticos e fallback SPA

**Files:**
- Create: `apps/api/src/static.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/static.test.ts`

**Interfaces:**
- Consumes: `AppOptions.webDir`, `AppOptions.playerDir`, `buildApp` (Task 2).
- Produces: `registerStatic(app: FastifyInstance, dirs: { webDir?: string; playerDir?: string }): Promise<void>`; contrato HTTP: `/api/*` desconhecido → 404 `{ "error": "not_found" }`; `/player/*` desconhecido → `index.html` do player; demais GET → `index.html` do web.

- [ ] **Step 1: Teste que falha**

`apps/api/test/static.test.ts`:
```ts
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @midora/api test -- static`
Expected: FAIL — `/` retorna 404 padrão do Fastify; `/api/nao-existe` não retorna `{ error: 'not_found' }`.

- [ ] **Step 3: Implementação**

`apps/api/src/static.ts`:
```ts
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

export async function registerStatic(
  app: FastifyInstance,
  { webDir, playerDir }: { webDir?: string; playerDir?: string },
): Promise<void> {
  // Only the first registration may decorate reply.sendFile.
  let decorated = false;
  for (const [root, prefix] of [[playerDir, '/player/'], [webDir, '/']] as const) {
    if (!root) continue;
    await app.register(fastifyStatic, { root, prefix, decorateReply: !decorated, redirect: true });
    decorated = true;
  }

  app.setNotFoundHandler((req, reply) => {
    const path = req.url.split('?')[0] ?? '';
    const isApi = path === '/api' || path.startsWith('/api/');
    if (req.method !== 'GET' || isApi) {
      return reply.code(404).send({ error: 'not_found' });
    }
    if (playerDir && path.startsWith('/player')) {
      return reply.type('text/html').sendFile('index.html', playerDir);
    }
    if (webDir) {
      return reply.type('text/html').sendFile('index.html', webDir);
    }
    return reply.code(404).send({ error: 'not_found' });
  });
}
```

`apps/api/src/app.ts` — adicionar o import e o registro após `healthRoutes`:
```ts
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { healthRoutes } from './health';
import { registerStatic } from './static';

export interface AppOptions {
  version: string;
  logger?: FastifyServerOptions['logger'];
  webDir?: string;
  playerDir?: string;
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });
  await app.register(healthRoutes, { version: opts.version });
  await registerStatic(app, { webDir: opts.webDir, playerDir: opts.playerDir });
  return app;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @midora/api test && pnpm --filter @midora/api typecheck`
Expected: todos PASS (8 novos em static + anteriores).

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): serve web and player builds with SPA fallback and JSON 404 for API

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Apps web e player (esqueleto)

**Files:**
- Create: `apps/web/{package.json,tsconfig.json,vite.config.ts,index.html}`, `apps/web/src/{main.tsx,App.tsx,App.test.tsx}`
- Create: `apps/player/{package.json,tsconfig.json,vite.config.ts,index.html}`, `apps/player/src/{main.tsx,App.tsx,App.test.tsx}`

**Interfaces:**
- Produces: `apps/web/dist/index.html` e `apps/player/dist/index.html` (player com `base: '/player/'`), consumidos pelo Dockerfile (Task 5) via `WEB_DIR`/`PLAYER_DIR`. Componentes `App` (web) e `App` (player, tela de espera) que as Etapas 2 e 3 expandem.

- [ ] **Step 1: Arquivos do web**

`apps/web/package.json`:
```json
{
  "name": "@midora/web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

`apps/web/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": ["vite/client"]
  },
  "include": ["src", "vite.config.ts"]
}
```

`apps/web/vite.config.ts`:
```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:3000' } },
  test: { environment: 'jsdom' },
});
```

`apps/web/index.html`:
```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Midora</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`apps/web/src/main.tsx`:
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`apps/web/src/App.tsx`:
```tsx
export function App() {
  return (
    <main>
      <h1>Midora</h1>
      <p>SMART MEDIA NETWORK</p>
      <p>Sua mídia. Múltiplas possibilidades.</p>
    </main>
  );
}
```

`apps/web/src/App.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { App } from './App';

it('renders brand and slogan', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: 'Midora' })).toBeTruthy();
  expect(screen.getByText('Sua mídia. Múltiplas possibilidades.')).toBeTruthy();
});
```

```bash
pnpm --filter @midora/web add react react-dom
pnpm --filter @midora/web add -D vite @vitejs/plugin-react typescript vitest jsdom @testing-library/react @types/react @types/react-dom
```

- [ ] **Step 2: Arquivos do player**

`apps/player/package.json`: igual ao do web com `"name": "@midora/player"`:
```json
{
  "name": "@midora/player",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

`apps/player/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": ["vite/client"]
  },
  "include": ["src", "vite.config.ts"]
}
```

`apps/player/vite.config.ts`:
```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/player/',
  plugins: [react()],
  server: { port: 5174, proxy: { '/api': 'http://localhost:3000' } },
  test: { environment: 'jsdom' },
});
```

`apps/player/index.html`:
```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Midora Player</title>
    <style>html, body, #root { margin: 0; height: 100%; background: #000; color: #fff; }</style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`apps/player/src/main.tsx`:
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`apps/player/src/App.tsx`:
```tsx
export function App() {
  return (
    <main
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <h1>Midora</h1>
      <p>Aguardando campanhas…</p>
    </main>
  );
}
```

`apps/player/src/App.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { App } from './App';

it('renders the waiting screen', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: 'Midora' })).toBeTruthy();
  expect(screen.getByText('Aguardando campanhas…')).toBeTruthy();
});
```

```bash
pnpm --filter @midora/player add react react-dom
pnpm --filter @midora/player add -D vite @vitejs/plugin-react typescript vitest jsdom @testing-library/react @types/react @types/react-dom
```

- [ ] **Step 3: Verificar tudo**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: código 0; existem `apps/web/dist/index.html`, `apps/player/dist/index.html` (com assets referenciados como `/player/assets/...`) e `apps/api/dist/server.js`.

- [ ] **Step 4: Smoke test integrado**

```bash
WEB_DIR=$PWD/apps/web/dist PLAYER_DIR=$PWD/apps/player/dist PORT=3999 node apps/api/dist/server.js &
sleep 1
curl -s http://127.0.0.1:3999/ | grep -o '<title>Midora</title>'
curl -s http://127.0.0.1:3999/player/ | grep -o '<title>Midora Player</title>'
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3999/api/nao-existe
kill %1
```
Expected: `<title>Midora</title>`, `<title>Midora Player</title>`, `404`.

- [ ] **Step 5: Commit**

```bash
git add apps/web apps/player pnpm-lock.yaml
git commit -m "feat: add web and player app skeletons

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Dockerfile e CI

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: scripts `lint`, `typecheck`, `test`, `build` (Tasks 1–4); saídas `apps/api/dist`, `apps/web/dist`, `apps/player/dist`.
- Produces: imagem que escuta 3000, `CMD node dist/server.js`, `WEB_DIR=/app/web`, `PLAYER_DIR=/app/player`, `HEALTHCHECK` em `/api/health`. Workflow `CI` com jobs `check` e `docker`.

- [ ] **Step 1: Dockerfile**

`Dockerfile`:
```dockerfile
FROM node:24-alpine AS build
WORKDIR /app
RUN npm install -g pnpm@10.27.0
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm build \
 && pnpm --filter @midora/api deploy --prod --legacy /out

FROM node:24-alpine
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    WEB_DIR=/app/web \
    PLAYER_DIR=/app/player
WORKDIR /app
COPY --from=build /out/package.json ./package.json
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/web/dist ./web
COPY --from=build /app/apps/player/dist ./player
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "dist/server.js"]
```

`.dockerignore`:
```
**/node_modules
**/dist
.git
.github
docs
**/.DS_Store
```

- [ ] **Step 2: Workflow de CI**

`.github/workflows/ci.yml`:
```yaml
name: CI

on:
  push:
    branches: ['**']
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build

  docker:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build image
        run: docker build -t midora:ci .
      - name: Smoke test
        run: |
          docker run -d --name midora -p 3000:3000 midora:ci
          for i in $(seq 1 20); do
            curl -sf http://127.0.0.1:3000/api/health && break
            sleep 1
          done
          curl -sf http://127.0.0.1:3000/api/health | grep '"status":"ok"'
          curl -sf http://127.0.0.1:3000/player/ | grep 'Midora Player'
          test "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/nao-existe)" = 404
```

- [ ] **Step 3: Commit e push da branch**

```bash
git add Dockerfile .dockerignore .github
git commit -m "ci: add Dockerfile and GitHub Actions checks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin feat/etapa-0-fundacao
```

- [ ] **Step 4: Verificar CI**

Run: `git ls-remote origin feat/etapa-0-fundacao` e conferir o resultado do workflow em `https://github.com/deimac/midora/actions` (o `gh` não está autenticado; o usuário confirma ou a página é lida no navegador).
Expected: jobs `check` e `docker` verdes. Se `docker` falhar, corrigir o Dockerfile e repetir antes de seguir.

---

### Task 6: Implantação isolada no Coolify e DEPLOY.md

**Files:**
- Create: `docs/DEPLOY.md`

**Interfaces:**
- Consumes: imagem da Task 5 via Dockerfile na `main`.
- Produces: aplicação `midora` no projeto Coolify `midora`, domínio provisório; `docs/DEPLOY.md` como referência operacional para as próximas etapas.

O MCP do Coolify não cria recursos; a criação é feita pelo usuário na interface. O agente verifica pelo MCP.

- [ ] **Step 1: Merge na main (somente após aprovação do usuário)**

Pedir aprovação explícita. Após o "sim":
```bash
git checkout main
git merge --ff-only feat/etapa-0-fundacao
git push origin main
```

- [ ] **Step 2: Passo a passo para o usuário (enviar no chat)**

1. GitHub → Settings → Applications → `coolify-xplore` → Configure → Repository access → adicionar `deimac/midora`.
2. Coolify → Projects → **+ Add** → nome `midora` → ambiente `production`.
3. Em `production` → **+ New** → **Private Repository (with GitHub App)** → `coolify-xplore` → `deimac/midora` → branch `main`.
4. Build Pack: **Dockerfile**; Ports Exposes: `3000`.
5. Domains: manter o domínio `*.sslip.io` gerado pelo Coolify.
6. Health Check: habilitar, path `/api/health`, porta `3000`.
7. Advanced → Resource Limits → Maximum Memory Limit: `1g`.
8. Salvar e clicar **Deploy**. Não alterar nada fora do projeto `midora`.

- [ ] **Step 3: Verificar pelo MCP e HTTP**

- `search_resources` com `midora` → obter UUID da aplicação.
- `list_deployments` / `get_deployment(include_log_summary=true)` → status `finished`.
- `curl -s https://<dominio-sslip>/api/health` → `{"status":"ok","version":"..."}`.
- `curl -s https://<dominio-sslip>/player/` → contém `Midora Player`.
- `get_infrastructure_overview` → `health_hints` todos 0 (nenhum outro sistema afetado).

Expected: tudo acima confirmado. Em falha, usar `get_deployment` com resumo de log e corrigir; não alterar recursos de outros projetos.

- [ ] **Step 4: Escrever `docs/DEPLOY.md`** (preencher `<dominio-sslip>` e UUIDs reais obtidos no Step 3)

````markdown
# Midora — Implantação

## Onde roda

- VPS Hostinger com Coolify 4.4.6, projeto **midora**, ambiente **production**.
- Aplicação `midora`: Dockerfile da raiz, branch `main`, porta 3000, limite 1 GB.
- Domínio provisório: `<dominio-sslip>` (definitivo será configurado antes do piloto).
- Isolamento: nenhum recurso compartilhado com outros projetos do Coolify.

## Publicar

Push/merge na `main` dispara build e deploy automáticos. O CI (`.github/workflows/ci.yml`) deve estar verde antes do merge.

## Variáveis de ambiente

| Variável | Valor | Observação |
|---|---|---|
| `PORT` | 3000 | definido na imagem |
| `WEB_DIR` / `PLAYER_DIR` | `/app/web` / `/app/player` | definidos na imagem |
| `LOG_LEVEL` | `info` | opcional |
| `APP_VERSION` | — | opcional; senão usa `SOURCE_COMMIT` ou `dev` |

Segredos (a partir da Etapa 1: `DATABASE_URL`, `SESSION_SECRET`) existem somente no Coolify.

## Verificar

- `GET /api/health` → `{"status":"ok","version":"..."}`.
- Logs: Coolify → midora → Logs (JSON, segredos redigidos).

## Reverter

Coolify → midora → Deployments → escolher o deploy anterior → **Redeploy**; ou `git revert` na `main`.

## Backups e recuperação

Etapa 0 não tem dados. Banco (Etapa 1) e mídia (Etapa 2) terão backup diário; procedimento de restauração será adicionado aqui e testado antes do piloto.
````

- [ ] **Step 5: Commit (na main, após aprovação do usuário)**

```bash
git add docs/DEPLOY.md
git commit -m "docs: add deployment guide

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin main
```
Expected: novo deploy no Coolify termina `finished`; `/api/health` continua 200.

---

## Critério de aceite da Etapa 0

- `pnpm lint && pnpm typecheck && pnpm test && pnpm build` verdes localmente e no CI (jobs `check` e `docker`).
- Coolify: aplicação `midora` em projeto próprio, saudável no domínio `*.sslip.io`; `/api/health` 200; `/player/` serve o player; `/api/nao-existe` 404 JSON.
- `get_infrastructure_overview` sem recursos não saudáveis; nenhum outro projeto alterado.
- `docs/DEPLOY.md` na `main`.
