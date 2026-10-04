#!/usr/bin/env bash
# Runs every SQL DB test in supabase/tests/ against the verification
# database and fails non-zero on any error.
#
# Connection selection:
#   - Default (this VM): native local PostgreSQL via `su postgres` peer auth
#     (INTERIM ONLY, see B-002 — `supabase start` needs Docker).
#   - CI (postgres service container): set PGHOST (plus PGPORT/PGUSER/
#     PGPASSWORD/PGDATABASE) to connect over TCP instead.
#
# INTERIM ONLY (see B-002): native local PostgreSQL, because `supabase start`
# needs Docker, which cannot run in this VM. Test files are staged under /tmp
# because the postgres OS user cannot traverse /home/hatch.
# Re-run against Supabase (local stack or cloud) once available.
set -euo pipefail
umask 022 # staged files must be readable by the postgres OS user

DB_NAME="${PGDATABASE:-${INTERIM_DB_NAME:-restaurant_inventory}}"
STAGE="$(mktemp -d)"
chmod 755 "$STAGE" # mktemp -d forces 0700; postgres OS user must traverse it
trap 'rm -rf "$STAGE"' EXIT

# run_psql <file> — executes a SQL file with ON_ERROR_STOP=1, via peer auth
# locally or TCP when PGHOST is set (CI).
run_psql() {
  if [ -n "${PGHOST:-}" ]; then
    psql -h "$PGHOST" -p "${PGPORT:-5432}" -U "${PGUSER:-postgres}" \
      -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$1"
  else
    su postgres -c "psql -d \"$DB_NAME\" -v ON_ERROR_STOP=1 -f \"$1\""
  fi
}

shopt -s nullglob
files=(supabase/tests/*.sql)
if [ "${#files[@]}" -eq 0 ]; then
  echo "test:db: no test files in supabase/tests/"
  exit 0
fi

for f in "${files[@]}"; do
  echo "== $f"
  dest="$STAGE/$f"
  mkdir -p "$(dirname "$dest")"
  # install(1) sets an explicit mode: cp would inherit the repo's 660 perms,
  # which the postgres OS user cannot read.
  install -m 644 "$f" "$dest"
  run_psql "$dest"
done

echo "test:db: all passed"
