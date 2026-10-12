# MIDORA — Design do MVP

**Data:** 2026-10-11
**Status:** aprovado em conversa; aguardando revisão do documento.
**Base:** `docs/ESPECIFICACAO_MVP_MIDORA.md` (v0.1). Em caso de divergência, a especificação prevalece sobre o prompt inicial (decisão 2026-10-11).

## 1. Objetivo e critério de sucesso

Plataforma web para exibir anúncios (imagens e vídeos) em TVs de estabelecimentos parceiros pelo navegador e contabilizar **inserções concluídas por campanha** de forma confiável, inclusive offline. Piloto: Ironberg, Fire TV. Sucesso = os 15 critérios de aceite da seção 14 da especificação.

## 2. Decisões tomadas

| # | Decisão |
|---|---|
| D1 | Escopo da especificação: imagens e vídeos, aprovação pelo parceiro, autocadastro de anunciante, rotação ponderada sem programação/agendamento. |
| D2 | Mídia em volume persistente da VPS, acessada por uma interface de storage substituível por S3. |
| D3 | Player autentica com conta `player` dedicada por parceiro, somente leitura, sessão longa; trocar a senha desconecta as TVs. |
| D4 | Domínio definido depois; Etapa 0 usa domínio provisório `*.sslip.io` do Coolify. |
| D5 | Anúncios institucionais Midora exibidos apenas em parceiros com `show_institutional = true` (definido pelo admin). |
| D6 | Repositório GitHub `deimac/midora`, branch `main`. |
| D7 | Três áreas: super admin (controle do sistema), parceiro (configura e aprova anúncios) e anunciante. |
| D8 | Dois tipos de plano: **Planos Midora** (o Midora vende ao parceiro) e **Planos de anúncio** (o parceiro vende ao anunciante). No MVP, Planos Midora são só cadastro (nome, descrição, valor de referência) e vínculo com o parceiro — sem cobrança e sem limites aplicados. |
| D9 | Página pública `/p/<slug>` simples (planos de anúncio + autocadastro) no MVP; a landing page completa do parceiro substitui essa página depois, no mesmo endereço. |
| D10 | Painel com tema claro (grafite + esmeralda) e noturno (noite + esmeralda), botão lua/sol; sem azul. |

## 3. Arquitetura

Monorepo (pnpm workspaces), monólito modular, um contêiner:

```
midora/
  apps/api/        Fastify + TS + Drizzle; módulos auth, partners, advertisers,
                   campaigns, media, player, plays (rotas/serviço/queries por módulo)
  apps/web/        React + Vite: admin, parceiro, anunciante, página pública /p/<slug>
  apps/player/     player web da TV: Service Worker (cache de mídia) + IndexedDB (eventos)
  packages/shared/ schemas zod e tipos compartilhados
  docs/
  Dockerfile  .github/workflows/ci.yml
```

- O Fastify serve `/api`, `/player` e `/` (build estático do web).
- PostgreSQL 16 dedicado, sem porta pública.
- Storage: interface `put/get/delete/stream` com implementação em disco (`/data/media`); entrega com suporte a HTTP Range e ETag.
- O player pode usar React ou TS puro; a escolha é feita na Etapa 3 conforme desempenho na Fire TV.

## 4. Autenticação e isolamento

- Sessão por cookie `httpOnly`, `Secure`, `SameSite=Lax`, armazenada em `sessions` (Postgres). Senhas com Argon2.
- Papéis: `admin`, `partner_user`, `advertiser`, `player`.
- Todo acesso a dados de parceiro é filtrado por `partner_id` da sessão no servidor. Anunciante acessa apenas o próprio `advertiser_id`.
- `player` acessa somente `GET /api/player/manifest` e `POST /api/plays`.
- Teste automatizado de isolamento: parceiro A não lê nem altera dados do parceiro B.
- O player tem ação "sair/trocar conta" documentada para TVs compartilhadas.

## 5. Modelo de dados

Todas as tabelas: `id` UUID, `created_at`, `updated_at`.

| Tabela | Campos essenciais |
|---|---|
| `partners` | `name`, `slug` (único), `status`, `weight_low` (1), `weight_medium` (2), `weight_high` (3), `default_image_seconds`, `show_institutional` (bool, padrão false) |
| `users` | `email` (único), `password_hash`, `role`, `partner_id` (nulo p/ admin), `advertiser_id` (só p/ advertiser) |
| `sessions` | `user_id`, `expires_at` |
| `advertisers` | `partner_id`, `name`, `contact_name`, `email`, `phone`, `source` (`manual` \| `self_signup`) |
| `plans` | `partner_id`, `name`, `description`, `frequency_level` (`low`\|`medium`\|`high`), `active`. Sem preço ou quota. |
| `campaigns` | `partner_id` (nulo se institucional), `advertiser_id` (nulo se institucional), `plan_id` (nulo se institucional), `kind` (`commercial`\|`institutional`), `name`, `starts_at`, `ends_at`, `status`, `frequency_level`, `current_media_id` |
| `media` | `partner_id` (nulo se institucional), `campaign_id`, `storage_key`, `media_type` (`image`\|`video`), `mime`, `size_bytes`, `duration_ms`, `sha256`, `display_seconds` (imagem) |
| `campaign_reviews` | `campaign_id`, `action` (`submitted`\|`approved`\|`changes_requested`\|`cancelled`), `reason`, `actor_user_id`, `created_at` |
| `plays` | `id` UUIDv7 gerado pelo player (PK), `campaign_id`, `partner_id`, `media_id`, `media_type`, `played_at` (horário do player), `received_at`. Índice `(campaign_id, played_at)`. |

`frequency_level` da campanha é copiado do plano na criação (comercial) ou escolhido pelo admin (institucional).

## 6. Ciclo de vida da campanha

Status persistidos: `draft`, `pending_review`, `changes_requested`, `approved`, `cancelled`.
Status derivados na leitura: `approved` + `now < starts_at` → aguardando; `approved` + dentro do período → `active`; `approved` + `now > ends_at` → `ended`. Não há job agendado.

Fluxo: `draft` → enviar → `pending_review` → parceiro aprova (`approved`) ou solicita correção com motivo obrigatório (`changes_requested`) → anunciante substitui material e reenvia → `pending_review`. Cada transição grava `campaign_reviews`. Substituir material cria nova linha em `media`; a anterior é preservada.

Institucionais são criadas pelo admin já como `approved`, sem revisão de parceiro.

## 7. Uploads

- Imagens: JPEG, PNG, WebP. Vídeos: MP4 (H.264/AAC).
- Tipo verificado pelo conteúdo (magic bytes), não pela extensão.
- Limites de tamanho por variável de ambiente.
- Sem transcodificação no MVP. Duração do vídeo e verificação de codec: abordagem definida no plano (ex.: leitura de metadados MP4).

## 8. Player

**Manifesto** — `GET /api/player/manifest`, consultado a cada 5 min com conexão. Retorna campanhas elegíveis do parceiro da sessão (aprovadas, no período, com mídia válida) + institucionais se `show_institutional`; por mídia: URL, `sha256`, tipo, `display_seconds`, `frequency_level`; pesos do parceiro; versão.

**Cache** — Service Worker baixa mídia nova e valida `sha256`; só mídia completa entra na rotação; mídia fora do manifesto é removida. Falha de manifesto ou download mantém o último manifesto e o cache válidos. Solicita `navigator.storage.persist()`.

**Rotação** — sorteio ponderado pelos pesos do parceiro entre campanhas elegíveis e em cache; evita repetir a mesma campanha consecutivamente quando há mais de uma. Função pura com teste estatístico de proporção.

**Contagem** — vídeo: evento `ended`; imagem: fim do `display_seconds`. Erro, travamento ou recarga não contam; em erro, segue para o próximo item. Cada inserção grava `{id UUIDv7, campaign_id, media_id, media_type, played_at}` no IndexedDB.

**Sincronização** — a cada 30 s e ao reconectar, envia lotes de até 200 eventos a `POST /api/plays`. O servidor valida que cada campanha pertence ao parceiro da sessão (ou é institucional permitida), insere com `ON CONFLICT (id) DO NOTHING` e responde com os IDs aceitos (novos ou já existentes). O player remove do IndexedDB apenas os confirmados.

**Estados especiais** — sem campanhas elegíveis: tela de espera com marca Midora, nova tentativa periódica, nunca tela preta. Resposta 401: tela de login, eventos pendentes preservados. Mídia corrompida: removida do cache e baixada novamente.

**Áudio e transições** — inicia mudo (política de autoplay) com opção de ativar som na primeira interação; validar na Fire TV. Transição apenas fade simples; corte seco se o fade não for confiável.

## 9. Painéis

| Área | Funções |
|---|---|
| Admin | parceiros (incl. pesos e `show_institutional`), usuários de parceiro, campanhas institucionais, relatório geral |
| Parceiro | anunciantes (cadastro manual), planos, campanhas e fila de aprovação, senha da conta player, relatório |
| Anunciante | campanhas próprias, envio/substituição de material, status, contagem de inserções |
| Página pública `/p/<slug>` | planos do parceiro e formulário de autocadastro de anunciante |

**Relatório** — inserções por campanha (total e por dia), filtro por período, exportação CSV, escopo conforme papel. Agregação direta em `plays`.

## 10. Implantação (Coolify)

- Projeto Coolify **Midora** dedicado, ambiente `production`; nenhum recurso compartilhado com sistemas existentes.
- Application: Dockerfile, origem `main` do GitHub, limite 1 GB RAM, volume `/data/media`, healthcheck `/api/health`, domínio `*.sslip.io` provisório.
- Postgres 16 dedicado, sem porta pública, limite 512 MB.
- Migrações Drizzle executadas no start; somente migrações aditivas automáticas; destrutivas exigem autorização.
- Segredos (`DATABASE_URL`, `SESSION_SECRET` etc.) somente nas variáveis do Coolify.
- Criação de recursos no Coolify somente com autorização, via MCP (se o túnel estiver ativo) ou passo a passo manual.

## 11. Operação

- **Logs:** JSON (pino) no stdout, lidos pelo Coolify; redação de senhas, cookies e tokens.
- **Backup:** backup diário do Postgres pelo Coolify; cópia diária de `/data/media`. Destino externo à VPS: decisão pendente.
- **Recuperação:** procedimento em `docs/DEPLOY.md`, testado uma vez antes do piloto. Com o servidor fora, as TVs continuam com o cache e acumulam eventos.

## 12. Fluxo Git e CI

- Branches `feat/etapa-N-<assunto>` e `fix/<assunto>`; Conventional Commits.
- Merge na `main` após testes e aprovação; push na `main` dispara deploy no Coolify.
- GitHub Actions: lint, typecheck, testes (Vitest; integração com Postgres de serviço).

## 13. Etapas

| Etapa | Entrega | Aceite |
|---|---|---|
| 0 | Monorepo, CI, Dockerfile, `/api/health`, deploy isolado no Coolify | app saudável no domínio provisório, sem impacto nos demais serviços |
| 1 | Schema, auth, papéis, partners/users | teste de isolamento entre parceiros passa |
| 2 | Anunciantes (manual + autocadastro), planos, upload, campanhas e aprovação | campanha não aprovada nunca entra no manifesto |
| 3 | Player: login, manifesto, rotação 1:2:3, falhas, tela de espera; **teste rápido na Fire TV** | TV autenticada exibe anúncios do parceiro correto |
| 4 | Inserções idempotentes e relatório | interrupção não conta; reenvio não duplica |
| 5 | Cache offline e fila de eventos | sem internet continua tocando; sincroniza sem duplicar |
| 6 | Validação completa no equipamento do piloto | fluxos prioritários OK na Fire TV |
| 7 | PoC YouTube separada | relatório de viabilidade, sem alterar o player |

## 14. Pendências

- Domínio definitivo (antes do piloto).
- Modelo e navegador da Fire TV do piloto (antes da Etapa 3).
- Destino externo dos backups (antes do piloto).
- Restabelecer o túnel do Coolify MCP (antes da Etapa 0) ou executar o deploy manualmente.
- Itens da seção 15 da especificação permanecem fora do escopo.

## 15. Riscos

- Compatibilidade do navegador da Fire TV (autoplay, Service Worker, quota de armazenamento, codecs) — mitigado pelo teste antecipado na Etapa 3.
- Mídia e banco compartilham o disco da VPS (70 GB livres) — monitorar uso; migração para S3 prevista pela interface de storage.
- Horário do player pode estar incorreto — `received_at` é registrado no servidor para referência.
