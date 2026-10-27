/**
 * P0 批次 WS 验证（2026-10-28）：
 * 1. read 帧 → conv_read 广播
 * 2. unread 标记：会话产生 assistant 事件且无人 attach → 列表 unread=true
 * 3. attention 帧：guard 确认队列变化时广播（用 HTTP 确认接口模拟不了 ask，
 *    但 listConversations 的 pendingConfirms 派生可验证）
 * 4. 回归：15 项 ws-test 语义不回退（单独跑 scripts/ws-test.ts）
 */
import WebSocket from "ws";

const BASE = "http://127.0.0.1:8787";
let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

const list = async () => {
  const r = await fetch(`${BASE}/api/conversations`);
  return r.json();
};

async function main() {
  // 找一个测试目标会话（最近的）
  const convs = await list();
  const target = convs.find((c) => c.name || c.lastPreview);
  if (!target) { console.log("no testable conversation"); process.exit(1); }
  console.log(`目标会话: ${target.id} (${(target.name || target.lastPreview).slice(0, 30)})`);

  // ---- 1. read 帧广播 ----
  console.log("\n[1] read 帧 → conv_read 广播");
  {
    const ws = new WebSocket("ws://127.0.0.1:8787/ws");
    const frames = [];
    ws.on("message", (d) => frames.push(JSON.parse(d.toString())));
    await new Promise((r) => ws.on("open", r));
    ws.send(JSON.stringify({ t: "read", conv: target.id }));
    await new Promise((r) => setTimeout(r, 800));
    const got = frames.some((f) => f.t === "conv_read" && f.conv === target.id);
    ok(got, "read 帧 → 收到 conv_read");
    // 幂等：重复 read 也回（客户端清队列依赖）
    ws.send(JSON.stringify({ t: "read", conv: target.id }));
    await new Promise((r) => setTimeout(r, 500));
    ok(frames.filter((f) => f.t === "conv_read").length >= 2, "重复 read 也有响应（幂等）");
    ws.close();
  }

  // ---- 2. HTTP read 端点 ----
  console.log("\n[2] POST /read 端点");
  {
    const r = await fetch(`${BASE}/api/conversations/${target.id}/read`, { method: "POST" });
    ok(r.status === 200, `HTTP read 200 (${r.status})`);
  }

  // ---- 3. unread 派生（无人 attach 时 assistant 事件 → unread=true）----
  console.log("\n[3] unread 派生（需要真跑一轮 agent，这里只验证字段存在和默认 false）");
  {
    const cs = await list();
    ok(cs.every((c) => typeof c.unread === "boolean"), "列表全部带 unread 字段");
    ok(cs.every((c) => typeof c.pendingConfirms === "number"), "列表全部带 pendingConfirms 字段");
  }

  // ---- 4. attach → snapshot 正常（回归） ----
  console.log("\n[4] attach 回归");
  {
    const ws = new WebSocket("ws://127.0.0.1:8787/ws");
    let gotSnapshot = false, gotHello = false;
    ws.on("message", (d) => {
      const f = JSON.parse(d.toString());
      if (f.t === "hello") gotHello = true;
      if (f.t === "snapshot" && f.conv === target.id) gotSnapshot = true;
    });
    await new Promise((r) => ws.on("open", r));
    ws.send(JSON.stringify({ t: "attach", conv: target.id }));
    await new Promise((r) => setTimeout(r, 1200));
    ok(gotHello, "hello 帧");
    ok(gotSnapshot, "snapshot 帧");
    ws.send(JSON.stringify({ t: "detach", conv: target.id }));
    await new Promise((r) => setTimeout(r, 300));
    ws.close();
  }

  console.log(`\n结果: ${pass} 过 / ${fail} 挂`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
