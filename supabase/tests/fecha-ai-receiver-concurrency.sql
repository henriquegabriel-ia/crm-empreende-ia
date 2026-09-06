\set ON_ERROR_STOP on
select fecha_test.assert((select count(*)=1 from private.fecha_ai_deliveries where call_id='30000000-0000-4000-8000-000000000003'),'20 concurrent retries persist exactly one receipt');
select fecha_test.assert((select count(*)=1 from public.activities a join private.fecha_ai_deliveries d on a.id=d.note_id where d.call_id='30000000-0000-4000-8000-000000000003'),'20 concurrent retries persist exactly one note');
select fecha_test.assert((select count(*)=1 from public.activities a join private.fecha_ai_deliveries d on a.id=d.task_id where d.call_id='30000000-0000-4000-8000-000000000003'),'20 concurrent retries persist exactly one task');
select fecha_test.assert((select count(*)=5 from public.activities),'concurrent retries leave no orphan duplicate native activities');
