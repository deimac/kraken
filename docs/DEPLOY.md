# Kraken Ads — Implantação

## Onde roda

- VPS Hostinger com Coolify 4.4.6, projeto **kraken** (`mtn26c9lrj2iktvf1pz13dk4`), ambiente **production**.
- Aplicação `kraken` (`dincx9erqdqpi0tqapejhgqs`): repositório `deimac/kraken`, branch `main`, via GitHub App `coolify-xplore`.
- Domínio provisório: `http://kraken.31.97.249.115.sslip.io` (sem HTTPS; o sslip.io exige o IP no nome, `kraken.sslip.io` não resolve). O domínio definitivo, com HTTPS, deve ser configurado antes do piloto — Service Worker e cache offline do player exigem HTTPS.
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

- Postgres 18 `kraken-db` (`7lymsttm2meffka7lits7sqs`) no projeto `kraken`, sem acesso público, limite 512 MB.
- Migrações (`apps/api/drizzle/`) são aplicadas automaticamente no start da aplicação.
- `0006_advertisers_details` só adiciona colunas (tipo de pessoa, CPF/CNPJ, endereço, arquivamento) e um índice único de documento por parceiro; anunciantes antigos ficam sem documento até serem editados.
- `0007_plans_limits` só adiciona colunas aos planos (vídeos, imagens, duração máxima, preço, período); planos existentes recebem 1 vídeo, 1 imagem, 30 s, preço 0 ("Sob consulta") e período mensal.
- `0008_subscriptions` + `0009_drop_current_media` transformam campanhas em assinaturas com peças: `approved` → `active`; rascunho/aguardando/correção → `paused`; a mídia atual de cada campanha vira peça aprovada e as anteriores ficam como removidas (histórico); depois remove a coluna `campaigns.current_media_id`. **Conferir o backup do dia do `kraken-db` antes do deploy.** Reverter para um deploy anterior a essa migração não funciona (o código antigo usa a coluna removida): corrigir para frente.
- `0010_tv_last_seen` adiciona `partners.tv_last_seen_at` (atualizado quando a TV busca a lista de anúncios, no máximo 1×/min); a tela Início mostra TV online (contato há menos de 10 min) ou offline.

## Mídia

- Volume `kraken-media` montado em `/data/media` (Persistent Storage da aplicação). Contém os arquivos enviados (`<partnerId>/<mediaId>.<ext>`, `institutional/...`) e `tmp/` para uploads em andamento.
- Formatos aceitos: JPEG, PNG, WebP; MP4 com H.264 e áudio AAC (ou sem áudio).
- Proteção do disco (compartilhado com o Postgres): uploads são recusados (507 `storage_full`) se o espaço livre ficaria abaixo de `MIN_FREE_DISK_MB`; cada usuário pode enviar até `UPLOADS_PER_HOUR` arquivos por hora.
- Backup do volume: pendente (definir junto com o destino externo de backups antes do piloto).

## Variáveis de ambiente

| Variável | Valor | Observação |
|---|---|---|
| `PORT` / `HOST` | 3000 / `0.0.0.0` | definidos na imagem |
| `WEB_DIR` / `PLAYER_DIR` | `/app/web` / `/app/player` | definidos na imagem |
| `DATABASE_URL` | URL **interna** do `kraken-db` | segredo; só runtime (desmarcar "Build Variable") |
| `COOKIE_SECURE` | `false` | cookies são `Secure` por padrão; `false` só enquanto não houver HTTPS |
| `ADMIN_EMAIL` | e-mail do admin | usado só se o admin ainda não existir |
| `ADMIN_PASSWORD` | 12+ caracteres | cria o admin se ele não existir; nunca altera a senha de um admin existente; recomendado remover depois (fica em texto puro no Coolify); com `$`, marcar "Is Literal?" |
| `MEDIA_DIR` | `/data/media` | definido na imagem; deve coincidir com o volume |
| `MAX_IMAGE_MB` / `MAX_VIDEO_MB` | 10 / 200 | opcionais |
| `MIN_FREE_DISK_MB` | 2048 | opcional; reserva de disco livre |
| `UPLOADS_PER_HOUR` | 30 | opcional; por usuário |
| `LOG_LEVEL` | `info` | opcional |
| `APP_VERSION` | — | opcional; senão `SOURCE_COMMIT` (injetado pelo Coolify) ou `dev` |

Variáveis novas no Coolify vêm marcadas como "Build Variable"; desmarque nas que contêm segredos.

## Player

- Endereço na TV: `/player/`; a TV entra com o **código de acesso** gerado pelo parceiro em **Conta da TV** (link `/player/#CÓDIGO`, sem usuário nem senha; só o hash do código fica no banco, migração `0011_tv_code`). O código vale 24 h (`0012_tv_code_expiry`); gerar um novo invalida o anterior, mas não desconecta as TVs já conectadas — para isso, **Desconectar todas as TVs**. O login `tv@<slug>` + senha continua na API, sem tela no momento.
- A TV busca a lista de anúncios a cada 5 minutos (`/api/player/manifest`) e renova a própria sessão automaticamente.
- Guia de teste no aparelho: `docs/FIRE-TV.md`.
- Inserções: a TV registra cada anúncio exibido até o fim e envia em lotes a cada 30 s (`POST /api/player/plays`); reenvios não duplicam. Eventos pendentes ficam guardados no navegador da TV até serem aceitos.
- Relatórios em **Relatórios** no painel (admin, parceiro, anunciante), por campanha e por dia no horário de Brasília, com CSV.

## Verificar

- `GET /api/health` → `{"status":"ok","version":"<commit>"}`.
- `GET /player/` → página "Kraken Ads Player".
- Logs: Coolify → kraken → Logs (JSON, segredos redigidos).

## Reverter

Coolify → kraken → Deployments → escolher o deploy anterior → **Redeploy**; ou `git revert` na `main`.

Migrações não são desfeitas automaticamente: voltar para um deploy anterior a uma migração deixa o código antigo diante do banco novo. Em especial, deploys anteriores à `0005_kraken_plans` (renomeação Midora → Kraken Ads) consultam `midora_plans`/`midora_plan_id` e quebram as telas de parceiros e planos; nesse caso, corrigir para frente em vez de reverter.

## Backups e recuperação

- `kraken-db`: backup diário às 03:00 (Brasília, cron `0 6 * * *`), 7 cópias, armazenadas na VPS. Destino externo: pendente.
- Restaurar: Coolify → `kraken-db` → Backups → escolher o backup → **Restore**; depois Redeploy da aplicação.
- Mídia (Etapa 2): procedimento será adicionado.

## Problemas conhecidos

- Deploy falha com `ADMIN_PASSWORD must have at least 12 characters`: senha curta (ou `$` interpretado pelo Coolify). O Coolify mantém a versão anterior no ar.
- Deploy falha com `DATABASE_URL is required`: variável ausente ou com nome errado.
