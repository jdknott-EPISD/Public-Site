# Setting up the streaming computer for Live Studio

This guide is for setting up the Mac at your church that will run Sunday live streams. It's written so that Claude (or a person) can read it and walk someone through it step by step.

**Note for Claude:** walk the person through one step at a time, and wait for them to confirm each step (or send a screenshot) before going on. Most steps happen in Chrome and in System Settings, not in code. Read the "Don't do" list before starting.

---

## Before you start

This guide assumes the website is already set up and deployed (see [SETUP.md](SETUP.md)), and that an admin has connected YouTube/Facebook under **Live Studio → Channels → Automatic setup** (or added channels with stream keys). Those connections, channels, scenes, graphics, lower thirds, ticker and QR codes are stored on the server, so they work from any computer and will already be there. Don't connect them again from this computer.

What this computer needs:

1. Chrome, signed in to the members area.
2. The **Church Stream Helper**: a small free program that sends the stream out. This is the main step.
3. macOS permissions for the camera, microphone and screen sharing.
4. Settings so the Mac doesn't fall asleep while streaming.

You don't need this git repository, Node.js, or the Firebase tools on this computer. The helper installer brings everything it needs.

---

## What you need

- The church Mac (Apple Silicon or Intel, either works), with **Google Chrome** installed. Safari doesn't work for the studio.
- A members-area login for your website (invitation only; an owner can send one from **Members** in the dashboard).
- The camera and microphone (or sound board USB input) plugged in.
- Wired internet if possible. Upload speed should be at least **10 Mbps**, because streaming to YouTube and Facebook together uses about 8 Mbps. Check at speedtest.net, or run `networkQuality` in Terminal.

---

## Step 1: Sign in

1. Open **Chrome** and go to `https://example.org/login` (your website's address).
2. Sign in with your member email and password.
3. On the dashboard, click the **Live Studio** tile.

## Step 2: Choose "Streaming computer"

At the top center of the studio, click **Streaming computer**. Chrome remembers this choice on this computer.

(**Co-host** is for a second computer, such as a laptop, that only switches scenes and captions while this Mac streams.)

## Step 3: Allow the camera and microphone

1. Chrome asks to use the camera and microphone. Click **Allow** for both.
2. If the preview stays dark, or Chrome never asked:
   - Click the icon left of the address bar, then **Site settings**, and set **Camera** and **Microphone** to **Allow**.
   - Open macOS **System Settings → Privacy & Security → Camera**, and switch **Google Chrome** on. Do the same under **Microphone**. Chrome may need to be quit and reopened.

## Step 4: Install the stream helper

1. In the studio, a gold bar says "To go live from this computer, set up the free stream helper". Click **Set up**. (If there's no gold bar and the top right says **Stream helper ready**, skip to Step 5.)
2. The window shows one line. Click **Copy**. The line is:
   ```
   curl -fsSL https://example.org/stream-helper/install.sh | bash
   ```
3. Open **Terminal**: press ⌘ Space, type `Terminal`, press Return.
4. Paste the line and press Return. It downloads Node.js and ffmpeg (fixed versions, checked against known checksums) into `~/Library/Application Support/Church Stream Helper`. It needs no administrator password and takes a minute or two.
5. Wait for:
   ```
   ==> The Church Stream Helper is running.
   ```
   It now starts by itself every time this Mac starts or someone logs in.
6. Back in Chrome, reload the studio (⌘⇧R). If Chrome asks to allow the site to access **apps and services on this device** or the **local network**, click **Allow**. The top right should now say **Stream helper ready** (green).

**Check (for Claude):** in Terminal, this should print `"ok":true` and `"version":"1.2.0"` (or newer):
```
curl -s http://127.0.0.1:51735/status
```

## Step 5: Allow screen sharing (for slides, videos, song lyrics)

1. In the studio, click the **screen** button (the third round button under the preview) and choose a window, screen or Chrome tab.
2. If macOS blocks it, open **System Settings → Privacy & Security → Screen & System Audio Recording**, switch **Google Chrome** on, then quit and reopen Chrome.
3. To include a video's sound when sharing a Chrome tab, tick **Also share tab audio** in Chrome's share window.

## Step 6: Choose the camera and microphone

Click the **gear** button under the preview, then:

- **Camera:** the church camera.
- **Microphone:** the sound board's USB input, if there is one, otherwise the microphone. The green level bar on the mic button should move when someone speaks.

## Step 7: Check the channels

Open **Channels** (the right-hand panel). You should see:

- **Automatic setup:** YouTube **Connected** (your channel) and Facebook **Connected** (your church Page), if an admin connected them.
- Your YouTube and Facebook channels (`YouTube · automatic`, `Facebook · automatic`, or stream-key channels), ticked.

If either says **Not connected**, stop. Whoever manages the church's YouTube and Facebook needs to reconnect it, with the same Google or Facebook account used the first time. It doesn't have to happen on this computer.

## Step 8: Keep the Mac awake

Open **System Settings**:

- **Lock Screen:** set "Turn display off when inactive" to **Never**, or at least 3 hours.
- **Energy** (or **Battery → Options** on a laptop): turn on **Prevent automatic sleeping when the display is off**.

If the Mac sleeps, the stream stops within about 15 seconds.

## Step 9: Do a test stream

1. In **Channels**, set **Who can watch** to **Unlisted (tests)**. YouTube will show it only to people with the link, and Facebook will keep it as a private preview only Page admins see. It won't appear on the website.
2. Click **GO LIVE** (top right).
3. Within a few seconds, **Open on YouTube** and **Open on Facebook** links appear under Channels. Open both. The video should be playing within about 20–30 seconds.
4. Next to each channel the studio shows **Live**. If one shows **Reconnecting** or **Failed**, see Troubleshooting.
5. Click **End stream**. Both broadcasts end by themselves.
6. Set **Who can watch** back to **Public** for real services.

---

## Every Sunday

1. Open Chrome, then the dashboard, then **Live Studio**. The helper is already running.
2. Check the **Title** under Channels, and that **Who can watch** is **Public**.
3. Before the service, click the **Countdown** or **Welcome** scene.
4. Click **GO LIVE**. YouTube and Facebook both go live, and the home page of your website shows the player within a minute.
5. Click the **Live** scene when the service starts. Use lower thirds, the ticker and QR codes as needed.
6. Keep the studio tab open. Closing it ends the stream.
7. Afterwards, click the **Thank you** scene, then **End stream**.

A **Co-host** can run scenes and captions from a laptop: open Live Studio there, choose **Co-host**, and leave this Mac as the **Streaming computer**.

---

## Troubleshooting

| What you see | What to do |
|---|---|
| Gold bar "set up the free stream helper", even though it's installed | Chrome is probably blocking it. Click the icon left of the address bar, then **Site settings**, and allow **Local network** / apps and services on this device. Then reload. If that doesn't help, run the setup line from Step 4 again. |
| Gold bar "A newer stream helper is available" | Click **Update** and run the line it shows. It updates in place. |
| "The studio stopped sending video…" | The tab was closed, the Mac slept, or Chrome froze. Reload the studio and click GO LIVE again. |
| A channel shows **Reconnecting** | That site isn't taking the video fast enough. The other channel keeps going. If it lasts more than a minute, check the internet upload speed. |
| A YouTube or Facebook error mentioning permissions or expired access | The connection needs renewing. Someone with the church Google or Facebook account clicks **Disconnect**, then **Connect** again under Channels → Automatic setup. |
| Preview is black | Check Step 3 (camera permissions) and the camera choice in the gear settings. |

**Helper log**, for Claude to read if something goes wrong. Stream keys are hidden in it:
```
tail -50 ~/Library/Application\ Support/Church\ Stream\ Helper/helper.log
```

**Reinstall or update the helper:** run the Step 4 line again.

**Remove the helper:**
```
curl -fsSL https://example.org/stream-helper/install.sh | bash -s -- --uninstall
```

---

## Don't do (notes for Claude)

- **Don't click Disconnect** on YouTube or Facebook under Automatic setup, or reconnect them, unless they say Not connected or show an access error. They're shared by every computer.
- **Don't click "Reset"** next to the stream key in YouTube Studio or Facebook Live Producer, and don't delete the YouTube stream key named **"Your Church Name Live Studio"** (your church's name followed by "Live Studio"). The studio uses it.
- **Don't delete** the YouTube or Facebook channels in the studio.
- **Don't deploy** from this computer. Deploying needs `functions/.env`, which holds the YouTube and Facebook app secrets and is kept off GitHub on purpose. Website changes are made from the computer that has that file.
- **Don't install other streaming services** (Restream, LiveKit, OBS plugins). The studio doesn't need them.
- How it works, if needed: README.md, section "Live Studio"; the helper's code is in `public/stream-helper/`.
