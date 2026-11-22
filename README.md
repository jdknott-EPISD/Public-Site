# Church Website Template

A free, open-source website for a church: a bilingual (English/Español) public site, an invitation-only members area, a newsletter builder, and **Live Studio**, a browser-based studio that streams to YouTube, Facebook and other channels at the same time, with no subscription.

**New here? Follow [SETUP.md](SETUP.md)** for a complete, step-by-step guide from zero to a working site (written for volunteers, not just developers).

## What's included

- **Public website** (`public/`): a responsive single page in English and Spanish (an EN/ES button switches languages and remembers the choice), service times, location, events calendar, and a "Watch live" band that turns into the YouTube player automatically when you go live.
- **Members area** (`app/`, at `/login`): accounts are by invitation only.
  - **Owners** invite people and can remove access.
  - **Admins** (everyone invited) add calendar events, edit the church's newsletters, view form responses and RSVPs, and manage the church's public share page.
- **Newsletter builder**: shared newsletters with sections, custom forms, RSVPs and polls, automatic Spanish/English translation (Google Cloud Translation), and optional email notifications.
- **Live Studio** (`/admin/live`): multistreaming much like Restream Studio:
  - Camera, microphone, **screen sharing**, and several layouts (camera only, screen only, screen with the camera in a corner, side by side, …) with box position, size and style options.
  - **Scenes**: a countdown before the service, title cards (Welcome, Thank you), the live camera and screen.
  - **Graphics**: logo, overlay and background; **captions**: lower thirds and a scrolling ticker; **QR codes** (for example your giving page).
  - **Chat**: YouTube live chat and Facebook comments together; reply as the church on either, and show a message on the stream.
  - **Video clips** (intros, outros, announcements) played full screen with sound, **Media scenes** that play an intro or outro and then move on, and **music** from the computer or soft instrumental music made in the browser.
  - **Phone camera**: scan a QR code with a phone and its camera (and, if you like, its microphone) becomes a second camera, straight to the streaming computer. Show it with the webcam, with a shared screen, or all three at once; the studio can mute the phone's mic on its own.
  - **Record to the computer**: GO LIVE asks whether to save an MP4 recording; with no channels ticked it only records.
  - **Lower third styles** (Classic, Cream & serif, Navy & gold, Teal tech, Clean slate) with optional matching frames, **animated GIF overlays**, and **moving (video) backgrounds**.
  - **Co-host**: a second computer switches scenes, layouts, graphics and captions while the streaming computer sends the video.
  - **Automatic YouTube/Facebook setup**: once connected, GO LIVE creates the YouTube broadcast and the Facebook live video itself. Plain stream keys (any RTMP service, such as Twitch) work too.

## No subscription

A browser can't send video to YouTube or Facebook on its own, so the streaming computer runs the free **Church Stream Helper** (`public/stream-helper/`). The studio passes it the finished picture and sound, and the helper uses **ffmpeg** on that computer to encode them once and send a copy to every chosen channel. The video never goes through Firebase or a paid service. The `liveStream` Cloud Function only hands the stream keys to the streaming computer at GO LIVE and keeps track of what's on air.

Firebase needs the pay-as-you-go **Blaze** plan for Cloud Functions, but a church's usage normally stays within the free allowance. (You can set a budget alert in Google Cloud.)

## Tech stack

- Public site: plain HTML, CSS and JavaScript (no build step)
- Members area: React + Vite + Tailwind CSS
- Firebase: Hosting, Authentication (email/password), Cloud Firestore, Cloud Storage, Cloud Functions (Node.js 22, TypeScript)
- Google Cloud Translation API (newsletter translation), YouTube Data API v3, Facebook Graph API
- Nodemailer with a Gmail app password (optional emails)
- Stream helper: Node.js + ffmpeg, installed per user on a Mac (no administrator password)

## Structure

```
public/                 The public website (plain HTML/CSS/JS)
  index.html            Page content (all sections, both languages)
  privacy.html          Privacy policy (needed for the YouTube/Facebook apps)
  css/styles.css        Styles; edit the color tokens in :root to rebrand
  js/main.js            EN/ES toggle, mobile menu, events calendar, live band
  js/events.js          Fixed calendar events (usually left empty)
  images/               Logo and hero photo
  stream-helper/        Live Studio's stream helper (install.sh, helper.mjs)
  app/                  Built members app (generated on deploy; not in git)
app/                    Members area (React + Vite + Tailwind)
functions/              Cloud Functions: invites, members, newsletter translation, poll tallies,
                        emails, live stream state, YouTube/Facebook setup, live chat, video clips
firestore.rules         Who can read and write which data
storage.rules           Who can upload images and clips
scripts/                create-owner-invite.mjs: creates the first owner's invite link
firebase.json           Firebase settings (hosting, rules, functions)
.firebaserc             Links this folder to your Firebase project
```

Only the `public/` folder goes online.

## Setting it up for your church

The short version (see [SETUP.md](SETUP.md) for every click):

1. **Create a Firebase project** and upgrade it to the **Blaze** plan.
2. In the Firebase console, enable **Authentication** (Email/Password), **Firestore**, and **Storage**, and add a **Web app** to get its config. In Google Cloud, enable the **Cloud Translation API**.
3. **Edit the placeholders** (search for `example.org`, `your-firebase-project-id`, `Your Church` and `EDIT`):

   | File | What to change |
   |---|---|
   | `app/src/firebase/config.js` | Your Firebase web app config, `SITE_URL`, church name (English and Spanish) and location |
   | `public/js/main.js` | `FIREBASE_PROJECT_ID`, `FIREBASE_API_KEY`, `YOUTUBE_CHANNEL_ID`, `FACEBOOK_URL` |
   | `public/stream-helper/helper.mjs` | The allowed origins: your domain (with and without www) and your Firebase hosting addresses |
   | `public/stream-helper/install.sh` | `SITE` (and the example curl lines at the top) |
   | `functions/src/siteConfig.ts` | `SITE_URL`, `FIREBASE_PROJECT_ID`, `CHURCH_NAME`, `TIME_ZONE`, `ALLOWED_ORIGINS` |
   | `.firebaserc` | Your Firebase project id |
   | `public/index.html` | Church name, service times, address, phone, map, links, text in both languages |
   | `public/privacy.html` | Church name, contact details, policy text |
   | `public/images/` | `logo.png` and `hero-church.jpg` |

4. **Secrets** go in `functions/.env` (git-ignored, never committed). All are optional; each feature turns on when its values are present:
   ```
   GMAIL_USER=your.church.account@gmail.com
   GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
   YOUTUBE_CLIENT_ID=....apps.googleusercontent.com
   YOUTUBE_CLIENT_SECRET=...
   FACEBOOK_APP_ID=...
   FACEBOOK_APP_SECRET=...
   FACEBOOK_CONFIG_ID=...
   ```
5. **Install and deploy:**
   ```sh
   npm install -g firebase-tools
   firebase login
   npm --prefix app install
   npm --prefix functions install
   firebase deploy --only firestore:rules,storage,functions,hosting
   ```
   (The hosting step builds the members app first.) Later you can deploy just one part, e.g. `firebase deploy --only hosting` or `--only functions`.
6. **Create the first owner** (nobody can sign in yet to send invites):
   ```sh
   node scripts/create-owner-invite.mjs "Full Name" person@example.org
   ```
   It uses your Firebase CLI login, prints an invite link; open it to set a password. After that, owners invite people from **Members** in the dashboard.

## YouTube automatic setup

YouTube only shows a stream when a "broadcast" is waiting for it. With your channel connected, GO LIVE creates a new broadcast every time (title, description, Public or Unlisted, starts and ends by itself), so nobody has to prepare YouTube Studio. One-time setup in Google Cloud (same project as Firebase):

1. APIs & Services → Library: enable **YouTube Data API v3**.
2. OAuth consent screen (Google Auth Platform): **External**; app name (e.g. "Your Church Live Studio"), support email, home page `https://example.org` and privacy policy `https://example.org/privacy.html`; add the scope `https://www.googleapis.com/auth/youtube`; then **Publish app** (In production). Left in "Testing", the sign-in expires every 7 days. Don't upload a logo (that starts brand verification). At sign-in Google shows an "unverified app" notice: click Advanced → continue.
3. Credentials → **Create OAuth client ID** → Web application, authorized redirect URI `https://example.org/youtube-callback`.
4. Put `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET` in `functions/.env` and run `firebase deploy --only functions`.
5. In Live Studio → **Channels** → **Connect YouTube**, sign in with the Google account that owns the channel.

## Facebook automatic setup

With only a stream key, Facebook holds the video as a preview until someone clicks **Go live** in Live Producer. With your Page connected, GO LIVE creates the Page's live video itself (Public goes live right away; Unlisted is a private preview for tests).

1. At developers.facebook.com (signed in as an admin of the church Page), create an app of type **Business**.
2. Add **Facebook Login for Business**. In its Settings, add the valid OAuth redirect URI `https://example.org/facebook-callback`.
3. Create a **Configuration**: User access token, asset type Pages, permissions `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `publish_video`, `pages_read_user_content`, `pages_manage_engagement` (the last two are for live chat). Copy its configuration id.
4. App settings → Basic: add the app domain (`example.org`) and the privacy policy URL. The app can stay in **Development** mode; its own admins can use it.
5. Put `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` and `FACEBOOK_CONFIG_ID` in `functions/.env`, deploy the functions, then **Connect Facebook** in the studio.

## Using Live Studio

- **Streaming computer:** set it up once with [STREAMING_COMPUTER_SETUP.md](STREAMING_COMPUTER_SETUP.md). In short: run
  ```
  curl -fsSL https://example.org/stream-helper/install.sh | bash
  ```
  in Terminal on the Mac. It installs Node.js and ffmpeg (fixed versions, checked against checksums) into `~/Library/Application Support/Church Stream Helper` and starts the helper at every login. Remove it with `... | bash -s -- --uninstall`.
- Open `/admin/live` in **Google Chrome**, choose **Streaming computer** (or **Co-host** on a second computer), add or tick channels, and press **GO LIVE**. Keep the tab open while live.
- **Upload speed:** about 4 Mbps per channel; YouTube and Facebook together need about 8–10 Mbps.
- **Watch live on the home page:** when you go live, the home page switches within a minute to a "We're live" bar and the YouTube player (Public streams only), and switches back when the stream ends. `/live` goes straight to it.
- **Helper log:** `~/Library/Application Support/Church Stream Helper/helper.log` (stream keys are hidden in it).

## Everyday editing

- **Events:** sign in and use **Calendar** in the dashboard; they appear on the website in both languages.
- **Bilingual text:** every piece of text in `public/index.html` is written twice: `<span class="en">Welcome</span><span class="es">Bienvenidos</span>`. Update both.
- **Styles and scripts:** browsers cache `css/styles.css` and `js/` files. When you change one, change its `?v=` value in `public/index.html` so visitors get the new copy.

## Preview locally

```sh
python3 -m http.server 8000 --directory public            # public site only
cd app && npm run dev                                      # members app against your live data (changes are real)
firebase emulators:start --only auth,firestore,storage,functions
cd app && VITE_USE_FIREBASE_EMULATOR=true npm run dev      # members app against a local copy (needs Java)
```

## License

MIT — see [LICENSE](LICENSE).
