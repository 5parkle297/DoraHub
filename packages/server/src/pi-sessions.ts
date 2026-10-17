/**
 * pi CLI 会话搬运（2026-10-17，用户需求："在这台电脑 pi 产生的会话，
 * 在另一台电脑 pi /resume 看到"——按需单会话，不做全量同步）。
 *
 * 事实基础（pi session-format.md + 实测）：
 * - pi 会话 = ~/.pi/agent/sessions/--<编码路径>--/<ts>_<uuid>.jsonl（v3 格式）
 * - 存储是纯本地文件，无远端源插件（--session-dir 只收本地路径）
 * - pi 到 pi 同构 → 无需格式转换，纯文件搬运
 *
 * 摘要体系（与 DoraHub 会话同规格，用户要求 2026-10-17）：
 * - 每个会话生成 title / description / keywords（便宜渠道一次性调用）
 * - 缓存在 hub 的 /var/lib/dorahub/pi-session-meta.json（key = envId/file），
 *   mtime 变了才重新生成——首次展开列表时后台补全，前端轮询刷新
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ExecRegistry } from "./exec/registry.ts";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ExecutionEnv } from "@earendil-works/pi-durable/env";
import type { Models } from "@earendil-works/pi-ai";

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
  /** 最后一条用户消息（缓存未生成时的回退显示） */
  preview: string;
  /** 文件大小 */
  size: number;
  /** ==== 生成的元数据（缓存命中才有；null = 生成中/失败） ==== */
  title: string | null;
  description: string | null;
  keywords: string[];
  /** meta 是否已就绪（前端据此显示骨架/刷新） */
  metaReady: boolean;
}

/** 缓存条目。 */
interface MetaCacheEntry {
  title: string;
  description: string;
  keywords: string[];
  mtime: number;
  generatedAt: number;
}

const META_PATH = process.env.DORAHUB_PI_META ?? "/var/lib/dorahub/pi-session-meta.json";

/** 列表结果缓存（5 分钟；重复展开零 SSH） */
const listCache = new Map<string, { at: number; data: PiSessionInfo[] }>();
const LIST_CACHE_MS = 5 * 60_000;

function loadMetaCache(): Record<string, MetaCacheEntry> {
  try {
    return JSON.parse(readFileSync(META_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveMetaCache(cache: Record<string, MetaCacheEntry>) {
  try {
    mkdirSync(dirname(META_PATH), { recursive: true });
    writeFileSync(META_PATH, JSON.stringify(cache, null, 1));
  } catch { /* 写失败不致命 */ }
}

/** 生成中/最近失败的标记（避免重复触发） */
const pending = new Set<string>();
const failedRecently = new Map<string, number>();

/** 列出一台机器上的 pi 会话。收集用户消息供 meta 生成。 */
export async function listPiSessions(execRegistry: ExecRegistry, envId: string, models?: Models): Promise<PiSessionInfo[]> {
  const env = await execRegistry.buildForEnv(envId, null);
  if (!env) return [];
  const cache = loadMetaCache();
  const out: PiSessionInfo[] = [];

  // ===== 一次复合命令拿全部数据 =====
  // 原实现逐文件 3 条 SSH 命令（列目录+head+grep）= 27 会话 80+ 次 RTT ≈ 十几秒。
  // 合并成远端 bash 循环，一条命令回来。分隔符：SOH 文件meta、STX header、ETX lastUser、NUL 记录尾。
  const SCAN_LIMIT = 40;
  const scan = `for dir in ~/.pi/agent/sessions/--*--; do [ -d "$dir" ] || continue; for f in "$dir"/*.jsonl; do [ -f "$f" ] || continue; printf '\\x01%s\t%s\t%s\t%s\\x02' "$(basename "$dir")" "$(basename "$f")" "$(stat -c %Y "$f")" "$(stat -c %s "$f")"; head -c 2048 "$f" | head -1 | cut -c1-600 | tr '
' ' '; printf '\\x03'; grep '"role":"user"' "$f" | tail -1 | cut -c1-2500 | tr '
' ' '; printf '\\x00'; done; done | head -${SCAN_LIMIT}`;
  const scanOut = await sh(env, scan);

  for (const record of scanOut.split("NUL").filter((r) => r.includes("SOH"))) {
    const m = record.match(/^SOH([^STX]*)STX([\s\S]*?)ETX([\s\S]*)$/);
    if (!m) continue;
    const [, metaPart, headerPart, lastUserPart] = m;
    const [dir, file, mtime, size] = metaPart.split("	");
    if (!file?.endsWith(".jsonl") || !dir) continue;
    const hdr = parseSessionHeader(headerPart.trim());
    const lastUser = extractUserText(lastUserPart.trim());
    const key = `${envId}/${file}`;
    const cached = cache[key];
    const mtimeMs = Number(mtime) * 1000;
    const info: PiSessionInfo = {
      envId,
      dir,
      file,
      sessionId: hdr?.id ?? file.replace(/\.jsonl$/, "").split("_").pop() ?? file,
      cwd: hdr?.cwd ?? decodeDir(dir),
      mtime: mtimeMs,
      preview: lastUser,
      size: Number(size),
      title: cached && cached.mtime === mtimeMs ? cached.title : null,
      description: cached && cached.mtime === mtimeMs ? cached.description : null,
      keywords: cached && cached.mtime === mtimeMs ? cached.keywords : [],
      metaReady: !!(cached && cached.mtime === mtimeMs),
    };
    out.push(info);
  }

  // ===== 缺 meta 的：后台单独拉用户消息并生成（不影响本次返回速度） =====
  if (models) {
    const candidates = out.filter((info) => {
      const key = `${envId}/${info.file}`;
      const recentlyFailed = (failedRecently.get(key) ?? 0) > Date.now() - 10 * 60_000;
      return !info.metaReady && !pending.has(key) && !recentlyFailed;
    }).slice(0, 12);
    void (async () => {
      for (const info of candidates) {
        const key = `${envId}/${info.file}`;
        pending.add(key);
        try {
          const allUsers = await sh(env, `grep '"role":"user"' ~/.pi/agent/sessions/${info.dir}/${info.file} | head -40 | cut -c1-400`);
          const userMessages = allUsers.split("\n").map(extractUserText).filter(Boolean).slice(0, 40);
          if (userMessages.length === 0) return;
          const result = await callSummaryModel(models, userMessages);
          if (result) {
            const c2 = loadMetaCache();
            c2[key] = { title: result.title, description: result.description, keywords: result.keywords, mtime: info.mtime, generatedAt: Date.now() };
            saveMetaCache(c2);
          } else {
            failedRecently.set(key, Date.now());
          }
        } catch {
          failedRecently.set(key, Date.now());
        } finally {
          pending.delete(key);
        }
      }
    })();
  }

  const result = out.sort((a, b) => b.mtime - a.mtime).slice(0, SCAN_LIMIT);
  listCache.set(envId, { at: Date.now(), data: result });
  return result;
}

/** 一次性摘要调用（渠道回退，同 AutoNamer 策略）。 */
async function callSummaryModel(models: Models, userMessages: string[]): Promise<{ title: string; description: string; keywords: string[] } | null> {
  const transcript = userMessages
    .slice(-12)
    .map((t, i) => `${i + 1}. ${t.length > 300 ? t.slice(0, 300) + "…" : t}`)
    .join("\n");
  const systemPrompt =
    "你是会话命名助手。根据用户对 AI 编程助手提出的请求，生成会话元数据。" +
    "title 用用户的语言，不超过 12 个字，名词短语，概括任务本身，不要标点结尾。" +
    "description 一句话（不超过 40 字）概括用户在做什么、想达成什么。" +
    "keywords 3-5 个关键词，每个不超过 6 个字。" +
    '只输出一个 JSON 对象：{"title":"...","description":"...","keywords":["..."]}，不要任何其他内容。';
  for (const ref of ["trial:glm-5.3-flash", "zjl:glm-5.3-flash", "zjl:grok-4.7"]) {
    const [provider, modelId] = ref.split(":");
    const model = models.getModel(provider, modelId);
    if (!model) continue;
    try {
      const msg = await models.completeSimple(model, {
        systemPrompt,
        messages: [{ role: "user", content: `用户的请求记录（按时间顺序）：\n${transcript}`, timestamp: Date.now() }],
      });
      if (msg.stopReason === "error") continue;
      const text = msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text ?? "").join("");
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) continue;
      const o = JSON.parse(m[0]);
      const title = typeof o.title === "string" ? o.title.trim().slice(0, 24) : "";
      if (!title) continue;
      return {
        title,
        description: typeof o.description === "string" ? o.description.trim().slice(0, 60) : "",
        keywords: Array.isArray(o.keywords) ? o.keywords.filter((k: any) => typeof k === "string" && k.trim()).map((k: string) => k.trim().slice(0, 12)).slice(0, 5) : [],
      };
    } catch { /* 下一个渠道 */ }
  }
  return null;
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

/** 从单条 jsonl 行提取 user 消息文本（跳过 pi 注入的 <> 包装）。 */
function extractUserText(line: string): string {
  try {
    const o = JSON.parse(line);
    if (o.type === "message" && o.message?.role === "user") {
      const c = o.message.content;
      const text = typeof c === "string" ? c
        : Array.isArray(c) ? c.filter((b: any) => b?.type === "text").map((b: any) => b.text ?? "").join(" ")
        : "";
      const t = text.trim();
      if (t && !t.startsWith("<")) return t.slice(0, 200);
    }
  } catch { /* 非 JSON 行 */ }
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
  const rr = await source.readTextFile(`.pi/agent/sessions/${dir}/${file}`, BACKGROUND_CONTEXT);
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
  void ctx;
  return { ok: true, targetFile: `~/.pi/agent/sessions/${targetDir}/${file}`, bytes: text.length };
}
