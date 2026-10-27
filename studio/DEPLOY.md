# Put the Studio app online for the whole team

Pick one. Start with **A** to try it today; use **C** for the real thing.

## A. Try it with more people today — same Wi-Fi / office
1. On one computer: Windows → double-click `START-WINDOWS.bat` · Mac/Linux → run `START-MAC-LINUX.sh` (install Node.js LTS from nodejs.org first).
2. The window prints an address like `http://192.168.1.20:3100`. Everyone on the **same Wi-Fi** opens that on their phone.
3. Log in as `admin` (PIN `1234` unless you set `ADMIN_PIN`) and add the team (below).
The computer must stay on, and photos/data are saved in the `data` folder on it.

## B. Quick public link for a trial (people anywhere, temporary)
Install Cloudflare's free `cloudflared` tool (<https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/>), start the app (step A1), then run:

    cloudflared tunnel --url http://localhost:3100

It prints a temporary `https://….trycloudflare.com` link that works from any phone while both are running. Change the admin PIN first — anyone with the link can reach the login page. Use this for trials only.

## C. Permanent: a small server (free Oracle Cloud VM, or any Ubuntu server)
Follow steps 1–5 of `../deploy/DEPLOY.md` (create the VM, open ports 80/443, reserve an IP, get a free DuckDNS name such as `studio-yourname.duckdns.org`). The **same VM can run both this app and the Ruchi app** — use a second DuckDNS name for this one. Then on the server:

    git clone -b claude/keen-carson-sa23fw https://github.com/ajeesh0905/Jarvis002.git
    cd Jarvis002/studio
    sudo bash deploy/setup.sh studio-yourname.duckdns.org

It asks for the admin PIN, installs everything, gets HTTPS automatically and starts the app. Open `https://studio-yourname.duckdns.org`.
> The deploy scripts are adapted from the Ruchi ones; I could not run them on a real server from here, so if a step shows a red error, send me the message.

Settings live in `/etc/studio.env` (WhatsApp, Google Drive — see `WHATSAPP.md`, `GOOGLE-DRIVE.md`); after editing run `sudo systemctl restart studio`.

## Adding your team
**Admin → Team → Add team member**: name, username, phone (for WhatsApp messages), a starting PIN and a role:
- **Photographer** – plans shoots, uploads photos, uses the directory and books people.
- **Social media** – approves photos, plans posts, ticks the Twin Birds board.
- **Admin** – everything, plus Team and Reports.

Send each person the link, their username and PIN. On a phone: open the link → browser menu → **Add to Home screen**. They can change their PIN under **Me**. Remove someone by pressing **Deactivate** (they are logged out immediately).

## Day-to-day
    sudo systemctl status studio        # is it running?
    sudo journalctl -u studio -n 50     # recent logs
    cd ~/Jarvis002 && git pull && cd studio && sudo studio-update     # update to the newest version

**Backups:** every night at 2 AM the database is copied to `/var/backups/studio` (30 days kept, plus a copy of any photos stored on the server). Those copies are on the same server, so also download one now and then. Photos stored in **Google Drive** are already off the server.

## How many people can use it?
I tested 30 people using it at the same moment (logging in, uploading 3 MB photos, replying going / can't go, approving, ticking the board): 350 requests in 1.6 s with no errors. A small free server handles a team of this size comfortably.
