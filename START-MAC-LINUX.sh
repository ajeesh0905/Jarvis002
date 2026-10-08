#!/usr/bin/env bash
# Starts Ruchi Food Products on this computer. Data is saved in the "data" folder.
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Install Node.js (LTS, v22 or newer) from https://nodejs.org first."; exit 1; }
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)" || { echo "Node.js is too old - install the latest LTS from https://nodejs.org"; exit 1; }
export ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin123}"
echo "Admin: http://localhost:3000/admin   Shops: http://localhost:3000/   (Ctrl+C to stop)"
(sleep 2; (command -v open >/dev/null && open http://localhost:3000/admin) || (command -v xdg-open >/dev/null && xdg-open http://localhost:3000/admin) || true) &
exec node server.js
