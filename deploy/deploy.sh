#!/usr/bin/env bash
# DuraHub hub 服务器部署脚本（设计 09 §3.3）。
# 用法（hub VM 上）：deploy/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> git pull"
sudo -u durahub git pull --ff-only

echo "==> npm ci"
sudo -u durahub npm ci

echo "==> build"
sudo -u durahub npm run build

echo "==> restart service"
sudo systemctl restart durahub
sleep 1

if ! curl -sf http://127.0.0.1:8787/api/health; then
  echo "HEALTH CHECK FAILED"
  exit 1
fi
echo ""
echo "==> last logs"
journalctl -u durahub -n 20 --no-pager
