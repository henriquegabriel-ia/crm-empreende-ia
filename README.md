# CRM Empreende IA

CRM comercial para qualquer segmento, com contatos, empresas, oportunidades e atividades. A interface segue o Design System Empreende.IA V2: Manrope, identidade oficial, temas claro/escuro, componentes acessíveis e orientação contextual.

## O que está implementado

- Hoje com tarefas, compromissos e fila de atenção baseada em regras configuráveis.
- Contatos e empresas com ficha 360, histórico, próxima ação, filtros e visões salvas.
- Funis configuráveis, oportunidades por ID, movimentação acessível, ganho/perda e histórico.
- Agenda, atividades e tarefas sobre os mesmos registros, com responsáveis e prazos.
- Financeiro comercial e relatórios que distinguem recebimento, valor de oportunidades e previsão ponderada.
- Automações de criação de tarefas a partir de eventos de oportunidades, com ativação revisada e logs.
- Templates de rascunhos, importação/exportação CSV e exportação de reuniões por ICS.
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
2. aplica `supabase/tests/local-bootstrap.sql` e todas as migrações de `supabase/migrations`, em ordem;
3. roda `supabase/tests/commercial-security.sql`, que inclui `configuration-permissions.sql` por `\ir`, e conta as verificações `PASS` (hoje 149);
4. para no primeiro erro, mostrando arquivo, linha e mensagem;
5. para o cluster e apaga o diretório temporário ao final, inclusive em falha ou Ctrl+C.

Os testes SQL são SQL puro: valores compartilhados entre comandos ficam em `set_config('test.<nome>', ..., true)` e são lidos com `current_setting('test.<nome>')`. O único meta-comando aceito é `\ir`, que mantém os arquivos compatíveis com `psql -v ON_ERROR_STOP=1 -f`: o runner recusa `\gset` e os demais meta-comandos, e `:'variável'` falha como erro de sintaxe. Nunca aponte `local-bootstrap.sql` para um banco remoto.

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

O teste `src/integrations/supabase/database-types.test.ts` confere, no `npm run typecheck`, o contrato da base que o frontend usa: as 5 RPCs (`create_workspace`, `accept_invitation`, `set_member_role`, `move_deal` e `search_crm`) com `Args` e `Returns`, algumas FKs, inclusive as compostas, e as colunas obrigatórias no insert de `contacts`, `deals` e `profiles`. RPCs, tabelas e FKs novas não pedem mudança nele. Se a migração mudar de propósito uma dessas RPCs, FKs ou colunas obrigatórias, ajuste o teste no mesmo commit. O `typecheck` compila esse arquivo também com `strictNullChecks` (`tsconfig.typetests.json`), para distinguir `null` de `undefined`, o que o `tsconfig.app.json` do app ainda não faz.

O gerador (`scripts/generate-types.mjs`) usa o mesmo PostgreSQL 17 descartável do `test:db` (`scripts/lib/embedded-db.mjs`): aplica `local-bootstrap.sql` e as migrações, lê o schema `public` pelo catálogo do PostgreSQL e grava o arquivo com saída estável, sem Docker, login no Supabase, `psql` ou Python. A formatação usa o Prettier na versão fixada no `package.json`, mas com as opções do gerador oficial (aspas duplas, sem ponto e vírgula), e não as do `.prettierrc.json`; por isso o arquivo fica no `.prettierignore` e não passa pelo `npm run format`. Não o tire de lá nem o formate à mão; ao atualizar o Prettier, rode `npm run gen:types` de novo. O CI roda `gen:types:check` no job **Qualidade**, então uma migração sem os tipos regenerados, ou um `database.types.ts` editado à mão, reprova o push.

Se você alterou o banco remoto direto pelo painel, sem migração, a alternativa é gerar os tipos pela CLI oficial, que exige `npx supabase login`:

```bash
npx supabase gen types typescript --project-id <SEU_PROJECT_REF> > src/integrations/supabase/database.types.ts
```

No Windows, rode esse comando no Git Bash: o `>` do Windows PowerShell 5.1 grava o arquivo em UTF-16. Os tipos da CLI oficial funcionam no código, mas o `gen:types:check` vai reprovar até a mudança virar uma migração em `supabase/migrations`, que é a única fonte do schema; depois de criá-la, rode `npm run gen:types`.

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
