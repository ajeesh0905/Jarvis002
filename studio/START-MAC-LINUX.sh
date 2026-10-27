#!/usr/bin/env bash
# Starts the Studio app on this computer. Data is saved in the "data" folder.
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Install Node.js (LTS, v22 or newer) from https://nodejs.org first."; exit 1; }
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)" || { echo "Node.js is too old - install the latest LTS from https://nodejs.org"; exit 1; }
export ADMIN_PIN="${ADMIN_PIN:-1234}"
IP=$( (hostname -I 2>/dev/null | awk '{print $1}') || true )
echo "On this computer:  http://localhost:3100      Log in: admin / PIN $ADMIN_PIN"
[ -n "$IP" ] && echo "Same Wi-Fi/office:  http://$IP:3100"
echo "(Ctrl+C to stop)"
(sleep 2; (command -v open >/dev/null && open http://localhost:3100) || (command -v xdg-open >/dev/null && xdg-open http://localhost:3100) || true) &
exec node server.js
