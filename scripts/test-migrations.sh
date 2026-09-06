#!/usr/bin/env bash
set -Eeuo pipefail

readonly ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly IMAGE="${POSTGRES_IMAGE:-supabase/postgres:15.8.1.060}"
readonly MIGRATIONS_DIR="${MIGRATIONS_DIR:-$ROOT/migrations}"
readonly NAME="cribble-migrations-${$}"
readonly PASSWORD="migration-test"

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run --detach --rm --name "$NAME" \
  -e POSTGRES_PASSWORD="$PASSWORD" -e POSTGRES_DB=cribble \
  "$IMAGE" postgres \
  -c shared_preload_libraries=pg_stat_statements,pgaudit,plpgsql,plpgsql_check,pg_cron,pg_net,pgsodium,timescaledb,auto_explain,pg_tle,plan_filter,supabase_vault \
  -c cron.database_name=cribble >/dev/null

ready_count=0
for _ in $(seq 1 90); do
  if [[ "$(docker exec -e PGPASSWORD="$PASSWORD" "$NAME" \
    psql -U supabase_admin -d cribble -Atc 'select count(*) from pg_event_trigger' 2>/dev/null || true)" == "8" ]]; then
    ready_count=$((ready_count + 1))
    [[ "$ready_count" -eq 3 ]] && break
  else
    ready_count=0
  fi
  sleep 1
done
[[ "$ready_count" -eq 3 ]] || { printf 'PostgreSQL did not become ready\n' >&2; exit 1; }

docker exec -e PGPASSWORD="$PASSWORD" "$NAME" \
  psql -v ON_ERROR_STOP=1 -U supabase_admin -d cribble \
  -c 'ALTER EVENT TRIGGER issue_graphql_placeholder DISABLE; ALTER EVENT TRIGGER graphql_watch_ddl DISABLE; ALTER EVENT TRIGGER graphql_watch_drop DISABLE;'

docker exec -i -e PGPASSWORD="$PASSWORD" "$NAME" \
  psql -v ON_ERROR_STOP=1 -U supabase_admin -d cribble \
  < "$ROOT/tests/migrations/bootstrap.sql"

for migration in "$MIGRATIONS_DIR"/*.sql; do
  printf 'applying %s\n' "$(basename "$migration")"
  docker exec -i -e PGPASSWORD="$PASSWORD" "$NAME" \
    psql -v ON_ERROR_STOP=1 -U supabase_admin -d cribble < "$migration"
done

# Prove the monotonic repair is a no-op on the deployed legacy-column head.
docker exec -i -e PGPASSWORD="$PASSWORD" "$NAME" \
  psql -v ON_ERROR_STOP=1 -U supabase_admin -d cribble \
  < "$MIGRATIONS_DIR/062_reconcile_auth_column_names.sql"

# Prove a database that applied the abandoned rename upgrades without data loss.
docker exec -e PGPASSWORD="$PASSWORD" "$NAME" \
  createdb -U supabase_admin renamed_head
docker exec -i -e PGPASSWORD="$PASSWORD" "$NAME" \
  psql -v ON_ERROR_STOP=1 -U supabase_admin -d renamed_head \
  < "$ROOT/tests/migrations/renamed-head.sql"
docker exec -i -e PGPASSWORD="$PASSWORD" "$NAME" \
  psql -v ON_ERROR_STOP=1 -U supabase_admin -d renamed_head \
  < "$MIGRATIONS_DIR/062_reconcile_auth_column_names.sql"
docker exec -i -e PGPASSWORD="$PASSWORD" "$NAME" \
  psql -v ON_ERROR_STOP=1 -U supabase_admin -d renamed_head \
  < "$ROOT/tests/migrations/assert-reconciled.sql"
