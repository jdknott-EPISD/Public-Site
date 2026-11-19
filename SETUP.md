# Setup guide: from zero to a working church website

This guide walks you through setting up your own copy of this website, step by step. You don't need to be a developer. You'll copy and paste a few commands into a terminal and click through some Google and Facebook settings pages. Plan for an afternoon; the Live Studio parts (step 9) can wait until later.

Throughout this guide:

- `example.org` stands for **your website's address** (for example `yourchurch.org`).
- `your-firebase-project-id` stands for **your Firebase project id** (you'll get it in step 1).
- "Your Church Name" stands for your church's name.

---

## What you need first

- A **Mac or Windows PC** you can install programs on.
- **Node.js 22 or newer**: download the "LTS" installer from nodejs.org and run it. To check, open a terminal and run `node --version`.
  - On a Mac, the terminal is the **Terminal** app (press ⌘ Space, type `Terminal`).
  - On Windows, use **PowerShell** or **Command Prompt**.
- A **Google account** for the church (it will own the Firebase project). A shared church account is better than someone's personal one.
- The **Firebase command-line tools**. In the terminal, run:
  ```sh
  npm install -g firebase-tools
  firebase login
  ```
  `firebase login` opens a browser; sign in with the church Google account.
- Optional, for later: a domain name (step 8), a YouTube channel and a Facebook Page (step 9).

---

## 1. Create the Firebase project

1. Go to **console.firebase.google.com** and click **Create a project** (or **Add project**).
2. Give it a name. Firebase shows a **project id** under the name (for example `yourchurch-website`); write it down. That's your `your-firebase-project-id`.
3. Google Analytics is not needed; you can turn it off.
4. When the project is ready, click **Upgrade** (bottom left, next to "Spark plan") and choose the **Blaze** (pay as you go) plan. You'll need to add a payment method.
   - **Why:** Cloud Functions (invites, emails, translation, live streaming) only run on Blaze.
   - **Cost:** Blaze includes the same free allowance as the free plan, and a church's usage normally stays within it, so the bill is usually $0. To be safe, set a **budget alert** (Google Cloud console → Billing → Budgets & alerts), for example at $5.

## 2. Turn on the Firebase services

In the Firebase console for your project:

1. **Authentication** → **Get started** → **Sign-in method** → **Email/Password** → turn on the first switch → **Save**.
2. **Firestore Database** → **Create database**.
   - Choose a **location** close to you (for example a multi-region such as `nam5` in the US). **This can't be changed later.**
   - Choose **Start in production mode**. (Your own security rules are uploaded in step 6.)
3. **Storage** → **Get started** → production mode → same location if offered.
4. **Add a web app:** click the gear icon → **Project settings** → **Your apps** → the **</>** (Web) button. Give it a nickname (e.g. "Website"). You don't need to set up Firebase Hosting here. Firebase then shows a `firebaseConfig` block with `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId` and `appId`. **Copy it somewhere**; you'll paste it in step 4. (You can always find it again under Project settings.)
5. **Translation (for newsletters):** go to **console.cloud.google.com**, make sure your Firebase project is selected at the top, open **APIs & Services → Library**, search for **Cloud Translation API**, and click **Enable**.

## 3. Get the code

Either:

- **With git:** `git clone <the repository address>` and `cd` into the folder, or
- **Without git:** on the repository page click **Code → Download ZIP**, unzip it, and open a terminal in that folder (on a Mac: drag the folder onto the Terminal icon, or type `cd ` and drag the folder into the window).

Then install the code's building blocks (this takes a few minutes):

```sh
npm --prefix app install
npm --prefix functions install
```

## 4. Put in your church's details

Open the folder in a text editor (Visual Studio Code is free and works well). Every spot to change is marked `EDIT` or uses a placeholder like `example.org`, `your-firebase-project-id` or `Your Church`. A project-wide search for those words finds them all.

| File | What to change |
|---|---|
| `app/src/firebase/config.js` | Replace the `firebaseConfig` values with the ones you copied in step 2. Set `SITE_URL` (your website address, no slash at the end), `CHURCH_NAME`, `CHURCH_SHORT_NAME`, `CHURCH_NAME_ES` (Spanish name) and `CHURCH_LOCATION` (e.g. "Your City, ST"). |
| `public/js/main.js` | At the top: `FIREBASE_PROJECT_ID`, `FIREBASE_API_KEY` (the `apiKey` from step 2; it's meant to be public), `YOUTUBE_CHANNEL_ID` (starts with "UC"; YouTube Studio → Settings → Channel → Advanced settings), `FACEBOOK_URL` (your Page's address). |
| `public/stream-helper/helper.mjs` | The list of allowed websites: `https://example.org`, `https://www.example.org`, `https://your-firebase-project-id.web.app`, `https://your-firebase-project-id.firebaseapp.com`. Replace with your addresses. |
| `public/stream-helper/install.sh` | `SITE` (your website address) and the two example `curl` lines at the top. |
| `functions/src/siteConfig.ts` | `SITE_URL`, `FIREBASE_PROJECT_ID`, `CHURCH_NAME`, and `TIME_ZONE` (for example `America/New_York`, `America/Chicago`, `America/Denver`, `America/Los_Angeles`). Check `ALLOWED_ORIGINS` if your site doesn't use "www.". |
| `.firebaserc` | Replace `your-firebase-project-id` with your project id. |
| `public/index.html` | The public page: church name, service times, address, phone, map, links to YouTube/Facebook/giving, and all text. Every sentence is written twice, English and Spanish: `<span class="en">…</span><span class="es">…</span>`. Change both. |
| `public/privacy.html` | Church name, contact email and address, and read through the policy text. YouTube and Facebook require a privacy policy page. |
| `public/images/` | Replace `logo.png` (your logo) and `hero-church.jpg` (the big photo at the top of the home page) with your own, keeping the same file names. |

Until you have your own domain (step 8), you can use `https://your-firebase-project-id.web.app` as the site address.

## 5. Email notifications (optional)

The site can email owners when someone fills in a newsletter form or RSVPs, and send a confirmation copy to the person. Without this step everything still works; responses just appear in the dashboard instead.

1. Use a Gmail account for the church (a separate one just for sending is fine).
2. Turn on **2-Step Verification** for that account (myaccount.google.com → Security).
3. Create an **app password**: myaccount.google.com → Security → 2-Step Verification → **App passwords** (or search "App passwords" in the account settings). Name it "Church website". Google shows a 16-letter password.
4. Create a file named `.env` inside the `functions` folder (`functions/.env`) with:
   ```
   GMAIL_USER=your.church.account@gmail.com
   GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
   ```

`functions/.env` is never uploaded to GitHub (it's listed in `.gitignore`). See step 10 about keeping a copy.

## 6. First deploy

In the terminal, in the project folder:

```sh
firebase deploy --only firestore:rules,storage,functions,hosting
```

- The hosting step builds the members app automatically first.
- The first deploy can take 5–10 minutes. If Firebase asks to enable some Google APIs (Cloud Functions, Cloud Build, Artifact Registry, Eventarc…), answer yes. If it fails on the first try while APIs are still turning on, wait a minute and run it again.
- When it finishes it prints your **Hosting URL**: `https://your-firebase-project-id.web.app`. Open it to see your site.

**If image uploads fail later with a "permission" error:** the Storage rules check the database to see who's a member, and Storage needs permission to do that. In the Google Cloud console → **IAM & Admin → IAM**, tick **Include Google-provided role grants**, find the account named like `service-<number>@gcp-sa-firebasestorage.iam.gserviceaccount.com`, click the pencil, **Add another role**, choose **Firebase Rules Firestore Service Agent**, and save. (Usually Firebase offers to do this during the deploy; if it didn't, do it by hand.)

## 7. Create the first owner account

Accounts are by invitation only, so the very first owner is created with a script:

```sh
node scripts/create-owner-invite.mjs "Full Name" person@example.org
```

It uses your `firebase login`, reads the project id from `.firebaserc` and the site address from `functions/src/siteConfig.ts`, and prints an invite link. Open the link, set a password, and you're in the dashboard at `/admin`. From now on, owners invite everyone else from **Members** in the dashboard. (The link works once and expires after 14 days; run the script again if needed.)

## 8. Your own domain

1. In the Firebase console → **Hosting** → **Add custom domain**. Enter your domain (e.g. `example.org`), and add `www.example.org` too (Firebase can redirect one to the other).
2. Firebase shows DNS records (usually **A** records, and a **TXT** record to prove you own the domain). Log in where you bought the domain (your domain registrar), open its **DNS** settings, and add exactly those records. Remove any old A records for the same name that point elsewhere.
3. Wait. DNS changes and the security certificate can take from a few minutes to 24 hours. Firebase shows "Connected" when it's done.
4. In Firebase → **Authentication → Settings → Authorized domains**, add `example.org` and `www.example.org`.
5. If you used the `.web.app` address in step 4, change `SITE_URL` (and the other site-address spots listed there) to your domain and deploy again:
   ```sh
   firebase deploy --only functions,hosting
   ```

## 9. Live Studio (streaming)

Live Studio is at `/admin/live`. It streams to YouTube, Facebook and other services at the same time, for free.

### 9a. The streaming computer

Set up the Mac that will run the streams by following [STREAMING_COMPUTER_SETUP.md](STREAMING_COMPUTER_SETUP.md). In short, it installs the free **Church Stream Helper**:

```
curl -fsSL https://example.org/stream-helper/install.sh | bash
```

You can do this any time; the connections below are stored on the server and work from any computer.

### 9b. YouTube automatic setup (recommended)

With YouTube connected, **GO LIVE** creates the YouTube broadcast by itself every time (title, public or unlisted, starts and stops automatically). One-time setup, in **console.cloud.google.com** with your Firebase project selected:

1. **APIs & Services → Library**: search **YouTube Data API v3** and click **Enable**.
2. Open **Google Auth Platform** (also called "OAuth consent screen"):
   - **Branding:** app name (e.g. "Your Church Live Studio"), support email, **App home page** `https://example.org`, **Privacy policy** `https://example.org/privacy.html`, developer contact email. **Don't upload a logo**: a logo triggers Google's brand verification, which can take weeks.
   - **Audience:** **External**. Then click **Publish app** (status "In production"). Left in "Testing", the YouTube connection expires every 7 days.
   - **Data Access:** **Add or remove scopes** → add `https://www.googleapis.com/auth/youtube` → **Update** → **Save**.
   - **Clients:** **Create client** → type **Web application** → under **Authorized redirect URIs** add `https://example.org/youtube-callback` (your domain) → **Create**. Copy the **Client ID** and **Client secret**.
3. Add them to `functions/.env`:
   ```
   YOUTUBE_CLIENT_ID=....apps.googleusercontent.com
   YOUTUBE_CLIENT_SECRET=...
   ```
4. Deploy the functions: `firebase deploy --only functions`.
5. In Live Studio → **Channels** → **Connect YouTube**, sign in with the Google account that owns the church's YouTube channel. Google shows a "Google hasn't verified this app" notice: click **Advanced** → **Go to … (unsafe)** → allow. (This is your own app; verification isn't needed for a church's own use.)

### 9c. Facebook automatic setup

With Facebook connected, GO LIVE creates the Page's live video itself, instead of someone clicking "Go live" in Facebook's Live Producer each time.

1. Go to **developers.facebook.com** signed in as an **admin of the church's Facebook Page**, and register as a developer if asked.
2. **My Apps → Create app**. Choose the **Business** type (or the "Other" → "Business" path, depending on what Meta shows), and give it a name.
3. Add the product **Facebook Login for Business**.
   - In its **Settings**, under **Valid OAuth Redirect URIs**, add `https://example.org/facebook-callback` and save.
   - In **Configurations**, **Create configuration**: choose **User access token**, asset type **Pages**, and the permissions `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `publish_video`, `pages_read_user_content`, `pages_manage_engagement` (the last two let the studio show and answer Facebook comments). Save, and copy the **Configuration ID**.
4. **App settings → Basic**: add **App domains** `example.org`, the **Privacy policy URL** `https://example.org/privacy.html`, and save. Copy the **App ID** and **App secret** (click Show).
5. **Leave the app in Development mode.** Its own admins (the people who manage the Page) can use it, which is all you need. No app review is required.
6. Add to `functions/.env`:
   ```
   FACEBOOK_APP_ID=...
   FACEBOOK_APP_SECRET=...
   FACEBOOK_CONFIG_ID=...
   ```
7. Deploy the functions (`firebase deploy --only functions`), then in Live Studio → **Channels** → **Connect Facebook**, and choose the church Page if asked.

### 9d. Stream keys instead (the fallback)

If you'd rather not connect YouTube or Facebook (or for Twitch and other services), add a channel with a **stream key** under **Channels → Add channel**. Find the key in YouTube Studio → Go live → Stream, or Facebook Live Producer → Streaming software. Keys are write-only: once saved, nobody can read them back in the dashboard. With a Facebook stream key, someone has to click **Go live** in Live Producer each time; with a YouTube key, make sure a broadcast is scheduled or set to auto-start.

## 10. Keep `functions/.env` safe

`functions/.env` holds your email password and the YouTube and Facebook app secrets. It's deliberately **not** uploaded to GitHub, so:

- **Keep a backup copy** somewhere private (a password manager is ideal).
- Anyone deploying the functions from another computer needs this file in their `functions` folder; deploying without it turns those features off.

## 11. Troubleshooting

- **I deployed but don't see my changes:** do a hard refresh (⌘⇧R on a Mac, Ctrl+Shift+R on Windows), or open the site in a private window.
- **Changes to `css/styles.css` or `js/main.js` don't show for visitors:** browsers keep these files for a while. In `public/index.html`, each one is loaded with a `?v=` value (for example `styles.css?v=2026-01-01`). Change that value whenever you change the file, then deploy.
- **"Permission denied" / "Missing or insufficient permissions" right after signing in or after a deploy:** reload the page; if you just accepted an invite, sign out and in again. For image uploads, see the note in step 6.
- **The first deploy failed:** run it again after a minute (Google APIs can take a moment to turn on). Make sure the project is on the Blaze plan.
- **Invite links point to the wrong address:** check `SITE_URL` in `app/src/firebase/config.js` and `functions/src/siteConfig.ts`, then deploy.
- **YouTube or Facebook "Connect" fails with a redirect error:** the redirect URI must match exactly, `https://example.org/youtube-callback` or `https://example.org/facebook-callback` with your domain, and match `SITE_URL` in `functions/src/siteConfig.ts`.
- **Live Studio problems on the streaming computer:** see the Troubleshooting table in [STREAMING_COMPUTER_SETUP.md](STREAMING_COMPUTER_SETUP.md).
