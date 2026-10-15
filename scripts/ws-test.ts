/**
 * M2 验收测试（设计 05 §6 T-01/T-02/T-04/T-05/T-06 的自动化版本）。
 * 前置：server 已在 127.0.0.1:8787 跑，DB 是干净的。
 *
 *   node scripts/ws-test.ts
 */
import WebSocket from "ws";

const BASE = "http://127.0.0.1:8787";
const WS_URL = "ws://127.0.0.1:8787/ws";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail?: any) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`, detail ?? ""); }
}

async function api(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  return { status: res.status, body: await res.json() };
}

function wsConnect(): Promise<{ ws: WebSocket; frames: any[]; wait: (pred: (f: any) => boolean, ms?: number) => Promise<any> }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(WS_URL);
    const frames: any[] = [];
    const waiters: { pred: (f: any) => boolean; resolve: (f: any) => void; timer: NodeJS.Timeout }[] = [];
    ws.on("message", (data) => {
      const f = JSON.parse(data.toString());
      frames.push(f);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].pred(f)) {
          clearTimeout(waiters[i].timer);
          waiters[i].resolve(f);
          waiters.splice(i, 1);
        }
      }
    });
    ws.on("open", () => {
      resolve({
        ws,
        frames,
        wait: (pred, ms = 30_000) =>
          new Promise((res2, rej) => {
            for (const f of frames) if (pred(f)) return res2(f);
            const timer = setTimeout(() => rej(new Error("wait timeout")), ms);
            waiters.push({ pred, resolve: res2, timer });
          }),
      });
    });
  });
}

async function main() {
  console.log("== T-01: 双客户端 attach 同会话 ==");

  // 建会话
  const created = await api("/api/conversations", { method: "POST", body: JSON.stringify({ name: "ws-test" }) });
  const convId = created.body.id;
  check("create conversation", created.status === 200 && !!convId, created);

  const a = await wsConnect();
  const b = await wsConnect();
  await a.wait((f) => f.t === "hello");
  await b.wait((f) => f.t === "hello");
  check("hello a", a.frames.some((f) => f.t === "hello"));
  check("hello b", b.frames.some((f) => f.t === "hello"));

  a.ws.send(JSON.stringify({ t: "attach", conv: convId }));
  b.ws.send(JSON.stringify({ t: "attach", conv: convId }));
  await a.wait((f) => f.t === "snapshot" && f.conv === convId);
  await b.wait((f) => f.t === "snapshot" && f.conv === convId);
  check("both got snapshot", true);

  // T-05 幂等：同 requestId 两次
  const reqId = `idem-${Date.now()}`;
  const r1 = await api(`/api/conversations/${convId}/messages`, { method: "POST", body: JSON.stringify({ content: "回复一个字：好", mode: "input", requestId: reqId }) });
  const r2 = await api(`/api/conversations/${convId}/messages`, { method: "POST", body: JSON.stringify({ content: "回复一个字：好", mode: "input", requestId: reqId }) });
  check("T-05 idempotent requestId", r1.body.submissionId === r2.body.submissionId, { r1: r1.body, r2: r2.body });

  // 两端都应看到事件流（run_start → … → run_end）
  const doneA = await a.wait((f) => f.t === "events" && f.events?.some((e: any) => e.type === "run_end"));
  const doneB = await b.wait((f) => f.t === "events" && f.events?.some((e: any) => e.type === "run_end"));
  check("T-01 both clients saw run_end", !!doneA && !!doneB);

  // conv_status 帧出现过 running
  const sawRunning = await a.wait((f) => f.t === "conv_status" && f.status === "running", 15_000).catch(() => null);
  check("conv_status running observed", !!sawRunning, "（小任务可能没赶上，宽容）");

  console.log("== T-04: steer 到 running 会话 ==");
  // 跑个多轮工具任务
  const r3 = await api(`/api/conversations/${convId}/messages`, { method: "POST", body: JSON.stringify({ content: "用 bash 工具依次运行 echo one; sleep 2; echo two; sleep 2; echo three 三条命令（分三次调用），然后告诉我总共输出了什么", mode: "input" }) });
  check("submit long task", r3.status === 200, r3);
  await a.wait((f) => f.t === "conv_status" && f.status === "running", 20_000).catch(() => {});
  // running 时提交 steer
  const steer = await api(`/api/conversations/${convId}/messages`, { method: "POST", body: JSON.stringify({ content: "不用真的 sleep 2，改为直接 echo", mode: "steer" }) });
  check("T-04 steer accepted while running", steer.status === 200, steer);
  const steerSettled = await a.wait(
    (f) => f.t === "events" && f.events?.some((e: any) => e.type === "run_end"),
    120_000,
  ).catch(() => null);
  check("run ended after steer", !!steerSettled);

  console.log("== T-06: abort ==");
  const r4 = await api(`/api/conversations/${convId}/messages`, { method: "POST", body: JSON.stringify({ content: "用 bash 依次执行 5 次 sleep 3，每次一条命令，全部完成后汇报", mode: "input" }) });
  check("submit sleep task", r4.status === 200);
  await a.wait((f) => f.t === "conv_status" && f.status === "running", 30_000).catch(() => {});
  const abortRes = await api(`/api/conversations/${convId}/abort`, { method: "POST" });
  check("T-06 abort ok", abortRes.status === 200, abortRes);
  const idleAgain = await a.wait((f) => f.t === "conv_status" && f.status === "idle", 30_000).catch(() => null);
  check("back to idle after abort", !!idleAgain);

  console.log("== fork ==");
  const forked = await api(`/api/conversations/${convId}/fork`, { method: "POST", body: "{}" });
  check("fork at latest", forked.status === 200 && !!forked.body.id, forked);
  if (forked.status === 200) {
    const snap = await api(`/api/conversations/${forked.body.id}/snapshot`);
    check("fork has parent history", Array.isArray(snap.body?.entries) && snap.body.entries.length > 0, { n: snap.body?.entries?.length });
  }

  a.ws.close();
  b.ws.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
