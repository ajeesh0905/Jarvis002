# Store photos in Google Drive

The app creates a folder **"Studio Photos"** in the Google account you connect, with one sub-folder per shoot (`2026-11-05 Diwali campaign`). It only has access to files it created itself (Google's narrow `drive.file` permission), never the rest of your Drive. The team opens photos through the app; you can also browse them in Drive.

## One-time setup (about 10 minutes, on your own computer)
1. Go to <https://console.cloud.google.com/> → create a project (e.g. "Studio App").
2. **APIs & Services → Library** → search **Google Drive API** → **Enable**.
3. **APIs & Services → OAuth consent screen** (Google Auth Platform): choose **External**, fill app name + your email. Add yourself under **Audience → Test users**, then **Publish app → In production**.
   > Important: leave it in *Testing* and Google expires the connection after **7 days**. "In production" is fine for a private tool — you'll just see an "unverified app" warning once; click *Advanced → Continue*.
4. **Clients → Create client → Application type: Desktop app** → copy the **Client ID** and **Client secret**.
5. In the `studio` folder run:

       GDRIVE_CLIENT_ID=xxxx GDRIVE_CLIENT_SECRET=yyyy node drive-auth.mjs

   Open the link it prints, sign in with the Drive account that should hold the photos, allow access. The terminal prints `GDRIVE_REFRESH_TOKEN=...`.
6. Start the app with all three values:

       GDRIVE_CLIENT_ID=xxxx GDRIVE_CLIENT_SECRET=yyyy GDRIVE_REFRESH_TOKEN=zzzz npm start

   The start-up line should say `photo storage: Google Drive`.

## Good to know
- Photos uploaded before Drive was switched on stay on disk and keep working; new ones go to Drive.
- Deleting a photo in the app also deletes it from Drive.
- Uploads up to 30 MB per photo. Drive storage counts against that Google account's quota.
- Keep the refresh token secret (it is like a password for the app's Drive folder).
