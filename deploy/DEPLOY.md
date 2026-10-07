# Deploy on Oracle Cloud "Always Free"

Oracle's menus change from time to time; if a label differs slightly, look for the closest one.
Check Oracle's current Always Free limits before you start.

## 1. Create the Oracle account
1. Sign up at cloud.oracle.com (a card is needed for verification; the Always Free resources are not charged).
2. Pick a **home region close to you** (for example Mumbai or Hyderabad). It cannot be changed later.

## 2. Create the VM
1. Menu → **Compute → Instances → Create instance**.
2. **Image:** Ubuntu 22.04 or 24.04.
3. **Shape:** the Always Free AMD micro (`VM.Standard.E2.1.Micro`) is enough for this app.
   The Ampere (ARM) shape also works but is often "out of capacity".
4. **Networking:** keep "Assign a public IPv4 address" ticked.
5. **SSH keys:** choose "Generate a key pair" and **download the private key** – you cannot get it again.
6. Create the instance and wait until it shows *Running*. Note its **public IP**.

## 3. Open ports 80 and 443 in Oracle's network
Instance page → click the **subnet** → **Security Lists** → default list → **Add Ingress Rules**:
- Source CIDR `0.0.0.0/0`, IP protocol TCP, destination port `80`
- Same again for port `443`

(The setup script opens the VM's own firewall; this step opens Oracle's.)

## 4. Make the IP permanent (recommended)
Networking → **Reserved public IPs** → reserve one and attach it to the instance, so the address never changes.

## 5. Free domain name (needed for HTTPS and "add to home screen")
1. Go to duckdns.org, sign in, create a name such as `ruchifoods` → `ruchifoods.duckdns.org`.
2. Set its IP to your server's public IP.

## 6. Install the app
From your computer (Ubuntu images use the user `ubuntu`):

    ssh -i path/to/private.key ubuntu@YOUR_SERVER_IP

On the server:

    git clone -b claude/app-build-qc432j https://github.com/ajeesh0905/Jarvis002.git
    cd Jarvis002
    sudo bash deploy/setup.sh ruchifoods.duckdns.org

If the repository is private, use a GitHub personal access token in the URL
(`https://<token>@github.com/ajeesh0905/Jarvis002.git`) or copy the folder with `scp -r`.

The script asks for your **admin password**, then installs everything and starts the app.
Open `https://ruchifoods.duckdns.org/admin` and log in. HTTPS can take a minute the first time.

> The admin password from setup is used only on first start. Change it later in Admin → Settings.

## 7. Using it
- Shops open `https://ruchifoods.duckdns.org`, log in, and use the browser's "Add to Home screen".
- Add your products and shops in `/admin`.

## Updating later
    cd ~/Jarvis002 && git pull && sudo ruchi-update

## Backups
- The database is `/var/lib/ruchi/orders.db`. A copy is saved every night at 2 AM to `/var/backups/ruchi` (30 days kept).
- Those copies are on the same server. **Also download one now and then**, for example:

      scp -i path/to/private.key ubuntu@YOUR_SERVER_IP:/var/backups/ruchi/orders-$(date +%F).db .

## Useful commands
    sudo systemctl status ruchi        # is it running?
    sudo journalctl -u ruchi -n 50     # recent logs
    sudo systemctl restart ruchi
    sudo nano /etc/ruchi.env           # settings (then restart); e.g. NOTIFY_URL for phone alerts

## Things to know
- Oracle may reclaim Always Free instances that sit almost idle for a long time, and free-tier capacity
  rules change. Upgrading the account to "Pay As You Go" (you stay within the free limits) is commonly
  advised to avoid this – confirm in Oracle's current documentation.
- Keep your SSH private key safe; anyone with it can log in to the server.
