#!/usr/bin/env bash
# Прогон миграций + seed + RLS-теста на временном PostgreSQL.
# Использование: ./scripts/test-db.sh [host] [port]
# По умолчанию ждёт локальный postgres (peer/trust) и создаёт БД crm_rls_test.
set -euo pipefail
HOST="${1:-/tmp/pgtest}"
PORT="${2:-5544}"
DB=crm_rls_test
cd "$(dirname "$0")/.."

dropdb -h "$HOST" -p "$PORT" --if-exists "$DB"
createdb -h "$HOST" -p "$PORT" "$DB"
psql -h "$HOST" -p "$PORT" -d "$DB" -v ON_ERROR_STOP=1 -q -f supabase/tests/shim_auth.sql
for f in supabase/migrations/*.sql supabase/seed.sql; do
  psql -h "$HOST" -p "$PORT" -d "$DB" -v ON_ERROR_STOP=1 -q -f "$f"
done
# Гранты, которые Supabase раздаёт default privileges
psql -h "$HOST" -p "$PORT" -d "$DB" -v ON_ERROR_STOP=1 -q <<'SQL'
grant usage on schema public, auth to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
grant execute on function auth.uid(), auth.jwt() to anon, authenticated, service_role;
SQL
psql -h "$HOST" -p "$PORT" -d "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/rls_test.sql | grep -E 'OK:|RLS_ALL_OK'
echo "Все проверки RLS пройдены."
