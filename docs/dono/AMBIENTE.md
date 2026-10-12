# Ambiente do dono do produto

Fatos do ambiente de trabalho do dono do produto, retirados do README, de `docs/PUBLICACAO-CRM.md`, de `docs/INTEGRACOES-PENDENTES.md` e do roteiro no item 0.3 (11/10/2026). Nada daqui vale para a instância de uma empresa: cada empresa usa o próprio projeto Supabase, a própria hospedagem e o próprio repositório.

## Projeto Supabase de desenvolvimento

| Campo | Valor |
| --- | --- |
| Projeto | **CRM Empreende IA** |
| Referência | `ldahvopyqkdiecchukwz` |
| URL | `https://ldahvopyqkdiecchukwz.supabase.co` |
| Organização Supabase | **HG - Aulas** (`jbsjxwtmdhewvpsygrum`), plano Free, custo informado de 0 por mês |
| Região | `sa-east-1` (São Paulo) |
| Painel | [supabase.com/dashboard/project/ldahvopyqkdiecchukwz](https://supabase.com/dashboard/project/ldahvopyqkdiecchukwz) |

Desde o item 0.1 do roteiro (11/10/2026), este é o **ambiente de desenvolvimento do dono**:

- não guarda dados reais;
- só recebe migrações depois do CI verde;
- nunca é usado em piloto, porque cada empresa usa uma instância própria.

### Estado registrado

- O projeto foi criado vazio em 06/09/2026, sem importar dados do sistema anterior, e recebeu só as migrações ativas. Ver [QA-CRM-SUPABASE.md](QA-CRM-SUPABASE.md).
- As oito migrações estão aplicadas, com RLS nas 19 tabelas. As versões das migrações locais correspondiam ao histórico remoto nessa data.
- A 9ª, a 10ª e a 11ª migrações, `20261011100000_deal_closing_probability.sql` (item 0.6 do roteiro), `20261011110000_deletions_automation_scope.sql` (item 0.7) e `20261011120000_configuration_updated_at.sql` (item 0.8), foram aplicadas em 12/10/2026, antes do CI, com autorização do dono. A aplicação foi assim:
  - Pelo editor SQL do painel (papel `postgres`, dono das tabelas), num único script com `begin`/`commit`.
  - Cada migração foi registrada em `supabase_migrations.schema_migrations` com a versão e o nome do arquivo, no mesmo formato de um statement por migração já usado no histórico.
  - Antes, o script foi ensaiado num PostgreSQL local descartável: as oito migrações anteriores, os dados de `supabase/tests/upgrade/` e o script inteiro numa só consulta. O conteúdo colado no painel foi conferido pelo SHA-256 do arquivo ensaiado.
  - Conferido depois: histórico com 13 versões; colunas, funções e gatilhos novos presentes; a oportunidade aberta passou a herdar a probabilidade da etapa; integrantes sem leitura de `automation_logs.error_detail`.
  - A partir daqui, essas três migrações não mudam mais: qualquer ajuste entra como migração nova.
  - Enquanto o histórico remoto tiver as duas versões que faltam no repositório (ver a consulta abaixo), `npx supabase db push` recusa as próximas.
- Validação remota com contas fictícias de duas organizações: 105 verificações de Auth e PostgREST, 16 de interface com o banco real e 12 de recuperação de senha. As contas de QA foram removidas depois.
- O login por senha de contas confirmadas foi validado. A confirmação global de e-mail foi preservada; só as contas fictícias de QA receberam confirmação administrativa. A entrega de e-mail não foi testada.
- A conexão OAuth usada não tem `auth_config_read`: a leitura da configuração de Auth retornou 403, e nenhuma configuração de Auth foi alterada por esse caminho. Para configurar o Auth, usar o painel ou ampliar o escopo da conexão.
- O aceite técnico local de 06/09/2026 está registrado em [EXECUCAO-CRM.md](EXECUCAO-CRM.md).

### Consulta direta de 12/10/2026

Feita pelo painel do Supabase, só com leitura. A conexão MCP desta máquina está ligada a outra organização Supabase e não enxerga este projeto.

**Migrações fora do repositório.** Antes das migrações da F0, o histórico remoto tinha dez versões: as oito do repositório e duas aplicadas em 08/09/2026, que não existem em nenhuma branch do repositório nem nos clones locais:

- `20260908164956_instagram_backend`: motor de automação de Instagram. Cria:
  - as tabelas `instagram_connections`, `instagram_flows`, `instagram_versions`, `instagram_conversations`, `instagram_runs`, `instagram_messages`, `instagram_logs` e `instagram_tags`;
  - no schema `private`, as tabelas `instagram_credentials`, `instagram_events` e `instagram_outbox`;
  - a função `public.instagram_service` e funções auxiliares em `private`.

  As FKs para `contacts` e `activities` não têm ação na exclusão: um contato ou uma atividade com registros de Instagram não pode ser excluído. As tabelas estavam vazias.
- `20260908191332_intake_integrations`: entrada genérica de leads. Cria:
  - as tabelas `intake_integrations` e `intake_receipts`;
  - no schema `private`, as tabelas `intake_credentials`, `intake_events` e `intake_links`;
  - a função `public.intake_service`;
  - em `contacts`, a coluna `custom_fields` (jsonb, padrão `{}`) e o gatilho `intake_check_contact_fields`.

  Havia uma integração cadastrada. Uma versão para o schema da Lara (`workspaces` em vez de `organizations`) existe no projeto Lara IA, em `supabase/migrations/20260908202516_intake_integrations.sql`.

As duas migrações não alteram nenhum objeto que as migrações 0.6, 0.7 e 0.8 mudam:
- as tabelas `deals`, `automation_logs`, `automations`, `pipelines`, `pipeline_stages` e `risk_rules`;
- as funções `private.validate_deal_change` e `private.run_deal_automations`.

As FKs de `intake_receipts` e `intake_links` para `deals` usam `ON DELETE SET NULL`. Os tipos gerados (`database.types.ts`) e o `test:db` não incluem esses objetos.

**Fora de qualquer migração**, o mesmo trabalho deixou no projeto:

- **Seis Edge Functions publicadas em setembro de 2026:** `instagram-api`, `instagram-webhook-meta`, `instagram-webhook-zernio`, `instagram-worker`, `intake-api` e `intake-webhook`. Os três webhooks são endpoints públicos. O provedor Zernio é o mesmo dos canais do projeto Lara IA.
- **As extensões `pg_cron` 1.6.4 e `pg_net` 0.20.4.**
- **A tarefa agendada `instagram-worker-every-minute`** (`* * * * *`, ativa): chama `private.instagram_dispatch_worker`, que faz um POST para a função `instagram-worker` do próprio projeto. Na consulta, havia 60 respostas 200 na última hora, perto de 43 mil invocações por mês. A cota do plano Free é de 500 mil.
- **A tabela `private.instagram_scheduler_requests`**, que nenhuma migração cria. Ela guarda os IDs das requisições da tarefa e tinha 10.080 linhas, sete dias de execuções por minuto.

Decisão do dono em 12/10/2026: manter tudo por ora, sem alterar. Pendente:
- localizar o código de origem (migrações, funções e a criação da tarefa e da tabela);
- decidir entre versioná-lo no repositório ou remover tudo: tarefa, funções, objetos e as duas versões do histórico, com `npx supabase migration repair`.

Advisor de segurança do painel, depois das migrações de 12/10/2026: zero erros; um aviso no Auth (proteção contra senhas vazadas desligada); sete sugestões de RLS sem política, todas em tabelas `private` do Instagram e da entrada de leads, que negam acesso a todos por padrão.

**Demais fatos da consulta:**

- A migração do receptor da Fecha IA não está aplicada.
- Dados: uma conta no Auth (a do dono, criada em 08/09/2026), uma organização, uma oportunidade aberta e nenhum log de automação.
- Banco: PostgreSQL 17.6, com as tabelas de `public` pertencendo a `postgres`, o papel do editor SQL do painel. O histórico (`supabase_migrations.schema_migrations`) guarda cada migração como um único statement, como faz o conector MCP que as aplicou.
- Auth: Site URL `http://localhost:3000` e nenhuma URL de retorno. O servidor local roda em `http://localhost:8080`. O login com senha funciona, mas os links por e-mail (confirmação, acesso sem senha e recuperação) voltam para a porta 3000.

### Arquivos locais

- `.env.local`, fora do Git, aponta para este projeto com a URL e a chave pública (`sb_publishable_…`, preenchida em 12/10/2026).
- Por isso, `npm run build` na máquina do dono embute essa URL em `dist/`. A pasta `dist/` fica fora do Git e do envio pela CLI da Vercel (`.vercelignore`). Nunca distribua a pasta do projeto por zip ou cópia: use o repositório.

## Repositório e publicação de desenvolvimento

O repositório de trabalho é `henriquegabriel-ia/crm-empreende-ia`. Até 11/10/2026 nenhum projeto de hospedagem foi criado e nenhuma URL foi publicada.

Valores para uma publicação de desenvolvimento na Vercel, que antes ficavam em `docs/PUBLICACAO-CRM.md`:

| Campo | Valor |
| --- | --- |
| Repositório | `henriquegabriel-ia/crm-empreende-ia` |
| Diretório raiz | Raiz do repositório |
| Framework | Vite |
| Instalação / build / saída | Definidos em `vercel.json` |
| `VITE_CRM_ENVIRONMENT` | `dedicated` |
| `VITE_SUPABASE_URL` | `https://ldahvopyqkdiecchukwz.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Chave pública do projeto de desenvolvimento, configurada pelo canal de ambiente |
| `VITE_SUPPORT_EMAIL` | Opcional, após definir o destino de suporte |

Ainda falta, nesse ambiente: definir a URL do frontend, configurar Site URL e redirecionamentos do Auth para ela e conferir a entrega de e-mails com SMTP próprio.

## Integração Fecha IA no ambiente do dono

O plano de correções e a ordem de ativação ficam em [INTEGRACOES-PENDENTES.md](../INTEGRACOES-PENDENTES.md#fecha-ia--crm). O estado das duas pontas no ambiente do dono era este:

### Estado em 11/10/2026

| Lado | Situação |
| --- | --- |
| CRM | PR #1 aberto, sem conflitos com `main` (mesclagem por fast-forward), 5 commits. As funções `fecha-ai-integration` e `manage-fecha-ai-connections` respondem 404 `NOT_FOUND` do gateway (não publicadas). A migração do receptor (`20260906075018_fecha_ai_review_receiver.sql`, a renomear no rebase para depois da última migração da base, hoje `20261011120000_configuration_updated_at.sql`) não está aplicada no projeto `ldahvopyqkdiecchukwz` (histórico remoto consultado em 12/10/2026). O frontend não tem hospedagem. |
| Fecha IA | Migrações `crm_review_delivery` e `crm_dispatch_expiry` e funções `crm-connection`, `crm-lookup` e `crm-review` publicadas em 06/09, segundo as evidências do repositório da Fecha IA. Em 11/10, o backend `cceinhchscphagyaokzb` respondeu, e as funções `crm-*` responderam pelo handler (401 sem sessão). Não há registro de que o secret `CRM_SUPABASE_URL` tenha sido definido: a evidência de 06/09 diz que nenhum secret foi alterado. O valor atual não foi conferido, porque isso exige acesso ao painel. |
| Ambos | Nunca houve chamada real entre os dois projetos; os testes de cada lado simulam o outro. Não há contas nem organizações reais para o primeiro envio. Na Fecha IA, segundo os registros de 06/09, não havia usuário nem organização; os usuários atuais não foram consultados. No CRM, a consulta de 12/10/2026 encontrou só a conta do dono e uma organização. Site URL, retornos de Auth e SMTP continuam pendentes nos dois lados. |

Parte dos documentos da Fecha IA está desatualizada. `PUBLICACAO-E-ACESSO.md` e as evidências de 16/09 e 03/10 registram o backend com ENOTFOUND, e o README ainda diz que a publicação das funções aguarda reconexão. README, `P4-CRM-CONTRACT.md`, `EXECUCAO-FECHA-IA.md`, `AUDITORIA-DE-CONCLUSAO.md` e `PILOTO-E-ATIVACAO.md` tratam o PR #1 como rascunho; só `PUBLICACAO-E-ACESSO.md` o descreve como aberto e pronto para revisão. Em 11/10, o backend respondia e o PR não era rascunho.

### Valores do ambiente do dono para a ativação

- Passo 4 da ativação: o secret `CRM_SUPABASE_URL` da Fecha IA recebe `https://ldahvopyqkdiecchukwz.supabase.co`, sem barra final nem caminho. Esse valor fica gravado na conexão e não pode mudar depois sem reconectar.
- Backend da Fecha IA: projeto Supabase `cceinhchscphagyaokzb`.

## Legado arquivado

O código e as migrações do sistema anterior saíram do repositório no item 0.3 do roteiro e ficam na tag anotada `legacy-archive`, criada no commit `aa94f71`, o último antes da limpeza:

- `.lovable/`: `consolidated_schema.sql`, um schema consolidado de outro produto ("CRM Imobiliário") cujas instruções mandam apagar `supabase/migrations`, e `plan.md`;
- `docs/legacy/`: migrações (`source-migrations`), funções (`source-functions`) e telas (`source-ui`) do sistema anterior, com o próprio `README.md`.

Para consultar sem restaurar nada no repositório:

```bash
git ls-tree -r --name-only legacy-archive -- .lovable docs/legacy
git show legacy-archive:docs/legacy/README.md
```

Nunca aplique essas migrações nem publique essas funções numa instância. A única fonte do schema é `supabase/migrations`.

A tag existe só no repositório local até `@devops` enviá-la ao remoto (`git push origin legacy-archive`). Os arquivos continuam no histórico do Git; o repositório de distribuição com histórico novo (item 1.7a) é que os deixa de fora para os alunos.
