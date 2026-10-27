#!/usr/bin/env bash
# One-time setup of the Studio app on an Ubuntu VM (e.g. Oracle Cloud Always Free).
# Run from the studio folder:   sudo bash deploy/setup.sh studio.example.com
# A domain name is needed for HTTPS (and "add to home screen"). It can share a VM with the Ruchi app.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run with sudo"; exit 1; }
DOMAIN="${1:-}"
[ -n "$DOMAIN" ] || { echo "Usage: sudo bash deploy/setup.sh your-domain.example.com   (a free name from duckdns.org works)"; exit 1; }
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
id studio >/dev/null 2>&1 || useradd --system --home /opt/studio --shell /usr/sbin/nologin studio
mkdir -p /opt/studio /var/lib/studio /var/backups/studio
rsync -a --delete --exclude data --exclude node_modules --exclude deploy "$SRC"/ /opt/studio/
chown -R studio:studio /opt/studio /var/lib/studio

if [ ! -f /etc/studio.env ]; then
  read -r -s -p "Choose the admin PIN (4-8 digits): " PIN; echo
  [[ "$PIN" =~ ^[0-9]{4,8}$ ]] || { echo "PIN must be 4-8 digits"; exit 1; }
  cat > /etc/studio.env <<ENV
PORT=3100
HOST=127.0.0.1
DATA_DIR=/var/lib/studio
ADMIN_PIN=$PIN
CLIENT_NAME=Twin Birds
# WhatsApp (see WHATSAPP.md):
#WHATSAPP_TOKEN=
#WHATSAPP_PHONE_ID=
#WHATSAPP_TEMPLATE=shoot_booking
#WHATSAPP_TEMPLATE_LANG=en
# Google Drive photo storage (see GOOGLE-DRIVE.md):
#GDRIVE_CLIENT_ID=
#GDRIVE_CLIENT_SECRET=
#GDRIVE_REFRESH_TOKEN=
ENV
  chmod 600 /etc/studio.env
fi

install -m 644 "$SRC/deploy/studio.service" /etc/systemd/system/studio.service
install -m 755 "$SRC/deploy/backup.sh" /usr/local/bin/studio-backup
install -m 755 "$SRC/deploy/update.sh" /usr/local/bin/studio-update
echo "0 2 * * * root /usr/local/bin/studio-backup" > /etc/cron.d/studio-backup

# add our site to Caddy without touching sites already there (e.g. the Ruchi app)
mkdir -p /etc/caddy; touch /etc/caddy/Caddyfile
if ! grep -q "^$DOMAIN " /etc/caddy/Caddyfile; then
  printf '\n%s {\n\trequest_body {\n\t\tmax_size 40MB\n\t}\n\treverse_proxy 127.0.0.1:3100\n}\n' "$DOMAIN" >> /etc/caddy/Caddyfile
fi

systemctl daemon-reload
systemctl enable --now studio
systemctl restart studio
systemctl reload caddy || systemctl restart caddy
sleep 2
systemctl is-active --quiet studio && echo "==> App is running." || { journalctl -u studio -n 30 --no-pager; exit 1; }
echo "Open: https://$DOMAIN   — log in as  admin  with the PIN you chose. HTTPS can take a minute the first time."
echo "Remember to open ports 80 and 443 in the Oracle Cloud console too."
