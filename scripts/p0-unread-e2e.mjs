/**
 * unread 端到端验证：无人 attach 时跑一轮 → 列表 unread=true → read 后清除。
 * 用真渠道（trial/glm-5.3-flash）跑一个极短任务。
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
  // 新建会话
  const cr = await fetch(`${BASE}/api/conversations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cwd: "D:/hobby/pi-durable" }),
  });
  const { id } = await cr.json();
  console.log(`测试会话: ${id}`);

  // 发一条消息（无 WS attach——模拟用户不在场）
  console.log("\n[1] 无人 attach 时跑一轮（发消息后等完成）");
  await fetch(`${BASE}/api/conversations/${id}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: "回复一个字：好", mode: "input" }),
  });

  // 轮询等 run 结束（trial 渠道慢，最长 3 分钟）
  let running = true;
  const t0 = Date.now();
  while (running && Date.now() - t0 < 180_000) {
    await new Promise((r) => setTimeout(r, 3000));
    const cs = await list();
    running = cs.find((c) => c.id === id)?.status === "running";
  }
  ok(!running, "run 结束");

  // [2] unread 应为 true（无人 attach）
  {
    const cs = await list();
    const c = cs.find((x) => x.id === id);
    ok(c?.unread === true, `unread=true（实际 ${c?.unread}）`);
  }

  // [3] read 后清除
  {
    const ws = new WebSocket("ws://127.0.0.1:8787/ws");
    const frames = [];
    ws.on("message", (d) => frames.push(JSON.parse(d.toString())));
    await new Promise((r) => ws.on("open", r));
    ws.send(JSON.stringify({ t: "read", conv: id }));
    await new Promise((r) => setTimeout(r, 600));
    const cs = await list();
    const c = cs.find((x) => x.id === id);
    ok(c?.unread === false, "read 后 unread=false");
    ok(frames.some((f) => f.t === "conv_read" && f.conv === id), "其他设备收到 conv_read");
    ws.close();
  }

  // [4] 有 WS attach 时跑一轮 → 不算 unread（有人看着）
  console.log("\n[4] attach 状态下跑一轮 → 不标 unread");
  {
    const ws = new WebSocket("ws://127.0.0.1:8787/ws");
    await new Promise((r) => ws.on("open", r));
    ws.send(JSON.stringify({ t: "attach", conv: id }));
    await new Promise((r) => setTimeout(r, 800));
    await fetch(`${BASE}/api/conversations/${id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "再回复一个字：行", mode: "input" }),
    });
    let running2 = true;
    const t1 = Date.now();
    while (running2 && Date.now() - t1 < 180_000) {
      await new Promise((r) => setTimeout(r, 3000));
      const cs = await list();
      running2 = cs.find((c) => c.id === id)?.status === "running";
    }
    const cs = await list();
    const c = cs.find((x) => x.id === id);
    ok(c?.unread === false, `attach 期间跑完不算 unread（实际 ${c?.unread}）`);
    ws.send(JSON.stringify({ t: "detach", conv: id }));
    ws.close();
  }

  // 清理：软删除测试会话
  await fetch(`${BASE}/api/conversations/${id}`, { method: "DELETE" });
  console.log(`\n结果: ${pass} 过 / ${fail} 挂（测试会话已软删）`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
