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

O ambiente exclusivo está conectado ao projeto **CRM Empreende IA** (`ldahvopyqkdiecchukwz`), na organização **HG - Aulas**, região São Paulo. As oito migrações estão aplicadas, com RLS nas 19 tabelas. Auth e PostgREST passaram por 105 verificações com contas fictícias de duas organizações. Consulte [a validação remota e seus limites](docs/QA-CRM-SUPABASE.md).

O aceite técnico local está concluído, incluindo fluxos comerciais, recuperação de erros, permissões e tours. Publicação e piloto com participantes são etapas posteriores. [Evidências do aceite](docs/EXECUCAO-CRM.md).

## Desenvolvimento

O gerenciador de pacotes é o npm, e `package-lock.json` é o único lockfile. Use Node 22 (`.nvmrc`); o mínimo aceito é Node 20 (`engines`).

```bash
npm ci
cp .env.example .env.local
# Preencha somente com as credenciais públicas do projeto exclusivo do CRM.
npm run dev
```

O projeto Supabase `ldahvopyqkdiecchukwz` é o ambiente de desenvolvimento do dono do produto. Ele não guarda dados reais, só recebe migrações depois do CI verde e nunca é usado em piloto: cada empresa usa uma instância própria.

Variáveis:

- `VITE_CRM_ENVIRONMENT=dedicated`
- `VITE_SUPABASE_URL`: URL do novo projeto.
- `VITE_SUPABASE_PUBLISHABLE_KEY`: chave `sb_publishable_…` ou JWT público `anon`.
- `VITE_SUPPORT_EMAIL`: destino opcional de suporte.

Sem configuração, a tela de acesso informa a pendência e não faz chamadas ao banco anterior. O build rejeita configurações inválidas e chaves privilegiadas. Nunca coloque `service_role`, chaves `sb_secret_` ou credenciais de provedores em variáveis `VITE_`.

## Banco independente

As migrações ativas ficam em `supabase/migrations`. Elas criam o modelo comercial, RLS por organização, permissões, vínculos compostos, RPCs e histórico. A criação de uma organização ocorre após autenticação, pelo fluxo `create_workspace`; nome e metadata de cadastro não concedem permissões.

Para testar toda a cadeia em um PostgreSQL 17 descartável, execute:

```bash
npm run test:db
```

Roda em Windows, macOS e Linux só com Node: os binários do PostgreSQL vêm da dependência de desenvolvimento `embedded-postgres`, sem PostgreSQL, `psql` ou Python instalados. O script `scripts/test-database.mjs`:

1. cria um cluster temporário no diretório temporário do sistema, numa porta livre restrita a `127.0.0.1`;
2. aplica `supabase/tests/local-bootstrap.sql` e todas as migrações de `supabase/migrations`, em ordem;
3. roda `supabase/tests/commercial-security.sql`, que inclui `configuration-permissions.sql` por `\ir`, e conta as verificações `PASS` (hoje 149);
4. para no primeiro erro, mostrando arquivo, linha e mensagem;
5. para o cluster e apaga o diretório temporário ao final, inclusive em falha ou Ctrl+C.

Os testes SQL são SQL puro: valores compartilhados entre comandos ficam em `set_config('test.<nome>', ..., true)` e são lidos com `current_setting('test.<nome>')`. O único meta-comando aceito é `\ir`, que mantém os arquivos compatíveis com `psql -v ON_ERROR_STOP=1 -f`: o runner recusa `\gset` e os demais meta-comandos, e `:'variável'` falha como erro de sintaxe. Nunca aponte `local-bootstrap.sql` para um banco remoto.

O projeto remoto foi criado vazio, sem importar dados do sistema anterior. As versões das migrações locais correspondem ao histórico remoto. Arquivos em `docs/legacy` estão arquivados e não devem ser implantados.

Para acesso compartilhado, ainda é preciso definir a URL do frontend e conferir os redirecionamentos de autenticação e a entrega de e-mails. O login por senha de contas confirmadas já foi validado. A configuração `.env.local` fica fora do Git.

## Validação

```bash
npm run typecheck
npm run lint:ci                  # ESLint com catraca: falha acima de 9 avisos
npm test
npm run test:db
npm run build
npx playwright install chromium  # só na primeira vez
npm run test:e2e
```

O Playwright inicia um servidor de teste independente na porta configurada em `playwright.config.ts`, intercepta a API com fixtures e não usa dados ou credenciais reais. O projeto `chromium` roda todos os cenários em desktop; o projeto `mobile-chrome` (Pixel 7) roda `tests/browser/smoke.spec.ts`. Screenshots, traces e resultados ficam em `test-results/`, e o relatório HTML em `playwright-report/`, ambos dentro do repositório e ignorados pelo Git.

A catraca do lint acompanha a contagem atual de avisos. Quando um aviso for corrigido, reduza o `--max-warnings` de `lint:ci` em `package.json`; nunca o aumente para acomodar um aviso novo.

O CI (`.github/workflows/ci.yml`, GitHub Actions) tem dois jobs em Node 22:

- **Qualidade**, a cada push e pull request: `npm ci`, `lint:ci`, `typecheck`, `npm test`, `test:db` e `build`. Pushes que só alteram `docs/` ou arquivos `.md` não disparam o CI; pull requests sempre disparam.
- **E2E**, só em pull request para `main`, toda noite e sob demanda: Playwright desktop e mobile, com relatório e resultados anexados à execução quando houver falha.

## Documentação

- [Contrato do Design System](DESIGN.md)
- [Plano aprovado de produto e UX](docs/PLANO-CRM.md)
- [Execução, decisões e pendências](docs/EXECUCAO-CRM.md)
- [Validação do Supabase real](docs/QA-CRM-SUPABASE.md)
- [Roteiro do primeiro piloto](docs/PILOTO-CRM.md)
- [Configuração de publicação preparada](docs/PUBLICACAO-CRM.md)
- [Roteiro de finalização](docs/ROADMAP-FINALIZACAO.md)
- [Integrações pendentes](docs/INTEGRACOES-PENDENTES.md)
- [Tours e âncoras](src/components/tours/README.md)
- [Configuração inicial](src/components/onboarding/README.md)

## Licença

Proprietário — todos os direitos reservados. Manrope mantém a licença OFL em `public/fonts/Manrope-OFL.txt`.
