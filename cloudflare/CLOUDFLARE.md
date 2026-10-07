# Free hosting on Cloudflare (Workers + D1) – no card, always on

The app also runs on Cloudflare's free plan: pages and API on Workers, data in a D1 (SQLite) database.
It never "sleeps" and your data is kept. Check Cloudflare's current free-plan limits before relying on it.
This was tested locally with Wrangler; I could not test it on a real Cloudflare account.

## One-time setup (about 15 minutes)
1. Create a free account at https://dash.cloudflare.com/sign-up (no card needed).
2. Install Node.js LTS from https://nodejs.org, then in the project folder run:

       npm install
       npx wrangler login

3. Create the database and note the `database_id` it prints:

       npx wrangler d1 create ruchi-db

   Paste that id into `wrangler.toml` (replace `REPLACE_WITH_YOUR_DATABASE_ID`).
4. Create the tables:

       npx wrangler d1 execute ruchi-db --remote --file=src/schema.sql

5. Deploy:

       npx wrangler deploy

   It prints your address, like `https://ruchi-food-products.<your-name>.workers.dev`.
6. **Before opening the admin page**, set two secrets (each command asks you to type the value):

       npx wrangler secret put APP_SECRET       # any long random text; never change it later
       npx wrangler secret put ADMIN_PASSWORD   # your admin password (used on first login)

   (If you change `APP_SECRET` later, all shop PINs and the admin password stop working.)
7. Open `https://<your-address>/admin`, log in, add products and shops.
   Shops open the main address and can "Add to Home screen".

## Optional phone alerts
    npx wrangler secret put NOTIFY_URL     # e.g. https://ntfy.sh/your-secret-topic

## Backups
    npx wrangler d1 export ruchi-db --remote --output=backup.sql

Run this regularly and keep the file somewhere safe (USB / Drive).

## Updating
After code changes: `npx wrangler deploy`. Your data stays.

## Upgrading an existing Cloudflare database (only if you deployed before product categories existed)
    npx wrangler d1 execute ruchi-db --remote --command "ALTER TABLE products ADD COLUMN category TEXT NOT NULL DEFAULT ''"
(New databases created from `src/schema.sql` already have it. Node/own-computer installs upgrade automatically.)
