# Radio Net server deployment kit (Sydney VPS)

One small Ubuntu 24.04 VPS runs everything:

| Piece | How | Listens on |
|---|---|---|
| LiveKit v1.13.9 (voice SFU) | binary + `systemd/livekit.service` | 127.0.0.1:7880 (signalling, behind Caddy), **7881/tcp** (ICE/TCP fallback), **7882/udp** (all media, one port) |
| Radio Net API (the spike's Fastify server) | Node 24 LTS + `systemd/radionet-api.service` | 127.0.0.1:8787 (behind Caddy) |
| Caddy v2.11.7 (automatic HTTPS) | binary + `systemd/radionet-caddy.service` | **80/tcp** (certificate challenge), **443/tcp** |

No domain needed yet: the hostnames are `radio-<ip-with-dashes>.sslip.io` (API) and `lk-<ip-with-dashes>.sslip.io` (LiveKit). sslip.io is a free public DNS service that answers `anything-1-2-3-4.sslip.io` with `1.2.3.4`, so Caddy can get real Let's Encrypt certificates for them. When we buy a domain, re-run setup with `API_HOST=radio.<domain> LK_HOST=lk.<domain>` after pointing two A records at the VPS.

## Files

- `cloud-init.yaml`: paste into the provider's "Cloud-Init / User data" box at create time. Baseline only: updates, firewall, auto security patches, and the deploy SSH public key (private half is only on the agent box, `~/.ssh/radio-net-deploy`).
- `setup.sh`: runs **on the VPS as root**. Installs Node/LiveKit/Caddy (pinned versions), copies the API, generates secrets once (`/etc/radionet/secrets.env`: LiveKit key/secret + community setup code), writes configs, enables systemd units, opens the firewall, health-checks, and prints the URLs + setup code. Idempotent; re-run to update.
- `deploy.py` (paramiko) / `deploy.sh` (ssh+rsync): run from the box/laptop; upload `spike/server` + this kit and run `setup.sh`.
- `systemd/*.service`: hardened units (`ProtectSystem=strict`, non-root `radionet` user).

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
2. Agent: `python3 deploy/deploy.py <IP> --email <optional>` (from the repo root). Takes ~2-4 min. Output ends with:
   ```
   API (put in the client as VITE_API_URL): https://radio-1-2-3-4.sslip.io
   LiveKit (handed to clients by the API):  wss://lk-1-2-3-4.sslip.io
   Community setup code (keep private):     XXXX-XXXX-XXXX
   ```
3. Build the Windows client with `VITE_API_URL=https://radio-<ip>.sslip.io`, create the community in the app with the setup code, share the invite code with testers.

## What was tested (box, 9 Oct 2026)

- `shellcheck` clean on `setup.sh` and `deploy.sh`; `cloud-init.yaml` parses; `deploy.py` compiles.
- `setup.sh` in `RENDER_ONLY` mode rendered configs; `caddy validate` passes on the rendered Caddyfile.
- Local end-to-end with the rendered configs: LiveKit started with the generated keys (signal on 127.0.0.1 only; 7881/tcp + 7882/udp on all interfaces), API with `SEED_DEV=0`, Caddy with local TLS in front. Through HTTPS: `/health` ok, LiveKit `OK`, wrong setup code -> 403, public dev invite `DEVN-ET01` rejected, create community with the real setup code -> 201, create channel 59.500 Command, token mint ok, channel delete -> LiveKit RoomService call ok (204).
- Spike server still passes its 13/13 tests after the small change below.
- **Not tested:** a real VPS run of `setup.sh` (apt, systemd, ufw, real Let's Encrypt via sslip.io), and `deploy.py`/`deploy.sh` against a real host.

## Server code change made for deployment

`spike/server/src/index.ts` / `app.ts`: `SEED_DEV=0` turns off the dev community (its invite code is public in the repo), `TRUST_PROXY=1` makes the join rate-limit see real client IPs behind Caddy, `HOST` sets the bind address. Defaults unchanged, so local dev and tests behave as before.

## Known limits

- Store is still in memory: a restart of `radionet-api` wipes communities/accounts (SQLite is M2).
- sslip.io + Let's Encrypt: if Let's Encrypt rate-limits the shared sslip.io domain, Caddy retries and can fall back to its second issuer (ZeroSSL); setting `--email` helps. Buying the domain removes the issue.
