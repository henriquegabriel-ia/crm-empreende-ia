\set ON_ERROR_STOP on
begin;
create schema fecha_test;
grant usage on schema fecha_test to authenticated,service_role;
create function fecha_test.assert(ok boolean,message text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'FAIL: %',message; end if; raise notice 'PASS: %',message; end $$;
create function fecha_test.denied(statement text,expected text) returns void language plpgsql security invoker as $$
begin begin execute statement; exception when others then if expected='permission' and sqlstate='42501' or sqlerrm=expected then raise notice 'PASS: rejected %',expected; return; end if; raise exception 'FAIL: expected %, got % (%)',expected,sqlerrm,sqlstate; end; raise exception 'FAIL: expected rejection %',expected; end $$;
grant execute on all functions in schema fecha_test to authenticated,service_role;
insert into public.organizations(id,name) values('10000000-0000-4000-8000-000000000002','CRM teste'),('10000000-0000-4000-8000-000000000003','Outra equipe');
insert into auth.users(id,email) values
('20000000-0000-4000-8000-000000000002','owner@example.test'),('20000000-0000-4000-8000-000000000003','member@example.test'),
('20000000-0000-4000-8000-000000000004','viewer@example.test'),('20000000-0000-4000-8000-000000000005','foreign@example.test');
update public.profiles set org_id='10000000-0000-4000-8000-000000000002',name=case when id='20000000-0000-4000-8000-000000000002' then 'Gestora' else 'Pessoa comercial' end where id<>'20000000-0000-4000-8000-000000000005';
update public.profiles set org_id='10000000-0000-4000-8000-000000000003',name='Outra gestora' where id='20000000-0000-4000-8000-000000000005';
insert into public.user_roles(user_id,org_id,role) values
('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','owner'),
('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','member'),
('20000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000002','viewer'),
('20000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000003','owner');
insert into public.companies(id,org_id,name) values('41000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','Empresa de teste');
insert into public.contacts(id,org_id,first_name) values('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','João'),('40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','João outra equipe');
select fecha_test.assert(not has_function_privilege('authenticated','public.fecha_ai_integration(text,jsonb,text,text)','execute') and not has_function_privilege('anon','public.fecha_ai_integration(text,jsonb,text,text)','execute'),'receiver RPC is not exposed to browser roles');
select fecha_test.assert(not has_function_privilege('authenticated','public.manage_fecha_ai_connections(uuid,jsonb,text)','execute'),'management RPC is service-only');
select fecha_test.assert(not has_table_privilege('service_role','private.fecha_ai_connections','select') and not has_table_privilege('authenticated','private.fecha_ai_deliveries','select'),'even service uses restricted RPCs; tokens and receipts have no direct Data API access');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',true);
select fecha_test.denied('select public.fecha_ai_integration(repeat(''a'',64),''{}'')','permission');
select fecha_test.denied('select * from private.fecha_ai_connections','permission');
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('test.manage',jsonb_build_object('operation','create','organizationId','10000000-0000-4000-8000-000000000002','name','Conexão de teste','sourceOrganizationId','10000000-0000-4000-8000-000000000001','allowedActorIds',jsonb_build_array('20000000-0000-4000-8000-000000000002'),'expiresAt',clock_timestamp()+interval '2 days')::text,true);
set local role service_role;
select fecha_test.denied(format('select public.manage_fecha_ai_connections(''20000000-0000-4000-8000-000000000003'',%L::jsonb,repeat(''a'',64))',current_setting('test.manage')),'forbidden');
select fecha_test.denied(format('select public.manage_fecha_ai_connections(''20000000-0000-4000-8000-000000000005'',%L::jsonb,repeat(''a'',64))',current_setting('test.manage')),'scope_mismatch');
select fecha_test.denied(format('select public.manage_fecha_ai_connections(''20000000-0000-4000-8000-000000000002'',%L::jsonb||''{"allowedActorIds":["20000000-0000-4000-8000-000000000004"]}''::jsonb,repeat(''a'',64))',current_setting('test.manage')),'forbidden');
select fecha_test.denied(format('select public.manage_fecha_ai_connections(''20000000-0000-4000-8000-000000000002'',%L::jsonb||jsonb_build_object(''expiresAt'',clock_timestamp()),repeat(''a'',64))',current_setting('test.manage')),'invalid_expiry');
select public.manage_fecha_ai_connections('20000000-0000-4000-8000-000000000002',current_setting('test.manage')::jsonb,repeat('a',64))#>>'{connection,id}' as connection_id \gset
select set_config('test.connection',:'connection_id',true);
select fecha_test.assert(not (public.manage_fecha_ai_connections('20000000-0000-4000-8000-000000000002','{"operation":"list","organizationId":"10000000-0000-4000-8000-000000000002"}')::text like '%token%'),'management list never discloses token or hash');
select fecha_test.assert(jsonb_array_length(public.manage_fecha_ai_connections('20000000-0000-4000-8000-000000000002','{"operation":"actor_options","organizationId":"10000000-0000-4000-8000-000000000002"}')->'actors')=2,'actor options exclude viewer and other organization');
select fecha_test.denied(format('select public.fecha_ai_integration(repeat(''b'',64),jsonb_build_object(''operation'',''describe'',''connectionId'',%L))',:'connection_id'),'invalid_connection_token');
select fecha_test.assert(jsonb_array_length(public.fecha_ai_integration(repeat('a',64),jsonb_build_object('operation','describe','connectionId',:'connection_id'))->'allowedActors')=1,'describe returns only explicitly allowed active write actor');
reset role;

-- Same portable conformance vector as the Deno tests; PostgreSQL must produce the identical hash.
create function fecha_test.base() returns jsonb language sql immutable as $$ select '{"schemaVersion":1,"source":"fecha-ai","destination":"crm-empreende-ia","connectionId":"01000000-0000-4000-8000-000000000001","sourceOrganizationId":"10000000-0000-4000-8000-000000000001","destinationOrganizationId":"10000000-0000-4000-8000-000000000002","callId":"30000000-0000-4000-8000-000000000001","reviewRevision":7,"sourceOwnerId":"20000000-0000-4000-8000-000000000001","reviewedBySourceUserId":"20000000-0000-4000-8000-000000000001","destinationActorId":"20000000-0000-4000-8000-000000000002","reviewedAt":"2026-09-06T15:00:00.000Z","operation":"create_note","previousReceipt":null,"target":{"contactId":"40000000-0000-4000-8000-000000000001","companyId":null,"dealId":null},"reviewNote":{"summary":"João decidiu avançar. Pagamento ainda pendente.","method":{"id":"empreende-ia-commercial","version":"1.0.0"},"offer":null,"commercialResult":"won","paymentStatus":"pending","evidenceReferences":[{"segmentId":"50000000-0000-4000-8000-000000000001:turn:3","revision":1}]},"nextStep":{"description":"Conferir os dados de contratação","assigneeId":"20000000-0000-4000-8000-000000000003","dueAt":"2026-09-07T18:00:00-03:00"}}'::jsonb $$;
create function fecha_test.seal(e jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ declare v jsonb; begin
v=(e-'payloadHash')||jsonb_build_object('idempotencyKey','fecha-ai:v1:'||(e->>'connectionId')||':'||(e->>'sourceOrganizationId')||':'||(e->>'callId')||':review:'||(e->>'reviewRevision'));
return v||jsonb_build_object('payloadHash',encode(sha256(convert_to(private.fecha_canonical_json(v),'UTF8')),'hex')); end $$;
grant execute on function fecha_test.base(),fecha_test.seal(jsonb) to service_role;
select fecha_test.assert(fecha_test.seal(fecha_test.base())->>'payloadHash'='ddfcb493e6cec6d7ed1ba5c5631d4b28c51970bf32b6177ae314d51cf41bbab1','PostgreSQL canonical SHA-256 matches the portable Unicode conformance vector');
select set_config('test.envelope',fecha_test.seal(fecha_test.base()||jsonb_build_object('connectionId',:'connection_id'))::text,true);
set local role service_role;
select set_config('test.lookup',jsonb_build_object('operation','lookup','connectionId',:'connection_id','sourceOrganizationId','10000000-0000-4000-8000-000000000001','destinationOrganizationId','10000000-0000-4000-8000-000000000002','kind','contact','query','João','cursor',null,'limit',25)::text,true);
select fecha_test.assert(jsonb_array_length(public.fecha_ai_integration(repeat('a',64),current_setting('test.lookup')::jsonb)->'choices')=1,'lookup is scoped to destination organization');
select fecha_test.assert(jsonb_array_length(public.fecha_ai_integration(repeat('a',64),current_setting('test.lookup')::jsonb||'{"query":"%"}'::jsonb)->'choices')=0,'lookup treats wildcard input literally');
select fecha_test.denied(format('select public.fecha_ai_integration(repeat(''a'',64),%L::jsonb||''{"destinationOrganizationId":"10000000-0000-4000-8000-000000000003"}''::jsonb)',current_setting('test.lookup')),'scope_mismatch');
select fecha_test.assert(public.fecha_ai_integration(repeat('a',64),jsonb_build_object('operation','validate','envelope',current_setting('test.envelope')::jsonb))->>'status'='validated','preview validates real links and assignee without writing');
reset role;
select fecha_test.assert((select count(*)=0 from public.activities),'validate creates no native activities');
set local role service_role;
select fecha_test.denied(format('select public.fecha_ai_integration(repeat(''a'',64),jsonb_build_object(''operation'',''deliver'',''envelope'',%L::jsonb||''{"payloadHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}''::jsonb),''Note'',''Body'')',current_setting('test.envelope')),'invalid_payload_hash');
select fecha_test.denied(format('select public.fecha_ai_integration(repeat(''a'',64),jsonb_build_object(''operation'',''validate'',''envelope'',fecha_test.seal(jsonb_set(%L::jsonb,''{target,contactId}'',''"40000000-0000-4000-8000-000000000002"''::jsonb))))',current_setting('test.envelope')),'target_not_found');
select fecha_test.denied(format('select public.fecha_ai_integration(repeat(''a'',64),jsonb_build_object(''operation'',''validate'',''envelope'',fecha_test.seal(jsonb_set(%L::jsonb,''{target,companyId}'',''"41000000-0000-4000-8000-000000000001"''::jsonb))))',current_setting('test.envelope')),'target_relationship_conflict');
select fecha_test.denied(format('select public.fecha_ai_integration(repeat(''a'',64),jsonb_build_object(''operation'',''validate'',''envelope'',fecha_test.seal(jsonb_set(%L::jsonb,''{destinationActorId}'',''"20000000-0000-4000-8000-000000000003"''::jsonb))))',current_setting('test.envelope')),'actor_not_allowed');
select fecha_test.denied(format('select public.fecha_ai_integration(repeat(''a'',64),jsonb_build_object(''operation'',''validate'',''envelope'',fecha_test.seal(jsonb_set(%L::jsonb,''{nextStep,assigneeId}'',''"20000000-0000-4000-8000-000000000004"''::jsonb))))',current_setting('test.envelope')),'forbidden');
select set_config('test.receipt',public.fecha_ai_integration(repeat('a',64),jsonb_build_object('operation','deliver','envelope',current_setting('test.envelope')::jsonb),'Fecha IA · Revisão comercial','Resumo revisado exato de teste')::text,true);
select fecha_test.assert(current_setting('request.jwt.claim.sub',true)='','actor claim is restored after the atomic write');
select fecha_test.assert(public.fecha_ai_integration(repeat('a',64),jsonb_build_object('operation','deliver','envelope',current_setting('test.envelope')::jsonb),'Different ignored title','Different ignored body')=current_setting('test.receipt')::jsonb,'identical delivery retry returns the immutable original receipt');
select fecha_test.assert(public.fecha_ai_integration(repeat('a',64),(current_setting('test.envelope')::jsonb-'schemaVersion'-'source'-'destination'-'sourceOwnerId'-'reviewedBySourceUserId'-'destinationActorId'-'reviewedAt'-'target'-'reviewNote'-'previousReceipt'-'nextStep')||'{"operation":"receipt"}'::jsonb)=current_setting('test.receipt')::jsonb,'receipt query returns final persistence confirmation');
reset role;
select fecha_test.assert((select count(*)=2 from public.activities),'one note and one task were persisted atomically');
select fecha_test.assert((select bool_and(created_by='20000000-0000-4000-8000-000000000002') from public.activities),'native note/task authorship uses the allowed CRM actor');
select fecha_test.assert((select count(*)=2 from public.audit_logs where entity_type='activities' and user_id='20000000-0000-4000-8000-000000000002'),'native activity audit records the same actor');
select fecha_test.assert((select count(*)=0 from public.payments),'won and payment metadata never write the financial tables');
update public.activities set title='Tarefa alterada no CRM',body='Edição manual',completed_at=clock_timestamp(),due_date=clock_timestamp()+interval '5 days' where type='task';
select set_config('test.task',row_to_json(a)::text,true) from public.activities a where type='task';
select set_config('test.append',fecha_test.seal(current_setting('test.envelope')::jsonb||jsonb_build_object('operation','append_note_preserve_task','reviewRevision',9,'nextStep',null,'previousReceipt',jsonb_build_object('deliveryId',current_setting('test.receipt')::jsonb->'deliveryId','sourceReviewRevision',7,'noteId',current_setting('test.receipt')::jsonb->'noteId','taskId',current_setting('test.receipt')::jsonb->'taskId','destinationRevision',1)))::text,true);
set local role service_role;
select fecha_test.denied(format('select public.fecha_ai_integration(repeat(''a'',64),jsonb_build_object(''operation'',''deliver'',''envelope'',fecha_test.seal(jsonb_set(%L::jsonb,''{reviewNote,summary}'',''"Outro resumo"''::jsonb))),''Note'',''Body'')',current_setting('test.envelope')),'idempotency_conflict');
select fecha_test.denied(format('select public.fecha_ai_integration(repeat(''a'',64),jsonb_build_object(''operation'',''deliver'',''envelope'',fecha_test.seal(%L::jsonb||''{"reviewRevision":9}''::jsonb)),''Note'',''Body'')',current_setting('test.envelope')),'previous_delivery_requires_append');
select set_config('test.append_receipt',public.fecha_ai_integration(repeat('a',64),jsonb_build_object('operation','deliver','envelope',current_setting('test.append')::jsonb),'Revisão posterior','Resumo posterior revisado')::text,true);
select fecha_test.assert((current_setting('test.append_receipt')::jsonb->>'taskDisposition')='preserved' and (current_setting('test.append_receipt')::jsonb->>'destinationRevision')='2','append records a new note and preserves the old task ID');
reset role;
select fecha_test.assert((select count(*)=3 from public.activities),'append creates exactly one additional note');
select fecha_test.assert((select row_to_json(a)::jsonb=current_setting('test.task')::jsonb from public.activities a where type='task'),'append leaves completed/edited task byte-for-byte unchanged');
-- Force a failure after the note INSERT, proving transaction rollback rather than only prevalidation.
create function fecha_test.fail_task() returns trigger language plpgsql as $$ begin if new.type='task' then raise exception using message='test_task_failure'; end if; return new; end $$;
create trigger test_fail_task before insert on public.activities for each row execute function fecha_test.fail_task();
set local role service_role;
select fecha_test.denied(format('select public.fecha_ai_integration(repeat(''a'',64),jsonb_build_object(''operation'',''deliver'',''envelope'',fecha_test.seal(%L::jsonb||''{"callId":"30000000-0000-4000-8000-000000000002"}''::jsonb)),''Note'',''Body'')',current_setting('test.envelope')),'test_task_failure');
select fecha_test.assert(current_setting('request.jwt.claim.sub',true)='','failed write also restores actor claims through transaction rollback');
reset role;
drop trigger test_fail_task on public.activities;
select fecha_test.assert((select count(*)=3 from public.activities) and (select count(*)=2 from private.fecha_ai_deliveries),'failed task INSERT leaves no partial note or receipt');
update private.fecha_ai_connections set expires_at=clock_timestamp()-interval '1 minute' where id=:'connection_id';
set local role service_role;
select fecha_test.denied(format('select public.fecha_ai_integration(repeat(''a'',64),jsonb_build_object(''operation'',''describe'',''connectionId'',%L))',:'connection_id'),'invalid_connection_token');
reset role;
update private.fecha_ai_connections set expires_at=clock_timestamp()+interval '2 days' where id=:'connection_id';
update public.user_roles set role='viewer' where user_id='20000000-0000-4000-8000-000000000002';
set local role service_role;
select fecha_test.denied(format('select public.fecha_ai_integration(repeat(''a'',64),jsonb_build_object(''operation'',''deliver'',''envelope'',%L::jsonb),''Note'',''Body'')',current_setting('test.envelope')),'forbidden');
reset role;
update public.user_roles set role='owner' where user_id='20000000-0000-4000-8000-000000000002';
set local role service_role;
select fecha_test.denied(format('select public.fecha_ai_integration(repeat(''a'',64),jsonb_build_object(''operation'',''deliver'',''envelope'',fecha_test.seal(%L::jsonb||''{"reviewRevision":10}''::jsonb)),''Note'',''Body'')',current_setting('test.append')),'previous_receipt_conflict');
select public.manage_fecha_ai_connections('20000000-0000-4000-8000-000000000002',jsonb_build_object('operation','revoke','organizationId','10000000-0000-4000-8000-000000000002','connectionId',:'connection_id'));
select fecha_test.denied(format('select public.fecha_ai_integration(repeat(''a'',64),jsonb_build_object(''operation'',''deliver'',''envelope'',%L::jsonb),''Note'',''Body'')',current_setting('test.envelope')),'invalid_connection_token');
reset role;
select fecha_test.assert((select count(*)=2 from private.fecha_ai_deliveries),'revocation/rejection do not create partial notes or receipts');
select fecha_test.assert((select count(*)=2 from private.fecha_ai_connection_events),'create/revoke have a separate operational audit');
\if :{?keep_fecha_fixture}
update private.fecha_ai_connections set revoked_at=null where id=:'connection_id';
create table fecha_test.concurrent_input(request jsonb not null);
insert into fecha_test.concurrent_input values(jsonb_build_object('operation','deliver','envelope',fecha_test.seal(current_setting('test.envelope')::jsonb||'{"callId":"30000000-0000-4000-8000-000000000003"}'::jsonb)));
grant select on fecha_test.concurrent_input to service_role;
commit;
\else
rollback;
\endif
