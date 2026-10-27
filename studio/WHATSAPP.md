# Send booking messages on WhatsApp

The app sends through the **WhatsApp Business Cloud API** (Meta's official service). When someone is booked, or a shoot's date / time / place changes or is cancelled, they get a WhatsApp message with the shoot details. Every attempt (✓ sent / failed + Meta's reason) is shown under **Messages sent** on the shoot.

You need a Meta (Facebook) business account. Meta's menus change now and then — if a name below differs slightly, look for the closest match.

## 1. Create the WhatsApp app
1. Go to <https://developers.facebook.com/> → **My Apps → Create App** → type **Business**.
2. Add the **WhatsApp** product to the app.
3. Open **WhatsApp → API Setup**. Copy the **Phone number ID** → this is `WHATSAPP_PHONE_ID`. (Meta gives you a free *test* number to start with.)

## 2. Get a token that doesn't expire
The token on the API Setup page lasts only 24 hours — fine for a first test, not for daily use.
1. <https://business.facebook.com/> → **Business settings → Users → System users** → add a system user (Admin).
2. **Add assets** → your app (full control), and the WhatsApp account.
3. **Generate token** → tick `whatsapp_business_messaging` and `whatsapp_business_management` → copy it → this is `WHATSAPP_TOKEN`. Keep it secret.

## 3. Message people who haven't written to you: a template
WhatsApp only lets a business start a conversation with an **approved template** (free-form text works only within 24 hours after the person messaged you). Create one:
1. **WhatsApp Manager → Message templates → Create**. Category **Utility**, name `shoot_booking`, choose a language.
2. Body (exactly one variable): `Studio update: {{1}}`. Add a sample like `Hi Anu, you're booked for Diwali campaign on 2026-11-05 at 09:00, Studio 2`. Submit; approval is usually quick.
3. Set `WHATSAPP_TEMPLATE=shoot_booking` and `WHATSAPP_TEMPLATE_LANG` to the language code you chose (e.g. `en` or `en_US`). The app puts the whole message into `{{1}}` (line breaks become " • ", because template variables can't contain line breaks).

## 4. Start the app
    WHATSAPP_TOKEN=xxxx WHATSAPP_PHONE_ID=123456789 WHATSAPP_TEMPLATE=shoot_booking WHATSAPP_TEMPLATE_LANG=en npm start

## Things to know
- **Test number:** it can only message phone numbers you add and verify in *API Setup → To → Manage phone number list* (a handful). To message your whole team and models, connect a real business phone number (and complete Meta's business verification if asked).
- **Cost:** Meta charges for business-started (template) messages. Check their current pricing for India — a few bookings a day is small.
- **Replies:** people's replies arrive in WhatsApp on that business number; the app doesn't read them yet. When someone confirms, set their status to ✅ Confirmed on the shoot page.
- **Phone numbers** are saved with country code (`+91…`; 10-digit numbers are assumed to be India — `DEFAULT_COUNTRY_CODE` changes this). Numbers must be on WhatsApp.
- Without `WHATSAPP_TEMPLATE` the app sends plain text, which Meta only delivers inside the 24-hour window — fine for testing, not for new contacts.
- No Meta account yet? Set `NOTIFY_WEBHOOK_URL` instead to hand messages to any other sender (Make, Zapier, an SMS gateway), or use the one-tap **WhatsApp** buttons on shoot pages, which open a ready-written message in your own WhatsApp.
