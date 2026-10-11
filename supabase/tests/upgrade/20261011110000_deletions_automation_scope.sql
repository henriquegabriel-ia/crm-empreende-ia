-- Dados no formato anterior à migração de mesmo nome, gravados pelo `npm run test:db` logo antes dela,
-- como numa instância já em uso. automations-deletion.sql confere o backfill de automation_name e as exclusões
-- que antes falhavam por causa destes logs.
-- Sem gatilhos (session_replication_role=replica), como no arquivo do item 0.6, para não gerar auditoria na
-- organização legada, que deal-lifecycle.sql confere.
-- Usa a organização legada gravada por 20261011100000_deal_closing_probability.sql.
set session_replication_role=replica;
insert into public.automations(id,org_id,name,trigger_type,is_active,task_title,due_days,created_by,created_at,updated_at) values
 ('92000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001','Retomar contato legado','deal_moved',true,'Retomar contato',1,'00000000-0000-0000-0000-000000000099','2026-09-01 10:00:00+00','2026-09-01 10:00:00+00');
insert into public.activities(id,org_id,type,title,deal_id,user_id,due_date,created_by,created_at,updated_at) values
 ('92000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000001','task','Retomar contato','91000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000099','2026-09-11 10:00:00+00','00000000-0000-0000-0000-000000000099','2026-09-10 10:00:00+00','2026-09-10 10:00:00+00');
-- Uma execução com sucesso, com a tarefa criada, e uma falha, no formato antigo (sem nome nem detalhe técnico).
insert into public.automation_logs(id,org_id,automation_id,deal_id,activity_id,status,error_message,created_at) values
 ('92000000-0000-0000-0000-000000000003','90000000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000005','92000000-0000-0000-0000-000000000002','success',null,'2026-09-10 10:00:00+00'),
 ('92000000-0000-0000-0000-000000000004','90000000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000006',null,'failed','Não foi possível criar a tarefa. Revise os vínculos e o responsável.','2026-09-11 10:00:00+00');
set session_replication_role=default;
