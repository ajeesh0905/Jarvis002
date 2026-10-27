#!/usr/bin/env bash
# Nightly consistent copy of the database (30 days kept) + a mirror of locally stored photos.
set -euo pipefail
DEST=/var/backups/studio
mkdir -p "$DEST"
sqlite3 /var/lib/studio/studio.db ".backup '$DEST/studio-$(date +%F).db'"
find "$DEST" -name 'studio-*.db' -mtime +30 -delete
[ -d /var/lib/studio/photos ] && rsync -a /var/lib/studio/photos/ "$DEST/photos/" || true
