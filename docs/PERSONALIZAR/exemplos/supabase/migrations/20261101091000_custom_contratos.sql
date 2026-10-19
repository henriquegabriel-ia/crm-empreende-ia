-- Exemplo de docs/PERSONALIZAR/ENTIDADE.md: os contratos assinados de cada oportunidade, uma tabela nova.
-- O modelo de docs/PROTECAO-ATUALIZACAO.md (seção 4): org_id, unique(id, org_id), FK composta para a oportunidade da
-- mesma organização, permissões explícitas, RLS e as quatro políticas por organização. Desde a migração
-- 20261019120000_default_privileges.sql da base, a tabela nasce sem permissão para a API: sem o grant, o CRM recebe
-- 42501 mesmo com as políticas certas.
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
-- updated_at acompanha cada edição, pela função que a base já usa nas tabelas dela.
create trigger custom_contratos_touch before update on public.custom_contratos
 for each row execute function private.touch_updated_at();
