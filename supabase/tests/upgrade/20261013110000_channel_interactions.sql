-- Dados no formato anterior à migração de mesmo nome, gravados pelo `npm run test:db` logo antes dela, como numa
-- instância já em uso, na organização legada de 20261011100000_deal_closing_probability.sql: um contato com o telefone
-- em E.164 (gravado pela importação desde o item 0.5), outro com o telefone digitado à mão, uma empresa com telefone e
-- atividades de todos os tipos antigos (ligação concluída e pendente, nota, reunião, e-mail e tarefa), com as versões
-- (updated_at) fixas.
-- channels.sql confere que nada disso muda com a migração: os mesmos valores e versões, outcome nulo, do_not_contact
-- falso e nenhuma linha nova na auditoria.
-- Sem gatilhos (session_replication_role=replica), como nos arquivos dos itens 0.6 a 1.2.
set session_replication_role=replica;
insert into public.companies(id,org_id,name,phone,owner_id,created_at,updated_at) values
 ('96000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001','Empresa Legada dos Canais','(11) 3000-0000','00000000-0000-0000-0000-000000000099','2026-09-01 10:00:00+00','2026-09-21 10:00:00+00');
insert into public.contacts(id,org_id,first_name,last_name,email,phone,company_id,owner_id,created_at,updated_at) values
 ('96000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000001','Contato','Importado','importado@example.test','+5511999990000','96000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000099','2026-09-01 10:00:00+00','2026-09-21 10:00:00+00'),
 ('96000000-0000-0000-0000-000000000003','90000000-0000-0000-0000-000000000001','Contato','Digitado',null,'(11) 3000-0000',null,'00000000-0000-0000-0000-000000000099','2026-09-01 10:00:00+00','2026-09-21 10:00:00+00');
insert into public.activities(id,org_id,type,title,body,contact_id,company_id,user_id,due_date,end_date,completed_at,created_at,updated_at) values
 ('96000000-0000-0000-0000-000000000011','90000000-0000-0000-0000-000000000001','call','Ligação legada concluída','Conversou com o contato.','96000000-0000-0000-0000-000000000002','96000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000099','2026-09-20 14:00:00+00','2026-09-20 14:30:00+00','2026-09-20 14:20:00+00','2026-09-19 10:00:00+00','2026-09-20 14:20:00+00'),
 ('96000000-0000-0000-0000-000000000012','90000000-0000-0000-0000-000000000001','call','Ligação legada pendente',null,'96000000-0000-0000-0000-000000000002',null,'00000000-0000-0000-0000-000000000099','2026-10-20 14:00:00+00','2026-10-20 14:30:00+00',null,'2026-09-19 10:00:00+00','2026-09-21 10:00:00+00'),
 ('96000000-0000-0000-0000-000000000013','90000000-0000-0000-0000-000000000001','note','Nota legada','Contexto da conversa.','96000000-0000-0000-0000-000000000002',null,'00000000-0000-0000-0000-000000000099',null,null,'2026-09-19 10:00:00+00','2026-09-19 10:00:00+00','2026-09-19 10:00:00+00'),
 ('96000000-0000-0000-0000-000000000014','90000000-0000-0000-0000-000000000001','meeting','Reunião legada',null,'96000000-0000-0000-0000-000000000003',null,'00000000-0000-0000-0000-000000000099','2026-10-21 14:00:00+00','2026-10-21 15:00:00+00',null,'2026-09-19 10:00:00+00','2026-09-21 10:00:00+00'),
 ('96000000-0000-0000-0000-000000000015','90000000-0000-0000-0000-000000000001','email','E-mail legado',null,'96000000-0000-0000-0000-000000000002',null,'00000000-0000-0000-0000-000000000099','2026-10-22 09:00:00+00',null,null,'2026-09-19 10:00:00+00','2026-09-21 10:00:00+00'),
 ('96000000-0000-0000-0000-000000000016','90000000-0000-0000-0000-000000000001','task','Tarefa legada',null,null,'96000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000099','2026-10-23 09:00:00+00',null,null,'2026-09-19 10:00:00+00','2026-09-21 10:00:00+00');
set session_replication_role=default;
