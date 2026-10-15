# Simulate a Radio Net op from Windows. Do not run this on the Vultr box.
# Install lk from https://github.com/livekit/livekit-cli/releases/download/v2.19.0/lk_2.19.0_windows_amd64.zip
# and put lk.exe on PATH.
#
#   $env:LIVEKIT_URL = "wss://voice.5by5.app"
#   $env:LIVEKIT_API_KEY = "<from /etc/radionet/secrets.env>"
#   $env:LIVEKIT_API_SECRET = "<from /etc/radionet/secrets.env>"
#   $env:RN_LOAD_TEST_CONFIRM = "1"
#   powershell -ExecutionPolicy Bypass -File deploy\load-test.ps1 -Rooms 4 -Talkers 2 -Listeners 15 -MultiNet 10 -Duration 5m
param(
  [string]$Url = $env:LIVEKIT_URL,
  [string]$ApiKey = $env:LIVEKIT_API_KEY,
  [string]$ApiSecret = $env:LIVEKIT_API_SECRET,
  [int]$Rooms = 4,
  [int]$Talkers = 2,
  [int]$Listeners = 10,
  [int]$MultiNet = 8,
  [string]$Duration = "3m",
  [string]$Lk = "lk"
)
$ErrorActionPreference = 'Stop'
if (-not $Url -or -not $ApiKey -or -not $ApiSecret) {
  throw "Set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET."
}
if ($Url -match '149\.28\.170\.200|lk-149-28-170-200|voice\.5by5\.app' -and $env:RN_LOAD_TEST_CONFIRM -ne '1') {
  throw "Refusing the Sydney server. Read docs/SCALE-TEST-RUNBOOK.md and set RN_LOAD_TEST_CONFIRM=1."
}
if ($Rooms -lt 1 -or $Rooms -gt 16 -or $Talkers -gt 30 -or $Listeners -gt 200 -or $MultiNet -gt 80) {
  throw "Those counts are outside the script's safety cap."
}
if (-not (Get-Command $Lk -ErrorAction SilentlyContinue)) {
  throw "Install the LiveKit CLI (lk.exe) and put it on PATH."
}
$peers = $Rooms * ($Talkers + $Listeners + $MultiNet)
Write-Host "Channels: $Rooms  talkers/channel: $Talkers  listeners/channel: $Listeners  multi-net: $MultiNet"
Write-Host "Peer connections: about $peers   duration: $Duration"
$jobs = @()
function Start-Room([string]$Room, [int]$Pubs, [int]$Subs, [string]$Tag) {
  $log = Join-Path $env:TEMP "rnscale-$Tag.log"
  $argList = @(
    'load-test', '--url', $Url, '--api-key', $ApiKey, '--api-secret', $ApiSecret,
    '--room', $Room, '--audio-publishers', "$Pubs", '--subscribers', "$Subs",
    '--duration', $Duration, '--num-per-second', '5', '--identity-prefix', "rnscale-$Tag"
  )
  $p = Start-Process -FilePath $Lk -ArgumentList $argList -RedirectStandardOutput $log -RedirectStandardError "$log.err" -PassThru -WindowStyle Hidden
  Write-Host "started $Tag pid $($p.Id) log $log"
  return $p
}
try {
  for ($i = 1; $i -le $Rooms; $i++) {
    $room = 'net-{0:d2}' -f $i
    $jobs += Start-Room $room $Talkers $Listeners "r$i"
  }
  if ($MultiNet -gt 0) {
    for ($i = 1; $i -le $Rooms; $i++) {
      $room = 'net-{0:d2}' -f $i
      $jobs += Start-Room $room 0 $MultiNet "multi-r$i"
    }
  }
  Write-Host "Running $($jobs.Count) lk load-test processes."
  $jobs | Wait-Process
  $bad = @($jobs | Where-Object { $_.ExitCode -ne 0 })
  if ($bad.Count -gt 0) { throw "$($bad.Count) load-test processes failed. See $env:TEMP\rnscale-*.log" }
  Write-Host "Load test finished."
} finally {
  foreach ($p in $jobs) {
    if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
  }
}
