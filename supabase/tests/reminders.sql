-- Included by commercial-security.sql, after privacy.sql and before instance-admission.sql (whose section 9 empties
-- the instance), inside a savepoint that is rolled back at the end: the accounts and records of this file do not reach
-- the checks that follow it.
-- Item 1.12: reminders in the menu (src/hooks/useActivityReminders.ts, design in docs/arquitetura/1.12.md). No schema
-- change: the page reads, through the table API, the person's own pending activities that are not notes and are due
-- before the end of the local day (five columns), and counts overdue and upcoming ones in the browser with the same
-- rule as "Hoje". These checks run that exact request as PostgREST would (role authenticated, the claims of the
-- account): it returns only the account's own activities in its organization, nothing for a deactivated account or
-- another organization, and it can use the partial index activities_owner_pending (org_id, user_id, due_date, pending
-- only) instead of reading the whole table.
-- now() is fixed for the whole transaction, so the boundary below (the end of the current day) is stable.
-- Accounts (organization A): 1 owner A, f1 collaborator, f2 collaborator deactivated; 2 owner B.
reset role;
select test_support.sign_out();
savepoint activity_reminders;
alter table auth.users disable trigger enforce_invite_only_signup;
insert into auth.users(id,email,email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000000f1','colaboracao-lembretes@example.test',now()),
 ('00000000-0000-0000-0000-0000000000f2','desativada-lembretes@example.test',now());
alter table auth.users enable trigger enforce_invite_only_signup;
update public.profiles p set org_id=current_setting('test.org_a')::uuid,name=v.name from (values
 ('00000000-0000-0000-0000-0000000000f1'::uuid,'Colaboração dos Lembretes'),
 ('00000000-0000-0000-0000-0000000000f2'::uuid,'Desativada dos Lembretes')
) v(id,name) where p.id=v.id;
insert into public.user_roles(user_id,org_id,role,deactivated_at) values
 ('00000000-0000-0000-0000-0000000000f1',current_setting('test.org_a')::uuid,'member',null),
 ('00000000-0000-0000-0000-0000000000f2',current_setting('test.org_a')::uuid,'member',null);
select set_config('test.reminders_end',(date_trunc('day',now())+interval '1 day')::text,true);
-- The person's routine: two overdue (yesterday and two hours ago), one upcoming today (a WhatsApp, which counts like any
-- activity that is not a note, item 1.9), and what stays out: tomorrow, a note, a completed one and one without a date.
insert into public.activities(id,org_id,type,title,user_id,due_date,completed_at) values
 ('f1000000-0000-0000-0000-000000000001',current_setting('test.org_a')::uuid,'call','Lembrete: ligação de ontem','00000000-0000-0000-0000-000000000001',now()-interval '1 day',null),
 ('f1000000-0000-0000-0000-000000000002',current_setting('test.org_a')::uuid,'task','Lembrete: tarefa vencida','00000000-0000-0000-0000-000000000001',now()-interval '2 hours',null),
 ('f1000000-0000-0000-0000-000000000003',current_setting('test.org_a')::uuid,'whatsapp','Lembrete: WhatsApp de hoje','00000000-0000-0000-0000-000000000001',now()+(current_setting('test.reminders_end')::timestamptz-now())/2,null),
 ('f1000000-0000-0000-0000-000000000004',current_setting('test.org_a')::uuid,'task','Lembrete: tarefa de amanhã','00000000-0000-0000-0000-000000000001',current_setting('test.reminders_end')::timestamptz+interval '1 hour',null),
 ('f1000000-0000-0000-0000-000000000005',current_setting('test.org_a')::uuid,'note','Lembrete: nota','00000000-0000-0000-0000-000000000001',null,now()),
 ('f1000000-0000-0000-0000-000000000006',current_setting('test.org_a')::uuid,'task','Lembrete: tarefa concluída','00000000-0000-0000-0000-000000000001',now()-interval '3 hours',now()),
 ('f1000000-0000-0000-0000-000000000007',current_setting('test.org_a')::uuid,'task','Lembrete: tarefa sem prazo','00000000-0000-0000-0000-000000000001',null,null),
 ('f1000000-0000-0000-0000-000000000008',current_setting('test.org_a')::uuid,'task','Lembrete: tarefa da colega','00000000-0000-0000-0000-0000000000f1',now()-interval '2 hours',null),
 ('f1000000-0000-0000-0000-000000000009',current_setting('test.org_a')::uuid,'task','Lembrete: tarefa da desativada','00000000-0000-0000-0000-0000000000f2',now()-interval '2 hours',null);
update public.user_roles set deactivated_at=now() where user_id='00000000-0000-0000-0000-0000000000f2';
-- The request of the reminders, as PostgREST runs it for the signed-in account (the filters of useActivityReminders),
-- looking only at the rows of this file: the earlier files leave other activities in organization A.
create function test_support.reminder_titles(p_org uuid, p_user uuid) returns text language sql security invoker as $$
 select coalesce(string_agg(a.title,'; ' order by a.id),'') from public.activities a
  where a.org_id=p_org and a.user_id=p_user and a.completed_at is null and a.type<>'note'
   and a.due_date<current_setting('test.reminders_end')::timestamptz and a.id::text like 'f1000000-%'
$$;
create function test_support.plan_of(statement text) returns text language plpgsql security invoker as $$
declare v_line text; v_plan text:='';
begin
 for v_line in execute 'explain (costs off) '||statement loop v_plan:=v_plan||v_line||' '; end loop;
 return v_plan;
end $$;

-- 1. The account's own pending activities until the end of the day, nothing else.
select test_support.sign_in('00000000-0000-0000-0000-000000000001');
set local role authenticated;
select test_support.assert(test_support.reminder_titles(current_setting('test.org_a')::uuid,auth.uid())
  ='Lembrete: ligação de ontem; Lembrete: tarefa vencida; Lembrete: WhatsApp de hoje',
 'reminders: the request returns the overdue and today''s pending activities of the account, a WhatsApp included, without tomorrow, notes, completed or undated ones');
select test_support.assert((select count(*)=3 from public.activities a where a.org_id=current_setting('test.org_a')::uuid and a.user_id=auth.uid()
  and a.completed_at is null and a.type<>'note' and a.due_date<current_setting('test.reminders_end')::timestamptz and a.id::text like 'f1000000-%')
 and (select count(*)=2 from public.activities a where a.org_id=current_setting('test.org_a')::uuid and a.user_id=auth.uid()
  and a.completed_at is null and a.type<>'note' and a.due_date<now() and a.id::text like 'f1000000-%'),
 'reminders: two of them are overdue (due before now) and one is upcoming, as the browser splits them');
-- 2. The partial index serves the request (the planner is told not to read the whole table, as with real volume).
set local enable_seqscan=off;
select test_support.assert(test_support.plan_of(format('select id,type,due_date,completed_at,user_id from public.activities where org_id=%L and user_id=%L and completed_at is null and type<>''note'' and due_date<%L order by id',
  current_setting('test.org_a'),'00000000-0000-0000-0000-000000000001',current_setting('test.reminders_end'))) like '%activities_owner_pending%',
 'reminders: the request can use the partial index activities_owner_pending (org_id, user_id, due_date of pending activities)');
reset enable_seqscan;
-- 3. Each person sees only their own; another organization and a deactivated account read nothing.
select test_support.sign_in('00000000-0000-0000-0000-0000000000f1');
select test_support.assert(test_support.reminder_titles(current_setting('test.org_a')::uuid,auth.uid())='Lembrete: tarefa da colega',
 'reminders: a colleague gets only her own reminder');
select test_support.sign_in('00000000-0000-0000-0000-000000000002');
select test_support.assert(test_support.reminder_titles(current_setting('test.org_a')::uuid,'00000000-0000-0000-0000-000000000001')=''
  and test_support.reminder_titles(current_setting('test.org_b')::uuid,'00000000-0000-0000-0000-000000000001')='',
 'reminders: the owner of another organization reads none of them, even asking for the other account');
select test_support.sign_in('00000000-0000-0000-0000-0000000000f2');
select test_support.assert(test_support.reminder_titles(current_setting('test.org_a')::uuid,auth.uid())='',
 'reminders: a deactivated account (item 1.2) reads none of its old reminders');
reset role;
select test_support.sign_out();
rollback to savepoint activity_reminders;
select test_support.assert(not exists(select 1 from public.activities where id::text like 'f1000000-%')
 and not exists(select 1 from auth.users where email like '%-lembretes@example.test'),'the checks of item 1.12 were undone for the files that follow');
