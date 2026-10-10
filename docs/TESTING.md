# Radio Net tester guide

Thanks for helping test Radio Net. It's a group radio for WARDOGS. You can listen to several channels at once (for example Command, Artillery and Logistics) and pick the one you talk on, a bit like the radios in Arma Reforger. There are no accounts. You pick a callsign and join with an invite code.

## Before you start

- Get the **invite code** from Tobias. That's all you need to join. (Tobias copies it from the **Invite code** card with **Copy invite**.)
- Use Chrome or Edge on your PC if you can.
- The server may be switched off between test sessions. If you can't join, ping Tobias before anything else.

## 1. Join on the web app (start here)

Nothing to install.

1. Open [Radio Net](https://tubss2.github.io/radio-net/).
2. Type your callsign. This is the name others see when you talk.
3. Enter the invite code from Tobias.
4. Allow the microphone when the browser asks.
5. Tune the channels you want to hear.
6. Pick the one channel you want to transmit on.

Good to know:

- Your session lasts 12 hours. After that, enter the invite code again.
- If the page looks out of date, press **Ctrl+F5** to hard-refresh. The site can be cached for about 10 minutes after an update.

## 2. Choose how you talk

Click the big **Set up push to talk** button. It lists four options, ranked from safest to least safe. Pick the first one that works for you.

| Option | What it is | Good for |
|---|---|---|
| 1. Browser only | Talk from the browser tab | Trying it out, or voice activation |
| 2. Phone activation | Your phone becomes the talk button | Playing a game, nothing to download |
| 3. Helper app | Small Windows window that watches a few keys | Playing a game with a key on your keyboard or mouse |
| 4. Full app experience | The Windows desktop app with overlay | Only if you know and trust Tobias (see section 6) |

### Option 1: Browser only

- Hold **Space**, or hold the big talk button, to talk. Let go to stop.
- Push to talk only works while the browser window is in front, so you'd have to alt-tab out of the game.
- Or switch to **voice activation**, so you don't need to hold anything.

## 3. Phone activation

Your phone is only a button. The microphone stays on your PC.

1. On your PC, click **Set up push to talk**, then **Phone activation**.
2. Scan the QR code with your phone. The code works once and runs out after 2 minutes. Both screens show the countdown. If it runs out, click **New code**.
3. On your phone, tap the big **Connect** button. Until you do, the hold button is grey and says **Tap Connect first**.
4. Your phone shows the channel you're transmitting on.
5. Hold the big button on your phone to talk. Let go to stop.

When you're actually on air:

- Your phone turns red and says **TRANSMITTING on** the frequency (for example **TRANSMITTING on 60.0**).
- Your PC shows a red edge, a **Transmitting** banner, and plays a squelch sound.

If your phone doesn't turn red, people can't hear you yet. The phone may vibrate when you press, but vibration may not work on iPhone Safari.

## 4. Helper app (Windows)

A small window that lets you talk with a key while the game is in front. It has no tray icon, doesn't start with Windows, and quits when you close its window. Minimising it is fine; it keeps working.

1. Download [RadioNetHelper.exe](https://github.com/Tubss2/radio-net/releases/download/helper-5/RadioNetHelper.exe).
2. Open it. Windows will show a blue "Windows protected your PC" box because it isn't signed yet. Click **More info**, then **Run anyway**.
3. The window is a short wide bar. It says **Disconnected**, shows the pairing code, and has **Copy** next to the code.
4. On the site, click **Set up push to talk**, then **Helper app**. Copy the code from the helper (or select it) and paste it in.
5. The site shows **Looking**, then **Helper found**, then **Connected**. The helper dot turns green and says **Connected**. The code is replaced by **Linked** and **Unlink**.

Default keys:

| Key | Does |
|---|---|
| F1 | Talk (hold) |
| F3 | Previous channel |
| F4 | Next channel |

- To change a key, click **Set** on that bind and press the key you want.
- Each bind has a red light that comes on while you hold that key. Use it to check your keys work, even before linking.
- To disconnect the browser, click **Unlink** in the helper window. Your keys are kept.
- Next time, keep the helper window open and the site reconnects by itself.

What it does and doesn't do: it only tells the Radio Net page on your PC "talk on", "talk off", "next channel" or "previous channel". It never sends which key you pressed, and it can't access your microphone.

This works in Chrome or Edge. If your browser won't connect to it, use the phone instead.

## 5. Anti-cheat warning

We haven't had confirmation yet from WARDOGS' anti-cheat team (Bulkhead) that these tools are OK. **In real WARDOGS matches, use the phone or the web app.** The helper reads keys with standard Windows Raw Input rather than a keyboard hook, but that hasn't been confirmed safe either. Wait for Tobias to say otherwise before using the helper or desktop app in a real match.

## 6. Desktop app (only if you know and trust Tobias)

The site labels this "Still heavily WIP". It adds an in-game overlay and the channel wheel. Only use it if you know and trust the developer personally.

1. Go to the [v0.4.5 release page](https://github.com/Tubss2/radio-net/releases/tag/v0.4.5) and download `RadioNet-Setup-0.4.5.exe`. That release is the desktop app. The helper is a different file: [RadioNetHelper.exe](https://github.com/Tubss2/radio-net/releases/download/helper-5/RadioNetHelper.exe).
2. Run it. On the blue SmartScreen box, click **More info**, then **Run anyway**.
3. Enter your callsign, then the invite code.
4. Accept the privacy note. The keyboard listener stays off until you do.
5. Check or change your keys in keybind settings.

Default keys (the same talk and channel keys as the helper, plus the wheel and the overlay):

| Key | Does |
|---|---|
| F1 | Talk (hold) |
| F2 | Open the channel wheel |
| F3 | Previous transmit channel |
| F4 | Next transmit channel |
| F5 | Hide or show the overlay |

If you already changed your keys, those stay. If you never changed the keys that came with an older build, they switch to this table the next time you open the app.

- On the wheel: hold or press F2. Hover a channel and left-click to transmit there, right-click to mute it, scroll to change frequency, Shift+scroll for volume, and **+** to add a channel you haven't tuned yet. Hold F2 and press 1–9 if the game keeps keyboard focus.
- Updates: the app asks before it downloads an update. Then click **Restart now** or **Later**.
- **Set up push to talk** (the four choices) is on the website. This installer does not include that chooser. While you are talking, the app shows a red transmitting banner with the channel.
- Quit the app when you're done playing. Its keyboard listener stops when the app closes.

## Known issues

- The helper and the desktop app aren't signed yet, so Windows shows the SmartScreen warning.
- The helper window hasn't been run on a real Windows PC yet. You're the first test, so tell us exactly what you see.
- Vibration on the phone button may not work on iPhone Safari.
- Sessions end after 12 hours. Enter the invite code again.
- The server may be off between test sessions. If joining fails, ping Tobias first.

## What to report

After a session, send a quick note with:

- Which talk option you used: 1 Browser only, 2 Phone, 3 Helper, or 4 Desktop app (and the version if desktop; it's shown in keybind settings).
- Your browser, and your phone model if you used the phone.
- Whether you could join with the invite code first try.
- Whether people heard you clearly, and whether you heard them. Note any cut-outs, echo, robot voice or lag.
- Whether the red "transmitting" signs (phone, PC banner, helper light) matched when people could actually hear you.
- Whether push-to-talk ever got stuck on, or didn't work when you pressed it.
- Anything confusing. If you got stuck, tell us the step and what you saw on screen.
- A screenshot if something looks wrong.

Where to send it: post in the testers' Discord channel or DM Tobias directly.
