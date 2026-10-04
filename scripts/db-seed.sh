#!/usr/bin/env bash
# Applies supabase/seed.sql (DEV ONLY sample data) to the verification DB.
#
# Connection selection mirrors scripts/test-db.sh:
#   - Default (this VM): native local PostgreSQL via `su postgres` peer auth
#     (INTERIM ONLY, see B-002 — `supabase start` needs Docker).
#   - CI (postgres service container): set PGHOST (plus PGPORT/PGUSER/
#     PGPASSWORD/PGDATABASE) to connect over TCP instead.
#
# The seed is idempotent (INSERT ... ON CONFLICT DO NOTHING) — safe to re-run.
# On real Supabase, prefer `supabase db reset` (runs seed.sql automatically)
# or paste the file into the SQL editor; see README "Test users".
#
# Staged under /tmp because the postgres OS user cannot traverse /home/hatch
# (repo files are 660 — see ~/TOOLS.md).
set -euo pipefail
umask 022 # staged files must be readable by the postgres OS user

DB_NAME="${PGDATABASE:-${INTERIM_DB_NAME:-restaurant_inventory}}"
STAGE="$(mktemp -d)"
chmod 755 "$STAGE" # mktemp -d forces 0700; postgres OS user must traverse it
trap 'rm -rf "$STAGE"' EXIT

install -m 644 supabase/seed.sql "$STAGE/seed.sql"

if [ -n "${PGHOST:-}" ]; then
  psql -h "$PGHOST" -p "${PGPORT:-5432}" -U "${PGUSER:-postgres}" \
    -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$STAGE/seed.sql"
else
  su postgres -c "psql -d \"$DB_NAME\" -v ON_ERROR_STOP=1 -f \"$STAGE/seed.sql\""
fi

echo "db:seed: done"
