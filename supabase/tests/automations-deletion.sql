-- Included inside commercial-security.sql's rollback transaction after deal-lifecycle.sql.
-- Item 0.7: deletions that failed because of links, and basic automations
-- (supabase/migrations/20261011110000_deletions_automation_scope.sql).
-- Run through `npm run test:db`: the upgrade checks below need the legacy rows that the runner writes from
-- supabase/tests/upgrade/20261011110000_deletions_automation_scope.sql right before that migration.
reset role;
select set_config('request.jwt.claim.sub','',true);
-- Schema: a log loses only the deleted link and keeps org_id (ON DELETE SET NULL with a column list).
select test_support.assert((select count(*)=3 and bool_and(c.confdeltype='n' and cardinality(c.confdelsetcols)=1 and c.confdelsetcols[1]=c.conkey[1]) from pg_constraint c where c.conrelid='public.automation_logs'::regclass and c.contype='f'),'automation log links are ON DELETE SET NULL on the link column only');
select test_support.assert((select count(*)=2 from pg_constraint c where c.conrelid='public.automations'::regclass and c.contype='f' and c.confrelid in ('public.pipelines'::regclass,'public.pipeline_stages'::regclass) and c.confdeltype='n' and cardinality(c.confdelsetcols)=1 and c.confdelsetcols[1]=c.conkey[1]),'automation pipeline and stage filters are ON DELETE SET NULL on the filter column only');
select test_support.assert((select attnotnull from pg_attribute where attrelid='public.automation_logs'::regclass and attname='automation_name') and not (select attnotnull from pg_attribute where attrelid='public.automation_logs'::regclass and attname='automation_id') and not (select attnotnull from pg_attribute where attrelid='public.automation_logs'::regclass and attname='deal_id'),'logs always keep the automation name, while the automation and the deal links are optional');
select test_support.assert(not has_function_privilege('anon','public.delete_deal(uuid,boolean)','execute') and not has_function_privilege('anon','public.automation_log_errors(uuid)','execute'),'anonymous cannot call delete_deal or automation_log_errors');
-- Backfill over the legacy organization written by the upgrade file, then the deletions that used to fail there.
select test_support.assert((select count(*)=2 from public.automation_logs where org_id='90000000-0000-0000-0000-000000000001' and automation_name='Retomar contato legado'),'backfill: existing logs receive the automation name');
select test_support.assert((select error_detail is null and error_message is not null from public.automation_logs where id='92000000-0000-0000-0000-000000000004'),'backfill: a legacy failure keeps its message and has no technical detail');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000099',true);
with removed as (delete from public.activities where id='92000000-0000-0000-0000-000000000002' returning 1) select test_support.assert(count(*)=1,'a legacy task created by an automation can be deleted') from removed;
select test_support.assert((select activity_id is null and automation_id is not null and status='success' from public.automation_logs where id='92000000-0000-0000-0000-000000000003'),'deleting the task keeps its run log without the task link');
with removed as (delete from public.automations where id='92000000-0000-0000-0000-000000000001' returning 1) select test_support.assert(count(*)=1,'a legacy automation with history can be deleted') from removed;
select test_support.assert((select count(*)=2 from public.automation_logs where org_id='90000000-0000-0000-0000-000000000001' and automation_id is null and automation_name='Retomar contato legado'),'deleting the automation keeps its logs with the name snapshot');
-- Pipeline and stage filter on "deal moved", as the owner of organization A.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select test_support.assert(exists(select 1 from public.automation_logs where automation_name='Preparar entrega' and status='success') and not exists(select 1 from public.automation_logs l join public.automations a on a.id=l.automation_id where l.automation_name is distinct from a.name),'runs record the automation name');
select set_config('test.stage_proposal',(select id from public.pipeline_stages where pipeline_id=current_setting('test.pipeline_a')::uuid and "order"=2)::text,true)::uuid;
select set_config('test.stage_negotiation',(select id from public.pipeline_stages where pipeline_id=current_setting('test.pipeline_a')::uuid and "order"=3)::text,true)::uuid;
insert into public.pipelines(id,org_id,name) values('21000000-0000-0000-0000-000000000001',current_setting('test.org_a')::uuid,'Pós-venda');
insert into public.pipeline_stages(id,org_id,pipeline_id,name,"order") values('21000000-0000-0000-0000-000000000002',current_setting('test.org_a')::uuid,'21000000-0000-0000-0000-000000000001','Implantação',0);
insert into public.automations(id,org_id,name,trigger_type,task_title,is_active,pipeline_id,stage_id) values
 ('22000000-0000-0000-0000-000000000001',current_setting('test.org_a')::uuid,'Preparar proposta','deal_moved','Enviar proposta',true,current_setting('test.pipeline_a')::uuid,current_setting('test.stage_proposal')::uuid),
 ('22000000-0000-0000-0000-000000000002',current_setting('test.org_a')::uuid,'Qualquer etapa do comercial','deal_moved','Revisar movimento',true,current_setting('test.pipeline_a')::uuid,null),
 ('22000000-0000-0000-0000-000000000003',current_setting('test.org_a')::uuid,'Etapa de outro funil','deal_moved','Iniciar implantação',true,'21000000-0000-0000-0000-000000000001','21000000-0000-0000-0000-000000000002');
insert into public.deals(id,org_id,pipeline_id,stage_id,title,value,owner_id,contact_id) values('20000000-0000-0000-0000-000000000010',current_setting('test.org_a')::uuid,current_setting('test.pipeline_a')::uuid,current_setting('test.stage_a')::uuid,'Oportunidade com filtro',3000,auth.uid(),'10000000-0000-0000-0000-000000000001');
select public.move_deal('20000000-0000-0000-0000-000000000010',current_setting('test.stage_a_next')::uuid);
select test_support.assert((select count(*)=0 from public.automation_logs where automation_id='22000000-0000-0000-0000-000000000001'),'a stage filter does not fire when the deal enters another stage');
select test_support.assert((select count(*)=1 from public.automation_logs where automation_id='22000000-0000-0000-0000-000000000002' and status='success'),'a pipeline filter without a stage fires on any stage of that pipeline');
select public.move_deal('20000000-0000-0000-0000-000000000010',current_setting('test.stage_proposal')::uuid);
select test_support.assert((select count(*)=1 from public.automation_logs l join public.activities a on a.id=l.activity_id where l.automation_id='22000000-0000-0000-0000-000000000001' and l.deal_id='20000000-0000-0000-0000-000000000010' and l.status='success' and l.automation_name='Preparar proposta' and a.title='Enviar proposta'),'a stage filter fires when the deal enters the configured stage');
select test_support.assert((select count(*)=0 from public.automation_logs where automation_id='22000000-0000-0000-0000-000000000003'),'a filter on another pipeline never fires for this pipeline');
select test_support.denied(format('insert into public.automations(org_id,name,trigger_type,task_title,stage_id) values(%L,''Sem funil'',''deal_moved'',''Tarefa'',%L)',current_setting('test.org_a'),current_setting('test.stage_proposal')),'a stage filter requires its pipeline');
select test_support.denied(format('insert into public.automations(org_id,name,trigger_type,task_title,pipeline_id,stage_id) values(%L,''Etapa trocada'',''deal_moved'',''Tarefa'',''21000000-0000-0000-0000-000000000001'',%L)',current_setting('test.org_a'),current_setting('test.stage_proposal')),'the stage filter must belong to the chosen pipeline');
select test_support.denied(format('insert into public.automations(org_id,name,trigger_type,task_title,pipeline_id) values(%L,''Criação filtrada'',''deal_created'',''Tarefa'',%L)',current_setting('test.org_a'),current_setting('test.pipeline_a')),'only the stage-change trigger accepts a pipeline or stage filter');
select test_support.denied(format('insert into public.automations(org_id,name,trigger_type,task_title,pipeline_id) values(%L,''Funil alheio'',''deal_moved'',''Tarefa'',%L)',current_setting('test.org_a'),current_setting('test.pipeline_b')),'the pipeline filter cannot point to another organization');
-- Editing an active automation keeps it active, even when the edit clears the stage filter.
update public.automations set task_title='Enviar proposta revisada',stage_id=null where id='22000000-0000-0000-0000-000000000001';
select test_support.assert((select is_active and stage_id is null and pipeline_id=current_setting('test.pipeline_a')::uuid from public.automations where id='22000000-0000-0000-0000-000000000001'),'editing an active automation keeps it active');
update public.automations set task_title='Enviar proposta',stage_id=current_setting('test.stage_proposal')::uuid where id='22000000-0000-0000-0000-000000000001';
-- Reserved bulk-move guard: the transaction-local setting suppresses automations, but not the stage history.
select set_config('crm.bulk_move','on',true);
select public.move_deal('20000000-0000-0000-0000-000000000010',current_setting('test.stage_a')::uuid);
select public.move_deal('20000000-0000-0000-0000-000000000010',current_setting('test.stage_proposal')::uuid);
select set_config('crm.bulk_move','',true);
select test_support.assert((select count(*)=1 from public.automation_logs where automation_id='22000000-0000-0000-0000-000000000001') and (select count(*)=2 from public.automation_logs where automation_id='22000000-0000-0000-0000-000000000002'),'crm.bulk_move = on suppresses automations');
select test_support.assert((select count(*)=5 from public.deal_stage_history where deal_id='20000000-0000-0000-0000-000000000010'),'bulk moves still record the stage history');
-- A failing run keeps the friendly message and stores SQLSTATE and SQLERRM in error_detail.
reset role;
alter table public.activities add constraint test_automation_failure check(title<>'Tarefa que falha');
set local role authenticated;
insert into public.automations(id,org_id,name,trigger_type,task_title,is_active,pipeline_id,stage_id) values('22000000-0000-0000-0000-000000000004',current_setting('test.org_a')::uuid,'Automação com falha','deal_moved','Tarefa que falha',true,current_setting('test.pipeline_a')::uuid,current_setting('test.stage_negotiation')::uuid);
select public.move_deal('20000000-0000-0000-0000-000000000010',current_setting('test.stage_negotiation')::uuid);
select test_support.assert((select stage_id=current_setting('test.stage_negotiation')::uuid from public.deals where id='20000000-0000-0000-0000-000000000010'),'a failing automation does not block the stage change');
reset role;
alter table public.activities drop constraint test_automation_failure;
select test_support.assert((select status='failed' and activity_id is null and automation_name='Automação com falha' and error_message='Não foi possível criar a tarefa. Revise os vínculos e o responsável.' and error_detail like '23514: %"test_automation_failure"%' from public.automation_logs where automation_id='22000000-0000-0000-0000-000000000004'),'a failed run stores SQLSTATE and SQLERRM in error_detail next to the friendly message');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
select test_support.assert((select count(*)=1 from public.automation_logs where automation_id='22000000-0000-0000-0000-000000000004' and status='failed' and error_message is not null),'members still read the automation runs');
select test_support.privilege_denied('select error_detail from public.automation_logs','members cannot read the technical failure detail');
select test_support.denied('select public.automation_log_errors(''22000000-0000-0000-0000-000000000004'')','members cannot read failure details through the RPC');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
select test_support.assert((select count(*)=0 from public.automation_log_errors('22000000-0000-0000-0000-000000000004')),'administrators of another organization get no failure detail');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
select test_support.assert((select count(*)=1 and min(error_detail) like '23514: %' from public.automation_log_errors('22000000-0000-0000-0000-000000000004')),'administrators read the failure detail through automation_log_errors');
-- Deleting a task created by an automation and an automation with history, as the administrator.
select set_config('test.proposal_task',(select activity_id from public.automation_logs where automation_id='22000000-0000-0000-0000-000000000001')::text,true)::uuid;
with removed as (delete from public.activities where id=current_setting('test.proposal_task')::uuid returning 1) select test_support.assert(count(*)=1,'administrators delete a task created by an automation') from removed;
select test_support.assert((select activity_id is null and status='success' from public.automation_logs where automation_id='22000000-0000-0000-0000-000000000001'),'the run log stays without the deleted task');
with removed as (delete from public.automations where id='22000000-0000-0000-0000-000000000001' returning 1) select test_support.assert(count(*)=1,'administrators delete an automation with history') from removed;
select test_support.assert((select count(*)=1 from public.automation_logs where automation_id is null and automation_name='Preparar proposta' and deal_id='20000000-0000-0000-0000-000000000010'),'the history of a deleted automation keeps its name');
-- delete_deal: counts the links, refuses without confirmation and keeps the records when confirmed.
insert into public.payments(id,org_id,description,amount,due_date,deal_id,contact_id) values('23000000-0000-0000-0000-000000000001',current_setting('test.org_a')::uuid,'Entrada da proposta',500,current_date,'20000000-0000-0000-0000-000000000010','10000000-0000-0000-0000-000000000001');
do $$
declare v_detail text;
begin
 begin
  perform public.delete_deal('20000000-0000-0000-0000-000000000010');
 exception when raise_exception then
  get stacked diagnostics v_detail=pg_exception_detail;
  perform test_support.assert(sqlerrm='Esta oportunidade tem vínculos: 3 atividades, 1 recebimento e 5 registros de automação. Confirme a exclusão para manter esses registros sem o vínculo.','delete_deal without confirmation refuses and lists the links in Portuguese');
  perform test_support.assert(v_detail::jsonb='{"activities":3,"payments":1,"automation_logs":5}'::jsonb,'delete_deal sends the link counts as JSON in the error detail');
  return;
 end;
 raise exception 'FAIL: delete_deal without confirmation deleted a deal with links';
end $$;
select test_support.assert((select count(*)=1 from public.deals where id='20000000-0000-0000-0000-000000000010'),'a refused deletion keeps the deal');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
select test_support.denied('select public.delete_deal(''20000000-0000-0000-0000-000000000010'',true)','members cannot delete deals through delete_deal');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000006',true);
select test_support.denied('select public.delete_deal(''20000000-0000-0000-0000-000000000010'',true)','viewers cannot delete deals through delete_deal');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
select test_support.denied('select public.delete_deal(''20000000-0000-0000-0000-000000000010'',true)','administrators of another organization cannot delete the deal');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
select test_support.assert((select public.delete_deal('20000000-0000-0000-0000-000000000010',true)='{"activities":3,"payments":1,"automation_logs":5}'::jsonb),'delete_deal with confirmation deletes and returns the counts');
select test_support.assert(not exists(select 1 from public.deals where id='20000000-0000-0000-0000-000000000010'),'the confirmed deletion removes the deal');
select test_support.assert((select count(*)=3 from public.activities where deal_id is null and title='Revisar movimento' and contact_id='10000000-0000-0000-0000-000000000001'),'linked activities stay, without the deal');
select test_support.assert((select deal_id is null and status='pending' and contact_id='10000000-0000-0000-0000-000000000001' from public.payments where id='23000000-0000-0000-0000-000000000001'),'linked payments stay, without the deal');
select test_support.assert((select count(*)=5 and count(*) filter (where automation_name in ('Qualquer etapa do comercial','Preparar proposta','Automação com falha'))=5 from public.automation_logs where deal_id is null and org_id=current_setting('test.org_a')::uuid),'automation logs stay with the deal link cleared and the automation name');
select test_support.assert(not exists(select 1 from public.deal_stage_history where deal_id='20000000-0000-0000-0000-000000000010'),'the stage history goes with the deleted deal');
insert into public.deals(id,org_id,pipeline_id,stage_id,title) values('20000000-0000-0000-0000-000000000011',current_setting('test.org_a')::uuid,'21000000-0000-0000-0000-000000000001','21000000-0000-0000-0000-000000000002','Sem vínculos');
select test_support.assert((select public.delete_deal('20000000-0000-0000-0000-000000000011')='{"activities":0,"payments":0,"automation_logs":0}'::jsonb),'a deal without links needs no confirmation');
select test_support.assert(not exists(select 1 from public.deals where id='20000000-0000-0000-0000-000000000011'),'a deal without links is deleted');
select test_support.denied('select public.delete_deal(''20000000-0000-0000-0000-000000000011'',true)','a missing deal cannot be deleted');
-- Removing the filtered stage or pipeline clears the filter and pauses the automation instead of widening it.
insert into public.pipeline_stages(id,org_id,pipeline_id,name,"order") values('21000000-0000-0000-0000-000000000003',current_setting('test.org_a')::uuid,current_setting('test.pipeline_a')::uuid,'Etapa temporária',9);
insert into public.automations(id,org_id,name,trigger_type,task_title,is_active,pipeline_id,stage_id) values('22000000-0000-0000-0000-000000000005',current_setting('test.org_a')::uuid,'Etapa que será removida','deal_moved','Tarefa',true,current_setting('test.pipeline_a')::uuid,'21000000-0000-0000-0000-000000000003');
delete from public.pipeline_stages where id='21000000-0000-0000-0000-000000000003';
select test_support.assert((select not is_active and stage_id is null and pipeline_id=current_setting('test.pipeline_a')::uuid from public.automations where id='22000000-0000-0000-0000-000000000005'),'removing the filtered stage clears it and pauses the automation');
select test_support.assert(exists(select 1 from public.audit_logs where entity_id='22000000-0000-0000-0000-000000000005' and action='update' and 'is_active'=any(changed_fields) and user_id=auth.uid()),'the automatic pause is audited under the person who removed the stage');
delete from public.pipelines where id='21000000-0000-0000-0000-000000000001';
select test_support.assert((select not is_active and pipeline_id is null and stage_id is null from public.automations where id='22000000-0000-0000-0000-000000000003'),'removing the filtered pipeline clears pipeline and stage and pauses the automation');
reset role;
