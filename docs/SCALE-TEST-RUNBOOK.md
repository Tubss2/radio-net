# Scale-test runbook

First real group op for Radio Net: a milsim with maybe 30–60 people on voice. The web app at [https://tubss2.github.io/radio-net/](https://tubss2.github.io/radio-net/) is the client. Voice is self-hosted LiveKit on a Vultr Sydney box (plan vc2-1c-2gb: 1 vCPU, 2 GB RAM). API: `https://api.5by5.app`. Voice: `wss://voice.5by5.app`. The IP changes when the VM is replaced; the names do not ([`REDEPLOY.md`](REDEPLOY.md)).

This page is the checklist for that night: what to deploy, what to watch, how to collect evidence afterwards, and what the local load test said about a 1 vCPU box.

## What this change adds

| Piece | Where | Cost |
|---|---|---|
| LiveKit Prometheus | localhost port 6789, user `metrics`, password `METRICS_PASSWORD` | A few MB inside the LiveKit process |
| Prometheus 3.15.0 | `127.0.0.1:9090`, 12 h / 200 MB retention, memory cap 256 MB | About 80 MB resident while idle |
| node_exporter 1.12.1 | `127.0.0.1:9100`, cpu/mem/net/load/filesystem only, memory cap 64 MB | About 20 MB resident |
| Dashboard | `https://api.5by5.app/monitor/` | Static files. No Grafana process |
| Persistent journal | `/var/log/journal`, 200 MB, 7 days | Disk, not RAM |
| Log bundle | `radionet-collect-logs` | One archive after the op |
| Client voice summary | Options → **Send diagnostics** | Opt-in. No audio, no callsign |
| Browser errors | `POST /api/diagnostics/error` | Automatic, redacted, 20 per page load |

Grafana was skipped. It commonly adds another 200 MB, which is the wrong trade on a 2 GB VPS. Netdata’s agent is often 150–250 MB. Prometheus plus the node exporter together sat around 100 MB idle on the measurement box. UFW does not open 6789, 9090, or 9100. The dashboard is HTTP basic auth on the existing API hostname, so it does not ask Let’s Encrypt for a third certificate.

## Capacity estimate

Measured on 14 Oct 2026 against LiveKit v1.13.9 on this development VM (4 CPU, 15 GB RAM), with the LiveKit process pinned to one core (`taskset -c 0`). Memory was **not** capped, so this is not an out-of-memory test of the 2 GB plan. Packet loss was 0% on localhost. A real player in New Zealand sees about 30–35 ms to Sydney, and real networks drop packets. `lk load-test` publishes continuous audio. Push-to-talk with a muted track is lighter than that. The script does not exercise API join, invite checks, or the browser radio filter.

| Shape | Peers | Result on one core |
|---|---|---|
| Op-like: 4 nets, 2 talkers and 12 listeners each, 12 people listening to all four | about 104 connections, about 68 people | 0% loss, every published track subscribed. CPU about 12% average, 27% peak. Fresh LiveKit RSS about 200–250 MB |
| Heavier: 4 nets, 4 talkers and 40 listeners each, 15 multi-net | about 236 connections | 0% loss, 160/160 tracks. CPU about 35% average, 52% peak |
| Stress: 4 nets, 8 talkers and 60 listeners each, 15 multi-net (32 people talking at once) | about 332 connections | 0% loss on tracks that flowed, but only 360 of 480 expected tracks attached within 45 s. CPU peak 72%. RSS climbed toward 900 MB and kept rising |

Read that as: the planned op fits on 1 vCPU with headroom if only a few people talk at once. Sixteen simultaneous talkers still looked clean. Thirty-two simultaneous talkers, or a long RSS climb after a spike, is past comfortable on 2 GB once you also count the OS, the API, Caddy, and about 100 MB for Prometheus and the node exporter.

The web client publishes a muted microphone on each net the player can talk on, so a real op has a few more peer connections than the listener-only side of this test. Multi-net in the test is one extra subscriber process per room, which matches the web app (one LiveKit room per tuned channel).

## Decisions still open

1. **Stay on vc2-1c-2gb, or resize for the night.** The op-shaped test fits. A resize to the next Vultr plan (2 vCPU / 4 GB) is the cheap insurance if many people talk at once or a few players are on bad links. Shrink it again after the op. Vultr resizes need a reboot.
2. **TURN stays off.** Players on cellular or strict NAT may fail to connect. Enabling TURN relays media through the same small CPU. Do that only if the first failures are “cannot connect”, and not on the night if CPU is already high.
3. **Ask players to click Send diagnostics** if voice sounds bad. The leave-the-page checkbox starts off. Script errors upload on their own.
4. **Desktop installs older than 0.4.11 still call the old sslip names.** 0.4.11 and the web app use `api.5by5.app` and `voice.5by5.app`. GitHub Pages updates the web app when `main` updates.

## Deploy from the Windows PC

SSH to the VPS is not reachable from the cloud agent. The owner runs this on the PC that already has the deploy key. `deploy.ps1` reads the tarball and the key from `%USERPROFILE%\radio-net-deploy`, not from the git checkout.

```powershell
cd C:\path\to\radio-net
git pull origin main
bash deploy/pack.sh
Copy-Item deploy\radionet-src.tgz "$env:USERPROFILE\radio-net-deploy\" -Force
powershell -ExecutionPolicy Bypass -File .\deploy\deploy.ps1 -Ip <sydney-ip>
```

If Git Bash is not installed, `wsl bash deploy/pack.sh` does the same pack. The script waits for cloud-init, uploads the tarball, and runs `setup.sh`. That restarts LiveKit, the API, and Caddy, and starts Prometheus and the node exporter. It appends `MONITOR_PASSWORD` and `METRICS_PASSWORD` to `/etc/radionet/secrets.env` if they are missing. It does not print them.

Read the dashboard password (do not commit it, and do not paste it into chat):

```powershell
ssh -i $env:USERPROFILE\radio-net-deploy\radio-net-deploy root@<sydney-ip> "grep '^MONITOR_PASSWORD=' /etc/radionet/secrets.env"
```

Open `https://api.5by5.app/monitor/`. User `operator`, password that value. A browser with no password must get 401.

Confirm the stack before players arrive:

```powershell
ssh -i $env:USERPROFILE\radio-net-deploy\radio-net-deploy root@<sydney-ip> "systemctl is-active livekit radionet-api radionet-caddy prometheus node_exporter; curl -fsS https://api.5by5.app/health"
```

`setup.sh` also raises the LiveKit room cap to 100 participants, the join limit to 60 per minute per IP, and the general API limit to 600 per minute per IP. Journald is persistent (200 MB, 7 days). API and Caddy file-descriptor limits are 65536.

## Pre-test checklist

- [ ] `git pull` on the PC is the `main` that contains this runbook, then pack and `deploy.ps1` as above.
- [ ] `/health` returns ok over HTTPS after the restart.
- [ ] Monitor page loads with the operator password and shows CPU, RAM, and LiveKit RAM. Participants may be 0.
- [ ] Decide the Vultr size. If you resize, do it before the deploy, or reboot and re-check health after.
- [ ] Tell players to hard-refresh the web app. Desktop installs need 0.4.11 or newer so they call `api.5by5.app` instead of the old sslip names.
- [ ] Ask a few people to join one net early and click **Send diagnostics** once, so you know the path works.
- [ ] Leave TURN off unless you have already decided to turn it on.
- [ ] Do not run the load test during the op. It fills the server with fake talkers.

## What to watch live

Refresh is every 5 seconds. Colour: CPU and RAM warn at 70% and go bad at 90%. Packet loss and retransmit share warn at 1% and go bad at 5%.

| Card | Healthy for this op | Act when |
|---|---|---|
| Participants | Climbs toward the headcount, not stuck at 0 | It falls to 0 while people say they are still in |
| Rooms | About one per active net | A net players are on never appears |
| Packet loss p95 | Near 0 on a quiet path; a few percent is a bad client, not the box | It sits above 5% for many people |
| Jitter p95 | Tens of milliseconds | It tracks CPU saturation |
| RTT p95 | About 30–80 ms for NZ/AU | Hundreds of ms while CPU is fine means a path problem |
| CPU | Under about 50% if only a handful are talking | Sustained over 70% |
| RAM | Under about 70% | Over 85%, or climbing and not coming back down |
| Bandwidth in / out | Moves when people talk | Flat while people say they are talking |
| Voice bytes out | Moves with the talkers | High while the op is quiet (a stuck talker) |
| Retransmit share | Under 1% | Over 5% together with loss |
| LiveKit RAM | A few hundred MB at op size | Climbing toward 1 GB |

On the server, if the dashboard itself is down:

```bash
journalctl -u livekit -u radionet-api -u radionet-caddy -u prometheus -f
```

## After the op

On the server, as root. `6` is hours. Use `1` to `168`.

```powershell
ssh -i $env:USERPROFILE\radio-net-deploy\radio-net-deploy root@<sydney-ip> "radionet-collect-logs 6"
```

The command prints a path like `/var/lib/radionet/bundles/scale-20261014T120000Z.tgz` (mode 600). Copy that file:

```powershell
scp -i $env:USERPROFILE\radio-net-deploy\radio-net-deploy root@<sydney-ip>:/var/lib/radionet/bundles/scale-STAMP.tgz .
```

The archive has host memory and listeners, journals for LiveKit, the API, Caddy, Prometheus, and the node exporter, a LiveKit metrics scrape, a node exporter scrape, a few Prometheus query results, `diagnostics/voice.jsonl` and `diagnostics/errors.jsonl`, and the current Caddy access log. It does not contain `secrets.env`.

Client reports:

- **Send diagnostics** (Options → Testing) uploads RTT, jitter, loss, reconnects, disconnects, talk presses, and talk failures. Browser family and a random tab id are included. The callsign is not. There is no audio.
- **Also send that summary when I leave** is off until a player ticks it. It lives in `sessionStorage` for that tab.
- Script errors upload automatically (message, stack, browser family, page path). Tokens, `rnk_` keys, and URL query strings are stripped. The endpoint allows a report with no session so a failed join is still visible. A bad bearer token is rejected. Disk keeps about 24 MB per file (8 MB plus two rotations).

## Load test from the PC

Run this from the Windows PC, not from the VPS. The publishers would steal the CPU you are trying to measure.

Install LiveKit CLI v2.19.0: [lk_2.19.0_windows_amd64.zip](https://github.com/livekit/livekit-cli/releases/download/v2.19.0/lk_2.19.0_windows_amd64.zip). Put `lk.exe` on `PATH`.

Keys are `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` in `/etc/radionet/secrets.env`. The script refuses the Sydney host unless `RN_LOAD_TEST_CONFIRM=1`. Set that only for a dress rehearsal on an empty server.

```powershell
$env:LIVEKIT_URL = "wss://voice.5by5.app"
$env:LIVEKIT_API_KEY = "<from secrets.env>"
$env:LIVEKIT_API_SECRET = "<from secrets.env>"
$env:RN_LOAD_TEST_CONFIRM = "1"
powershell -ExecutionPolicy Bypass -File deploy\load-test.ps1 -Rooms 4 -Talkers 2 -Listeners 15 -MultiNet 10 -Duration 5m
```

That is 4 channels, 2 talkers and 15 listeners on each, plus 10 extra subscribers on every channel (one person listening to all four nets, ten times). Logs land in `%TEMP%\rnscale-*.log`. Caps in the script: 16 rooms, 30 talkers, 200 listeners, 80 multi-net subscribers.

A local run, against a LiveKit you started yourself:

```bash
LIVEKIT_URL=ws://127.0.0.1:7880 LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=secret \
  ROOMS=4 TALKERS=2 LISTENERS=12 MULTI=12 DURATION=3m \
  bash deploy/load-test.sh
```

## Top risks

**CPU saturation.** One core. Continuous talkers cost more than push-to-talk. If CPU stays above 70%, people will hear dropouts before the process dies. The next Vultr size is the fix for the night.

**TURN relay load.** TURN is off. Turning it on puts relayed media on this same CPU and on TCP 443. A few strict-NAT players is fine. A whole cellular squad is not, on this plan.

**Multi-net fan-out.** Each extra tuned net is another subscription. Twelve people on four nets is cheap in the test. Most of the group on every net, while several people talk, is the stress shape.

**Reconnect storms.** A LiveKit restart (the deploy does one) drops everyone. They rejoin and each retunes every net. Watch participants climb back, and watch the API journal for 429s. The join limit is 60/minute/IP and the general limit is 600/minute/IP so a squad behind one home router can refresh tokens.

**PTT reliability.** The server sees a muted track unmute. **Send diagnostics** counts presses that failed to open the microphone. That is the number to read if people say “I was holding the key and nobody heard me.”

**Join friction.** Invite, callsign, mic permission, and UDP 7882. The load test never hits the API, so it will not catch a bad invite or a mic prompt. The error endpoint will, if the page throws.

**Auth burst.** Everybody joining in the same minute is the spike the rate limits are for. A single IP over 60 joins per minute gets 429. That is one NAT, not the whole op, unless the whole op is behind one address.

**Memory creep.** Go does not return heap to the OS quickly. A heavy spike can leave LiveKit RSS high after the spike ends. If RAM stays bad after the op goes quiet, restart LiveKit between games (`systemctl restart livekit`) and expect a short reconnect.

**Dashboard password.** `MONITOR_PASSWORD` is a secret. The Prometheus admin API is not proxied. Only instant query and range query are, and both require the operator password. Caddy still drops request headers, so the password is not written to the access log.
