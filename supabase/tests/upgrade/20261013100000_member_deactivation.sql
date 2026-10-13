-- Dados no formato anterior à migração de mesmo nome, gravados pelo `npm run test:db` logo antes dela, como numa
-- instância já em uso, na organização legada de 20261011100000_deal_closing_probability.sql: um perfil com organização
-- e sem papel (órfão, só possível por SQL), dono de uma oportunidade em aberto e de um contato e autor de um convite já
-- aceito; um colaborador que, quando era administrador, criou um convite ainda pendente; um administrador com um
-- convite pendente de colaborador e outro de dono (que um administrador não poderia criar); e um convite de dono
-- pendente e sem autor, como o que restore_owner cria pelo editor SQL no break-glass.
-- member-deactivation.sql confere que o órfão vira membro desativado (Somente leitura) e perde a leitura, que a carteira
-- dele não muda, que saem só os convites pendentes de quem hoje não poderia criá-los (o sem autor fica) e que o dono
-- legado continua dono.
-- Sem gatilhos (session_replication_role=replica), como nos arquivos dos itens 0.6 a 1.1: o portão de cadastro e
-- handle_new_user não rodam (por isso os perfis vêm aqui), nem a auditoria.
set session_replication_role=replica;
insert into auth.users(id,email,email_confirmed_at) values
 ('00000000-0000-0000-0000-000000000093','admin-legado@example.test',now()-interval '30 days'),
 ('00000000-0000-0000-0000-000000000094','ex-admin@example.test',now()-interval '30 days'),
 ('00000000-0000-0000-0000-000000000095','orfao-membro@example.test',now()-interval '30 days');
insert into public.profiles(id,org_id,name,email) values
 ('00000000-0000-0000-0000-000000000093','90000000-0000-0000-0000-000000000001','Administração Legada','admin-legado@example.test'),
 ('00000000-0000-0000-0000-000000000094','90000000-0000-0000-0000-000000000001','Ex-administração','ex-admin@example.test'),
 ('00000000-0000-0000-0000-000000000095','90000000-0000-0000-0000-000000000001','Membro Órfão','orfao-membro@example.test');
-- O órfão (95) não tem papel.
insert into public.user_roles(user_id,org_id,role) values
 ('00000000-0000-0000-0000-000000000093','90000000-0000-0000-0000-000000000001','admin'),
 ('00000000-0000-0000-0000-000000000094','90000000-0000-0000-0000-000000000001','member');
insert into public.contacts(id,org_id,first_name,owner_id,created_at,updated_at) values
 ('95000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001','Contato do órfão','00000000-0000-0000-0000-000000000095','2026-09-20 10:00:00+00','2026-09-20 10:00:00+00');
insert into public.deals(id,org_id,pipeline_id,stage_id,title,value,owner_id,status,stage_entered_at,created_at,updated_at) values
 ('95000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000003','Oportunidade do órfão',900,'00000000-0000-0000-0000-000000000095','open','2026-09-20 10:00:00+00','2026-09-20 10:00:00+00','2026-09-20 10:00:00+00');
insert into public.invitations(id,org_id,email,role,invited_by,accepted_at,expires_at,created_at) values
 ('94000000-0000-0000-0000-000000000006','90000000-0000-0000-0000-000000000001','convite-do-ex-admin@example.test','member','00000000-0000-0000-0000-000000000094',null,now()+interval '5 days',now()-interval '2 days'),
 ('94000000-0000-0000-0000-000000000007','90000000-0000-0000-0000-000000000001','colaboracao-legada@example.test','member','00000000-0000-0000-0000-000000000093',null,now()+interval '5 days',now()-interval '2 days'),
 ('94000000-0000-0000-0000-000000000008','90000000-0000-0000-0000-000000000001','dono-pelo-admin@example.test','owner','00000000-0000-0000-0000-000000000093',null,now()+interval '5 days',now()-interval '2 days'),
 ('94000000-0000-0000-0000-000000000009','90000000-0000-0000-0000-000000000001','aceito-do-orfao@example.test','viewer','00000000-0000-0000-0000-000000000095',now()-interval '10 days',now()-interval '5 days',now()-interval '12 days'),
 ('94000000-0000-0000-0000-000000000010','90000000-0000-0000-0000-000000000001','dono-pelo-editor-sql@example.test','owner',null,null,now()+interval '5 days',now()-interval '1 day');
set session_replication_role=default;
