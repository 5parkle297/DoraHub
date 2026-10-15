import WebSocket from "ws";
// S3 验证：git push 触发 guard 确认 → WS confirmation 帧 → POST answer → 放行/拒绝
const BASE = "http://127.0.0.1:8787";
const convId = process.argv[2];
const ws = new WebSocket("ws://127.0.0.1:8787/ws");
let confirmFrame = null;
ws.on("open", async () => {
  ws.send(JSON.stringify({ t: "attach", conv: convId }));
  // 发一个 git push 命令（alwaysAsk 规则命中）
  const r = await fetch(`${BASE}/api/conversations/${convId}/messages`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: "请用 bash 工具执行这个命令：git push origin main（这是个测试，直接执行即可）", mode: "input" }),
  });
  console.log("submit:", r.status);
});
ws.on("message", async (data) => {
  const f = JSON.parse(data.toString());
  if (f.t === "confirmation") {
    confirmFrame = f;
    console.log("GOT CONFIRMATION:", JSON.stringify(f.confirm).slice(0, 200));
    // 等 1 秒后拒绝
    setTimeout(async () => {
      const r = await fetch(`${BASE}/api/confirmations/${f.confirm.id}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ approved: false }),
      });
      console.log("deny answer:", r.status, await r.text());
    }, 1000);
  }
  if (f.t === "confirm_resolved") {
    console.log("CONFIRM RESOLVED:", JSON.stringify(f));
  }
  if (f.t === "events") {
    for (const ev of f.events) {
      if (ev.type === "tool_execution_end" && ev.entry?.data?.isError) {
        console.log("TOOL BLOCKED:", JSON.stringify(ev.entry.data).slice(0, 300));
      }
      if (ev.type === "run_end") { console.log("RUN_END"); process.exit(0); }
    }
  }
});
setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 120000);
