# Entidade nova (uma tabela sua)

Exemplo: os contratos assinados de cada oportunidade, na tabela `public.custom_contratos`. Leia antes o [índice da personalização](README.md) e [Personalizar sem quebrar a atualização](../PROTECAO-ATUALIZACAO.md#4-a-sua-migração), que traz o mesmo modelo. O arquivo completo está em [exemplos/](exemplos/supabase/migrations/20261101091000_custom_contratos.sql).

## 1. A tabela

Crie `supabase/migrations/<data e hora>_custom_contratos.sql` (o exemplo se chama `20261101091000_custom_contratos.sql`, mas não copie o número). A data e a hora são as do momento em que você cria o arquivo (por exemplo, `20261125143000` para 25/11/2026 às 14h30), nunca uma data futura nem a do exemplo: uma migração sua com data à frente das próximas migrações da base faz o `npx supabase@2.119.0 db push` recusá-las na atualização.

<!-- exemplo: supabase/migrations/20261101091000_custom_contratos.sql -->

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
```

- **`org_id` e a FK composta** `(deal_id, org_id)`: um contrato só aponta para uma oportunidade da mesma empresa, mesmo que alguém tente outra pela API (o banco recusa com 23503).
- **`unique(id, org_id)`**: deixa outra tabela sua apontar para esta do mesmo jeito.

## 2. Permissões e RLS

<!-- exemplo: supabase/migrations/20261101091000_custom_contratos.sql -->

```sql
revoke all on public.custom_contratos from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.custom_contratos to authenticated;
-- Só se uma integração do servidor (uma Edge Function com a chave service_role) gravar nesta tabela:
-- grant select, insert, update, delete on public.custom_contratos to service_role;
alter table public.custom_contratos enable row level security;
```

- Desde a migração `20261019120000_default_privileges.sql` da base, a tabela nasce sem permissão para a API. Sem o `grant`, o CRM recebe 42501 ("permission denied") mesmo com as políticas certas. O `revoke` fica para deixar claro o ponto de partida.
- A chave `service_role` ignora a RLS. Conceda a ela só quando uma integração do servidor precisar, de propósito.
- Com só o `grant select`, a tabela fica só de leitura pelo CRM.

As quatro políticas, por organização, com os papéis da base:

<!-- exemplo: supabase/migrations/20261101091000_custom_contratos.sql -->

```sql
create policy custom_contratos_read on public.custom_contratos for select to authenticated
 using (org_id = (select private.current_org()));
create policy custom_contratos_insert on public.custom_contratos for insert to authenticated
 with check (org_id = (select private.current_org()) and (select private.can_write()));
```

`private.current_org()` só devolve a empresa de quem tem papel ativo (a conta desativada não lê nada). `private.can_write()` é quem edita (donos, administradores e colaboradores); `private.can_manage()`, na política de exclusão, só donos e administradores. Nunca use `profiles.org_id` direto.

## 3. Detalhes

- `updated_at` acompanha cada edição pelo gatilho `custom_contratos_touch`, que chama `private.touch_updated_at()`, a função que a base já usa.
- Um dado pessoal numa tabela sua precisa ser limpo na anonimização, pelo gancho `private.custom_after_contact_saved` ([Campo novo](CAMPO.md#quando-a-tabela-pede-mais)).
- Desde a migração `20261019120000_default_privileges.sql`, toda função nova nasce sem `EXECUTE` para a API: uma função sua usada numa política RLS, num `DEFAULT` de coluna ou numa view, e não só a chamada pela API, precisa de `grant execute on function <schema>.<função>(<tipos>) to authenticated`; sem ele, toda leitura ou gravação da tabela responde 42501 ("permission denied for function"). O mesmo vale para as funções de uma extensão do PostgreSQL ligada depois dessa migração (`create extension pg_trgm`, por exemplo): dê o `grant` para cada função usada.
- Uma regra própria ao gravar na sua tabela pode ser um gatilho seu nela (com o prefixo `custom_`); nas tabelas da base, use os ganchos.

## 4. Aplicar e conferir

1. No projeto de desenvolvimento, conferindo antes qual projeto está ligado: `npx supabase@2.119.0 db push` ([Testar a sua migração](README.md#testar-a-sua-migração)).
2. `npm run gen:types`: o tipo ganha `custom_contratos` ([o tipo gerado do exemplo](exemplos/database.types.ts)).
3. Confira com cada papel, como faz o teste do exemplo na base (`personalizationExampleChecks`, em `scripts/test-database.mjs`): o colaborador grava, o papel de leitura só lê, só donos e administradores excluem, outra empresa não enxerga e `anon` recebe 42501.
4. Rode a conferência de drift: `public.custom_contratos` aparece como extra, sem atenção.

A tela que usa a tabela está em [Tela nova](TELA.md).
