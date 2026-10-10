# Phone as push-to-talk

The computer that is in the game keeps the microphone. The phone only holds a button.

On the radio page, **Set up push to talk** then **For the security conscious** asks the API for a data-only LiveKit room and a one-time code. The code is 32 random bytes. A QR code points at this same site, for example `https://tubss2.github.io/radio-net/#/p/<code>?api=<server>&exp=<ms>`. The computer shows a countdown. The code expires in two minutes and works once. The phone uses that `api` value only when it is the Sydney origin or localhost. Any other host is ignored, so a rewritten link cannot collect the code. Redeeming it returns a two-hour data token for that visit. It does not return the computer's session token, and the phone cannot publish a microphone. Closing the phone dialog disconnects that visit, which drops the button.

The phone page does not redeem the code until the person taps **Connect**. That button is the large primary action. **Hold to talk** stays grey and reads **Tap Connect first** until the phone has joined. Opening or forwarding the link is not enough. The same page shows the two-minute clock from `exp`. After Connect the hold button fills most of the screen. The phone asks the computer for its radio (a sync message the already-installed desktop answers) until a snapshot arrives, and the computer also sends the radio when the phone joins and about once a second while the dialog is open. The first tuned channel that can transmit is the talk channel. The page asks for a screen wake lock on that Connect tap, vibrates where the browser allows it, and blocks the long-press callout on the button. It offers **Add to Home Screen** when the browser fires the install prompt. Holding the button sends a LiveKit data message. The button turns red and reads **TRANSMITTING on 60.0** only after the computer has unmuted the microphone and said so. The computer shows a red border and a transmitting banner for every push-to-talk source, and plays the squelch. Letting go mutes the mic. If the phone stops repeating the hold (about 1.5 seconds), the computer releases.

The voice rooms still have data publishing off. Phone control uses a separate room, `g<community>.phone.<session>`.

## Try it locally

```bash
cd spike/server && npm start
cd spike/client && VITE_API_URL=http://127.0.0.1:8787 npm run web
```

Open the radio, choose **Set up push to talk**, then the phone option, and scan the QR (or open the link on the phone). On the phone, tap **Connect**. The dev invite for the seeded community is `DEVN-ET01`. The voice server has to be running or the page says the code is ready and push-to-talk starts when that server is reachable.

## What Sydney needs

These routes are in the repo. The live API does not have them until that build is deployed and `radionet-api` is restarted:

- `POST /api/communities/:cid/radio/phone-host` (session)
- `POST /api/communities/:cid/radio/phone-pair` (session)
- `POST /api/phone/redeem` (the one-time code, no session)

The same restart applies the CORS allowlist (`https://tubss2.github.io`, localhost, and a missing origin for the desktop app). LiveKit already allows data on the signal connection. No new firewall port is required for the phone.
