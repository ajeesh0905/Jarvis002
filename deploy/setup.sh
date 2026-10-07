#!/usr/bin/env bash
# One-time setup for Ruchi Food Products on an Ubuntu VM (e.g. Oracle Cloud Always Free).
# Run from the repo root:   sudo bash deploy/setup.sh [your-domain.example.com]
# With a domain  -> automatic HTTPS (recommended; needed for "add to home screen").
# Without domain -> plain HTTP on the server IP.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run with sudo"; exit 1; }
DOMAIN="${1:-}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
export DEBIAN_FRONTEND=noninteractive

echo "==> Installing packages"
apt-get update -y
apt-get install -y curl git rsync sqlite3 gnupg debian-keyring debian-archive-keyring apt-transport-https iptables-persistent

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  echo "==> Installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! command -v caddy >/dev/null; then
  echo "==> Installing Caddy (web server with automatic HTTPS)"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

echo "==> Opening ports 80 and 443 in the instance firewall"
for p in 80 443; do
  iptables -C INPUT -p tcp --dport $p -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -p tcp --dport $p -j ACCEPT
done
netfilter-persistent save

echo "==> Installing the app"
id ruchi >/dev/null 2>&1 || useradd --system --home /opt/ruchi --shell /usr/sbin/nologin ruchi
mkdir -p /opt/ruchi /var/lib/ruchi /var/backups/ruchi
rsync -a --delete --exclude .git --exclude data --exclude node_modules "$SRC"/ /opt/ruchi/
chown -R ruchi:ruchi /opt/ruchi /var/lib/ruchi

if [ ! -f /etc/ruchi.env ]; then
  read -r -s -p "Choose the admin password (min 6 chars): " PW; echo
  [ "${#PW}" -ge 6 ] || { echo "Too short"; exit 1; }
  cat > /etc/ruchi.env <<ENV
PORT=3000
HOST=127.0.0.1
DATA_DIR=/var/lib/ruchi
ADMIN_PASSWORD=$PW
# Optional phone alerts: NOTIFY_URL=https://ntfy.sh/your-secret-topic
ENV
  chmod 600 /etc/ruchi.env
fi

install -m 644 "$SRC/deploy/ruchi.service" /etc/systemd/system/ruchi.service
install -m 755 "$SRC/deploy/backup.sh" /usr/local/bin/ruchi-backup
install -m 755 "$SRC/deploy/update.sh" /usr/local/bin/ruchi-update
echo "0 2 * * * root /usr/local/bin/ruchi-backup" > /etc/cron.d/ruchi-backup

if [ -n "$DOMAIN" ]; then
  printf '%s {\n\treverse_proxy 127.0.0.1:3000\n}\n' "$DOMAIN" > /etc/caddy/Caddyfile
else
  printf ':80 {\n\treverse_proxy 127.0.0.1:3000\n}\n' > /etc/caddy/Caddyfile
fi

systemctl daemon-reload
systemctl enable --now ruchi
systemctl reload caddy || systemctl restart caddy
sleep 2
systemctl is-active --quiet ruchi && echo "==> App is running." || { journalctl -u ruchi -n 30 --no-pager; exit 1; }
if [ -n "$DOMAIN" ]; then echo "Open: https://$DOMAIN   (admin: https://$DOMAIN/admin)"
else echo "Open: http://<server-public-ip>   (admin: /admin)"; fi
echo "Remember to open ports 80 and 443 in the Oracle Cloud console too (see deploy/DEPLOY.md)."
