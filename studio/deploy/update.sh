#!/usr/bin/env bash
# Update the app from the git checkout it was installed from.
# Usage: cd ~/Jarvis002/studio && git pull && sudo studio-update
set -euo pipefail
SRC="${1:-$PWD}"
[ -f "$SRC/server.js" ] || { echo "Run from the studio folder (or pass its path)"; exit 1; }
studio-backup
rsync -a --delete --exclude data --exclude node_modules --exclude deploy "$SRC"/ /opt/studio/
chown -R studio:studio /opt/studio
systemctl restart studio
echo "Updated."
