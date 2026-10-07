#!/usr/bin/env bash
# Starts Ruchi Food Products on this computer. Data is saved in the "data" folder of the project.
cd "$(dirname "$0")/.."
command -v node >/dev/null || { echo "Install Node.js (LTS, v22 or newer) from https://nodejs.org first."; exit 1; }
export ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin123}"
echo "Open http://localhost:3000/admin  (Ctrl+C to stop)"
exec node server.js
