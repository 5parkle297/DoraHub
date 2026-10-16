#!/usr/bin/env bash
# DoraHub hub 部署 stage1c：从 workpc 推来的源码包构建（绕开 GitHub 直连问题）
set -euo pipefail

echo "=== 账户与目录 ==="
id -u dorahub >/dev/null 2>&1 || useradd -r -s /usr/sbin/nologin -m -d /opt/dorahub dorahub
mkdir -p /opt/dorahub /var/lib/dorahub /etc/dorahub
rm -rf /opt/dorahub/*
tar -xzf /tmp/dorahub-src.tar.gz -C /opt/dorahub
chown -R dorahub:dorahub /opt/dorahub /var/lib/dorahub

echo "=== 环境文件 ==="
printf '%s\n' \
  'ZJL_BASE_URL=PLACEHOLDER' \
  'ZJL_API_KEY=PLACEHOLDER' \
  'DORAHUB_DB=/var/lib/dorahub/agent.sqlite' \
  'DORAHUB_CWD=/var/lib/dorahub/workspace' \
  'DORAHUB_MODEL=grok-4.7' \
  'DORAHUB_PORT=8787' > /etc/dorahub/env
chmod 600 /etc/dorahub/env
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
