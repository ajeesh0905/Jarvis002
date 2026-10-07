#!/usr/bin/env bash
# Update the app from the git checkout it was installed from.
# Usage: cd ~/Jarvis002 && git pull && sudo ruchi-update
set -euo pipefail
SRC="${1:-$PWD}"
[ -f "$SRC/server.js" ] || { echo "Run from the repo folder (or pass its path)"; exit 1; }
ruchi-backup
rsync -a --delete --exclude .git --exclude data --exclude node_modules "$SRC"/ /opt/ruchi/
chown -R ruchi:ruchi /opt/ruchi
systemctl restart ruchi
echo "Updated."
