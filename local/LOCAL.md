# Run on your own computer (data stays on your computer)

Orders are saved in the `data` folder of this project (`data/orders.db`). Nothing leaves your computer
unless you choose to share it online (step 3).

## 1. Install Node.js (once)
Download the **LTS** version (v22 or newer) from https://nodejs.org and install it.

## 2. Start the app
- **Windows:** double-click `START-WINDOWS.bat`
- **Mac / Linux:** run `./START-MAC-LINUX.sh`

Open **http://localhost:3000/admin** and log in with the password `admin123`
(change it right away in Settings, or start with your own: `ADMIN_PASSWORD=yourpassword`).

The app only runs while this window is open **and the computer is on**. For daily shop orders,
the computer should stay on (and not sleep) from the time shops start ordering until the evening cutoff.

## 3. Let shops reach it from their phones
**Same Wi-Fi only (simplest):** shops on the same Wi-Fi can open `http://<your-computer-ip>:3000`
(find the IP with `ipconfig` on Windows). Not practical for shops in other places.

**From anywhere, free, no router changes – Cloudflare Tunnel:**
1. Install `cloudflared` (https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/).
2. With the app running, run: `cloudflared tunnel --url http://localhost:3000`
3. It prints an address like `https://something.trycloudflare.com`. Give that to shops.

The quick address **changes every time you restart the tunnel**, so shops would need the new link each day.
For a permanent address, create a free Cloudflare account and a named tunnel with your own domain
(a domain costs money), or use the Cloudflare-hosted version of this app (see README) which is free
and always on.

## 4. Backups (important – it's one computer)
Copy the `data` folder regularly to a USB drive or cloud drive (`local/backup-windows.bat` does a dated copy).
If the computer's disk fails and there is no copy, the orders are lost.

## 5. Updating
Download the newest project files and replace everything **except** the `data` folder.
