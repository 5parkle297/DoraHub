/**
 * pi CLI 会话搬运（2026-10-17，用户需求："在这台电脑 pi 产生的会话，
 * 在另一台电脑 pi /resume 看到"——按需单会话，不做全量同步）。
 *
 * 事实基础（pi session-format.md + 实测）：
 * - pi 会话 = ~/.pi/agent/sessions/--<编码路径>--/<ts>_<uuid>.jsonl（v3 格式）
 * - 存储是纯本地文件，无远端源插件（--session-dir 只收本地路径）
 * - pi 到 pi 同构 → 无需格式转换，纯文件搬运
 *
 * 流程：
 * - listPiSessions(envId)：SSH 扫描目标机的 sessions 目录，读每个 jsonl 的
 *   头部（session/model_change/首条 user message）做摘要
 * - transferPiSession：源机拉完整 jsonl → hub 内存 → 目标机写入对应
 *   sessions/--<目标cwd编码>--/<原文件名>（目标机 cwd 不同则重编码目录，
 *   并改写 session header 的 cwd 字段）
 */
import type { ExecRegistry } from "./exec/registry.ts";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ExecutionEnv } from "@earendil-works/pi-durable/env";

/** exec 并收集 stdout（ShellExecResult 不带 output，要 onOutput 回调收）。 */
async function sh(env: ExecutionEnv, command: string): Promise<string> {
  let out = "";
  const r = await env.exec(command, { onOutput: (text) => { out += text; } }, BACKGROUND_CONTEXT);
  if (!r.ok) throw new Error(r.error.message);
  return out;
}

/** pi 会话摘要（UI 列表用）。 */
export interface PiSessionInfo {
  envId: string;
  /** 源机上的文件名（<ts>_<uuid>.jsonl） */
  file: string;
  /** 源机 sessions 子目录（--path-- 编码） */
  dir: string;
  /** 会话 id（uuid） */
  sessionId: string;
  /** header 里的 cwd（源机路径） */
  cwd: string;
  /** 修改时间（epoch ms） */
  mtime: number;
  /** 首条用户消息预览 */
  preview: string;
  /** 文件大小 */
  size: number;
}

/** 列出一台机器上的 pi 会话（读每个文件头 2KB 做摘要）。 */
export async function listPiSessions(execRegistry: ExecRegistry, envId: string): Promise<PiSessionInfo[]> {
  // cwd 用 /tmp（RemoteExecutionEnv 需要存在的目录；所有命令都用绝对/~ 路径，与 cwd 无关）
  const env = await execRegistry.buildForEnv(envId, null);
  if (!env) return [];
  const ctx = BACKGROUND_CONTEXT;
  // 列 sessions 目录；Windows 上 daemon 跑 Git Bash 兼容 ls
  const listHome = await sh(env, 'ls -1 ~/.pi/agent/sessions/ 2>/dev/null || true');
  const dirs = listHome.trim().split("\n").filter((d) => d.startsWith("--") && d.endsWith("--"));
  const out: PiSessionInfo[] = [];
  for (const dir of dirs.slice(0, 30)) {
    // 每个目录里的 jsonl 文件 + mtime + size——用 printf 结构化输出，不解析 ls 列
    // （ls -l 的 owner/group 列数不稳，文件名还可能含空格）
    const ls = await sh(env, `cd ~/.pi/agent/sessions/${dir} && for f in *.jsonl; do [ -f \"\$f\" ] && printf '%s\\t%s\\t%s\\n' \"\$f\" \"\$(stat -c %Y \"\$f\")\" \"\$(stat -c %s \"\$f\")\"; done | head -20`);
    if (!ls.trim()) continue;
    for (const line of ls.trim().split("\n").filter(Boolean)) {
      const [file, mtime, size] = line.split("\t");
      if (!file?.endsWith(".jsonl")) continue;
      // 读头部摘要（session header + 首条 user 消息）
      // 头 4KB 拿 session header；preview 用 grep 扫全文件取最后一条 user 消息行
      const head = await sh(env, `head -c 4096 ~/.pi/agent/sessions/${dir}/${file}`);
      const userLine = await sh(env, `grep '"role":"user"' ~/.pi/agent/sessions/${dir}/${file} | tail -1 | head -c 3000`);
      const preview = summarizeHead(userLine || head);
      const hdr = parseSessionHeader(head);
      out.push({
        envId,
        dir,
        file,
        sessionId: hdr?.id ?? file.replace(/\.jsonl$/, "").split("_").pop() ?? file,
        cwd: hdr?.cwd ?? decodeDir(dir),
        mtime: Number(mtime) * 1000,
        preview,
        size: Number(size),
      });
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime).slice(0, 40);
}

function parseSessionHeader(head: string): { id: string; cwd: string } | null {
  for (const line of head.split("\n")) {
    try {
      const o = JSON.parse(line);
      if (o.type === "session") return { id: String(o.id ?? ""), cwd: String(o.cwd ?? "") };
    } catch { continue; }
  }
  return null;
}

function summarizeHead(head: string): string {
  for (const line of head.split("\n")) {
    try {
      const o = JSON.parse(line);
      if (o.type === "message" && o.message?.role === "user") {
        const c = o.message.content;
        const text = typeof c === "string" ? c
          : Array.isArray(c) ? c.filter((b: any) => b?.type === "text").map((b: any) => b.text ?? "").join(" ")
          : "";
        const t = text.trim();
        // 跳过 pi 注入的包装消息（system wrapper / hook）
        if (t && !t.startsWith("<")) return t.slice(0, 100);
      }
    } catch { continue; }
  }
  return "";
}

/** --D--hobby-- → D:\hobby（尽力还原，仅供显示）。 */
function decodeDir(dir: string): string {
  return dir.replace(/^--|--$/g, "").replace(/--/g, "\\").replace(/^([A-Z])\\/, "$1:\\");
}

/** --<cwd>-- 目录编码（pi 规则：去首分隔符，/\: 换成 -）。 */
export function encodeDir(cwd: string): string {
  return "--" + cwd.replace(/^[\\/]+/, "").replace(/[\\/\\:]/g, "-") + "--";
}

/** 搬运一个 pi 会话到目标机（纯文件中转 + header cwd 改写）。 */
export async function transferPiSession(
  execRegistry: ExecRegistry,
  sourceEnvId: string,
  file: string,
  dir: string,
  targetEnvId: string,
  targetCwd: string,
): Promise<{ ok: boolean; targetFile: string; bytes: number; error?: string }> {
  const ctx = BACKGROUND_CONTEXT;
  const source = await execRegistry.buildForEnv(sourceEnvId, null);
  const target = await execRegistry.buildForEnv(targetEnvId, null);
  if (!source || !target) return { ok: false, targetFile: "", bytes: 0, error: "executor not available" };

  // 1. 源机读全文（readTextFile：daemon 文件通道，相对路径基于 home）
  const rr = await source.readTextFile(`.pi/agent/sessions/${dir}/${file}`);
  if (!rr.ok) return { ok: false, targetFile: "", bytes: 0, error: `read failed: ${rr.error.message}` };
  let text = rr.value;
  if (!text.trim()) return { ok: false, targetFile: "", bytes: 0, error: "empty file" };
  if (text.length > 20 * 1024 * 1024) return { ok: false, targetFile: "", bytes: 0, error: "session too large (>20MB)" };

  // 2. 改写 session header 的 cwd 为目标机路径（/resume 列表的归属目录）
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    try {
      const o = JSON.parse(lines[i]);
      if (o.type === "session") {
        o.cwd = targetCwd;
        lines[i] = JSON.stringify(o);
        break;
      }
    } catch { continue; }
  }
  text = lines.join("\n");

  // 3. 目标目录 + 写入：走 daemon 的 writeFile API（不经 shell——Windows 命令行
  //    32K 限制；文件通道无此限制）。相对路径基于 env cwd = home（buildForEnv(null)）
  const targetDir = encodeDir(targetCwd);
  await sh(target, `mkdir -p ~/.pi/agent/sessions/${targetDir}`);
  const w = await target.writeFile(`.pi/agent/sessions/${targetDir}/${file}`, text, BACKGROUND_CONTEXT);
  if (!w.ok) return { ok: false, targetFile: "", bytes: 0, error: `write failed: ${w.error.message}` };
  return { ok: true, targetFile: `~/.pi/agent/sessions/${targetDir}/${file}`, bytes: text.length };
}
