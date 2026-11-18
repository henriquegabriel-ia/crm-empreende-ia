-- Fixture and helpers of the Fecha IA receiver tests (roadmap 3.4; supabase/functions/README.md). Included by
-- fecha-ai-receiver.sql, in a transaction that ends in rollback, and by fechaAiReceiverChecks in
-- scripts/test-database.mjs, committed for the checks with more than one session. Pure SQL, no psql meta-commands.
-- Runs on an empty instance (the runner truncates auth.users and public.organizations first): the accounts come before
-- the organizations, because with a company in the instance the signup gate of item 1.1 (enforce_invite_only_signup)
-- refuses an account without a pending invitation. The organizations, the accounts and the records have fixed ids: the
-- conformance vector of the contract (fecha_test.base) points at them.
create schema fecha_test;
grant usage on schema fecha_test to authenticated,service_role;
create function fecha_test.assert(ok boolean,message text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'FAIL: %',message; end if; raise notice 'PASS: %',message; end $$;
create function fecha_test.denied(statement text,expected text) returns void language plpgsql security invoker as $$
begin begin execute statement; exception when others then if expected='permission' and sqlstate='42501' or sqlerrm=expected then raise notice 'PASS: rejected %',expected; return; end if; raise exception 'FAIL: expected %, got % (%)',expected,sqlerrm,sqlstate; end; raise exception 'FAIL: expected rejection %',expected; end $$;
grant execute on all functions in schema fecha_test to authenticated,service_role;
insert into auth.users(id,email) values
('20000000-0000-4000-8000-000000000002','owner@example.test'),('20000000-0000-4000-8000-000000000003','member@example.test'),
('20000000-0000-4000-8000-000000000004','viewer@example.test'),('20000000-0000-4000-8000-000000000005','foreign@example.test'),
('20000000-0000-4000-8000-000000000006','bia@example.test'),('20000000-0000-4000-8000-000000000007','blank@example.test'),
('20000000-0000-4000-8000-000000000008','saiu@example.test');
-- F0 (item 1.1): the accounts come before the organizations; with a company in the instance, the signup gate
-- (enforce_invite_only_signup) refuses an account without a pending invitation.
insert into public.organizations(id,name) values('10000000-0000-4000-8000-000000000002','CRM teste'),('10000000-0000-4000-8000-000000000003','Outra equipe');
update public.profiles set org_id='10000000-0000-4000-8000-000000000002',name=case when id='20000000-0000-4000-8000-000000000002' then 'Gestora' else 'Pessoa comercial' end where id<>'20000000-0000-4000-8000-000000000005';
update public.profiles set org_id='10000000-0000-4000-8000-000000000003',name='Outra gestora' where id='20000000-0000-4000-8000-000000000005';
-- Labels of the contract (corrections of the F0 port): JavaScript trim() also removes TAB, NBSP, U+FEFF, U+2028 and
-- U+3000, and the label falls back to the e-mail and then to the id. chr() keeps those characters visible in this file.
update public.profiles set name=chr(65279)||'Bia'||chr(12288) where id='20000000-0000-4000-8000-000000000006';
update public.profiles set name=chr(160),email=chr(9) where id='20000000-0000-4000-8000-000000000007';
update public.profiles set name='Integrante que vai sair' where id='20000000-0000-4000-8000-000000000008';
insert into public.user_roles(user_id,org_id,role) values
('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','owner'),
('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','member'),
('20000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000002','viewer'),
('20000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000003','owner'),
('20000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000002','member'),
('20000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000002','member'),
('20000000-0000-4000-8000-000000000008','10000000-0000-4000-8000-000000000002','member');
insert into public.companies(id,org_id,name) values('41000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','Empresa de teste');
insert into public.contacts(id,org_id,first_name) values('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','João'),('40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','João outra equipe');
insert into public.companies(id,org_id,name) values('41000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002',chr(160)||'Empresa NBSP'||chr(9));
insert into public.contacts(id,org_id,first_name,last_name,email) values
('40000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002',chr(9)||'Ana',chr(160)||chr(65279),null),
('40000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000002',chr(160)||chr(8232),null,null),
('40000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000002',repeat(chr(128512),210),null,null),
('40000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000002',repeat('a',399),'bbbb',null),
('40000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000002','Carla','Souza','carla@example.test');
insert into public.pipelines(id,org_id,name,is_default) values('45000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','Comercial',true);
insert into public.pipeline_stages(id,org_id,pipeline_id,name,"order") values('46000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','45000000-0000-4000-8000-000000000001','Novo contato',0);
insert into public.deals(id,org_id,pipeline_id,stage_id,title,contact_id) values
('42000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','45000000-0000-4000-8000-000000000001','46000000-0000-4000-8000-000000000001','Oportunidade de teste','40000000-0000-4000-8000-000000000001'),
('42000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','45000000-0000-4000-8000-000000000001','46000000-0000-4000-8000-000000000001','Renovação'||chr(8232),null),
('42000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','45000000-0000-4000-8000-000000000001','46000000-0000-4000-8000-000000000001','Proposta da Carla','40000000-0000-4000-8000-000000000007');

-- Same portable conformance vector as the Deno tests (CRM_FIXTURE_CONTENT, with the objections of item B17 of the Fecha
-- IA); PostgreSQL must produce the identical hash, and the vector without the objections keeps the hash of before them.
create function fecha_test.base() returns jsonb language sql immutable as $$ select '{"schemaVersion":1,"source":"fecha-ai","destination":"crm-empreende-ia","connectionId":"01000000-0000-4000-8000-000000000001","sourceOrganizationId":"10000000-0000-4000-8000-000000000001","destinationOrganizationId":"10000000-0000-4000-8000-000000000002","callId":"30000000-0000-4000-8000-000000000001","reviewRevision":7,"sourceOwnerId":"20000000-0000-4000-8000-000000000001","reviewedBySourceUserId":"20000000-0000-4000-8000-000000000001","destinationActorId":"20000000-0000-4000-8000-000000000002","reviewedAt":"2026-09-06T15:00:00.000Z","operation":"create_note","previousReceipt":null,"target":{"contactId":"40000000-0000-4000-8000-000000000001","companyId":null,"dealId":null},"reviewNote":{"summary":"João decidiu avançar. Pagamento ainda pendente.","method":{"id":"empreende-ia-commercial","version":"1.0.0"},"offer":null,"commercialResult":"won","paymentStatus":"pending","evidenceReferences":[{"segmentId":"50000000-0000-4000-8000-000000000001:turn:3","revision":1}],"objections":{"reviewText":"Achou o investimento alto; a condição aprovada resolveu. Falta a conversa com o sócio.","items":[{"type":"price","status":"resolved"},{"type":"partner","status":"next_meeting"}]}},"nextStep":{"description":"Conferir os dados de contratação","assigneeId":"20000000-0000-4000-8000-000000000003","dueAt":"2026-09-07T18:00:00-03:00"}}'::jsonb $$;
create function fecha_test.seal(e jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ declare v jsonb; begin
v=(e-'payloadHash')||jsonb_build_object('idempotencyKey','fecha-ai:v1:'||(e->>'connectionId')||':'||(e->>'sourceOrganizationId')||':'||(e->>'callId')||':review:'||(e->>'reviewRevision'));
return v||jsonb_build_object('payloadHash',encode(sha256(convert_to(private.fecha_canonical_json(v),'UTF8')),'hex')); end $$;
grant execute on function fecha_test.base(),fecha_test.seal(jsonb) to service_role;
