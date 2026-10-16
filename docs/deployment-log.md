# DoraHub 部署实录（2026-10-16）

> 本文记录 hub 实际部署过程与偏差，对应 design/08 的实测版。供下次重建/迁移参考。

## hub 实例（ADR-006 更新）

| 项 | 值 |
|---|---|
| 提供商 | 阿里云轻量应用服务器（学生优惠，半年） |
| 公网 IP | 101.200.81.183（私网 172.24.25.203） |
| 系统 | Ubuntu 24.04.2 LTS，2C/1.6G/40G SSD，北京 |
| tailnet | `hub` @ `5parkle297.github` tailnet（tail242752.ts.net），100.99.214.15 |
| 入口 | https://hub.tail242752.ts.net （tailscale serve → 127.0.0.1:8787） |
| 凭据 | `~/.dorahub/hub.env`（workpc 上，不入 git）+ Tailscale SSH（`ssh root@hub`） |

半年后迁移计划：腾讯云轻量 2C2G 年付（design 决策），迁移 = 拷 `/var/lib/dorahub/*.sqlite*` + 重跑 stage1c + serve。

## 实际部署路径（与 design/08 的偏差）

1. **DNS**：systemd-resolved 间歇超时 → `/etc/systemd/resolved.conf.d/aliyun-dns.conf` 固定 223.5.5.5/119.29.29.29
2. **apt 源**：默认 `mirrors.cloud.aliyuncs.com`（内网）不通 → 换公网 `mirrors.aliyun.com`
3. **Node 22**：apt 只有 18；NodeSource 域名解析不稳 → **官方 tarball**（nodejs.org/dist v22.20.0 → /usr/local）
4. **代码分发**：hub 上 git clone GitHub 被 TLS 干扰（GnuTLS -110）→ **workpc `git archive` 打包 SFTP 上传**（`scripts/hub.py` + `deploy/stage1c.sh`）。后续更新同路径；GitHub 推送仍从 workpc 做
5. **npm**：registry 换 npmmirror
6. **systemd unit 修正**：ExecStart=/usr/local/bin/node **packages/server/dist/index.js**（原 design 写的 dist/server/index.js 路径不对）；unit 已同步回 repo
7. **serve 前置**：管理台需先开 HTTPS（login.tailscale.com/f/serve?node=...，一次性）；然后 `tailscale serve --bg localhost:8787`

## 部署产物

- 服务：`systemctl status dorahub`（Restart=always，开机自启）
- 数据：`/var/lib/dorahub/agent.sqlite` + `audit.jsonl` + `workspace/`
- 密钥：`/etc/dorahub/env`（0600 root）
- 日志：`journalctl -u dorahub -f`

## 已验证（2026-10-16）

- workpc ↔ hub：P2P 直连（direct 101.200.81.183:41641，非 DERP）
- https://hub.tail242752.ts.net：TLS 自动证书，API + PWA + WS 全通
- 云端首条会话：grok-4.7 经 zjl 中转回复正常
- V-05：serve 转发带 Tailscale-User-Login 等身份头（审计可用）
- 崩溃恢复依赖：systemd Restart=always + harness.resume()（M1 已演练）

## 待办

- [ ] 手机装 Tailscale → 浏览器打开上面 URL → PWA 添加到主屏幕（M0 收尾 + M3 真机验收）
- [ ] V-06：手机 Tailscale 与 v2ray 共存性（决定模式 A/B）
- [ ] workpc 在 Tailscale 管理台改名 cyq → workpc（M4 配置 DORAHUB_EXEC_WORKPC_HOST 用）
- [ ] M4 实机验证：workpc 开 Tailscale SSH → hub 配 exec envId → S5 剧本
