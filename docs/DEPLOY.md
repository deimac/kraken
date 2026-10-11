# Midora — Implantação

## Onde roda

- VPS Hostinger com Coolify 4.4.6, projeto **midora** (`mtn26c9lrj2iktvf1pz13dk4`), ambiente **production**.
- Aplicação `midora` (`dincx9erqdqpi0tqapejhgqs`): repositório `deimac/midora`, branch `main`, via GitHub App `coolify-xplore`.
- Domínio provisório: `http://dincx9erqdqpi0tqapejhgqs.31.97.249.115.sslip.io` (sem HTTPS). O domínio definitivo, com HTTPS, deve ser configurado antes do piloto — Service Worker e cache offline do player exigem HTTPS.
- Isolamento: nenhum recurso compartilhado com outros projetos do Coolify.

## Configuração da aplicação no Coolify

| Campo | Valor |
|---|---|
| Build Pack | **Dockerfile** (não usar a detecção automática/Railpack) |
| Base Directory | `/` |
| Ports Exposes | `3000` |
| Resource Limits → Maximum Memory Limit | `1g` (formato Docker; `1` sozinho significa 1 byte) |
| Healthcheck → Check Type | HTTP request |
| Healthcheck → Scheme / Host / Port / Path | `http` / **`127.0.0.1`** / `3000` / `/api/health` |
| Healthcheck → Return Code | `200` |

O Host do healthcheck deve ser `127.0.0.1`, não `localhost`: dentro do contêiner, `localhost` resolve primeiro para IPv6 (`::1`) e o `wget` do Alpine não tenta o IPv4.

## Publicar

Merge/push na `main` dispara build e deploy automáticos. O CI (`.github/workflows/ci.yml`: lint, typecheck, testes, build e smoke test da imagem) deve estar verde antes do merge.

## Variáveis de ambiente

| Variável | Valor | Observação |
|---|---|---|
| `PORT` | 3000 | definido na imagem |
| `HOST` | `0.0.0.0` | definido na imagem |
| `WEB_DIR` / `PLAYER_DIR` | `/app/web` / `/app/player` | definidos na imagem |
| `LOG_LEVEL` | `info` | opcional |
| `APP_VERSION` | — | opcional; senão usa `SOURCE_COMMIT` (injetado pelo Coolify) ou `dev` |

Segredos (a partir da Etapa 1: `DATABASE_URL`, `SESSION_SECRET`) existem somente no Coolify, nunca no repositório.

## Verificar

- `GET /api/health` → `{"status":"ok","version":"<commit>"}`.
- `GET /player/` → página "Midora Player".
- Logs: Coolify → midora → Logs (JSON, segredos redigidos).

## Reverter

Coolify → midora → Deployments → escolher o deploy anterior → **Redeploy**; ou `git revert` na `main`.

## Backups e recuperação

Etapa 0 não tem dados. Banco (Etapa 1) e mídia (Etapa 2) terão backup diário; o procedimento de restauração será adicionado aqui e testado antes do piloto.
