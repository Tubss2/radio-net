# Radio Net server deployment kit (Sydney VPS)

One small Ubuntu 24.04 VPS runs everything:

| Piece | How | Listens on |
|---|---|---|
| LiveKit v1.13.9 (voice SFU) | binary + `systemd/livekit.service` | 127.0.0.1:7880 (signalling, behind Caddy), **7881/tcp** (ICE/TCP fallback), **7882/udp** (all media, one port) |
| Radio Net API (the spike's Fastify server) | Node 24 LTS + `systemd/radionet-api.service` | 127.0.0.1:8787 (behind Caddy) |
| Caddy v2.11.7 (automatic HTTPS) | binary + `systemd/radionet-caddy.service` | **80/tcp** (certificate challenge), **443/tcp** |

The live names are `api.5by5.app` (API) and `voice.5by5.app` (LiveKit), on the owner's domain with DNS at Cloudflare. `deploy.ps1`, `deploy.sh`, and `deploy.py` pass those as `API_HOST` and `LK_HOST`. Caddy gets the certificate with an HTTP-01 challenge on port 80, so both A records must be **DNS only** (grey cloud). An orange-cloud proxy answers the challenge itself and the certificate is never issued. Replacing the VM is [`docs/REDEPLOY.md`](../docs/REDEPLOY.md): back up, point the two A records at the new IP, deploy with `-Restore`.

`setup.sh` still defaults to `radio-<ip-with-dashes>.sslip.io` and `lk-<ip-with-dashes>.sslip.io` when those variables are unset. sslip.io answers `anything-1-2-3-4.sslip.io` with `1.2.3.4`, so a throwaway box can get a certificate without the domain. Pass `-ApiHost '' -LkHost ''` for that. The apps built from this repo do not use those names. They stop working when the IP changes, and the next holder of that IP can get a certificate for them.

## Files

- `cloud-init.yaml`: paste into the provider's "Cloud-Init / User data" box at create time. Baseline only: updates, firewall, auto security patches, and the deploy SSH public key (private half is only on the agent box, `~/.ssh/radio-net-deploy`).
- `setup.sh`: runs **on the VPS as root**. Installs Node/LiveKit/Caddy (pinned versions), copies the API, generates secrets once (`/etc/radionet/secrets.env`: LiveKit key/secret + community setup code), writes configs, enables systemd units, opens the firewall, health-checks, and prints the URLs + setup code. Idempotent; re-run to update.
- `deploy.py` (paramiko) / `deploy.sh` (ssh+rsync): upload `spike/server` + this kit and run `setup.sh`. **The agent box can't use them**: its egress only allows web traffic (80/443), so SSH to port 22 times out.
- `pack.sh` + `deploy.ps1`: the path actually used. `pack.sh` (box) builds `radionet-src.tgz`; `deploy.ps1` runs on Tobias's Windows PC (built-in OpenSSH), waits for cloud-init, uploads and runs `setup.sh` with `API_HOST=api.5by5.app` and `LK_HOST=voice.5by5.app`. `-Backup` downloads `rn-backup.tgz` (`/etc/radionet` and `/var/lib/radionet/store.json`) before a VM is deleted. `-Restore` extracts that archive to `/` before `setup.sh`, so an existing `secrets.env` and `store.json` are kept. `backup.sh` is the same pull from a machine with `ssh`.
- `secrets/` (gitignored, chmod 700/600): copy of the server's `/etc/radionet/secrets.env` per server. Never commit.
- `systemd/*.service`: hardened units (`ProtectSystem=strict`, non-root `radionet` user, no new privileges, private devices, no extra capabilities except Caddy's `CAP_NET_BIND_SERVICE`).

## Browser UI preview (optional, mocked)
- Served by Caddy at `https://<API_HOST>/preview/` from `/opt/radionet/preview` (`handle_path /preview/*` + `file_server`; everything else still goes to the API). `/preview` redirects to `/preview/`.
- It is the `vite --mode preview` build of `spike/client` (`npm run preview:build`, or the `ui-preview` Actions artifact): fake community/channels, no mic, no LiveKit, no API. Caddy also sends `Content-Security-Policy: connect-src 'none'` on /preview/ so the page physically can't call the API or LiveKit, plus `X-Robots-Tag: noindex`.
- `pack.sh` includes it when `PREVIEW_DIST` (default `../spike/client/preview-dist`) has an `index.html` built with relative paths; `setup.sh` rsyncs it to `/opt/radionet/preview`. No build → `/preview/` just 404s.
- Preview-only update without restarting the API/LiveKit: upload the tgz, extract to /opt, `rsync -a --delete /opt/radionet-src/preview/ /opt/radionet/preview/`, re-render the Caddyfile with `RENDER_ONLY=/tmp/x PUBLIC_IP=<ip> bash setup.sh`, copy `/tmp/x/Caddyfile` to `/etc/radionet/`, `systemctl reload radionet-caddy`, delete `/tmp/x`.

## Firewall (ufw, also mirror in the provider's cloud firewall if you use one)

| Port | Proto | Why |
|---|---|---|
| 22 | tcp | SSH |
| 80 | tcp | Let's Encrypt HTTP challenge / redirect |
| 443 | tcp | HTTPS API + LiveKit WebSocket signalling |
| 7881 | tcp | LiveKit ICE over TCP (when UDP is blocked) |
| 7882 | udp | LiveKit media (UDP mux, single port) |

TURN is off. If a tester can't connect from a strict network, enable LiveKit's built-in TURN/TLS on 443 with a dedicated domain (needs the domain first).

## Steps

1. Tobias: create a provider account (card + email). Create **one** instance: Sydney, Ubuntu 24.04 x64, 2 vCPU / 2-4 GB, public IPv4 on, IPv6 optional, paste `cloud-init.yaml` into User data. Send the agent the **IP address**. (No passwords or API tokens needed.)
2. Agent: `deploy/pack.sh` on the box, copy `radionet-src.tgz` + the deploy key to the PC, run `deploy.ps1 -Ip <IP>` there (or `deploy.py`/`deploy.sh` from any machine with SSH egress). Takes ~1.5 min. With the default hosts the output ends with:
   ```
   API (put in the client as VITE_API_URL): https://api.5by5.app
   LiveKit (handed to clients by the API):  wss://voice.5by5.app
   Community setup code (keep private):     XXXX-****-**** (full value in /etc/radionet/secrets.env)
   ```
   Those names already match the web app and the desktop installer. Point the Cloudflare A records at this IP first, DNS only, or Caddy cannot finish HTTP-01. To keep an existing server's keys and communities, run `deploy.ps1 -Backup` before deleting the old VM and `deploy.ps1 -Ip <new> -Restore <rn-backup.tgz>` on the new one. See [`docs/REDEPLOY.md`](../docs/REDEPLOY.md).
3. Create the community in the app with the setup code, and share the invite code with testers. A fresh box with an empty restore has a new setup code in `secrets.env`. A `-Restore` keeps the previous one.

## What was tested (box, 9 Oct 2026)

- `shellcheck` clean on `setup.sh` and `deploy.sh`; `cloud-init.yaml` parses; `deploy.py` compiles.
- `setup.sh` in `RENDER_ONLY` mode rendered configs; `caddy validate` passes on the rendered Caddyfile.
- Local end-to-end with the rendered configs: LiveKit started with the generated keys (signal on 127.0.0.1 only; 7881/tcp + 7882/udp on all interfaces), API with `SEED_DEV=0`, Caddy with local TLS in front. Through HTTPS: `/health` ok, LiveKit `OK`, wrong setup code -> 403, public dev invite `DEVN-ET01` rejected, create community with the real setup code -> 201, create channel 59.500 Command, token mint ok, channel delete -> LiveKit RoomService call ok (204).
- Spike server still passes its 13/13 tests after the small change below.
- **Not tested:** a real VPS run of `setup.sh` (apt, systemd, ufw, real Let's Encrypt via sslip.io), and `deploy.py`/`deploy.sh` against a real host.

## Server code change made for deployment

`spike/server/src/index.ts` / `app.ts`: `SEED_DEV=0` turns off the dev community (its invite code is public in the repo), `TRUST_PROXY=1` makes the join rate-limit see real client IPs behind Caddy, `HOST` sets the bind address. Defaults unchanged, so local dev and tests behave as before.

## Host hardening

`setup.sh` installs fail2ban for sshd (5 failures, 1 hour ban), turns on unattended security upgrades, and writes `/etc/ssh/sshd_config.d/00-radionet.conf` so password login is off and root can only use a key. The drop-in is named `00-` because sshd keeps the first value it reads, and Vultr's `50-cloud-init.conf` sets `PasswordAuthentication yes`. A later `99-radionet.conf` cannot override that. The next `setup.sh` removes a leftover `99-radionet.conf`. After reload, confirm the effective config (keywords are lowercase):

```
sudo sshd -T | grep -E '^(passwordauthentication|kbdinteractiveauthentication|permitrootlogin) '
```

That should print `passwordauthentication no`, `kbdinteractiveauthentication no`, and `permitrootlogin prohibit-password`. Confirm the deploy key works in a second session before you close the one that re-ran setup. `cloud-init.yaml` writes the same `00-radionet.conf` on a brand-new VM. Caddy's access log drops request headers, so `Authorization` and `X-Admin-Key` are not stored. New secret files include `RN_STORE_MAC_KEY`; an existing file gets that line appended. The API uses it only after the API hardening is deployed.

The Sydney box that ran main `9bcc940` was hot-fixed in place: a LiveKit drop-in adds `AF_NETLINK`, and the SSH file was renamed to `00-radionet.conf`. The next `setup.sh` applies those same two changes from this tree. It restarts LiveKit, the API, and Caddy.

## Monitor, logs, and the scale test

`setup.sh` turns on LiveKit's Prometheus endpoint (localhost port 6789, password `METRICS_PASSWORD`), scrapes it with Prometheus plus a small node exporter, and serves a dashboard at `https://<API_HOST>/monitor/` behind HTTP basic auth. The user is `operator`. The password is `MONITOR_PASSWORD` in `/etc/radionet/secrets.env`. Prometheus and the node exporter listen on localhost only. UFW does not open 6789, 9090, or 9100.

The dashboard is a static page, not Grafana. On a measurement box, Prometheus sat at about 80 MB and the node exporter at about 20 MB. Grafana is commonly another 200 MB, which is the wrong trade on a 2 GB VPS. See [`docs/SCALE-TEST-RUNBOOK.md`](../docs/SCALE-TEST-RUNBOOK.md).

Journald is set to persistent storage (200 MB, 7 days), so LiveKit and API logs survive a restart. After the op, on the server:

```bash
radionet-collect-logs 6
```

That writes `/var/lib/radionet/bundles/scale-<utc>.tgz` and prints the path. The archive has journals, a metrics snapshot, client diagnostics, and the Caddy access log. It does not include `secrets.env`.

Room size is 100 participants. Join limit is 60 per minute per IP. Other API calls are 600 per minute per IP so a squad behind one NAT can refresh voice tokens.

## Known limits

- Communities and channels persist in `/var/lib/radionet/store.json` (`RN_DATA_FILE` in `api.env`, writable under systemd `ProtectSystem=strict`). A restart keeps them. Re-run `setup.sh` on a box that was installed before this file existed so the directory and env line are created. There are still no user accounts.
- sslip.io + Let's Encrypt: if Let's Encrypt rate-limits the shared sslip.io domain, Caddy retries and can fall back to its second issuer (ZeroSSL); setting `--email` helps. The live names are on `5by5.app`, which avoids that shared domain. The Cloudflare records for `api` and `voice` must stay DNS only so HTTP-01 reaches Caddy.

## Live deployment: radio-net (Vultr Sydney, vc2-1c-2gb, 149.28.170.200), 9 Oct 2026 ~5:45pm NZ

That VM's addresses were `https://radio-149-28-170-200.sslip.io` and `wss://lk-149-28-170-200.sslip.io`. The apps no longer use them. Current names are `https://api.5by5.app` and `wss://voice.5by5.app`. The IP changes when the VM is replaced; the names do not. See [`docs/REDEPLOY.md`](../docs/REDEPLOY.md).

- API at the time: `https://radio-149-28-170-200.sslip.io`, voice: `wss://lk-149-28-170-200.sslip.io`
- Secrets on box: `deploy/secrets/radio-net-149.28.170.200.env` (600). On the server: `/etc/radionet/secrets.env`.
- Passed: cloud-init done, ufw as designed; setup.sh exit 0 in ~90 s; all 3 services active + enabled; Let's Encrypt certs for both hostnames (issuer YE2, valid to 7 Jan 2027, chain verifies); `/health` ok over HTTPS; HTTP -> 308 to HTTPS; LiveKit `OK` and WSS `/rtc` upgrade 101 (from the box); wrong setup code 403; dev invite rejected; community + channel + voice tokens OK.
- Real voice test from Tobias's PC (`spike/tests/radio-e2e.ts`, now configurable by env: `API_URL`, `SETUP_CODE`, `LIVEKIT_WS`, `LIVEKIT_HTTP`, `LIVEKIT_API_KEY/SECRET`): **14/14** (multi-room, listen-many/talk-one, TX cycling, server-enforced listen-only, admin-only channels, delete drops listeners). Media went over UDP 7882. Key-up to first audio bot->Sydney->bot: 66 ms.
- Latency PC (NZ) -> server: ICMP 32-35 ms; HTTPS `/health` ~62 ms warm. TCP 7881 reachable.
- Test communities were wiped afterwards by restarting `radionet-api` (in-memory store).
- Caddy is limited to HTTP/1 and HTTP/2. UDP 443 stays closed in UFW; leaving HTTP/3 on made clients retry QUIC and drop for about 30 seconds while the server stayed healthy. Access logs are JSON at `/var/log/caddy/access.log` (rotated). The API logs method, path, status and latency to the journal, and `TRUST_PROXY=1` so the join limit is per client. Re-run `setup.sh` and restart `radionet-caddy` and `radionet-api` to apply this on a box that was installed earlier.

### UI preview added (9 Oct 2026 ~6:30pm NZ)
- https://radio-149-28-170-200.sslip.io/preview/ — built on the box from PR #1 branch `cursor/initial-radio-net-3d59` (all 22 source files checked against the branch's git blob SHAs; the Actions artifact couldn't be downloaded without GitHub auth). Bundle: index.html + index-qrK5K9D4.js + index-DB47ri7X.css.
- Applied with a Caddy reload only (API/LiveKit not restarted). Old Caddyfile kept at `/etc/radionet/Caddyfile.bak-prepreview`.
- Checks: /preview → 308 → /preview/ 200, assets 200 (JS byte-identical), CSP + noindex headers present, headless Chrome renders the mock (War Dogs NZ, channels) and requests nothing but /preview/ files; /health ok; setup-code community → channel → voice token 200; LiveKit WSS /rtc with token → 101.
