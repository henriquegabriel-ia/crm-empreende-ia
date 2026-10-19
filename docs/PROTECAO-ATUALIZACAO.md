# Personalizar sem quebrar a atualização

Este guia é para quem publicou um CRM a partir desta base e quer acrescentar regras, campos ou tabelas próprios da empresa sem perder as atualizações da base. Ele foi escrito para quem usa Windows; no macOS e no Linux os passos são os mesmos, com o terminal do sistema. O desenho técnico está em [docs/arquitetura/1.13.md](arquitetura/1.13.md), e a [Publicação](PUBLICACAO-CRM.md#personalizar-e-atualizar) aponta para cá.

São três peças:

1. **Ganchos** (`private.custom_*`): funções vazias da base, chamadas a cada gravação de contato, empresa, oportunidade e atividade. A regra da empresa entra no corpo de um gancho, sem editar nenhuma função da base.
2. **Conferência de drift** (`supabase/db-drift-check.sql`): uma consulta só de leitura, para colar no editor SQL do painel do Supabase, que compara o banco com o que a base entrega e lista o que foi alterado à mão, o que falta e o que foi acrescentado.
3. **Guarda das atualizações**: a partir das versões que recriam funções da base, uma atualização que apagaria uma alteração feita à mão para antes de aplicar e diz o que fazer.

## 1. O que a base promete

- **Os oito ganchos ficam.** A base cria cada gancho uma única vez e nunca o recria, troca ou remove. Um gancho novo, ou com outros argumentos, chega como função nova, com outro nome. O corpo que você escreveu num gancho nunca é tocado por uma atualização.
- **O prefixo `custom_` é seu.** A base nunca cria tabela, coluna, função, política, gatilho ou índice com esse prefixo (fora os ganchos). Um objeto seu com o prefixo nunca colide com um objeto de uma versão futura.
- **Migrações aditivas.** As migrações da base criam ou acrescentam; quando uma versão precisar remover uma coluna da base, as notas da versão avisam antes (o guia de atualização, item 1.7b do [roteiro](ROADMAP-FINALIZACAO.md), traz as notas).
- **Nada apagado em silêncio.** Toda migração da base que recria ou remove uma função, um gatilho ou uma política confere antes se o objeto está como a base o deixou. Se não estiver, a atualização para (seção 7). Um teste da base reprova a migração que esquece essa conferência quando o comando está escrito nela; o que uma migração recriar por SQL montado na hora (um laço de `execute format`) fica com a revisão de cada versão.
- **As suas migrações ficam fora das conferências da base.** Com o nome `<data e hora>_custom_<nome>.sql` (seção 4), o manifesto, o `npm run manifest:check`, o `npm test` e o `npm run test:db` conferem só as migrações da base, e o CI que você herdou continua verde.

## 2. Onde personalizar

| Quero… | Faço… | Não faço… |
| --- | --- | --- |
| Um campo novo num contato, empresa ou oportunidade | Uma coluna `custom_<nome>` na tabela, numa migração minha | Mudar o tipo ou o `not null` de uma coluna da base |
| Uma tabela nova | Uma tabela `custom_<nome>` com `org_id`, RLS por organização (`private.current_org()`) e FK composta `(id, org_id)` | Uma tabela sem RLS em `public` |
| Uma regra de validação ("sem empresa, a oportunidade não passa de R$ 10.000") | O corpo de `private.custom_validate_<entidade>` | Editar `private.validate_deal_change` ou outra função da base |
| Uma ação depois de salvar (criar uma tarefa, copiar para outra tabela) | O corpo de `private.custom_after_<entidade>_saved` | Um gatilho com nome qualquer numa tabela da base |
| Mudar o que uma função da base faz | Mover a parte própria para um gancho e deixar a função como a base a entrega | `create or replace` numa função da base |
| Mudar uma tela ou criar uma | O seu código em `src/custom/` e só a linha necessária na tela da base, marcada com `custom:` ([Tela nova](PERSONALIZAR/TELA.md)) | Reescrever uma tela da base ou mudar uma migração que já existe |

Nunca edite um arquivo que já existe em `supabase/migrations`: toda mudança no banco é um arquivo novo. O passo a passo de um campo, uma tabela e uma tela, com um exemplo completo que passa na suíte, está em [Personalizar o CRM](PERSONALIZAR/README.md); quem usa uma ferramenta de inteligência artificial aponta para ela o [AGENTS.md](../AGENTS.md), na raiz do repositório.

## 3. Os ganchos

| Gancho | Quando roda |
| --- | --- |
| `private.custom_validate_contact(p_new public.contacts, p_old public.contacts)` | Antes de criar ou editar um contato |
| `private.custom_validate_company(p_new public.companies, p_old public.companies)` | Antes de criar ou editar uma empresa |
| `private.custom_validate_deal(p_new public.deals, p_old public.deals)` | Antes de criar ou editar uma oportunidade, inclusive mover de etapa, ganhar e perder |
| `private.custom_validate_activity(p_new public.activities, p_old public.activities)` | Antes de criar ou editar uma atividade, inclusive concluir |
| `private.custom_after_contact_saved(p_new public.contacts, p_old public.contacts)` | Depois de criar ou editar um contato |
| `private.custom_after_company_saved(p_new public.companies, p_old public.companies)` | Depois de criar ou editar uma empresa |
| `private.custom_after_deal_saved(p_new public.deals, p_old public.deals)` | Depois de criar ou editar uma oportunidade |
| `private.custom_after_activity_saved(p_new public.activities, p_old public.activities)` | Depois de criar ou editar uma atividade |

Regras de uso:

- `p_new` é a linha como a base vai gravá-la, depois de todas as regras dela (por exemplo, `closed_at` já preenchido numa oportunidade ganha). `p_old` é a linha anterior e vem nulo na criação: use `p_old.id is null` para saber se é criação.
- Os ganchos rodam em todos os caminhos: as telas, as funções do CRM (`save_deal`, `move_deal`, `complete_activity`), a importação de planilha, a chave `service_role` (integrações) e o editor SQL. A validação tem três exceções: não roda durante a anonimização (veja abaixo), nem durante a passagem de carteira de quem é desativado ou perde os registros em "Equipe" (`deactivate_member` e `transfer_portfolio`, que só trocam o responsável), nem na criação por uma conta que o CRM vai recusar logo depois (somente leitura, desativada ou de outra organização). O gancho de depois roda em todos esses casos.
- **Na importação de planilha**, os contatos são gravados em lotes de até 500. Uma linha recusada pelo gancho recusa o lote inteiro: nenhum contato dele é gravado, e a janela volta à prévia com a mensagem do gancho, sem dizer qual linha a causou. Escreva a mensagem de um jeito que permita achar a linha (por exemplo, "Contatos sem cargo não entram: preencha a coluna cargo de todas as linhas").
- **Para recusar**, o gancho de validação usa `raise exception 'Mensagem em português para quem usa o CRM';`. Nada é gravado, e a tela mostra a mensagem como está (a Ajuda do CRM explica isso para a equipe). O gancho não muda a linha: ele só aprova ou recusa.
- **O gancho de depois** roda na mesma transação. Um erro nele desfaz a gravação inteira e aparece na tela.
- Mude só o corpo, com `create or replace function`, exatamente a mesma assinatura e o mesmo cabeçalho da base: copie a linha `language plpgsql security invoker set search_path='' as $$` como está nos exemplos e troque só o que fica entre `begin` e `end`. O `create or replace` volta ao padrão tudo o que não for escrito, e um gancho sem o `set search_path=''`, ou em outra linguagem, aparece na conferência como alterado. As permissões ficam. **Nunca remova um gancho**: sem ele, toda gravação na tabela falha. Para desligar uma regra, volte o corpo a `begin null; end;`.
- Valide só o que mudou. Registros antigos podem ferir uma regra nova; se o gancho recusar qualquer gravação deles, até trocar o responsável ou mover a etapa fica bloqueado. Compare `p_new` com `p_old`, como no Exemplo 1.

### Exemplo 1: exigir a empresa numa oportunidade grande

Crie `supabase/migrations/<data e hora>_custom_regra_oportunidade_grande.sql` (por exemplo, `20261101090000_custom_regra_oportunidade_grande.sql`, sempre com data e hora posteriores à última migração da pasta):

```sql
create or replace function private.custom_validate_deal(p_new public.deals, p_old public.deals) returns void
 language plpgsql security invoker set search_path='' as $$
begin
 -- Só na criação ou quando o valor ou a empresa mudam: uma oportunidade antiga acima do limite e sem empresa
 -- continua podendo trocar de responsável e de etapa.
 if p_new.value > 10000 and p_new.company_id is null
    and (p_old.id is null or p_new.value is distinct from p_old.value or p_new.company_id is distinct from p_old.company_id) then
  raise exception 'Oportunidades acima de R$ 10.000 precisam de uma empresa. Escolha a empresa e salve de novo.';
 end if;
end $$;
```

### Exemplo 2: criar uma tarefa quando nasce uma oportunidade

```sql
create or replace function private.custom_after_deal_saved(p_new public.deals, p_old public.deals) returns void
 language plpgsql security invoker set search_path='' as $$
begin
 -- Uma atividade criada aqui também passa pelos ganchos de atividade; esta guarda evita voltar a este gancho.
 if pg_catalog.pg_trigger_depth() > 1 then return; end if;
 if p_old.id is null and p_new.owner_id is not null then
  insert into public.activities(org_id, deal_id, contact_id, company_id, type, title, due_date, user_id)
  values (p_new.org_id, p_new.id, p_new.contact_id, p_new.company_id, 'task', 'Primeiro contato com o cliente',
          now() + interval '1 day', p_new.owner_id);
 end if;
end $$;
```

Os nomes de tabela e de função vão sempre com o schema (`public.activities`, `pg_catalog.pg_trigger_depth()`), porque o gancho roda com o `search_path` vazio.

### O que o gancho enxerga

- O gancho roda com os privilégios do dono do banco e **sem RLS**: ele lê e grava qualquer linha. Quem fez a gravação se descobre por `auth.uid()` (nulo pela chave `service_role` e pelo editor SQL) e a organização por `private.current_org()`. Para uma regra que depende do papel, use `private.can_write()` (quem edita) ou `private.can_manage()` (donos e administradores).
- O gancho de validação roda antes de o banco gravar e antes de algumas conferências da base. A criação por uma conta sem permissão não chega a ele, mas outras recusas da base podem vir depois dele. Por isso, a validação só aprova ou recusa: não grava em outras tabelas nem avisa ninguém. O que precisa acontecer depois de salvar (criar uma tarefa, registrar, avisar) vai no gancho de depois, que só roda quando a gravação deu certo.
- **Anonimização (LGPD).** Durante `anonymize_contact`, os ganchos de validação não rodam: uma regra da empresa não pode impedir o atendimento de um pedido do titular. Os ganchos de depois rodam, com `p_new.anonymized_at` preenchido no contato: se você copiou dados pessoais do contato para tabelas suas, apague ou troque esses dados ali (a regra de todo campo novo com dado pessoal, em [LGPD da instância](LGPD-INSTANCIA.md)).
- Teste a regra no projeto de desenvolvimento antes de levá-la à instância da empresa. Um gancho lento deixa todas as gravações da tabela lentas.

## 4. A sua migração

1. Arquivo novo em `supabase/migrations`, com data e hora posteriores à última migração da pasta e o nome `<data e hora>_custom_<nome>.sql`, por exemplo `20261101090000_custom_regra_oportunidade_grande.sql`, mas com a data e a hora do momento em que você cria o arquivo, nunca uma data futura nem a de um exemplo: uma migração sua com data à frente das próximas migrações da base faz o `npx supabase db push` recusá-las na atualização (a base usa o formato `AAAAMMDDhhmmss_nome.sql` e nunca dá a uma migração dela um nome que comece por `custom_`). O `_custom_` logo depois da data e hora é obrigatório: é por ele que as conferências da base deixam a sua migração de fora (passo 5). Uma migração que a base listou no `supabase/base-manifest.json` nunca é tratada como sua, seja qual for o nome, e o CI do repositório da base recusa qualquer migração `_custom_` lá.
2. Objetos novos com o prefixo `custom_`: `public.custom_contratos`, `public.contacts.custom_cnpj`, `private.custom_calcular_comissao(...)`.
3. Tabela nova em `public`: `org_id uuid not null`, `unique(id, org_id)`, FKs compostas para as tabelas da base, `revoke all` dos papéis da API, `grant` para `authenticated` (sem ele, o CRM não lê nem grava a tabela, mesmo com as políticas certas), `enable row level security` e as políticas com `org_id = (select private.current_org())`, como as migrações da base fazem. Desde a migração `20261019120000_default_privileges.sql` da base, uma tabela, view, sequência ou função nova nasce sem nenhuma permissão para a API: sem o `grant`, o CRM recebe 42501 ("permission denied"), e nada fica aberto por esquecimento. A chave `service_role` (uma integração do servidor, que ignora a RLS) também só grava com o `grant` comentado no modelo. Um modelo completo (o mesmo de [Entidade nova](PERSONALIZAR/ENTIDADE.md)):

   ```sql
   create table public.custom_contratos(
    id uuid primary key default gen_random_uuid(),
    org_id uuid not null references public.organizations(id),
    deal_id uuid not null,
    numero text not null,
    assinado_em date,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique(id, org_id),
    foreign key (deal_id, org_id) references public.deals(id, org_id) on delete cascade
   );
   create index custom_contratos_deal on public.custom_contratos(deal_id, org_id);
   revoke all on public.custom_contratos from public, anon, authenticated, service_role;
   grant select, insert, update, delete on public.custom_contratos to authenticated;
   -- Só se uma integração do servidor (uma Edge Function com a chave service_role) gravar nesta tabela:
   -- grant select, insert, update, delete on public.custom_contratos to service_role;
   alter table public.custom_contratos enable row level security;
   create policy custom_contratos_read on public.custom_contratos for select to authenticated
    using (org_id = (select private.current_org()));
   create policy custom_contratos_insert on public.custom_contratos for insert to authenticated
    with check (org_id = (select private.current_org()) and (select private.can_write()));
   create policy custom_contratos_update on public.custom_contratos for update to authenticated
    using (org_id = (select private.current_org()) and (select private.can_write()))
    with check (org_id = (select private.current_org()) and (select private.can_write()));
   create policy custom_contratos_delete on public.custom_contratos for delete to authenticated
    using (org_id = (select private.current_org()) and (select private.can_manage()));
   ```

   Com só o `grant select`, a tabela fica só de leitura pelo CRM. Excluir fica com donos e administradores (`private.can_manage()`), como nas tabelas da base.
4. Aplique com o mesmo caminho das migrações da base (`npx supabase db push`, com o projeto ligado), depois de testar no projeto de desenvolvimento. Rode `npm run gen:types` e faça commit do tipo gerado: ele inclui as suas tabelas e colunas, para o código das telas enxergá-las, e o CI confere que ele está em dia.
5. **As conferências da base ignoram as migrações `_custom_`.** O manifesto (`supabase/base-manifest.json`) e a conferência (`supabase/db-drift-check.sql`) descrevem só a base: o `npm run manifest:build` e o `npm run manifest:check` deixam as suas migrações de fora e dão o mesmo resultado que na base, e os seus objetos aparecem como extras na conferência. O `npm test` (as regras sobre as migrações) e o `npm run test:db` (que aplica só as migrações da base e confere as regras dela) também as deixam de fora: teste a sua regra no projeto de desenvolvimento. Se os dois arquivos gerados foram editados à mão, volte-os ao último commit (no terminal, na pasta do projeto): `git checkout HEAD -- supabase/base-manifest.json supabase/db-drift-check.sql`, ou rode `npm run manifest:build`.

## 5. Conferir o banco (db-drift-check)

O arquivo `supabase/db-drift-check.sql` é uma consulta só de leitura: ela não grava nada. Não precisa de senha nem de chave, porque usa a sessão de quem já administra o projeto no painel.

1. No VS Code, abra `supabase/db-drift-check.sql`, use Ctrl+A e Ctrl+C. (No Bloco de Notas também serve: botão direito no arquivo → **Abrir com** → **Bloco de Notas**.)
2. No painel do Supabase, abra **SQL Editor** → **New query**, cole com Ctrl+V e clique em **Run**.
3. Leia o resultado, uma linha por diferença:

| Coluna | O que diz |
| --- | --- |
| `gravidade` | `resumo`; `atenção` (o que uma atualização pode apagar ou quebrar); `informação` (nada a fazer) |
| `situacao` | `resumo` (a primeira linha e os avisos gerais), `alterado` (objeto da base mudado à mão), `ausente` (objeto ou migração da base que falta), `gancho` (um gancho com corpo próprio, "em uso"), `extra` (objeto ou migração fora da base) |
| `tipo`, `objeto`, `detalhe` | O que difere e o que fazer |

- A primeira linha resume: a versão da base que o arquivo descreve, a última migração da base presente no banco, e as contagens. Se o banco está atrás ("Faltam 2 migrações da base"), as diferenças podem vir delas: aplique as migrações ou use o arquivo da versão instalada.
- **Extras nunca são erro.** Tabelas, colunas, funções e migrações suas aparecem como informação; as colunas, os índices e as políticas de uma tabela sua ficam resumidos na linha dela. Um objeto extra sem o prefixo `custom_` funciona, mas uma versão futura pode criar um objeto com o mesmo nome: prefira o prefixo. Um gatilho seu numa tabela da base ganha o aviso de conferir depois de cada atualização se ele continua valendo. A exceção da gravidade é a política permissiva sua numa tabela da base (por exemplo, uma política `for select to anon using (true)` em `public.contacts`): ela vem com atenção, porque soma acesso ao das políticas da base, e o detalhe diz o comando e os papéis que ela alcança. Continua sendo um extra; confira se é isso que você quer. Também vêm com atenção os extras em `public` que qualquer pessoa com a chave pública alcança pela API, sem login e com os dados de todas as empresas: uma tabela sem RLS, uma view sem `security_invoker` (ela ignora a RLS das tabelas que lê) e uma função `SECURITY DEFINER` executável por `anon`, `authenticated` ou `PUBLIC`. Desde a migração `20261019120000_default_privileges.sql`, o que você cria nasce fechado: um extra aberto vem de um `grant` seu ou de outro papel (os recursos do painel criados pela plataforma). Corrija com o comando do detalhe: ligar a RLS e criar as políticas (seção 2), `security_invoker = true` na view, ou `revoke execute` na função (ou mova-a para `private`). Uma tabela sua com RLS e nenhuma política vem como informação: pela API, ninguém a lê.
- **Alterados** dizem o que mudou (segurança, permissões, `search_path`, corpo, expressão de política, gatilho desligado). Volte o objeto ao que a base criou e ponha a regra num gancho ou num objeto `custom_*`. Num gancho, só as propriedades contam (o corpo é livre): um gancho alterado com "Configuração" ou "Linguagem" diferente se corrige recriando-o com o cabeçalho da base (`language plpgsql security invoker set search_path='' as $$`, seção 3), e um com "Permissões" diferentes, com `revoke execute on function <gancho> from <papel>`.
- **Privilégio padrão** (nove linhas fixas, `postgres/<schema>/<tipo>`): as permissões que o dono do banco dá a toda tabela, sequência ou função nova. Na base, todas vazias. Uma linha "alterado" diz que alguém reabriu um privilégio padrão (por exemplo, `alter default privileges ... grant select on tables to anon`): uma tabela esquecida sem RLS ficaria aberta pela API. O detalhe traz o comando que fecha.
- Sem `supabase_migrations.schema_migrations` (migrações aplicadas pelo editor SQL sem registro), uma linha avisa, e a comparação dos objetos continua valendo.
- Se o banco usa uma versão principal do PostgreSQL diferente da do manifesto (por exemplo, 15 em vez de 17), uma linha avisa que políticas, gatilhos, restrições e índices podem aparecer como alterados só pela escrita da expressão.
- A conferência exige a migração `20261019110000_update_protection.sql` aplicada. Sem ela, o painel responde que `private.base_fingerprints()` não existe.

Pelo terminal, quem preferir pode rodar `psql -f supabase/db-drift-check.sql` com a string de conexão do painel (**Connect** → **Connection string**), digitada na hora e nunca gravada em arquivo do repositório. É opcional.

### Fora da conferência

A conferência compara os schemas `public` e `private`. Ficam de fora: outros schemas que você criou, as extensões, as tarefas agendadas do `pg_cron`, os buckets do Storage, as Edge Functions, os comentários e os privilégios padrão de papéis que não são o `postgres` (os de `supabase_admin`, que a plataforma usa nos recursos do painel, ficam como o Supabase os criou). Para listar as extensões e as tarefas, rode no editor SQL:

```sql
select extname, extversion from pg_extension order by extname;
select jobname, schedule, command from cron.job order by jobname;
```

(A segunda só funciona com o `pg_cron` instalado.) A configuração do Auth e os cabeçalhos do site também ficam fora: são conferidos pelo `npm run config:check` e pelo verificador da publicação (item 1.4 do roteiro).

## 6. Atualizar a base

1. **Antes de atualizar**, com o arquivo da versão instalada (o do seu repositório antes de trazer a versão nova): rode a conferência. Alterados e ausentes são o que a atualização pode apagar ou quebrar: mova cada alteração para um gancho ou anote para refazer.
2. Traga a versão nova para o seu repositório (o passo a passo fica no guia de atualização, item 1.7b do roteiro) e aplique as migrações.
3. **Depois de aplicar**, com o arquivo da versão nova: só o resumo, os ganchos em uso e os seus extras devem sobrar.

## 7. Quando a atualização para

Uma migração da base que recria ou remove uma função, um gatilho ou uma política confere antes se o objeto está como a base o deixou (seção 1: o teste da base cobre os comandos escritos na migração; o SQL montado na hora fica com a revisão). Se você o alterou à mão, a migração para, nada dela é aplicado, e a mensagem diz:

> A atualização vai substituir private.create_invitation(text,text), mas esta função foi alterada nesta instância e a alteração seria perdida. Nada foi aplicado desta migração. Escolha um caminho: (1) mova a sua regra para um gancho private.custom_* (docs/PROTECAO-ATUALIZACAO.md) e volte a função ao texto da base; ou (2) aceite perder a alteração, rodando no editor SQL do painel: insert into private.base_overwrite_consents(kind, object, live_hash) values ('function', 'private.create_invitation(text,text)', '…'); Depois, rode a atualização de novo.

- **Caminho 1 (recomendado):** ponha a regra num gancho (seção 3), numa migração sua, e volte a função ao texto da base (o da migração que a criou ou a alterou por último). Rode a atualização de novo.
- **Caminho 2:** se a alteração pode ser perdida, rode o `insert` da mensagem, como está, no editor SQL, e rode a atualização de novo. O aceite vale só para aquele estado do objeto: se ele mudar outra vez, a atualização volta a parar. As linhas de aceite ficam como registro.

## 8. Para quem mantém a base

- Toda migração nova da base: `npm run gen:types` e `npm run manifest:build`, e commit dos arquivos gerados (`src/integrations/supabase/database.types.ts`, `supabase/base-manifest.json` e `supabase/db-drift-check.sql`). O CI roda `npm run manifest:check`, que reprova o manifesto defasado.
- Migração posterior a `20261019110000_update_protection.sql` que recria ou remove uma função, um gatilho ou uma política da base começa, para cada um, com a guarda, usando o `hash` do objeto no `supabase/base-manifest.json` de antes da migração (política: `'policy', 'public.contacts.tenant_read'`):

  ```sql
  select private.assert_base_definition('function', 'private.create_invitation(text,text)', array['<hash do manifesto>']);
  ```

  Um teste sobre os arquivos (`scripts/lib/base-manifest.test.mjs`) reprova a migração que esquece a guarda (função e gatilho recriados ou removidos; `drop policy` e `alter policy` numa política que a migração não criou, inclusive as criadas em laço pelas migrações antigas), e o `test:db` reprova o hash errado. O que a migração recriar por SQL montado na hora (`execute format`) não aparece no texto: a guarda disso é da revisão.
- Tabela nova da base: `revoke all ... from public, anon, authenticated, service_role`, `grant` explícito para `authenticated` e `select, insert, update, delete` para `service_role`; função nova com `grant execute` explícito. Desde `20261019120000_default_privileges.sql`, o `test:db` mostra 42501 se faltar.
- Os ganchos nunca são recriados, trocados ou removidos, e nenhum objeto novo da base usa o prefixo `custom_` (os mesmos testes reprovam). Nenhuma migração da base tem nome `<data e hora>_custom_<nome>.sql`: as conferências deixariam a migração de fora.
