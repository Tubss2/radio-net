# Deploy Radio Net to the VPS from a Windows PC (built-in OpenSSH). Use this when the agent box
# can't reach port 22 (its egress only allows web traffic).
#   1. Put radionet-src.tgz (built by pack.sh on the box) and the deploy key in one folder.
#   2. powershell -ExecutionPolicy Bypass -File deploy.ps1 -Ip 149.28.170.200
param(
  [Parameter(Mandatory = $true)][string]$Ip,
  [string]$Dir = "$env:USERPROFILE\radio-net-deploy",
  [string]$Key = "$env:USERPROFILE\radio-net-deploy\radio-net-deploy",
  [string]$Email = ""
)
$ErrorActionPreference = 'Stop'
# OpenSSH refuses keys readable by other users.
icacls $Key /inheritance:r /grant:r "$($env:USERNAME):(R)" | Out-Null
$o = @('-i', $Key, '-o', 'StrictHostKeyChecking=accept-new', '-o', "UserKnownHostsFile=$Dir\known_hosts", '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15')
ssh @o "root@$Ip" 'cloud-init status --wait >/dev/null; echo cloud-init done'
scp @o "$Dir\radionet-src.tgz" "root@${Ip}:/tmp/radionet-src.tgz"
ssh @o "root@$Ip" "rm -rf /opt/radionet-src && tar xzf /tmp/radionet-src.tgz -C /opt && ACME_EMAIL='$Email' bash /opt/radionet-src/deploy/setup.sh > /root/radionet-setup.log 2>&1; echo exit=`$?; tail -12 /root/radionet-setup.log"
