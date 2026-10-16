#!/usr/bin/env bash
# DoraHub hub 部署 stage1b：账户/clone/构建/systemd（Node 已装好）
set -euo pipefail

echo "=== 账户与目录 ==="
id -u dorahub >/dev/null 2>&1 || useradd -r -s /usr/sbin/nologin -m -d /opt/dorahub dorahub
mkdir -p /opt/dorahub /var/lib/dorahub /etc/dorahub
chown -R dorahub:dorahub /var/lib/dorahub /opt/dorahub

echo "=== 克隆仓库 ==="
if [ ! -d /opt/dorahub/.git ]; then
  sudo -u dorahub git clone https://github.com/5parkle297/DoraHub.git /opt/dorahub
else
  sudo -u dorahub git -C /opt/dorahub pull --ff-only || true
fi
sudo -u dorahub git -C /opt/dorahub log --oneline -1

echo "=== 环境文件 ==="
if [ ! -f /etc/dorahub/env ]; then
  printf '%s\n' \
    'ZJL_BASE_URL=PLACEHOLDER' \
    'ZJL_API_KEY=PLACEHOLDER' \
    'DORAHUB_DB=/var/lib/dorahub/agent.sqlite' \
    'DORAHUB_CWD=/var/lib/dorahub/workspace' \
    'DORAHUB_MODEL=grok-4.7' \
    'DORAHUB_PORT=8787' > /etc/dorahub/env
  chmod 600 /etc/dorahub/env
fi
sudo -u dorahub mkdir -p /var/lib/dorahub/workspace

echo "=== 依赖与构建 ==="
cd /opt/dorahub
sudo -u dorahub npm config set registry https://registry.npmmirror.com
sudo -u dorahub npm ci --no-audit --no-fund 2>&1 | tail -1
sudo -u dorahub npm approve-scripts --allow-scripts-pending 2>&1 | tail -1 || true
sudo -u dorahub npm run build 2>&1 | tail -3
ls -la packages/server/dist/index.js packages/web/dist/index.html

echo "=== systemd ==="
cp deploy/dorahub.service /etc/systemd/system/dorahub.service
systemctl daemon-reload
systemctl enable dorahub >/dev/null 2>&1
echo "DEPLOY-STAGE1-DONE"
