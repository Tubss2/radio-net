# Deploy Radio Net to the VPS from a Windows PC (built-in OpenSSH). Use this when the agent box
# can't reach port 22 (its egress only allows web traffic).
#   1. Put radionet-src.tgz (built by pack.sh on the box) and the deploy key in one folder.
#   2. powershell -ExecutionPolicy Bypass -File deploy.ps1 -Ip <new-ip>
#
# The script passes API_HOST=api.5by5.app and LK_HOST=voice.5by5.app. Caddy then asks
# Let's Encrypt for those names. Cloudflare A records must be DNS only (grey cloud).
# -ApiHost '' -LkHost '' leaves setup.sh on its sslip.io default (radio-<ip>.sslip.io).
#
# Before deleting a VM:
#   powershell -ExecutionPolicy Bypass -File deploy.ps1 -Ip <current-ip> -Backup
# That writes rn-backup.tgz (etc/radionet, including secrets.env, and store.json).
#
# On the replacement VM, after DNS points at the new IP:
#   powershell -ExecutionPolicy Bypass -File deploy.ps1 -Ip <new-ip> -Restore C:\path\rn-backup.tgz
# The archive is extracted to / before setup.sh, so LiveKit keys, the setup code,
# the monitor password, and communities are kept.
param(
  [Parameter(Mandatory = $true)][string]$Ip,
  [string]$Dir = "$env:USERPROFILE\radio-net-deploy",
  [string]$Key = "$env:USERPROFILE\radio-net-deploy\radio-net-deploy",
  [string]$Email = "",
  [string]$ApiHost = "api.5by5.app",
  [string]$LkHost = "voice.5by5.app",
  [string]$Restore = "",
  [string]$BackupOut = "",
  [switch]$Backup
)
$ErrorActionPreference = 'Stop'
if ($Backup -and $Restore) { throw "Use -Backup or -Restore, not both." }
if ($ApiHost -notmatch '^[A-Za-z0-9.-]*$') { throw "API host must be a hostname, or empty for sslip.io." }
if ($LkHost -notmatch '^[A-Za-z0-9.-]*$') { throw "LiveKit host must be a hostname, or empty for sslip.io." }
# OpenSSH refuses keys readable by other users.
icacls $Key /inheritance:r /grant:r "$($env:USERNAME):(R)" | Out-Null
$o = @('-i', $Key, '-o', 'StrictHostKeyChecking=accept-new', '-o', "UserKnownHostsFile=$Dir\known_hosts", '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15')

if ($Backup) {
  if (-not $BackupOut) { $BackupOut = Join-Path $Dir "rn-backup.tgz" }
  scp @o (Join-Path $PSScriptRoot "backup-remote.sh") "root@${Ip}:/tmp/backup-remote.sh"
  if ($LASTEXITCODE -ne 0) { throw "Could not upload backup-remote.sh ($LASTEXITCODE)." }
  & ssh @o "root@$Ip" "bash /tmp/backup-remote.sh && rm -f /tmp/backup-remote.sh"
  if ($LASTEXITCODE -ne 0) { throw "Backup on the server failed ($LASTEXITCODE)." }
  scp @o "root@${Ip}:/tmp/rn-backup.tgz" "$BackupOut"
  if ($LASTEXITCODE -ne 0) { throw "Could not download the backup ($LASTEXITCODE)." }
  & ssh @o "root@$Ip" "rm -f /tmp/rn-backup.tgz"
  Write-Host "Wrote $BackupOut"
  Write-Host "This file contains server secrets. Keep it off git. Delete the VM only after the file is stored somewhere else."
  return
}

& ssh @o "root@$Ip" 'cloud-init status --wait >/dev/null; echo cloud-init done'
if ($LASTEXITCODE -ne 0) { throw "cloud-init did not finish ($LASTEXITCODE)." }

if ($Restore) {
  if (-not (Test-Path -LiteralPath $Restore)) { throw "Restore archive not found: $Restore" }
  scp @o "$Restore" "root@${Ip}:/tmp/rn-backup.tgz"
  if ($LASTEXITCODE -ne 0) { throw "Could not upload the backup ($LASTEXITCODE)." }
  scp @o (Join-Path $PSScriptRoot "restore-backup.sh") "root@${Ip}:/tmp/restore-backup.sh"
  if ($LASTEXITCODE -ne 0) { throw "Could not upload restore-backup.sh ($LASTEXITCODE)." }
  & ssh @o "root@$Ip" "bash /tmp/restore-backup.sh /tmp/rn-backup.tgz && rm -f /tmp/restore-backup.sh /tmp/rn-backup.tgz"
  if ($LASTEXITCODE -ne 0) { throw "Restore failed ($LASTEXITCODE). setup.sh was not run." }
}

scp @o "$Dir\radionet-src.tgz" "root@${Ip}:/tmp/radionet-src.tgz"
if ($LASTEXITCODE -ne 0) { throw "Could not upload radionet-src.tgz ($LASTEXITCODE)." }
& ssh @o "root@$Ip" "rm -rf /opt/radionet-src && tar xzf /tmp/radionet-src.tgz -C /opt && ACME_EMAIL='$Email' API_HOST='$ApiHost' LK_HOST='$LkHost' bash /opt/radionet-src/deploy/setup.sh > /root/radionet-setup.log 2>&1; echo exit=`$?; tail -12 /root/radionet-setup.log"
