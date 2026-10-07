# Ruchi Food Products – Daily Order App

Shops book tomorrow's quantities (chappathi, idiyappam, …) from their phone; the owner sees daily totals and month-end analysis.

## Run
Requires Node >= 22.13 (no npm install needed).

    ADMIN_PASSWORD=yourpassword npm start

- Shops: `http://<host>:3000/` (Malayalam / English toggle, add to home screen)
- Owner: `http://<host>:3000/admin` (default password `admin123` – change it under Settings)

Data is stored in `data/orders.db` (SQLite). Back this folder up; set `DATA_DIR` to relocate it.

## Deploy
See `deploy/DEPLOY.md` (Oracle Cloud Always Free, with HTTPS and daily backups).

## Features
- Shop login with phone + PIN; quantities with +/− buttons; prices shown; total
- Order cut-off time (set in Admin → Settings, India time); shops order for next day
- Admin: daily "total to prepare", per-shop orders, shops not yet ordered, edit any order
- Products with English + Malayalam names and prices (add / edit / hide)
- Monthly analysis: revenue, top shops, product totals, day-by-day, CSV download
- Daily production list: Print, share on WhatsApp, or copy as text
- Order alerts: every order placed / changed / cancelled by a shop appears in Admin → Alerts (pop-up if browser alerts are enabled). For phone push when the page is closed, set `NOTIFY_URL`, e.g. `NOTIFY_URL=https://ntfy.sh/<your-secret-topic> npm start` and subscribe to that topic in the free ntfy app
- Delivery & payments: mark each shop's delivery, record payments, see dues per shop (Admin → Dues). Only delivered orders are counted
- Holidays & weekly off days (Admin → Settings): shops are automatically moved to the next working day
- Price is saved with each order, so later price changes don't alter past records
