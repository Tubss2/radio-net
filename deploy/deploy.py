#!/usr/bin/env python3
"""Push the Radio Net server to a VPS and run setup.sh, using paramiko (for machines without an ssh client).

  python3 deploy.py 203.0.113.10                      # user root, key ~/.ssh/radio-net-deploy
  python3 deploy.py 203.0.113.10 --user ubuntu --sudo --email you@example.com
"""
import argparse, os, pathlib, posixpath, re, sys

import paramiko

HERE = pathlib.Path(__file__).resolve().parent
SKIP = {"node_modules", ".git"}


def put_tree(sftp, local: pathlib.Path, remote: str):
    try:
        sftp.mkdir(remote)
    except IOError:
        pass
    for p in sorted(local.iterdir()):
        if p.name in SKIP or p.suffix == ".log":
            continue
        r = posixpath.join(remote, p.name)
        if p.is_dir():
            put_tree(sftp, p, r)
        else:
            sftp.put(str(p), r)
            sftp.chmod(r, p.stat().st_mode & 0o777)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("host")
    ap.add_argument("--user", default="root")
    ap.add_argument("--key", default=os.path.expanduser("~/.ssh/radio-net-deploy"))
    ap.add_argument("--sudo", action="store_true", help="prefix setup with sudo (non-root user)")
    ap.add_argument("--email", default="", help="ACME email for certificate notices")
    ap.add_argument("--api-host", default="api.5by5.app", help="API hostname. Empty uses setup.sh's sslip.io default.")
    ap.add_argument("--lk-host", default="voice.5by5.app", help="LiveKit hostname. Empty uses setup.sh's sslip.io default.")
    ap.add_argument("--server-src", default=str(HERE.parent / "spike" / "server"))
    a = ap.parse_args()
    for label, value in (("api host", a.api_host), ("LiveKit host", a.lk_host)):
        if value and not re.fullmatch(r"[A-Za-z0-9.-]+", value):
            sys.exit(f"{label} must be a hostname")

    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())  # first contact with a fresh VPS
    c.connect(a.host, username=a.user, key_filename=a.key, timeout=20)
    stage = f"/tmp/radionet-src"
    c.exec_command(f"rm -rf {stage} && mkdir -p {stage}")[1].channel.recv_exit_status()
    sftp = c.open_sftp()
    put_tree(sftp, pathlib.Path(a.server_src), f"{stage}/server")
    sftp.mkdir(f"{stage}/deploy")
    sftp.put(str(HERE / "setup.sh"), f"{stage}/deploy/setup.sh")
    put_tree(sftp, HERE / "systemd", f"{stage}/deploy/systemd")
    sftp.close()

    sudo = "sudo " if a.sudo else ""
    cmd = (f"{sudo}rm -rf /opt/radionet-src && {sudo}mv {stage} /opt/radionet-src && "
           f"{sudo}env ACME_EMAIL='{a.email}' API_HOST='{a.api_host}' LK_HOST='{a.lk_host}' "
           f"bash /opt/radionet-src/deploy/setup.sh")
    _, out, _ = c.exec_command(cmd, get_pty=True)
    for line in iter(out.readline, ""):
        sys.stdout.write(line)
    code = out.channel.recv_exit_status()
    c.close()
    sys.exit(code)


if __name__ == "__main__":
    main()
