-- Dados no formato anterior à migração de mesmo nome, gravados pelo `npm run test:db` logo antes dela, como numa
-- instância já em uso, na organização legada de 20261011100000_deal_closing_probability.sql: um contato com sobrenome,
-- e-mail, telefone, cargo, origem, observações e a empresa legada dos canais, com uma ligação concluída, uma ligação
-- pendente e uma nota, uma oportunidade com o nome dele no título e um recebimento dela, e outro contato cujas
-- observações citam o nome completo e o e-mail do primeiro, todos com as versões (updated_at) fixas.
-- privacy.sql confere que nada disso muda com a migração (base "não informada", sem carimbo, as mesmas versões e
-- nenhuma linha nova na auditoria) e que o contato legado pode ser anonimizado depois dela.
-- Sem gatilhos (session_replication_role=replica), como nos arquivos dos itens 0.6 a 1.9.
set session_replication_role=replica;
insert into public.contacts(id,org_id,first_name,last_name,email,phone,company_id,owner_id,job_title,source,notes,status,created_at,updated_at) values
 ('97000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001','Helena','Legada Prado','helena.legada@example.test','+5511977770000','96000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000099','Diretora de compras','Indicação da Helena no evento','Helena prefere ligação depois das 14h.','customer','2026-09-01 10:00:00+00','2026-09-22 10:00:00+00'),
 ('97000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000001','Ivo','Vizinho',null,null,null,'00000000-0000-0000-0000-000000000099',null,null,'Indicado por Helena Legada Prado (helena.legada@example.test).','lead','2026-09-01 10:00:00+00','2026-09-22 10:00:00+00');
insert into public.deals(id,org_id,pipeline_id,stage_id,title,value,contact_id,owner_id,status,stage_entered_at,created_at,updated_at) values
 ('97000000-0000-0000-0000-000000000021','90000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000003','Proposta Helena Legada Prado',4200,'97000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000099','open','2026-09-02 10:00:00+00','2026-09-02 10:00:00+00','2026-09-22 10:00:00+00');
insert into public.activities(id,org_id,type,title,body,contact_id,deal_id,user_id,due_date,completed_at,outcome,created_at,updated_at) values
 ('97000000-0000-0000-0000-000000000011','90000000-0000-0000-0000-000000000001','call','Ligação com a Helena','Helena pediu a proposta por e-mail.','97000000-0000-0000-0000-000000000001','97000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000099','2026-09-20 14:00:00+00','2026-09-20 14:20:00+00','answered','2026-09-19 10:00:00+00','2026-09-20 14:20:00+00'),
 ('97000000-0000-0000-0000-000000000012','90000000-0000-0000-0000-000000000001','call','Retornar para a Helena',null,'97000000-0000-0000-0000-000000000001','97000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000099','2026-10-25 14:00:00+00',null,null,'2026-09-19 10:00:00+00','2026-09-22 10:00:00+00'),
 ('97000000-0000-0000-0000-000000000013','90000000-0000-0000-0000-000000000001','note','Nota sobre a Helena','Telefone (11) 97777-0000.','97000000-0000-0000-0000-000000000001',null,'00000000-0000-0000-0000-000000000099',null,null,null,'2026-09-19 10:00:00+00','2026-09-19 10:00:00+00');
insert into public.payments(id,org_id,description,amount,status,contact_id,deal_id,due_date,created_at,updated_at) values
 ('97000000-0000-0000-0000-000000000031','90000000-0000-0000-0000-000000000001','Entrada da Helena Legada Prado',1200,'pending','97000000-0000-0000-0000-000000000001','97000000-0000-0000-0000-000000000021','2026-11-01','2026-09-02 10:00:00+00','2026-09-22 10:00:00+00');
set session_replication_role=default;
