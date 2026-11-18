-- Receptor da Fecha IA (roteiro 3.4; supabase/functions/README.md). A única função da base que esta migração recria é
-- private.anonymize_contact (no fim do arquivo: as entregas guardadas entram na anonimização). A guarda vem antes de
-- tudo: numa instância que alterou a função à mão, a migração inteira para sem aplicar nada.
select private.assert_base_definition('function', 'private.anonymize_contact(uuid,timestamp with time zone)', array['f3762cdcdae6a454']);

-- Explicit, revocable Fecha IA connections. No token or integration table is exposed to browsers.
create table private.fecha_ai_connections (
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null references public.organizations(id), source_org_id uuid not null,
 name text not null check(length(trim(name)) between 1 and 200),
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 allowed_actor_ids uuid[] not null check(cardinality(allowed_actor_ids) between 1 and 500),
 expires_at timestamptz not null check(isfinite(expires_at)), revoked_at timestamptz check(isfinite(revoked_at)),
 created_at timestamptz not null default clock_timestamp(), created_by uuid not null,
 foreign key(created_by,org_id) references public.profiles(id,org_id), unique(id,org_id)
);
create index fecha_connections_org_created on private.fecha_ai_connections(org_id,created_at desc);
create index fecha_connections_creator_org on private.fecha_ai_connections(created_by,org_id);
create table private.fecha_ai_connection_events (
 id uuid primary key default gen_random_uuid(), connection_id uuid not null references private.fecha_ai_connections(id),
 actor_id uuid not null references public.profiles(id), action text not null check(action in ('create','revoke','set_actors')),
 allowed_actor_ids uuid[] not null, created_at timestamptz not null default clock_timestamp()
);
create index fecha_connection_events_connection on private.fecha_ai_connection_events(connection_id,created_at desc);
create index fecha_connection_events_actor on private.fecha_ai_connection_events(actor_id);
create table private.fecha_ai_deliveries (
 id uuid primary key default gen_random_uuid(), connection_id uuid not null, org_id uuid not null,
 source_org_id uuid not null, call_id uuid not null, review_revision integer not null check(review_revision>0),
 idempotency_key text not null check(length(idempotency_key)<=200), payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),
 payload jsonb not null check(jsonb_typeof(payload)='object'), receipt jsonb not null check(jsonb_typeof(receipt)='object'),
 note_id uuid not null, task_id uuid, destination_revision integer not null check(destination_revision>0),
 created_at timestamptz not null default clock_timestamp(),
 foreign key(connection_id,org_id) references private.fecha_ai_connections(id,org_id),
 unique(connection_id,idempotency_key), unique(connection_id,source_org_id,call_id,review_revision),
 unique(connection_id,source_org_id,call_id,destination_revision)
);
-- Receipt IDs are historical references: they must not make native activities undeletable.
create index fecha_deliveries_org_created on private.fecha_ai_deliveries(org_id,created_at desc);
alter table private.fecha_ai_connections enable row level security;
alter table private.fecha_ai_connection_events enable row level security;
alter table private.fecha_ai_deliveries enable row level security;
revoke all on private.fecha_ai_connections,private.fecha_ai_connection_events,private.fecha_ai_deliveries from public,anon,authenticated,service_role;

create function private.fecha_connection_summary(c private.fecha_ai_connections) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('id',c.id,'name',c.name,'sourceOrganizationId',c.source_org_id,'destinationOrganizationId',c.org_id,
 'allowedActorIds',c.allowed_actor_ids,'expiresAt',c.expires_at,'createdAt',c.created_at,'createdBy',c.created_by,'revokedAt',c.revoked_at);
$$;
-- Rótulos do contrato (CrmLookupChoiceSchema e CrmActorChoiceSchema): sem espaço externo pelo trim() do JavaScript e
-- com até 400 unidades UTF-16. O trim() do PostgreSQL tira só o espaço, e left(…,400) conta caracteres: um nome com TAB,
-- NBSP ou U+FEFF nas pontas, ou longo com emoji, derrubaria describe, lookup e validate com 500. O primeiro candidato
-- que sobra não vazio vale; o último é sempre o id, porque as constraints aceitam nomes feitos só de TAB ou NBSP.
-- Os caracteres são os WhiteSpace e LineTerminator do ECMAScript: TAB, LF, VT, FF, CR, espaço, U+00A0, U+1680,
-- U+2000 a U+200A, U+2028, U+2029, U+202F, U+205F, U+3000 e U+FEFF.
create function private.fecha_label(p_candidates text[]) returns text language plpgsql immutable set search_path='' as $$
declare
 v_spaces constant text:=chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)
  ||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)
  ||chr(8287)||chr(12288)||chr(65279);
 v_value text; v_cut text; v_char text; v_units integer;
begin
 foreach v_value in array p_candidates loop
  v_value:=btrim(coalesce(v_value,''),v_spaces);
  -- Até 200 caracteres cabem sempre: cada um vale no máximo duas unidades UTF-16 (fora do plano básico).
  if length(v_value)>200 then
   v_cut:=''; v_units:=0;
   foreach v_char in array regexp_split_to_array(v_value,'') loop
    v_units:=v_units+case when ascii(v_char)>65535 then 2 else 1 end;
    exit when v_units>400;
    v_cut:=v_cut||v_char;
   end loop;
   v_value:=btrim(v_cut,v_spaces);
  end if;
  if v_value<>'' then return v_value; end if;
 end loop;
 return null;
end $$;
-- O papel ativo de quem configura, escreve ou recebe a tarefa. Com a trava (o padrão), FOR SHARE no perfil e no papel:
-- uma desativação, que trava o papel com FOR UPDATE, espera a gravação, e a gravação que chega depois dela vê o papel
-- desativado. Sem a trava (p_lock false), só a conferência: a entrega confere o autor assim antes das travas dos vínculos
-- e só trava os papéis por último, na ordem da base (fecha_validate_envelope).
create function private.fecha_require_actor(p_org uuid,p_actor uuid,p_manage boolean default false,p_lock boolean default true) returns void language plpgsql set search_path='' as $$
declare v_roles text[]:=case when p_manage then array['owner','admin'] else array['owner','admin','member'] end;
begin
 if p_lock then
  perform 1 from public.profiles p join public.user_roles r on r.user_id=p.id and r.org_id=p.org_id
  where p.id=p_actor and p.org_id=p_org and r.deactivated_at is null and r.role=any(v_roles)
  for share of p,r;
 else
  perform 1 from public.profiles p join public.user_roles r on r.user_id=p.id and r.org_id=p.org_id
  where p.id=p_actor and p.org_id=p_org and r.deactivated_at is null and r.role=any(v_roles);
 end if;
 if not found then raise exception using message='forbidden'; end if;
end $$;
create function private.fecha_validate_actors(p_org uuid,p_ids uuid[]) returns void language plpgsql set search_path='' as $$
declare v_id uuid;
begin
 if p_ids is null or cardinality(p_ids) not between 1 and 500 or array_position(p_ids,null) is not null or cardinality(p_ids)<>(select count(distinct x) from unnest(p_ids) x) then raise exception using message='invalid_actors'; end if;
 for v_id in select unnest(p_ids) order by 1 loop perform private.fecha_require_actor(p_org,v_id); end loop;
end $$;
create function private.fecha_actor_choice(p_org uuid,p_id uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',p.id,'organizationId',p.org_id,'label',private.fecha_label(array[p.name,p.email,p.id::text]))
 from public.profiles p where p.id=p_id and p.org_id=p_org;
$$;

create function private.manage_fecha_ai_connections(p_actor_id uuid,p_request jsonb,p_token_hash text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_org uuid; v_op text:=p_request->>'operation'; v_connection private.fecha_ai_connections; v_ids uuid[]; v_expiry timestamptz; v_result jsonb;
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
 if v_op='create' then
  v_expiry=(p_request->>'expiresAt')::timestamptz;
  if not isfinite(v_expiry) or v_expiry<clock_timestamp()+interval '1 hour' or v_expiry>clock_timestamp()+interval '90 days' then raise exception using message='invalid_expiry'; end if;
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception using message='invalid_token_hash'; end if;
  insert into private.fecha_ai_connections(org_id,source_org_id,name,token_hash,allowed_actor_ids,expires_at,created_by)
  values(v_org,(p_request->>'sourceOrganizationId')::uuid,trim(p_request->>'name'),p_token_hash,v_ids,v_expiry,p_actor_id) returning * into v_connection;
 elsif v_op in ('revoke','set_actors') then
  select * into v_connection from private.fecha_ai_connections where id=(p_request->>'connectionId')::uuid and org_id=v_org for update;
  if not found then raise exception using message='connection_not_found'; end if;
  if v_op='revoke' then update private.fecha_ai_connections set revoked_at=coalesce(revoked_at,clock_timestamp()) where id=v_connection.id returning * into v_connection;
  else
   if v_connection.revoked_at is not null or v_connection.expires_at<=clock_timestamp() then raise exception using message='connection_inactive'; end if;
   update private.fecha_ai_connections set allowed_actor_ids=v_ids where id=v_connection.id returning * into v_connection;
  end if;
 else raise exception using message='invalid_operation'; end if;
 insert into private.fecha_ai_connection_events(connection_id,actor_id,action,allowed_actor_ids) values(v_connection.id,p_actor_id,v_op,v_connection.allowed_actor_ids);
 return jsonb_build_object('connection',private.fecha_connection_summary(v_connection));
end $$;
-- A service_role não tem USAGE em private (invariante da base desde 20261019120000_default_privileges.sql): a RPC de
-- public chamada pela Edge Function roda como o dono das funções (SECURITY DEFINER, search_path vazio) e só ela tem
-- EXECUTE para a service_role, no fim deste arquivo.
create function public.manage_fecha_ai_connections(p_actor_id uuid,p_request jsonb,p_token_hash text default null) returns jsonb language sql security definer set search_path='' as $$
 select private.manage_fecha_ai_connections(p_actor_id,p_request,p_token_hash);
$$;

-- Contract object keys are ASCII. C collation matches the portable serializer's key order.
create function private.fecha_canonical_json(p_value jsonb) returns text language plpgsql immutable set search_path='' as $$
declare result text;
begin
 case jsonb_typeof(p_value)
 when 'object' then select '{'||coalesce(string_agg(to_jsonb(key)::text||':'||private.fecha_canonical_json(value),',' order by key collate "C"),'')||'}' into result from jsonb_each(p_value);
 when 'array' then select '['||coalesce(string_agg(private.fecha_canonical_json(value),',' order by ord),'')||']' into result from jsonb_array_elements(p_value) with ordinality a(value,ord);
 when 'number' then result=trim_scale((p_value::text)::numeric)::text;
 else result=p_value::text;
 end case;
 return result;
end $$;
create function private.fecha_scope(c private.fecha_ai_connections) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('schemaVersion',1,'connectionId',c.id,'sourceOrganizationId',c.source_org_id,'destinationOrganizationId',c.org_id);
$$;
-- As travas seguem a ordem da base. anonymize_contact trava as oportunidades, as atividades e os recebimentos da pessoa e
-- só depois o contato (FOR UPDATE); deactivate_member trava as oportunidades, as atividades, os contatos e as empresas da
-- pessoa e só no fim o papel dela (FOR UPDATE). Aqui, FOR SHARE: a oportunidade, a tarefa anterior do acréscimo
-- (p_previous_task, a da entrega anterior), o contato e a empresa e, por último, os papéis do autor e do responsável.
-- Quem espera um vínculo não segura nada que a anonimização ou a desativação ainda vá pedir: ela termina, e a entrega,
-- depois do commit dela, é recusada (target_anonymized, forbidden) em vez de fechar um impasse (40P01). O autor é
-- conferido antes, sem trava, e as recusas dos vínculos vêm depois de todas as travas, na mesma ordem: forbidden do autor
-- já inativo, target_not_found, target_anonymized, target_relationship_conflict, a operação e por fim os papéis travados.
create function private.fecha_validate_envelope(c private.fecha_ai_connections,e jsonb,p_validate_links boolean default true,p_previous_task uuid default null) returns jsonb language plpgsql set search_path='' as $$
declare v_actor uuid; v_contact uuid; v_company uuid; v_deal uuid; v_assignee uuid; v_contact_row public.contacts; v_deal_row public.deals;
 v_contact_found boolean; v_company_found boolean; v_deal_found boolean; v_target jsonb; v_assignee_choice jsonb;
begin
 if (e->>'schemaVersion')::int is distinct from 1 or e->>'source' is distinct from 'fecha-ai' or e->>'destination' is distinct from 'crm-empreende-ia' then raise exception using message='invalid_payload'; end if;
 if (e->>'connectionId')::uuid is distinct from c.id or (e->>'sourceOrganizationId')::uuid is distinct from c.source_org_id or (e->>'destinationOrganizationId')::uuid is distinct from c.org_id then raise exception using message='scope_mismatch'; end if;
 if octet_length(private.fecha_canonical_json(e))>65536 or e->>'payloadHash' is distinct from encode(sha256(convert_to(private.fecha_canonical_json(e-'payloadHash'),'UTF8')),'hex') then raise exception using message='invalid_payload_hash'; end if;
 if (e->>'callId')::uuid is null or (e->>'sourceOwnerId')::uuid is null or (e->>'reviewedBySourceUserId')::uuid is null or (e->>'reviewRevision')::integer<=0 or not isfinite((e->>'reviewedAt')::timestamptz) then raise exception using message='invalid_payload'; end if;
 if e->>'idempotencyKey' is distinct from 'fecha-ai:v1:'||c.id||':'||c.source_org_id||':'||(e->>'callId')||':review:'||(e->>'reviewRevision') then raise exception using message='invalid_idempotency_key'; end if;
 if length(trim(coalesce(e#>>'{reviewNote,summary}',''))) not between 1 and 8000 or e#>>'{reviewNote,commercialResult}' not in ('won','lost','next_meeting','awaiting_decision','no_fit') or e#>>'{reviewNote,paymentStatus}' not in ('unverified','pending','confirmed','not_applicable') then raise exception using message='invalid_payload'; end if;
 v_actor=(e->>'destinationActorId')::uuid;
 if v_actor is null or not (v_actor=any(c.allowed_actor_ids)) then raise exception using message='actor_not_allowed'; end if;
 perform private.fecha_require_actor(c.org_id,v_actor,false,false);
 if c.expires_at<=clock_timestamp() then raise exception using message='invalid_connection_token'; end if;
 if not p_validate_links then return '{}'::jsonb; end if;
 v_contact=(e#>>'{target,contactId}')::uuid; v_company=(e#>>'{target,companyId}')::uuid; v_deal=(e#>>'{target,dealId}')::uuid;
 if v_contact is null and v_company is null and v_deal is null then raise exception using message='target_required'; end if;
 if v_deal is not null then
  select * into v_deal_row from public.deals where id=v_deal and org_id=c.org_id for share;
  v_deal_found=found;
 end if;
 if p_previous_task is not null then perform 1 from public.activities where id=p_previous_task and org_id=c.org_id for share; end if;
 if v_contact is not null then
  select * into v_contact_row from public.contacts where id=v_contact and org_id=c.org_id for share;
  v_contact_found=found;
 end if;
 if v_company is not null then
  perform 1 from public.companies where id=v_company and org_id=c.org_id for share;
  v_company_found=found;
 end if;
 if v_contact is not null then
  if not v_contact_found then raise exception using message='target_not_found'; end if;
  -- Item 1.10: o contato anonimizado não recebe registro novo (guard_anonymized_contact recusaria a nota). A recusa
  -- vem antes da gravação, com o código próprio, e vale também para o acréscimo de uma conversa já entregue.
  if v_contact_row.anonymized_at is not null then raise exception using message='target_anonymized'; end if;
 end if;
 if v_company is not null and not v_company_found then raise exception using message='target_not_found'; end if;
 if v_deal is not null and not v_deal_found then raise exception using message='target_not_found'; end if;
 -- Explicit links cannot join unrelated existing entities, and missing relationships are never inferred.
 if v_contact is not null and v_company is not null and v_contact_row.company_id is distinct from v_company then raise exception using message='target_relationship_conflict'; end if;
 if v_deal is not null and ((v_contact is not null and v_deal_row.contact_id is distinct from v_contact) or (v_company is not null and v_deal_row.company_id is distinct from v_company)) then raise exception using message='target_relationship_conflict'; end if;
 if e->>'operation'='create_note' then
  if e->'previousReceipt' is distinct from 'null'::jsonb then raise exception using message='invalid_previous_receipt'; end if;
  if e->'nextStep' is distinct from 'null'::jsonb then
   v_assignee=(e#>>'{nextStep,assigneeId}')::uuid;
   if v_assignee is null or length(trim(coalesce(e#>>'{nextStep,description}',''))) not between 1 and 2000 or not isfinite((e#>>'{nextStep,dueAt}')::timestamptz) then raise exception using message='invalid_next_step'; end if;
  end if;
 elsif e->>'operation'='append_note_preserve_task' then
  if jsonb_typeof(e->'previousReceipt') is distinct from 'object' or e->'nextStep' is distinct from 'null'::jsonb then raise exception using message='invalid_previous_receipt'; end if;
 else raise exception using message='invalid_operation'; end if;
 -- Os papéis por último, com a trava: o do autor de novo (uma desativação que terminou enquanto a entrega esperava um
 -- vínculo aparece aqui) e o do responsável da tarefa.
 perform private.fecha_require_actor(c.org_id,v_actor);
 if v_assignee is not null then
  perform private.fecha_require_actor(c.org_id,v_assignee);
  v_assignee_choice=private.fecha_actor_choice(c.org_id,v_assignee)||jsonb_build_object('kind','assignee');
 end if;
 v_target=jsonb_build_object(
 'contact',case when v_contact is not null then jsonb_build_object('kind','contact','id',v_contact,'organizationId',c.org_id,'label',private.fecha_label(array[v_contact_row.first_name||' '||coalesce(v_contact_row.last_name,''),v_contact::text])) else null end,
 'company',case when v_company is not null then (select jsonb_build_object('kind','company','id',id,'organizationId',org_id,'label',private.fecha_label(array[name,id::text])) from public.companies where id=v_company and org_id=c.org_id) else null end,
 'deal',case when v_deal is not null then jsonb_build_object('kind','deal','id',v_deal,'organizationId',c.org_id,'label',private.fecha_label(array[v_deal_row.title,v_deal::text])) else null end);
 if c.expires_at<=clock_timestamp() then raise exception using message='invalid_connection_token'; end if;
 return private.fecha_scope(c)||jsonb_build_object('status','validated','callId',e->'callId','reviewRevision',e->'reviewRevision','payloadHash',e->'payloadHash','validatedAt',clock_timestamp(),'actor',private.fecha_actor_choice(c.org_id,v_actor),'target',v_target,'assignee',v_assignee_choice);
end $$;

create function private.fecha_ai_integration(p_token_hash text,p_request jsonb,p_note_title text default null,p_note_body text default null) returns jsonb language plpgsql security definer set search_path='' as $$
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
  return private.fecha_scope(c)||jsonb_build_object('source','fecha-ai','destination','crm-empreende-ia','connectionName',c.name,'expiresAt',c.expires_at,'allowedActors',v_choices,'capabilities',jsonb_build_object('reviewedNotes',true,'optionalTask',true,'appendPreservesTask',true));
 end if;
 if v_op in ('lookup','receipt') and ((p_request->>'sourceOrganizationId')::uuid is distinct from c.source_org_id or (p_request->>'destinationOrganizationId')::uuid is distinct from c.org_id) then raise exception using message='scope_mismatch'; end if;
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
 if length(trim(coalesce(p_note_title,''))) not between 1 and 200 or length(coalesce(p_note_body,'')) not between 1 and 40000 then raise exception using message='invalid_rendered_note'; end if;
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
create function public.fecha_ai_integration(p_token_hash text,p_request jsonb,p_note_title text default null,p_note_body text default null) returns jsonb language sql security definer set search_path='' as $$
 select private.fecha_ai_integration(p_token_hash,p_request,p_note_title,p_note_body);
$$;
-- A anonimização (item 1.10) alcança as entregas guardadas (AGENTS.md: campo novo de texto livre com dado pessoal
-- entra em anonymize_contact). O texto livre do envelope é o resumo da revisão e a descrição do próximo passo; o resto
-- são ids, enumerações e datas. Sem expressão, o texto sai inteiro ("[anonimizado]"); com ela, só os termos da pessoa,
-- como private.redact_personal_terms faz nos registros do CRM. A exportação do titular (export_contact_data) não muda:
-- ela leva a nota e a tarefa, que guardam o mesmo texto renderizado pelo contrato (renderCrmReviewNote).
create function private.fecha_redact_delivery(p_payload jsonb,p_regex text) returns jsonb language sql immutable set search_path='' as $$
 select case when p_payload->'nextStep' is null or jsonb_typeof(p_payload->'nextStep')<>'object' then v
  else jsonb_set(v,'{nextStep,description}',to_jsonb(case when p_regex is null then '[anonimizado]'
   else private.redact_personal_terms(p_payload#>>'{nextStep,description}',p_regex) end)) end
 from (select jsonb_set(p_payload,'{reviewNote,summary}',to_jsonb(case when p_regex is null then '[anonimizado]'
  else private.redact_personal_terms(p_payload#>>'{reviewNote,summary}',p_regex) end)) as v) r;
$$;

-- A anonimização, com o corpo de 20261019100000_product_catalog.sql e um acréscimo, o item 4b (as entregas da Fecha IA).
-- Mesma assinatura e mesmo SECURITY DEFINER: os grants ficam.
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
 -- 4b. Roteiro 3.4: as entregas guardadas da Fecha IA (private.fecha_ai_deliveries, o envelope de cada revisão
 -- recebida). O texto livre (o resumo e o próximo passo) das entregas com a pessoa sai inteiro, como a nota e a tarefa
 -- no CRM; nas das oportunidades dela, todos os termos; no resto da organização, só os termos fortes. O hash, o recibo, os
 -- vínculos e os ids ficam: a repetição de uma entrega continua devolvendo o mesmo recibo, e o acréscimo confere os
 -- vínculos guardados. As contagens não mudam: a entrega guardada é a cópia técnica do que a nota e a tarefa mostram.
 update private.fecha_ai_deliveries f set payload=private.fecha_redact_delivery(f.payload,null)
  where f.org_id=v_org and f.payload#>>'{target,contactId}'=p_contact_id::text;
 if v_all is not null then
  update private.fecha_ai_deliveries f set payload=private.fecha_redact_delivery(f.payload,v_all)
   where f.org_id=v_org and f.payload#>>'{target,contactId}' is distinct from p_contact_id::text
    and f.payload#>>'{target,dealId}'=any(v_deals::text[]);
 end if;
 if v_strong is not null then
  update private.fecha_ai_deliveries f set payload=private.fecha_redact_delivery(f.payload,v_strong)
   where f.org_id=v_org and f.payload#>>'{target,contactId}' is distinct from p_contact_id::text
    and not coalesce(f.payload#>>'{target,dealId}'=any(v_deals::text[]),false)
    and (f.payload#>>'{reviewNote,summary}' ~* v_strong or f.payload#>>'{nextStep,description}' ~* v_strong);
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

revoke all on function private.fecha_connection_summary(private.fecha_ai_connections),private.fecha_require_actor(uuid,uuid,boolean,boolean),private.fecha_validate_actors(uuid,uuid[]),private.fecha_actor_choice(uuid,uuid),private.manage_fecha_ai_connections(uuid,jsonb,text),private.fecha_canonical_json(jsonb),private.fecha_scope(private.fecha_ai_connections),private.fecha_validate_envelope(private.fecha_ai_connections,jsonb,boolean,uuid),private.fecha_ai_integration(text,jsonb,text,text),private.fecha_label(text[]),private.fecha_redact_delivery(jsonb,text) from public,anon,authenticated,service_role;
revoke all on function public.manage_fecha_ai_connections(uuid,jsonb,text),public.fecha_ai_integration(text,jsonb,text,text) from public,anon,authenticated,service_role;
-- Só as duas RPCs de public, só para a service_role: nenhum EXECUTE em private.* e nenhum USAGE em private.
grant execute on function public.manage_fecha_ai_connections(uuid,jsonb,text),public.fecha_ai_integration(text,jsonb,text,text) to service_role;
