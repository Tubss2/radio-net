# Redeploy the Sydney server

The web app and the desktop installer use two names that do not change when the VM does:

| Name | Use |
|---|---|
| `api.5by5.app` | API (`https://api.5by5.app`) |
| `voice.5by5.app` | LiveKit (`wss://voice.5by5.app`) |

A new Vultr IP only needs those two DNS records updated, then `deploy.ps1` with the backup from the previous VM. You do not rebuild the GitHub Pages site or the installer for a new IP.

## Before you delete the VM

On the PC that has the deploy key (`%USERPROFILE%\radio-net-deploy\radio-net-deploy`):

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\deploy.ps1 -Ip <current-ip> -Backup
```

That writes `%USERPROFILE%\radio-net-deploy\rn-backup.tgz`. The archive is `/etc/radionet` (LiveKit keys, community setup code, monitor password, in `secrets.env`) and `/var/lib/radionet/store.json` (communities). Copy it somewhere that is not the VM. Do not commit it. Then delete the VM.

From a machine with `ssh` instead of PowerShell: `bash deploy/backup.sh root@<current-ip> ./rn-backup.tgz`.

## New VM

1. In Vultr, create **vc2-1c-2gb** in **Sydney**, Ubuntu 24.04, public IPv4. Paste `deploy/cloud-init.yaml` into User data so the deploy SSH key is installed (the same key as the last VM). Note the new IP.

2. In Cloudflare DNS for `5by5.app`, point both names at that IP. **Proxy status must be DNS only (grey cloud).** Caddy requests its Let's Encrypt certificate with an HTTP-01 challenge on port 80. An orange-cloud proxy answers port 80 itself, so the challenge never reaches Caddy and HTTPS does not come up.

   | Type | Name | Content | Proxy |
   |---|---|---|---|
   | A | `api` | `<new IPv4>` | DNS only (grey cloud) |
   | A | `voice` | `<new IPv4>` | DNS only (grey cloud) |

   The full names are `api.5by5.app` and `voice.5by5.app`. Wait until both resolve to the new IP (`nslookup api.5by5.app`).

3. On the PC, pack the current `main` and deploy with the backup. `-Restore` uploads the tarball and extracts it to `/` **before** `setup.sh`. `setup.sh` keeps an existing `secrets.env`, so the LiveKit keys, setup code, and monitor password stay. The API reads the restored `store.json`, so communities stay. The script passes `API_HOST=api.5by5.app` and `LK_HOST=voice.5by5.app`.

```powershell
cd C:\path\to\radio-net
git pull origin main
bash deploy/pack.sh
Copy-Item deploy\radionet-src.tgz "$env:USERPROFILE\radio-net-deploy\" -Force
powershell -ExecutionPolicy Bypass -File .\deploy\deploy.ps1 -Ip <new-ip> -Restore "$env:USERPROFILE\radio-net-deploy\rn-backup.tgz"
```

4. Check the API, then join from the web app and talk:

```powershell
curl.exe -fsS https://api.5by5.app/health
```

The monitor is `https://api.5by5.app/monitor/`. The user is `operator`. The password is `MONITOR_PASSWORD` in the restored `/etc/radionet/secrets.env`.

## sslip.io fallback

`setup.sh` still defaults to `radio-<ip-with-dashes>.sslip.io` and `lk-<ip-with-dashes>.sslip.io` when `API_HOST` and `LK_HOST` are unset. That path needs no domain: sslip.io answers the name with the IP embedded in it, and Caddy can get a certificate. Pass `-ApiHost '' -LkHost ''` to `deploy.ps1` to use it.

The apps built from this repo do not use those names. A sslip name stops working when the IP changes, and whoever is later given that IP can get a certificate for it. Use it only for a throwaway box.

## What you do not change

GitHub Pages (`https://tubss2.github.io/radio-net/`) and `RadioNet-Setup-<version>.exe` already contain `api.5by5.app` and `voice.5by5.app`. Desktop installs pick up a new server address only when a newer installer is published. A redeploy that keeps these two names does not need one.
