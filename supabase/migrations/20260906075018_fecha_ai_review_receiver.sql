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
create function private.fecha_require_actor(p_org uuid,p_actor uuid,p_manage boolean default false) returns void language plpgsql set search_path='' as $$
begin
 perform 1 from public.profiles p join public.user_roles r on r.user_id=p.id and r.org_id=p.org_id
 where p.id=p_actor and p.org_id=p_org and r.role=any(case when p_manage then array['owner','admin'] else array['owner','admin','member'] end)
 for share of p,r;
 if not found then raise exception using message='forbidden'; end if;
end $$;
create function private.fecha_validate_actors(p_org uuid,p_ids uuid[]) returns void language plpgsql set search_path='' as $$
declare v_id uuid;
begin
 if p_ids is null or cardinality(p_ids) not between 1 and 500 or array_position(p_ids,null) is not null or cardinality(p_ids)<>(select count(distinct x) from unnest(p_ids) x) then raise exception using message='invalid_actors'; end if;
 for v_id in select unnest(p_ids) order by 1 loop perform private.fecha_require_actor(p_org,v_id); end loop;
end $$;
create function private.fecha_actor_choice(p_org uuid,p_id uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',p.id,'organizationId',p.org_id,'label',left(coalesce(nullif(trim(p.name),''),nullif(trim(p.email),''),p.id::text),400))
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
  from public.profiles p join public.user_roles r on r.user_id=p.id and r.org_id=p.org_id where p.org_id=v_org and r.role in ('owner','admin','member');
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
create function public.manage_fecha_ai_connections(p_actor_id uuid,p_request jsonb,p_token_hash text default null) returns jsonb language sql security invoker set search_path='' as $$
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
create function private.fecha_validate_envelope(c private.fecha_ai_connections,e jsonb,p_validate_links boolean default true) returns jsonb language plpgsql set search_path='' as $$
declare v_actor uuid; v_contact uuid; v_company uuid; v_deal uuid; v_assignee uuid; v_contact_row public.contacts; v_deal_row public.deals; v_target jsonb; v_assignee_choice jsonb;
begin
 if (e->>'schemaVersion')::int is distinct from 1 or e->>'source' is distinct from 'fecha-ai' or e->>'destination' is distinct from 'crm-empreende-ia' then raise exception using message='invalid_payload'; end if;
 if (e->>'connectionId')::uuid is distinct from c.id or (e->>'sourceOrganizationId')::uuid is distinct from c.source_org_id or (e->>'destinationOrganizationId')::uuid is distinct from c.org_id then raise exception using message='scope_mismatch'; end if;
 if octet_length(private.fecha_canonical_json(e))>65536 or e->>'payloadHash' is distinct from encode(sha256(convert_to(private.fecha_canonical_json(e-'payloadHash'),'UTF8')),'hex') then raise exception using message='invalid_payload_hash'; end if;
 if (e->>'callId')::uuid is null or (e->>'sourceOwnerId')::uuid is null or (e->>'reviewedBySourceUserId')::uuid is null or (e->>'reviewRevision')::integer<=0 or not isfinite((e->>'reviewedAt')::timestamptz) then raise exception using message='invalid_payload'; end if;
 if e->>'idempotencyKey' is distinct from 'fecha-ai:v1:'||c.id||':'||c.source_org_id||':'||(e->>'callId')||':review:'||(e->>'reviewRevision') then raise exception using message='invalid_idempotency_key'; end if;
 if length(trim(coalesce(e#>>'{reviewNote,summary}',''))) not between 1 and 8000 or e#>>'{reviewNote,commercialResult}' not in ('won','lost','next_meeting','awaiting_decision','no_fit') or e#>>'{reviewNote,paymentStatus}' not in ('unverified','pending','confirmed','not_applicable') then raise exception using message='invalid_payload'; end if;
 v_actor=(e->>'destinationActorId')::uuid;
 if v_actor is null or not (v_actor=any(c.allowed_actor_ids)) then raise exception using message='actor_not_allowed'; end if;
 perform private.fecha_require_actor(c.org_id,v_actor);
 if c.expires_at<=clock_timestamp() then raise exception using message='invalid_connection_token'; end if;
 if not p_validate_links then return '{}'::jsonb; end if;
 v_contact=(e#>>'{target,contactId}')::uuid; v_company=(e#>>'{target,companyId}')::uuid; v_deal=(e#>>'{target,dealId}')::uuid;
 if v_contact is null and v_company is null and v_deal is null then raise exception using message='target_required'; end if;
 if v_contact is not null then
  select * into v_contact_row from public.contacts where id=v_contact and org_id=c.org_id for share;
  if not found then raise exception using message='target_not_found'; end if;
 end if;
 if v_company is not null then perform 1 from public.companies where id=v_company and org_id=c.org_id for share; if not found then raise exception using message='target_not_found'; end if; end if;
 if v_deal is not null then
  select * into v_deal_row from public.deals where id=v_deal and org_id=c.org_id for share;
  if not found then raise exception using message='target_not_found'; end if;
 end if;
 -- Explicit links cannot join unrelated existing entities, and missing relationships are never inferred.
 if v_contact is not null and v_company is not null and v_contact_row.company_id is distinct from v_company then raise exception using message='target_relationship_conflict'; end if;
 if v_deal is not null and ((v_contact is not null and v_deal_row.contact_id is distinct from v_contact) or (v_company is not null and v_deal_row.company_id is distinct from v_company)) then raise exception using message='target_relationship_conflict'; end if;
 if e->>'operation'='create_note' then
  if e->'previousReceipt' is distinct from 'null'::jsonb then raise exception using message='invalid_previous_receipt'; end if;
  if e->'nextStep' is distinct from 'null'::jsonb then
   v_assignee=(e#>>'{nextStep,assigneeId}')::uuid;
   if v_assignee is null or length(trim(coalesce(e#>>'{nextStep,description}',''))) not between 1 and 2000 or not isfinite((e#>>'{nextStep,dueAt}')::timestamptz) then raise exception using message='invalid_next_step'; end if;
   perform private.fecha_require_actor(c.org_id,v_assignee);
   v_assignee_choice=private.fecha_actor_choice(c.org_id,v_assignee)||jsonb_build_object('kind','assignee');
  end if;
 elsif e->>'operation'='append_note_preserve_task' then
  if jsonb_typeof(e->'previousReceipt') is distinct from 'object' or e->'nextStep' is distinct from 'null'::jsonb then raise exception using message='invalid_previous_receipt'; end if;
 else raise exception using message='invalid_operation'; end if;
 v_target=jsonb_build_object(
 'contact',case when v_contact is not null then jsonb_build_object('kind','contact','id',v_contact,'organizationId',c.org_id,'label',left(trim(v_contact_row.first_name||' '||coalesce(v_contact_row.last_name,'')),400)) else null end,
 'company',case when v_company is not null then (select jsonb_build_object('kind','company','id',id,'organizationId',org_id,'label',left(name,400)) from public.companies where id=v_company and org_id=c.org_id) else null end,
 'deal',case when v_deal is not null then jsonb_build_object('kind','deal','id',v_deal,'organizationId',c.org_id,'label',left(v_deal_row.title,400)) else null end);
 if c.expires_at<=clock_timestamp() then raise exception using message='invalid_connection_token'; end if;
 return private.fecha_scope(c)||jsonb_build_object('status','validated','callId',e->'callId','reviewRevision',e->'reviewRevision','payloadHash',e->'payloadHash','validatedAt',clock_timestamp(),'actor',private.fecha_actor_choice(c.org_id,v_actor),'target',v_target,'assignee',v_assignee_choice);
end $$;

create function private.fecha_ai_integration(p_token_hash text,p_request jsonb,p_note_title text default null,p_note_body text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.fecha_ai_connections; e jsonb; v_op text:=p_request->>'operation'; v_id uuid; v_kind text; v_cursor uuid; v_limit integer; v_query text;
 v_result jsonb; v_choices jsonb; v_next text; v_actor uuid; v_key text; v_existing private.fecha_ai_deliveries; v_previous private.fecha_ai_deliveries;
 v_note uuid; v_task uuid; v_delivery uuid; v_revision integer; v_receipt jsonb; v_disposition text;
 v_old_sub text; v_old_claims text; v_old_role text;
begin
 v_id=case when v_op in ('validate','deliver') then (p_request#>>'{envelope,connectionId}')::uuid else (p_request->>'connectionId')::uuid end;
 select * into c from private.fecha_ai_connections where id=v_id and token_hash=p_token_hash for update;
 if not found or c.revoked_at is not null or c.expires_at<=clock_timestamp() then raise exception using message='invalid_connection_token'; end if;
 if v_op='describe' then
  select coalesce(jsonb_agg(private.fecha_actor_choice(c.org_id,p.id) order by p.name,p.id),'[]'::jsonb) into v_choices
  from public.profiles p join public.user_roles r on r.user_id=p.id and r.org_id=p.org_id where p.org_id=c.org_id and p.id=any(c.allowed_actor_ids) and r.role in ('owner','admin','member');
  if jsonb_array_length(v_choices)=0 then raise exception using message='connection_has_no_actors'; end if;
  return private.fecha_scope(c)||jsonb_build_object('source','fecha-ai','destination','crm-empreende-ia','connectionName',c.name,'expiresAt',c.expires_at,'allowedActors',v_choices,'capabilities',jsonb_build_object('reviewedNotes',true,'optionalTask',true,'appendPreservesTask',true));
 end if;
 if v_op in ('lookup','receipt') and ((p_request->>'sourceOrganizationId')::uuid is distinct from c.source_org_id or (p_request->>'destinationOrganizationId')::uuid is distinct from c.org_id) then raise exception using message='scope_mismatch'; end if;
 if v_op='lookup' then
  v_kind=p_request->>'kind'; v_cursor=(p_request->>'cursor')::uuid; v_limit=(p_request->>'limit')::integer;
  if v_limit not between 1 and 50 or length(p_request->>'query')>120 then raise exception using message='invalid_lookup'; end if;
  v_query='%'||replace(replace(replace(trim(p_request->>'query'),'\','\\'),'%','\%'),'_','\_')||'%';
  with choices as (
   select id,left(trim(first_name||' '||coalesce(last_name,'')),400) label from public.contacts where v_kind='contact' and org_id=c.org_id and (v_cursor is null or id>v_cursor) and (first_name||' '||coalesce(last_name,'')) ilike v_query
   union all select id,left(name,400) from public.companies where v_kind='company' and org_id=c.org_id and (v_cursor is null or id>v_cursor) and name ilike v_query
   union all select id,left(title,400) from public.deals where v_kind='deal' and org_id=c.org_id and (v_cursor is null or id>v_cursor) and title ilike v_query
   union all select p.id,left(coalesce(nullif(trim(p.name),''),nullif(trim(p.email),''),p.id::text),400) from public.profiles p join public.user_roles r on r.user_id=p.id and r.org_id=p.org_id where v_kind='assignee' and p.org_id=c.org_id and r.role in ('owner','admin','member') and (v_cursor is null or p.id>v_cursor) and (p.name||' '||p.email) ilike v_query
  ), batch as (select * from choices order by id limit v_limit+1), numbered as (select *,row_number() over(order by id) n from batch)
  select coalesce(jsonb_agg(jsonb_build_object('kind',v_kind,'id',id,'organizationId',c.org_id,'label',label) order by id) filter(where n<=v_limit),'[]'::jsonb), case when count(*)>v_limit then max(id::text) filter(where n=v_limit) else null end into v_choices,v_next from numbered;
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
 v_result=private.fecha_validate_envelope(c,e);
 select * into v_previous from private.fecha_ai_deliveries where connection_id=c.id and source_org_id=c.source_org_id and call_id=(e->>'callId')::uuid order by destination_revision desc limit 1;
 if e->>'operation'='create_note' then
  if found then raise exception using message='previous_delivery_requires_append'; end if;
  v_revision=1;
 else
  if not found or (e#>>'{previousReceipt,deliveryId}')::uuid is distinct from v_previous.id or (e#>>'{previousReceipt,sourceReviewRevision}')::int is distinct from v_previous.review_revision or (e#>>'{previousReceipt,noteId}')::uuid is distinct from v_previous.note_id or (e#>>'{previousReceipt,taskId}')::uuid is distinct from v_previous.task_id or (e#>>'{previousReceipt,destinationRevision}')::int is distinct from v_previous.destination_revision then raise exception using message='previous_receipt_conflict'; end if;
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
create function public.fecha_ai_integration(p_token_hash text,p_request jsonb,p_note_title text default null,p_note_body text default null) returns jsonb language sql security invoker set search_path='' as $$
 select private.fecha_ai_integration(p_token_hash,p_request,p_note_title,p_note_body);
$$;
revoke all on function private.fecha_connection_summary(private.fecha_ai_connections),private.fecha_require_actor(uuid,uuid,boolean),private.fecha_validate_actors(uuid,uuid[]),private.fecha_actor_choice(uuid,uuid),private.manage_fecha_ai_connections(uuid,jsonb,text),private.fecha_canonical_json(jsonb),private.fecha_scope(private.fecha_ai_connections),private.fecha_validate_envelope(private.fecha_ai_connections,jsonb,boolean),private.fecha_ai_integration(text,jsonb,text,text) from public,anon,authenticated,service_role;
revoke all on function public.manage_fecha_ai_connections(uuid,jsonb,text),public.fecha_ai_integration(text,jsonb,text,text) from public,anon,authenticated,service_role;
grant usage on schema private to service_role;
grant execute on function private.manage_fecha_ai_connections(uuid,jsonb,text),private.fecha_ai_integration(text,jsonb,text,text),public.manage_fecha_ai_connections(uuid,jsonb,text),public.fecha_ai_integration(text,jsonb,text,text) to service_role;
