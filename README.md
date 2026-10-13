# CRM Empreende IA

CRM comercial para qualquer segmento, com contatos, empresas, oportunidades e atividades. A interface segue o Design System Empreende.IA V2: Manrope, identidade oficial, temas claro/escuro, componentes acessíveis e orientação contextual.

## O que está implementado

- Hoje com tarefas, compromissos e fila de atenção baseada em regras configuráveis.
- Contatos e empresas com ficha 360, histórico, próxima ação, filtros e visões salvas.
- Funis configuráveis, oportunidades por ID, movimentação acessível, ganho/perda e histórico.
- Probabilidade que acompanha a etapa, com valor manual opcional, e data de fechamento registrada ao ganhar ou perder, editável depois.
- Agenda, atividades e tarefas sobre os mesmos registros, com responsáveis e prazos.
- Edição simultânea segura: quando um colega salvou o mesmo registro antes, a tela avisa e mantém o preenchimento em vez de sobrescrever, e as telas de rotina e o Pipeline recarregam ao voltar para a aba.
- Desempenho com volume no navegador: com 5 mil contatos, 1 mil empresas, 2 mil oportunidades e 15 mil atividades, Hoje e Contatos abrem em menos de 2 s (p95 medido com backend local, build de produção e CPU 4x mais lenta; numa instância real, soma-se a latência da rede e do Supabase, veja [Desempenho com volume](#desempenho-com-volume)); a fila de atenção resume os contatos sem próxima ação num item só, e o kanban move cada card na hora, sem travar o quadro.
- Financeiro comercial e relatórios que distinguem recebimento, valor de oportunidades e previsão ponderada; ganhas e perdidas contam pela data de fechamento.
- Automações de criação de tarefas a partir de eventos de oportunidades, com ativação revisada, filtro de funil e etapa no gatilho "mudou de etapa", edição sem pausar e logs que guardam o nome da automação e, para administradores, o detalhe técnico das falhas.
- Exclusões que não travam por vínculo: a oportunidade mostra antes quantas atividades, recebimentos e registros de automação estão vinculados e os mantém sem o vínculo; tarefas criadas por automação e automações com histórico podem ser excluídas; a ficha 360 explica o que impede excluir um contato ou uma empresa, inclusive recebimentos.
- Templates de rascunhos, importação de contatos por CSV com prévia e telefone no padrão +55, e exportação de contatos (CSV com ";" e BOM, pronta para o Excel) e de reuniões (ICS) para dono e administradores.
- Valores em reais no padrão brasileiro: "1.500,00", "1.500" e "12.5" são aceitos, com prévia formatada nos formulários.
- Uma empresa por instância: o primeiro cadastro cria a empresa e fica com o papel de Dono, e depois disso a entrada é só por convite, com a regra no banco. Equipe, convites por link (o expirado vira um link novo), papéis, auditoria e configuração inicial baseada em dados reais.
- Rotas que orientam: Integrações explica quando o papel não a usa, a Equipe mostra a todos quem são os donos e administradores, um link aberto sem sessão volta ao destino depois do login, e sem conexão o aviso diz que nada será salvo, em vez de prometer sincronização.
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

As migrações ativas ficam em `supabase/migrations`. Elas criam o modelo comercial, RLS por organização, permissões, vínculos compostos, RPCs e histórico. Nome e metadata de cadastro não concedem permissões.

Cada instância tem **uma empresa** (premissa 2 e decisão D6 do [roteiro](docs/ROADMAP-FINALIZACAO.md)). Enquanto não há empresa, a primeira conta com e-mail confirmado a cria por `create_workspace` e fica com o papel de Dono; o lock consultivo da função impede que dois primeiros cadastros simultâneos criem duas empresas, e depois disso ela recusa sempre. O gatilho `enforce_invite_only_signup` em `auth.users` só deixa nascer conta nova, com a empresa criada, para um e-mail com convite pendente e válido; ele vale também para as contas criadas pelo painel e pela API de administração do Supabase. A RLS por organização continua em todas as tabelas, como defesa em profundidade. Detalhes em [Entrada na instância](#entrada-na-instância).

Para testar toda a cadeia em um PostgreSQL 17 descartável, execute:

```bash
npm run test:db
```

Roda em Windows, macOS e Linux só com Node: os binários do PostgreSQL vêm da dependência de desenvolvimento `embedded-postgres`, sem PostgreSQL, `psql` ou Python instalados. O script `scripts/test-database.mjs`, que usa o cluster descartável de `scripts/lib/embedded-db.mjs`:

1. cria um cluster temporário no diretório temporário do sistema, numa porta livre restrita a `127.0.0.1`;
2. aplica `supabase/tests/local-bootstrap.sql` e todas as migrações de `supabase/migrations`, em ordem. O bootstrap simula os papéis e o schema `auth` do Supabase e também os privilégios padrão do schema `public` no projeto hospedado (tudo o que o dono do banco cria nasce com acesso para `anon`, `authenticated` e `service_role`), para que um `revoke` esquecido numa migração reprove os testes aqui, como abriria o objeto no projeto real. Antes de uma migração que converte dados existentes, grava os dados de `supabase/tests/upgrade/<mesmo nome da migração>.sql` no formato anterior, como numa instância já em uso, para os testes conferirem o backfill;
3. roda `supabase/tests/commercial-security.sql`, que inclui `configuration-permissions.sql`, `deal-lifecycle.sql`, `automations-deletion.sql`, `configuration-concurrency.sql` e `instance-admission.sql` por `\ir`, e conta as verificações `PASS`. As contas de teste são criadas com o portão de cadastro desligado dentro da transação, e `instance-admission.sql` o testa ligado;
4. depois desse arquivo, que termina em `rollback`, roda a corrida entre dois primeiros cadastros: duas sessões chamam `create_workspace` numa instância vazia, a segunda espera o lock consultivo da primeira e é recusada, e sobra uma única empresa. Ao todo, hoje, 361 verificações;
5. para no primeiro erro, mostrando arquivo, linha e mensagem;
6. para o cluster e apaga o diretório temporário ao final, inclusive em falha ou Ctrl+C.

Os testes SQL são SQL puro: valores compartilhados entre comandos ficam em `set_config('test.<nome>', ..., true)` e são lidos com `current_setting('test.<nome>')`. O único meta-comando aceito é `\ir`, que mantém a sintaxe dos arquivos compatível com `psql -v ON_ERROR_STOP=1 -f`: o runner recusa `\gset` e os demais meta-comandos, e `:'variável'` falha como erro de sintaxe. Ainda assim, a execução suportada é o `npm run test:db`: as verificações de backfill dependem dos dados de `supabase/tests/upgrade`, que o runner grava antes da migração correspondente. Nunca aponte `local-bootstrap.sql` para um banco remoto.

A única fonte do schema é `supabase/migrations`: não há schema alternativo nem arquivo consolidado. Aplique as migrações num projeto vazio, em ordem, pela CLI do Supabase (`npx supabase link --project-ref <SEU_PROJECT_REF>` e `npx supabase db push`), e não colando os arquivos no SQL Editor, que não registra o histórico de migrações do projeto, de que as atualizações dependem. Nunca edite uma migração já aplicada; mudanças entram como arquivos novos.

O código e as migrações do sistema anterior, que ficavam em `.lovable/` e `docs/legacy/`, saíram do repositório e ficam só na tag `legacy-archive`, para consulta (`git show legacy-archive:docs/legacy/README.md`). Nunca os aplique numa instância.

Para acesso compartilhado, publique o frontend em `<SUA_URL>` e configure no Supabase o Site URL, os redirecionamentos de autenticação e um SMTP próprio. Ver [Publicação](docs/PUBLICACAO-CRM.md). Os e-mails de acesso em pt-BR, com a marca da empresa, ficam em [supabase/templates](supabase/templates/README.md). A configuração `.env.local` fica fora do Git.

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

## Desempenho com volume

O snapshot da organização (contatos, empresas, oportunidades, atividades, equipe, regras, funis e etapas) é lido inteiro no navegador, e as telas são calculadas no cliente. Para continuar rápido com milhares de registros (item 0.10 do roteiro):

- **Índices por id e por vínculo.** `relationshipIndex` (`src/lib/contact-model.ts`) monta, uma vez por snapshot, `Map`s por id e por `contact_id`, `company_id` e `deal_id`. `relatedData`, a fila de atenção (`attentionQueue`), `activityLinks`, o recorte "Minha rotina" de Hoje e o diretório de contatos e empresas usam esses índices, com custo O(n + m), em vez de percorrer todas as oportunidades e atividades para cada contato. Ao criar uma tela que cruza registros, use o índice, e não `array.find` dentro de um laço; para ordenar nomes, use `compareNamesPtBR` ou `compareTextPtBR` (um único `Intl.Collator`), e não `localeCompare` com opções a cada comparação. `src/lib/volume-parity.test.ts` guarda as versões lineares anteriores e confere que o resultado é o mesmo.
- **Fila de atenção.** Com mais de 10 contatos sem próxima ação (`NO_NEXT_ACTION_GROUP_ABOVE`, em `src/lib/activity-logic.ts`), por exemplo depois de uma importação, a fila mostra um único item "N contatos sem próxima ação", com link para `/contacts?scope=no-action`. Contatos cadastrados há menos de 1 dia (`NEW_CONTACT_GRACE_MS`) e os encerrados não entram na contagem, e em "Minha rotina" ela considera só os contatos da pessoa. O filtro do diretório lista os de toda a equipe, inclusive encerrados e cadastrados nas últimas 24 horas; a explicação do item e a Ajuda avisam.
- **Leitura paginada.** `readCrmPages` (`src/hooks/useCrmSnapshot.ts`) pede a primeira página de 1000 linhas (o limite padrão de linhas por resposta do Supabase, em API > Max rows) com o total (`count: 'exact'`) e busca as demais em paralelo, até 4 por tabela, juntando-as na ordem das páginas e sem repetir ids. Cada página depois da primeira começa na última linha da anterior (sobreposição de uma linha): se essa linha não estiver lá, as páginas foram lidas fora de ordem com os dados mudando entre elas, e uma linha poderia ter ficado de fora sem a contagem perceber. Um servidor com limite de linhas menor que a página não corta a lista, com ou sem contagem (o tamanho entregue vira o passo); uma última página cheia pede a seguinte (linhas criadas durante a leitura); e uma leitura descontínua ou com menos linhas que o total (registros excluídos durante a leitura) é refeita uma vez e, se continuar incompleta, falha com mensagem, em vez de mostrar uma lista cortada em silêncio.
- **Invalidação por chave.** Toda consulta do CRM usa a chave `['crm', orgId, <consulta>, …]`, e `CRM_QUERY_READS` (`src/lib/crm-cache.ts`) diz quais tabelas cada `<consulta>` lê. Depois de gravar, a tela chama `invalidateCrmTables(cache, [tabelas gravadas])`, que acrescenta o que o banco altera junto (`CRM_WRITE_SIDE_EFFECTS`: histórico de etapas, tarefas e registros das automações, auditoria e vínculos desfeitos por `ON DELETE SET NULL`) e recarrega só as consultas afetadas: concluir uma atividade recarrega o snapshot e as próximas ações do Pipeline, mas não o papel da pessoa, as referências do Pipeline nem Configurações. Regras para quem personaliza: uma consulta nova entra em `CRM_QUERY_READS` com as tabelas que lê (sem isso, ela é invalidada por qualquer gravação, que é o comportamento seguro, e `src/lib/crm-cache.test.ts` falha); uma gravação nova declara as tabelas que altera; um gatilho novo que grava em outra tabela entra em `CRM_WRITE_SIDE_EFFECTS`. Configurações e Equipe continuam invalidando `['crm']` inteiro, porque gravam em tabelas diferentes conforme a ação e mudam papéis, funis, etapas e nomes lidos por quase todas as telas.
- **Kanban.** Mover uma oportunidade trava só aquele card (`useDealMoves`, em `src/components/pipeline/useDealMoves.ts`): os outros continuam livres. A etapa muda na hora no cache (atualização otimista com as regras de `validate_deal_change`: probabilidade, fechamento e motivo da perda), e a linha que `move_deal` devolve substitui a otimista, inclusive a versão (`updated_at`), para a edição seguinte não dar falso conflito. Numa falha, o card volta à etapa de origem, a mensagem aparece e a lista de oportunidades é relida (a gravação pode ter sido feita e só a resposta se perdido), mas só quando nenhuma outra movimentação está em andamento, para não trazer a etapa antiga de um card ainda não confirmado. Com sucesso, a lista não é relida; o histórico, as próximas ações (que uma automação pode criar) e o snapshot recarregam em segundo plano, sem segurar o card. O foco volta para o card na coluna de destino, e um único aviso para leitor de tela, sempre montado no quadro, diz o que está sendo salvo.
- **Marca de tela pronta.** Hoje, Contatos e Empresas marcam `performance.mark('screen-ready', { detail: { screen } })` quando terminam de renderizar os dados (`useScreenReady`, em `src/hooks/useScreenReady.ts`), uma vez por montagem visível. Abrindo a URL direto, como no `test:perf`, sai uma marca. Na navegação dentro do app, o `RouteTransition` monta a próxima tela escondida para buscar os dados, e essa montagem não marca (`HiddenScreenContext`): a marca sai quando a tela aparece.
- **Volume sintético.** `scripts/lib/volume-data.mjs` gera, com semente fixa (`VOLUME_SEED`), 1 mil empresas, 5 mil contatos, 2 mil oportunidades e 15 mil atividades: nomes de listas fixas, e-mails e sites em `example.test`, telefones fictícios e as restrições do schema respeitadas (perdida com motivo, ganha com responsável, fechamento só nas encerradas, compromisso com término, e-mail único). A mesma semente e o mesmo instante de referência geram as mesmas linhas. É JavaScript puro, sem dependências, para rodar no Node, no Vitest e no Playwright; `withVolume` (`tests/browser/fixture.ts`) o injeta na fixture, e o seed de demonstração (item 1.15) deve partir dele.
- **Benchmark.** `npm run test:perf` (fora do `test:e2e` e do CI) faz o build de produção em `dist-perf/` (`scripts/perf-server.mjs`), serve com `vite preview` na porta 8097, injeta o volume na fixture do E2E, servida por um servidor HTTP local na porta 54339 (`installCrmFixture` com `httpPort`, em vez da interceptação `page.route`), deixa a CPU 4x mais lenta pelo DevTools Protocol (`Emulation.setCPUThrottlingRate`) e mede 10 aberturas de Hoje e de Contatos, cada uma num contexto novo do navegador, do início da navegação até a marca `screen-ready`. A meta é p95 abaixo de 2 s, e o comando falha acima dela; o resultado fica em `test-results/perf/resultado.json`. `PERF_RUNS` muda o número de execuções, `PERF_PORT` a porta do preview e `PERF_BACKEND_PORT` a do backend falso. A medida é do cliente (download e execução do bundle, requisições com preflight de CORS, leitura paginada, cálculos e renderização), sem a latência de rede, o custo da RLS e o `count: 'exact'` de um Supabase real: não é uma garantia do tempo numa instância implantada. A fixture não é interceptada por `page.route` no benchmark porque a interceptação passa cada resposta pelo protocolo do DevTools: com ela, o p95 das mesmas telas oscilava entre 1,4 e 4,0 s, conforme a carga da máquina, por um custo que o navegador de quem usa o CRM não tem. Último resultado registrado no [roteiro](docs/ROADMAP-FINALIZACAO.md) (item 0.10).

## Entrada na instância

O item 1.1 do roteiro fecha a instância numa empresa só, com a entrada por convite. O desenho completo está em [docs/arquitetura/1.1.md](docs/arquitetura/1.1.md).

- **Primeiro dono.** Enquanto a instância não tem empresa, a tela de entrada abre na aba "Cadastrar" e avisa que a primeira conta cria a empresa e fica com o papel de Dono. Depois de confirmar o e-mail, essa conta vê "Seu negócio, seu CRM" e usa **Criar empresa**, informando a senha da conta (ver "Senha da conta", abaixo). Faça o primeiro cadastro logo depois de publicar: quem chegar antes vira dono. Quem faz o primeiro cadastro é a pessoa que vai administrar o CRM; quem implanta para um cliente combina com ele os caminhos de [Primeiro dono e convites](docs/PUBLICACAO-CRM.md#primeiro-dono-e-convites).
- **Só por convite.** Com a empresa criada, a aba "Cadastrar" só explica que a entrada é por convite, sem formulário, e o "Link por e-mail" não cria conta nova (`shouldCreateUser` desligado). Uma conta sem organização (criada antes do item ou pelo painel) vê "Falta o convite da sua equipe", com o e-mail da conta, e nunca "Criar empresa". A empresa criada no primeiro acesso é a "organização" das demais telas (o nome muda em Configurações, aba Organização), e não um registro de Empresas, que são os clientes; a dica do campo e a Ajuda explicam isso.
- **Convite de ponta a ponta.** Um dono ou administrador cria o convite em **Equipe** (RPC `create_invitation`; o `INSERT` direto em `invitations` foi revogado) e envia o link `<SUA_URL>/?invite=<id>`. A pessoa abre o link, se cadastra com o e-mail convidado, confirma o e-mail (o link de confirmação volta com `?invite=` e `?next=`) e aceita o convite, informando a senha da conta. No convite expirado, **Gerar novo link** cria outro, com ID novo; o convite de dono só um dono cria; só donos e administradores leem e revogam convites, e o convite de dono, só donos (RLS: `invitations_manager_read` e `invitations_manager_delete`, com `private.is_owner()`).
- **Senha da conta no aceite e na criação da empresa.** O portão deixa qualquer pessoa criar a conta de um e-mail com convite pendente (e, na instância vazia, de qualquer e-mail), com a senha que quiser, e o Supabase Auth não troca essa senha quando o dono do e-mail se cadastra depois: só reenvia a confirmação. Por isso, antes de `accept_invitation` e de `create_workspace`, a conta sem organização pede a senha (`claimAccountPassword`, em `src/lib/account-password.ts`): `updateUser({ password })`, que encerra as outras sessões no próprio Auth, e `signOut({ scope: 'others' })`, que cobre a senha que já era a da conta (`same_password`, aceita: quem a digitou já a conhece). Sem esse passo, quem criou a conta antes entraria nela com o papel recebido. Resta o token de acesso de uma sessão aberta entre a confirmação e o aceite, válido até expirar (1 hora no padrão do Supabase).
- **"Recebi um convite".** Fica visível na tela de entrada e na conta sem organização: a pessoa cola o link inteiro (ou só o ID) e segue para o convite, mantendo o `?next=`. `parseInviteLink` e `normalizeInvitationId` ficam em `src/lib/invite-link.ts`, e o componente em `src/components/workspace/ReceivedInvite.tsx`.
- **Estado da instância.** `useInstanceStatus` (`src/hooks/useInstanceStatus.ts`) lê `public.instance_status()`, a única RPC que `anon` executa, que devolve só `has_organization`. O hook separa o banco ainda sem a migração (`unavailable`: a função não existe, e as telas seguem como antes do item) da leitura que falhou por rede ou erro do servidor (`readFailed`): nesse caso, a tela de entrada mostra o formulário sem os avisos de primeiro acesso e de só por convite, e a conta sem organização vê "Não foi possível verificar este CRM", com **Tentar novamente**, em vez de supor que a instância está vazia. Nos dois casos, o banco continua barrando o cadastro e a segunda empresa.
- **Mensagens do Auth em pt-BR.** `authErrorMessage` (`src/lib/auth-errors.ts`) traduz os erros do Supabase Auth pelo código e, sem código, pelo texto em inglês: credenciais inválidas, e-mail não confirmado, senha fraca, limites de envio, conta existente, link expirado (lido também do erro que volta na URL), envio de e-mail sem SMTP e o cadastro recusado pelo portão, que chega como "Database error saving new user" e vira a mensagem do convite depois de reler o estado da instância. O Auth hospedado manda a recusa do portão e a falha de envio do e-mail ("Error sending confirmation email", "Error sending magic link email") com o mesmo código, `unexpected_failure`: o texto decide, a falha de envio vira a mensagem do envio de e-mail em qualquer tela, e o "Link por e-mail" que não cria conta nunca mostra a mensagem do convite. Os erros aparecem dentro do formulário, ligados ao botão; um erro desconhecido mostra uma mensagem genérica e vai para o console. As recusas das RPCs (código `P0001`, já em pt-BR) passam por `rpcRefusalMessage` (`src/lib/rpc-errors.ts`).
- **Break-glass.** Se o único dono perder o papel, quem administra o projeto Supabase devolve o acesso pelo editor SQL do painel com `private.restore_owner`, testada no `test:db`, que recusa conta com e-mail não confirmado: ver [Recuperar o acesso de dono](docs/RECUPERAR-ACESSO-DONO.md).

## Rotas, papéis e conexão

As rotas ficam em `src/App.tsx`, todas as do CRM dentro do `AppLayout`. Ao personalizar, mantenha estas regras:

- **Guarda por papel.** `RequireRole` (`src/components/layout/RequireRole.tsx`) troca a página por uma tela explicativa, com o papel da pessoa e o botão "Ir para Hoje", quando o papel não tem nada útil a fazer nela; a página nem é carregada. Hoje guarda `/settings/integrations` (quem edita, `EDITOR_ROLES`). `/team`, `/settings`, `/automations` e `/settings/security` continuam abertas em modo leitura, porque a consulta é útil: a lista da equipe mostra a quem pedir outro acesso (os convites só são lidos por donos e administradores), perfil e preferências de cada pessoa, regras e execuções que explicam as tarefas criadas sozinhas, e encerrar as próprias sessões. Os papéis e rótulos ficam em `src/lib/roles.ts`, os mesmos de `useCrmPermissions`. A guarda orienta, não protege: quem protege os dados é a RLS do banco.
- **Retorno ao link depois do login.** Sem sessão, o `AppLayout` leva a `/?next=<caminho e consulta>` com `replace`, e o login (senha, link por e-mail, cadastro e aceite de convite) volta para lá, também com `replace`. `safeNextPath` (`src/lib/next-path.ts`) só aceita caminhos internos que começam com uma única `/`, antes e depois de normalizar; `//outro-site`, `/\outro-site`, segmentos de ponto que viram `//outro-site` (`/.//outro-site`, `/%2e//outro-site`), URLs absolutas e a própria tela de entrada viram Hoje (`/dashboard`). Sair da conta e Encerrar todas as sessões levam ao login sem `?next=` (`signedOut`, no `AuthContext`): quem entrar em seguida no mesmo navegador abre Hoje, e não a tela de quem saiu. Sessão expirada e link aberto sem sessão continuam guardando o destino.
- **Formulário aberto pela URL.** `?create=1` (Pipeline e Financeiro) e `?action=new` (Contatos, Empresas, Atividades, Tarefas e Agenda) abrem o formulário enquanto estiverem na URL, e fechar o formulário tira o parâmetro. Não consuma o parâmetro num `useEffect`: o `RouteTransition` monta a próxima tela escondida antes de mostrá-la, e essa instância consumiria o pedido. Ao trocar o parâmetro por outro depois de salvar, faça numa única chamada de `setSearchParams`, que parte dos parâmetros da renderização. Depois de aberto, o formulário de `?create=1` só fecha pela URL (`useCreateFromUrl`, em `src/hooks/useCreateFromUrl.ts`): uma releitura do papel com falha não apaga o preenchimento.
- **Sem conexão.** O CRM não tem modo offline. Com `navigator.onLine === false`, o banner do `OfflineDetector` avisa que as alterações não serão salvas, e o fetch do cliente Supabase (`createSupabaseFetch`, em `src/integrations/supabase/client.ts`) recusa a requisição na hora com `OfflineRequestError` (`src/lib/offline.ts`). `errorMessage` e `relationshipError` mostram a mensagem em pt-BR, e nada fica guardado para enviar depois. Na tela de entrada, `authErrorMessage` (`src/lib/auth-errors.ts`) troca essa mensagem, pensada para gravações, por "Sem conexão com a internet. Conecte-se e tente de novo."

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
npm run emails:check             # modelos de e-mail do Auth em dia com supabase/templates/brand.json
npm run build
npx playwright install chromium  # só na primeira vez
npm run test:e2e
npm run test:perf                # desempenho com volume (build de produção, CPU 4x); fora do test:e2e e do CI
```

Os modelos de e-mail do Supabase Auth (cadastro, convite, link de acesso, troca de e-mail, senha, código e avisos de segurança) são gerados a partir da marca em `supabase/templates/brand.json` por `npm run emails:build`; não edite os `.html` à mão. Como trocar a marca, ver a prévia e aplicar no painel: [Modelos de e-mail do acesso](supabase/templates/README.md).

O Playwright inicia um servidor de teste independente na porta configurada em `playwright.config.ts`, intercepta a API com fixtures e não usa dados ou credenciais reais. O projeto `chromium` roda todos os cenários em desktop; o projeto `mobile-chrome` (Pixel 7) roda `tests/browser/smoke.spec.ts` e `tests/browser/entry.spec.ts` (tela de entrada, convite e conta sem organização). Screenshots, traces e resultados ficam em `test-results/`, e o relatório HTML em `playwright-report/`, ambos dentro do repositório e ignorados pelo Git.

O código segue o Prettier (`.prettierrc.json`) e o repositório usa LF em todos os sistemas (`.gitattributes`). O commit que formatou a base inteira está em `.git-blame-ignore-revs`; para o `git blame` ignorá-lo, rode uma vez `git config blame.ignoreRevsFile .git-blame-ignore-revs`.

A catraca do lint acompanha a contagem atual de avisos. Quando um aviso for corrigido, reduza o `--max-warnings` de `lint:ci` em `package.json`; nunca o aumente para acomodar um aviso novo.

O CI (`.github/workflows/ci.yml`, GitHub Actions) tem dois jobs em Node 22:

- **Qualidade**, a cada push e pull request: `npm ci`, `format:check`, `docs:links`, `lint:ci`, `typecheck`, `npm test`, `test:db`, `gen:types:check`, `emails:check` e `build`. Pushes que só alteram `docs/` ou arquivos `.md` não disparam o CI; pull requests sempre disparam.
- **E2E**, só em pull request para `main`, toda noite e sob demanda: Playwright desktop e mobile, com relatório e resultados anexados à execução quando houver falha.

## Documentação

- [Contrato do Design System](DESIGN.md)
- [Publicação: o que já está preparado](docs/PUBLICACAO-CRM.md)
- [Recuperar o acesso de dono](docs/RECUPERAR-ACESSO-DONO.md)
- [Desenhos de arquitetura](docs/arquitetura/README.md)
- [Roteiro de finalização](docs/ROADMAP-FINALIZACAO.md)
- [Integrações pendentes](docs/INTEGRACOES-PENDENTES.md)
- [Modelos de e-mail do acesso](supabase/templates/README.md)
- [Tours e âncoras](src/components/tours/README.md)
- [Configuração inicial](src/components/onboarding/README.md)

Os registros do ambiente do dono do produto (validação remota, execução, piloto, plano original e prévias) ficam em [docs/dono](docs/dono/README.md), fora da distribuição aos alunos.

## Licença

Proprietário — todos os direitos reservados. Manrope mantém a licença OFL em `public/fonts/Manrope-OFL.txt`.
