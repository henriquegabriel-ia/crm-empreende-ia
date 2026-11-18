-- Leituras da Fecha IA (item B20 da Fecha IA; supabase/functions/README.md, "Leituras"). Duas operações novas do
-- contrato v1, somente leitura, desligadas em toda conexão até um dono ou administrador ligar cada uma no cartão de
-- Integrações: "context" (o contato, a empresa e a oportunidade escolhidos, os compromissos em aberto, as últimas
-- atividades e as revisões já entregues) e "outcomes" (a situação, a fase, a data de fechamento e o primeiro
-- recebimento pago das oportunidades das reuniões). Nenhuma leitura leva e-mail ou telefone, cada uma fica registrada
-- e há um limite por conexão. As funções da base que esta migração recria são private.fecha_connection_summary,
-- private.manage_fecha_ai_connections e private.fecha_ai_integration, as três da migração do receptor; as guardas
-- vêm antes de tudo: numa instância que alterou uma delas à mão, a migração inteira para sem aplicar nada.
select private.assert_base_definition('function', 'private.fecha_connection_summary(private.fecha_ai_connections)', array['fc95cc27b9c68d41']);
select private.assert_base_definition('function', 'private.manage_fecha_ai_connections(uuid,jsonb,text)', array['d7f8e5127ae244ec']);
select private.assert_base_definition('function', 'private.fecha_ai_integration(text,jsonb,text,text)', array['e48da7f6d05a7eb0']);

-- As leituras ligadas em cada conexão. Vazio (o padrão, inclusive nas conexões que já existem) é a conexão de antes:
-- ela só recebe revisões, e o describe dela não anuncia leitura nenhuma.
alter table private.fecha_ai_connections add column read_scopes text[] not null default '{}'
 check(read_scopes <@ array['context','outcomes']::text[] and cardinality(read_scopes)<=2);
alter table private.fecha_ai_connection_events drop constraint fecha_ai_connection_events_action_check;
alter table private.fecha_ai_connection_events add constraint fecha_ai_connection_events_action_check
 check(action in ('create','revoke','set_actors','set_read_scopes'));
-- As leituras de cada evento de criação e de troca das leituras (nulo nos eventos de antes delas e nos demais).
alter table private.fecha_ai_connection_events add column read_scopes text[];
-- O registro das leituras: quem pediu na Fecha IA, em nome de qual pessoa do CRM, de quais registros (ou quantas
-- oportunidades) e quando. Só ids e contagens, nenhum texto. Serve também ao limite por conexão.
create table private.fecha_ai_read_events (
 id uuid primary key default gen_random_uuid(), connection_id uuid not null, org_id uuid not null,
 operation text not null check(operation in ('context','outcomes')),
 actor_id uuid not null references public.profiles(id), source_user_id uuid not null,
 contact_id uuid, company_id uuid, deal_id uuid, deal_count integer check(deal_count between 1 and 100),
 created_at timestamptz not null default clock_timestamp(),
 foreign key(connection_id,org_id) references private.fecha_ai_connections(id,org_id),
 check((operation='context')=(deal_count is null))
);
create index fecha_read_events_connection_time on private.fecha_ai_read_events(connection_id,created_at desc);
create index fecha_read_events_org on private.fecha_ai_read_events(org_id,created_at desc);
create index fecha_read_events_actor on private.fecha_ai_read_events(actor_id);
-- As notas das revisões entregues ficam fora das últimas atividades do contexto (elas já são as revisões).
create index fecha_deliveries_note on private.fecha_ai_deliveries(note_id);
alter table private.fecha_ai_read_events enable row level security;
revoke all on private.fecha_ai_read_events from public,anon,authenticated,service_role;

-- O resumo da conexão para o cartão, com as leituras só quando há alguma: a conexão sem leitura devolve o resumo de
-- antes, e a função de gerenciamento publicada antes desta migração continua lendo a lista.
create or replace function private.fecha_connection_summary(c private.fecha_ai_connections) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('id',c.id,'name',c.name,'sourceOrganizationId',c.source_org_id,'destinationOrganizationId',c.org_id,
 'allowedActorIds',c.allowed_actor_ids,'expiresAt',c.expires_at,'createdAt',c.created_at,'createdBy',c.created_by,'revokedAt',c.revoked_at)
 ||case when cardinality(c.read_scopes)>0 then jsonb_build_object('readScopes',to_jsonb(c.read_scopes)) else '{}'::jsonb end;
$$;
-- As leituras pedidas no gerenciamento: ausente vale nenhuma; uma lista de "context" e "outcomes", sem repetir.
create function private.fecha_read_scopes(p_value jsonb) returns text[] language plpgsql immutable set search_path='' as $$
declare v_scopes text[];
begin
 if p_value is null then return '{}'; end if;
 if jsonb_typeof(p_value) is distinct from 'array' or jsonb_array_length(p_value)>2
  or exists(select 1 from jsonb_array_elements(p_value) x where jsonb_typeof(x)<>'string' or x#>>'{}' not in ('context','outcomes'))
 then raise exception using message='invalid_read_scopes'; end if;
 select coalesce(array_agg(distinct x order by x),'{}') into v_scopes from jsonb_array_elements_text(p_value) x;
 if cardinality(v_scopes)<>jsonb_array_length(p_value) then raise exception using message='invalid_read_scopes'; end if;
 return v_scopes;
end $$;

-- O gerenciamento, com o corpo da migração do receptor e dois acréscimos: as leituras na criação ("readScopes",
-- opcional) e a operação set_read_scopes, que troca as leituras de uma conexão ativa, com o evento registrado.
create or replace function private.manage_fecha_ai_connections(p_actor_id uuid,p_request jsonb,p_token_hash text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_org uuid; v_op text:=p_request->>'operation'; v_connection private.fecha_ai_connections; v_ids uuid[]; v_expiry timestamptz; v_result jsonb;
 v_scopes text[];
begin
 select org_id into v_org from public.profiles where id=p_actor_id;
 if v_org is null then raise exception using message='forbidden'; end if;
 if (p_request->>'organizationId')::uuid is distinct from v_org then raise exception using message='scope_mismatch'; end if;
 perform private.fecha_require_actor(v_org,p_actor_id,true);
 if v_op='list' then
  select coalesce(jsonb_agg(private.fecha_connection_summary(c) order by c.created_at desc),'[]'::jsonb) into v_result from private.fecha_ai_connections c where org_id=v_org;
  return jsonb_build_object('connections',v_result);
 elsif v_op='actor_options' then
  select coalesce(jsonb_agg(private.fecha_actor_choice(v_org,p.id) order by p.name,p.id),'[]'::jsonb) into v_result
  from public.profiles p join public.user_roles r on r.user_id=p.id and r.org_id=p.org_id where p.org_id=v_org and r.deactivated_at is null and r.role in ('owner','admin','member');
  return jsonb_build_object('organizationId',v_org,'actors',v_result);
 elsif v_op in ('create','set_actors') then
  select array_agg(value::uuid order by value) into v_ids from jsonb_array_elements_text(p_request->'allowedActorIds');
  perform private.fecha_validate_actors(v_org,v_ids);
 end if;
 if v_op in ('create','set_read_scopes') then
  v_scopes=private.fecha_read_scopes(p_request->'readScopes');
  if v_op='set_read_scopes' and p_request->'readScopes' is null then raise exception using message='invalid_read_scopes'; end if;
 end if;
 if v_op='create' then
  v_expiry=(p_request->>'expiresAt')::timestamptz;
  if not isfinite(v_expiry) or v_expiry<clock_timestamp()+interval '1 hour' or v_expiry>clock_timestamp()+interval '90 days' then raise exception using message='invalid_expiry'; end if;
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception using message='invalid_token_hash'; end if;
  insert into private.fecha_ai_connections(org_id,source_org_id,name,token_hash,allowed_actor_ids,expires_at,created_by,read_scopes)
  values(v_org,(p_request->>'sourceOrganizationId')::uuid,trim(p_request->>'name'),p_token_hash,v_ids,v_expiry,p_actor_id,v_scopes) returning * into v_connection;
 elsif v_op in ('revoke','set_actors','set_read_scopes') then
  select * into v_connection from private.fecha_ai_connections where id=(p_request->>'connectionId')::uuid and org_id=v_org for update;
  if not found then raise exception using message='connection_not_found'; end if;
  if v_op='revoke' then update private.fecha_ai_connections set revoked_at=coalesce(revoked_at,clock_timestamp()) where id=v_connection.id returning * into v_connection;
  else
   if v_connection.revoked_at is not null or v_connection.expires_at<=clock_timestamp() then raise exception using message='connection_inactive'; end if;
   if v_op='set_actors' then update private.fecha_ai_connections set allowed_actor_ids=v_ids where id=v_connection.id returning * into v_connection;
   else update private.fecha_ai_connections set read_scopes=v_scopes where id=v_connection.id returning * into v_connection; end if;
  end if;
 else raise exception using message='invalid_operation'; end if;
 insert into private.fecha_ai_connection_events(connection_id,actor_id,action,allowed_actor_ids,read_scopes)
 values(v_connection.id,p_actor_id,v_op,v_connection.allowed_actor_ids,case when v_op in ('create','set_read_scopes') then v_connection.read_scopes end);
 return jsonb_build_object('connection',private.fecha_connection_summary(v_connection));
end $$;

-- Data e hora em UTC com milissegundos, o formato de Date.toISOString(): o mesmo texto em qualquer fuso da sessão.
create function private.fecha_iso(p_value timestamptz) returns text language sql stable set search_path='' as $$
 select to_char(p_value at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
$$;
-- Texto livre lido do CRM (títulos, trechos dos detalhes, motivo de perda), no formato do contrato (text(max)): sem o
-- espaço externo do trim() do JavaScript (os mesmos caracteres de private.fecha_label) e com até p_units unidades
-- UTF-16; nulo quando não sobra nada. Antes do corte, os endereços de e-mail e os telefones no formato brasileiro (com
-- DDD, ou celular de nove dígitos) viram "[e-mail omitido]" e "[telefone omitido]": nenhuma leitura leva o e-mail ou o
-- telefone de alguém, nem digitado numa nota. Os caracteres de controle, fora a quebra de linha e a tabulação, viram
-- espaço (no JSON, cada um ocuparia seis bytes). Só o começo do texto é examinado (p_units mais 200 caracteres): cabe
-- todo o trecho e o telefone que começa nele.
create function private.fecha_read_text(p_value text,p_units integer) returns text language plpgsql immutable set search_path='' as $$
declare
 v_spaces constant text:=chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)
  ||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)
  ||chr(8287)||chr(12288)||chr(65279);
 v_value text; v_cut text:=''; v_char text; v_units integer:=0;
begin
 v_value:=regexp_replace(left(coalesce(p_value,''),p_units+200),'[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]',' ','g');
 v_value:=regexp_replace(v_value,'[[:alnum:]._%+-]+@[[:alnum:]-]+(\.[[:alnum:]-]+)*\.[[:alpha:]]{2,}','[e-mail omitido]','g');
 v_value:=regexp_replace(v_value,'(^|[^0-9+])((\+?55[ .-]?)?\(?[1-9][0-9]\)?[ .-]?9?[0-9]{4}[ .-]?[0-9]{4}|9[0-9]{4}[ .-]?[0-9]{4})(?=[^0-9]|$)','\1[telefone omitido]','g');
 v_value:=btrim(v_value,v_spaces);
 if length(v_value)*2>p_units then
  foreach v_char in array regexp_split_to_array(v_value,'') loop
   v_units:=v_units+case when ascii(v_char)>65535 then 2 else 1 end;
   exit when v_units>p_units;
   v_cut:=v_cut||v_char;
  end loop;
  v_value:=btrim(v_cut,v_spaces);
 end if;
 return nullif(v_value,'');
end $$;
-- O nome de cada tipo de atividade, quando o título lido fica vazio (os nomes de private.anonymize_contact).
create function private.fecha_activity_label(p_type text) returns text language sql immutable set search_path='' as $$
 select case p_type when 'call' then 'Ligação' when 'whatsapp' then 'WhatsApp' when 'email' then 'E-mail' when 'meeting' then 'Reunião'
  when 'visit' then 'Visita' when 'note' then 'Nota' else 'Tarefa' end;
$$;
-- A fase da oportunidade: o nome, a posição no funil (a partir de 1, pela ordem e pelo id) e quantas fases ele tem.
create function private.fecha_stage(p_org uuid,p_pipeline uuid,p_stage uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('label',coalesce(private.fecha_read_text(s.name,120),'Fase '||x.position),'position',x.position,'count',x.total)
 from public.pipeline_stages s
 cross join lateral (select (count(*) filter (where (o."order",o.id)<=(s."order",s.id)))::integer as position,count(*)::integer as total
  from public.pipeline_stages o where o.org_id=p_org and o.pipeline_id=p_pipeline) x
 where s.id=p_stage and s.org_id=p_org and s.pipeline_id=p_pipeline;
$$;

-- As oportunidades de "outcomes": de 1 a 100 ids, sem repetir. Conferidas antes do registro da leitura.
create function private.fecha_read_deal_ids(p_request jsonb) returns uuid[] language plpgsql immutable set search_path='' as $$
declare v_ids uuid[];
begin
 if jsonb_typeof(p_request->'dealIds') is distinct from 'array' then raise exception using message='invalid_read'; end if;
 select array_agg(value::uuid) into v_ids from jsonb_array_elements_text(p_request->'dealIds');
 if coalesce(cardinality(v_ids),0) not between 1 and 100 or cardinality(v_ids)<>(select count(distinct x) from unnest(v_ids) x)
 then raise exception using message='invalid_read'; end if;
 return v_ids;
end $$;

-- A guarda de toda leitura, sob a trava da conexão (FOR UPDATE em private.fecha_ai_integration): a leitura ligada na
-- conexão, a pessoa do CRM entre as autorizadas e ativa com papel que edita (como um autor, sem trava), o limite de 30
-- leituras por minuto por conexão e o registro em private.fecha_ai_read_events. Uma leitura recusada adiante (registro
-- inexistente, contato anonimizado) desfaz o registro e não conta no limite.
create function private.fecha_read_guard(c private.fecha_ai_connections,p_request jsonb,p_scope text) returns void language plpgsql set search_path='' as $$
declare v_actor uuid; v_user uuid;
begin
 if not (p_scope=any(c.read_scopes)) then raise exception using message='read_not_allowed'; end if;
 v_actor=(p_request->>'destinationActorId')::uuid; v_user=(p_request->>'sourceUserId')::uuid;
 if v_actor is null or v_user is null then raise exception using message='invalid_read'; end if;
 if not (v_actor=any(c.allowed_actor_ids)) then raise exception using message='actor_not_allowed'; end if;
 perform private.fecha_require_actor(c.org_id,v_actor,false,false);
 if (select count(*) from private.fecha_ai_read_events e where e.connection_id=c.id and e.created_at>clock_timestamp()-interval '1 minute')>=30
 then raise exception using message='read_rate_limited'; end if;
 insert into private.fecha_ai_read_events(connection_id,org_id,operation,actor_id,source_user_id,contact_id,company_id,deal_id,deal_count)
 values(c.id,c.org_id,p_scope,v_actor,v_user,
  case when p_scope='context' then (p_request#>>'{target,contactId}')::uuid end,
  case when p_scope='context' then (p_request#>>'{target,companyId}')::uuid end,
  case when p_scope='context' then (p_request#>>'{target,dealId}')::uuid end,
  case when p_scope='outcomes' then cardinality(private.fecha_read_deal_ids(p_request)) end);
end $$;
-- "context": cada registro pedido, lido por si (sem conferir a relação entre eles, que é da entrega), e o que está
-- ligado a qualquer um deles. Contato: o nome, a situação e o "Não contatar", nunca e-mail, telefone nem observações
-- (contacts.notes fica de fora até uma decisão do dono da Fecha IA); o anonimizado é recusado (target_anonymized).
-- Oportunidade: o título, a situação, a fase, a entrada na fase, o fechamento e o motivo de perda (só da perdida).
-- Compromissos: até 10 atividades pendentes que não são nota, pelo prazo. Últimas atividades: até 10 notas e ações
-- concluídas, da mais recente, com até 500 caracteres dos detalhes, sem as notas das revisões entregues. Revisões: até
-- 20 entregas desta equipe da Fecha IA a esses registros, de qualquer conexão dela com esta organização.
create function private.fecha_read_context(c private.fecha_ai_connections,p_request jsonb) returns jsonb language plpgsql set search_path='' as $$
declare v_contact uuid; v_company uuid; v_deal uuid; v_contact_row public.contacts; v_deal_row public.deals; v_company_label text;
begin
 if jsonb_typeof(p_request->'target') is distinct from 'object' then raise exception using message='invalid_read'; end if;
 v_contact=(p_request#>>'{target,contactId}')::uuid; v_company=(p_request#>>'{target,companyId}')::uuid; v_deal=(p_request#>>'{target,dealId}')::uuid;
 if v_contact is null and v_company is null and v_deal is null then raise exception using message='target_required'; end if;
 if v_contact is not null then
  select * into v_contact_row from public.contacts where id=v_contact and org_id=c.org_id;
  if not found then raise exception using message='target_not_found'; end if;
  if v_contact_row.anonymized_at is not null then raise exception using message='target_anonymized'; end if;
 end if;
 if v_company is not null then
  select private.fecha_label(array[name,id::text]) into v_company_label from public.companies where id=v_company and org_id=c.org_id;
  if not found then raise exception using message='target_not_found'; end if;
 end if;
 if v_deal is not null then
  select * into v_deal_row from public.deals where id=v_deal and org_id=c.org_id;
  if not found then raise exception using message='target_not_found'; end if;
 end if;
 return private.fecha_scope(c)||jsonb_build_object(
  'readAt',private.fecha_iso(clock_timestamp()),
  'contact',case when v_contact is not null then jsonb_build_object('id',v_contact,
   'label',private.fecha_label(array[v_contact_row.first_name||' '||coalesce(v_contact_row.last_name,''),v_contact::text]),
   'status',v_contact_row.status,'doNotContact',v_contact_row.do_not_contact) end,
  'company',case when v_company is not null then jsonb_build_object('id',v_company,'label',v_company_label) end,
  'deal',case when v_deal is not null then jsonb_build_object('id',v_deal,'label',private.fecha_label(array[v_deal_row.title,v_deal::text]),
   'status',v_deal_row.status,'stage',private.fecha_stage(c.org_id,v_deal_row.pipeline_id,v_deal_row.stage_id),
   'stageEnteredAt',private.fecha_iso(v_deal_row.stage_entered_at),'closedAt',private.fecha_iso(v_deal_row.closed_at),
   'lostReason',case when v_deal_row.status='lost' then private.fecha_read_text(v_deal_row.lost_reason,1000) end) end,
  'commitments',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'type',a.type,
    'title',coalesce(private.fecha_read_text(a.title,400),private.fecha_activity_label(a.type)),'dueAt',private.fecha_iso(a.due_date),
    'assignee',case when p.id is not null then jsonb_build_object('id',p.id,'label',private.fecha_label(array[p.name,p.id::text])) end)
    order by a.due_date nulls last,a.created_at,a.id),'[]'::jsonb)
   from (select * from public.activities a where a.org_id=c.org_id and a.type<>'note' and a.completed_at is null
     and (a.contact_id=v_contact or a.company_id=v_company or a.deal_id=v_deal)
    order by a.due_date nulls last,a.created_at,a.id limit 10) a
   left join public.profiles p on p.id=a.user_id and p.org_id=a.org_id),
  'recentActivities',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'type',a.type,
    'title',coalesce(private.fecha_read_text(a.title,400),private.fecha_activity_label(a.type)),
    'occurredAt',private.fecha_iso(coalesce(a.completed_at,a.created_at)),'excerpt',private.fecha_read_text(a.body,500))
    order by coalesce(a.completed_at,a.created_at) desc,a.id),'[]'::jsonb)
   from (select * from public.activities a where a.org_id=c.org_id and (a.type='note' or a.completed_at is not null)
     and (a.contact_id=v_contact or a.company_id=v_company or a.deal_id=v_deal)
     and not exists(select 1 from private.fecha_ai_deliveries f where f.note_id=a.id and f.org_id=c.org_id)
    order by coalesce(a.completed_at,a.created_at) desc,a.id limit 10) a),
  'reviews',(select coalesce(jsonb_agg(jsonb_build_object('deliveryId',f.id,'callId',f.call_id,'sourceReviewRevision',f.review_revision,
    'persistedAt',f.receipt->>'persistedAt') order by f.created_at desc,f.id),'[]'::jsonb)
   from (select * from private.fecha_ai_deliveries f where f.org_id=c.org_id and f.source_org_id=c.source_org_id
     and (f.payload#>>'{target,contactId}'=v_contact::text or f.payload#>>'{target,companyId}'=v_company::text or f.payload#>>'{target,dealId}'=v_deal::text)
    order by f.created_at desc,f.id limit 20) f));
end $$;
-- "outcomes": das oportunidades pedidas (private.fecha_read_deal_ids) que a organização tem, a situação, a fase, a
-- data de fechamento e a do primeiro recebimento pago; as demais vão em missingDealIds. Sem título, valor nem motivo
-- de perda.
create function private.fecha_read_outcomes(c private.fecha_ai_connections,p_request jsonb) returns jsonb language plpgsql set search_path='' as $$
declare v_ids uuid[]:=private.fecha_read_deal_ids(p_request);
begin
 return private.fecha_scope(c)||jsonb_build_object(
  'readAt',private.fecha_iso(clock_timestamp()),
  'outcomes',(select coalesce(jsonb_agg(jsonb_build_object('dealId',d.id,'status',d.status,'stage',private.fecha_stage(d.org_id,d.pipeline_id,d.stage_id),
    'closedAt',private.fecha_iso(d.closed_at),
    'firstPaidAt',(select private.fecha_iso(min(p.paid_at)) from public.payments p where p.org_id=d.org_id and p.deal_id=d.id and p.status='paid'))
    order by d.id),'[]'::jsonb)
   from public.deals d where d.org_id=c.org_id and d.id=any(v_ids)),
  'missingDealIds',(select coalesce(jsonb_agg(x order by x),'[]'::jsonb) from unnest(v_ids) x
   where not exists(select 1 from public.deals d where d.org_id=c.org_id and d.id=x)));
end $$;

-- A integração, com o corpo da migração do receptor e três acréscimos: o describe anuncia as leituras ligadas na
-- conexão (contextRead e outcomesRead, só quando ligadas, para a Fecha IA de antes delas continuar conectando), o
-- escopo de "context" e "outcomes" é conferido como o de lookup e receipt, e as duas leituras passam pela guarda.
create or replace function private.fecha_ai_integration(p_token_hash text,p_request jsonb,p_note_title text default null,p_note_body text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.fecha_ai_connections; e jsonb; v_op text:=p_request->>'operation'; v_id uuid; v_kind text; v_cursor uuid; v_limit integer; v_query text;
 v_result jsonb; v_choices jsonb; v_next text; v_actor uuid; v_key text; v_existing private.fecha_ai_deliveries; v_previous private.fecha_ai_deliveries;
 v_note uuid; v_task uuid; v_delivery uuid; v_revision integer; v_receipt jsonb; v_disposition text; v_has_previous boolean;
 v_old_sub text; v_old_claims text; v_old_role text;
begin
 v_id=case when v_op in ('validate','deliver') then (p_request#>>'{envelope,connectionId}')::uuid else (p_request->>'connectionId')::uuid end;
 select * into c from private.fecha_ai_connections where id=v_id and token_hash=p_token_hash for update;
 if not found or c.revoked_at is not null or c.expires_at<=clock_timestamp() then raise exception using message='invalid_connection_token'; end if;
 if v_op='describe' then
  select coalesce(jsonb_agg(private.fecha_actor_choice(c.org_id,p.id) order by p.name,p.id),'[]'::jsonb) into v_choices
  from public.profiles p join public.user_roles r on r.user_id=p.id and r.org_id=p.org_id where p.org_id=c.org_id and p.id=any(c.allowed_actor_ids) and r.deactivated_at is null and r.role in ('owner','admin','member');
  if jsonb_array_length(v_choices)=0 then raise exception using message='connection_has_no_actors'; end if;
  return private.fecha_scope(c)||jsonb_build_object('source','fecha-ai','destination','crm-empreende-ia','connectionName',c.name,'expiresAt',c.expires_at,'allowedActors',v_choices,'capabilities',jsonb_build_object('reviewedNotes',true,'optionalTask',true,'appendPreservesTask',true)
   ||case when 'context'=any(c.read_scopes) then '{"contextRead":true}'::jsonb else '{}'::jsonb end
   ||case when 'outcomes'=any(c.read_scopes) then '{"outcomesRead":true}'::jsonb else '{}'::jsonb end);
 end if;
 if v_op in ('lookup','receipt','context','outcomes') and ((p_request->>'sourceOrganizationId')::uuid is distinct from c.source_org_id or (p_request->>'destinationOrganizationId')::uuid is distinct from c.org_id) then raise exception using message='scope_mismatch'; end if;
 if v_op='context' then
  perform private.fecha_read_guard(c,p_request,'context');
  return private.fecha_read_context(c,p_request);
 elsif v_op='outcomes' then
  perform private.fecha_read_guard(c,p_request,'outcomes');
  return private.fecha_read_outcomes(c,p_request);
 end if;
 if v_op='lookup' then
  v_kind=p_request->>'kind'; v_cursor=(p_request->>'cursor')::uuid; v_limit=(p_request->>'limit')::integer;
  if v_limit not between 1 and 50 or length(p_request->>'query')>120 then raise exception using message='invalid_lookup'; end if;
  v_query='%'||replace(replace(replace(trim(p_request->>'query'),'\','\\'),'%','\%'),'_','\_')||'%';
  -- O rótulo sai depois do corte da página (fecha_label só para as opções devolvidas). Contato anonimizado não é
  -- oferecido (item 1.10), nem integrante desativado como responsável (item 1.2).
  with choices as (
   select id,first_name||' '||coalesce(last_name,'') primary_label,null::text secondary_label from public.contacts where v_kind='contact' and org_id=c.org_id and anonymized_at is null and (v_cursor is null or id>v_cursor) and (first_name||' '||coalesce(last_name,'')) ilike v_query
   union all select id,name,null from public.companies where v_kind='company' and org_id=c.org_id and (v_cursor is null or id>v_cursor) and name ilike v_query
   union all select id,title,null from public.deals where v_kind='deal' and org_id=c.org_id and (v_cursor is null or id>v_cursor) and title ilike v_query
   union all select p.id,p.name,p.email from public.profiles p join public.user_roles r on r.user_id=p.id and r.org_id=p.org_id where v_kind='assignee' and p.org_id=c.org_id and r.deactivated_at is null and r.role in ('owner','admin','member') and (v_cursor is null or p.id>v_cursor) and (p.name||' '||p.email) ilike v_query
  ), batch as (select * from choices order by id limit v_limit+1), numbered as (select *,row_number() over(order by id) n from batch)
  select coalesce(jsonb_agg(jsonb_build_object('kind',v_kind,'id',id,'organizationId',c.org_id,'label',private.fecha_label(array[primary_label,secondary_label,id::text])) order by id) filter(where n<=v_limit),'[]'::jsonb), case when count(*)>v_limit then max(id::text) filter(where n=v_limit) else null end into v_choices,v_next from numbered;
  if v_kind not in ('contact','company','deal','assignee') then raise exception using message='invalid_lookup'; end if;
  return private.fecha_scope(c)||jsonb_build_object('kind',v_kind,'choices',v_choices,'nextCursor',v_next);
 elsif v_op='receipt' then
  v_key=p_request->>'idempotencyKey';
  if v_key is distinct from 'fecha-ai:v1:'||c.id||':'||c.source_org_id||':'||(p_request->>'callId')||':review:'||(p_request->>'reviewRevision') then raise exception using message='invalid_idempotency_key'; end if;
  select * into v_existing from private.fecha_ai_deliveries where connection_id=c.id and source_org_id=c.source_org_id and call_id=(p_request->>'callId')::uuid and review_revision=(p_request->>'reviewRevision')::int and idempotency_key=v_key;
  if not found then raise exception using message='receipt_not_found'; end if;
  if v_existing.payload_hash is distinct from p_request->>'payloadHash' then raise exception using message='idempotency_conflict'; end if;
  return v_existing.receipt;
 elsif v_op not in ('validate','deliver') then raise exception using message='invalid_operation'; end if;
 e=p_request->'envelope';
 perform private.fecha_validate_envelope(c,e,false);
 v_actor=(e->>'destinationActorId')::uuid; v_key=e->>'idempotencyKey';
 select * into v_existing from private.fecha_ai_deliveries where connection_id=c.id and idempotency_key=v_key;
 if found then
  if v_existing.payload_hash is distinct from e->>'payloadHash' then raise exception using message='idempotency_conflict'; end if;
  if v_op='deliver' then return v_existing.receipt; else return private.fecha_validate_envelope(c,e); end if;
 end if;
 -- A entrega anterior da mesma conversa (protegida pela trava da conexão) vem antes dos vínculos: a tarefa dela é
 -- travada na ordem da base, depois da oportunidade e antes do contato (fecha_validate_envelope). As recusas do
 -- acréscimo continuam depois das dos vínculos.
 select * into v_previous from private.fecha_ai_deliveries where connection_id=c.id and source_org_id=c.source_org_id and call_id=(e->>'callId')::uuid order by destination_revision desc limit 1;
 v_has_previous=found;
 v_result=private.fecha_validate_envelope(c,e,true,case when v_has_previous and e->>'operation'='append_note_preserve_task' then v_previous.task_id end);
 if e->>'operation'='create_note' then
  if v_has_previous then raise exception using message='previous_delivery_requires_append'; end if;
  v_revision=1;
 else
  if not v_has_previous or (e#>>'{previousReceipt,deliveryId}')::uuid is distinct from v_previous.id or (e#>>'{previousReceipt,sourceReviewRevision}')::int is distinct from v_previous.review_revision or (e#>>'{previousReceipt,noteId}')::uuid is distinct from v_previous.note_id or (e#>>'{previousReceipt,taskId}')::uuid is distinct from v_previous.task_id or (e#>>'{previousReceipt,destinationRevision}')::int is distinct from v_previous.destination_revision then raise exception using message='previous_receipt_conflict'; end if;
  if (e->>'reviewRevision')::int<=v_previous.review_revision then raise exception using message='stale_review'; end if;
  if e->'target' is distinct from v_previous.payload->'target' then raise exception using message='target_change_requires_resolution'; end if;
  v_task=v_previous.task_id;
  if v_task is not null then perform 1 from public.activities where id=v_task and org_id=c.org_id and type='task' for share; if not found then raise exception using message='previous_task_missing'; end if; end if;
  v_revision=v_previous.destination_revision+1;
 end if;
 if v_op='validate' then return v_result; end if;
 -- A nota de qualquer envelope do contrato cabe em 64 KiB, o limite do próprio envelope (crm-contract_test.ts monta o maior).
 if length(trim(coalesce(p_note_title,''))) not between 1 and 200 or length(coalesce(p_note_body,'')) not between 1 and 65536 then raise exception using message='invalid_rendered_note'; end if;
 -- Time advances while FOR SHARE waits; an initially valid token may already have expired.
 if c.expires_at<=clock_timestamp() then raise exception using message='invalid_connection_token'; end if;
 -- The opaque token has been checked and its allowed actor revalidated. Claims are transaction-local only.
 v_old_sub=current_setting('request.jwt.claim.sub',true); v_old_claims=current_setting('request.jwt.claims',true); v_old_role=current_setting('request.jwt.claim.role',true);
 perform set_config('request.jwt.claim.sub',v_actor::text,true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',v_actor,'role','authenticated')::text,true);
 insert into public.activities(org_id,type,title,body,contact_id,company_id,deal_id,user_id)
 values(c.org_id,'note',p_note_title,p_note_body,(e#>>'{target,contactId}')::uuid,(e#>>'{target,companyId}')::uuid,(e#>>'{target,dealId}')::uuid,v_actor) returning id into v_note;
 if e->'nextStep' is distinct from 'null'::jsonb then
  insert into public.activities(org_id,type,title,body,contact_id,company_id,deal_id,user_id,due_date)
  values(c.org_id,'task',e#>>'{nextStep,description}','Próximo passo da revisão Fecha IA '||(e->>'callId')||' · revisão '||(e->>'reviewRevision'),(e#>>'{target,contactId}')::uuid,(e#>>'{target,companyId}')::uuid,(e#>>'{target,dealId}')::uuid,(e#>>'{nextStep,assigneeId}')::uuid,(e#>>'{nextStep,dueAt}')::timestamptz) returning id into v_task;
  v_disposition='created';
 else v_disposition=case when v_task is null then 'none' else 'preserved' end; end if;
 -- A native trigger/FK may also wait. Reject and roll back every write if expiry passed meanwhile.
 if c.expires_at<=clock_timestamp() then raise exception using message='invalid_connection_token'; end if;
 v_delivery=gen_random_uuid();
 v_receipt=private.fecha_scope(c)||jsonb_build_object('status','persisted','source','fecha-ai','destination','crm-empreende-ia','callId',e->'callId','sourceReviewRevision',e->'reviewRevision','deliveryId',v_delivery,'idempotencyKey',v_key,'payloadHash',e->'payloadHash','operation',e->'operation','noteId',v_note,'taskId',v_task,'taskDisposition',v_disposition,'destinationRevision',v_revision,'persistedAt',clock_timestamp());
 insert into private.fecha_ai_deliveries(id,connection_id,org_id,source_org_id,call_id,review_revision,idempotency_key,payload_hash,payload,receipt,note_id,task_id,destination_revision)
 values(v_delivery,c.id,c.org_id,c.source_org_id,(e->>'callId')::uuid,(e->>'reviewRevision')::int,v_key,e->>'payloadHash',e,v_receipt,v_note,v_task,v_revision);
 perform set_config('request.jwt.claim.sub',coalesce(v_old_sub,''),true); perform set_config('request.jwt.claims',coalesce(v_old_claims,''),true); perform set_config('request.jwt.claim.role',coalesce(v_old_role,''),true);
 return v_receipt;
end $$;

-- As funções novas sem permissão para nenhum papel; as recriadas mantêm as permissões (create or replace). As RPCs de
-- public continuam as duas da migração do receptor, executáveis só pela service_role.
revoke all on function private.fecha_read_scopes(jsonb),private.fecha_read_deal_ids(jsonb),private.fecha_iso(timestamptz),private.fecha_read_text(text,integer),private.fecha_activity_label(text),private.fecha_stage(uuid,uuid,uuid),private.fecha_read_guard(private.fecha_ai_connections,jsonb,text),private.fecha_read_context(private.fecha_ai_connections,jsonb),private.fecha_read_outcomes(private.fecha_ai_connections,jsonb) from public,anon,authenticated,service_role;
