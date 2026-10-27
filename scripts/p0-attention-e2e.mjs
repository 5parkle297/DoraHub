/**
 * attention 链路端到端验证（P0-2）：
 * guard 确认卡弹出 → 列表 pendingConfirms 派生 + attention 帧（不 attach 的客户端也收到）
 * → 拒绝 → 归零。
 */
import WebSocket from "ws";

const BASE = "http://127.0.0.1:8787";
let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}
const list = async () => (await fetch(`${BASE}/api/conversations`)).json();

async function main() {
  const cr = await fetch(`${BASE}/api/conversations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cwd: "D:/hobby/pi-durable" }),
  });
  const { id } = await cr.json();
  console.log(`测试会话: ${id}`);

  // 观察者：不 attach，纯听全局帧（attention 是广播）
  const watcher = new WebSocket("ws://127.0.0.1:8787/ws");
  const attentionFrames = [];
  watcher.on("message", (d) => {
    const f = JSON.parse(d.toString());
    if (f.t === "attention" && f.conv === id) attentionFrames.push(f.pending);
  });
  await new Promise((r) => watcher.on("open", r));

  // 触发 guard（git push 命中 alwaysAsk）
  await fetch(`${BASE}/api/conversations/${id}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: "请用 bash 工具执行：git push origin main", mode: "input" }),
  });
  console.log("已提交 git push 请求，等确认卡…");

  // 轮询列表等 pendingConfirms > 0（trial 渠道慢，最长 5 分钟）
  let pending = 0;
  const t0 = Date.now();
  while (pending === 0 && Date.now() - t0 < 300_000) {
    await new Promise((r) => setTimeout(r, 3000));
    const cs = await list();
    const me = cs.find((c) => c.id === id);
    if (!me) break; // 会话没了（异常）
    pending = me.pendingConfirms ?? 0;
  }
  ok(pending > 0, `列表 pendingConfirms=${pending}（>0）`);
  ok(attentionFrames.includes(pending), `观察者收到 attention 帧（帧序列 ${JSON.stringify(attentionFrames)}）`);

  // 拒绝
  const confirms = await (await fetch(`${BASE}/api/confirmations`)).json();
  const mine = confirms.find((c) => c.conv === id);
  ok(!!mine, `/api/confirmations 里有该会话的确认项`);
  if (mine) {
    const r = await fetch(`${BASE}/api/confirmations/${mine.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approved: false }),
    });
    ok(r.status === 200, "拒绝成功");
    // 拒绝后 attention 归零
    await new Promise((r) => setTimeout(r, 1000));
    const cs = await list();
    const after = cs.find((c) => c.id === id)?.pendingConfirms ?? -1;
    ok(after === 0, `拒绝后 pendingConfirms=0（实际 ${after}）`);
    ok(attentionFrames.includes(0), `attention 帧序列含 0（${JSON.stringify(attentionFrames)}）`);
  }

  // 等 run 结束后清理（拒绝后 agent 还要收尾——不等人会话还往 canal 发事件，
  // 虽然已软删，但流还在）——最多再等 60s
  const t2 = Date.now();
  let running = true;
  while (running && Date.now() - t2 < 60_000) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      const snap = await (await fetch(`${BASE}/api/conversations/${id}/snapshot`)).json();
      running = false; // snapshot 拿到就够（软删后无法查 status，直接退）
    } catch { break; }
  }
  await fetch(`${BASE}/api/conversations/${id}`, { method: "DELETE" });
  watcher.close();
  console.log(`\n结果: ${pass} 过 / ${fail} 挂（测试会话已软删）`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
