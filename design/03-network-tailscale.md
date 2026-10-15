# 03 · 网络层设计（Tailscale）

## 1. tailnet 拓扑

```
tailnet: <你的名>.ts.net（注册时定，例如 shigu-env.ts.net）

节点（MagicDNS 名 → 100.x.y.z tailnet IP）：
  hub      CentOS VM 15.208.253.20     ← 跑 durahub + serve
  workpc   工作电脑 Windows             ← 浏览器 + exec-agent（M4）
  laptop   移动电脑 Windows             ← 浏览器 + exec-agent（M4 可选）
  phone    Android/iOS                 ← Tailscale app + PWA
```

四个节点装好客户端、登录同一账号即完成组网。个人免费版：6 用户、设备数不限、MagicDNS、ACL 全够。

**v2ray 的角色**：Tailscale 控制面（login.tailscale.com、DERP）在国内的可达性由 v2ray 兜底（系统代理/透明代理均可）。装客户端与登录阶段保证 v2ray 开着。

## 2. hub 上的 serve 配置（M0/M2）

```bash
# hub VM 上
# 1. 前提：tailscaled 运行中，本机已登录
tailscale status

# 2. MagicDNS 确认（应能看到 hub / workpc / laptop / phone）
tailscale status --self

# 3. 占位服务验证（M0）
python3 -m http.server 8787 --bind 127.0.0.1 &
tailscale serve --bg localhost:8787
# 期望输出：Available on https://hub.<tailnet>.ts.net

# 4. 手机/电脑浏览器访问该 URL，看到目录列表即 M0 验收通过
# 5. 验证完关掉占位：
kill %1; tailscale serve reset
```

M2 起，8787 换成 durahub server（systemd 常驻），serve 配置不变。**durahub 永远只听 127.0.0.1**，这是安全基线：攻击面 = tailnet 成员。

### serve 的行为要点（已从官方文档核实 ✅）

- 自动 provision TLS 证书（Let's Encrypt，ts.net 域，自动续期）
- WebSocket 转发开箱即用（反向代理模式）
- 也可以 `tailscale serve --tcp=8788` 做 TCP 直转（exec-agent 用，见 07）
- 重定向注意：serve 后面的应用要返回绝对地址时，用 X-Forwarded-* 头或配置信任（V-05 验证）

## 3. 手机接入的两种模式

### 模式 A（主推）：Tailscale app 常开
- 手机装 Tailscale 客户端，登录同账号，钥匙串常开 VPN
- PWA 地址 = `https://hub.<tailnet>.ts.net`
- 优点：零新增代码；网络层就是身份层（ADR-007）
- 前提：V-06 验证手机上 Tailscale 与 v2ray 是否冲突（iOS 一次只有一个 active VPN profile；Android 看客户端类型）

### 模式 B（备用）：Funnel 公网暴露
```bash
# hub 上（需 tailnet ACL 允许 funnel，个人版默认策略一般已含，报错则看提示改 ACL）
tailscale funnel 443 on
# 之后 https://hub.<tailnet>.ts.net 从公网也可达（经 Tailscale 的公网中继）
```
- 用途：手机不想开/不能开 Tailscale 时的兜底
- **必须**叠加应用层 token（客户端登录时输入，server 校验 `Authorization: Bearer <token>`，token 由 hub 生成存放）
- Funnel 特性（官方文档 ✅）：走 Tailscale 公网中继转发加密流量到本机，**不直接开放本机端口**；固定域名；443/8443/10000 端口
- 演示场景额外用途：把 demo 视频页/只读展示页 funnel 出去给别人看（不暴露写接口）

### 决策树
```
手机上 Tailscale + v2ray 可共存（V-06 通过）？
 ├─ 是 → 模式 A 为主。模式 B 留作兜底，token 认证实现放 M2（HTTP 层中间件，很小）
 └─ 否 → 手机走模式 B（常开 funnel + token）。
         workpc/laptop 仍走模式 A（它们不受 VPN 槽位冲突影响）
```

## 4. Tailscale SSH（运维便利，M0 顺手开）

```bash
# hub 上启用（仅 tailnet 成员可连，认证=设备身份）
tailscale up --ssh
# 之后从 workpc: ssh <user>@hub   （无需 authorized_keys）
```
用途：手机装 Termius 之类的 SSH 客户端 → tailnet 内直接 `ssh user@hub` 查看 hub 状态/日志，作为 PWA 之外的应急通道。

## 5. ACL（个人版 3 组够用，M4 后收紧）

默认 ACL = 同 tailnet 内互信，MVP 阶段不用改。M4 后如想练习收紧（也是简历点）：

```jsonc
// Tailscale 管理台 → Access Controls（示意）
{
  "tagOwners": { "tag:hub": ["autogroup:admin"], "tag:exec": ["autogroup:admin"] },
  "acls": [
    // 所有设备可访问 hub 的 serve（HTTPS 443）
    { "action": "accept", "src": ["*"], "dst": ["tag:hub:443"] },
    // 只有 hub 可访问 exec-agent 端口
    { "action": "accept", "src": ["tag:hub"], "dst": ["tag:exec:8788"] }
  ]
}
```
注意：打 tag 的机器需要重新 `tailscale up --advertise-tags=tag:exec` 认证一次。列为 M5 可选。

## 6. 自托管进阶（M5 可选，简历价值最高的网络层模块）

| 组件 | 作用 | 部署位置 |
|---|---|---|
| **headscale** | 替代官方控制服务器（密钥交换/节点注册/IP 分配/ACL），单 tailnet 自托管 | hub VM（Docker 或二进制）|
| **derper** | 自建 DERP 中继，解决官方海外中继慢 | 同上或另一 VPS |

收益：控制面数据面全自持 + 实测中继性能。成本：多一套组件运维。**注意 headscale 官方不鼓励反代和容器跑**（README 原话），VM 上直接二进制部署最顺。做之前读 headscale.net/stable 文档与 Tailscale 版本兼容说明。

## 7. 验收清单（M0）

- [ ] 四节点 `tailscale status` 全部互相可见
- [ ] workpc `ping hub`（MagicDNS）通
- [ ] phone Safari/Chrome 打开 `https://hub.<tailnet>.ts.net` 见占位页
- [ ] `tailscale serve status` 显示配置
- [ ] V-06 结论回写 00 号文档（手机模式定 A 还是 B）
- [ ] （顺手）Tailscale SSH：workpc 免密 `ssh user@hub` 通
