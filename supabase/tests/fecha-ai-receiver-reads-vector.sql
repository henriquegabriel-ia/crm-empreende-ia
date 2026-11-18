-- The records of the conformance vector of the reads (item B20 of the Fecha IA): CRM_FIXTURE_CONTEXT_REQUEST and
-- CRM_FIXTURE_OUTCOMES_REQUEST of supabase/functions/_shared/crm-contract-fixtures.ts, the same file as in the Fecha
-- IA, ask about these records, and fechaAiReceiverChecks (scripts/test-database.mjs) compares the real answers with
-- CRM_FIXTURE_CONTEXT_RESPONSE and CRM_FIXTURE_OUTCOMES_RESPONSE. Run in a transaction that ends in rollback, after
-- fecha-ai-receiver-support.sql was committed, with test.vector_connection set to a connection with both reads. The
-- base stamps created_at, stage_entered_at and closed_at by itself: its triggers are off only here, to fix the dates.
alter table public.activities disable trigger protect_record_metadata;
alter table public.deals disable trigger user;
insert into public.companies(id,org_id,name) values('41000000-0000-4000-8000-000000000020','10000000-0000-4000-8000-000000000002','Oficina Norte');
insert into public.contacts(id,org_id,first_name,last_name,email,phone,status,company_id,notes) values
('40000000-0000-4000-8000-000000000020','10000000-0000-4000-8000-000000000002','Marina','Costa','marina@example.test','+55 11 98765-4321','prospect','41000000-0000-4000-8000-000000000020','Prefere WhatsApp à tarde');
insert into public.pipelines(id,org_id,name,is_default) values('45000000-0000-4000-8000-000000000020','10000000-0000-4000-8000-000000000002','Implantação',false);
insert into public.pipeline_stages(id,org_id,pipeline_id,name,"order") values
('46000000-0000-4000-8000-000000000021','10000000-0000-4000-8000-000000000002','45000000-0000-4000-8000-000000000020','Novo contato',0),
('46000000-0000-4000-8000-000000000022','10000000-0000-4000-8000-000000000002','45000000-0000-4000-8000-000000000020','Diagnóstico',10),
('46000000-0000-4000-8000-000000000023','10000000-0000-4000-8000-000000000002','45000000-0000-4000-8000-000000000020','Proposta',20),
('46000000-0000-4000-8000-000000000024','10000000-0000-4000-8000-000000000002','45000000-0000-4000-8000-000000000020','Fechamento',30);
insert into public.deals(id,org_id,pipeline_id,stage_id,title,value,contact_id,company_id,owner_id,status,lost_reason,stage_entered_at,closed_at,created_at) values
('42000000-0000-4000-8000-000000000020','10000000-0000-4000-8000-000000000002','45000000-0000-4000-8000-000000000020','46000000-0000-4000-8000-000000000023','Implantação · Oficina Norte',18000,'40000000-0000-4000-8000-000000000020','41000000-0000-4000-8000-000000000020','20000000-0000-4000-8000-000000000002','open',null,'2026-09-01 12:00:00+00',null,'2026-08-15 12:00:00+00'),
('42000000-0000-4000-8000-000000000021','10000000-0000-4000-8000-000000000002','45000000-0000-4000-8000-000000000020','46000000-0000-4000-8000-000000000024','Renovação · Oficina Norte',9000,'40000000-0000-4000-8000-000000000020','41000000-0000-4000-8000-000000000020','20000000-0000-4000-8000-000000000002','won',null,'2026-09-08 12:00:00+00','2026-09-08 12:00:00+00','2026-08-15 12:00:00+00'),
('42000000-0000-4000-8000-000000000022','10000000-0000-4000-8000-000000000002','45000000-0000-4000-8000-000000000020','46000000-0000-4000-8000-000000000022','Treinamento extra',4000,'40000000-0000-4000-8000-000000000020','41000000-0000-4000-8000-000000000020','20000000-0000-4000-8000-000000000002','lost','Escolheu outra opção','2026-09-03 12:00:00+00','2026-09-07 12:00:00+00','2026-08-15 12:00:00+00');
-- The commitments by due date (one on the contact, one on the deal, one on the company), the history the latest first
-- and the note of a delivered review, which only appears as its receipt.
insert into public.activities(id,org_id,type,title,body,contact_id,company_id,deal_id,user_id,due_date,completed_at,created_at) values
('43000000-0000-4000-8000-000000000021','10000000-0000-4000-8000-000000000002','task','Ligar para (11) 98765-4321 depois das 14h',null,'40000000-0000-4000-8000-000000000020',null,null,'20000000-0000-4000-8000-000000000002','2026-09-10 12:00:00+00',null,'2026-09-04 10:00:00+00'),
('43000000-0000-4000-8000-000000000022','10000000-0000-4000-8000-000000000002','meeting','Reunião de fechamento',null,null,null,'42000000-0000-4000-8000-000000000020','20000000-0000-4000-8000-000000000003','2026-09-12 15:00:00+00',null,'2026-09-04 10:05:00+00'),
('43000000-0000-4000-8000-000000000023','10000000-0000-4000-8000-000000000002','task','Confirmar a conversa com o sócio',null,null,'41000000-0000-4000-8000-000000000020',null,null,null,null,'2026-09-04 10:10:00+00'),
('43000000-0000-4000-8000-000000000024','10000000-0000-4000-8000-000000000002','note','Diagnóstico com a Marina','Contou que o time perde 2 h por dia com planilhas. E-mail: marina@example.test, celular +55 11 98765-4321.','40000000-0000-4000-8000-000000000020',null,'42000000-0000-4000-8000-000000000020','20000000-0000-4000-8000-000000000002',null,null,'2026-09-04 16:00:00+00'),
('43000000-0000-4000-8000-000000000025','10000000-0000-4000-8000-000000000002','call','Primeiro contato',null,'40000000-0000-4000-8000-000000000020',null,null,'20000000-0000-4000-8000-000000000002','2026-09-02 13:30:00+00','2026-09-02 14:00:00+00','2026-09-01 09:00:00+00'),
('43000000-0000-4000-8000-000000000026','10000000-0000-4000-8000-000000000002','note','Histórico importado',repeat('x',600),null,'41000000-0000-4000-8000-000000000020',null,null,null,null,'2026-08-20 10:00:00+00'),
('43000000-0000-4000-8000-000000000027','10000000-0000-4000-8000-000000000002','note','Fecha IA · Revisão comercial','Conversa Fecha IA: 30000000-0000-4000-8000-000000000030','40000000-0000-4000-8000-000000000020',null,null,'20000000-0000-4000-8000-000000000002',null,null,'2026-09-05 18:00:00+00');
insert into public.payments(org_id,description,amount,status,deal_id,due_date,paid_at) values
('10000000-0000-4000-8000-000000000002','Sinal',300,'paid','42000000-0000-4000-8000-000000000020','2026-09-06','2026-09-06 09:00:00+00'),
('10000000-0000-4000-8000-000000000002','Parcela 2',500,'paid','42000000-0000-4000-8000-000000000021','2026-09-15','2026-09-15 10:00:00+00'),
('10000000-0000-4000-8000-000000000002','Parcela 1',500,'paid','42000000-0000-4000-8000-000000000021','2026-09-09','2026-09-09 10:00:00+00'),
('10000000-0000-4000-8000-000000000002','Parcela 3',500,'pending','42000000-0000-4000-8000-000000000021','2026-10-15',null),
('10000000-0000-4000-8000-000000000002','Parcela cancelada',500,'cancelled','42000000-0000-4000-8000-000000000021','2026-09-20',null);
insert into private.fecha_ai_deliveries(id,connection_id,org_id,source_org_id,call_id,review_revision,idempotency_key,payload_hash,payload,receipt,note_id,task_id,destination_revision,created_at)
values('44000000-0000-4000-8000-000000000020',current_setting('test.vector_connection')::uuid,'10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001',
 '30000000-0000-4000-8000-000000000030',3,'fecha-ai:v1:'||current_setting('test.vector_connection')||':10000000-0000-4000-8000-000000000001:30000000-0000-4000-8000-000000000030:review:3',repeat('f',64),
 '{"target":{"contactId":"40000000-0000-4000-8000-000000000020","companyId":null,"dealId":"42000000-0000-4000-8000-000000000020"}}',
 '{"persistedAt":"2026-09-05T18:00:00.000Z"}','43000000-0000-4000-8000-000000000027',null,1,'2026-09-05 18:00:00+00');
alter table public.deals enable trigger user;
alter table public.activities enable trigger protect_record_metadata;
