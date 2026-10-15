/**
 * GuardExtension（US-05 权限拦截，设计 04 §5）。
 *
 * 机制：ToolTask beforeTool hook + api.memo 持久化决策 + WS confirmation 帧。
 * - DANGEROUS 匹配 → 查 memo（崩溃重启后不重复询问）→ 无记录则推确认卡等用户决定
 * - 决策 memo 化：approved=true 放行（返回 undefined），false 返回 { block }
 * - 超时 10 分钟默认拒绝（fail-closed）
 */
import { readFileSync } from "node:fs";
import { hook, ToolTask, defineExtension } from "@earendil-works/pi-durable";
import type { JsonObject } from "@earendil-works/pi-durable";
import type { ConfirmationItem } from "@durahub/shared";

export interface GuardRules {
  /** bash 命令直接拒绝的正则（不询问） */
  bashDeny: string[];
  /** bash 命令需要确认的正则 */
  alwaysAsk: string[];
  /** write/edit 目标在 cwd 之外时需要确认 */
  writeOutsideCwd: boolean;
}

export function loadGuardRules(path: string): GuardRules {
  return JSON.parse(readFileSync(path, "utf8")) as GuardRules;
}

export interface GuardCallbacks {
  /** 推确认请求到 attach 该会话的客户端；返回 confirmId */
  ask(conv: string, item: ConfirmationItem): void;
  /** 等待用户决定；resolve true/false；reject 视为拒绝 */
  wait(confirmId: string, timeoutMs: number): Promise<boolean>;
  /** 确认被回答（超时或用户决定）时通知客户端 */
  resolved(conv: string, confirmId: string, approved: boolean): void;
}

const CONFIRM_TIMEOUT_MS = 10 * 60_000;

export function createGuardExtension(rules: GuardRules, cb: GuardCallbacks) {
  return defineExtension({
    name: "durahub-guard",
    hooks: [
      hook(ToolTask, {
        beforeTool: async (call, api, ctx) => {
          let needAsk = false;
          let reason = "";

          if (call.name === "bash") {
            const command = String((call.arguments as JsonObject)?.command ?? "");
            for (const pattern of rules.bashDeny) {
              if (new RegExp(pattern).test(command)) {
                return { block: `durahub-guard: 命令被安全策略直接拒绝 (${pattern})` };
              }
            }
            for (const pattern of rules.alwaysAsk) {
              if (new RegExp(pattern).test(command)) {
                needAsk = true;
                reason = `bash 命令匹配需确认规则: ${command.slice(0, 120)}`;
                break;
              }
            }
          } else if (call.name === "write" || call.name === "edit") {
            // write/edit：CodingTools 自带 cwd 约束，v1 不拦截（04 §5 的
            // writeOutsideCwd 需要 EnvTarget.read 拿 agent doc，M4 再收紧）
          }

          if (!needAsk) return undefined;

          const memoKey = `guard:${api.taskId}`;
          const existing = await api.memo<boolean>(memoKey, ctx);
          if (existing !== undefined) {
            return existing ? undefined : { block: "durahub-guard: 用户此前拒绝了该操作" };
          }

          const confirmId = `cf-${api.taskId}`;
          const item: ConfirmationItem = {
            id: confirmId,
            conv: String(api.conversationId),
            tool: call.name,
            args: call.arguments,
            askedAt: Date.now(),
          };
          cb.ask(item.conv, item);
          let approved = false;
          try {
            approved = await cb.wait(confirmId, CONFIRM_TIMEOUT_MS);
          } catch {
            approved = false;
          }
          cb.resolved(item.conv, confirmId, approved);
          await api.memo(memoKey, approved, ctx);
          return approved ? undefined : { block: "durahub-guard: 用户拒绝了该操作" };
        },
      }),
    ],
  });
}
