/**
 * M1 CLI 试玩（设计 10 §M1 任务 1.4）：终端里把 submit / steer / abort /
 * watchEvents / fork / 崩溃恢复全走一遍。
 *
 * 用法（workpc 本地开发）：
 *   ZJL_BASE_URL=... ZJL_API_KEY=... node scripts/play.ts [--db dev.sqlite] [--cwd .]
 * 命令（stdin，一行一条）：
 *   ask <text>            普通提交（follow-up 排队）
 *   steer <text>          转向提交（busy 时插入当前工具轮后）
 *   abort                 中止当前运行
 *   new                   新建会话（后续命令作用于最新会话）
 *   switch <n>            切换到第 n 个会话（0 起）
 *   fork <entryId|last>   在最后一条 entry 处分叉
 *   ls                    列出会话与运行状态
 *   quit                  优雅退出（验证 close）
 *
 * 事件流：每个会话打印 watchEvents 的事件摘要（message_start/update、
 * tool_execution_start/end、run_start/end、snapshot 等），即 05 协议的原始素材。
 */
import { createInterface } from "node:readline/promises";
import { watchEvents } from "@earendil-works/pi-durable";
import type { AgentEvent, Conversation, Harness } from "@earendil-works/pi-durable";
import { context, defaultAgent, startHarness } from "../packages/server/src/harness.ts";

const args = process.argv.slice(2);
const flag = (name: string, fallback?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const dbPath = flag("db", "dev.sqlite");
const cwd = flag("cwd", process.cwd());
const modelId = flag("model", "grok-4.7");

const zjlBaseUrl = process.env.ZJL_BASE_URL ?? process.env.DORAHUB_ZJL_BASE_URL;
const zjlApiKey = process.env.ZJL_API_KEY ?? process.env.DORAHUB_ZJL_API_KEY;
if (!zjlBaseUrl || !zjlApiKey) {
  console.error("need ZJL_BASE_URL and ZJL_API_KEY env");
  process.exit(1);
}

function fmtEvent(ev: AgentEvent): string {
  switch (ev.type) {
    case "snapshot":
      return `snapshot: ${ev.entries.length} entries, ${ev.tools.length} live tools, inbox=${ev.inbox.length}, model=${ev.agent.model?.modelId ?? "?"}`;
    case "run_start":
      return `run_start (inputs: ${ev.inputs.join(",")})`;
    case "run_end":
      return `run_end`;
    case "turn_start":
    case "turn_end":
      return ev.type;
    case "message_start":
      return `message_start (${ev.message.role})`;
    case "message_update": {
      const parts = ev.changes.map((c) => c.type).join(",");
      return `message_update: ${parts}`;
    }
    case "message_end":
      return `message_end (entry ${ev.entry.id})`;
    case "tool_execution_start":
      return `tool_start: ${ev.toolName} ${JSON.stringify(ev.args).slice(0, 120)}`;
    case "tool_execution_update":
      return `tool_update: ${ev.toolCallId} ${ev.output ? ("set" in ev.output ? `set ${ev.output.set.length}B` : `append ${ev.output.append?.length ?? 0}B`) : ""}`;
    case "tool_execution_end":
      return `tool_end: ${ev.toolCallId}${ev.entry ? " (entry)" : ""}`;
    case "inbox_update":
      return `inbox_update: ${ev.items.map((i) => `${i.id}:${i.mode}`).join(" ")}`;
    case "submission":
      return `submission ${ev.record.id} -> ${ev.record.status}`;
    case "entry_appended":
      return `entry_appended: ${ev.entry.id} kind=${ev.entry.kind}`;
    case "agent_changed":
      return `agent_changed: model=${ev.agent.model?.modelId ?? "?"} cwd=${ev.agent.cwd ?? "?"}`;
    case "usage_changed":
      return `usage_changed: ${JSON.stringify(ev.usage)}`;
    case "compaction_start":
      return `compaction_start (${ev.reason})`;
    case "compaction_end":
      return `compaction_end${ev.error ? ` ERROR: ${ev.error}` : ""}`;
    case "task_failed":
      return `task_failed: ${ev.kind}: ${ev.message}`;
    default:
      return ev.type;
  }
}

interface ConvEntry {
  conv: Conversation;
  stopEvents?: () => Promise<unknown>;
}

async function watchConv(harness: Harness, conv: Conversation, label: string) {
  const streamEvents = await watchEvents(harness, conv.id, context);
  console.log(`[${label}] ${fmtEvent(streamEvents.snapshot)}`);
  await streamEvents.start(async (events) => {
    for (const ev of events) console.log(`[${label}] ${fmtEvent(ev)}`);
  });
  return () => streamEvents.stop();
}

async function main() {
  console.log(`opening harness: db=${dbPath} cwd=${cwd} model=${modelId}`);
  const harness = await startHarness({
    dbPath,
    zjlBaseUrl,
    zjlApiKey,
    defaultCwd: cwd,
    defaultModelId: modelId,
  });

  const root = await harness.root(context, { agent: defaultAgent(cwd, modelId) });
  console.log(`root conversation: ${root.id}`);

  const convs: ConvEntry[] = [{ conv: root }];
  let current = 0;
  let stopEvents = await watchConv(harness, root, "root");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.on("SIGINT", async () => {
    console.log("\n^C — aborting current conversation run…");
    await convs[current].conv.abort(context).catch((e) => console.log("abort:", e.message));
  });

  console.log("\ncommands: ask <text> | steer <text> | abort | new | switch <n> | fork | ls | quit\n");

  loop: for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const space = trimmed.indexOf(" ");
    const cmd = space < 0 ? trimmed : trimmed.slice(0, space);
    const rest = space < 0 ? "" : trimmed.slice(space + 1);
    const cur = convs[current];

    switch (cmd) {
      case "ask":
      case "steer": {
        console.log(`[cmd] ${cmd}: ${rest}`);
        try {
          const sub = await cur.conv.submit(
            {
              type: "input",
              content: rest,
              whenBusy: cmd === "steer" ? "steer" : "followUp",
              requestId: `cli-${Date.now()}`,
            },
            context,
          );
          console.log(`submitted ${sub.id}`);
          const settled = await sub.wait(context);
          console.log(`settled: ${settled.status}`);
        } catch (e: any) {
          console.log(`submit error: ${e.message}`);
        }
        break;
      }
      case "abort":
        await cur.conv.abort(context);
        console.log("aborted.");
        break;
      case "new": {
        const conv = await harness.createConversation(
          { ownership: { kind: "ownerless" }, agent: defaultAgent(cwd, modelId) },
          context,
        );
        await stopEvents?.();
        stopEvents = await watchConv(harness, conv, `#${convs.length}`);
        convs.push({ conv });
        current = convs.length - 1;
        console.log(`new conversation ${conv.id}, current #${current}`);
        break;
      }
      case "switch": {
        const n = Number(rest);
        if (Number.isInteger(n) && n >= 0 && n < convs.length) {
          await stopEvents?.();
          current = n;
          stopEvents = await watchConv(harness, convs[n].conv, `#${n}`);
          console.log(`switched to #${n} (${convs[n].conv.id})`);
        } else console.log("bad index");
        break;
      }
      case "fork": {
        const page = await cur.conv.entries({ order: "descending" }, 1, undefined, context);
        const last = page.entries[0];
        if (!last) { console.log("no entries to fork at"); break; }
        const forked = await cur.conv.fork(last.id, { ownership: { kind: "ownerless" } }, context);
        await stopEvents?.();
        stopEvents = await watchConv(harness, forked, `#${convs.length}`);
        convs.push({ conv: forked });
        current = convs.length - 1;
        console.log(`forked at ${last.id} -> ${forked.id}`);
        break;
      }
      case "ls": {
        for (let i = 0; i < convs.length; i++) {
          const view = await convs[i].conv.viewState(context);
          const v = view.value;
          console.log(
            `#${i} ${convs[i].conv.id}${i === current ? " *" : " "} entries=${v.entries.length} docs=${Object.keys(v.docs).join(",")}`,
          );
        }
        break;
      }
      case "quit":
        break loop;
      default:
        console.log(`unknown command: ${cmd}`);
    }
  }

  await stopEvents?.();
  await harness.close(context);
  console.log("closed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
