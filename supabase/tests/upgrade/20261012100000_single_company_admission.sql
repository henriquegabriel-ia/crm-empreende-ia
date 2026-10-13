-- Dados no formato anterior à migração de mesmo nome, gravados pelo `npm run test:db` logo antes dela,
-- como numa instância já em uso: convites criados por INSERT direto (a API aceitava e-mail com maiúsculas e espaços)
-- e uma conta sem organização. instance-admission.sql confere que o dono legado continua dono, que o convite válido
-- continua abrindo o cadastro e o aceite, que o expirado pode ser renovado e que a conta órfã não cria empresa.
-- Sem gatilhos (session_replication_role=replica), como nos arquivos dos itens 0.6 a 0.8, para não gerar auditoria
-- na organização legada, que deal-lifecycle.sql confere. Usa a organização legada de
-- 20261011100000_deal_closing_probability.sql.
set session_replication_role=replica;
insert into public.invitations(id,org_id,email,role,invited_by,accepted_at,expires_at,created_at) values
 ('94000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001',' Pendente@Example.test','member','00000000-0000-0000-0000-000000000099',null,now()+interval '3 days',now()-interval '4 days'),
 ('94000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000001','expirado@example.test','viewer','00000000-0000-0000-0000-000000000099',null,now()-interval '2 days',now()-interval '9 days'),
 ('94000000-0000-0000-0000-000000000003','90000000-0000-0000-0000-000000000001','aceito@example.test','member','00000000-0000-0000-0000-000000000099',now()-interval '20 days',now()-interval '15 days',now()-interval '22 days');
-- Conta que entrou antes do item 1.1 e nunca criou empresa nem aceitou convite.
insert into auth.users(id,email,email_confirmed_at) values('00000000-0000-0000-0000-000000000098','orfa@example.test',now()-interval '5 days');
insert into public.profiles(id,org_id,name,email) values('00000000-0000-0000-0000-000000000098',null,'Conta Órfã','orfa@example.test');
set session_replication_role=default;
