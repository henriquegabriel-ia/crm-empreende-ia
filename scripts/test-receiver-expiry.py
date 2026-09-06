"""Synthetic regression: an authorized delivery waits for a contact lock past token expiry."""
import subprocess
import sys
import time

psql = ["psql", "-X", "-h", "127.0.0.1", "-p", sys.argv[1], "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-qAt"]

def query(sql, check=True):
    return subprocess.run(psql + ["-c", sql], text=True, capture_output=True, check=check)

blocker = subprocess.Popen(psql + ["-c", "begin; select id from public.contacts where id='40000000-0000-4000-8000-000000000001' for update; select pg_advisory_xact_lock(740001); select pg_sleep(2); commit;"], text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
try:
    deadline = time.monotonic() + 3
    while query("select exists(select 1 from pg_locks where locktype='advisory' and objid=740001 and granted)").stdout.strip() != "t":
        if time.monotonic() >= deadline:
            raise AssertionError("Contact blocker did not become ready")
        time.sleep(0.02)
    # The marker is acquired after the contact row lock, so the following delivery must actually wait.
    query("update private.fecha_ai_connections set expires_at=clock_timestamp()+interval '400 milliseconds'")
    outcome = query("set role service_role; select public.fecha_ai_integration(repeat('a',64),jsonb_build_object('operation','deliver','envelope',fecha_test.seal((request->'envelope')||'{\"callId\":\"30000000-0000-4000-8000-000000000004\"}'::jsonb)),'Must not persist','Expired while waiting') from fecha_test.concurrent_input", check=False)
    blocker.communicate(timeout=5)
    assert outcome.returncode != 0 and "invalid_connection_token" in outcome.stderr, outcome.stderr or outcome.stdout
    assert query("select (select count(*) from public.activities)=5 and (select count(*) from private.fecha_ai_deliveries)=3").stdout.strip() == "t", "Expired delivery wrote partial or complete records"
    query("update private.fecha_ai_connections set expires_at=clock_timestamp()+interval '2 days'")
    print("PASS: token expiry while waiting for a contact lock rejects delivery without note, task or receipt")
finally:
    if blocker.poll() is None:
        blocker.terminate()
        blocker.communicate(timeout=5)
