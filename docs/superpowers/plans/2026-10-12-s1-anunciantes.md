# S1 — Anunciantes completos — Implementation Plan

> Executar com superpowers:executing-plans (inline, TDD, ledger em `.superpowers/sdd/`).

**Goal:** cadastro de anunciantes completo (PF/PJ, CPF/CNPJ validado, endereço, WhatsApp, observações), com busca, edição, arquivamento e exclusão segura, e as telas correspondentes.
**Spec:** `docs/superpowers/specs/2026-10-12-assinaturas-design.md` (§2 A4, §3 advertisers, §4 arquivar/excluir, §5 anunciantes, §6 anunciantes).
**Tech:** Fastify 5 + Drizzle + zod 4 (API), React 19 + React Router 7 + @tabler/icons-react (web), Vitest + PGlite.

## Global Constraints
- Migração só adiciona colunas e índices: nenhum `DROP` e nenhuma perda de dados. Os anunciantes antigos ficam com `document` nulo.
- O documento é armazenado só com dígitos: CPF 11 / CNPJ 14, com dígito verificador válido e repetições (`11111111111`) recusadas. É único por parceiro quando não é nulo.
- `document` é obrigatório no `POST` manual e no autocadastro público. No `PATCH`, só é validado quando `document` ou `personType` mudam (o par resultante tem que ser válido).
- Erros: `400 invalid_document`, `409 document_taken`, `409 has_subscriptions`, `404 not_found`. As mensagens em PT vão em `apps/web/src/messages.ts`.
- Textos de tela em PT-BR; o tema esmeralda atual é mantido.

## Review Focus
1. Anunciante antigo, sem documento, editado só no telefone: o `PATCH` não pode exigir documento.
2. CNPJ com máscara (`12.345.678/0001-95`) é aceito e salvo só com dígitos; um CPF digitado com o tipo PJ dá `invalid_document`.
3. Arquivar um anunciante tira as campanhas dele da TV (`listEligible`) sem apagar nada; desarquivar devolve.
4. Excluir um anunciante com usuário de login, mas sem campanha, apaga também o usuário e as sessões dele; com campanha → 409, sem mudar nada.
5. Isolamento: o parceiro B não lê, arquiva nem exclui os anunciantes do A (404).

---

### Task 1: Validação de documento
- Create `apps/api/src/catalog/document.ts`: `onlyDigits(s)`, `isValidCpf(d)`, `isValidCnpj(d)`, `isValidDocument(personType: 'pf'|'pj', d)`.
- Test `apps/api/test/document.test.ts`:
  - CPF `52998224725` válido; `52998224724` e `11111111111` inválidos.
  - CNPJ `11222333000181` válido; `11222333000180` inválido.
  - PF com 14 dígitos inválido; PJ com 11 dígitos inválido.
- RED → GREEN → commit `feat(api): validate CPF/CNPJ`.

### Task 2: Schema, migração e API de anunciantes
- **Schema** (`apps/api/src/db/schema.ts`, `advertisers`):
  - Colunas: `personType` (`person_type` text not null default `'pj'`, check pf/pj), `document`, `legalName`, `whatsapp`, `notes`, `zip`, `street`, `number`, `complement`, `district`, `city`, `state`, `archivedAt` (timestamptz).
  - Índice único parcial `advertisers_partner_document_uq` em (`partner_id`, `document`) where `document is not null`.
- **Migração:** `pnpm --filter @kraken/api db:generate`, renomeada para `0006_advertisers_details.sql` (journal ajustado).
- **API** (`apps/api/src/catalog/routes.ts`):
  - `AdvertiserFields` com os campos novos. `document` passa por `onlyDigits`; `state` é uma UF de 2 letras maiúsculas; `zip` tem 8 dígitos.
  - `POST` exige `document` válido; `PATCH` valida o par resultante.
  - `GET /api/partner/advertisers?q=&archived=1`:
    - padrão só não arquivados; `archived=1` só arquivados;
    - `q` busca por `ilike` em name, legal_name e email, e pelos dígitos em document;
    - cada item vem com `activeCampaigns` (aprovadas e vigentes agora).
  - `GET /api/partner/advertisers/:id` → `{ advertiser, campaigns: [{id,name,status,effectiveStatus,startsAt,endsAt}], playsThisMonth }`. O mês é contado no horário de Brasília.
  - `POST /:id/archive` (`archivedAt = now`) e `POST /:id/unarchive`.
  - `DELETE /:id`:
    - 409 `has_subscriptions` se houver campanha;
    - se não houver, na mesma transação apaga os usuários advertiser dele (as sessões caem por cascade) e o anunciante; responde 204.
  - Unique violation no documento → 409 `document_taken`.
- **TV:** `apps/api/src/campaigns/eligibility.ts` faz left join em advertisers e exige `archived_at is null` nas comerciais.
- **Tests** em `apps/api/test/catalog.test.ts`:
  - criar com e sem documento, documento inválido, duplicado (409) e igual em outro parceiro (ok);
  - PATCH só do telefone em anunciante antigo;
  - busca por nome e por CNPJ com máscara;
  - filtro de arquivados;
  - detalhe com `playsThisMonth`;
  - archive/unarchive; excluir com campanha (409) e sem campanha (apaga o usuário);
  - isolamento B→A (404).
  - Em `eligibility.test.ts`: campanha de anunciante arquivado fica fora.
- Ajustar o teste existente "partner creates…" para enviar `document`.
- Commit `feat(api): complete advertiser registry with archive and delete`.

### Task 3: Autocadastro público com documento
- `apps/api/src/public/routes.ts`:
  - `Signup` ganha `personType` e `document` (obrigatórios e validados);
  - o insert passa a gravar os dois;
  - na unique violation, distingue `document_taken` (constraint `advertisers_partner_document_uq`) de `email_taken`.
- `apps/web/src/pages/public/PublicPartner.tsx`: campo "Tipo" (Empresa/Pessoa física) e "CNPJ"/"CPF" com máscara.
- Tests: em `apps/api/test/public.test.ts`, documento inválido (400) e duplicado (409 `document_taken`); em `apps/web/test/public.test.tsx`, o envio inclui `personType` e `document` só com dígitos.
- Commit `feat: require CPF/CNPJ on advertiser self-signup`.

### Task 4: Kit de UI e máscaras
- `apps/web/src/format.ts`:
  - `maskDocument(personType, v)`: CPF `000.000.000-00`, CNPJ `00.000.000/0000-00`;
  - `maskZip` (`00000-000`) e `maskPhone` (`(00) 00000-0000` / `(00) 0000-0000`);
  - `digits(v)`.
- `apps/web/src/ui.tsx`:
  - `StatCard({icon,label,value})`;
  - `SearchInput({value,onChange,placeholder})` com rótulo acessível "Buscar";
  - `EmptyState({icon,title,children})`;
  - `ConfirmDialog({open,title,children,confirmLabel,danger,onConfirm,onCancel})`, com `role="dialog"` e foco no botão cancelar;
  - `IconButton({icon,label,...})`, que usa `aria-label` = label.
  - Estilos em `styles.css` com os tokens atuais.
- Tests `apps/web/test/format.test.ts` e `ui.test.tsx`: máscaras parciais e completas; o ConfirmDialog chama `onConfirm` e `onCancel`.
- Commit `feat(web): stat cards, search, dialogs and input masks`.

### Task 5: Telas de anunciantes
- **Rotas** (`apps/web/src/App.tsx`): `/parceiro/anunciantes`, `/parceiro/anunciantes/novo`, `/parceiro/anunciantes/:id`, `/parceiro/anunciantes/:id/editar`.
- **`pages/partner/Advertisers.tsx` (lista):**
  - StatCards: Ativos, Com campanha no ar, Arquivados (contagem via `GET ?archived=1`);
  - SearchInput, com consulta com debounce de 300 ms;
  - abas Ativos/Arquivados;
  - linhas com ícone PF/PJ, nome, documento mascarado, cidade/UF, contato e um badge "autocadastro";
  - botão "Novo anunciante";
  - EmptyState quando a lista está vazia.
- **`pages/partner/AdvertiserForm.tsx` (novo e editar):**
  - seções Identificação (tipo, nome fantasia/nome, razão social só PJ, CPF/CNPJ), Contato (contato, e-mail, telefone, WhatsApp), Endereço (CEP, rua, número, complemento, bairro, cidade, UF em select) e Observações;
  - envia os documentos só com dígitos e os campos vazios como `null` no PATCH (omitidos no POST).
- **`pages/partner/AdvertiserDetail.tsx`:**
  - dados formatados, campanhas com Badge, StatCard "Inserções no mês";
  - ações Editar, Arquivar/Desarquivar e Excluir, esta com ConfirmDialog; o erro 409 mostra "Este anunciante tem campanhas; arquive em vez de excluir.".
- **Tipos:** atualizar `types.ts` (`Advertiser`) e `messages.ts` (códigos novos).
- **Tests** em `apps/web/test/catalog.test.tsx` (substitui o teste de anunciantes):
  - lista com busca (chamada `?q=`);
  - criar PJ com máscara → body com dígitos;
  - detalhe → arquivar chama `POST .../archive`;
  - excluir com 409 mostra a mensagem;
  - editar envia PATCH.
- Commit `feat(web): advertiser list, form and detail pages`.

### Task 6: Verificação e entrega
- **Checagens:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
- **Demo:** atualizar `apps/api/scripts/demo.ts` com documentos válidos nos anunciantes do demo. No navegador: criar PJ, buscar, arquivar (a campanha some do player), desarquivar, excluir sem campanha.
- **Docs:** em `docs/DEPLOY.md`, uma linha sobre a migração 0006.
- **Entrega:**
  - push, CI e revisão final (Opus);
  - correções Important com RED→GREEN;
  - merge na `main` (autorizado) e conferir o deploy (`/api/health` com o commit novo; `GET /api/partner/advertisers` sem sessão → 401).
