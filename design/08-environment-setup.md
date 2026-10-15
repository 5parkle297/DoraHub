# 08 · 环境准备手册（四台机器）

> 逐台清单。带 ✅ 的命令在 M0 直接执行；⚠️ 标记的先做 V-0x 验证。

## 1. hub（CentOS VM 15.208.253.20）

```bash
# —— 1.1 Tailscale（Distro 仓库或官方脚本，CentOS 用 pkgs.tailscale.com）
sudo curl -fsSL https://pkgs.tailscale.com/stable/centos/9/tailscale.repo \
  -o /etc/yum.repos.d/tailscale.repo
sudo dnf install -y tailscale
sudo systemctl enable --now tailscaled
sudo tailscale up            # ⚠️ 需 v2ray 可达 login.tailscale.com；浏览器完成登录

# —— 1.2 Node.js ≥22（pi-durable 要求的现代运行时；用 nodesource 或 nvm）
curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
sudo dnf install -y nodejs
node -v                       # ≥ 22

# —— 1.3 运行账户与目录
sudo useradd -r -s /usr/sbin/nologin durahub
sudo mkdir -p /opt/durahub /var/lib/durahub /etc/durahub
sudo chown -R durahub:durahub /var/lib/durahub

# —— 1.4 密钥文件（不进 git）
sudo tee /etc/durahub/env >/dev/null <<'EOF'
ZJL_BASE_URL=https://你的中转地址/v1
ZJL_API_KEY=sk-xxx
EOF
sudo chmod 600 /etc/durahub/env

# —— 1.5 git（部署用）
sudo dnf install -y git
```

## 2. workpc（工作电脑，Windows）

1. **Tailscale 客户端**：https://tailscale.com/download 下载 Windows 版（需要 TUN，安装时允许）→ 登录同账号 → MagicDNS 名建议改成 `workpc`（管理台改机器名）
2. **Node.js ≥22 LTS**：官网 MSI，勾选"Add to PATH"（M2 后开发与 M4 的 exec-agent 都需要）
3. **Git**（已有则跳过）
4. **浏览器**：Chrome/Edge 任一（PWA 开发与日常使用）
5. **项目仓库**：`git clone <你的仓库> F:\pi-durable\durahub`（或新初始化，结构见 09）
6. **（M4）WSL2 或 Git Bash**：bash 工具在 Windows 的执行端，见 §3

## 3. ⚠️ V-04：workpc 上 bash 执行端的三方案（M4 前定）

pi 的 bash 工具是 bash 语义。workpc 上给 exec-agent 提供 bash 有三条路：

| 方案 | 做法 | 优劣 |
|---|---|---|
| W-a. WSL2 | `wsl --install -d Ubuntu`，exec-agent 在 WSL 内跑 | 最完整的 Linux 体验（用户的 pi 平时就跑在 WSL：本会话 cwd 即 /mnt/f/...）；但 WSL 文件系统桥接（/mnt/f）IO 慢，且 WSL 需保持运行 |
| W-b. Git Bash | 只装 Git for Windows，exec-agent 用 `bash.exe -c` | 轻；部分命令行为差异（path 转换）；无完整 coreutils 之外的命令 |
| W-c. 双模式 | exec-agent 配置项 `shell: "wsl"|"gitbash"`，探测优先 WSL | 实现小代价，体验最优——**推荐**，也是简历可讲细节（Windows 下 agent 执行环境的兼容层） |

验证顺序：`wsl --status` 可用 → W-a；否则 Git Bash → W-b；都装上做成 W-c。
注意路径语义要统一：会话 cwd 用 Windows 形式（`F:\work\repo`）时 WSL 内转成 `/mnt/f/work/repo`（exec-agent 做一层转换）。

## 4. laptop（移动电脑，Windows）

同 workpc 的 1-2-4 项（Tailscale + Node + 浏览器）。exec-agent 可选（M4 再说）。**本设计文档就在这台机器上（F:\pi-durable\design），开工时整体推到 git 远端**。

## 5. phone（Android/iOS）

1. 安装 Tailscale：Google Play / App Store（国内网络：Android 可用 APK：https://pkgs.tailscale.com/stable/#android ⚠️ 或镜像站）
2. 登录同账号，钥匙串常开
3. ⚠️ **V-06 验证**：开着 Tailscale 时 v2ray 客户端是否还能正常工作（iOS 一次仅一个 active VPN profile；Android 看 v2ray 客户端类型——若冲突，phone 走模式 B，见 03 §3）
4. 浏览器（Chrome/Safari）访问 `https://hub.<tailnet>.ts.net`，收藏；M3 后"添加到主屏幕"安装 PWA

## 6. LLM 中转（zjl）确认事项 ⚠️ V-02

hub 的模型调用走用户现有 zjl 中转（OpenAI 兼容）。M1 时在 workpc 上确认：

1. `node_modules/@earendil-works/pi-ai/README.md` 里 provider 自定义端点的配置面（`openaiProvider()` 是否收 baseURL/apiKey；不行则看自定义 provider 写法）
2. 用户 pi 的 `providers.md` / `auth.json`（`~/.pi/agent/`）里 zjl 的配置就是事实来源：**把 pi 已用的 baseURL/key 复制进 hub 的 /etc/durahub/env**
3. 可用模型清单（glm-5.3 / grok-4.7 等）逐个在 hub 上发一次最小请求验证
4. 结论（baseURL 形态、provider 写法、可用模型列表）回写 00 号文档 V-02 条目

## 7. 仓库与远程

- 远端：用户的私有 GitHub/Gitea 仓库（`durahub`）
- 部署流（M2 起）：workpc 开发 → push → hub 上 `git pull && npm ci && npm run build && sudo systemctl restart durahub`（写个 `deploy.sh` 一键化，见 09）
