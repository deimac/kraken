# Kraken Ads

**SMART MEDIA NETWORK** — Sua mídia. Múltiplas possibilidades.

Plataforma para exibir anúncios em TVs de estabelecimentos parceiros e contabilizar inserções por campanha.

## Estrutura

- `apps/api` — API Fastify; em produção também serve `apps/web` (`/`) e `apps/player` (`/player/`).
- `apps/web` — painel (admin, parceiro, anunciante) e páginas públicas.
- `apps/player` — player web das TVs.
- `packages/shared` — tipos e schemas compartilhados.
- `docs/` — especificação, planos e implantação (`docs/DEPLOY.md`).

## Desenvolvimento

Requisitos: Node 24+, pnpm 10. Os testes usam PGlite (Postgres embutido) e não precisam de banco.

```bash
pnpm install
pnpm test
```

Para rodar a API localmente é preciso um Postgres (ex.: `brew services start postgresql@18` e `createdb kraken`):

```bash
DATABASE_URL=postgres://localhost/kraken ADMIN_EMAIL=admin@local.test ADMIN_PASSWORD=<12+ caracteres> pnpm dev:api
pnpm dev:web      # painel, com proxy de /api para a API
pnpm dev:player   # player, com proxy de /api para a API
```

Demonstração local sem banco: `pnpm build && pnpm --filter @kraken/api demo` → http://localhost:3100 (usuários `admin@demo.test`, `parceiro@demo.test`, `anunciante@demo.test`; senha em `apps/api/scripts/demo.ts`).

Migrações: alterar `apps/api/src/db/schema.ts` e rodar `pnpm --filter @kraken/api db:generate`. Elas são aplicadas no start da API.

Verificações: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
