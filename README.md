# CRM Empreende IA

CRM comercial para qualquer segmento, com contatos, empresas, oportunidades e atividades. A interface segue o Design System Empreende.IA V2: Manrope, identidade oficial, temas claro/escuro, componentes acessíveis e orientação contextual.

## O que está implementado

- Hoje com tarefas, compromissos e fila de atenção baseada em regras configuráveis.
- Contatos e empresas com ficha 360, histórico, próxima ação, filtros e visões salvas.
- Funis configuráveis, oportunidades por ID, movimentação acessível, ganho/perda e histórico.
- Probabilidade que acompanha a etapa, com valor manual opcional, e data de fechamento registrada ao ganhar ou perder, editável depois.
- Agenda, atividades e tarefas sobre os mesmos registros, com responsáveis e prazos.
- Edição simultânea segura: quando um colega salvou o mesmo registro antes, a tela avisa e mantém o preenchimento em vez de sobrescrever, e as telas de rotina e o Pipeline recarregam ao voltar para a aba.
- Financeiro comercial e relatórios que distinguem recebimento, valor de oportunidades e previsão ponderada; ganhas e perdidas contam pela data de fechamento.
- Automações de criação de tarefas a partir de eventos de oportunidades, com ativação revisada, filtro de funil e etapa no gatilho "mudou de etapa", edição sem pausar e logs que guardam o nome da automação e, para administradores, o detalhe técnico das falhas.
- Exclusões que não travam por vínculo: a oportunidade mostra antes quantas atividades, recebimentos e registros de automação estão vinculados e os mantém sem o vínculo; tarefas criadas por automação e automações com histórico podem ser excluídas; a ficha 360 explica o que impede excluir um contato ou uma empresa, inclusive recebimentos.
- Templates de rascunhos, importação de contatos por CSV com prévia e telefone no padrão +55, e exportação de contatos (CSV com ";" e BOM, pronta para o Excel) e de reuniões (ICS) para dono e administradores.
- Valores em reais no padrão brasileiro: "1.500,00", "1.500" e "12.5" são aceitos, com prévia formatada nos formulários.
- Equipe, convites por link, papéis, auditoria e configuração inicial baseada em dados reais.
- Oito tours com pausa, retomada, replay, preferências e isolamento por conta/organização.
- Copiloto de rotina com fontes e revisão de sugestões. A análise atual usa regras verificáveis; nenhum modelo externo de IA está conectado.

Cada empresa usa uma instância própria: um projeto Supabase e uma hospedagem só dela, com vários usuários. Este README cobre o desenvolvimento local e a validação. O que já está preparado para publicar está em [Publicação](docs/PUBLICACAO-CRM.md); o guia de implantação passo a passo chega com o item 1.4 do [roteiro](docs/ROADMAP-FINALIZACAO.md).

## Desenvolvimento

O gerenciador de pacotes é o npm, e `package-lock.json` é o único lockfile. Use Node 22 (`.nvmrc`); o mínimo aceito é Node 20 (`engines`).

```bash
npm ci
cp .env.example .env.local
# Preencha com a URL e a chave pública do seu projeto Supabase.
npm run dev
```

Use um projeto Supabase criado só para esta instância, na conta da empresa que vai usar o CRM. Nunca aponte para o projeto de outra instância. Nos exemplos, `<SEU_PROJECT_REF>` é a referência do seu projeto, o trecho antes de `.supabase.co` na URL.

Variáveis:

- `VITE_CRM_ENVIRONMENT=dedicated`
- `VITE_SUPABASE_URL`: URL do seu projeto, `https://<SEU_PROJECT_REF>.supabase.co`.
- `VITE_SUPABASE_PUBLISHABLE_KEY`: chave `sb_publishable_…` ou JWT público `anon`.
- `VITE_SUPPORT_EMAIL`: destino opcional de suporte.

Sem configuração, a tela de acesso informa a pendência e não faz chamadas ao Supabase. O build rejeita configurações inválidas e chaves privilegiadas. Nunca coloque `service_role`, chaves `sb_secret_` ou credenciais de provedores em variáveis `VITE_`.

## Banco independente

As migrações ativas ficam em `supabase/migrations`. Elas criam o modelo comercial, RLS por organização, permissões, vínculos compostos, RPCs e histórico. A criação de uma organização ocorre após autenticação, pelo fluxo `create_workspace`; nome e metadata de cadastro não concedem permissões.

Para testar toda a cadeia em um PostgreSQL 17 descartável, execute:

```bash
npm run test:db
```

Roda em Windows, macOS e Linux só com Node: os binários do PostgreSQL vêm da dependência de desenvolvimento `embedded-postgres`, sem PostgreSQL, `psql` ou Python instalados. O script `scripts/test-database.mjs`, que usa o cluster descartável de `scripts/lib/embedded-db.mjs`:

1. cria um cluster temporário no diretório temporário do sistema, numa porta livre restrita a `127.0.0.1`;
2. aplica `supabase/tests/local-bootstrap.sql` e todas as migrações de `supabase/migrations`, em ordem. Antes de uma migração que converte dados existentes, grava os dados de `supabase/tests/upgrade/<mesmo nome da migração>.sql` no formato anterior, como numa instância já em uso, para os testes conferirem o backfill;
3. roda `supabase/tests/commercial-security.sql`, que inclui `configuration-permissions.sql`, `deal-lifecycle.sql`, `automations-deletion.sql` e `configuration-concurrency.sql` por `\ir`, e conta as verificações `PASS` (hoje 251);
4. para no primeiro erro, mostrando arquivo, linha e mensagem;
5. para o cluster e apaga o diretório temporário ao final, inclusive em falha ou Ctrl+C.

Os testes SQL são SQL puro: valores compartilhados entre comandos ficam em `set_config('test.<nome>', ..., true)` e são lidos com `current_setting('test.<nome>')`. O único meta-comando aceito é `\ir`, que mantém a sintaxe dos arquivos compatível com `psql -v ON_ERROR_STOP=1 -f`: o runner recusa `\gset` e os demais meta-comandos, e `:'variável'` falha como erro de sintaxe. Ainda assim, a execução suportada é o `npm run test:db`: as verificações de backfill dependem dos dados de `supabase/tests/upgrade`, que o runner grava antes da migração correspondente. Nunca aponte `local-bootstrap.sql` para um banco remoto.

A única fonte do schema é `supabase/migrations`: não há schema alternativo nem arquivo consolidado. Aplique as migrações num projeto vazio, em ordem, pela CLI do Supabase (`npx supabase link --project-ref <SEU_PROJECT_REF>` e `npx supabase db push`), e não colando os arquivos no SQL Editor, que não registra o histórico de migrações do projeto, de que as atualizações dependem. Nunca edite uma migração já aplicada; mudanças entram como arquivos novos.

O código e as migrações do sistema anterior, que ficavam em `.lovable/` e `docs/legacy/`, saíram do repositório e ficam só na tag `legacy-archive`, para consulta (`git show legacy-archive:docs/legacy/README.md`). Nunca os aplique numa instância.

Para acesso compartilhado, publique o frontend em `<SUA_URL>` e configure no Supabase o Site URL, os redirecionamentos de autenticação e um SMTP próprio. Ver [Publicação](docs/PUBLICACAO-CRM.md). A configuração `.env.local` fica fora do Git.

### Tipos do banco no frontend

O tipo `Database` usado pelo cliente Supabase fica em `src/integrations/supabase/database.types.ts`, gerado a partir das migrações, no formato de `supabase gen types typescript` (com as poucas diferenças listadas no topo de `scripts/lib/typegen.mjs`): tabelas com `Row`, `Insert`, `Update` e `Relationships` (as FKs, inclusive as compostas), views, RPCs com `Args` e `Returns`, enums e tipos compostos. `src/integrations/supabase/commercial-types.ts` só reexporta esse tipo como `CommercialDatabase` e define `CrmRow`, que o restante do código importa. Não edite nenhum dos dois para mudar colunas ou RPCs.

Depois de criar ou alterar uma migração, regenere os tipos e faça commit do arquivo junto com a migração:

```bash
npm run gen:types         # grava database.types.ts
npm run gen:types:check   # só confere; sai com erro se o arquivo não bate com as migrações
```

O teste `src/integrations/supabase/database-types.test.ts` confere, no `npm run typecheck`, o contrato da base que o frontend usa: as 7 RPCs (`create_workspace`, `accept_invitation`, `set_member_role`, `move_deal`, `search_crm` e, desde o item 0.7 do roteiro, `delete_deal` e `automation_log_errors`) com `Args` e `Returns`, as colunas opcionais e o nome obrigatório de `automation_logs`, algumas FKs, inclusive as compostas, as colunas obrigatórias no insert de `contacts`, `deals` e `profiles` e, desde o item 0.8, a coluna `updated_at` das tabelas que as telas editam com a guarda de concorrência (ver [Edição simultânea entre colegas](#edição-simultânea-entre-colegas)). RPCs, tabelas e FKs novas não pedem mudança nele; a exceção é uma coluna nova em `automation_logs`, explicada abaixo. Se a migração mudar de propósito uma dessas RPCs, FKs ou colunas obrigatórias, ajuste o teste no mesmo commit. O `typecheck` compila esse arquivo também com `strictNullChecks` (`tsconfig.typetests.json`), para distinguir `null` de `undefined`, o que o `tsconfig.app.json` do app ainda não faz.

Uma diferença entre os tipos e o banco: desde o item 0.7 do roteiro, o `SELECT` de `automation_logs` é concedido por coluna, sem `error_detail`. Os tipos gerados mostram `error_detail` no `Row` e `select('*')` passa no `typecheck`, mas no banco essa consulta, ou qualquer leitura de `error_detail`, é recusada com `42501`. Liste as colunas com `AUTOMATION_LOG_COLUMNS` (`src/lib/operation-logic.ts`) e leia o detalhe técnico das falhas só pela RPC `automation_log_errors`, restrita a dono e administradores. O `database-types.test.ts` confere que essa lista tem todas as colunas da tabela, menos `error_detail`: uma coluna nova em `automation_logs` precisa entrar no `GRANT` de uma migração nova e nessa lista.

O gerador (`scripts/generate-types.mjs`) usa o mesmo PostgreSQL 17 descartável do `test:db` (`scripts/lib/embedded-db.mjs`): aplica `local-bootstrap.sql` e as migrações, lê o schema `public` pelo catálogo do PostgreSQL e grava o arquivo com saída estável, sem Docker, login no Supabase, `psql` ou Python. A formatação usa o Prettier na versão fixada no `package.json`, mas com as opções do gerador oficial (aspas duplas, sem ponto e vírgula), e não as do `.prettierrc.json`; por isso o arquivo fica no `.prettierignore` e não passa pelo `npm run format`. Não o tire de lá nem o formate à mão; ao atualizar o Prettier, rode `npm run gen:types` de novo. O CI roda `gen:types:check` no job **Qualidade**, então uma migração sem os tipos regenerados, ou um `database.types.ts` editado à mão, reprova o push.

Se você alterou o banco remoto direto pelo painel, sem migração, a alternativa é gerar os tipos pela CLI oficial, que exige `npx supabase login`:

```bash
npx supabase gen types typescript --project-id <SEU_PROJECT_REF> > src/integrations/supabase/database.types.ts
```

No Windows, rode esse comando no Git Bash: o `>` do Windows PowerShell 5.1 grava o arquivo em UTF-16. Os tipos da CLI oficial funcionam no código, mas o `gen:types:check` vai reprovar até a mudança virar uma migração em `supabase/migrations`, que é a única fonte do schema; depois de criá-la, rode `npm run gen:types`.

### Edição simultânea entre colegas

Duas pessoas podem abrir o mesmo registro ao mesmo tempo. Para a segunda gravação não apagar a primeira sem aviso, os formulários de edição de contato, empresa, oportunidade, atividade, recebimento, modelo, automação, funil, etapa e regra da fila de atenção, além de concluir, reabrir e excluir atividades e de ativar, pausar e excluir automações, gravam só a versão que a tela leu:

- a tabela tem `updated_at timestamptz not null default now()` e o gatilho `touch_updated_at`, que renova a versão a cada `UPDATE`, inclusive quando o cliente tenta gravar outro valor. Funis, etapas e regras ganharam a coluna no item 0.8 do roteiro (`20261011120000_configuration_updated_at.sql`);
- a tela grava com `.eq('updated_at', versão lida)` e `.maybeSingle()`. Sem linha devolvida, outra pessoa alterou ou excluiu o registro: nada é sobrescrito, a tela mostra "… mudou ou não está mais disponível", mantém o preenchimento e recarrega os dados. Exemplos: `RecordEditor`, `ActivityDialog`, `useActivityActions` (também usado pela ficha 360) e `Settings`;
- o formulário guarda a versão que abriu (`useState` com o registro inicial), porque um recarregamento em segundo plano pode trocar o registro recebido por props;
- Hoje, Agenda, Atividades, Tarefas, contatos, empresas e o Pipeline recarregam ao voltar para a aba quando os dados têm mais de 30 s (`TEAM_DATA_REFRESH`, em `src/lib/team-data.ts`), sem recarga periódica. As demais consultas seguem o padrão do app, sem recarregar no foco.

Ficam fora da guarda: mover a oportunidade de etapa (RPC `move_deal`, em que vale a última movimentação, registrada no histórico de etapas) e os nomes da organização e do perfil. A importação de contatos só cria registros e ignora os que já existem. Ao criar uma tabela editável ou uma tela de edição nova, siga o mesmo padrão. O `test:db` confere que toda tabela de `public` com `updated_at` tem o gatilho.

## Instância fora dos buscadores

Cada instância é o CRM privado de uma empresa, então nenhuma página deve aparecer em buscadores:

- `index.html` traz `<meta name="robots" content="noindex, nofollow">`;
- `public/robots.txt` fecha o site inteiro, com `User-agent: *` e `Disallow: /`.

O teste `src/test/instance-indexing.test.ts` garante as duas regras. Para reverter, por exemplo numa página pública de demonstração, remova a meta tag de `index.html`, troque `Disallow: /` por `Allow: /` em `public/robots.txt` e ajuste esse teste. A mudança vale a partir do próximo build publicado.

## Validação

```bash
npm run format:check             # Prettier; corrija com npm run format
npm run docs:links               # links relativos dos documentos .md
npm run typecheck
npm run lint:ci                  # ESLint com catraca: falha acima de 9 avisos
npm test
npm run test:db
npm run gen:types:check          # tipos do banco em dia com as migrações
npm run build
npx playwright install chromium  # só na primeira vez
npm run test:e2e
```

O Playwright inicia um servidor de teste independente na porta configurada em `playwright.config.ts`, intercepta a API com fixtures e não usa dados ou credenciais reais. O projeto `chromium` roda todos os cenários em desktop; o projeto `mobile-chrome` (Pixel 7) roda `tests/browser/smoke.spec.ts`. Screenshots, traces e resultados ficam em `test-results/`, e o relatório HTML em `playwright-report/`, ambos dentro do repositório e ignorados pelo Git.

O código segue o Prettier (`.prettierrc.json`) e o repositório usa LF em todos os sistemas (`.gitattributes`). O commit que formatou a base inteira está em `.git-blame-ignore-revs`; para o `git blame` ignorá-lo, rode uma vez `git config blame.ignoreRevsFile .git-blame-ignore-revs`.

A catraca do lint acompanha a contagem atual de avisos. Quando um aviso for corrigido, reduza o `--max-warnings` de `lint:ci` em `package.json`; nunca o aumente para acomodar um aviso novo.

O CI (`.github/workflows/ci.yml`, GitHub Actions) tem dois jobs em Node 22:

- **Qualidade**, a cada push e pull request: `npm ci`, `format:check`, `docs:links`, `lint:ci`, `typecheck`, `npm test`, `test:db`, `gen:types:check` e `build`. Pushes que só alteram `docs/` ou arquivos `.md` não disparam o CI; pull requests sempre disparam.
- **E2E**, só em pull request para `main`, toda noite e sob demanda: Playwright desktop e mobile, com relatório e resultados anexados à execução quando houver falha.

## Documentação

- [Contrato do Design System](DESIGN.md)
- [Publicação: o que já está preparado](docs/PUBLICACAO-CRM.md)
- [Roteiro de finalização](docs/ROADMAP-FINALIZACAO.md)
- [Integrações pendentes](docs/INTEGRACOES-PENDENTES.md)
- [Tours e âncoras](src/components/tours/README.md)
- [Configuração inicial](src/components/onboarding/README.md)

Os registros do ambiente do dono do produto (validação remota, execução, piloto, plano original e prévias) ficam em [docs/dono](docs/dono/README.md), fora da distribuição aos alunos.

## Licença

Proprietário — todos os direitos reservados. Manrope mantém a licença OFL em `public/fonts/Manrope-OFL.txt`.
