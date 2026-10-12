# Roteiro de finalização do CRM

Última revisão: 11/10/2026. Cada item vira uma story (`@sm`/`@po`); decisões de arquitetura ficam com `@architect`, e CI, deploy e push com `@devops`.

## Premissas

Definidas pelo dono do produto em 11/10/2026:

1. **Base implantável.** O CRM é distribuído aos alunos do programa Empreende IA. Cada aluno sobe uma instância própria (projeto Supabase e hospedagem próprios) para **uma empresa**, a dele ou a de um cliente, e pode personalizar o código depois.
2. **Uma empresa por instância, vários usuários.** A base não é SaaS multiempresa: sem várias organizações na mesma instância, sem seletor de empresas e sem conta em várias empresas. A licença (D4) permite ao aluno personalizar e revender como SaaS com marca própria; a multiempresa, nesse caso, é personalização dele.
3. **Gratuito** por enquanto: a base não tem planos, cobrança, trial nem limites.
4. **Sem infraestrutura paga aprovada.** O desenvolvimento segue no Supabase Free. Para dados reais, cada empresa decide o plano; o guia explica riscos e recomendação.
5. **Canais prioritários:** WhatsApp, e-mail e telefone.
6. **Público:** times pequenos (1 a 10 pessoas) e médios (10 a 50, com pré-vendas/SDR, vendedores, gestores, metas e distribuição de leads).
7. **Prazo:** o mais rápido possível.

## Diagnóstico

**O que já é forte** e não precisa ser refeito:

- Segurança de dados acima da média: RLS por organização nas 19 tabelas, FKs compostas, papéis aplicados no banco, auditoria automática e build que recusa chave privilegiada.
- Migrações autocontidas, já aplicadas com sucesso num projeto Supabase vazio. A instância mínima é só banco e frontend estático, sem edge functions.
- Pipeline com vários funis, kanban acessível, histórico de etapas, regras de ganho e perda no banco e previsão ponderada separada de recebimento.
- Fila de atenção com regras explicáveis, ficha 360, agenda, tarefas, automações revisadas, financeiro de recebimentos, oito tours e guia de configuração inicial.

**O que falta**, em três blocos:

1. **Bugs que comprometem o que existe:**
   - valor "1.234,56" é recusado;
   - relatórios contam pela data de criação, e não pela de fechamento;
   - a previsão fica errada depois de mover a etapa;
   - o CSV de contatos corrompe o telefone ao exportar e reimportar;
   - exclusões travam por vínculos de automação;
   - o aviso offline promete uma sincronização que não existe;
   - o desempenho degrada com volume.
2. **Implantabilidade:**
   - hoje qualquer pessoa com a URL cria conta e uma empresa nova, e quem chega primeiro vira dono;
   - não há guia de implantação, configuração de Auth versionada nem verificação pós-implantação;
   - a marca está fixa no código;
   - a licença ("todos os direitos reservados") não autoriza o uso pelos alunos;
   - não há canal de distribuição nem caminho de atualização;
   - não há regras para a IA que o aluno usa para personalizar.
3. **Funcionalidades esperadas de um CRM** (comparação com Pipedrive, HubSpot, Zoho, RD Station CRM, Agendor, Ploomes e Moskit):
   - canais com registro;
   - desligamento de vendedor;
   - LGPD do titular;
   - importação real;
   - campos próprios;
   - gestão de times médios (metas, distribuição de leads, SDR, visibilidade por responsável);
   - notificações;
   - anexos;
   - mobile.

## Visão geral

| Fase | Objetivo | Marco |
| --- | --- | --- |
| **F0** Base confiável | Corrigir bugs e montar o mínimo de qualidade para distribuir | CI verde e repositório sem armadilhas |
| **F1** Lançamento para alunos | Um aluno implanta sozinho, e uma empresa usa no dia a dia com segurança | `v1.0.0-rc.1` → piloto de 2 semanas → `v1.0.0` |
| **F2A** Times médios | Gestão comercial para 10 a 50 pessoas | Versões `v1.x` |
| **F2B** Completude | Dados, rotina e ferramentas de personalização | Versões `v1.x` |
| **F3** Canais nível 2 e opcionais | Integrações oficiais e itens puxados por demanda | Conforme `INTEGRACOES-PENDENTES.md` |

Esforço por item: **P** até 3 dias-dev, **M** de 1 a 2 semanas-dev, **G** de 3 a 5 semanas-dev.

## F0 — Base confiável para distribuir

- [x] **0.1 Esteira enxuta (M).** Segue as decisões D1 (npm) e D2 (Vercel).
  - CI no GitHub Actions dividido para caber nos 2.000 minutos do plano Free:
    - a cada push: lint por catraca, typecheck, vitest, `format:check` e `test:db` com PostgreSQL 17;
    - só em PR e no job noturno: Playwright desktop e mobile.
  - npm como gerenciador único: remover `bun.lock` e `bun.lockb` e trocar o `vercel.json` para `npm ci`.
  - Testes rodáveis no Windows.
  - O projeto Supabase do dono passa a ser declarado projeto de desenvolvimento: sem dados reais e sem uso no piloto. A referência dele fica em [docs/dono/AMBIENTE.md](dono/AMBIENTE.md) desde o item 0.3.
  - **Feito em 11/10/2026:**
    - npm único, com `.nvmrc` (Node 22) e `engines` (Node 20 ou mais);
    - `npm run test:db` em Node com `embedded-postgres` 17, sem PostgreSQL instalado: 149 verificações, as mesmas de antes, agora em SQL puro;
    - Playwright grava os artefatos em `test-results/` e `playwright-report/` e ganhou o projeto `mobile-chrome` para o smoke;
    - `.github/workflows/ci.yml` com os jobs `qualidade` (push e PR, inclusive `build`) e `e2e` (PR para `main`, noturno e manual);
    - ambiente de desenvolvimento registrado no README (movido para `docs/dono/AMBIENTE.md` no item 0.3).
  - **Pendências:**
    - `format:check` entra no job `qualidade` com o item 0.2 (Prettier);
    - o workflow só foi validado localmente (sintaxe e schema). A primeira execução no GitHub depende do push, a cargo de `@devops`.
- [x] **0.2 Formatação única (P).** Prettier e um commit só de formatação antes das demais mudanças, registrado em `.git-blame-ignore-revs`, com `format:check` no job `qualidade` do CI. Precede de 0.3 a 1.x. É a última janela antes das instâncias personalizadas.
  - Feito em 11/10/2026:
    - Prettier 3.9.10 com `printWidth` 120 e aspas simples;
    - `.gitattributes` com LF em todos os sistemas, para o `format:check` não falhar no Windows;
    - commit `efab2cd` só de formatação, com 202 arquivos e toda a suíte verde (190 unitários, 149 de banco e 106 E2E).
  - Markdown, SQL e `public/` ficam fora do Prettier.
- [x] **0.3 Repositório sem armadilhas (P).**
  - Arquivar `.lovable/` (que manda apagar as migrações) e `docs/legacy/`.
  - Separar os documentos de estado do dono.
  - Neutralizar README e `PUBLICACAO-CRM.md`.
  - Adicionar `noindex` e `robots.txt` fechado.
  - **Feito em 11/10/2026:**
    - tag anotada `legacy-archive` no commit `aa94f71`, o último antes da limpeza; `.lovable/` e `docs/legacy/` (106 arquivos) saíram do repositório, e `eslint.config.js`, `.prettierignore` e o README deixaram de citá-los;
    - documentos de estado do dono movidos para [docs/dono/](dono/README.md): `EXECUCAO-CRM`, `QA-CRM-SUPABASE`, `QA-CRM-BROWSER`, `PILOTO-CRM`, `PLANO-CRM`, `ENTREGA-REDESIGN` e `previews/`. O novo `docs/dono/AMBIENTE.md` reúne os fatos do ambiente do dono que estavam no README, em `PUBLICACAO-CRM.md`, na seção de estado de `INTEGRACOES-PENDENTES.md` e neste roteiro, e explica como consultar o legado pela tag;
    - README e `PUBLICACAO-CRM.md` neutros, com `<SEU_PROJECT_REF>`, `<SUA_URL>` e `<SEU_REPOSITORIO>`; `PUBLICACAO-CRM.md` avisa que será substituído pelo guia de implantação (1.4). Os links do `PLANO-CRM.md` para caminhos de macOS viraram referências ao commit `49216e7` e ao projeto Lara;
    - `DESIGN.md` com a linha de base atual do lint: 0 erros e 9 avisos, com a catraca `lint:ci`;
    - `noindex, nofollow` em `index.html` e `robots.txt` com `Disallow: /`, verificados por `src/test/instance-indexing.test.ts`, com a reversão documentada no README;
    - `npm run docs:links` (`scripts/check-doc-links.mjs`) confere arquivo e âncora de cada link relativo dos documentos `.md` e entrou no job `qualidade` do CI: 46 links em 15 documentos, todos válidos;
    - busca pelo ref do dono e por caminhos de macOS sem resultado fora de `docs/dono/`;
    - suíte verde: 192 unitários, 149 de banco e 106 E2E, mais `format:check`, `lint:ci` (0 erros e 9 avisos), `typecheck` e `build`.
  - **Pendências:**
    - a tag `legacy-archive` só existe no repositório local; o envio ao remoto (`git push origin legacy-archive`) fica com `@devops`;
    - os arquivos removidos continuam no histórico do Git. O repositório de distribuição com histórico novo (1.7a) resolve isso e precisa tirar os links para `docs/dono/` do README, do `DESIGN.md` e deste roteiro;
    - `npm run build` na máquina do dono embute em `dist/` a URL do `.env.local`; `dist/` fica fora do Git e do envio à Vercel, mas a pasta do projeto nunca deve ser distribuída por cópia ou zip.
- [x] **0.4 Tipos do banco gerados de forma reproduzível e multiplataforma (P).** Script `gen:types` que gera o tipo `Database` a partir das migrações, no formato de `supabase gen types typescript`, e `commercial-types.ts` vira um reexport. O `supabase gen types --db-url` exige Docker e o `--project-id` exige login, então o gerador é próprio, em Node e offline.
  - **Feito em 11/10/2026:**
    - `scripts/lib/embedded-db.mjs` reúne o cluster descartável que estava em `scripts/test-database.mjs` (porta livre, bootstrap e migrações em sessão nova por arquivo, limpeza garantida e ganchos de sinal e de `beforeExit`); o `test:db` passou a usá-lo com a mesma saída, 149 verificações;
    - `npm run gen:types` (`scripts/generate-types.mjs` e `scripts/lib/typegen.mjs`) aplica as migrações nesse cluster, lê o schema `public` pelo `pg_catalog` e grava `src/integrations/supabase/database.types.ts` com `Json`, `Tables` (`Row`, `Insert`, `Update` e `Relationships` com as 42 FKs, inclusive as compostas), `Views`, `Functions` (`Args` e `Returns` lidos do `pg_proc`), `Enums`, `CompositeTypes` e os helpers do gerador oficial; saída ordenada e formatada pelo Prettier fixado, com as opções do gerador oficial, idêntica em execuções seguidas. A gravação é atômica (arquivo vizinho e `rename`), e uma falha de leitura ou gravação, como arquivo bloqueado ou somente leitura, aponta o arquivo, e não o PostgreSQL;
    - regras iguais às do gerador oficial (postgres-meta): identity `BY DEFAULT` fica opcional e gravável em `Insert` e `Update`, porque o PostgreSQL aceita valor explícito nela (só identity `ALWAYS` vira `?: never`); e uma função com parâmetro sem nome só entra em `Functions` se o PostgREST consegue chamá-la (um único parâmetro sem nome de tipo `json`, `jsonb` ou `text`, ou parâmetros sem nome desses tipos com valor padrão). Decisão consciente: da regra da especificação "colunas geradas e identity fora de Insert/Update", a parte de identity vale só para `ALWAYS`, como no oficial;
    - `npm run gen:types:check` gera num arquivo temporário e sai com 1, mostrando a primeira linha diferente, se o versionado não bater; entrou no job `qualidade` do CI depois do `test:db`;
    - `commercial-types.ts` reexporta `Database` como `CommercialDatabase` e mantém `Json` e `CrmRow`, sem mudar nenhum import; as colunas de `Row`, `Insert` e `Update` das 19 tabelas e as 5 RPCs saíram iguais às do arquivo anterior (comparação de tipos em modo `strict`; só `Relationships` passou a ser preenchido), então nenhum ajuste de código foi preciso;
    - `scripts/generate-commercial-types.py` removido; README com a seção "Tipos do banco no frontend" (quando rodar, o que o teste de tipos confere, por que o arquivo fica no `.prettierignore` e a alternativa `npx supabase gen types typescript --project-id <SEU_PROJECT_REF>`);
    - testes: `src/integrations/supabase/database-types.test.ts` confere no `typecheck` as 5 RPCs da base (sem exigir que sejam as únicas, para RPCs novas não quebrarem o teste), as FKs compostas, a ausência da FK para `auth.users` em `profiles` e as colunas obrigatórias no insert. O `typecheck` compila esse arquivo também com `strictNullChecks` (`tsconfig.typetests.json`), porque com o `strict: false` do app `null`, `undefined` e `T | null` ficavam indistinguíveis; mutações conferidas (`Returns: null` em `set_member_role`, `p_name` aceitando `null`, FK de `profiles` para `users`) reprovam. `scripts/lib/typegen.test.mjs` cobre enum, domínio, identity, coluna gerada, view, tipo composto, sobrecarga, parâmetros sem nome e ordem estável;
    - suíte verde: 203 unitários, 149 de banco, 106 E2E, `gen:types:check`, `format:check`, `lint:ci` (0 erros e 9 avisos), `typecheck` e `build`.
  - **Pendências:**
    - diferenças conscientes em relação ao gerador oficial, listadas no topo de `scripts/lib/typegen.mjs`, nenhuma com efeito no schema atual: as `Relationships` de views ficam vazias (o oficial as deduz das dependências da view; hoje não há views); `isOneToOne` compara as colunas da FK como conjunto; funções com vários parâmetros `OUT` devolvem um objeto, e não `Record<string, unknown>`; colunas geradas ficam `?: never` na escrita; funções de campo calculado ficam de fora; e tipos sem correspondência anuláveis saem como `unknown | null`;
    - o primeiro `gen:types:check` no GitHub depende do push, a cargo de `@devops`.
- [x] **0.5 Dinheiro, telefone e CSV no padrão brasileiro (M).** Segue a decisão D7.
  - `parseBRL`: "1.234,56" é aceito e "12.5" continua 12,5.
  - `phone.ts` classifica o número em celular, fixo ou inválido.
  - Um único `csvCell`, com round-trip do "+55".
  - Importar sempre visível; exportar só para dono e admin até existir a exportação auditada.
  - **Feito em 11/10/2026:**
    - `src/lib/money.ts`: `parseBRL` aceita "R$" e espaços nas pontas; com vírgula, a vírgula é decimal e os pontos são milhar em grupos de 3; sem vírgula, "1.500" é milhar e um único ponto com 1 ou 2 casas é decimal ("12.5" = 12,50); recusa vazio, negativo, notação científica, mais de 2 casas, valores acima de 999.999.999.999,99 e formatos ambíguos ("1.2345", "0.500", "1,234,5"). `formatBRL` exibe "R$ 1.500,00" e `formatBRLInput` devolve "1.500,00", que o parser lê de volta sem perda. `parseDealValue` virou um wrapper de `parseBRL`, e os testes de `deal-logic` que fixavam a recusa de "1.000,25" e "1.234" foram reescritos;
    - `DealForm` e `PaymentForm` mostram a prévia formatada enquanto a pessoa digita (`MoneyPreview`, ligada ao campo por `aria-describedby`), e a edição abre o valor salvo como "2.400,00";
    - `src/lib/phone.ts`: `normalizePhoneBR` devolve `{ e164, kind }` com os 67 DDDs do Brasil, celular com 9 dígitos começando com 9 e fixo com 8 dígitos começando com 2 a 5, aceitando "+55", "55" em números de 12 ou 13 dígitos, o prefixo "0", parênteses, espaços, hífen e ponto; `formatPhoneBR` exibe "(11) 99999-0000" e devolve o texto original quando o número não é reconhecido;
    - `src/lib/csv.ts` é a única implementação de CSV (`csvCell`, `buildCsv(rows, columns)`, `downloadCsv`, `downloadText`, `parseCsv`, `decodeCsvBytes`): exportação com ";", BOM UTF-8 e CRLF; leitura com separador detectado pelo cabeçalho, aspas, BOM e CRLF; o apóstrofo de neutralização (=, +, -, @, TAB, CR e LF no início, mesmo depois de espaços) sai na leitura, e um texto que já começava com apóstrofo seguido de fórmula ganha mais um, para o round-trip ser exato. As cópias de `operation-logic.ts` e `crm-import.ts` saíram; Relatórios e Integrações usam a biblioteca. O limite de 2 MB é medido em bytes;
    - decisão além da especificação: um arquivo que não é UTF-8 válido é lido como Windows-1252, o formato do "CSV" salvo pelo Excel em português, para "João" não virar "Jo�o";
    - contatos: exportação com ";" e BOM nas mesmas colunas do modelo e da importação (`CONTACT_CSV_COLUMNS`), então o arquivo exportado pode ser reimportado. A importação grava o telefone brasileiro reconhecido em E.164 (+5511999990000) e mantém como foi digitado o que não reconhece, sem descartar a linha; a prévia ganhou a coluna Telefone e conta os números não reconhecidos;
    - Integrações não lê mais `integration_configs` nem tem o botão "Habilitar recurso": importar aparece para quem pode editar (dono, admin e membro); exportar contatos e reuniões (ICS) aparece só para dono e admin, com aviso para os demais papéis. A tabela continua no schema para integrações externas reais, sem migração. O tour `integrations` passou para a versão 2, com os passos `integrations-import` e `integrations-export` no lugar de `integrations-status` e `integrations-configure`; a Ajuda e o [README dos tours](../src/components/tours/README.md) foram atualizados;
    - testes: `money`, `phone` e `csv` novos, `deal-logic`, `operation-logic`, `crm-import`, formulários e tours ampliados (round-trip de "+55 11 99999-0000" exportado e reimportado, contatos com fórmula, BOM e Windows-1252); E2E novo `tests/browser/csv.spec.ts` (exportação com BOM e ";" e reimportação do "+55", modelo e arquivo do Excel, visibilidade por papel sem ativação, valores em reais na oportunidade e no lançamento) e smoke de importação por membro em desktop e mobile. O smoke de erro e recuperação de Integrações saiu, porque a tela não lê dados ao abrir;
    - suíte verde: 332 unitários (eram 203), 149 de banco (sem mudança de schema) e 112 E2E (78 desktop e 34 mobile; eram 106), mais `format:check`, `docs:links`, `lint:ci` (0 erros e 9 avisos), `typecheck`, `gen:types:check` e `build`.
  - **Pendências:**
    - esconder "Exportar" orienta o uso, mas não protege: a RLS deixa qualquer membro ler os contatos. O controle real é a exportação auditada por RPC (2B.7), que também decide o CSV de Relatórios, hoje disponível para todos os papéis;
    - a ficha 360 e o diretório ainda mostram o telefone como está gravado, então um contato importado aparece como "+5511999990000" até o item 1.9 usar `formatPhoneBR` na exibição e normalizar o telefone no cadastro manual (`RecordEditor`);
    - a busca por telefone compara o texto gravado: "(11) 99999" não encontra "+5511999990000". A busca por dígitos é do item 2B.6.
- [x] **0.6 Fechamento e previsão confiáveis (M).** Numa única reescrita de `validate_deal_change`:
  - `deals.closed_at`, editável e com backfill pelo histórico;
  - probabilidade `NULL` = herda da etapa;
  - Relatórios pela data de fechamento.
  - **Feito em 11/10/2026:**
    - migração `20261011100000_deal_closing_probability.sql`: `deals.closed_at` (`timestamptz` com `CHECK isfinite`), preenchida com `now()` ao ganhar ou perder quando não informada, editável enquanto a oportunidade está ganha ou perdida (nunca antes da criação nem depois de `now()` + 1 dia; apagar a data de uma encerrada é recusado), mantida nos movimentos de etapa e anulada ao reabrir. `CHECK` que exige a data só nas encerradas e índice `(org_id, status, closed_at)`. `private.validate_deal_change` foi reescrita uma única vez: ganha = 100, perdida = 0, reabrir = `NULL` e mover de etapa mantém o `NULL` (herda) ou o valor manual (D8). As mensagens de recusa são em pt-BR;
    - backfill sem passar pelos gatilhos (`disable trigger user` só durante os `update`), para não mexer em `updated_at`, que a regra de oportunidades paradas usa, nem gerar auditoria, histórico ou automações. `closed_at` vem da última entrada na situação atual em `deal_stage_history`, inclusive a criação já encerrada; movimentos de etapa depois do fechamento não contam e, sem histórico, vale `updated_at`. Abertas com a probabilidade igual à da etapa atual passam a `NULL`;
    - frontend: `stageProbabilities`, `effectiveProbability` e `probabilityLabel` em `deal-logic` alimentam a previsão ponderada do Pipeline, o `DealDetail` ("60% (da etapa)" e "Fechada em"), a previsão e o CSV dos Relatórios e os fatos do Copiloto. O `DealForm` tem a probabilidade opcional ("Da etapa: X%" quando vazia; criar ou trocar a etapa não copia mais a da etapa) e o campo "Fechada em" (o mesmo nome do `DealDetail`, dos Relatórios e do Copiloto, com dica que o separa da previsão) na edição da oportunidade ganha ou perdida, enviado só quando o dia muda, ao meio-dia local e limitado entre a criação e agora. A criação vem do banco com microssegundos e `Date.parse` os corta, então o limite inferior é arredondado para cima ao milissegundo; sem isso, escolher o dia da criação de uma oportunidade criada à tarde era recusado pelo gatilho. Na criação já ganha ou perdida, uma dica ligada à Situação avisa que o fechamento será o dia do cadastro. Configurações e a Ajuda avisam que alterar a probabilidade de uma etapa muda na hora a previsão das oportunidades que a acompanham. `localDateKey` foi para `src/lib/dates.ts`, reexportado por `operation-logic`;
    - Relatórios: ganhas e perdidas entram no período pela data de fechamento e as em aberto pela de criação (`reportDateKey`, `inReportPeriod` e `summarizeReport(deals, stages, período)`), com o rótulo "Base de data: fechamento", o filtro "Período de"/"Até" (antes "Criadas de") e a coluna "Fechada em" na tabela e no CSV. A Ajuda ganhou duas perguntas sobre probabilidade e período;
    - `test:db`: o runner grava `supabase/tests/upgrade/<migração>.sql` logo antes da migração de mesmo nome, com dados no formato anterior, como numa instância em uso; `supabase/tests/deal-lifecycle.sql` (incluído por `\ir`) confere o backfill (8 oportunidades legadas) e o ciclo: herança depois de `move_deal`, ganho, perda e reabertura, `closed_at` preenchido, editável (inclusive o instante da criação arredondado ao milissegundo, como o navegador envia), mantido, anulado e as validações. Os cabeçalhos de `commercial-security.sql` e `deal-lifecycle.sql` e o README indicam o `npm run test:db` como execução suportada, porque o backfill depende desses dados. Três mutações (sem o filtro de transição no backfill, sem o `NULL` ao reabrir e sem desligar os gatilhos) reprovam o teste;
    - tipos regenerados (`closed_at` em `deals`) e fixture E2E com `closed_at`, probabilidade `NULL` e as regras do gatilho emuladas em `move_deal`, criação e edição. E2E novo `tests/browser/closing.spec.ts`: venda criada em agosto e ganha em outubro aparece em outubro, e não em agosto (tabela, totais e CSV); ganhar pela interface grava a data e a edição corrige o dia; e a previsão ponderada acompanha a etapa quando a probabilidade fica em branco;
    - `docs/INTEGRACOES-PENDENTES.md` e `docs/dono/AMBIENTE.md`: a migração do receptor da Fecha IA (PR #1) precisa ser renomeada no rebase para depois de `20261011100000`, senão o `db push` a recusa por ficar fora de ordem; a ordem de ativação confere todas as migrações pendentes no remoto, e o ambiente do dono registra que a do item 0.6 ainda não foi aplicada lá;
    - suíte verde: 347 unitários (eram 332), 183 de banco (eram 149) e 115 E2E (81 desktop e 34 mobile; eram 112), mais `format:check`, `docs:links`, `lint:ci` (0 erros e 9 avisos), `typecheck`, `gen:types:check` e `build`.
  - **Pendências:**
    - abertas cuja probabilidade ficou defasada pelo comportamento antigo (gravada na criação e não atualizada ao mover de etapa) continuam como valor manual, porque o backfill só converte as iguais à etapa atual. Para que passem a herdar, basta apagar o campo em Editar;
    - criar uma oportunidade já ganha não aceita data de fechamento passada, porque a criação é sempre o momento do cadastro (o formulário avisa ao escolher a situação); oportunidades históricas chegam com a importação completa (2B.1);
    - o E2E roda sobre o `vite dev` sem novas tentativas; numa execução completa, uma conexão recusada pelo servidor (fora do item) falhou uma vez e não se repetiu. Se voltar no CI, usar `retries: 1` só no CI ou servir o E2E com `vite preview`;
    - o dia do fechamento segue o fuso do navegador, como os demais filtros de data; o fuso da organização é do item 3.1;
    - a migração só foi aplicada no PostgreSQL 17 local do `test:db` e do `gen:types`, não num projeto Supabase. O `disable trigger user` exige que ela rode como dono de `deals`, que é o caso do `npx supabase db push`.
- [x] **0.7 Exclusões e automações básicas (M).** Numa única reescrita de `run_deal_automations`:
  - `ON DELETE SET NULL (coluna)` nos `automation_logs`, preservando os logs com snapshot do nome;
  - RPC `delete_deal`;
  - erro real visível;
  - editar sem pausar;
  - filtro de funil e etapa no gatilho "mudou de etapa".
  - **Feito em 11/10/2026:**
    - migração `20261011110000_deletions_automation_scope.sql`: em `automation_logs`, `automation_id` e `deal_id` passam a aceitar `NULL`, e as FKs de `automation_id`, `deal_id` e `activity_id` são recriadas com `ON DELETE SET NULL (coluna)` (forma com lista de colunas do PostgreSQL 15+, que mantém o `org_id`). Os logs ganham `automation_name` (nome da automação na execução, com backfill e `NOT NULL`) e `error_detail` (`SQLSTATE: SQLERRM`, preenchido na falha ao lado da mensagem amigável). Excluir uma tarefa criada por automação e uma automação com histórico deixou de falhar com 23503. A oportunidade que disparou automação também, mas só pela RPC `delete_deal` (abaixo): a tarefa criada continua presa pela FK `activities → deals`, sem `ON DELETE`, e o `DELETE` direto ainda falha com 23503;
    - `error_detail` só para dono e administradores: o `SELECT` de `automation_logs` passou a ser concedido por coluna, sem `error_detail`, e o detalhe sai pela RPC `automation_log_errors(p_automation_id)` (`SECURITY DEFINER` em `private`, com `can_manage`). Os demais papéis continuam lendo as execuções. Consequência: `select=*` em `automation_logs` passa a ser recusado (42501), embora os tipos gerados mostrem `error_detail`; quem consulta a tabela usa a lista compartilhada `AUTOMATION_LOG_COLUMNS` (`src/lib/operation-logic.ts`), que o `database-types.test.ts` confere contra as colunas da tabela, e o README explica a diferença na seção de tipos;
    - `automations.pipeline_id` e `stage_id`, opcionais, com FKs compostas `ON DELETE SET NULL (pipeline_id)` e `(stage_id)`, a FK da etapa por `(stage_id, pipeline_id, org_id)`, `CHECK` que exige o funil quando há etapa (sem ele a FK de três colunas não seria conferida) e `CHECK` que só aceita o filtro no gatilho `deal_moved`. `private.run_deal_automations` foi reescrita uma única vez: o gatilho "mudou de etapa" dispara só ao entrar na etapa e no funil configurados (quando houver), grava `automation_name` e `error_detail`, processa as regras em ordem estável e respeita a guarda `crm.bulk_move = 'on'`, reservada para movimentações em massa (nada a liga ainda). A guarda só pode ser ligada na transação (`set_config('crm.bulk_move','on',true)` ou `SET LOCAL`, dentro da RPC), como dizem os comentários da migração;
    - decisão além da especificação: se o funil ou a etapa do filtro forem excluídos, o `SET NULL` não amplia a automação para qualquer etapa. O gatilho `private.normalize_automation_scope` limpa a etapa quando o funil sai e pausa a automação ativa quando a remoção vem da FK (`pg_trigger_depth() > 1`), com registro na auditoria; edições diretas não pausam;
    - RPC `public.delete_deal(p_deal_id, p_confirm default false)`, `SECURITY INVOKER`, só para dono e administradores: conta atividades, recebimentos e logs vinculados; sem confirmação e com vínculos, recusa com as contagens em pt-BR ("Esta oportunidade tem vínculos: 3 atividades, 1 recebimento e 5 registros de automação…") e o JSON delas em `details`; com confirmação, desvincula atividades e recebimentos, mantém os logs (`deal_id` nulo, com o nome) e exclui a oportunidade, com o histórico de etapas. Devolve as contagens;
    - frontend: o "Excluir" do `DealDetail` abre o `DealDeleteDialog`, que conta os vínculos antes (`loadDealLinks`, só contagens), explica o que continua no CRM e exclui pela RPC. Sem vínculos na contagem, a exclusão vai sem confirmação: se algum aparecer até lá, o banco recusa, as contagens são atualizadas e a pessoa confirma de novo. Com vínculos, a confirmação desvincula todos os existentes no momento da exclusão (ver Pendências). Enquanto as contagens não carregam, ou se a conferência falhar, o botão de confirmar fica desabilitado. A ficha 360 conta os recebimentos do contato ou da empresa (só a contagem, `count: exact` com `head`, e só para quem pode excluir) e explica o bloqueio com as contagens ("tem vínculos: 1 recebimento"), com link para Financeiro; o botão desabilitado aponta para a explicação (`aria-describedby`) e a conferência é anunciada (`role="status"`). As mensagens de 23503 do pipeline e do relacionamento dizem qual tabela ainda referencia o registro (`blockingTableLabel` em `src/lib/record-links.ts`);
    - Automações: editar uma automação ativa não a pausa (o `update` não envia `is_active`; só as novas nascem pausadas), com o aviso "Automação ativa" no formulário e o botão "Salvar alterações"; escolha de funil e etapa de entrada no gatilho "mudou de etapa", com o filtro no cartão e na revisão de ativação, a explicação do filtro ligada aos dois campos (`aria-describedby`) e o motivo de a etapa estar desabilitada sem funil; prazo com concordância ("no momento do evento", "1 dia após o evento", `automationDueLabel`) no cartão e na revisão; "Excluir" com confirmação, que avisa que o histórico fica no banco com o nome, mas deixa de aparecer na tela (para mantê-lo visível, Pausar); nas execuções, o detalhe técnico das falhas para administradores e "Oportunidade excluída"/"Tarefa excluída" quando o vínculo saiu. Decisão: a edição de automação ativa é confirmada por aviso no formulário, e não por um segundo diálogo. A Ajuda ganhou quatro perguntas sobre exclusões e automações;
    - `test:db`: `supabase/tests/automations-deletion.sql` (incluído por `\ir`) e `supabase/tests/upgrade/20261011110000_deletions_automation_scope.sql` (logs no formato antigo) conferem o schema das FKs, o backfill do nome, a exclusão de tarefa gerada por automação e de automação com histórico (legadas e novas), o filtro de etapa e de funil, as recusas do filtro inválido, a edição ativa sem pausa, a guarda `crm.bulk_move`, o `error_detail` em falha forçada e quem o lê, `delete_deal` sem e com confirmação, por papel e entre organizações, e a pausa ao excluir a etapa ou o funil do filtro. Seis mutações da migração (sem o `SET NULL` de `activity_id`, sem o filtro de etapa, sem a pausa, sem a guarda, sem o nome e sem o `GRANT` por coluna) reprovam o teste;
    - tipos regenerados (colunas novas e as RPCs `delete_deal` e `automation_log_errors`), com o contrato delas em `database-types.test.ts`. Fixture E2E coerente: colunas novas, `delete_deal` e `automation_log_errors` com as mesmas regras, `SET NULL` dos logs ao excluir tarefa ou automação, recusa de `select=*` em `automation_logs` e `Content-Range` exposto para as contagens. E2E novo `tests/browser/automations.spec.ts`: editar ativa sem pausar, nova automação com funil e etapa, detalhe técnico para administrador e exclusão de automação com histórico, membro sem detalhe nem exclusão, exclusão de oportunidade com as contagens e a ficha 360 bloqueada por recebimento, além do prazo "1 dia após o evento" na revisão de ativação;
    - suíte verde: 367 unitários (eram 347), 234 de banco (eram 183) e 121 E2E (87 desktop e 34 mobile; eram 115), mais `format:check`, `docs:links`, `lint:ci` (0 erros e 9 avisos), `typecheck`, `gen:types:check` e `build`.
  - **Pendências:**
    - os logs de uma automação excluída ficam no banco, com o nome, mas a interface só lista execuções por automação existente (a confirmação da exclusão e a Ajuda avisam); mostrá-los cabe na timeline unificada (2B.3) ou nas notificações de falha (2A.7), que leem `automation_logs` com `AUTOMATION_LOG_COLUMNS` (registrado nos dois itens);
    - a interface não exclui funis nem etapas, então a pausa por perda do filtro só acontece por SQL ou API até o arquivamento de etapa (2B.5), que também deve ligar `crm.bulk_move` (registrado no 2B.5 e no 2A.8);
    - `crm.bulk_move` só pode ser ligada na transação: `set_config('crm.bulk_move','on',true)` ou `SET LOCAL`, dentro da RPC de movimentação em massa. Ligada na sessão (`set_config(..., false)` ou `SET` sem `LOCAL`), ficaria na conexão compartilhada do PostgREST ou do pooler e calaria, sem erro, as automações das requisições seguintes. Quem ligar a guarda deve cobrir com um teste que confira que ela não sobra depois do commit;
    - confirmar a exclusão de uma oportunidade com vínculos desvincula também os que surgirem depois das contagens exibidas; só a exclusão sem vínculos é recusada se algum aparecer. Se o produto quiser essa garantia, `delete_deal` pode receber as contagens esperadas (por exemplo, `p_expected jsonb`) e recusar quando divergirem, com migração nova e teste no `test:db`;
    - a migração só foi aplicada no PostgreSQL 17 local do `test:db` e do `gen:types`, não num projeto Supabase; exige PostgreSQL 15 ou superior por causa do `SET NULL (coluna)`. O comportamento das FKs no E2E é emulado pela fixture; o real está coberto só no `test:db`.
- [x] **0.8 Concorrência (P).** Guarda de `updated_at` em contato, empresa e configurações, a ficha 360 usando `useActivityActions` e `refetchOnWindowFocus`.
  - **Feito em 11/10/2026:**
    - migração `20261011120000_configuration_updated_at.sql`: `pipelines`, `pipeline_stages` e `risk_rules` ganham `updated_at timestamptz not null default now()`, com `CHECK isfinite` e o gatilho `touch_updated_at` das demais tabelas. As linhas existentes recebem o instante da migração, sem disparar gatilhos nem auditoria. As três tabelas já estavam em `protect_record_metadata` e `audit_record_change` (que ignora `updated_at`), e os GRANTs de tabela inteira já cobrem a coluna nova;
    - `RecordEditor` (contatos e empresas) e Configurações (funis, etapas e regras da fila de atenção) gravam com `.eq('updated_at', versão lida)` e `maybeSingle`, como oportunidades, atividades e recebimentos. Sem linha devolvida, a tela mostra "Este contato", "Esta empresa", "Este funil", "Esta etapa" ou "Esta regra" "mudou ou não está mais disponível", mantém o preenchimento e recarrega os dados, sem sobrescrever nada. A criação de funil e de etapa passou a devolver o registro (`select('id').single()`), para o salvamento distinguir sucesso de conflito;
    - a versão que o formulário edita fica guardada desde a abertura: o `RecordEditor` guarda o registro inicial, como o `ActivityDialog`, e o `DirectoryPage` guarda o cadastro em edição em vez de procurá-lo de novo na lista. Assim, o recarregamento ao voltar para a aba não troca a versão nem fecha o formulário se outra pessoa excluir o cadastro (a gravação mostra o conflito). Os diálogos de funil e etapa guardam `updated_at` ao abrir;
    - decisão além da especificação: as regras da fila são formulários sempre abertos, sem "reabrir". Cada regra guarda a versão em que se baseia; sem mudanças locais, acompanha a versão recarregada; com mudanças locais e uma versão mais nova no servidor, mostra "Outra pessoa alterou esta regra…" com o botão "Carregar versão atual". Depois de salvar, a versão devolvida vira a nova base, sem falso conflito na gravação seguinte;
    - a ficha 360 conclui e reabre atividades por `useActivityActions`, a mesma gravação de Hoje, Agenda e Atividades, com a guarda e a mensagem "Esta atividade mudou ou não está mais disponível"; a exclusão do cadastro mantém estado próprio;
    - `TEAM_DATA_REFRESH` (`src/lib/team-data.ts`): `refetchOnWindowFocus: true` e `staleTime` de 30 s no snapshot (`useCrmSnapshot`: Hoje, Agenda, Atividades, Tarefas, contatos e empresas) e nas consultas `deals` e `deal-actions` do Pipeline, sem `refetchInterval`. Decisão: com o `staleTime` padrão do app (5 min), o foco só recarregaria depois de 5 min, então as duas consultas do Pipeline passaram aos mesmos 30 s do snapshot;
    - Ajuda com a pergunta "O que acontece se um colega alterar o mesmo registro que eu?" e README com a seção "Edição simultânea entre colegas", que descreve o padrão para quem personaliza;
    - testes: `RecordEditor.test.tsx` (versão lida no filtro, conflito de contato e de empresa, cadastro excluído e versão mantida depois de um recarregamento), `Settings.test.tsx` novo (conflito de etapa e de funil, reabrir e salvar a versão atual, criação de etapa, regra com "Carregar versão atual", duas gravações seguidas sem falso conflito e regra sem mudanças acompanhando o recarregamento), `Relationship360.test.tsx` novo (conclusão com a guarda e conflito ao concluir e ao reabrir) e `useCrmSnapshot.test.ts` (recarrega ao voltar para a aba só depois de 30 s, mesmo com o padrão do app desligado, e sem `refetchInterval`); `database-types.test.ts` confere `updated_at` nas dez tabelas editadas com a guarda. Seis mutações das telas (sem o filtro no `RecordEditor`, sem a versão guardada, sem a guarda de funil e etapa, sem a guarda da regra, sem a nova base depois de salvar e sem acompanhar o recarregamento) e duas do recarregamento (sem `refetchOnWindowFocus` e com `staleTime` 0) reprovam os testes;
    - `test:db`: `supabase/tests/configuration-concurrency.sql` (incluído por `\ir`) e `supabase/tests/upgrade/20261011120000_configuration_updated_at.sql` (regra no formato antigo) conferem a coluna, o gatilho e o `CHECK`, que toda tabela de `public` com `updated_at` tem o gatilho, a versão das linhas existentes, a renovação em funil, etapa e regra, que a gravação sobre a versão antiga não altera linha e mantém a do colega, que a versão atual é aceita, que o cliente não consegue voltar a versão e que a auditoria não registra `updated_at`. Duas mutações da migração (sem o gatilho em `risk_rules` e sem o `CHECK` de `pipelines`) reprovam o teste;
    - tipos regenerados (`updated_at` nas três tabelas) e fixture E2E com `updated_at` nas regras. E2E novo `tests/browser/concurrency.spec.ts`: edição concorrente de contato (conflito, rascunho mantido, filtro pela versão lida e reabertura com a versão do colega) e de empresa, conclusão concorrente na ficha 360 com reabertura da versão atual, etapa e regra concorrentes em Configurações, e Pipeline e Hoje mostrando a mudança do colega ao voltar para a aba depois de 30 s, sem recarregar antes nem enquanto a pessoa fica na aba (relógio do Playwright). Sem `refetchOnWindowFocus`, esse cenário reprova;
    - `docs/INTEGRACOES-PENDENTES.md` e `docs/dono/AMBIENTE.md` citam a nova última migração da base, que a do receptor da Fecha IA precisa suceder no rebase, e a terceira migração pendente no projeto do dono;
    - suíte verde: 382 unitários (eram 367), 251 de banco (eram 234) e 126 E2E (92 desktop e 34 mobile; eram 121), mais `format:check`, `docs:links`, `lint:ci` (0 erros e 9 avisos), `typecheck`, `gen:types:check` e `build`.
  - **Pendências:**
    - a guarda é cooperativa, como nas demais tabelas: vale para as telas do CRM, e a API direta continua aceitando um `UPDATE` sem o filtro de versão;
    - ficam fora da guarda mover a oportunidade de etapa pela RPC `move_deal` (vale a última movimentação, registrada no histórico) e os nomes da organização (`organizations` não tem `updated_at`) e do perfil (cada pessoa edita só o seu);
    - quem fica na aba vê a última leitura até voltar a ela ou salvar algo: o `refetchInterval` saiu pelo corte do roteiro, e o tempo real fica para 3.9, por demanda. Configurações, Financeiro, Automações, Modelos e Relatórios mantêm o padrão do app, sem recarregar no foco;
    - reordenar ou arquivar etapas (2B.5) grava várias etapas de uma vez e precisa conferir a versão de cada uma (registrado no 2B.5);
    - a migração só foi aplicada no PostgreSQL 17 local do `test:db` e do `gen:types`, não num projeto Supabase.
- [x] **0.9 Avisos e rotas (P).**
  - Banner offline honesto, que desabilita salvar.
  - `RequireRole` nas rotas administrativas.
  - Retorno ao deep link depois do login.
  - `?create=1` que funciona.
  - NotFound apontando para `/dashboard`.
  - **Feito em 11/10/2026:**
    - sem conexão: o banner do `OfflineDetector` diz "Sem conexão. As alterações não serão salvas até a conexão voltar." e não promete mais sincronização. Com `navigator.onLine === false`, o fetch do cliente Supabase (`createSupabaseFetch`) recusa a requisição na hora com `OfflineRequestError` (`src/lib/offline.ts`), antes de chegar à rede, inclusive no Auth. `errorMessage`, `relationshipError` e Configurações mostram "Sem conexão com a internet. Nada foi salvo nem enviado; tente novamente quando a conexão voltar.", sem o prefixo que o PostgREST acrescenta, e o formulário continua preenchido. Na tela de entrada (entrar, cadastrar, link por e-mail e recuperar senha), `authErrorMessage` troca essa mensagem, pensada para gravações, por "Sem conexão com a internet. Conecte-se e tente de novo."; a redefinição de senha mantém a de gravação, que vale para salvar a nova senha. Decisão: "desabilita salvar" virou a falha imediata com mensagem clara, como pede a especificação, em vez de desabilitar cada botão de salvar; nada fica guardado para enviar depois;
    - `RequireRole` (`src/components/layout/RequireRole.tsx`) troca a página por uma tela explicativa (`PageScaffold` e `EmptyState`, com o papel da pessoa, a indicação de que a Equipe mostra os donos e administradores, e "Ir para Hoje"), sem carregar a página. Rota por rota: `/settings/integrations` fica com quem edita, porque o papel somente leitura não importa nem exporta. Ficam abertas em modo leitura, por serem úteis: `/team` (a lista de membros com o papel de cada um mostra a quem pedir outro acesso; convidar, revogar convites e alterar papéis continuam com donos e administradores, e só eles leem os convites, que antes a tela lia para todos sem mostrar), `/settings` (Meu perfil e Preferências são de cada pessoa; funis, etapas e regras da fila para consulta), `/automations` (regras e execuções explicam as tarefas criadas sozinhas) e `/settings/security` (encerrar as próprias sessões; o histórico já era só de gestores). Na revisão, `/team` saiu da guarda: atrás dela, colaboradores e leitores perdiam o único quadro da equipe com os papéis, justamente o que a tela explicativa manda procurar. Papéis, rótulos e os grupos `EDITOR_ROLES` e `MANAGER_ROLES` ficam em `src/lib/roles.ts`, usados por `useCrmPermissions` e pela Equipe. `useCrmPermissions` ganhou `refresh` e `refreshing`: o "Tentar novamente" da guarda mostra "Verificando…" e não aceita outro clique durante a nova leitura;
    - deep link: sem sessão, o `AppLayout` leva a `/?next=<caminho e consulta>` com `replace`. `safeNextPath` e `authPath` (`src/lib/next-path.ts`) só aceitam caminhos internos com uma única `/` no início, antes e depois de normalizar: recusam `//`, `/\`, segmentos de ponto que viram `//outro-site` (`/.//outro-site`, `/..//outro-site`, `/%2e//outro-site`; achado da revisão, que levava "Continuar no meu CRM" a outro site), URLs absolutas, caracteres de controle e a própria tela de entrada. O login com senha volta ao destino com `replace`; o link por e-mail (acesso sem senha e confirmação de cadastro) leva `?next=` junto com o `?invite=`; com convite, o destino passa por `/invite?invite=…&next=…`, e o aceite (`WorkspaceSetup`) e "Continuar no meu CRM" (`InvitationStatus`) seguem para ele. Destino inválido vira Hoje. Decisão da revisão: Sair da conta e Encerrar todas as sessões (agora pelo `signOut` do `AuthContext`, com `scope`) marcam `signedOut`, e o `AppLayout` leva ao login sem `?next=`; num computador compartilhado, quem entra em seguida abre Hoje, e não a tela nem a busca de quem saiu. Sessão expirada e link aberto sem sessão continuam guardando o destino;
    - `?create=1`: Pipeline e Financeiro derivam a abertura do formulário da URL, como `?action=new` em Contatos e Tarefas. O efeito que consumia o parâmetro falhava porque o `RouteTransition` monta a tela escondida antes de mostrá-la, e essa instância consumia o pedido; o E2E novo reprovava antes da correção. Os botões de criar usam o mesmo parâmetro, fechar o formulário o tira e, depois de salvar, `?create=1` vira `?deal=` ou `?payment=` numa única navegação, porque o `setSearchParams` do React Router parte dos parâmetros da renderização e duas chamadas seguidas perderiam a primeira. Sem permissão ou sem etapas, o aviso continua e o parâmetro sai. Depois de aberto, o formulário só fecha pela URL (`useCreateFromUrl`, em `src/hooks/useCreateFromUrl.ts`): se uma releitura do papel falhar com ele aberto, o preenchimento fica, e falha ao ler o papel não vira o aviso de somente leitura;
    - NotFound: o link "Ir para Hoje" leva a `/dashboard` (antes o botão "Dashboard" levava à tela de entrada). É um link, como na tela explicativa, para leitores de tela e para abrir em outra aba;
    - `useCrmOnboarding`: `loading` só fica verdadeiro com a consulta habilitada, sem "Verificando registros…" eterno sem pessoa ou organização;
    - Ajuda com três perguntas (Integrações para quem não edita, internet caindo e link aberto antes de entrar), README com a seção "Rotas, papéis e conexão", o guia de publicação com o retorno de `?invite=` e `?next=` no link por e-mail, e o README dos tours avisando que o tour `integrations` só funciona para quem edita;
    - testes: Vitest novos em `src/lib/offline.test.ts`, `src/integrations/supabase/client.test.ts` (recusa sem chamar a rede, gravação e login pelo cliente real falhando com a mensagem e voltando com a conexão), `src/lib/next-path.test.ts` (inclusive segmentos de ponto e uma varredura de combinações), `src/components/layout/AppLayout.test.tsx`, `src/components/layout/RequireRole.test.tsx`, `src/hooks/useCreateFromUrl.test.ts`, `src/pages/Login.test.tsx` (inclusive a mensagem sem conexão), `src/pages/InvitationStatus.test.tsx`, `src/pages/NotFound.test.tsx` e `src/components/OfflineDetector.test.tsx`, além de `AuthContext.test.tsx` (saída pedida, `scope` e sessão perdida sem Sair), `WorkspaceSetup.test.tsx`, `useCrmOnboarding.test.ts` e `Settings.test.tsx` (gravação sem conexão) ampliados. E2E novo `tests/browser/routes.spec.ts`: `?create=1` do Pipeline pela ação rápida de Hoje e do Pipeline e do Financeiro por navegação dentro do app, viewer na tela explicativa de Integrações, na Equipe em modo leitura sem ler convites e nas demais telas abertas em modo leitura, colaborador na Equipe em modo leitura e em Integrações, deep link `/pipeline?deal=X` sem sessão voltando ao destino depois do login sem o login no histórico, `?next=` para outro site ignorado (inclusive com segmentos de ponto e no convite), Sair e entrar de novo abrindo Hoje, offline com o banner e a gravação recusada sem requisição, e NotFound levando a Hoje. A fixture ganhou `signedIn: false`, e o cenário de Integrações do viewer em `csv.spec.ts` passou a esperar a tela explicativa. Mutações conferidas (sem a recusa offline, login sem `replace`, sem ler ou sem validar `next`, `safeNextPath` sem validar depois de normalizar, `AppLayout` sem `next` ou guardando `next` depois do Sair, `signedOut` sem marcar, sem limpar na falha ou sem limpar na nova entrada, aceite de convite sem `next`, `loading` sem `enabled`, `errorMessage`, Configurações e login sem o mapeamento, formulário de `?create=1` sem a trava, "Tentar novamente" da guarda sem bloqueio e a guarda liberada para todos os papéis) reprovam os testes;
    - suíte verde: 468 unitários (eram 382), 251 de banco (sem mudança de schema) e 135 E2E (101 desktop e 34 mobile; eram 126), mais `format:check`, `docs:links`, `lint:ci` (0 erros e 9 avisos), `typecheck`, `gen:types:check` e `build`.
  - **Pendências:**
    - o menu lateral, a navegação do celular, a busca global e o catálogo de tours da Ajuda (`TourHelpCatalog`) continuam listando Integrações para todos os papéis; quem tem acesso somente leitura chega à tela explicativa (pelo catálogo, com o disparador do tour desabilitado). Esconder ou marcar essas entradas cabe na fonte única de navegação, adiada para o 2B.12 pela crítica do roteiro (registrado no 2B.12);
    - a guarda orienta, não protege: a RLS ainda deixa qualquer membro ler os convites pela API (a Equipe só os lê para donos e administradores), e a leitura restrita a gestores é do item 1.1;
    - o Sair vale para a aba em que foi pedido: outra aba aberta perde a sessão como numa expiração e guarda a própria tela em `?next=`;
    - a falta de conexão só é reconhecida por `navigator.onLine`. Uma rede sem internet de verdade (portal cativo, servidor fora do ar) não liga o banner, e a gravação falha (ou demora) pela rede, com a mensagem de erro de cada tela. Enquanto o navegador está sem conexão, o React Query pausa as leituras: as telas já abertas mostram a última leitura, e uma tela ainda não aberta pode não carregar até a conexão voltar;
    - o link por e-mail passou a levar `?next=`, além do `?invite=` que já levava. O Auth aceita o retorno porque o host é o mesmo do Site URL; a configuração versionada do Auth (1.3) precisa manter isso (registrado no 1.3);
    - o comportamento offline foi verificado com a emulação de rede do Chromium no Playwright, não em celulares reais.
- [x] **0.10 Desempenho mínimo no cliente (M).**
  - Índices `Map` em vez de O(n×m).
  - Fila de atenção agrupando contatos importados.
  - Invalidação por chave.
  - Kanban com bloqueio por card.
  - Gerador de fixture sintética volumosa, que também gera o `seed-demo`.
  - **Feito em 11/10/2026:**
    - índices `Map` por id e por `contact_id`, `company_id` e `deal_id` (`relationshipIndex`, em `src/lib/contact-model.ts`), montados uma vez por snapshot e guardados enquanto ele não muda (um array trocado ou com outro tamanho refaz o índice). `relatedData`, `attentionQueue` e `activityLinks` passaram a usá-los, com custo O(n + m); o recorte "Minha rotina" de Hoje, que fazia um `find` por item da fila, entrou na própria `attentionQueue` (`audience` e `userId`); o diretório busca empresa e responsável por `Map` e ordena com um único `Intl.Collator` (`compareNamesPtBR`, o mesmo resultado de `localeCompare` com as mesmas opções); o kanban agrupa os cards por etapa numa passada e acha o responsável por `Map`; a lista de atividades e a linha do tempo da ficha 360 acham o responsável pelo índice;
    - fila de atenção: com mais de 10 contatos sem próxima ação (`NO_NEXT_ACTION_GROUP_ABOVE`), um único item "N contatos sem próxima ação" com o link "Ver contatos sem próxima ação" para `/contacts?scope=no-action`; contatos cadastrados há menos de 1 dia ficam fora da regra `no_next_action` (`NEW_CONTACT_GRACE_MS`). Em "Minha rotina", a contagem é dos contatos da pessoa. A explicação do item diz o que o filtro de Contatos lista além da contagem: encerrados, cadastrados nas últimas 24 horas e, em "Minha rotina", os de toda a equipe. O Copiloto inclui o item agrupado na pergunta "O que falta nos contatos?", e a Ajuda ganhou a pergunta "Por que a fila mostra 'N contatos sem próxima ação' num item só?";
    - leitura paginada do snapshot (`readCrmPages`): a primeira página de 1000 linhas (o limite padrão de linhas por resposta do Supabase) traz o total (`count: 'exact'`), e as demais são buscadas em paralelo, até 4 por tabela, juntadas na ordem das páginas e sem repetir ids. Cada página depois da primeira começa na última linha da anterior (sobreposição de uma linha) e precisa começar numa linha já lida: com páginas lidas fora de ordem, uma linha criada na faixa de uma página empurra a última dela para a seguinte, já lida, e ela sumiria sem a contagem perceber, porque a linha nova compensa a perdida. Um servidor com limite de linhas menor que a página não corta a lista, com ou sem contagem (o tamanho entregue vira o passo), uma última página cheia pede a seguinte (linhas criadas durante a leitura), e uma leitura descontínua ou com menos linhas que o total (exclusões durante a leitura) é refeita uma vez e, se continuar incompleta, falha com `IncompleteReadError` e a mensagem de erro da tela, em vez de mostrar a lista cortada. Sem contagem do servidor, segue página a página até uma menor que o passo;
    - invalidação por chave (`src/lib/crm-cache.ts`): `CRM_QUERY_READS` diz quais tabelas cada consulta `['crm', orgId, <consulta>, …]` lê, `CRM_WRITE_SIDE_EFFECTS` diz o que o banco altera junto (histórico de etapas, tarefas e registros das automações, `ON DELETE SET NULL` e a auditoria), e `invalidateCrmTables` recarrega só as consultas afetadas. Atividades (Hoje, Agenda, Atividades, Tarefas e ficha 360), contatos e empresas, oportunidades, recebimentos, modelos, automações e a importação de contatos deixaram de invalidar `['crm']` inteiro; Configurações e Equipe continuam invalidando tudo, porque gravam em tabelas diferentes conforme a ação e mudam papéis, funis, etapas e nomes lidos por quase todas as telas. "Atualizar" e "Tentar novamente" do Pipeline e do Financeiro recarregam só as consultas da tela. A regra para quem personaliza está no README ("Desempenho com volume"), e `crm-cache.test.ts` falha se uma chave usada no código não estiver declarada;
    - kanban: `useDealMoves` (`src/components/pipeline/useDealMoves.ts`) trava só a oportunidade em movimentação (`Set<dealId>`; o `DealBoard` recebe `movingIds`, o card travado fica com `aria-busy`, o título do menu diz que está salvando, e um único aviso para leitor de tela, sempre montado no quadro, troca só o texto), troca a etapa na hora no cache (`optimisticDealMove`, com as regras de `validate_deal_change`: probabilidade, fechamento, motivo da perda e entrada na etapa), substitui a linha pela devolvida por `move_deal` (`isMovedDeal`), inclusive a versão, e numa falha devolve só aquele card à etapa de origem, sem tocar nos outros, e relê a lista de oportunidades, porque a gravação pode ter sido feita e só a resposta se perdido (a releitura espera as outras movimentações em andamento, para não trazer a etapa antiga de um card ainda não confirmado). A trava sai quando o banco responde: com sucesso, a lista de oportunidades não é relida, e o histórico, as próximas ações (que uma automação pode criar) e o snapshot recarregam em segundo plano. O card é montado de novo na coluna de destino e o menu fica desabilitado enquanto salva; para o foco não cair no body, ele volta para o título do card. Arrastar, o menu "Mover" e a perda pelo diálogo usam o mesmo caminho; "Nova oportunidade" não fica mais desabilitado durante uma movimentação, e a Ajuda descreve a movimentação otimista;
    - gerador versionado `scripts/lib/volume-data.mjs` (JavaScript puro, com tipos em `volume-data.d.mts`): 1 mil empresas, 5 mil contatos, 2 mil oportunidades e 15 mil atividades com semente fixa, nomes de listas fixas, e-mails e sites em `example.test`, telefones fictícios e as restrições do schema respeitadas; 10% dos contatos cadastrados nas últimas 24 horas e 30% há 2 ou 3 dias, sem atividades, como depois de importações. `withVolume` (`tests/browser/fixture.ts`) o injeta na fixture do Playwright, e o seed de demonstração (1.15) deve partir dele;
    - `performance.mark('screen-ready', { detail: { screen } })` em Hoje, Contatos e Empresas quando terminam de renderizar os dados (`useScreenReady`), uma vez por montagem visível: na navegação dentro do app, a montagem escondida do `RouteTransition` (que só busca os dados) não marca (`HiddenScreenContext`);
    - `npm run test:perf` (`playwright.perf.config.ts`, `scripts/perf-server.mjs` e `tests/perf/screens.perf.ts`), fora do `test:e2e` e do CI: build de produção em `dist-perf/` servido pelo `vite preview` na porta 8097, volume na fixture do E2E servida por HTTP na porta 54339 (`httpPort`, com `memoizeReads`, que guarda a leitura filtrada e ordenada para as páginas seguintes), CPU 4x mais lenta por `Emulation.setCPUThrottlingRate`, 10 aberturas por tela em contextos novos, do início da navegação até `screen-ready`, com o resultado em `test-results/perf/resultado.json`. **Resultado medido em 11/10/2026, num desktop Windows 11 de desenvolvimento (AMD Ryzen 5 5500, 16 GB), compartilhado com outras sessões de trabalho: em três execuções seguidas do `test:perf` antes da revisão, Hoje com p95 de 1.183 a 1.199 ms (p50 de 1.138 a 1.146 ms) e Contatos com p95 de 1.202 a 1.247 ms (p50 de 1.165 a 1.168 ms); na execução da revisão, Hoje com p95 de 1.295 ms e Contatos com 1.257 ms; e em quatro execuções depois das correções da revisão (páginas sobrepostas), Hoje com p95 de 1.243 a 1.472 ms e Contatos com 1.267 a 1.569 ms em três, com a meta de 2 s cumprida. Na outra, a primeira delas, logo depois da suíte E2E e com a máquina ocupada, Contatos teve p95 de 2.668 ms (duas aberturas acima de 2 s, 2.210 e 2.668 ms, e as outras oito entre 1.394 e 1.737 ms) e o comando falhou.** A variação vem principalmente da carga da máquina: a leitura anterior e a nova, com páginas sobrepostas, medidas uma logo depois da outra, deram Hoje com p95 de 1.236 e 1.243 ms (p50 de 1.143 e 1.160 ms) e Contatos com 1.197 e 1.267 ms (p50 de 1.162 e 1.182 ms), diferença dentro da oscilação entre execuções. Para o número de referência do 2B.13, conte com p95 entre 1,2 e 1,6 s nessa máquina, e acima de 2 s quando ela está carregada. A mesma medição sobre o código anterior (commit `1355bc5`, só com a marca acrescentada, 3 aberturas por tela) deu de 27,2 a 34,1 s em Hoje e de 22,4 a 26,3 s em Contatos. Decisão durante a medição: a primeira versão do benchmark servia a fixture por `page.route`, e o p95 das mesmas telas oscilava entre 1,4 e 4,0 s conforme a carga da máquina (em quatro de sete execuções completas, alguma tela passou de 2 s). Um perfil de CPU mostrou que o tempo extra vinha da interceptação, que passa cada resposta pelo protocolo do DevTools, e não do código do CRM (o processamento dos dados no navegador ficava em cerca de 300 ms); por isso o benchmark passou a servir a mesma fixture por HTTP. Páginas de 1000 linhas e mais páginas simultâneas não mudaram o tempo de forma mensurável nesse ambiente: ficaram 1000 linhas, que reduzem as idas e voltas num Supabase real, e 4 por tabela;
    - testes: `src/lib/volume-parity.test.ts` guarda as versões lineares anteriores de `relatedData`, `attentionQueue` (com o filtro antigo de "Minha rotina") e `activityLinks` e confere o mesmo resultado, na mesma ordem, para cada contato e empresa do volume e para casos de borda (id repetido em objetos diferentes, o mesmo objeto duas vezes, datas inválidas, id vazio ou inexistente); confere também o agrupamento e a carência sobre o volume inteiro e que a fila e os vínculos do diretório inteiro levam menos de 1 s no Node (as versões lineares levam segundos). Novos: `crm-cache.test.ts`, `useDealMoves.test.tsx` (atualização otimista antes da resposta, trava por card, segundo movimento ignorado, outro card livre, reconciliação, reversão em erro e em exceção, releitura da lista depois da falha, adiada enquanto outra movimentação está em andamento, e resposta inesperada relendo a lista), `useScreenReady.test.ts` (inclusive a montagem escondida do `RouteTransition`, que não marca) e `scripts/lib/volume-data.test.mjs` (contagens, determinismo, integridade, restrições do schema e perfil do volume); ampliados: `useCrmSnapshot.test.ts` (páginas de 1000 linhas sobrepostas em uma linha, páginas paralelas, limite de simultaneidade, limite do servidor com e sem contagem, linha criada e linha excluída durante a leitura, página lida fora de ordem com uma ou duas linhas criadas na faixa dela, leitura incompleta, servidor sem contagem e listas curtas sem contagem), `activity-logic.test.ts` (agrupamento a partir de 11, carência de 1 dia, "Minha rotina" e o aviso do item sobre o filtro de Contatos), `deal-logic.test.ts`, `DealBoard.test.tsx` (aviso para leitor de tela sempre montado, título do menu travado e foco devolvido ao card na coluna de destino), `copilot-evidence.test.ts`, `RecordEditor.test.tsx` e `Relationship360.test.tsx` (recarga por chave depois do conflito). Nove mutações (sem ordenar as posições do índice, sem atualização otimista, sem reverter, sem a carência, páginas sequenciais, lista incompleta aceita, sem conferir a sobreposição das páginas, sem devolver o foco e sem reler a lista depois da falha) reprovam os testes. E2E novo `tests/browser/volume.spec.ts`: card movido antes da resposta do banco, só ele travado, com o foco devolvido a ele na coluna de destino e o aviso para leitor de tela, e outro card movido ao mesmo tempo, lista de oportunidades e referências não relidas e edição seguinte sem falso conflito; falha devolvendo o card; movimentação gravada com a resposta perdida (`loseNextWriteResponse` passou a valer para `move_deal` na fixture), com a lista relida, o card na etapa do banco e a edição seguinte sem falso conflito; Hoje com "12 contatos sem próxima ação", sem os importados há 1 hora, levando ao diretório filtrado, com uma única marca `screen-ready` de Contatos na navegação interna; e Contatos com 2.201 registros lidos em páginas paralelas de 1000 linhas (offsets 0, 999 e 1998), busca pela última página e a marca `screen-ready`;
    - suíte verde: 516 unitários (eram 468), 251 de banco (sem mudança de schema) e 140 E2E (106 desktop e 34 mobile; eram 135), mais `test:perf` (ver a ressalva da execução com a máquina carregada), `format:check`, `docs:links`, `lint:ci` (0 erros e 9 avisos), `typecheck`, `gen:types:check` e `build`.
  - **Pendências:**
    - a medida é do cliente: a fixture é servida localmente, sem a latência de rede, a RLS e o `count: 'exact'` de um Supabase real. Numa instância real, o snapshot com 15 mil atividades faz 16 leituras de atividades (4 por vez, mais os preflights de CORS), e o tempo cresce com a latência. Reduzir o snapshot a atividades pendentes mais uma janela recente e levar o diretório e o kanban para o servidor continua no 2B.13;
    - medido numa máquina de desenvolvimento, não no CI: o `test:perf` ficou fora do CI pelos minutos do plano Free, e o resultado oscila com a carga da máquina (uma das execuções passou de 2 s em Contatos). Rodá-lo no job noturno, sem bloquear, é decisão do `@devops`;
    - com gravações em massa durante a leitura (por exemplo, a importação de um colega), páginas paralelas lidas fora de ordem podem não começar numa linha já lida, e a leitura é refeita; se falhar duas vezes, o React Query repete a consulta (3 vezes, com espera crescente) antes de mostrar a mensagem de erro, em vez de uma lista cortada;
    - em "Minha rotina", o item agrupado conta só os contatos da pessoa, mas o link abre o filtro "Sem próxima ação" de toda a equipe, porque o diretório não combina "Minha carteira" com "Sem próxima ação". O filtro do diretório também inclui encerrados e cadastrados nas últimas 24 horas, que a fila não conta. A explicação do item e a Ajuda avisam as duas diferenças; combinar filtros cabe no 2B.2;
    - gravar oportunidade ou atividade também recarrega a evidência do guia inicial (7 leituras pequenas), que lê essas tabelas; Configurações e Equipe ainda invalidam `['crm']` inteiro;
    - mover de etapa continua fora da guarda de `updated_at` (vale a última movimentação, como antes): a trava por card evita dois movimentos da mesma pessoa, não os de colegas;
    - o `supabase/seed-demo.sql` (1.15) ainda precisa transformar as linhas do gerador em SQL, com a trava de instância vazia.

**Saída da F0:**

- CI verde.
- Regressões cobertas: dinheiro, CSV, fechamento, probabilidade, exclusões, concorrência e rotas.
- Benchmark com 5 mil contatos abaixo de 2 s no p95, medido sobre build de produção (`npm run test:perf`, desde o 0.10).
- `grep` pelo ref do dono e por caminhos de macOS sem resultado nos documentos distribuídos.

**Estado em 11/10/2026: F0 concluída localmente** na branch `chore/f0-base-confiavel`, com tudo verde no conjunto final:

- `format:check`, `docs:links`, `typecheck`, `gen:types:check`, `lint:ci` (0 erros, 9 avisos) e `build`;
- 516 testes unitários, contra 190 antes da F0;
- 251 verificações de banco, contra 149;
- 140 cenários E2E, contra 106;
- benchmark com p95 entre 1,2 e 1,6 s, contra 22 a 34 s antes.

Pendências que dependem de `@devops`:

- push da branch e da tag `legacy-archive`, e a primeira execução do CI no GitHub;
- aplicação das três migrações novas (0.6, 0.7 e 0.8) no projeto de desenvolvimento. Em 12/10/2026, o histórico remoto mostrou duas migrações aplicadas em 08/09 que não estão no repositório (Instagram e entrada genérica de leads), e por isso `npx supabase db push` recusa até que se decida o destino delas. Elas não tocam nos objetos que a F0 altera. Detalhes em [`docs/dono/AMBIENTE.md`](dono/AMBIENTE.md#consulta-direta-de-12102026).

## F1 — Lançamento para alunos (v1.0)

**Implantabilidade e segurança da instância:**

- [ ] **1.1 Empresa única com entrada só por convite (G).** Desenho final com `@architect`.
  - Primeiro dono (D6): enquanto a instância não tem empresa, o primeiro cadastro cria a empresa e vira dono. `create_workspace` usa `pg_advisory_xact_lock` para que dois cadastros simultâneos não criem duas empresas e, depois disso, recusa sempre.
  - O guia manda fazer o primeiro cadastro logo depois de publicar, porque quem chegar antes vira dono. Se isso acontecer, o break-glass por SQL devolve o papel de dono.
  - Gate de cadastro depois da empresa criada: só e-mail convidado. Usar o hook "Before User Created", se estiver disponível no Free, ou um trigger.
  - `instance_status()` para a tela de entrada.
  - `create_invitation` corrige o convite expirado que bloqueia um novo convite e impede admin de criar convite de dono.
  - Leitura de convites restrita a gestores.
  - Mensagens do Auth em pt-BR.
  - Link "Recebi um convite" sempre visível.
  - Break-glass documentado para o dono recuperar o acesso.
  - Manter a RLS por organização como defesa em profundidade.
- [ ] **1.2 Desativar membro e transferir a carteira (M).**
  - `user_roles.deactivated_at` e `current_org()` exigindo papel ativo.
  - Destinatário obrigatório para oportunidades abertas e tarefas pendentes.
  - Último dono protegido.
  - Tela "Seu acesso foi encerrado".
- [ ] **1.3 Configuração reproduzível da instância (M).**
  - `supabase/config.toml` completo com `env()`: URLs, confirmação, senha mínima, SMTP e rate limit de e-mail dimensionado para convites.
  - `config.toml` mantém o retorno do link por e-mail à raiz com `?invite=` e `?next=` (desde o 0.9): Site URL na mesma origem ou, numa lista de destinos exata, a raiz com consulta.
  - Templates de e-mail do Auth em pt-BR versionados.
  - Cabeçalhos de segurança (CSP, HSTS e frame-ancestors) verificados por teste.
  - Aposentar `VITE_CRM_ENVIRONMENT`.
  - Vercel (D2) com `npm ci` (D1). O guia avisa que o plano Hobby é só para uso não comercial e que a instância de uma empresa real precisa do plano Pro.
- [ ] **1.4 Guia de implantação ensaiado (G).**
  - `docs/IMPLANTACAO.md`, com Windows primeiro. Cobre Supabase na conta da empresa, migrações pela CLI, Auth, SMTP (com domínio próprio, ou Gmail com senha de app para times pequenos), hospedagem, primeiro dono, checklist e solução de problemas.
  - `verify-instance` com `instance-check.sql`.
  - Ensaio por uma pessoa não desenvolvedora, em Windows e em macOS.
- [ ] **1.5 Plano e backup sem serviço pago (M).**
  - Tabela de decisão Free × Pro: dados reais pedem Pro na conta da empresa.
  - Workflow modelo de `supabase db dump`, desligado por padrão.
  - Restauração ensaiada.
- [ ] **1.6 Identidade da empresa por configuração (P).** Nome, slogan, logos, favicon, título e nomes de arquivos exportados por variáveis e por `public/brand/`, sem editar código. O padrão é a marca do programa. Crédito discreto "feito com Empreende IA" no login e no rodapé, controlado por `VITE_SHOW_BASE_CREDIT`: ligado por padrão e removível em SaaS revendido com marca própria (D3 e D4).
- [ ] **1.7a Distribuição antecipada (P).**
  - Repositório de distribuição com histórico novo.
  - `release-dist` por allowlist.
  - CI que barra vazamento de documentos do dono.
  - Termo de beta.
- [ ] **1.7b Licença, versões e atualização (M).**
  - LICENSE de código-fonte disponível e restritiva (D4). Quem comprou o programa pode usar, modificar, implantar para clientes e revender como SaaS, desde que troque a marca. Não pode redistribuir o código-fonte a quem não comprou. Sem garantia. Revisão por advogado recomendada antes da liberação ampla.
  - Tags SemVer, CHANGELOG e `docs/ATUALIZACAO.md` (upstream mais migrações aditivas).
- [ ] **1.8 Regras para IA e guia de personalização (M).**
  - `AGENTS.md` e `CLAUDE.md` com o mapa de camadas e os invariantes: RLS, FK composta, migração só como arquivo novo e nunca chave privilegiada em `VITE_`.
  - `docs/PERSONALIZAR/`: como adicionar campo, entidade e tela.
  - Revoke dos privilégios padrão, para que uma tabela nova sem RLS não fique exposta.
  - Spike de 2 dias do caminho Lovable com Supabase externo.
- [ ] **1.13 Proteção de atualização (P/M).** Manifesto das funções e policies da base (`base-manifest`), ganchos `private.custom_*` e `db-drift-check`. Precisa vir antes da primeira versão que recriar funções centrais, ou seja, antes da F2A.

**Uso no dia a dia:**

- [ ] **1.9 Canais nível 1 com registro (M/G).**
  - WhatsApp por `wa.me` com modelo preenchido; número fixo mostra aviso e não é bloqueado.
  - E-mail por menu com "Abrir no Gmail", "Abrir no Outlook web" e `mailto`.
  - Telefone com `tel:`, "Copiar número" e "Registrar ligação" com resultado (atendeu, não atendeu, caixa postal).
  - Modelos com variáveis.
  - Tipos `whatsapp` e `visit`.
  - "Concluir e agendar a próxima".
  - Coluna `do_not_contact` bloqueando os botões.
- [ ] **1.10 LGPD da empresa controladora (M).**
  - Base legal e consentimento preenchidos pelo servidor.
  - "Não contatar".
  - `anonymize_contact`, que limpa também os títulos de atividades, oportunidades e recebimentos.
  - "Exportar dados deste contato".
  - `docs/LGPD-INSTANCIA.md` com modelos de aviso de privacidade e de termo entre aluno e cliente.
- [ ] **1.11 Importação de planilha, corte mínimo (P/M).**
  - Sinônimos de cabeçalho em pt-BR e modelo para baixar.
  - Até cerca de 5 mil linhas.
  - Colunas `responsavel` e `origem`, mais a opção "Distribuir igualmente entre" membros.
  - Fixture sintética versionada (o gerador `scripts/lib/volume-data.mjs` existe desde o 0.10).
- [ ] **1.12 Lembretes no app (P).** Badge de atividades vencidas e próximas no menu, desktop e mobile.
- [ ] **1.14 Gestão mínima e cadastro básico (P).**
  - Filtro por vendedor específico em Hoje, Atividades e Agenda.
  - "Ganhos por responsável" em Relatórios.
  - Origem do lead (WhatsApp, telefone, e-mail, site, indicação), cargo e observações no cadastro, aproveitando colunas que já existem.
- [ ] **1.15 Seed de demonstração (P).** `supabase/seed-demo.sql`, que só roda numa instância vazia, para aulas e para o beta. Partir do gerador `scripts/lib/volume-data.mjs` (0.10), com quantidades menores e as datas relativas ao momento da execução.
- [ ] **1.16 Catálogo de produtos e serviços com itens na oportunidade (G).** Incluído no lançamento pela D14.
  - Tabela `products`: nome, código, tipo (produto ou serviço), unidade, preço, cobrança única ou mensal, ativo/arquivado. RLS por organização e FK composta.
  - Tabela `deal_items`: produto (ou item avulso), quantidade, unidade, preço unitário, desconto por item em % ou R$, cobrança única ou mensal, e total da linha.
  - Valor da oportunidade calculado pelos itens: total único, mensalidade e valor do contrato (mensalidade × meses informados), com a guarda de concorrência em `updated_at`.
  - Oportunidade sem itens mantém o valor manual, como hoje.
  - Tela de catálogo em Configurações (só admin cria e edita; todos consultam) e editor de itens no formulário e no painel da oportunidade.
  - Importação de catálogo por planilha e exportação dos itens nos relatórios.
  - Testes: cálculo em `deal-logic`, RLS e totais no `test:db`, e E2E do editor de itens.

**Saída da F1:**

- `test:db`:
  - segunda empresa e cadastro sem convite são recusados;
  - membro desativado não lê nem grava;
  - anonimização testada.
- E2E desktop e mobile dos canais nível 1 e das telas de entrada.
- Ensaio real do guia até três marcos: primeiro login do dono, convite aceito e senha recuperada.
- `verify-instance` verde, backup restaurado e marca trocada sem editar código.
- `v1.0.0-rc.1` vai para um piloto de 2 semanas com uma empresa real.
- Métricas agregadas por `pilot-metrics.sql`:
  - pelo menos 70% dos usuários ativos em 4 de 5 dias;
  - pelo menos 80% das oportunidades abertas com próxima ação;
  - zero incidentes e zero bugs P1.
- Só então `v1.0.0` e a liberação ampla.

**Se for preciso encurtar mais**, adiar para a v1.1 os itens 1.12, 1.14 e 1.15 e as partes não essenciais de 0.8 e 0.9. O catálogo (1.16) é o maior item funcional do lançamento; se o prazo apertar, o corte possível é deixar a importação de catálogo para a v1.1. Nunca adiar 1.1, 1.2, 1.3, 1.4, 1.5 e 1.7: sem eles a instância não é segura nem implantável por terceiros.

## F2A — Times médios (gestão comercial)

- [ ] **2A.1 Relatórios de gestão (M/G).**
  - Vendas por mês de fechamento.
  - Ranking por vendedor: ganhos, taxa, ticket e ciclo.
  - RPC `report_activities`.
  - Funil de conversão, tempo por etapa e perdas por motivo.
- [ ] **2A.2 Times e papel de gestor (M/G).** Tabelas `teams` e `team_members`, o papel `manager` e a função SDR/closer em `profiles.sales_function`.
- [ ] **2A.3 Metas (M).** Por vendedor, time e empresa, com realizado calculado por `closed_at` e atividades.
- [ ] **2A.4 Distribuição de leads (M).** Rodízio entre membros ativos, por função ou time, aplicado na criação, na importação e na ação "Distribuir selecionados".
- [ ] **2A.5 Pré-vendas/SDR (M).** Mover oportunidade entre funis, campos obrigatórios por etapa e "Qualificar e enviar para vendas".
- [ ] **2A.6 Visibilidade por responsável (G).** Opcional por empresa: `all` (padrão), `own` ou `team`, com testes de RLS por modo.
- [ ] **2A.7 Notificações no app (M).** Sino com atribuição, lead distribuído, falha de automação e convite aceito.
  - `automation_logs` tem `SELECT` por coluna desde o 0.7: ler com `AUTOMATION_LOG_COLUMNS` (`select=*` é recusado) e o detalhe técnico só pela RPC `automation_log_errors`, para administradores.
- [ ] **2A.8 Ações em massa (M).** Atribuir, mudar status, criar tarefa, distribuir e exportar a seleção.
  - Decidir se mudar status em massa dispara automações. Para não disparar, ligar `crm.bulk_move` só na transação da RPC (`set_config('crm.bulk_move','on',true)`), reservada no 0.7.

Em paralelo à F2A, como candidato a `v1.x`, entra o **e-mail nível 2, parte a**: envio pelo CRM com o provedor da empresa e convite por e-mail (item 3.2a). Ele depende de 1.3, 1.7 e 1.10, não da F2B.

## F2B — Completude: dados, rotina e personalização

- [ ] **2B.1 Importação completa (M/G).** Assistente De>Para, empresas, oportunidades, atividades, XLSX, planilha de erros e desfazer lote.
- [ ] **2B.2 Cadastro flexível (G).**
  - Filtros por atributo.
  - Catálogos configuráveis: origens, motivos de perda e tipos.
  - Tags.
  - Campos personalizados: texto, número, data, lista e sim/não.
- [ ] **2B.3 Painel da oportunidade e timeline 360 unificada (M/G).**
  - Execuções de automação na timeline, inclusive as de automações excluídas (com `automation_name`): `automation_logs` tem `SELECT` por coluna desde o 0.7, então ler com `AUTOMATION_LOG_COLUMNS` (`select=*` é recusado).
- [ ] **2B.4 Rotina do vendedor (M).**
  - Adiar rápido.
  - Prazo de dia inteiro.
  - Agenda com tarefas e visão mês.
  - Local e link da reunião.
- [ ] **2B.5 Funis configuráveis (M).**
  - Arquivar etapa ou funil. Mover as oportunidades da etapa arquivada sem disparar automações, com `set_config('crm.bulk_move','on',true)` dentro da RPC (só na transação; reservado no 0.7). A pausa do 0.7 só acontece quando a etapa ou o funil do filtro deixam de existir; ao arquivar sem excluir, decidir o que fazer com as automações filtradas neles.
  - Trocar o funil padrão.
  - Reordenar. Reordenar e arquivar gravam várias etapas de uma vez: conferir a versão (`updated_at`, desde o 0.8) de cada etapa, de preferência numa RPC, para não desfazer a ordem salva por um colega.
  - Cor da etapa.
  - Alerta de oportunidade parada por etapa.
  - Modelos de funil por segmento.
- [ ] **2B.6 Busca e telefone (M).** Busca sem acento, indexada, com filtro por tipo e por dígitos do telefone.
- [ ] **2B.7 Exportação completa e auditada, e lixeira mínima (G).**
- [ ] **2B.8 LGPD completa (M/G).**
  - `consent_events`.
  - Solicitações do titular com prazo.
  - Anonimizar ex-membro.
  - Retenção da auditoria.
  - 2FA opcional para dono e admin.
- [ ] **2B.9 Qualidade do cadastro (G).**
  - Lead vira cliente ao ganhar.
  - Duplicados e mesclagem.
  - CNPJ e endereço com CEP.
- [ ] **2B.10 Automações úteis (M).** Escolher responsável e tipo; novos gatilhos (perdida, atividade concluída, contato criado).
- [ ] **2B.11 Copiloto por regras e código morto (P/M).**
- [ ] **2B.12 Ferramentas de quem personaliza (M/G).** `npm run setup`, registro de módulos e helper para nova tabela.
  - Fonte única de navegação para `AppRail`, `MobileBottomNav`, `CommandPalette` e o catálogo de tours da Ajuda (`TourHelpCatalog`), base do registro de módulos. Ela também deve esconder ou marcar as telas guardadas por `RequireRole` para o papel da pessoa (`/settings/integrations` desde o 0.9), hoje listadas para todos os papéis.
- [ ] **2B.13 Desempenho no servidor (G).** Só se o benchmark falhar ou alguma instância passar de 10 mil contatos. O benchmark do 0.10 mede só o cliente; antes de decidir, medir numa instância real, com a latência de rede.
- [ ] **2B.14 Financeiro ampliado (G).** Decidido na D13:
  - parcelas geradas a partir da oportunidade ganha, com quantidade e vencimentos mensais;
  - recorrência mensal até encerrar, aproveitando os itens mensais do catálogo (1.16);
  - forma de pagamento (Pix, boleto, cartão, transferência, dinheiro) e relatório de inadimplência por cliente;
  - comissão por vendedor sobre o valor efetivamente recebido, com percentual por vendedor ou por produto, em Relatórios.

  Continuam fora: emissão de boleto, Pix ou nota fiscal e conciliação bancária, que são papel de ERP ou sistema financeiro.
- [ ] **2B.15 Propostas com modelos (G).** Decidido na D14:
  - modelos de proposta para o usuário escolher, com logo da empresa da instância e logo do cliente;
  - dados do cliente, itens do catálogo, descontos, condições, validade e observações;
  - geração em PDF e numeração sequencial.

  Depende de 1.16 e do armazenamento de arquivos para os logos. A parte de Storage privado e upload de logo sai de 3.5 e vem para cá. Assinatura eletrônica e link de aceite ficam fora.

## F3 — Canais nível 2, serviços em segundo plano e opcionais

Tudo vem desligado por padrão, com credenciais e custos por conta de cada empresa, conforme [Integrações pendentes](INTEGRACOES-PENDENTES.md).

- [ ] **3.1 Jobs no servidor, fila de eventos e fuso horário (M/G).** Pré-requisito de 3.2b, 3.3 e dos gatilhos por tempo.
- [ ] **3.2b Resumo diário e lembretes por e-mail (M).**
- [ ] **3.3 WhatsApp oficial (G).** Cloud API ou BSP, caixa compartilhada e opt-in comprovável.
- [ ] **3.4 Fecha IA no modelo de instâncias (M/G).** O contrato passa a ter URL de destino por conexão, em vez de um CRM único. O PR #1 precisa das correções já documentadas e de migração renomeada.
- [ ] **3.5 Anexos (M).** Anexos em contatos, empresas, oportunidades e atividades, sobre o Storage privado criado em 2B.15.
- [ ] **3.6 PWA instalável e push (M).**
- [ ] **3.7 Agenda externa e IA no Copiloto (G).**
- [ ] **3.8 Formulários de captura e webhooks (G).**
- [ ] **3.9 Itens por demanda.** Forecast completo, atividades recorrentes, menções, cadências, relatórios salvos e histórico de valores, entre outros. Também a atualização em tempo real entre colegas (Supabase Realtime, que respeita a RLS); desde o 0.8, as telas de rotina e o Pipeline recarregam ao voltar para a aba.

## Decisões

Tomadas pelo dono do produto em 11/10/2026.

| # | Decisão | Escolha | Afeta |
| --- | --- | --- | --- |
| D1 | Gerenciador de pacotes | npm. A Vercel detecta `package-lock.json` e usa `npm ci`; `bun.lock` e `bun.lockb` saem | 0.1, 1.3 |
| D2 | Hospedagem recomendada no guia | Vercel. O guia avisa que o plano Hobby é só para uso não comercial; empresa real precisa do Pro | 1.3, 1.4 |
| D3 | Marca | Configurável, com crédito discreto "feito com Empreende IA", que pode ser removido quando o aluno revender como SaaS com marca própria | 1.6, 1.7b |
| D4 | Licença | Código-fonte disponível e restritiva: quem comprou o programa usa, modifica, implanta para clientes e pode revender como SaaS se trocar a marca; não pode redistribuir o código a quem não comprou; sem garantia. Revisão por advogado recomendada | 1.7b e liberação |
| D5 | Canal de distribuição | Repositório privado numa organização GitHub do programa, histórico novo, tags SemVer; o aluno clona e registra `upstream` | 1.7a, 1.4 |
| D6 | Primeiro dono | O primeiro cadastro cria a empresa e vira dono; depois, só por convite. O guia manda fazer o primeiro cadastro logo depois de publicar; break-glass por SQL | 1.1 |
| D7 | Valores digitados | Padrão brasileiro: "1.500,00" e "1.500" são aceitos; "12.5" continua 12,50 | 0.5 |
| D8 | Probabilidade | Acompanha a etapa por padrão, com valor manual opcional | 0.6 |
| D9 | Carteira ao desativar vendedor | Passar oportunidades abertas e tarefas pendentes é obrigatório; contatos e empresas ficam a critério do admin | 1.2 |
| D10 | E-mail compartilhado (contato@) | Avisa e permite salvar com confirmação; a importação continua juntando por e-mail | 2B.1, 2B.9 |
| D11 | Visibilidade da carteira | Configurável por empresa: todos veem tudo (padrão), cada um vê o seu ou vê o do seu time; gestores veem tudo | 2A.6 |
| D12 | SDR e closer | Função no perfil mais times, com um único papel novo: gestor comercial (`manager`) | 2A.2, 2A.4, 2A.5 |
| D13 | Financeiro | Parcelas, recorrência mensal, comissão por vendedor, forma de pagamento e inadimplência, na fase de completude | 2B.14 |
| D14 | Catálogo e propostas | Catálogo de produtos e serviços no lançamento (preço único ou mensal, desconto por item, quantidade e unidade); propostas com modelos e logos na fase de completude | 1.16, 2B.15 |

## Fora do escopo

- **Saem pelas premissas:**
  - planos, cobrança, trial e limites;
  - várias empresas por instância, seletor de empresas e conta em várias empresas (o aluno que revender como SaaS personaliza);
  - termos e DPA de operador SaaS;
  - telemetria central;
  - página de status e SLA do programa;
  - infraestrutura paga no ambiente do dono.
- **Mantido de propósito:** a RLS por `org_id` continua no schema. Removê-la teria custo alto, não ganharia segurança e quebraria as atualizações.
- **Saem por custo ou risco:**
  - modo offline real;
  - VoIP nativo;
  - sincronização da caixa Gmail/Outlook;
  - rastreio de abertura de e-mail;
  - agendador público;
  - multimoeda com conversão;
  - matriz de permissões customizável;
  - apps nativos;
  - WhatsApp por APIs não oficiais;
  - lead scoring opaco;
  - ERP e NFS-e;
  - BI customizável.

## Estimativa e riscos

O planejamento supôs 2 devs com uso intensivo de IA, PO em meio período, `@devops` e `@qa` parciais, mais 20% de reserva:

- caminho crítico até o `rc.1`: cerca de 10 semanas;
- `v1.0.0` em 3,5 a 4 meses;
- F2A e F2B: mais 6 a 7 meses.

O catálogo no lançamento (D14) acrescenta de 3 a 5 semanas-dev à F1, e essa conta ainda não está nos números acima.

Com implementação assistida por IA, o código anda mais rápido. O prazo passa a depender de quatro fatores que não são código:

- a revisão jurídica da licença;
- a confirmação das decisões de arquitetura com `@architect` (desenho final de 1.1, 1.2 e 1.16);
- o ensaio do guia com uma pessoa não desenvolvedora;
- o piloto de 2 semanas.

Riscos técnicos a validar cedo:

- o hook "Before User Created" no plano Free;
- a CSP com Radix e Supabase;
- os minutos do GitHub Actions;
- o limite de 2 projetos Free ativos para o ensaio de restauração.

## Como este roteiro foi feito

Em 11/10/2026, dois workflows multiagente analisaram só o código, sem alterá-lo:

1. **Inventário e comparação de mercado:**
   - inventário do banco, da interface e da documentação;
   - benchmark com 129 fontes de mercado (Pipedrive, HubSpot, Zoho, RD Station CRM, Agendor, Ploomes, Moskit e critérios G2/Capterra);
   - análise de lacunas em quatro categorias, com 124 lacunas e 36 achados extras, cada uma verificada adversarialmente contra o código.
2. **Implantabilidade e roteiro:**
   - análise de instalação, modo empresa única e personalização/atualização, com 68 achados verificados;
   - roteiro refeito sob as premissas;
   - crítica de completude, com 22 apontamentos já incorporados.

Os testes do projeto não foram executados nessa análise. As integrações externas seguem [Integrações pendentes](INTEGRACOES-PENDENTES.md).
