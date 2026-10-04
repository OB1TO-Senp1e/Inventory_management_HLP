#!/usr/bin/env bash
# Runs every SQL DB test in supabase/tests/ against the interim verification
# database and fails non-zero on any error.
#
# INTERIM ONLY (see B-002): native local PostgreSQL, because `supabase start`
# needs Docker, which cannot run in this VM. Test files are staged under /tmp
# because the postgres OS user cannot traverse /home/hatch.
# Re-run against Supabase (local stack or cloud) once available.
set -euo pipefail
umask 022 # staged files must be readable by the postgres OS user

DB_NAME="${INTERIM_DB_NAME:-restaurant_inventory}"
STAGE="$(mktemp -d)"
chmod 755 "$STAGE" # mktemp -d forces 0700; postgres OS user must traverse it
trap 'rm -rf "$STAGE"' EXIT

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
  su postgres -c "psql -d \"$DB_NAME\" -v ON_ERROR_STOP=1 -f \"$dest\""
done

echo "test:db: all passed"
