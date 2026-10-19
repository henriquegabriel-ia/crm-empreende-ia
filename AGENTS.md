# Regras para IA neste repositório

Leia este arquivo antes de mudar qualquer coisa. Vale para Claude Code, Codex, Cursor, Lovable e qualquer outra ferramenta de IA, e para pessoas. O detalhe de cada regra está nos guias citados; um teste (`scripts/lib/ai-rules.test.mjs`) confere que os comandos, os caminhos e os objetos do banco citados aqui existem.

## O que é este repositório

- Uma base implantável de CRM: uma empresa por instância, vários usuários, para times pequenos e médios.
- Frontend estático (Vite, React 18, TypeScript, Tailwind e shadcn/ui) e Supabase (Postgres com RLS e Auth).
- npm é o único gerenciador de pacotes. Os guias são escritos com o Windows primeiro.
- Personalizar a instância: comece por `docs/PERSONALIZAR/README.md`.

## Mapa de camadas

| Camada | Onde | Regra |
| --- | --- | --- |
| Banco | `supabase/migrations/` | Toda regra de segurança e de negócio crítica mora aqui (RLS, papéis, gatilhos). A tela nunca é a única barreira. |
| Funções do banco | `private.*` (`security definer` só quando precisa, `search_path` vazio), chamadas por RPCs de `public` (`security invoker`) | A API só enxerga `public`. |
| Ganchos | `private.custom_*` | A regra própria da empresa entra no corpo de um gancho. |
| Tipos | `src/integrations/supabase/database.types.ts` | Gerado por `npm run gen:types`; nunca editar à mão. |
| Dados no frontend | `src/hooks/`, `src/components/<área>/data*.ts` | TanStack Query com a chave `['crm', orgId, ...]`; o cliente é `crmDb`. |
| Regras puras | `src/lib/` | Testadas no Vitest. |
| Telas | `src/pages/`, `src/components/<área>/`, `src/components/ui/` e o design system de `DESIGN.md` | Texto em pt-BR com acentuação; identificadores em inglês. |
| Ajuda | `src/components/help/faq-content.ts`, `src/components/tours/catalog.ts`, `src/components/onboarding/` | Todo comportamento novo aparece na Ajuda. |
| Marca | `public/brand/brand.json` e as imagens de `public/brand/` | Nunca nos componentes. |
| Configuração | `supabase/config.toml`, `vercel.json`, `.env.example` | Valores de segurança só com motivo. |
| Código próprio | `src/custom/`, migrações `<data e hora>_custom_<nome>.sql`, objetos `custom_*` | Reservados a quem personaliza; a base nunca cria nada com esse prefixo nem nessa pasta. |

## Invariantes

### Banco e migrações

- Migração só como arquivo novo em `supabase/migrations/`, com a data e a hora do momento em que você cria o arquivo (posteriores à última da pasta). Nunca uma data futura nem a copiada de um exemplo: o `db push` recusa depois as migrações da base mais antigas que ela. Nunca edite nem apague uma migração existente, e nunca "consolide" o esquema num arquivo só.
- Migração de quem personaliza: `<data e hora>_custom_<nome>.sql`. As conferências da base e o CI a deixam de fora.
- Migração aditiva e segura com dados. Na base, um backfill tem o teste em `supabase/tests/upgrade/`.
- Toda tabela de dados em `public` tem `org_id`, `unique (id, org_id)` e FK composta `(<id>, org_id)` para as tabelas da base.
- RLS ligada. Toda política e RPC nova usa `private.current_org()` (`org_id = (select private.current_org())`), com `private.can_write()` (quem edita) ou `private.can_manage()` (donos e administradores). Nunca `profiles.org_id` direto.
- Permissões sempre explícitas. Desde `20261019120000_default_privileges.sql`, tabela, view, sequência ou função nova nasce sem permissão para a API, e a API responde 42501 até o `grant`.
- Tabela nova: `revoke all ... from public, anon, authenticated, service_role`, `grant` do mínimo para `authenticated` e, só se uma integração do servidor gravar nela, `select, insert, update, delete` para `service_role`.
- Função chamada pela API: `grant execute ... to authenticated`. Nenhuma função de `private` executável por `anon`, fora `private.instance_status`.
- Extensão criada depois daquela migração (`create extension`) pode nascer com as funções sem `EXECUTE` para a API: dê `grant execute on function <schema>.<função> to authenticated` para cada função que uma política ou RPC usar.
- Regra própria só por gancho `private.custom_*` ou objeto `custom_*`. Nunca edite função, política ou gatilho da base; nunca remova nem recrie um gancho (troque só o corpo).
- Depois de mudar o schema, rode `npm run gen:types` e faça commit do tipo gerado. Numa instância personalizada, nunca rode `manifest:build` para "consertar" uma diferença.
- Gatilho novo que lê outra tabela é `security definer` ou não cita `private.*` (a chave `service_role` não tem acesso a `private`).
- Ao personalizar, sem mudar a base: coluna nova em `deals` se grava com um `update` à parte depois do `save_deal`; dado pessoal numa coluna sua se limpa no gancho `private.custom_after_contact_saved`; a exportação do titular e a carteira da Equipe não leem colunas nem tabelas suas (veja `docs/PERSONALIZAR/CAMPO.md`).
- Guias: `docs/PROTECAO-ATUALIZACAO.md` e `docs/PERSONALIZAR/ENTIDADE.md`.

### Só no repositório da base

- Migração da base que recria ou remove função, gatilho ou política da base começa com `private.assert_base_definition` e o hash do manifesto anterior. Depois de mudar o schema, `npm run manifest:build`, com o manifesto no commit.
- Toda tabela ou coluna nova de `public` entra em `DEMO_SCHEMA` (`scripts/lib/demo-seed.mjs`), seguida de `npm run seed:demo`; migração que grava linhas num projeto novo entra em `RESTORE_SEEDED_TABLES` (`scripts/lib/backup-restore.mjs`).
- Coluna nova em `deals` editada pelo formulário entra em `public.save_deal`, `SAVE_DEAL_CREATE_FIELDS` e `SAVE_DEAL_EDIT_FIELDS` (`src/components/pipeline/deal-items-data.ts`).
- Responsável novo numa tabela nova entra em `private.portfolio_counts`, `private.move_member_portfolio` e `private.refuse_inactive_assignee`; regra de papel, em `private.role_change_allowed`.
- Campo novo de texto livre com dado pessoal entra na anonimização (`public.anonymize_contact`) e na exportação do titular (`public.export_contact_data`).

### Acesso e Auth

- Entrada só por convite (`public.create_invitation`). Nenhum `insert` em `organizations` fora de `private.provision_organization`.
- A conta só ganha papel por `public.accept_invitation` ou `public.create_workspace`, com a prova do e-mail (`private.email_proven`). Não remova nem contorne `private.discard_unproven_password` e `private.record_email_proof`.
- Nunca desligue `enable_confirmations` nem mude os valores de segurança de `supabase/config.toml` sem o motivo.
- Nunca `npx supabase config push` direto: rode `npm run config:check` e depois `npm run config:push`.
- Login social, telefone ou verificação em duas etapas só com uma mudança da base (a prova do e-mail), nunca só no `supabase/config.toml`.
- Nunca chave privilegiada (`service_role`, `sb_secret_`) numa variável `VITE_` nem no frontend; o build recusa.
- Guias: `docs/PUBLICACAO-CRM.md` e `supabase/templates/README.md`.

### Frontend

- Nada de `'unsafe-eval'` nem script inline no `index.html` (o tema fica em `public/theme-init.js`). Host externo novo só na diretiva certa da regra `/((?!brand/).*)` do `vercel.json`, com o motivo.
- Recorte de responsável só por `readOwnerFilter` e `matchesOwnerFilter` (`src/lib/owner-filter.ts`); origem por `leadSourceLabel` e `matchesLeadSource` (`src/lib/lead-source.ts`); quem vê a equipe por `TEAM_VIEWER_ROLES` (`src/lib/roles.ts`).
- Lembretes e "Minha rotina" só por `activityReminders` e `ownActivities` (`src/lib/activity-logic.ts`). O menu não carrega o snapshot de Hoje; o número no menu é `aria-hidden`, com o rótulo no nome do link.
- Importação só por `src/lib/contact-import.ts`; todas as linhas de um lote com as mesmas chaves; carimbos (data e autor) nunca no pedido.
- Mostre a recusa do banco pelo `errorMessage` de `src/components/pipeline/data.ts` (a mensagem de um gancho aparece como está).
- Todo comportamento novo aparece na Ajuda (Central, tours com `data-tour`, guia "Configurar CRM", estados vazios), e os testes da Ajuda acompanham.
- Código próprio em `src/custom/<módulo>/`. Na tela da base, só a linha necessária (rota em `src/App.tsx`, item de menu, pergunta da Central), marcada com o comentário `custom:`.
- Guias: `DESIGN.md` e `docs/PERSONALIZAR/TELA.md`.

### Marca e e-mails

- Marca só por `BRAND` e `exportFileName` (`src/lib/brand.ts`) e por `BrandFooter`; imagem da marca só em `public/brand/`. "Empreende" em texto de interface só no crédito (o teste-guarda reprova). Cores e fontes da marca se mudam nos tokens do design system (`DESIGN.md`), nunca com valores soltos nos componentes.
- Os modelos de e-mail do Auth são gerados: mudou um texto ou botão citado neles, ajuste `scripts/lib/auth-emails.mjs` e rode `npm run emails:build`. Conflito num modelo gerado se resolve aceitando qualquer lado e rodando o `emails:build`.
- Guia: `docs/MARCA.md`.

### Dados pessoais e canais

- Anonimização só por `public.anonymize_contact` (campo pessoal novo: veja "Só no repositório da base" e, ao personalizar, o gancho).
- Todo vínculo novo com contato passa por `private.guard_anonymized_contact`; ação ou entrada de canal nova respeita "Não contatar" (`private.refuse_do_not_contact_action`).
- Dado pessoal e texto de mensagem nunca na URL do CRM nem no armazenamento do navegador. Link de canal só por `src/lib/channels.ts`; tipos e resultados de atividade pelas constantes de `src/lib/contact-model.ts`.
- Atividade nova de canal só pelo registro da atividade (ids gerados no navegador) ou por `public.complete_activity`.
- Exportação nova usa `exportFileName` e não leva nomes da equipe sem uma decisão registrada.
- Guia: `docs/LGPD-INSTANCIA.md`.

### Testes e publicação

- O E2E roda sobre o build (`scripts/e2e-server.mjs`); o modo `e2e` da marca nunca vai para a implantação.
- `npm run test:db` usa um PostgreSQL descartável no seu computador. Nunca aponte um teste ou o bootstrap local para um banco remoto.

## Como validar

Rode, nesta ordem (a mesma do CI), e não declare a tarefa pronta sem tudo verde:

1. `npm run format:check`: formatação (Prettier).
2. `npm run docs:links`: links dos documentos.
3. `npm run lint:ci`: ESLint, com a catraca de avisos.
4. `npm run typecheck`: TypeScript, inclusive o exemplo de `docs/PERSONALIZAR/`.
5. `npm test`: testes unitários e de tela (Vitest).
6. `npm run test:db`: migrações, RLS e regras do banco no PostgreSQL embutido, sem instalar nada.
7. `npm run gen:types:check`: os tipos gerados em dia com as migrações.
8. `npm run manifest:check`: o manifesto da base em dia.
9. `npm run emails:check`: os modelos de e-mail em dia.
10. `npm run build`: o build de produção.
11. `npm run test:e2e`: as telas no navegador (Playwright), no desktop e no celular.

Mais `npm run brand:check` quando a mudança for na marca e `npm run config:check` quando for na configuração do Auth. Não desligue, não pule e não afrouxe um teste para passar.

## Não tocar

- As migrações que já existem em `supabase/migrations/`.
- Os arquivos gerados: `supabase/base-manifest.json`, `supabase/db-drift-check.sql`, `src/integrations/supabase/database.types.ts`, `docs/PERSONALIZAR/exemplos/database.types.ts`, `supabase/templates/*.html` e o bloco gerado do `supabase/config.toml`. Mude a fonte e rode o gerador.
- `package-lock.json` sem motivo; `bun.lock` e `bun.lockb` nunca (só npm).
- Os ganchos (só o corpo muda), os gatilhos `zz_custom_*`, `private.base_fingerprints`, `private.assert_base_definition` e a tabela `private.base_overwrite_consents`.
- `.github/workflows/` sem entender o efeito: o CI é a rede da atualização, e o backup fica desligado por variável.
- Os testes-guarda (`src/test/brand-literals.test.ts`, `src/test/instance-indexing.test.ts`, `scripts/lib/ai-rules.test.mjs`, as regras de `scripts/lib/base-manifest.test.mjs`) e a catraca do lint.
- `.env*` com valores reais: nenhum segredo em arquivo do repositório.

## Onde aprender mais

- `docs/PERSONALIZAR/README.md`: campo, entidade e tela, com um exemplo completo que passa na suíte.
- `docs/PROTECAO-ATUALIZACAO.md`: ganchos, migrações próprias e a conferência de drift.
- `docs/MARCA.md`, `docs/LGPD-INSTANCIA.md`, `docs/PUBLICACAO-CRM.md` e `DESIGN.md`.
- `docs/arquitetura/`: o desenho de cada item, com os motivos.
