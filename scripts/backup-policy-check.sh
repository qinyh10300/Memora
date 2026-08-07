#!/bin/sh
set -eu

OFFSITE=0

usage() {
  echo "Usage: $0 [--offsite] BACKUP.dump" >&2
}

if [ "${1:-}" = "--offsite" ]; then
  OFFSITE=1
  shift
fi
[ "$#" -eq 1 ] || { usage; exit 2; }
BACKUP_PATH=$1
case "$BACKUP_PATH" in
  /*) ;;
  *) BACKUP_PATH="$PWD/$BACKUP_PATH" ;;
esac

CHECKSUM_PATH="$BACKUP_PATH.sha256"
MANIFEST_PATH="$BACKUP_PATH.json"
for path in "$BACKUP_PATH" "$CHECKSUM_PATH" "$MANIFEST_PATH"; do
  [ -f "$path" ] || { echo "Backup bundle file not found: $path" >&2; exit 1; }
done

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

file_mode() {
  if stat -f '%Lp' "$1" >/dev/null 2>&1; then
    stat -f '%Lp' "$1"
  else
    stat -c '%a' "$1"
  fi
}

EXPECTED_DIGEST=$(awk 'NR == 1 {print $1}' "$CHECKSUM_PATH")
ACTUAL_DIGEST=$(sha256_file "$BACKUP_PATH")
[ "$EXPECTED_DIGEST" = "$ACTUAL_DIGEST" ] || {
  echo "Backup checksum mismatch" >&2
  exit 1
}

for path in "$BACKUP_PATH" "$CHECKSUM_PATH" "$MANIFEST_PATH"; do
  MODE=$(file_mode "$path")
  [ "$MODE" = "600" ] || {
    echo "Backup bundle file must use mode 600: $path has $MODE" >&2
    exit 1
  }
done
DIRECTORY_MODE=$(file_mode "$(dirname -- "$BACKUP_PATH")")
[ "$DIRECTORY_MODE" = "700" ] || {
  echo "Backup directory must use mode 700; got $DIRECTORY_MODE" >&2
  exit 1
}

grep -q '"data_classification": "restricted"' "$MANIFEST_PATH"
grep -q '"contains_protected_user_content": true' "$MANIFEST_PATH"
grep -q '"offsite_encryption_required": true' "$MANIFEST_PATH"

if [ "$OFFSITE" = "1" ]; then
  [ "${BACKUP_OFFSITE_TRANSPORT_ENCRYPTED:-}" = "true" ] || {
    echo "Offsite readiness requires BACKUP_OFFSITE_TRANSPORT_ENCRYPTED=true" >&2
    exit 1
  }
  [ "${BACKUP_OFFSITE_STORAGE_ENCRYPTED:-}" = "true" ] || {
    echo "Offsite readiness requires BACKUP_OFFSITE_STORAGE_ENCRYPTED=true" >&2
    exit 1
  }
  [ "${BACKUP_OFFSITE_ACCESS_AUDIT_ENABLED:-}" = "true" ] || {
    echo "Offsite readiness requires BACKUP_OFFSITE_ACCESS_AUDIT_ENABLED=true" >&2
    exit 1
  }
  [ -n "${BACKUP_OFFSITE_KEY_REFERENCE:-}" ] || {
    echo "Offsite readiness requires a non-secret BACKUP_OFFSITE_KEY_REFERENCE" >&2
    exit 1
  }
fi

echo "Backup policy check passed: $(basename -- "$BACKUP_PATH") (offsite=$OFFSITE)"
