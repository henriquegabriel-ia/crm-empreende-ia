-- Fecha IA receiver (roadmap 3.4): run by fechaAiReceiverChecks (scripts/test-database.mjs) right after 20 sessions
-- deliver the same review at the same time, on the committed fixture of fecha-ai-receiver-support.sql (no delivery
-- before them). The connection row lock serializes the retries: the first one writes, the others read its receipt.
select fecha_test.assert((select count(*)=1 from private.fecha_ai_deliveries where call_id='30000000-0000-4000-8000-000000000003'),'20 concurrent retries persist exactly one receipt');
select fecha_test.assert((select count(*)=1 from public.activities a join private.fecha_ai_deliveries d on a.id=d.note_id where d.call_id='30000000-0000-4000-8000-000000000003'),'20 concurrent retries persist exactly one note');
select fecha_test.assert((select count(*)=1 from public.activities a join private.fecha_ai_deliveries d on a.id=d.task_id where d.call_id='30000000-0000-4000-8000-000000000003'),'20 concurrent retries persist exactly one task');
select fecha_test.assert((select count(*)=2 from public.activities where org_id='10000000-0000-4000-8000-000000000002'),'concurrent retries leave no orphan duplicate native activities');
