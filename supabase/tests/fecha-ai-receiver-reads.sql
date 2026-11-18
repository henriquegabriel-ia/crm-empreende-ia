-- Reads of the Fecha IA (item B20 of the Fecha IA; supabase/functions/README.md, "Leituras"): the reads off by default,
-- turned on per connection by an owner or administrator, the guard of every read (scope, allowed and active identity,
-- the limit per connection and the record of reads), what "context" and "outcomes" carry and leave out, in one
-- transaction that ends in rollback. Run by `npm run test:db` (fechaAiReceiverChecks in scripts/test-database.mjs) on
-- an empty instance; the real answers are also checked there against the contract and its conformance vector.
-- Pure SQL plus `\ir`: values shared between statements live in set_config('test.<name>', ..., true).
begin;
\ir fecha-ai-receiver-support.sql
select fecha_test.assert(not has_table_privilege('service_role','private.fecha_ai_read_events','select') and not has_table_privilege('authenticated','private.fecha_ai_read_events','select'),'the record of reads has no Data API access');
select fecha_test.assert(not has_function_privilege('service_role','private.fecha_read_context(private.fecha_ai_connections,jsonb)','execute') and not has_function_privilege('service_role','private.fecha_read_text(text,integer)','execute'),'the reads are reached only through the receiver RPC');
select set_config('test.manage',jsonb_build_object('operation','create','organizationId','10000000-0000-4000-8000-000000000002','name','Conexão com leituras','sourceOrganizationId','10000000-0000-4000-8000-000000000001','allowedActorIds',jsonb_build_array('20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003'),'expiresAt',clock_timestamp()+interval '2 days')::text,true);

-- 1. A connection created as before (no readScopes) has no read: the summary and describe of before, both reads refused.
set local role service_role;
select set_config('test.connection',public.manage_fecha_ai_connections('20000000-0000-4000-8000-000000000002',current_setting('test.manage')::jsonb,repeat('d',64))#>>'{connection,id}',true);
select fecha_test.assert(not (public.manage_fecha_ai_connections('20000000-0000-4000-8000-000000000002','{"operation":"list","organizationId":"10000000-0000-4000-8000-000000000002"}')->'connections'->0 ? 'readScopes'),'a connection without reads keeps the summary of before them');
select fecha_test.assert(public.fecha_ai_integration(repeat('d',64),jsonb_build_object('operation','describe','connectionId',current_setting('test.connection')))->'capabilities'='{"reviewedNotes":true,"optionalTask":true,"appendPreservesTask":true}'::jsonb,'describe of a connection without reads announces only the capabilities of before them');
select set_config('test.context',jsonb_build_object('operation','context','connectionId',current_setting('test.connection'),'sourceOrganizationId','10000000-0000-4000-8000-000000000001','destinationOrganizationId','10000000-0000-4000-8000-000000000002','sourceUserId','20000000-0000-4000-8000-000000000001','destinationActorId','20000000-0000-4000-8000-000000000002','target',jsonb_build_object('contactId','40000000-0000-4000-8000-000000000001','companyId',null,'dealId','42000000-0000-4000-8000-000000000001'))::text,true);
select set_config('test.outcomes',(current_setting('test.context')::jsonb-'target'||jsonb_build_object('operation','outcomes','dealIds',jsonb_build_array('42000000-0000-4000-8000-000000000003','42000000-0000-4000-8000-000000000001','42000000-0000-4000-8000-0000000000ff')))::text,true);
select fecha_test.denied(format('select public.fecha_ai_integration(repeat(''d'',64),%L::jsonb)',current_setting('test.context')),'read_not_allowed');
select fecha_test.denied(format('select public.fecha_ai_integration(repeat(''d'',64),%L::jsonb)',current_setting('test.outcomes')),'read_not_allowed');

-- 2. Only an owner or administrator turns the reads on, on an active connection, with a valid list; each change is an event.
select fecha_test.denied(format('select public.manage_fecha_ai_connections(''20000000-0000-4000-8000-000000000003'',%L::jsonb)',jsonb_build_object('operation','set_read_scopes','organizationId','10000000-0000-4000-8000-000000000002','connectionId',current_setting('test.connection'),'readScopes',jsonb_build_array('context'))),'forbidden');
select fecha_test.denied(format('select public.manage_fecha_ai_connections(''20000000-0000-4000-8000-000000000002'',%L::jsonb)',jsonb_build_object('operation','set_read_scopes','organizationId','10000000-0000-4000-8000-000000000002','connectionId',current_setting('test.connection'))||bad),'invalid_read_scopes')
 from unnest(array['{}','{"readScopes":"context"}','{"readScopes":["context","context"]}','{"readScopes":["notes"]}','{"readScopes":[1]}','{"readScopes":null}','{"readScopes":["context","outcomes","context"]}']::jsonb[]) bad;
select fecha_test.denied(format('select public.manage_fecha_ai_connections(''20000000-0000-4000-8000-000000000002'',%L::jsonb||''{"readScopes":["email"]}''::jsonb,repeat(''e'',64))',current_setting('test.manage')),'invalid_read_scopes');
select fecha_test.assert(public.manage_fecha_ai_connections('20000000-0000-4000-8000-000000000002',jsonb_build_object('operation','set_read_scopes','organizationId','10000000-0000-4000-8000-000000000002','connectionId',current_setting('test.connection'),'readScopes',jsonb_build_array('context')))#>'{connection,readScopes}'='["context"]'::jsonb,'an owner turns the context read on');
select fecha_test.assert(public.fecha_ai_integration(repeat('d',64),jsonb_build_object('operation','describe','connectionId',current_setting('test.connection')))->'capabilities'='{"reviewedNotes":true,"optionalTask":true,"appendPreservesTask":true,"contextRead":true}'::jsonb,'describe announces only the read turned on');
select fecha_test.denied(format('select public.fecha_ai_integration(repeat(''d'',64),%L::jsonb)',current_setting('test.outcomes')),'read_not_allowed');
reset role;
select fecha_test.assert((select read_scopes='{context}' and allowed_actor_ids is not null from private.fecha_ai_connection_events where connection_id=current_setting('test.connection')::uuid and action='set_read_scopes'),'the change of the reads is an event, with the reads');
select fecha_test.assert((select read_scopes='{}' from private.fecha_ai_connection_events where connection_id=current_setting('test.connection')::uuid and action='create'),'the creation event records the reads it started with');

-- The text read from the CRM (private.fecha_read_text): e-mails and Brazilian phones replaced, other numbers kept, the
-- JavaScript trim(), the cut at whole UTF-16 units and control characters turned into spaces.
select fecha_test.assert(private.fecha_read_text(input,500) is not distinct from expected,format('read text: %s',coalesce(expected,'(nulo)')))
 from (values
  ('Escreva para ana.souza+crm@empresa.com.br hoje','Escreva para [e-mail omitido] hoje'),
  ('Ligar (11) 98765-4321, +55 21 3456-7890 ou 11987654321','Ligar [telefone omitido], [telefone omitido] ou [telefone omitido]'),
  ('Celular 98765-4321; fixo 3456-7890 sem DDD','Celular [telefone omitido]; fixo 3456-7890 sem DDD'),
  ('Contrato 2025-2026, CEP 01310-100, R$ 12.500,00, CPF 123.456.789-09 e 14h30','Contrato 2025-2026, CEP 01310-100, R$ 12.500,00, CPF 123.456.789-09 e 14h30'),
  ('Pedido 123456789012345','Pedido 123456789012345'),
  (chr(65279)||chr(160)||' Texto com espaço'||chr(12288),'Texto com espaço'),
  ('linha 1'||chr(10)||'linha 2'||chr(1)||'fim'||chr(127),'linha 1'||chr(10)||'linha 2 fim'),
  (chr(160)||chr(8232),null),
  (null,null)
 ) v(input,expected);
select fecha_test.assert(private.fecha_read_text(repeat('a',499)||chr(128512),500)=repeat('a',499) and private.fecha_read_text(repeat('a',498)||chr(128512),500)=repeat('a',498)||chr(128512),'the cut never splits a character outside the basic plane');

-- 3. "context": each asked record, what is linked to any of them, nothing of other organizations, never e-mail or phone.
-- The base stamps created_at with now() (protect_record_metadata): off only for these inserts, to date the history.
alter table public.activities disable trigger protect_record_metadata;
insert into public.activities(id,org_id,type,title,body,contact_id,deal_id,user_id,due_date,completed_at,created_at) values
('43000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','note','Diagnóstico','Falar com joao@example.test ou (11) 91234-5678. Ano 2025-2026, CEP 01310-100, pedido 12.500,00.','40000000-0000-4000-8000-000000000001',null,null,null,null,clock_timestamp()-interval '3 days'),
('43000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','task','Ligar para 11987654321',null,null,'42000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000003',clock_timestamp()+interval '2 days',null,clock_timestamp()-interval '2 days'),
('43000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','call','Primeira ligação',repeat(chr(128512),300),'40000000-0000-4000-8000-000000000001',null,'20000000-0000-4000-8000-000000000002',clock_timestamp()-interval '1 day',clock_timestamp()-interval '1 day',clock_timestamp()-interval '5 days'),
('43000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000002','note',chr(160)||chr(9),' '||chr(65279),'40000000-0000-4000-8000-000000000001',null,null,null,null,clock_timestamp()-interval '4 days');
insert into public.activities(org_id,type,title,contact_id,due_date,created_at)
select '10000000-0000-4000-8000-000000000002','task','Tarefa '||n,'40000000-0000-4000-8000-000000000001',clock_timestamp()+n*interval '3 days',clock_timestamp()-interval '1 day' from generate_series(1,12) n;
insert into public.activities(org_id,type,title,contact_id,created_at)
select '10000000-0000-4000-8000-000000000002','note','Nota antiga '||n,'40000000-0000-4000-8000-000000000001',clock_timestamp()-interval '30 days'-n*interval '1 day' from generate_series(1,12) n;
insert into public.activities(org_id,type,title,contact_id) values('10000000-0000-4000-8000-000000000003','note','Nota de outra equipe','40000000-0000-4000-8000-000000000002');
alter table public.activities enable trigger protect_record_metadata;
-- After the activities: "Não contatar" refuses new calls and meetings with the contact, never a read.
update public.contacts set last_name='Pereira',email='joao@example.test',phone='+55 11 91234-5678',notes='Observação reservada',status='customer',do_not_contact=true where id='40000000-0000-4000-8000-000000000001';
set local role service_role;
select set_config('test.read',public.fecha_ai_integration(repeat('d',64),current_setting('test.context')::jsonb)::text,true);
reset role;
select fecha_test.assert((select array_agg(k order by k collate "C") from jsonb_object_keys(current_setting('test.read')::jsonb) k)=array['commitments','company','connectionId','contact','deal','destinationOrganizationId','readAt','recentActivities','reviews','schemaVersion','sourceOrganizationId'],'context answers exactly the keys of the contract');
select fecha_test.assert(current_setting('test.read')::jsonb->'contact'=jsonb_build_object('id','40000000-0000-4000-8000-000000000001','label','João Pereira','status','customer','doNotContact',true),'the contact carries the name, the status and "Não contatar", nothing else');
select fecha_test.assert(strpos(current_setting('test.read'),'joao@example.test')=0 and strpos(current_setting('test.read'),'91234')=0 and strpos(current_setting('test.read'),'87654321')=0 and strpos(current_setting('test.read'),'Observação reservada')=0,'no e-mail, phone or contact notes leave the CRM, not even typed in an activity');
select fecha_test.assert(current_setting('test.read')::jsonb->'company'='null'::jsonb and current_setting('test.read')::jsonb#>'{deal,stage}'='{"label":"Novo contato","position":1,"count":1}'::jsonb and current_setting('test.read')::jsonb#>>'{deal,status}'='open' and current_setting('test.read')::jsonb#>'{deal,closedAt}'='null'::jsonb and current_setting('test.read')::jsonb#>'{deal,lostReason}'='null'::jsonb,'the deal carries its stage among the stages of its pipeline, open without closing date or lost reason');
select fecha_test.assert(jsonb_array_length(current_setting('test.read')::jsonb->'commitments')=10 and current_setting('test.read')::jsonb#>'{commitments,0}'=jsonb_build_object('id','43000000-0000-4000-8000-000000000002','type','task','title','Ligar para [telefone omitido]','dueAt',current_setting('test.read')::jsonb#>'{commitments,0,dueAt}','assignee',jsonb_build_object('id','20000000-0000-4000-8000-000000000003','label','Pessoa comercial')),'up to 10 pending actions by due date, with the assignee name and the phone replaced');
select fecha_test.assert((select bool_and(c->>'type'<>'note') from jsonb_array_elements(current_setting('test.read')::jsonb->'commitments') c) and current_setting('test.read')::jsonb#>>'{commitments,1,title}'='Tarefa 1' and current_setting('test.read')::jsonb#>>'{commitments,9,title}'='Tarefa 9','the commitments are actions, never notes, the nearest due date first');
select fecha_test.assert(jsonb_array_length(current_setting('test.read')::jsonb->'recentActivities')=10 and current_setting('test.read')::jsonb#>>'{recentActivities,0,id}'='43000000-0000-4000-8000-000000000003' and current_setting('test.read')::jsonb#>>'{recentActivities,1,id}'='43000000-0000-4000-8000-000000000001' and current_setting('test.read')::jsonb#>>'{recentActivities,2,id}'='43000000-0000-4000-8000-000000000004','up to 10 notes and completed actions, the latest first');
select fecha_test.assert(current_setting('test.read')::jsonb#>>'{recentActivities,1,excerpt}'='Falar com [e-mail omitido] ou [telefone omitido]. Ano 2025-2026, CEP 01310-100, pedido 12.500,00.','the excerpt replaces e-mails and phones and keeps years, postal codes and values');
select fecha_test.assert(current_setting('test.read')::jsonb#>>'{recentActivities,0,excerpt}'=repeat(chr(128512),250) and length(current_setting('test.read')::jsonb#>>'{recentActivities,0,excerpt}')=250,'the excerpt stops at 500 UTF-16 units without splitting a character');
select fecha_test.assert(current_setting('test.read')::jsonb#>>'{recentActivities,2,title}'='Nota' and current_setting('test.read')::jsonb#>'{recentActivities,2,excerpt}'='null'::jsonb,'a title of only spaces becomes the name of the type, and empty details no excerpt');
select fecha_test.assert(strpos(current_setting('test.read'),'Nota de outra equipe')=0 and jsonb_array_length(current_setting('test.read')::jsonb->'reviews')=0,'nothing of another organization, and no review delivered yet');
select fecha_test.assert((select count(*)=1 from private.fecha_ai_read_events where connection_id=current_setting('test.connection')::uuid and operation='context' and actor_id='20000000-0000-4000-8000-000000000002' and source_user_id='20000000-0000-4000-8000-000000000001' and contact_id='40000000-0000-4000-8000-000000000001' and deal_id='42000000-0000-4000-8000-000000000001' and company_id is null and deal_count is null),'the read is recorded with who asked, the identity and the records, no text');

-- 4. The reviews already delivered to the records, without their notes among the latest activities.
select set_config('test.envelope',fecha_test.seal(fecha_test.base()||jsonb_build_object('connectionId',current_setting('test.connection'),'callId','30000000-0000-4000-8000-000000000040','nextStep',null))::text,true);
set local role service_role;
select set_config('test.receipt',public.fecha_ai_integration(repeat('d',64),jsonb_build_object('operation','deliver','envelope',current_setting('test.envelope')::jsonb),'Fecha IA · Revisão comercial','Resumo revisado da leitura')::text,true);
select set_config('test.read',public.fecha_ai_integration(repeat('d',64),current_setting('test.context')::jsonb)::text,true);
reset role;
select fecha_test.assert(current_setting('test.read')::jsonb->'reviews'=jsonb_build_array(jsonb_build_object('deliveryId',current_setting('test.receipt')::jsonb->'deliveryId','callId','30000000-0000-4000-8000-000000000040','sourceReviewRevision',7,'persistedAt',current_setting('test.receipt')::jsonb->'persistedAt')),'the delivered review appears as its receipt');
select fecha_test.assert(strpos(current_setting('test.read'),current_setting('test.receipt')::jsonb->>'noteId')=0,'the note of the review is not repeated among the latest activities');

-- 5. Refusals: other organization, unknown or anonymized records, scope, identity, malformed request.
set local role service_role;
select fecha_test.denied(format('select public.fecha_ai_integration(repeat(''d'',64),jsonb_set(%L::jsonb,''{target,contactId}'',''"40000000-0000-4000-8000-000000000002"''))',current_setting('test.context')),'target_not_found');
select fecha_test.denied(format('select public.fecha_ai_integration(repeat(''d'',64),jsonb_set(%L::jsonb,''{target,dealId}'',''"42000000-0000-4000-8000-0000000000ff"''))',current_setting('test.context')),'target_not_found');
select fecha_test.denied(format('select public.fecha_ai_integration(repeat(''d'',64),jsonb_set(%L::jsonb,''{target,companyId}'',''"41000000-0000-4000-8000-0000000000ff"''))',current_setting('test.context')),'target_not_found');
select fecha_test.denied(format('select public.fecha_ai_integration(repeat(''d'',64),%L::jsonb||''{"destinationOrganizationId":"10000000-0000-4000-8000-000000000003"}''::jsonb)',current_setting('test.context')),'scope_mismatch');
select fecha_test.denied(format('select public.fecha_ai_integration(repeat(''d'',64),%L::jsonb||''{"destinationActorId":"20000000-0000-4000-8000-000000000006"}''::jsonb)',current_setting('test.context')),'actor_not_allowed');
select fecha_test.denied(format('select public.fecha_ai_integration(repeat(''d'',64),%L::jsonb-''sourceUserId'')',current_setting('test.context')),'invalid_read');
select fecha_test.denied(format('select public.fecha_ai_integration(repeat(''d'',64),jsonb_set(%L::jsonb,''{target}'',''{"contactId":null,"companyId":null,"dealId":null}''))',current_setting('test.context')),'target_required');
select fecha_test.denied(format('select public.fecha_ai_integration(repeat(''e'',64),%L::jsonb)',current_setting('test.context')),'invalid_connection_token');
reset role;
select fecha_test.assert((select count(*)=2 from private.fecha_ai_read_events where connection_id=current_setting('test.connection')::uuid),'a refused read leaves no record and does not count in the limit');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',true);
select public.anonymize_contact('40000000-0000-4000-8000-000000000007',(select updated_at from public.contacts where id='40000000-0000-4000-8000-000000000007'));
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role service_role;
select fecha_test.denied(format('select public.fecha_ai_integration(repeat(''d'',64),jsonb_set(%L::jsonb,''{target}'',''{"contactId":"40000000-0000-4000-8000-000000000007","companyId":null,"dealId":null}''))',current_setting('test.context')),'target_anonymized');
reset role;
update public.user_roles set deactivated_at=now() where user_id='20000000-0000-4000-8000-000000000003';
set local role service_role;
select fecha_test.denied(format('select public.fecha_ai_integration(repeat(''d'',64),%L::jsonb||''{"destinationActorId":"20000000-0000-4000-8000-000000000003"}''::jsonb)',current_setting('test.context')),'forbidden');
reset role;
update public.user_roles set deactivated_at=null where user_id='20000000-0000-4000-8000-000000000003';

-- 6. "outcomes": exactly the asked deals of the organization, without title, value or lost reason.
update public.deals set status='lost',lost_reason='Escolheu outra opção; ligar 11 98765-4321',value=15000 where id='42000000-0000-4000-8000-000000000003';
insert into public.payments(org_id,description,amount,status,deal_id,due_date,paid_at) values
('10000000-0000-4000-8000-000000000002','Entrada',500,'paid','42000000-0000-4000-8000-000000000001',current_date,'2026-09-09 10:00:00+00'),
('10000000-0000-4000-8000-000000000002','Parcela',500,'paid','42000000-0000-4000-8000-000000000001',current_date,'2026-09-03 10:00:00+00'),
('10000000-0000-4000-8000-000000000002','Parcela cancelada',500,'cancelled','42000000-0000-4000-8000-000000000001',current_date,null),
('10000000-0000-4000-8000-000000000002','Parcela pendente',500,'pending','42000000-0000-4000-8000-000000000001',current_date,null);
set local role service_role;
select public.manage_fecha_ai_connections('20000000-0000-4000-8000-000000000002',jsonb_build_object('operation','set_read_scopes','organizationId','10000000-0000-4000-8000-000000000002','connectionId',current_setting('test.connection'),'readScopes',jsonb_build_array('outcomes','context')));
select set_config('test.result',public.fecha_ai_integration(repeat('d',64),current_setting('test.outcomes')::jsonb)::text,true);
select fecha_test.assert(public.fecha_ai_integration(repeat('d',64),jsonb_build_object('operation','describe','connectionId',current_setting('test.connection')))#>'{capabilities,outcomesRead}'='true'::jsonb,'describe announces the outcomes read once turned on');
reset role;
select fecha_test.assert(current_setting('test.result')::jsonb->'missingDealIds'='["42000000-0000-4000-8000-0000000000ff"]'::jsonb and jsonb_array_length(current_setting('test.result')::jsonb->'outcomes')=2,'outcomes answers the deals found and lists the missing one');
select fecha_test.assert(current_setting('test.result')::jsonb#>'{outcomes,0}'=jsonb_build_object('dealId','42000000-0000-4000-8000-000000000001','status','open','stage',jsonb_build_object('label','Novo contato','position',1,'count',1),'closedAt',null,'firstPaidAt','2026-09-03T10:00:00.000Z'),'an open deal with the first paid payment, cancelled and pending ones aside');
select fecha_test.assert(current_setting('test.result')::jsonb#>>'{outcomes,1,status}'='lost' and current_setting('test.result')::jsonb#>'{outcomes,1,closedAt}'<>'null'::jsonb and current_setting('test.result')::jsonb#>'{outcomes,1,firstPaidAt}'='null'::jsonb,'a lost deal with its closing date');
select fecha_test.assert(strpos(current_setting('test.result'),'Escolheu')=0 and strpos(current_setting('test.result'),'15000')=0 and strpos(current_setting('test.result'),'Proposta da Carla')=0,'outcomes carries no lost reason, value or title');
set local role service_role;
select fecha_test.denied(format('select public.fecha_ai_integration(repeat(''d'',64),%L::jsonb||jsonb_build_object(''dealIds'',%L::jsonb))',current_setting('test.outcomes'),bad),'invalid_read')
 from unnest(array['[]','"42000000-0000-4000-8000-000000000001"','["42000000-0000-4000-8000-000000000001","42000000-0000-4000-8000-000000000001"]',
  (select jsonb_agg(gen_random_uuid())::text from generate_series(1,101))]) bad;
select set_config('test.context_read',public.fecha_ai_integration(repeat('d',64),jsonb_set(current_setting('test.context')::jsonb,'{target}','{"contactId":null,"companyId":null,"dealId":"42000000-0000-4000-8000-000000000003"}'))::text,true);
reset role;
select fecha_test.assert(current_setting('test.context_read')::jsonb#>>'{deal,lostReason}'='Escolheu outra opção; ligar [telefone omitido]' and current_setting('test.context_read')::jsonb->'contact'='null'::jsonb,'the context of a lost deal carries its lost reason, without the phone, and only what was asked');
select fecha_test.assert((select deal_count=3 from private.fecha_ai_read_events where operation='outcomes'),'the outcomes read is recorded with the number of deals');

-- 7. The limit per connection: 30 reads in a minute; older reads do not count, and a revoked connection reads nothing.
insert into private.fecha_ai_read_events(connection_id,org_id,operation,actor_id,source_user_id,deal_count,created_at)
select current_setting('test.connection')::uuid,'10000000-0000-4000-8000-000000000002','outcomes','20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001',1,clock_timestamp()-interval '30 seconds' from generate_series(1,26);
set local role service_role;
select fecha_test.denied(format('select public.fecha_ai_integration(repeat(''d'',64),%L::jsonb)',current_setting('test.context')),'read_rate_limited');
reset role;
update private.fecha_ai_read_events set created_at=clock_timestamp()-interval '2 minutes' where connection_id=current_setting('test.connection')::uuid;
set local role service_role;
select fecha_test.assert(public.fecha_ai_integration(repeat('d',64),current_setting('test.context')::jsonb)->>'schemaVersion'='1','reads older than a minute leave the limit');
select public.manage_fecha_ai_connections('20000000-0000-4000-8000-000000000002',jsonb_build_object('operation','set_read_scopes','organizationId','10000000-0000-4000-8000-000000000002','connectionId',current_setting('test.connection'),'readScopes','[]'::jsonb));
select fecha_test.assert(public.fecha_ai_integration(repeat('d',64),jsonb_build_object('operation','describe','connectionId',current_setting('test.connection')))->'capabilities'='{"reviewedNotes":true,"optionalTask":true,"appendPreservesTask":true}'::jsonb,'turning the reads off removes them from describe');
select fecha_test.denied(format('select public.fecha_ai_integration(repeat(''d'',64),%L::jsonb)',current_setting('test.context')),'read_not_allowed');
select public.manage_fecha_ai_connections('20000000-0000-4000-8000-000000000002',jsonb_build_object('operation','set_read_scopes','organizationId','10000000-0000-4000-8000-000000000002','connectionId',current_setting('test.connection'),'readScopes','["context"]'::jsonb));
select public.manage_fecha_ai_connections('20000000-0000-4000-8000-000000000002',jsonb_build_object('operation','revoke','organizationId','10000000-0000-4000-8000-000000000002','connectionId',current_setting('test.connection')));
select fecha_test.denied(format('select public.fecha_ai_integration(repeat(''d'',64),%L::jsonb)',current_setting('test.context')),'invalid_connection_token');
select fecha_test.denied(format('select public.manage_fecha_ai_connections(''20000000-0000-4000-8000-000000000002'',%L::jsonb)',jsonb_build_object('operation','set_read_scopes','organizationId','10000000-0000-4000-8000-000000000002','connectionId',current_setting('test.connection'),'readScopes',jsonb_build_array('context'))),'connection_inactive');
reset role;
rollback;
