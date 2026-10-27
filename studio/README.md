# Studio – photo shoot team + social media app

An internal app for the **photo shoot team** and the **social media manager** (client: **Twin Birds**).
Works on phone and computer (open the link, then "Add to home screen"). No `npm install` needed — Node 22.13 or newer.

    ADMIN_PIN=choose-a-pin npm start          # http://localhost:3100

**Putting it online for the team: `DEPLOY.md`** (try on office Wi-Fi in 2 minutes; permanent server later).

First login: username `admin`, PIN = `ADMIN_PIN` (default `1234` — change it under Admin → My account).

## Who can do what
| | Admin | Photographer | Social media |
|---|---|---|---|
| Plan shoots, day plan, shot list, upload photos | ✅ | ✅ | view only |
| Directory (studios, resorts, crew, models) | ✅ | ✅ | – |
| Mark photos *edited* | ✅ | ✅ | ✅ |
| **Approve / reject** photos | ✅ | – | ✅ |
| Content calendar, Twin Birds board | ✅ | view only | ✅ |
| Suggestions & feedback on a shoot, photo comments | ✅ | ✅ | ✅ |
| Team, Reports | ✅ | – | – |

## Photo shoot team
- **Shoot**: title, client, **date, time, place** (pick a studio/resort from the Directory or type one, plus map link), notes.
- **Who is going**: pick team members; each answers ✅ Going / ❌ Can't go in the app.
- **Booked crew**: book photographers, makeup artists, art directors, costume designers, props and models from the **Directory**. In the shoot form the list shows who is **already booked on the shoot date** (hidden by default; untick *Only people free on the shoot date* to see everyone).
- **Models**: one-off models can be typed in as `Name | phone | portfolio link | note` (a **portfolio link** button is shown). Regular models can live in the Directory.
- **Day plan**: timeline, e.g. `08:30 Setup & lights`. **Shot list** with tick boxes.
- **Suggestions & feedback**: anyone on the team can post on a shoot.
- **Photos**: upload many at once → *Uploaded → Edited → Approved / Rejected*, with comments. Only **approved** photos can be attached to a post.

## Social media (Twin Birds)
- **Content calendar**: posts with platform, date/time, caption, hashtags, approved photos, status (idea → draft → scheduled → posted). "Copy caption" button.
- **Board**: monthly **Reels** and **Statics** slots like your Tech Board. Tap a number to mark it done (small tag optional), **+** adds an extra. Set the month's targets with *Set targets* (defaults 8 reels / 12 statics, or `DEFAULT_REELS` / `DEFAULT_STATICS`). The client name is `CLIENT_NAME` (default `Twin Birds`).

## Day by day and reports
- **Home → Day view**: pick any date — that day's shoots (plan, who is going, models), posts, and how many photos / reels / statics were done.
- **Admin → Reports**: counts **daily, weekly (Mon–Sun) and monthly** — shoots, photos uploaded/approved, posts planned/posted, reels and statics done — plus a **per-person** table and CSV download.

## Directory — load your "Shoot_Requirements" Google Sheet
Open **Directory**, choose a tab (Studios, Resorts, Photographers, …), then **Import**: in Google Sheets open the matching tab → *File → Download → CSV* and choose the file. Columns are matched by their headings (Name, Location/CITY, Phone Number/Number/Contact, Instagram, Charges, Rating, …); anything else goes into Notes. Re-importing is safe: names already there are kept and only empty fields are filled. "DM" contacts have no phone, so the card shows the Instagram link instead. Phone numbers without a country code get `+91` (`DEFAULT_COUNTRY_CODE` to change).
> Phone numbers stay in your app's database only — they are not stored in the code repository.

## Booking from the photographer list
**Directory → Photographers** (or any list) → **Book** on a person's card:
1. choose the upcoming shoot, optionally add the **agreed fee** and a **note** for them;
2. the app warns if they are **already booked that day**, and sends them the booking message (if they have a phone number — otherwise it tells you to contact them on Instagram / email);
3. each card shows that person's **upcoming bookings**, and on the shoot page you set their status: ⏳ Requested → ✅ Confirmed / ❌ Declined (declined people free up that day).

## Automatic WhatsApp messages
When a team member, directory person or model is **newly booked** on a shoot, or a shoot's **date / time / place changes or is cancelled**, the app:
1. shows team members an in-app message (Home → Messages), and
2. sends a **WhatsApp message** to anyone with a phone number — directly through the WhatsApp Business Cloud API. Setup (Meta account, token, template): **`WHATSAPP.md`**.

Every attempt is listed under **Messages sent** on the shoot (✓ sent / skipped / failed and why). Until WhatsApp is connected messages are marked *skipped*; the shoot page still has one-tap **WhatsApp** buttons that open a ready-written message in your own WhatsApp. (`NOTIFY_WEBHOOK_URL` can hand messages to another sender instead: the app POSTs `{"to","name","message"}` to it.)

## Photo storage → Google Drive
See `GOOGLE-DRIVE.md`. Without it, photos are stored on the server's disk under `data/photos`.

## Settings (environment variables)
`PORT` (3100) · `DATA_DIR` (./data — **back this up**) · `ADMIN_PIN` · `CLIENT_NAME` · `DEFAULT_REELS` / `DEFAULT_STATICS` · `DEFAULT_COUNTRY_CODE` · `WHATSAPP_TOKEN` / `WHATSAPP_PHONE_ID` / `WHATSAPP_TEMPLATE` / `WHATSAPP_TEMPLATE_LANG` · `NOTIFY_WEBHOOK_URL` · `GDRIVE_CLIENT_ID` / `GDRIVE_CLIENT_SECRET` / `GDRIVE_REFRESH_TOKEN`

## Security notes
Logins use usernames + PINs (hashed), 5 wrong tries locks that user/device for 10 minutes. Put the app behind HTTPS (e.g. Cloudflare Tunnel or a reverse proxy) before using it over the internet. Photos are only served to logged-in users.
