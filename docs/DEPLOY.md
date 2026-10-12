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

## Banco de dados

- Postgres 18 `midora-db` (`7lymsttm2meffka7lits7sqs`) no projeto `midora`, sem acesso público, limite 512 MB.
- Migrações (`apps/api/drizzle/`) são aplicadas automaticamente no start da aplicação.

## Variáveis de ambiente

| Variável | Valor | Observação |
|---|---|---|
| `PORT` / `HOST` | 3000 / `0.0.0.0` | definidos na imagem |
| `WEB_DIR` / `PLAYER_DIR` | `/app/web` / `/app/player` | definidos na imagem |
| `DATABASE_URL` | URL **interna** do `midora-db` | segredo; só runtime (desmarcar "Build Variable") |
| `COOKIE_SECURE` | `false` | cookies são `Secure` por padrão; `false` só enquanto não houver HTTPS |
| `ADMIN_EMAIL` | e-mail do admin | usado só se o admin ainda não existir |
| `ADMIN_PASSWORD` | 12+ caracteres | cria o admin se ele não existir; nunca altera a senha de um admin existente; recomendado remover depois (fica em texto puro no Coolify); com `$`, marcar "Is Literal?" |
| `LOG_LEVEL` | `info` | opcional |
| `APP_VERSION` | — | opcional; senão `SOURCE_COMMIT` (injetado pelo Coolify) ou `dev` |

Variáveis novas no Coolify vêm marcadas como "Build Variable"; desmarque nas que contêm segredos.

## Verificar

- `GET /api/health` → `{"status":"ok","version":"<commit>"}`.
- `GET /player/` → página "Midora Player".
- Logs: Coolify → midora → Logs (JSON, segredos redigidos).

## Reverter

Coolify → midora → Deployments → escolher o deploy anterior → **Redeploy**; ou `git revert` na `main`.

## Backups e recuperação

- `midora-db`: backup diário às 03:00 (Brasília, cron `0 6 * * *`), 7 cópias, armazenadas na VPS. Destino externo: pendente.
- Restaurar: Coolify → `midora-db` → Backups → escolher o backup → **Restore**; depois Redeploy da aplicação.
- Mídia (Etapa 2): procedimento será adicionado.

## Problemas conhecidos

- Deploy falha com `ADMIN_PASSWORD must have at least 12 characters`: senha curta (ou `$` interpretado pelo Coolify). O Coolify mantém a versão anterior no ar.
- Deploy falha com `DATABASE_URL is required`: variável ausente ou com nome errado.
