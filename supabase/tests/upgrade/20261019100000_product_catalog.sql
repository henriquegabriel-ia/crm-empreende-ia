-- Dados no formato anterior à migração de mesmo nome, gravados pelo `npm run test:db` logo antes dela, como numa
-- instância já em uso, na organização legada de 20261011100000_deal_closing_probability.sql: três oportunidades com
-- valor manual (uma em aberto, uma ganha e uma perdida), todas com as versões (updated_at) fixas no passado.
-- catalog.sql confere que nada disso muda com a migração: o mesmo valor, item_count = 0, as partes vazias, as mesmas
-- versões e nenhuma linha nova na auditoria; e que a oportunidade legada recebe itens depois dela.
-- Sem gatilhos (session_replication_role=replica), como nos arquivos dos itens 0.6 a 1.10.
set session_replication_role=replica;
insert into public.deals(id,org_id,pipeline_id,stage_id,title,value,owner_id,probability,status,lost_reason,closed_at,stage_entered_at,created_at,updated_at) values
 ('98000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000004','Catálogo legado em aberto',2500.50,'00000000-0000-0000-0000-000000000099',null,'open',null,null,'2026-09-05 10:00:00+00','2026-09-05 10:00:00+00','2026-09-23 10:00:00+00'),
 ('98000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000004','Catálogo legado ganho',7300,'00000000-0000-0000-0000-000000000099',100,'won',null,'2026-09-20 15:00:00+00','2026-09-06 10:00:00+00','2026-09-06 10:00:00+00','2026-09-20 15:00:00+00'),
 ('98000000-0000-0000-0000-000000000003','90000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000003','Catálogo legado perdido',1200,'00000000-0000-0000-0000-000000000099',0,'lost','Sem orçamento','2026-09-21 15:00:00+00','2026-09-07 10:00:00+00','2026-09-07 10:00:00+00','2026-09-21 15:00:00+00');
set session_replication_role=default;
