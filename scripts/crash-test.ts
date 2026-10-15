/**
 * M1 崩溃恢复演练（设计 10 §M1 任务 1.5，11-S4 命令行版）。
 *
 * 用法：
 *   phase1: 提交长任务，等到第 2 个工具调用开始后自杀（SIGKILL 自身）
 *   phase2: 重新打开同一 storage → resume() → 观察断点续跑
 *
 *   ZJL_* env... node scripts/crash-test.ts phase1 --db /tmp/crash.sqlite
 *   ZJL_* env... node scripts/crash-test.ts phase2 --db /tmp/crash.sqlite
 */
import { watchEvents } from "@earendil-works/pi-durable";
import { context, defaultAgent, startHarness } from "../packages/server/src/harness.ts";

const args = process.argv.slice(2);
const phase = args[0];
const dbPath = args.includes("--db") ? args[args.indexOf("--db") + 1] : "/tmp/durahub-crash.sqlite";

const zjlBaseUrl = process.env.ZJL_BASE_URL ?? process.env.DURAHUB_ZJL_BASE_URL;
const zjlApiKey = process.env.ZJL_API_KEY ?? process.env.DURAHUB_ZJL_API_KEY;
if (!zjlBaseUrl || !zjlApiKey) {
  console.error("need ZJL_BASE_URL and ZJL_API_KEY env");
  process.exit(1);
}

const cwd = "D:/hobby/pi-durable/design";

async function open() {
  const harness = await startHarness({
    dbPath,
    zjlBaseUrl,
    zjlApiKey,
    defaultCwd: cwd,
    defaultModelId: "grok-4.7",
  });
  const root = await harness.root(context, { agent: defaultAgent(cwd, "grok-4.7") });
  return { harness, root };
}

function summarize(ev: any): string {
  switch (ev.type) {
    case "tool_execution_start": return `tool_start ${ev.toolName}`;
    case "tool_execution_end": return `tool_end ${ev.toolName ?? ev.toolCallId}`;
    case "message_end": return `message_end kind=${ev.entry?.kind}`;
    case "task_failed": return `task_failed ${ev.kind}: ${ev.message}`;
    case "submission": return `submission ${ev.record.status}`;
    case "run_start": return "run_start";
    case "run_end": return "run_end";
    case "snapshot": return `snapshot entries=${ev.entries.length}`;
    default: return ev.type;
  }
}

if (phase === "phase1") {
  const { harness, root } = await open();
  console.log("[phase1] submitting long task…");
  const events = await watchEvents(harness, root.id, context);
  let toolStarts = 0;
  let killed = false;
  await events.start(async (evs) => {
    for (const ev of evs) {
      console.log("[phase1]", summarize(ev));
      if (ev.type === "tool_execution_start") {
        toolStarts++;
        if (toolStarts >= 2 && !killed) {
          killed = true;
          console.log(`[phase1] 2nd tool call started — SIGKILL self NOW (pid=${process.pid})`);
          // 同步自杀，不给 pi-durable 任何清理机会
          process.kill(process.pid, "SIGKILL");
        }
      }
    }
  });
  await root.submit(
    { type: "input", content: "逐个读取当前目录下 00、01、02、03、04 这五个文件，每个读完都各输出一行总结。", requestId: "crash-test-1" },
    context,
  );
  // 等不到 settle（会被杀），挂住
  await new Promise(() => {});
} else if (phase === "phase2") {
  const { harness, root } = await open(); // startHarness 里已经 harness.resume()
  console.log("[phase2] reopened, resuming…");
  const events = await watchEvents(harness, root.id, context);
  console.log("[phase2] snapshot:", events.snapshot.entries.map((e: any) => e.kind).join(","));
  let done = false;
  await events.start(async (evs) => {
    for (const ev of evs) {
      console.log("[phase2]", summarize(ev));
      if (ev.type === "submission" && (ev.record.status === "done" || ev.record.status === "unanswered")) {
        console.log("[phase2] SUBMISSION SETTLED:", ev.record.status);
        done = true;
      }
    }
  });
  // 轮询等待任务完成
  const t0 = Date.now();
  while (!done && Date.now() - t0 < 240_000) {
    await new Promise((r) => setTimeout(r, 500));
  }
  const view = await root.viewState(context);
  console.log("[phase2] final entries:", view.value.entries.map((e: any) => e.kind).join(","));
  console.println?.();
  await events.stop();
  await harness.close(context);
  console.log("[phase2] done, exit 0");
  process.exit(done ? 0 : 2);
} else {
  console.error("usage: crash-test.ts phase1|phase2 --db <path>");
  process.exit(1);
}
