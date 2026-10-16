#!/usr/bin/env bash
# DoraHub hub 全自动部署（阿里云 Ubuntu 24.04）
# 幂等：可重复执行
set -euo pipefail

echo "=== [1/7] Node 22 (NodeSource) ==="
if ! command -v node >/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y nodejs >/dev/null
fi
node -v

echo "=== [2/7] 运行账户与目录 ==="
id -u dorahub >/dev/null 2>&1 || useradd -r -s /usr/sbin/nologin -m -d /opt/dorahub dorahub
mkdir -p /opt/dorahub /var/lib/dorahub /etc/dorahub
chown -R dorahub:dorahub /var/lib/dorahub /opt/dorahub

echo "=== [3/7] 克隆仓库 ==="
if [ ! -d /opt/dorahub/.git ]; then
  sudo -u dorahub git clone https://github.com/5parkle297/DoraHub.git /opt/dorahub
else
  sudo -u dorahub git -C /opt/dorahub pull --ff-only || true
fi

echo "=== [4/7] 密钥环境文件（占位，稍后由部署机写入真实值）==="
if [ ! -f /etc/dorahub/env ]; then
  cat > /etc/dorahub/env <<'EOF'
ZJL_BASE_URL=PLACEHOLDER
ZJL_API_KEY=PLACEHOLDER
DORAHUB_DB=/var/lib/dorahub/agent.sqlite
DORAHUB_CWD=/var/lib/dorahub/workspace
DORAHUB_MODEL=grok-4.7
DORAHUB_PORT=8787
EOF
  chmod 600 /etc/dorahub/env
fi
sudo -u dorahub mkdir -p /var/lib/dorahub/workspace
ls -la /etc/dorahub/

echo "=== [5/7] 依赖与构建 ==="
cd /opt/dorahub
# 国内机器用 npmmirror 加速
sudo -u dorahub npm config set registry https://registry.npmmirror.com
sudo -u dorahub npm ci --no-audit --no-fund 2>&1 | tail -2
sudo -u dorahub npm approve-scripts --allow-scripts-pending >/dev/null 2>&1 || true
sudo -u dorahub npm run build 2>&1 | tail -4

echo "=== [6/7] systemd 单元 ==="
cp deploy/dorahub.service /etc/systemd/system/dorahub.service
systemctl daemon-reload
systemctl enable dorahub >/dev/null

echo "=== [7/7] 完成（未启动——等密钥写入后由部署机启动）==="
ls -la /opt/dorahub/packages/server/dist/index.js
echo "DEPLOY-STAGE1-DONE"
