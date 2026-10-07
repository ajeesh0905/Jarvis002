#!/usr/bin/env bash
# Daily consistent copy of the orders database; keeps the last 30 days.
set -euo pipefail
DEST=/var/backups/ruchi
mkdir -p "$DEST"
sqlite3 /var/lib/ruchi/orders.db ".backup '$DEST/orders-$(date +%F).db'"
find "$DEST" -name 'orders-*.db' -mtime +30 -delete
