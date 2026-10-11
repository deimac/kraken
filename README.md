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
