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
('20000000-0000-4000-8000-000000000004','viewer@example.test'),('20000000-0000-4000-8000-000000000005','foreign@example.test');
-- F0 (item 1.1): the accounts come before the organizations; with a company in the instance, the signup gate
-- (enforce_invite_only_signup) refuses an account without a pending invitation.
insert into public.organizations(id,name) values('10000000-0000-4000-8000-000000000002','CRM teste'),('10000000-0000-4000-8000-000000000003','Outra equipe');
update public.profiles set org_id='10000000-0000-4000-8000-000000000002',name=case when id='20000000-0000-4000-8000-000000000002' then 'Gestora' else 'Pessoa comercial' end where id<>'20000000-0000-4000-8000-000000000005';
update public.profiles set org_id='10000000-0000-4000-8000-000000000003',name='Outra gestora' where id='20000000-0000-4000-8000-000000000005';
insert into public.user_roles(user_id,org_id,role) values
('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','owner'),
('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','member'),
('20000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000002','viewer'),
('20000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000003','owner');
insert into public.companies(id,org_id,name) values('41000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','Empresa de teste');
insert into public.contacts(id,org_id,first_name) values('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','João'),('40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','João outra equipe');

-- Same portable conformance vector as the Deno tests; PostgreSQL must produce the identical hash.
create function fecha_test.base() returns jsonb language sql immutable as $$ select '{"schemaVersion":1,"source":"fecha-ai","destination":"crm-empreende-ia","connectionId":"01000000-0000-4000-8000-000000000001","sourceOrganizationId":"10000000-0000-4000-8000-000000000001","destinationOrganizationId":"10000000-0000-4000-8000-000000000002","callId":"30000000-0000-4000-8000-000000000001","reviewRevision":7,"sourceOwnerId":"20000000-0000-4000-8000-000000000001","reviewedBySourceUserId":"20000000-0000-4000-8000-000000000001","destinationActorId":"20000000-0000-4000-8000-000000000002","reviewedAt":"2026-09-06T15:00:00.000Z","operation":"create_note","previousReceipt":null,"target":{"contactId":"40000000-0000-4000-8000-000000000001","companyId":null,"dealId":null},"reviewNote":{"summary":"João decidiu avançar. Pagamento ainda pendente.","method":{"id":"empreende-ia-commercial","version":"1.0.0"},"offer":null,"commercialResult":"won","paymentStatus":"pending","evidenceReferences":[{"segmentId":"50000000-0000-4000-8000-000000000001:turn:3","revision":1}]},"nextStep":{"description":"Conferir os dados de contratação","assigneeId":"20000000-0000-4000-8000-000000000003","dueAt":"2026-09-07T18:00:00-03:00"}}'::jsonb $$;
create function fecha_test.seal(e jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ declare v jsonb; begin
v=(e-'payloadHash')||jsonb_build_object('idempotencyKey','fecha-ai:v1:'||(e->>'connectionId')||':'||(e->>'sourceOrganizationId')||':'||(e->>'callId')||':review:'||(e->>'reviewRevision'));
return v||jsonb_build_object('payloadHash',encode(sha256(convert_to(private.fecha_canonical_json(v),'UTF8')),'hex')); end $$;
grant execute on function fecha_test.base(),fecha_test.seal(jsonb) to service_role;
