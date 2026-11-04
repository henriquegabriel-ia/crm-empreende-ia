#!/usr/bin/env bash
set -euo pipefail
# Runs the full fresh migration chain and real RLS checks in a disposable local PostgreSQL cluster.
crm_test_dir=$(mktemp -d /tmp/empreende-crm-database.XXXXXX)
crm_test_port=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')
cleanup() { pg_ctl -D "$crm_test_dir/data" stop -m fast >/dev/null 2>&1 || true; rm -rf "$crm_test_dir"; }
trap cleanup EXIT
initdb -D "$crm_test_dir/data" -A trust -U postgres --encoding=UTF8 --no-locale >"$crm_test_dir/init.log"
pg_ctl -D "$crm_test_dir/data" -l "$crm_test_dir/server.log" -o "-p $crm_test_port -h 127.0.0.1 -k $crm_test_dir" start >/dev/null
crm_psql=(psql -X -h 127.0.0.1 -p "$crm_test_port" -U postgres -d postgres -v ON_ERROR_STOP=1)
"${crm_psql[@]}" -f supabase/tests/local-bootstrap.sql >/dev/null
for migration in supabase/migrations/*.sql; do "${crm_psql[@]}" -f "$migration" >/dev/null; done
"${crm_psql[@]}" -f supabase/tests/commercial-security.sql
"${crm_psql[@]}" -v keep_fecha_fixture=1 -f supabase/tests/fecha-ai-receiver.sql
# Exercise real transaction contention in separate database sessions, not a mocked retry loop.
crm_receiver_workers=()
for crm_receiver_worker in {1..20}; do
  "${crm_psql[@]}" -qAt -c "set role service_role; select public.fecha_ai_integration(repeat('a',64),request,'Concurrent note','Concurrent reviewed body')->>'deliveryId' from fecha_test.concurrent_input" >"$crm_test_dir/receiver-$crm_receiver_worker.log" 2>&1 &
  crm_receiver_workers+=("$!")
done
for crm_receiver_pid in "${crm_receiver_workers[@]}"; do wait "$crm_receiver_pid"; done
python3 - "$crm_test_dir" <<'PY'
import pathlib, sys
results = [path.read_text().strip() for path in pathlib.Path(sys.argv[1]).glob('receiver-*.log')]
assert len(results) == 20 and len(set(results)) == 1, 'Concurrent retries did not return one immutable receipt'
print('PASS: 20 concurrent retries returned the same immutable receipt ID')
PY
"${crm_psql[@]}" -f supabase/tests/fecha-ai-receiver-concurrency.sql
python3 scripts/test-receiver-expiry.py "$crm_test_port"
"${crm_psql[@]}" -qAt -c "select jsonb_agg(jsonb_build_object('payload',payload,'receipt',receipt)) from private.fecha_ai_deliveries" >"$crm_test_dir/receipts.json"
deno run --config supabase/functions/deno.json --allow-read="$crm_test_dir/receipts.json" scripts/verify-receiver-receipts.ts "$crm_test_dir/receipts.json"
if [[ "${CRM_RUN_ADVISORS:-0}" == "1" ]]; then
  "${crm_psql[@]}" -qAt -c "drop schema fecha_test cascade" >/dev/null
  supabase db advisors --db-url "postgresql://postgres@127.0.0.1:$crm_test_port/postgres?sslmode=disable" --type security --fail-on error
fi
