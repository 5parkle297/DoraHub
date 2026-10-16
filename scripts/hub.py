"""DoraHub hub 部署助手：workpc → 阿里云 hub 的 SSH 执行通道。

用法：
  python scripts/hub.py "command"            # 执行单条命令（root）
  python scripts/hub.py --script file.sh     # 上传并执行脚本
凭据：C:/Users/shiyu/.dorahub/hub.env（不入 git）
"""
import sys
import os
import paramiko

# Windows GBK 控制台兼容
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

ENV_PATH = os.path.expanduser("~/.dorahub/hub.env")

def load_env():
    env = {}
    with open(ENV_PATH) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env

def connect():
    env = load_env()
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        env["DORAHUB_HUB_PUBLIC_IP"],
        username=env["DORAHUB_HUB_SSH_USER"],
        password=env["DORAHUB_HUB_SSH_PASSWORD"],
        timeout=15,
        look_for_keys=False,
        allow_agent=False,
    )
    return client

def run(client, cmd, timeout=300):
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    code = stdout.channel.recv_exit_status()
    return code, out, err

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    client = connect()
    try:
        if sys.argv[1] == "--script":
            local = sys.argv[2]
            remote = "/tmp/" + os.path.basename(local)
            sftp = client.open_sftp()
            sftp.put(local, remote)
            sftp.close()
            code, out, err = run(client, f"bash {remote}")
        else:
            code, out, err = run(client, sys.argv[1])
        if out:
            print(out)
        if err:
            print("STDERR:", err, file=sys.stderr)
        sys.exit(code)
    finally:
        client.close()

if __name__ == "__main__":
    main()
