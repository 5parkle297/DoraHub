# -*- coding: utf-8 -*-
# 上传 dorahub-src.tar.gz 到 hub /tmp（paramiko，凭据 ~/.dorahub/hub.env）
import paramiko, os
env = {}
with open(os.path.expanduser("~/.dorahub/hub.env"), encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
host, user = env["DORAHUB_HUB_PUBLIC_IP"], env["DORAHUB_HUB_SSH_USER"]
pw = env["DORAHUB_HUB_SSH_PASSWORD"]
cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(hostname=host, username=user, password=pw, timeout=20)
sftp = cli.open_sftp()
sftp.put("dorahub-src.tar.gz", "/tmp/dorahub-src.tar.gz")
print("uploaded:", sftp.stat("/tmp/dorahub-src.tar.gz").st_size, "bytes")
sftp.close()
cli.close()
