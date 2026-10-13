-- Dados no formato anterior à migração de mesmo nome, gravados pelo `npm run test:db` logo antes dela, como numa
-- instância já em uso, na organização legada de 20261011100000_deal_closing_probability.sql: um convite pendente cuja
-- conta foi criada antes por outra pessoa, com uma senha própria, e ainda não confirmada (o pré-cadastro que o reforço
-- neutraliza), e uma conta antiga já confirmada, com senha e sem organização, com um convite pendente.
-- admission-proof.sql confere que a migração não mexe em nenhuma senha, que a confirmação do pré-cadastro descarta a
-- senha e grava a prova, e que a conta antiga, sem prova, só aceita numa sessão aberta pelo link enviado ao e-mail.
-- Sem gatilhos (session_replication_role=replica), como nos arquivos dos itens 0.6 a 1.1: nem o portão de cadastro nem
-- handle_new_user rodam, por isso os perfis vêm aqui, e a organização legada não ganha auditoria.
set session_replication_role=replica;
insert into public.invitations(id,org_id,email,role,invited_by,accepted_at,expires_at,created_at) values
 ('94000000-0000-0000-0000-000000000004','90000000-0000-0000-0000-000000000001','pre-cadastro@example.test','member','00000000-0000-0000-0000-000000000099',null,now()+interval '5 days',now()-interval '2 days'),
 ('94000000-0000-0000-0000-000000000005','90000000-0000-0000-0000-000000000001','antiga@example.test','viewer','00000000-0000-0000-0000-000000000099',null,now()+interval '4 days',now()-interval '3 days');
insert into auth.users(id,email,email_confirmed_at,encrypted_password) values
 ('00000000-0000-0000-0000-000000000096','pre-cadastro@example.test',null,'$2a$10$senha.escolhida.pelo.intruso'),
 ('00000000-0000-0000-0000-000000000097','antiga@example.test',now()-interval '6 days','$2a$10$senha.da.conta.antiga');
insert into public.profiles(id,org_id,name,email) values
 ('00000000-0000-0000-0000-000000000096',null,'Nome escolhido pelo intruso','pre-cadastro@example.test'),
 ('00000000-0000-0000-0000-000000000097',null,'Conta Antiga','antiga@example.test');
set session_replication_role=default;
