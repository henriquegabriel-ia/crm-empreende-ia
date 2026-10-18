-- Item 1.16 do roteiro: catálogo de produtos e serviços com itens na oportunidade (decisão D14). Desenho:
-- docs/arquitetura/1.16.md.
-- O catálogo (products) é mantido por donos e administradores e consultado por todos. Os itens da oportunidade
-- (deal_items) copiam nome, unidade, preço e cobrança do catálogo no momento da escolha (ou são avulsos), com
-- quantidade, desconto por item e o total da linha calculado pelo banco (coluna gerada). Com itens, o valor da
-- oportunidade (deals.value) passa a ser o valor do contrato: total único + mensalidade × meses informados, com as
-- partes em colunas novas de deals. Nenhum papel da API escreve em deal_items: a RPC save_deal grava a oportunidade e os
-- itens na mesma transação, com a guarda de concorrência em updated_at (0.8) e a repetição segura da criação (1.9).
-- O nome do item é texto livre: entra na anonimização e na exportação do titular (regra do 1.10), com três funções do
-- 1.10/1.11 substituídas mantendo o corpo atual mais a parte dos itens.
-- Aditiva e sem reescrever tabela: duas tabelas novas, quatro colunas em deals (uma com padrão constante e três
-- anuláveis, sem reescrita no PostgreSQL 11+), três CHECK que as linhas existentes (item_count = 0) satisfazem, um
-- gatilho, duas funções novas e três substituídas com a mesma assinatura (os grants ficam). Nenhuma oportunidade muda de
-- valor, de versão ou de auditoria, e nenhum gatilho dispara durante a migração.

-- 1. Catálogo. Nome não é único (o mesmo serviço pode existir com unidades diferentes); o código, quando informado, é
-- único na organização sem diferença de maiúsculas nem de espaços nas pontas. archived_at nulo = ativo; preenchido =
-- fora das escolhas dos itens novos desde aquela data. Tipo e cobrança têm padrão de tela, sem efeito no cálculo.
create table public.products(
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null references public.organizations(id),
 name text not null,
 code text,
 kind text not null default 'product',
 unit text,
 price numeric(16,2) not null,
 billing text not null default 'one_time',
 archived_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(id,org_id),
 constraint products_name_length check(length(btrim(name)) between 1 and 160),
 constraint products_code_length check(code is null or length(btrim(code)) between 1 and 40),
 constraint products_kind check(kind in ('product','service')),
 constraint products_unit_length check(unit is null or length(btrim(unit)) between 1 and 20),
 constraint products_price_valid check(price>=0 and price<>'NaN'::numeric and price<=999999999999.99),
 constraint products_billing check(billing in ('one_time','monthly')),
 constraint products_archived_at_finite check(isfinite(archived_at)),
 constraint products_created_at_finite check(isfinite(created_at)),
 constraint products_updated_at_finite check(isfinite(updated_at))
);
create unique index products_org_code on public.products(org_id,lower(btrim(code))) where code is not null;
-- A lista do catálogo ordena por nome; o índice também cobre a FK da organização.
create index products_org_name on public.products(org_id,name);
-- O Supabase hospedado concede tudo por privilégio padrão (simulado em supabase/tests/local-bootstrap.sql): tira tudo e
-- devolve o que a tela usa. Todos da organização leem; só donos e administradores gravam (o padrão das configurações
-- desde 20260906051832_configuration_policies_by_operation.sql). current_org() exige papel ativo (1.2).
revoke all on public.products from public,anon,authenticated;
alter table public.products enable row level security;
grant select,insert,update,delete on public.products to authenticated;
create policy tenant_read on public.products for select to authenticated using(org_id=(select private.current_org()));
create policy tenant_insert on public.products for insert to authenticated
 with check(org_id=(select private.current_org()) and (select private.can_manage()));
create policy tenant_update on public.products for update to authenticated
 using(org_id=(select private.current_org()) and (select private.can_manage()))
 with check(org_id=(select private.current_org()) and (select private.can_manage()));
create policy tenant_delete on public.products for delete to authenticated
 using(org_id=(select private.current_org()) and (select private.can_manage()));
create trigger protect_record_metadata before insert or update on public.products for each row execute function private.protect_record_metadata();
create trigger touch_updated_at before update on public.products for each row execute function private.touch_updated_at();
create trigger audit_record_change after insert or update or delete on public.products for each row execute function private.audit_record_change();

-- 2. Itens da oportunidade. Nome, unidade, preço e cobrança são gravados no item (cópia do catálogo no momento da
-- escolha, editável): mudar o catálogo não muda negociações já feitas, e a proposta (2B.15) mostra o que foi negociado.
-- O item avulso tem product_id nulo. O id vem do navegador (sem padrão), para a gravação por diferença e a repetição
-- segura. Desconto com uma representação só: sem desconto, tipo nulo e valor 0; em %, maior que 0 e até 100; em R$, até
-- o bruto da linha. O total da linha é coluna gerada: bruto = round(quantidade × preço, 2); desconto em % =
-- round(bruto × percentual / 100, 2); total = bruto − desconto. round arredonda a metade para longe do zero, o que, com
-- valores não negativos, é "metade para cima", a mesma conta em centavos de src/lib/deal-item-math.ts.
-- Os itens saem com a oportunidade (ON DELETE CASCADE; delete_deal não muda); o item do catálogo já usado não é excluído
-- (FK sem ON DELETE): arquive.
create table public.deal_items(
 id uuid primary key,
 org_id uuid not null references public.organizations(id),
 deal_id uuid not null,
 product_id uuid,
 position integer not null,
 name text not null,
 quantity numeric(12,3) not null,
 unit text,
 unit_price numeric(16,2) not null,
 discount_type text,
 discount_value numeric(16,2) not null default 0,
 billing text not null,
 line_total numeric(16,2) generated always as (
  round(quantity*unit_price,2)
  - case discount_type when 'percent' then round(round(quantity*unit_price,2)*discount_value/100,2)
                       when 'amount' then discount_value else 0 end
 ) stored,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(id,org_id),
 constraint deal_items_deal_id_org_id_fkey foreign key(deal_id,org_id) references public.deals(id,org_id) on delete cascade,
 constraint deal_items_product_id_org_id_fkey foreign key(product_id,org_id) references public.products(id,org_id),
 constraint deal_items_position check(position between 0 and 99),
 constraint deal_items_name_length check(length(btrim(name)) between 1 and 160),
 constraint deal_items_quantity check(quantity>0 and quantity<>'NaN'::numeric),
 constraint deal_items_unit_length check(unit is null or length(btrim(unit)) between 1 and 20),
 constraint deal_items_unit_price check(unit_price>=0 and unit_price<>'NaN'::numeric),
 constraint deal_items_gross_limit check(round(quantity*unit_price,2)<=999999999999.99),
 constraint deal_items_discount check(
  (discount_type is null and discount_value=0)
  or (discount_type='percent' and discount_value>0 and discount_value<=100)
  or (discount_type='amount' and discount_value>0 and discount_value<=round(quantity*unit_price,2))),
 constraint deal_items_billing check(billing in ('one_time','monthly')),
 constraint deal_items_created_at_finite check(isfinite(created_at)),
 constraint deal_items_updated_at_finite check(isfinite(updated_at))
);
-- A leitura dos itens de uma oportunidade, em ordem (também cobre a FK da organização), e a regra da base de indexar
-- toda FK.
create index deal_items_deal_position on public.deal_items(org_id,deal_id,position);
create index deal_items_deal_id_org_id_fkey_idx on public.deal_items(deal_id,org_id);
create index deal_items_product_id_org_id_fkey_idx on public.deal_items(product_id,org_id);
-- Só leitura pela API, para toda a organização. Nenhum papel insere, altera ou exclui, nem o dono: a RPC save_deal é a
-- única escritora, como deal_stage_history e privacy_actions são escritos só pelo banco.
revoke all on public.deal_items from public,anon,authenticated;
alter table public.deal_items enable row level security;
grant select on public.deal_items to authenticated;
create policy tenant_read on public.deal_items for select to authenticated using(org_id=(select private.current_org()));
create trigger protect_record_metadata before insert or update on public.deal_items for each row execute function private.protect_record_metadata();
create trigger touch_updated_at before update on public.deal_items for each row execute function private.touch_updated_at();
create trigger audit_record_change after insert or update or delete on public.deal_items for each row execute function private.audit_record_change();

-- 3. As partes do valor em deals. value continua a coluna lida por todos (Pipeline, previsão, Relatórios, "Ganhos por
-- responsável", ficha 360, Copiloto, exportação) e, com itens, é o valor do contrato. Sem itens, item_count = 0, as
-- partes ficam nulas e value continua manual, como hoje. Os meses só existem com item mensal (regra da RPC: o CHECK
-- não enxerga os itens), de 1 a 120. deals_value_from_items recusa (23514) qualquer mudança de value numa oportunidade
-- com itens que não venha junto das partes, inclusive de um frontend antigo.
alter table public.deals add column item_count integer not null default 0;
alter table public.deals add column one_time_value numeric(16,2);
alter table public.deals add column monthly_value numeric(16,2);
alter table public.deals add column contract_months integer;
alter table public.deals add constraint deals_item_count check(item_count between 0 and 100);
alter table public.deals add constraint deals_item_totals check(
 (item_count=0 and one_time_value is null and monthly_value is null and contract_months is null)
 or (item_count>0 and one_time_value>=0 and monthly_value>=0
     and (contract_months is null or contract_months between 1 and 120)));
alter table public.deals add constraint deals_value_from_items check(
 item_count=0 or value=one_time_value+monthly_value*coalesce(contract_months,0));

-- Só a RPC muda as partes. Fora da gravação dos itens (a marca crm.saving_deal_items igual ao id da linha, ligada só na
-- transação por private.save_deal, como crm.anonymizing_contact no 1.10), a inserção zera item_count e anula as partes,
-- e a atualização devolve os valores antigos das quatro colunas: com o CHECK, um cliente não desliga os itens nem troca
-- o valor. SECURITY INVOKER, sem ler outra tabela e sem private.* (a chave service_role grava oportunidades: a entrada
-- de leads e o receptor da Fecha IA inserem com value, e nada muda para eles). BEFORE, em ordem alfabética: depois de
-- guard_anonymized_contact e antes de protect_record_metadata, refuse_inactive_assignee, touch_updated_at e
-- validate_deal_change, que não leem essas colunas.
create function private.protect_deal_totals() returns trigger language plpgsql set search_path='' as $$
 begin
 if coalesce(current_setting('crm.saving_deal_items',true),'')=new.id::text then return new; end if;
 if tg_op='INSERT' then
  new.item_count=0;
  new.one_time_value=null;
  new.monthly_value=null;
  new.contract_months=null;
 else
  new.item_count=old.item_count;
  new.one_time_value=old.one_time_value;
  new.monthly_value=old.monthly_value;
  new.contract_months=old.contract_months;
 end if;
 return new;
 end;
$$;
create trigger protect_deal_totals before insert or update on public.deals
 for each row execute function private.protect_deal_totals();

-- 4. Gravação da oportunidade com os itens, numa transação: public.save_deal (SECURITY INVOKER) chama private.save_deal
-- (SECURITY DEFINER, porque escreve em deal_items, que a API não escreve). Como passa por cima da RLS, confere o que a
-- política conferiria (papel que edita, organização da sessão) e mais.
-- p_version nulo = criar com o id gerado no navegador: se a oportunidade já existe na organização, devolve-a com os
-- itens e "replayed" (a repetição depois de uma resposta perdida, como complete_activity), sem mudar nada. p_version
-- informado = editar só aquela versão (FOR UPDATE; outra versão ou outra organização: conflito, nada gravado). A
-- anonimização, que muda itens fora de save_deal, renova a versão da oportunidade: a lista lida antes também é conflito.
-- p_fields: os campos do formulário (nulo = não mexe neles); uma chave fora da lista é recusada, para um erro do cliente
-- não passar calado. Etapa e situação mudam só por move_deal na edição.
-- p_items: a lista completa de itens (nulo = não mexe neles; [] = remove todos), validada inteira antes de gravar e
-- gravada por diferença (mantém os ids; atualiza só o que mudou, para a auditoria não ganhar linhas vazias).
-- Quantidade, preço e desconto chegam como texto decimal ("1.500", "1500.00"), nunca como número do JSON: scale() confere
-- as casas antes de o numeric(16,2) arredondar em silêncio.
-- p_contract_months: obrigatório (1 a 120) com item mensal; sem item mensal, os meses ficam nulos.
-- Travas: a oportunidade em FOR UPDATE antes dos itens (a ordem de delete_deal e de anonymize_contact: oportunidade,
-- depois o que depende dela); o contato novo em FOR KEY SHARE logo depois, antes dos itens, para a anonimização que já
-- trava o contato não esperar itens travados aqui (e vice-versa). Os gatilhos de sempre passam: validate_deal_change,
-- refuse_inactive_assignee, guard_anonymized_contact, record_deal_change e run_deal_automations (não disparam na edição:
-- etapa e situação não mudam; na criação, deal_created dispara uma vez), touch_updated_at e audit_record_change.
create function private.save_deal(p_deal_id uuid,p_version timestamptz default null,p_fields jsonb default null,p_items jsonb default null,
 p_contract_months integer default null) returns jsonb language plpgsql security definer set search_path='' as $$
 declare
  v_org uuid;
  v_deal public.deals;
  v_create_keys constant text[]:=array['title','pipeline_id','stage_id','status','currency','value','owner_id','contact_id',
   'company_id','close_date','probability','lost_reason'];
  v_edit_keys constant text[]:=array['title','currency','value','owner_id','contact_id','company_id','close_date',
   'probability','lost_reason','closed_at'];
  v_unknown text;
  v_value numeric;
  v_item jsonb;
  v_position bigint;
  v_label text;
  v_id uuid;
  v_ids uuid[]:='{}';
  v_name text;
  v_unit text;
  v_quantity numeric;
  v_price numeric;
  v_gross numeric;
  v_discount_type text;
  v_discount numeric;
  v_billing text;
  v_product uuid;
  v_product_name text;
  v_archived timestamptz;
  v_previous_product uuid;
  v_previous_found boolean;
  v_same_deal boolean;
  v_rows jsonb:='[]'::jsonb;
  v_count integer;
  v_one_time numeric;
  v_monthly numeric;
  v_has_monthly boolean;
  v_months integer;
  v_contract numeric;
  v_items jsonb;
 begin
 v_org:=private.current_org();
 if auth.uid() is null or v_org is null or not private.can_write() then
  raise exception 'Você não tem permissão para alterar oportunidades.' using errcode='insufficient_privilege';
 end if;
 if p_deal_id is null then raise exception 'Informe a oportunidade.'; end if;
 if p_fields is null and p_items is null then raise exception 'Nada a salvar: informe os campos ou os itens da oportunidade.'; end if;
 if p_fields is not null and jsonb_typeof(p_fields)<>'object' then raise exception 'Os campos da oportunidade são inválidos.'; end if;
 if p_items is not null and jsonb_typeof(p_items)<>'array' then raise exception 'A lista de itens é inválida.'; end if;
 if p_fields is not null then
  select string_agg(k,', ' order by k) into v_unknown from jsonb_object_keys(p_fields) k
   where k<>all(case when p_version is null then v_create_keys else v_edit_keys end);
  if v_unknown is not null then raise exception 'Campo desconhecido: %.',v_unknown; end if;
  if p_fields ? 'value' and jsonb_typeof(p_fields->'value')<>'null' then
   begin
    v_value:=(p_fields->>'value')::numeric;
   exception when invalid_text_representation then
    raise exception 'Informe um valor positivo ou zero, com até duas casas decimais.';
   end;
   if v_value<0 or v_value='NaN'::numeric or scale(v_value)>2 or v_value>999999999999.99 then
    raise exception 'Informe um valor positivo ou zero, com até duas casas decimais.';
   end if;
  end if;
 end if;

 -- Criar: a repetição devolve o que já foi gravado.
 if p_version is null then
  select * into v_deal from public.deals d where d.id=p_deal_id;
  if found then
   if v_deal.org_id is distinct from v_org then raise exception 'Oportunidade indisponível ou sem acesso.'; end if;
   return jsonb_build_object('deal',to_jsonb(v_deal),
    'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.position,i.id) from public.deal_items i where i.org_id=v_org and i.deal_id=p_deal_id),'[]'::jsonb),
    'replayed',true);
  end if;
  if p_fields is null then raise exception 'Informe os dados da oportunidade.'; end if;
 else
  select * into v_deal from public.deals d where d.id=p_deal_id and d.org_id=v_org for update;
  -- A versão da oportunidade cobre também os itens: quem muda um item fora daqui (a anonimização do 1.10) renova a
  -- versão da oportunidade na mesma transação, e a lista lida antes cai nesta igualdade. A comparação é sempre por
  -- igualdade, nunca por ordem: updated_at vem de now(), o início de cada transação, que não segue a ordem dos commits.
  if not found or v_deal.updated_at is distinct from p_version then
   raise exception 'Esta oportunidade mudou ou não está mais disponível. Seus dados continuam no formulário; feche, confira a versão atual e edite de novo.';
  end if;
 end if;
 -- O contato novo, travado antes dos itens (ver o cabeçalho).
 if p_fields ? 'contact_id' and nullif(p_fields->>'contact_id','') is not null then
  perform 1 from public.contacts c where c.id=(p_fields->>'contact_id')::uuid and c.org_id=v_org for key share;
 end if;

 -- Itens: a lista inteira é validada antes de qualquer gravação.
 if p_items is not null then
  if jsonb_array_length(p_items)>100 then raise exception 'Uma oportunidade tem no máximo 100 itens.'; end if;
  for v_item,v_position in select e.value,e.ordinality from jsonb_array_elements(p_items) with ordinality e loop
   v_label:='Item '||v_position;
   if jsonb_typeof(v_item)<>'object' then raise exception '%: dados inválidos.',v_label; end if;
   v_name:=btrim(regexp_replace(coalesce(v_item->>'name',''),'\s+',' ','g'));
   if v_name<>'' then v_label:=v_label||' ('||left(v_name,60)||')'; end if;
   if coalesce(v_item->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception '%: cada item precisa de um identificador.',v_label;
   end if;
   v_id:=(v_item->>'id')::uuid;
   if v_id=any(v_ids) then raise exception '%: o mesmo item aparece duas vezes na lista.',v_label; end if;
   v_ids:=v_ids||v_id;
   if v_name='' then raise exception '%: informe o nome do item.',v_label; end if;
   if length(v_name)>160 then raise exception '%: o nome do item passa de 160 caracteres.',v_label; end if;
   v_unit:=nullif(btrim(coalesce(v_item->>'unit','')),'');
   if length(v_unit)>20 then raise exception '%: a unidade passa de 20 caracteres.',v_label; end if;
   -- Quantidade: texto decimal, maior que zero, com até 3 casas.
   if jsonb_typeof(v_item->'quantity') is distinct from 'string' or (v_item->>'quantity') !~ '^[0-9]{1,12}(\.[0-9]{1,6})?$' then
    raise exception '%: informe uma quantidade maior que zero, com até 3 casas decimais.',v_label;
   end if;
   v_quantity:=(v_item->>'quantity')::numeric;
   if v_quantity<=0 or scale(v_quantity)>3 then
    raise exception '%: informe uma quantidade maior que zero, com até 3 casas decimais.',v_label;
   end if;
   if v_quantity>999999999.999 then raise exception '%: a quantidade passa do limite de 999.999.999,999.',v_label; end if;
   -- Preço unitário: texto decimal, de zero até o limite, com até 2 casas.
   if jsonb_typeof(v_item->'unit_price') is distinct from 'string' or (v_item->>'unit_price') !~ '^[0-9]{1,15}(\.[0-9]{1,6})?$' then
    raise exception '%: informe um preço unitário positivo ou zero, com até duas casas decimais.',v_label;
   end if;
   v_price:=(v_item->>'unit_price')::numeric;
   if scale(v_price)>2 then
    raise exception '%: informe um preço unitário positivo ou zero, com até duas casas decimais.',v_label;
   end if;
   if v_price>999999999999.99 then raise exception '%: o preço unitário passa do limite de R$ 999.999.999.999,99.',v_label; end if;
   v_gross:=round(v_quantity*v_price,2);
   if v_gross>999999999999.99 then
    raise exception '%: o total da linha passa do limite de R$ 999.999.999.999,99. Revise a quantidade e o preço.',v_label;
   end if;
   -- Desconto: sem desconto, em % ou em R$; "desconto 0" vira sem desconto.
   v_discount_type:=nullif(v_item->>'discount_type','');
   if v_discount_type is not null and v_discount_type not in ('percent','amount') then
    raise exception '%: escolha o desconto: sem desconto, %% ou R$.',v_label;
   end if;
   v_discount:=0;
   if v_discount_type is not null then
    if jsonb_typeof(v_item->'discount_value') is distinct from 'string' or (v_item->>'discount_value') !~ '^[0-9]{1,15}(\.[0-9]{1,6})?$' then
     raise exception '%',case when v_discount_type='percent'
      then v_label||': o desconto em % precisa ser maior que 0 e até 100, com até duas casas decimais.'
      else v_label||': informe o desconto em R$ com até duas casas decimais, até o valor bruto da linha.' end;
    end if;
    v_discount:=(v_item->>'discount_value')::numeric;
    if v_discount=0 then
     v_discount_type:=null;
    elsif v_discount_type='percent' and (v_discount>100 or scale(v_discount)>2) then
     raise exception '%: o desconto em %% precisa ser maior que 0 e até 100, com até duas casas decimais.',v_label;
    elsif v_discount_type='amount' and (v_discount>v_gross or scale(v_discount)>2) then
     raise exception '%: informe o desconto em R$ com até duas casas decimais, até o valor bruto da linha.',v_label;
    end if;
   end if;
   v_billing:=v_item->>'billing';
   if v_billing is null or v_billing not in ('one_time','monthly') then
    raise exception '%: escolha a cobrança: única ou mensal.',v_label;
   end if;
   -- Produto: do catálogo da organização; num item novo ou que trocou de produto, ativo.
   v_product:=null;
   if nullif(v_item->>'product_id','') is not null then
    if (v_item->>'product_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
     raise exception '%: um item do catálogo usado nesta oportunidade foi excluído. Escolha outro item ou use um item avulso.',v_label;
    end if;
    v_product:=(v_item->>'product_id')::uuid;
    select p.name,p.archived_at into v_product_name,v_archived from public.products p where p.id=v_product and p.org_id=v_org;
    if not found then
     raise exception '%: um item do catálogo usado nesta oportunidade foi excluído. Escolha outro item ou use um item avulso.',v_label;
    end if;
   end if;
   -- Um id que já existe em outra oportunidade (ou organização) não é deste formulário.
   select i.product_id,i.org_id=v_org and i.deal_id=p_deal_id into v_previous_product,v_same_deal
    from public.deal_items i where i.id=v_id;
   v_previous_found:=found;
   if v_previous_found and not v_same_deal then
    raise exception '%: este item não pertence a esta oportunidade.',v_label;
   end if;
   if not v_previous_found then v_previous_product:=null; end if;
   if v_product is not null and v_archived is not null
    and (not v_previous_found or v_previous_product is distinct from v_product) then
    raise exception '%: “%” foi arquivado no catálogo. Escolha outro item ou use um item avulso.',v_label,v_product_name;
   end if;
   v_rows:=v_rows||jsonb_build_object('id',v_id,'product_id',v_product,'position',v_position-1,'name',v_name,
    'quantity',v_quantity,'unit',v_unit,'unit_price',v_price,'discount_type',v_discount_type,'discount_value',v_discount,
    'billing',v_billing);
  end loop;
 end if;

 -- A partir daqui, grava. A marca vale só nesta transação e é desligada no fim (ligada na sessão, ficaria na conexão
 -- compartilhada do PostgREST, como a guarda crm.bulk_move do 0.7).
 perform set_config('crm.saving_deal_items',p_deal_id::text,true);
 if p_version is null then
  begin
   insert into public.deals(id,org_id,pipeline_id,stage_id,title,status,currency,value,owner_id,contact_id,company_id,
    close_date,probability,lost_reason)
   values(p_deal_id,v_org,nullif(p_fields->>'pipeline_id','')::uuid,nullif(p_fields->>'stage_id','')::uuid,p_fields->>'title',
    coalesce(nullif(p_fields->>'status',''),'open'),coalesce(nullif(p_fields->>'currency',''),'BRL'),
    case when p_items is not null and jsonb_array_length(p_items)>0 then 0 else coalesce(v_value,0) end,
    nullif(p_fields->>'owner_id','')::uuid,nullif(p_fields->>'contact_id','')::uuid,nullif(p_fields->>'company_id','')::uuid,
    nullif(p_fields->>'close_date','')::date,(p_fields->>'probability')::numeric,nullif(p_fields->>'lost_reason',''))
   returning * into v_deal;
  exception when unique_violation then
   -- Duas tentativas simultâneas da mesma criação: a segunda espera o commit da primeira e devolve o que ela gravou.
   perform set_config('crm.saving_deal_items','',true);
   select * into v_deal from public.deals d where d.id=p_deal_id;
   if not found or v_deal.org_id is distinct from v_org then raise exception 'Oportunidade indisponível ou sem acesso.'; end if;
   return jsonb_build_object('deal',to_jsonb(v_deal),
    'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.position,i.id) from public.deal_items i where i.org_id=v_org and i.deal_id=p_deal_id),'[]'::jsonb),
    'replayed',true);
  end;
  -- Sem itens, a criação termina aqui: a inserção já gravou os campos e o valor manual.
  if p_items is null or jsonb_array_length(p_items)=0 then
   perform set_config('crm.saving_deal_items','',true);
   return jsonb_build_object('deal',to_jsonb(v_deal),'items','[]'::jsonb,'replayed',false);
  end if;
 end if;

 if p_items is not null then
  delete from public.deal_items i where i.org_id=v_org and i.deal_id=p_deal_id and i.id<>all(v_ids);
  insert into public.deal_items as i(id,org_id,deal_id,product_id,position,name,quantity,unit,unit_price,discount_type,discount_value,billing)
   select (r->>'id')::uuid,v_org,p_deal_id,nullif(r->>'product_id','')::uuid,(r->>'position')::integer,r->>'name',
    (r->>'quantity')::numeric,nullif(r->>'unit',''),(r->>'unit_price')::numeric,nullif(r->>'discount_type',''),
    (r->>'discount_value')::numeric,r->>'billing'
   from jsonb_array_elements(v_rows) r
  on conflict (id) do update set product_id=excluded.product_id,position=excluded.position,name=excluded.name,
   quantity=excluded.quantity,unit=excluded.unit,unit_price=excluded.unit_price,discount_type=excluded.discount_type,
   discount_value=excluded.discount_value,billing=excluded.billing
   where row(i.product_id,i.position,i.name,i.quantity,i.unit,i.unit_price,i.discount_type,i.discount_value,i.billing)
    is distinct from row(excluded.product_id,excluded.position,excluded.name,excluded.quantity,excluded.unit,
     excluded.unit_price,excluded.discount_type,excluded.discount_value,excluded.billing);
  select count(*),coalesce(sum(i.line_total) filter(where i.billing='one_time'),0),
   coalesce(sum(i.line_total) filter(where i.billing='monthly'),0),coalesce(bool_or(i.billing='monthly'),false)
   into v_count,v_one_time,v_monthly,v_has_monthly
   from public.deal_items i where i.org_id=v_org and i.deal_id=p_deal_id;
  if v_has_monthly then
   if p_contract_months is null or p_contract_months not between 1 and 120 then
    raise exception 'Informe por quantos meses o contrato vale, de 1 a 120.';
   end if;
   v_months:=p_contract_months;
  end if;
  v_contract:=v_one_time+v_monthly*coalesce(v_months,0);
  if v_contract>999999999999.99 then
   raise exception 'O valor do contrato passa do limite de R$ 999.999.999.999,99. Revise as quantidades e os preços.';
  end if;
  if v_count>0 and v_value is not null and v_value<>v_contract then
   raise exception 'O valor desta oportunidade vem dos itens. Para mudar o valor, edite os itens.';
  end if;
 elsif v_deal.item_count>0 and v_value is not null and v_value<>v_deal.value then
  raise exception 'O valor desta oportunidade vem dos itens. Para mudar o valor, edite os itens.';
 end if;

 -- Uma atualização da oportunidade: os campos e, com itens, as partes e o valor do contrato. Sem itens depois da
 -- gravação ([]), as partes ficam nulas e o valor é o enviado ou o que já estava (o último valor calculado).
 update public.deals d set
  title=case when p_version is not null and p_fields ? 'title' then p_fields->>'title' else d.title end,
  currency=case when p_version is not null and p_fields ? 'currency' then p_fields->>'currency' else d.currency end,
  owner_id=case when p_version is not null and p_fields ? 'owner_id' then nullif(p_fields->>'owner_id','')::uuid else d.owner_id end,
  contact_id=case when p_version is not null and p_fields ? 'contact_id' then nullif(p_fields->>'contact_id','')::uuid else d.contact_id end,
  company_id=case when p_version is not null and p_fields ? 'company_id' then nullif(p_fields->>'company_id','')::uuid else d.company_id end,
  close_date=case when p_version is not null and p_fields ? 'close_date' then nullif(p_fields->>'close_date','')::date else d.close_date end,
  probability=case when p_version is not null and p_fields ? 'probability' then (p_fields->>'probability')::numeric else d.probability end,
  lost_reason=case when p_version is not null and p_fields ? 'lost_reason' then nullif(p_fields->>'lost_reason','') else d.lost_reason end,
  closed_at=case when p_version is not null and p_fields ? 'closed_at' then nullif(p_fields->>'closed_at','')::timestamptz else d.closed_at end,
  item_count=case when p_items is not null then v_count else d.item_count end,
  one_time_value=case when p_items is null then d.one_time_value when v_count>0 then v_one_time end,
  monthly_value=case when p_items is null then d.monthly_value when v_count>0 then v_monthly end,
  contract_months=case when p_items is null then d.contract_months when v_count>0 then v_months end,
  value=case when p_items is not null and v_count>0 then v_contract when v_value is not null then v_value else d.value end
  where d.id=p_deal_id and d.org_id=v_org
  returning * into v_deal;
 perform set_config('crm.saving_deal_items','',true);
 select coalesce(jsonb_agg(to_jsonb(i) order by i.position,i.id),'[]'::jsonb) into v_items
  from public.deal_items i where i.org_id=v_org and i.deal_id=p_deal_id;
 return jsonb_build_object('deal',to_jsonb(v_deal),'items',v_items,'replayed',false);
 end;
$$;
create function public.save_deal(p_deal_id uuid,p_version timestamptz default null,p_fields jsonb default null,p_items jsonb default null,
 p_contract_months integer default null) returns jsonb language sql security invoker set search_path='' as $$
 select private.save_deal(p_deal_id,p_version,p_fields,p_items,p_contract_months);
$$;

-- 5. Privacidade (regra do 1.10 para campo novo de texto livre): o nome do item ("Consultoria para Ana Souza") entra
-- na anonimização, no resumo dela e na exportação do titular. O catálogo não tem dado pessoal e fica de fora.

-- O resumo conta, em other_records, os itens de outras oportunidades que citam os termos fortes, com o mesmo predicado
-- da anonimização. O resto é igual a 20261013120000_contact_privacy.sql.
create or replace function private.contact_privacy_counts(p_org uuid,p_contact public.contacts) returns jsonb language plpgsql stable set search_path='' as $$
 declare
  v_deals uuid[];
  v_all text:=private.contact_privacy_regex(p_contact.first_name,p_contact.last_name,p_contact.email,p_contact.phone,false);
  v_strong text:=private.contact_privacy_regex(p_contact.first_name,p_contact.last_name,p_contact.email,p_contact.phone,true);
  v_other integer;
 begin
 select coalesce(array_agg(d.id),'{}') into v_deals from public.deals d where d.org_id=p_org and d.contact_id=p_contact.id;
 v_other:=(select count(*) from public.activities a where a.org_id=p_org and a.contact_id is distinct from p_contact.id
   and a.deal_id=any(v_deals) and (a.title ~* v_all or a.body ~* v_all));
 if v_strong is not null then
  v_other:=v_other
   +(select count(*) from public.activities a where a.org_id=p_org and a.contact_id is distinct from p_contact.id
     and (a.deal_id is null or not a.deal_id=any(v_deals)) and (a.title ~* v_strong or a.body ~* v_strong))
   +(select count(*) from public.deals d where d.org_id=p_org and not d.id=any(v_deals)
     and (d.title ~* v_strong or d.lost_reason ~* v_strong))
   +(select count(*) from public.deal_items i where i.org_id=p_org and not i.deal_id=any(v_deals) and i.name ~* v_strong)
   +(select count(*) from public.payments p where p.org_id=p_org and p.contact_id is distinct from p_contact.id
     and (p.deal_id is null or not p.deal_id=any(v_deals)) and p.description ~* v_strong)
   +(select count(*) from public.contacts c where c.org_id=p_org and c.id<>p_contact.id
     and (c.notes ~* v_strong or c.source ~* v_strong or c.job_title ~* v_strong or c.legal_basis_note ~* v_strong
      or c.do_not_contact_reason ~* v_strong))
   +(select count(*) from public.companies co where co.org_id=p_org and co.do_not_contact_reason ~* v_strong);
 end if;
 return jsonb_build_object(
  'activities_scrubbed',(select count(*) from public.activities a where a.org_id=p_org and a.contact_id=p_contact.id
    and (a.completed_at is not null or a.type='note')),
  'activities_deleted',(select count(*) from public.activities a where a.org_id=p_org and a.contact_id=p_contact.id
    and a.completed_at is null and a.type<>'note'),
  'deals',cardinality(v_deals),
  'open_deals',(select count(*) from public.deals d where d.org_id=p_org and d.id=any(v_deals) and d.status='open'),
  'payments',(select count(*) from public.payments p where p.org_id=p_org and (p.contact_id=p_contact.id or p.deal_id=any(v_deals))),
  'pending_payments',(select count(*) from public.payments p where p.org_id=p_org
    and (p.contact_id=p_contact.id or p.deal_id=any(v_deals)) and p.status='pending'),
  'other_records',v_other);
 end;
$$;

-- A anonimização, com o corpo de 20261018100000_privacy_followup.sql e dois acréscimos: no item 3, todos os termos no
-- nome dos itens das oportunidades da pessoa (contados nas oportunidades, sem número novo); no item 4, os termos fortes
-- no nome dos itens das demais oportunidades (somados a other_records). O nome fica no limite de 160 caracteres por
-- fit_redacted_text. As oportunidades da pessoa já estão travadas antes; save_deal trava a oportunidade antes dos itens:
-- a mesma ordem. Mesma assinatura e mesmo SECURITY DEFINER: os grants ficam.
create or replace function private.anonymize_contact(p_contact_id uuid,p_version timestamptz) returns jsonb language plpgsql security definer set search_path='' as $$
 declare
  v_org uuid;
  v_contact public.contacts;
  v_deals uuid[];
  v_all text;
  v_strong text;
  v_scrubbed integer;
  v_deleted integer;
  v_deal_count integer;
  v_open_deals integer;
  v_payment_count integer;
  v_pending_payments integer;
  v_other integer:=0;
  v_n integer;
  v_item_deals uuid[];
  v_summary jsonb;
 begin
 v_org:=private.current_org();
 if auth.uid() is null or v_org is null or not private.can_manage() then
  raise exception 'Somente donos e administradores anonimizam contatos.';
 end if;
 select * into v_contact from public.contacts c where c.id=p_contact_id and c.org_id=v_org;
 if not found then raise exception 'Este contato não está mais disponível. Atualize a página.'; end if;
 if v_contact.anonymized_at is not null then raise exception 'Este contato já foi anonimizado.'; end if;
 select coalesce(array_agg(d.id),'{}') into v_deals from public.deals d where d.org_id=v_org and d.contact_id=p_contact_id;
 perform 1 from public.deals d where d.org_id=v_org and d.contact_id=p_contact_id for no key update;
 perform 1 from public.activities a where a.org_id=v_org and (a.contact_id=p_contact_id or a.deal_id=any(v_deals)) for no key update;
 perform 1 from public.payments p where p.org_id=v_org and (p.contact_id=p_contact_id or p.deal_id=any(v_deals)) for no key update;
 select * into v_contact from public.contacts c where c.id=p_contact_id and c.org_id=v_org for update;
 if not found then raise exception 'Este contato não está mais disponível. Atualize a página.'; end if;
 if v_contact.anonymized_at is not null then raise exception 'Este contato já foi anonimizado.'; end if;
 if v_contact.updated_at is distinct from p_version then
  raise exception 'Este contato mudou desde o resumo. Confira o resumo atualizado e confirme de novo.';
 end if;
 -- Releitura com o contato travado.
 select coalesce(array_agg(d.id),'{}') into v_deals from public.deals d where d.org_id=v_org and d.contact_id=p_contact_id;
 select count(*) into v_open_deals from public.deals d where d.org_id=v_org and d.id=any(v_deals) and d.status='open';
 select count(*) into v_pending_payments from public.payments p
  where p.org_id=v_org and (p.contact_id=p_contact_id or p.deal_id=any(v_deals)) and p.status='pending';
 v_all:=private.contact_privacy_regex(v_contact.first_name,v_contact.last_name,v_contact.email,v_contact.phone,false);
 v_strong:=private.contact_privacy_regex(v_contact.first_name,v_contact.last_name,v_contact.email,v_contact.phone,true);
 -- A marca da anonimização em andamento, só nesta transação, até o fim do item 5. Os gatilhos de contacts a comparam
 -- com o id da linha, e só o UPDATE do item 5 grava o contato da pessoa.
 perform set_config('crm.anonymizing_contact',p_contact_id::text,true);
 -- 1. As ações pendentes com a pessoa saem (o registro de automação que as criou fica, sem o vínculo).
 delete from public.activities a where a.org_id=v_org and a.contact_id=p_contact_id and a.completed_at is null and a.type<>'note';
 get diagnostics v_deleted=row_count;
 -- 2. O que ficou com a pessoa perde o texto: o título pelo tipo, sem detalhes. Tipo, resultado, datas, responsável,
 -- oportunidade, empresa e o vínculo com o contato ficam.
 update public.activities a set title=case a.type when 'call' then 'Ligação' when 'whatsapp' then 'WhatsApp'
   when 'email' then 'E-mail' when 'meeting' then 'Reunião' when 'visit' then 'Visita' when 'note' then 'Nota'
   else 'Tarefa' end||' (contato anonimizado)',
  body=null
  where a.org_id=v_org and a.contact_id=p_contact_id;
 get diagnostics v_scrubbed=row_count;
 -- 3. Oportunidades e recebimentos da pessoa, e as atividades dessas oportunidades com outros contatos (ou sem
 -- contato): todos os termos; o vínculo com o contato sai, e as automações dessas oportunidades não falham por ele.
 update public.deals d set title=private.redact_personal_terms(d.title,v_all),
  lost_reason=private.redact_personal_terms(d.lost_reason,v_all),contact_id=null
  where d.org_id=v_org and d.id=any(v_deals);
 get diagnostics v_deal_count=row_count;
 -- Item 1.16: o nome dos itens dessas oportunidades, contados nas oportunidades.
 update public.deal_items i set name=private.fit_redacted_text(private.redact_personal_terms(i.name,v_all),160)
  where i.org_id=v_org and i.deal_id=any(v_deals) and i.name ~* v_all;
 update public.payments p set description=private.redact_personal_terms(p.description,v_all),
  contact_id=case when p.contact_id=p_contact_id then null else p.contact_id end
  where p.org_id=v_org and (p.contact_id=p_contact_id or p.deal_id=any(v_deals));
 get diagnostics v_payment_count=row_count;
 update public.activities a set title=private.redact_personal_terms(a.title,v_all),body=private.redact_personal_terms(a.body,v_all)
  where a.org_id=v_org and a.contact_id is distinct from p_contact_id and a.deal_id=any(v_deals)
   and (a.title ~* v_all or a.body ~* v_all);
 get diagnostics v_n=row_count;
 v_other:=v_other+v_n;
 -- 4. O resto da organização: só os termos fortes (nome completo, e-mail e telefone), porque o primeiro nome sozinho
 -- apagaria outras pessoas. Nos outros contatos, todos os campos de texto livre (observações, origem, cargo, registro
 -- da base legal e motivo do "Não contatar": "Indicação de Ana Souza", o consentimento dado pela mãe); nas empresas, só
 -- o motivo do "Não contatar" (nome e site são da pessoa jurídica). Os campos de até 500 caracteres ficam no limite, e
 -- a troca não falha num texto longo. Funis, modelos, automações e equipe não mudam.
 if v_strong is not null then
  update public.activities a set title=private.redact_personal_terms(a.title,v_strong),body=private.redact_personal_terms(a.body,v_strong)
   where a.org_id=v_org and a.contact_id is distinct from p_contact_id and (a.deal_id is null or not a.deal_id=any(v_deals))
    and (a.title ~* v_strong or a.body ~* v_strong);
  get diagnostics v_n=row_count;
  v_other:=v_other+v_n;
  update public.deals d set title=private.redact_personal_terms(d.title,v_strong),
   lost_reason=private.redact_personal_terms(d.lost_reason,v_strong)
   where d.org_id=v_org and not d.id=any(v_deals) and (d.title ~* v_strong or d.lost_reason ~* v_strong);
  get diagnostics v_n=row_count;
  v_other:=v_other+v_n;
  -- Item 1.16: o nome dos itens das demais oportunidades. As oportunidades desses itens são travadas antes (a ordem de
  -- save_deal: oportunidade, depois itens), e as que tiveram item renomeado ganham versão nova (touch_updated_at; a
  -- auditoria ignora a mudança só em updated_at): a lista de itens lida antes da anonimização, com o nome antigo, cai
  -- na guarda de versão de save_deal em vez de gravar o dado de novo. As oportunidades da pessoa já ganharam versão
  -- nova no item 3.
  select coalesce(array_agg(x.id),'{}') into v_item_deals from (
   select d.id from public.deals d where d.org_id=v_org and not d.id=any(v_deals)
    and exists(select 1 from public.deal_items i where i.org_id=v_org and i.deal_id=d.id and i.name ~* v_strong)
   order by d.id for no key update) x;
  with renamed as (
   update public.deal_items i set name=private.fit_redacted_text(private.redact_personal_terms(i.name,v_strong),160)
    where i.org_id=v_org and i.deal_id=any(v_item_deals) and i.name ~* v_strong
    returning i.deal_id)
  select count(*),coalesce(array_agg(distinct r.deal_id),'{}') into v_n,v_item_deals from renamed r;
  v_other:=v_other+v_n;
  update public.deals d set updated_at=d.updated_at where d.org_id=v_org and d.id=any(v_item_deals);
  update public.payments p set description=private.redact_personal_terms(p.description,v_strong)
   where p.org_id=v_org and p.contact_id is distinct from p_contact_id and (p.deal_id is null or not p.deal_id=any(v_deals))
    and p.description ~* v_strong;
  get diagnostics v_n=row_count;
  v_other:=v_other+v_n;
  update public.contacts c set notes=private.redact_personal_terms(c.notes,v_strong),
   source=private.redact_personal_terms(c.source,v_strong),job_title=private.redact_personal_terms(c.job_title,v_strong),
   legal_basis_note=private.fit_redacted_text(private.redact_personal_terms(c.legal_basis_note,v_strong),500),
   do_not_contact_reason=private.fit_redacted_text(private.redact_personal_terms(c.do_not_contact_reason,v_strong),500)
   where c.org_id=v_org and c.id<>p_contact_id
    and (c.notes ~* v_strong or c.source ~* v_strong or c.job_title ~* v_strong or c.legal_basis_note ~* v_strong
     or c.do_not_contact_reason ~* v_strong);
  get diagnostics v_n=row_count;
  v_other:=v_other+v_n;
  update public.companies co set do_not_contact_reason=private.fit_redacted_text(private.redact_personal_terms(co.do_not_contact_reason,v_strong),500)
   where co.org_id=v_org and co.do_not_contact_reason ~* v_strong;
  get diagnostics v_n=row_count;
  v_other:=v_other+v_n;
 end if;
 -- 5. O cadastro: "Contato anonimizado", sem dados pessoais, com "Não contatar" ligado e a data e o autor da
 -- anonimização. A base legal fica, sem o registro. O e-mail sai do índice único: a pessoa pode ser cadastrada de novo
 -- como um contato novo.
 update public.contacts c set first_name='Contato anonimizado',last_name=null,email=null,phone=null,job_title=null,notes=null,
  source=private.redact_personal_terms(c.source,v_all),company_id=null,do_not_contact=true,do_not_contact_reason=null,
  legal_basis_note=null,anonymized_at=now(),anonymized_by=auth.uid()
  where c.id=p_contact_id and c.org_id=v_org;
 perform set_config('crm.anonymizing_contact','',true);
 v_summary:=jsonb_build_object('activities_scrubbed',v_scrubbed,'activities_deleted',v_deleted,'deals',v_deal_count,
  'open_deals',v_open_deals,'payments',v_payment_count,'pending_payments',v_pending_payments,'other_records',v_other);
 insert into public.privacy_actions(org_id,contact_id,action,performed_by,summary)
  values(v_org,p_contact_id,'anonymize',auth.uid(),v_summary);
 return v_summary;
 end;
$$;

-- A exportação do titular, com o corpo de 20261013120000_contact_privacy.sql e um acréscimo: cada oportunidade leva o
-- total único, a mensalidade, os meses do contrato e os itens, em ordem (nome, código e tipo do item do catálogo,
-- quantidade, unidade, preço unitário, desconto, cobrança e total da linha). Um item avulso vai sem código e sem tipo.
create or replace function private.export_contact_data(p_contact_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
 declare
  v_org uuid;
  v_contact public.contacts;
  v_deals uuid[];
  v_activities jsonb;
  v_deal_rows jsonb;
  v_payments jsonb;
 begin
 v_org:=private.current_org();
 if auth.uid() is null or v_org is null or not private.can_manage() then
  raise exception 'Somente donos e administradores exportam os dados de um contato.';
 end if;
 select * into v_contact from public.contacts c where c.id=p_contact_id and c.org_id=v_org;
 if not found then raise exception 'Este contato não está mais disponível. Atualize a página.'; end if;
 select coalesce(array_agg(d.id),'{}') into v_deals from public.deals d where d.org_id=v_org and d.contact_id=p_contact_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'type',a.type,'title',private.redact_personal_terms(a.title,o.terms),
   'body',private.redact_personal_terms(a.body,o.terms),'due_date',a.due_date,
   'end_date',a.end_date,'completed_at',a.completed_at,'outcome',a.outcome,'created_at',a.created_at,'deal_id',a.deal_id,
   'relation',case when a.contact_id=p_contact_id then 'person' when a.contact_id is null then 'no_contact' else 'other_contact' end)
   order by coalesce(a.completed_at,a.due_date,a.created_at),a.id),'[]'::jsonb)
  into v_activities from public.activities a
  left join lateral (select private.contact_privacy_regex(oc.first_name,oc.last_name,oc.email,oc.phone,false) as terms
   from public.contacts oc where oc.id=a.contact_id and oc.org_id=a.org_id and oc.id<>p_contact_id and oc.anonymized_at is null) o on true
  where a.org_id=v_org and (a.contact_id=p_contact_id or a.deal_id=any(v_deals));
 select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'title',d.title,'value',d.value,'currency',d.currency,'status',d.status,
   'pipeline',pl.name,'stage',st.name,'close_date',d.close_date,'closed_at',d.closed_at,'lost_reason',d.lost_reason,
   'created_at',d.created_at,'one_time_value',d.one_time_value,'monthly_value',d.monthly_value,
   'contract_months',d.contract_months,
   'items',(select coalesce(jsonb_agg(jsonb_build_object('name',i.name,'product_code',pr.code,'product_kind',pr.kind,
      'quantity',i.quantity,'unit',i.unit,'unit_price',i.unit_price,'discount_type',i.discount_type,
      'discount_value',i.discount_value,'billing',i.billing,'line_total',i.line_total) order by i.position,i.id),'[]'::jsonb)
     from public.deal_items i left join public.products pr on pr.id=i.product_id and pr.org_id=i.org_id
     where i.org_id=d.org_id and i.deal_id=d.id)) order by d.created_at,d.id),'[]'::jsonb)
  into v_deal_rows from public.deals d
  left join public.pipelines pl on pl.id=d.pipeline_id and pl.org_id=d.org_id
  left join public.pipeline_stages st on st.id=d.stage_id and st.org_id=d.org_id
  where d.org_id=v_org and d.id=any(v_deals);
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'description',private.redact_personal_terms(p.description,o.terms),
   'amount',p.amount,'currency',p.currency,
   'status',p.status,'due_date',p.due_date,'paid_at',p.paid_at,'deal_id',p.deal_id,'created_at',p.created_at)
   order by p.due_date,p.created_at,p.id),'[]'::jsonb)
  into v_payments from public.payments p
  left join lateral (select private.contact_privacy_regex(oc.first_name,oc.last_name,oc.email,oc.phone,false) as terms
   from public.contacts oc where oc.id=p.contact_id and oc.org_id=p.org_id and oc.id<>p_contact_id and oc.anonymized_at is null) o on true
  where p.org_id=v_org and (p.contact_id=p_contact_id or p.deal_id=any(v_deals));
 insert into public.privacy_actions(org_id,contact_id,action,performed_by,summary)
  values(v_org,p_contact_id,'export',auth.uid(),jsonb_build_object('activities',jsonb_array_length(v_activities),
   'deals',jsonb_array_length(v_deal_rows),'payments',jsonb_array_length(v_payments)));
 return jsonb_build_object(
  'format',1,
  'generated_at',now(),
  'organization',(select jsonb_build_object('name',o.name) from public.organizations o where o.id=v_org),
  'contact',jsonb_build_object('id',v_contact.id,'first_name',v_contact.first_name,'last_name',v_contact.last_name,
   'email',v_contact.email,'phone',v_contact.phone,'job_title',v_contact.job_title,'source',v_contact.source,
   'notes',v_contact.notes,'status',v_contact.status,'created_at',v_contact.created_at,'updated_at',v_contact.updated_at,
   'legal_basis',v_contact.legal_basis,'legal_basis_note',v_contact.legal_basis_note,'legal_basis_at',v_contact.legal_basis_at,
   'do_not_contact',v_contact.do_not_contact,'do_not_contact_at',v_contact.do_not_contact_at,
   'do_not_contact_reason',v_contact.do_not_contact_reason,'anonymized_at',v_contact.anonymized_at),
  'company',(select jsonb_build_object('id',co.id,'name',co.name) from public.companies co
   where co.id=v_contact.company_id and co.org_id=v_org),
  'activities',v_activities,
  'deals',v_deal_rows,
  'payments',v_payments);
 end;
$$;

-- 6. Execução: a RPC para authenticated (nunca anon; o padrão da base: a pública chama a privada como quem pediu); a
-- função de gatilho para nenhum papel da API.
revoke execute on function private.protect_deal_totals() from public,anon,authenticated,service_role;
revoke execute on function private.save_deal(uuid,timestamptz,jsonb,jsonb,integer),public.save_deal(uuid,timestamptz,jsonb,jsonb,integer) from public,anon;
grant execute on function private.save_deal(uuid,timestamptz,jsonb,jsonb,integer),public.save_deal(uuid,timestamptz,jsonb,jsonb,integer) to authenticated;
