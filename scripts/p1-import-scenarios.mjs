/**
 * P1 后续：pi 导入场景测试（对齐 Sig「每个恢复场景有测试文件」，四连 bug 的根因欠账）。
 *
 * 场景矩阵（四类历史坑，2026-10-26 手机同步四连修的回归）：
 *  S1 真实多渠道会话：zhipu-glm-coding-plan 渠道名不在 hub 渠道表 → 归一到可用渠道，不 no_model
 *  S2 envId 语义：导入后 conv_meta.envId 正确 = 源执行机（不是空/hub）
 *  S3 模型归一 warning：归一/降级时返回 warning 字段（P0-5），不静默
 *  S4 幂等：同一文件重复导入 → existing=true，不产生双份会话
 *  S5 导入后可用性：snapshot 有 entries、消息链完整（导入 ≠ 成功，能读历史才算）
 *
 * 数据源：hub 本机真实 pi 会话（~/.pi/agent/sessions）。跑之前确认 hub 有会话目录。
 */
const BASE = "http://127.0.0.1:8787";
let pass = 0, fail = 0;
function ok(cond, name, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? `（${extra}）` : ""}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? `（${extra}）` : ""}`); }
}

async function main() {
  // ---- 找一个 workpc 上的真实会话（dev 环境 hub 的 ~/.pi 在项目目录下不可用，
  //      workpc 的 daemon home = C:/Users/shiyu 才是真实样本源）----
  const sessions = await (await fetch(`${BASE}/api/pi-sessions?env=workpc`)).json();
  if (!Array.isArray(sessions) || sessions.length === 0) {
    console.log("workpc 无 pi 会话样本，跳过");
    process.exit(0);
  }
  const target = sessions[0];
  console.log(`样本: ${target.file}（${target.dir}，${(target.preview ?? "?").slice(0, 30)}）`);

  // ---- S1+S3: 导入（模型归一 + warning 语义）----
  const importReq = { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceEnvId: "workpc", dir: target.dir, file: target.file }) };
  const r1 = await (await fetch(`${BASE}/api/pi-sessions/import`, importReq)).json();
  ok(r1.ok === true && typeof r1.convId === "string", "导入成功", `convId=${r1.convId}`);
  ok(r1.existing !== true, "首次导入不是 existing（软删后的重导 = 新会话）");
  if (r1.warning) {
    ok(typeof r1.warning === "string" && r1.warning.length > 0, "归一 warning 有内容（P0-5）", r1.warning.slice(0, 60));
  } else {
    ok(true, "无 warning（渠道本来就兼容——也是合法路径）");
  }
  const convId = r1.convId;

  // ---- S2: envId 语义（workpc 导入 → envId=workpc）----
  const convs = await (await fetch(`${BASE}/api/conversations`)).json();
  const me = convs.find((c) => c.id === convId);
  ok(!!me, "导入的会话进列表");
  ok(me?.envId === "workpc", "导入后 envId=源执行机", `envId=${JSON.stringify(me?.envId)}`);

  // ---- S4: 幂等 ----
  const r2 = await (await fetch(`${BASE}/api/pi-sessions/import`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceEnvId: "workpc", dir: target.dir, file: target.file }),
  })).json();
  ok(r2.ok === true && r2.existing === true && r2.convId === convId, "重复导入幂等（existing=true 同 convId）");

  // ---- S5: 导入后可用性 ----
  const snap = await (await fetch(`${BASE}/api/conversations/${convId}/snapshot`)).json();
  const entries = snap?.entries ?? [];
  ok(Array.isArray(entries) && entries.length > 0, "snapshot 有历史 entries", `${entries.length} 条`);
  const hasUser = entries.some((e) => e?.kind === "pi.user" || e?.model?.[0]?.role === "user");
  const hasAssistant = entries.some((e) => e?.kind === "pi.assistant" || e?.model?.[0]?.role === "assistant");
  ok(hasUser || hasAssistant, "消息链完整（user/assistant 至少一类）");

  // 模型可用性：agent 配置有 model（不是 no_model）
  ok(!!snap?.agent?.model?.modelId, "agent 配置有 modelId（no_model 回归）", snap?.agent?.model?.modelId ?? "none");
  ok(!!snap?.agent?.model?.provider, "agent 配置有 provider", snap?.agent?.model?.provider ?? "none");

  // ---- 清理（软删，数据保留不影响幂等索引——piSourceIndex 还在，S4 语义不变）----
  await fetch(`${BASE}/api/conversations/${convId}`, { method: "DELETE" });
  console.log(`\n结果: ${pass} 过 / ${fail} 挂（测试会话已软删；piSourceIndex 保留幂等）`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
