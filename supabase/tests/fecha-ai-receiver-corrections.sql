-- Corrections of the F0 port of the Fecha IA receiver (roadmap 3.4; docs/INTEGRACOES-PENDENTES.md), included by
-- fecha-ai-receiver.sql after the checks of the original pull request, in the same transaction (rollback at the end):
-- set_actors, deactivated members (item 1.2), the contract labels, the cursor, the conflicts of a later review and the
-- anonymized contact (item 1.10), including the stored deliveries in the anonymization. A second connection (token hash
-- 'c' x 64) keeps the counts of the first one.
create function fecha_test.page_all(p_token text,p_request jsonb) returns jsonb language plpgsql as $$
declare v_ids jsonb:='[]'; v_cursor text; v_page jsonb; v_pages integer:=0;
begin
 loop
  v_page:=public.fecha_ai_integration(p_token,p_request||jsonb_build_object('cursor',v_cursor));
  v_ids:=v_ids||(select coalesce(jsonb_agg(c->'id' order by c->>'id'),'[]'::jsonb) from jsonb_array_elements(v_page->'choices') c);
  v_pages:=v_pages+1;
  v_cursor:=v_page->>'nextCursor';
  exit when v_cursor is null or v_pages>20;
 end loop;
 return jsonb_build_object('ids',v_ids,'pages',v_pages);
end $$;
create function fecha_test.labels(p_token text,p_request jsonb) returns jsonb language sql as $$
 select coalesce(jsonb_object_agg(c->>'id',c->>'label'),'{}'::jsonb) from jsonb_array_elements(public.fecha_ai_integration(p_token,p_request)->'choices') c;
$$;
grant execute on function fecha_test.page_all(text,jsonb),fecha_test.labels(text,jsonb) to service_role;

-- 1. set_actors: replaces the allowed actors (only active writers), with the operational audit.
set local role service_role;
select set_config('test.connection2',public.manage_fecha_ai_connections('20000000-0000-4000-8000-000000000002',jsonb_build_object('operation','create','organizationId','10000000-0000-4000-8000-000000000002','name','Conexão das correções','sourceOrganizationId','10000000-0000-4000-8000-000000000001','allowedActorIds',jsonb_build_array('20000000-0000-4000-8000-000000000002'),'expiresAt',clock_timestamp()+interval '2 days'),repeat('c',64))#>>'{connection,id}',true)::uuid;
select set_config('test.set_actors',jsonb_build_object('operation','set_actors','organizationId','10000000-0000-4000-8000-000000000002','connectionId',current_setting('test.connection2'),'allowedActorIds',jsonb_build_array('20000000-0000-4000-8000-000000000008','20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000006'))::text,true);
select fecha_test.assert(public.manage_fecha_ai_connections('20000000-0000-4000-8000-000000000002',current_setting('test.set_actors')::jsonb)#>'{connection,allowedActorIds}'=jsonb_build_array('20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000006','20000000-0000-4000-8000-000000000008'),'set_actors replaces the allowed actors');
reset role;
select fecha_test.assert((select e.action='set_actors' and e.actor_id='20000000-0000-4000-8000-000000000002' and e.allowed_actor_ids=array['20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000006','20000000-0000-4000-8000-000000000008']::uuid[] from private.fecha_ai_connection_events e where e.connection_id=current_setting('test.connection2')::uuid order by e.created_at desc,e.action desc limit 1),'set_actors is recorded in the operational audit with who changed it');
set local role service_role;
select fecha_test.denied(format('select public.manage_fecha_ai_connections(''20000000-0000-4000-8000-000000000002'',%L::jsonb||''{"allowedActorIds":["20000000-0000-4000-8000-000000000004"]}''::jsonb)',current_setting('test.set_actors')),'forbidden');
select fecha_test.denied(format('select public.manage_fecha_ai_connections(''20000000-0000-4000-8000-000000000002'',%L::jsonb||''{"allowedActorIds":["20000000-0000-4000-8000-000000000003","20000000-0000-4000-8000-000000000003"]}''::jsonb)',current_setting('test.set_actors')),'invalid_actors');
select fecha_test.denied(format('select public.manage_fecha_ai_connections(''20000000-0000-4000-8000-000000000003'',%L::jsonb)',current_setting('test.set_actors')),'forbidden');
select fecha_test.denied(format('select public.manage_fecha_ai_connections(''20000000-0000-4000-8000-000000000002'',%L::jsonb||jsonb_build_object(''connectionId'',gen_random_uuid()))',current_setting('test.set_actors')),'connection_not_found');
select fecha_test.denied(format('select public.manage_fecha_ai_connections(''20000000-0000-4000-8000-000000000002'',%L::jsonb||jsonb_build_object(''connectionId'',%L))',current_setting('test.set_actors'),current_setting('test.connection')),'connection_inactive');

-- 2. Deactivated members (item 1.2): out of describe, of the actor options and of the assignee lookup, and refused as
-- actor, as assignee and when an administrator keeps them in set_actors.
reset role;
update public.user_roles set deactivated_at=now() where user_id='20000000-0000-4000-8000-000000000008';
set local role service_role;
select set_config('test.lookup2',jsonb_build_object('operation','lookup','connectionId',current_setting('test.connection2'),'sourceOrganizationId','10000000-0000-4000-8000-000000000001','destinationOrganizationId','10000000-0000-4000-8000-000000000002','kind','assignee','query','','cursor',null,'limit',50)::text,true);
select fecha_test.assert((select jsonb_agg(a->>'id' order by a->>'id') from jsonb_array_elements(public.fecha_ai_integration(repeat('c',64),jsonb_build_object('operation','describe','connectionId',current_setting('test.connection2')))->'allowedActors') a)=jsonb_build_array('20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000006'),'describe leaves out a deactivated allowed actor');
select fecha_test.assert(not (public.manage_fecha_ai_connections('20000000-0000-4000-8000-000000000002','{"operation":"actor_options","organizationId":"10000000-0000-4000-8000-000000000002"}')->'actors' @> '[{"id":"20000000-0000-4000-8000-000000000008"}]'),'actor options leave out a deactivated member');
select fecha_test.assert((select array_agg(k order by k) from jsonb_object_keys(fecha_test.labels(repeat('c',64),current_setting('test.lookup2')::jsonb)) k)=array['20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000006','20000000-0000-4000-8000-000000000007'],'assignee lookup offers only active owners, administrators and collaborators');
select fecha_test.denied(format('select public.manage_fecha_ai_connections(''20000000-0000-4000-8000-000000000002'',%L::jsonb)',current_setting('test.set_actors')),'forbidden');
select set_config('test.envelope2',fecha_test.seal(fecha_test.base()||jsonb_build_object('connectionId',current_setting('test.connection2'),'callId','30000000-0000-4000-8000-000000000011'))::text,true);
select fecha_test.denied(format('select public.fecha_ai_integration(repeat(''c'',64),jsonb_build_object(''operation'',''validate'',''envelope'',fecha_test.seal(%L::jsonb||''{"destinationActorId":"20000000-0000-4000-8000-000000000008"}''::jsonb)))',current_setting('test.envelope2')),'forbidden');
select fecha_test.denied(format('select public.fecha_ai_integration(repeat(''c'',64),jsonb_build_object(''operation'',''validate'',''envelope'',fecha_test.seal(jsonb_set(%L::jsonb,''{nextStep,assigneeId}'',''"20000000-0000-4000-8000-000000000008"''::jsonb))))',current_setting('test.envelope2')),'forbidden');
reset role;
savepoint no_actors;
update public.user_roles set deactivated_at=now() where user_id in ('20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000006');
set local role service_role;
select fecha_test.denied(format('select public.fecha_ai_integration(repeat(''c'',64),jsonb_build_object(''operation'',''describe'',''connectionId'',%L))',current_setting('test.connection2')),'connection_has_no_actors');
reset role;
rollback to savepoint no_actors;

-- 3. The contract labels: JavaScript trim(), at most 400 UTF-16 code units, trimmed again after the cut, with the
-- e-mail and the id as fallbacks (CrmLookupChoiceSchema and CrmActorChoiceSchema; the runner checks the real responses
-- against the schemas).
set local role service_role;
select set_config('test.contact_labels',fecha_test.labels(repeat('c',64),current_setting('test.lookup2')::jsonb||'{"kind":"contact"}'::jsonb)::text,true);
select fecha_test.assert(current_setting('test.contact_labels')::jsonb->>'40000000-0000-4000-8000-000000000003'='Ana','label trims TAB, NBSP and U+FEFF like JavaScript trim()');
select fecha_test.assert(current_setting('test.contact_labels')::jsonb->>'40000000-0000-4000-8000-000000000004'='40000000-0000-4000-8000-000000000004','a name made only of NBSP and U+2028 falls back to the id');
select fecha_test.assert(current_setting('test.contact_labels')::jsonb->>'40000000-0000-4000-8000-000000000005'=repeat(chr(128512),200),'label keeps at most 400 UTF-16 code units (200 characters outside the BMP)');
select fecha_test.assert(current_setting('test.contact_labels')::jsonb->>'40000000-0000-4000-8000-000000000006'=repeat('a',399),'label is trimmed again after the cut at 400 code units');
select fecha_test.assert(fecha_test.labels(repeat('c',64),current_setting('test.lookup2')::jsonb||'{"kind":"company"}'::jsonb)->>'41000000-0000-4000-8000-000000000002'='Empresa NBSP','company label trims NBSP and TAB');
select fecha_test.assert(fecha_test.labels(repeat('c',64),current_setting('test.lookup2')::jsonb||'{"kind":"deal"}'::jsonb)->>'42000000-0000-4000-8000-000000000002'='Renovação','deal label trims U+2028');
select set_config('test.assignee_labels',fecha_test.labels(repeat('c',64),current_setting('test.lookup2')::jsonb)::text,true);
select fecha_test.assert(current_setting('test.assignee_labels')::jsonb->>'20000000-0000-4000-8000-000000000006'='Bia' and current_setting('test.assignee_labels')::jsonb->>'20000000-0000-4000-8000-000000000007'='20000000-0000-4000-8000-000000000007','profile label trims U+FEFF and U+3000, and falls back to the id when name and e-mail are blank');
select set_config('test.validated',public.fecha_ai_integration(repeat('c',64),jsonb_build_object('operation','validate','envelope',fecha_test.seal(current_setting('test.envelope2')::jsonb||'{"target":{"contactId":null,"companyId":"41000000-0000-4000-8000-000000000002","dealId":null}}'::jsonb||jsonb_build_object('nextStep',jsonb_build_object('description','Conferir a proposta','assigneeId','20000000-0000-4000-8000-000000000006','dueAt','2026-09-07T18:00:00-03:00')))))::text,true);
select fecha_test.assert(current_setting('test.validated')::jsonb#>>'{target,company,label}'='Empresa NBSP' and current_setting('test.validated')::jsonb#>>'{assignee,label}'='Bia' and current_setting('test.validated')::jsonb#>>'{actor,label}'='Gestora','validate returns the normalized labels of the target, the assignee and the actor');
select fecha_test.assert(public.fecha_ai_integration(repeat('c',64),jsonb_build_object('operation','validate','envelope',fecha_test.seal(current_setting('test.envelope2')::jsonb||'{"target":{"contactId":null,"companyId":null,"dealId":"42000000-0000-4000-8000-000000000002"}}'::jsonb)))#>>'{target,deal,label}'='Renovação','validate returns the normalized deal label');

-- 4. The cursor: pages of two contacts, in id order, until nextCursor is null, without repetition or omission.
select set_config('test.paged',fecha_test.page_all(repeat('c',64),current_setting('test.lookup2')::jsonb||'{"kind":"contact","limit":2}'::jsonb)::text,true);
select fecha_test.assert(current_setting('test.paged')::jsonb->'ids'=(select jsonb_agg(to_jsonb(id::text) order by id) from public.contacts where org_id='10000000-0000-4000-8000-000000000002') and (current_setting('test.paged')::jsonb->>'pages')::int=3,'the cursor walks every contact of the organization once, two by two, in id order');
select fecha_test.assert((public.fecha_ai_integration(repeat('c',64),current_setting('test.lookup2')::jsonb||'{"kind":"contact","limit":6}'::jsonb)->>'nextCursor') is null,'a page with every remaining choice has no next cursor');

-- 5. A later review of a delivered conversation: stale_review, target_change_requires_resolution and
-- previous_task_missing (the task of the first delivery changed type in the CRM).
select set_config('test.receipt2',public.fecha_ai_integration(repeat('c',64),jsonb_build_object('operation','deliver','envelope',current_setting('test.envelope2')::jsonb),'Fecha IA · Revisão comercial','Resumo revisado da conexão das correções')::text,true);
select set_config('test.append2',(current_setting('test.envelope2')::jsonb||jsonb_build_object('operation','append_note_preserve_task','nextStep',null,'previousReceipt',jsonb_build_object('deliveryId',current_setting('test.receipt2')::jsonb->'deliveryId','sourceReviewRevision',7,'noteId',current_setting('test.receipt2')::jsonb->'noteId','taskId',current_setting('test.receipt2')::jsonb->'taskId','destinationRevision',1)))::text,true);
select fecha_test.denied(format('select public.fecha_ai_integration(repeat(''c'',64),jsonb_build_object(''operation'',''deliver'',''envelope'',fecha_test.seal(%L::jsonb||''{"reviewRevision":6}''::jsonb)),''Note'',''Body'')',current_setting('test.append2')),'stale_review');
select fecha_test.denied(format('select public.fecha_ai_integration(repeat(''c'',64),jsonb_build_object(''operation'',''deliver'',''envelope'',fecha_test.seal(%L::jsonb||''{"reviewRevision":8,"target":{"contactId":"40000000-0000-4000-8000-000000000001","companyId":null,"dealId":"42000000-0000-4000-8000-000000000001"}}''::jsonb)),''Note'',''Body'')',current_setting('test.append2')),'target_change_requires_resolution');
reset role;
update public.activities set type='call',completed_at=clock_timestamp() where id=(current_setting('test.receipt2')::jsonb->>'taskId')::uuid;
set local role service_role;
select fecha_test.denied(format('select public.fecha_ai_integration(repeat(''c'',64),jsonb_build_object(''operation'',''deliver'',''envelope'',fecha_test.seal(%L::jsonb||''{"reviewRevision":8}''::jsonb)),''Note'',''Body'')',current_setting('test.append2')),'previous_task_missing');
reset role;
select fecha_test.assert((select count(*)=1 from private.fecha_ai_deliveries where connection_id=current_setting('test.connection2')::uuid),'the refused later reviews write no receipt');

-- 6. The anonymized contact (item 1.10). Three deliveries before the anonymization: one with the person, one on her
-- opportunity without the contact and one elsewhere that cites her full name. After it, the free text of the first is
-- gone, the second loses every term of the person and the third her full name; receipts, hashes and links stay, the
-- retry still returns the original receipt, and a new review or an append with the person is refused.
set local role service_role;
select set_config('test.carla',fecha_test.seal(current_setting('test.envelope2')::jsonb||jsonb_build_object('callId','30000000-0000-4000-8000-000000000012','target',jsonb_build_object('contactId','40000000-0000-4000-8000-000000000007','companyId',null,'dealId',null))||jsonb_build_object('reviewNote',(current_setting('test.envelope2')::jsonb->'reviewNote')||'{"summary":"Carla Souza pediu a proposta por carla@example.test."}'::jsonb,'nextStep',jsonb_build_object('description','Ligar para Carla Souza','assigneeId','20000000-0000-4000-8000-000000000003','dueAt','2026-09-07T18:00:00-03:00')))::text,true);
select set_config('test.carla_receipt',public.fecha_ai_integration(repeat('c',64),jsonb_build_object('operation','deliver','envelope',current_setting('test.carla')::jsonb),'Fecha IA · Revisão comercial','Resumo com a Carla')::text,true);
select public.fecha_ai_integration(repeat('c',64),jsonb_build_object('operation','deliver','envelope',fecha_test.seal(current_setting('test.envelope2')::jsonb||jsonb_build_object('callId','30000000-0000-4000-8000-000000000013','nextStep',null,'target',jsonb_build_object('contactId',null,'companyId',null,'dealId','42000000-0000-4000-8000-000000000003'))||jsonb_build_object('reviewNote',(current_setting('test.envelope2')::jsonb->'reviewNote')||'{"summary":"Carla aprovou a proposta."}'::jsonb))),'Fecha IA · Revisão comercial','Oportunidade da Carla')->>'deliveryId';
select public.fecha_ai_integration(repeat('c',64),jsonb_build_object('operation','deliver','envelope',fecha_test.seal(current_setting('test.envelope2')::jsonb||jsonb_build_object('callId','30000000-0000-4000-8000-000000000014','nextStep',null,'target',jsonb_build_object('contactId',null,'companyId','41000000-0000-4000-8000-000000000001','dealId',null))||jsonb_build_object('reviewNote',(current_setting('test.envelope2')::jsonb->'reviewNote')||'{"summary":"Carla Souza indicou a empresa; Carla volta amanhã."}'::jsonb))),'Fecha IA · Revisão comercial','Indicação')->>'deliveryId';
reset role;
select set_config('test.carla_hashes',(select jsonb_object_agg(call_id,jsonb_build_array(payload_hash,receipt,payload->'target')) from private.fecha_ai_deliveries where call_id in ('30000000-0000-4000-8000-000000000012','30000000-0000-4000-8000-000000000013','30000000-0000-4000-8000-000000000014'))::text,true);

-- 6b. The data subject export (export_contact_data; review of the A2-CRM item) carries the stored deliveries as they
-- arrived, because the note and the task of a delivery may be edited or deleted in the CRM: the one with the person and
-- the ones on her opportunities, like the activities (with another contact, without his terms), with the summary, the
-- result, the payment and the next step, and without any id of the team or of the Fecha IA. The one elsewhere that
-- cites her stays out. A fourth delivery is made on an opportunity of João that then passes to Carla.
insert into public.deals(id,org_id,pipeline_id,stage_id,title,contact_id) values('42000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000002','45000000-0000-4000-8000-000000000001','46000000-0000-4000-8000-000000000001','Proposta indicada','40000000-0000-4000-8000-000000000001');
set local role service_role;
select public.fecha_ai_integration(repeat('c',64),jsonb_build_object('operation','deliver','envelope',fecha_test.seal(current_setting('test.envelope2')::jsonb||jsonb_build_object('callId','30000000-0000-4000-8000-000000000016','nextStep',null,'target',jsonb_build_object('contactId','40000000-0000-4000-8000-000000000001','companyId',null,'dealId','42000000-0000-4000-8000-000000000006'))||jsonb_build_object('reviewNote',(current_setting('test.envelope2')::jsonb->'reviewNote')||'{"summary":"João confirmou a indicação da Carla."}'::jsonb))),'Fecha IA · Revisão comercial','Indicação do João')->>'deliveryId';
reset role;
update public.deals set contact_id='40000000-0000-4000-8000-000000000007' where id='42000000-0000-4000-8000-000000000006';
update public.activities set body='Nota editada no CRM' where id=(current_setting('test.carla_receipt')::jsonb->>'noteId')::uuid;
delete from public.activities where id=(current_setting('test.carla_receipt')::jsonb->>'taskId')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',true);
select set_config('test.carla_export',public.export_contact_data('40000000-0000-4000-8000-000000000007')::text,true);
reset role;
select set_config('request.jwt.claim.sub','',true);
select fecha_test.assert((select string_agg((r->>'call_id')||'|'||(r->>'relation'),';' order by r->>'call_id') from jsonb_array_elements(current_setting('test.carla_export')::jsonb->'fecha_ai_reviews') r)='30000000-0000-4000-8000-000000000012|person;30000000-0000-4000-8000-000000000013|no_contact;30000000-0000-4000-8000-000000000016|other_contact','the export carries the deliveries with the person and on her opportunities, and leaves out the one elsewhere that cites her');
select fecha_test.assert((select r->>'summary'='Carla Souza pediu a proposta por carla@example.test.' and r->'next_step'=jsonb_build_object('description','Ligar para Carla Souza','due_at','2026-09-07T18:00:00-03:00') and r->>'commercial_result'='won' and r->>'payment_status'='pending' and r->>'reviewed_at'='2026-09-06T15:00:00.000Z' and (r->>'review_revision')::int=7 and r->'deal_id'='null'::jsonb from jsonb_array_elements(current_setting('test.carla_export')::jsonb->'fecha_ai_reviews') r where r->>'call_id'='30000000-0000-4000-8000-000000000012'),'the export carries the review as it arrived, after the note was edited and the task deleted in the CRM');
select fecha_test.assert((select r->>'summary'='Carla aprovou a proposta.' and r->'next_step'='null'::jsonb and r->>'deal_id'='42000000-0000-4000-8000-000000000003' from jsonb_array_elements(current_setting('test.carla_export')::jsonb->'fecha_ai_reviews') r where r->>'call_id'='30000000-0000-4000-8000-000000000013'),'the review on her opportunity goes with the opportunity and without a next step');
select fecha_test.assert((select r->>'summary'='[anonimizado] confirmou a indicação da Carla.' from jsonb_array_elements(current_setting('test.carla_export')::jsonb->'fecha_ai_reviews') r where r->>'call_id'='30000000-0000-4000-8000-000000000016'),'on her opportunity with another contact, the review goes without the terms of the other contact');
select fecha_test.assert(strpos(current_setting('test.carla_export'),'20000000-0000-4000-8000-')=0,'the export carries no id of the team or of the Fecha IA');
select fecha_test.assert((select summary->>'fecha_ai_reviews'='3' from public.privacy_actions where contact_id='40000000-0000-4000-8000-000000000007' and action='export'),'the record of the export counts the reviews');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',true);
select public.anonymize_contact('40000000-0000-4000-8000-000000000007',(select updated_at from public.contacts where id='40000000-0000-4000-8000-000000000007'));
reset role;
select set_config('request.jwt.claim.sub','',true);
select fecha_test.assert((select payload#>>'{reviewNote,summary}'='[anonimizado]' and payload#>>'{nextStep,description}'='[anonimizado]' from private.fecha_ai_deliveries where call_id='30000000-0000-4000-8000-000000000012'),'the anonymization removes the free text of the deliveries with the person');
select fecha_test.assert((select payload#>>'{reviewNote,summary}'='[anonimizado] aprovou a proposta.' from private.fecha_ai_deliveries where call_id='30000000-0000-4000-8000-000000000013'),'on her opportunity, every term of the person leaves the delivery (first name included)');
select fecha_test.assert((select payload#>>'{reviewNote,summary}'='[anonimizado] indicou a empresa; Carla volta amanhã.' from private.fecha_ai_deliveries where call_id='30000000-0000-4000-8000-000000000014'),'elsewhere, only the strong terms (full name, e-mail and phone) leave the delivery');
select fecha_test.assert((select jsonb_object_agg(call_id,jsonb_build_array(payload_hash,receipt,payload->'target')) from private.fecha_ai_deliveries where call_id in ('30000000-0000-4000-8000-000000000012','30000000-0000-4000-8000-000000000013','30000000-0000-4000-8000-000000000014'))=current_setting('test.carla_hashes')::jsonb,'hashes, receipts and links of the deliveries do not change');
set local role service_role;
select fecha_test.assert(public.fecha_ai_integration(repeat('c',64),jsonb_build_object('operation','deliver','envelope',current_setting('test.carla')::jsonb),'Outro título','Outro texto')=current_setting('test.carla_receipt')::jsonb,'the retry of a delivery with the anonymized person still returns the original receipt');
select fecha_test.denied(format('select public.fecha_ai_integration(repeat(''c'',64),jsonb_build_object(''operation'',''validate'',''envelope'',fecha_test.seal(%L::jsonb||''{"callId":"30000000-0000-4000-8000-000000000015"}''::jsonb)))',current_setting('test.carla')),'target_anonymized');
select fecha_test.denied(format('select public.fecha_ai_integration(repeat(''c'',64),jsonb_build_object(''operation'',''deliver'',''envelope'',fecha_test.seal(%L::jsonb||jsonb_build_object(''operation'',''append_note_preserve_task'',''reviewRevision'',8,''nextStep'',null,''previousReceipt'',jsonb_build_object(''deliveryId'',%L::jsonb->''deliveryId'',''sourceReviewRevision'',7,''noteId'',%L::jsonb->''noteId'',''taskId'',%L::jsonb->''taskId'',''destinationRevision'',1)))),''Note'',''Body'')',current_setting('test.carla'),current_setting('test.carla_receipt'),current_setting('test.carla_receipt'),current_setting('test.carla_receipt')),'target_anonymized');
select fecha_test.assert(not (fecha_test.labels(repeat('c',64),current_setting('test.lookup2')::jsonb||'{"kind":"contact","limit":50}'::jsonb) ? '40000000-0000-4000-8000-000000000007'),'contact lookup leaves out the anonymized contact');
reset role;
