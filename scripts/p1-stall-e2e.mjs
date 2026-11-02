/**
 * P1-2 卡死检测 e2e：需要 server 以 DORAHUB_STALL_MS=5000（5 秒）启动。
 * 场景：
 * 1. 提交一个真任务（trial 免费模型），等 running
 * 2. 任务完成后 status=idle，stalledMinutes 恒 null（跑完的会话不误报）
 * 3. 模拟卡死：提交任务后人为等待超过阈值（用 shell sleep 任务不产生事件……
 *    实际上提交后 run_start 就是事件，之后 sleep 5s+ 无事件 → 应标 stalled）
 * 4. 事件恢复 → stalledMinutes 回 null（conv_stalled 帧 minutes=null）
 * 5. idle 会话永不标 stalled
 *
 * 注意：本测试真实调 LLM（trial/glm-5.3-flash），跑一轮 1-2 分钟是常态。
 */
import WebSocket from "ws";

const BASE = "http://127.0.0.1:8787";
const WS_URL = "ws://127.0.0.1:8787/ws";
let pass = 0, fail = 0;
function ok(cond, name, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? `（${extra}）` : ""}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? `（${extra}）` : ""}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = async () => (await fetch(`${BASE}/api/conversations`)).json();

async function main() {
  // 前置：server 必须以 DORAHUB_STALL_MS 启动，否则本测试要等 15 分钟
  const stallMs = Number(process.env.DORAHUB_STALL_MS) || 5000;
  console.log(`假设 server STALL_MS=${stallMs}ms（服务端默认 15min，测试脚本不传则假设 5s）`);

  // ---- 建会话 ----
  const created = await (await fetch(`${BASE}/api/conversations`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  })).json();
  const id = created.id;
  console.log(`测试会话: ${id}`);

  // ---- 1. idle 会话永不标 stalled ----
  let cs = await list();
  let me = cs.find((c) => c.id === id);
  ok(me.stalledMinutes == null, "idle 会话 stalledMinutes=null");

  // ---- 2. WS 收 conv_stalled 帧 ----
  const frames = [];
  const ws = new WebSocket(WS_URL);
  await new Promise((r) => ws.once("open", r));
  ws.on("message", (d) => {
    try { frames.push(JSON.parse(d.toString())); } catch {}
  });

  // ---- 3. 提交慢任务（sleep 长命令，run_start 后长时间无事件）----
  // 用 hub 本地执行机跑 sleep：提交后 run_start/message 事件到达，然后静默
  const submitted = await (await fetch(`${BASE}/api/conversations/${id}/messages`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "用 bash 执行 sleep 30，不要做别的，执行完回复 done" }),
  })).json();
  ok(!!submitted, "任务已提交");

  // 等 running
  let running = false;
  for (let i = 0; i < 30; i++) {
    cs = await list();
    me = cs.find((c) => c.id === id);
    if (me.status === "running") { running = true; break; }
    await sleep(1000);
  }
  ok(running, "会话进入 running");

  // 等卡死：阈值 + 扫描间隔（60s 扫一次！）+ 余量
  // 注意：扫描间隔是写死的 60s，所以最坏要等 阈值+60s
  let stalledAt = null;
  const waitMs = stallMs + 75_000;
  for (let i = 0; i < Math.ceil(waitMs / 3000); i++) {
    cs = await list();
    me = cs.find((c) => c.id === id);
    if (me.stalledMinutes != null) { stalledAt = me.stalledMinutes; break; }
    await sleep(3000);
  }
  ok(stalledAt != null, `卡死标记出现（stalledMinutes=${stalledAt}）`);
  const stalledFrame = frames.find((f) => f.t === "conv_stalled" && f.conv === id && f.minutes != null);
  ok(!!stalledFrame, "WS 收到 conv_stalled 帧");

  // ---- 4. 任务结束 → 事件恢复/状态回 idle → stalled 清除 ----
  let cleared = false;
  for (let i = 0; i < 90; i++) {
    cs = await list();
    me = cs.find((c) => c.id === id);
    if (me.status === "idle" && me.stalledMinutes == null) { cleared = true; break; }
    await sleep(3000);
  }
  ok(cleared, "任务结束后 stalled 清除且 status=idle");
  const recoverFrame = frames.find((f) => f.t === "conv_stalled" && f.conv === id && f.minutes == null);
  ok(!!recoverFrame, "WS 收到恢复帧（minutes=null）");

  // ---- 清理 ----
  await fetch(`${BASE}/api/conversations/${id}`, { method: "DELETE" });
  ws.close();
  console.log(`\n结果: ${pass} 过 / ${fail} 挂（测试会话已软删）`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
