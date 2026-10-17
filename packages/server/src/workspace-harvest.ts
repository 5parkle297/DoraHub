/**
 * 工作区收割（会话漫游 MVP，用户设想 2026-10-17）：
 * 从会话 entries 挖出 agent 用过的所有文件路径（read/write/edit 工具参数），
 * 归一化为相对 cwd 的路径，供跨机迁移时定位文件。
 *
 * 设计要点：
 * - 事实源 = pi.assistant entry 的 model[0].content 里的 toolCall 块
 * - bash 产生的文件挖不到（黑盒）——迁移提示里会告诉 agent 这一点，
 *   它可以自己 ls 对比补漏
 * - 排除 node_modules/.git/dist/build 等机器特定目录（不该跨机搬）
 */
import type { Conversation } from "@earendil-works/pi-durable";
import { context } from "./harness.ts";

/** 不迁移的路径片段（机器特定/可再生/依赖目录）。 */
const EXCLUDE_PATTERNS = [
  /(^|[\\/])node_modules([\\/]|$)/i,
  /(^|[\\/])\.git([\\/]|$)/i,
  /(^|[\\/])dist([\\/]|$)/i,
  /(^|[\\/])build([\\/]|$)/i,
  /(^|[\\/])\.next([\\/]|$)/i,
  /(^|[\\/])target([\\/]|$)/i,
  /(^|[\\/])__pycache__([\\/]|$)/i,
  /(^|[\\/])\.venv([\\/]|$)/i,
  /(^|[\\/])venv([\\/]|$)/i,
  /(^|[\\/])\.cache([\\/]|$)/i,
  /(^|[\\/])\.pi-env[^\\/]*$/i,
];

/** 收割结果：相对路径集合 + 统计。 */
export interface HarvestResult {
  /** 相对 cwd 的文件路径（posix 形式，写入目标机时再转） */
  files: string[];
  /** 挖到的工具调用总数（含 bash 等无法定位文件的） */
  toolCalls: number;
  /** 排除的路径数 */
  excluded: number;
}

/** 从会话历史挖文件清单。cwd = 会话的（旧机器上的）工作目录。 */
export async function harvestWorkspace(conv: Conversation, cwd: string): Promise<HarvestResult> {
  const files = new Set<string>();
  let toolCalls = 0;
  let excluded = 0;

  // 全量拉 entries（fork 历史也含）。分页扫。
  let cursor: unknown = undefined;
  do {
    const page = await conv.entries({ order: "ascending" }, 200, cursor as any, context);
    for (const entry of page.items) {
      if (entry.kind !== "pi.assistant") continue;
      const model = (entry as any).model ?? [];
      for (const msg of model) {
        const content = msg?.content;
        if (!Array.isArray(content)) continue;
        for (const block of content) {
          if (block?.type !== "toolCall") continue;
          toolCalls++;
          const args = block.arguments ?? {};
          // read/write/edit 有 path；bash 挖不到
          let p: unknown = args.path ?? args.filePath;
          if (typeof p !== "string" || !p) continue;
          const rel = relativize(p, cwd);
          if (!rel) continue;
          if (EXCLUDE_PATTERNS.some((re) => re.test(rel))) {
            excluded++;
            continue;
          }
          files.add(rel);
        }
      }
    }
    cursor = (page as any).next;
  } while (cursor);

  return { files: [...files].sort(), toolCalls, excluded };
}

/** 绝对/相对路径 → 相对 cwd 的 posix 路径；不相关（cwd 外/空）返回 null。 */
function relativize(p: string, cwd: string): string | null {
  const norm = (s: string) => s.replace(/\\/g, "/").replace(/\/+$/, "");
  const np = norm(p);
  const nc = norm(cwd || "/");
  if (!np || np === ".") return null;
  if (np.startsWith("/")) {
    // POSIX 绝对路径
    if (nc && np.startsWith(nc + "/")) return np.slice(nc.length + 1);
    return null; // cwd 外
  }
  if (/^[A-Za-z]:/.test(np)) {
    // Windows 盘符路径
    if (nc && np.toLowerCase().startsWith(nc.toLowerCase() + "/")) {
      return np.slice(nc.length + 1);
    }
    return null;
  }
  // 本来就是相对路径
  return np;
}
