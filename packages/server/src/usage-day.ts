/**
 * 今日花费（P1-3）：per-day token/cost 聚合，hub 侧 JSON 持久。
 *
 * 数据源：事件流的 message_end（pi.assistant entry 的 model[0].usage）——
 * pi-durable 的 UsageDoc 是 per-conv 累计值，没有时间维度，所以 hub 自己记。
 *
 * 存储模式对齐 pi-session-meta.json：原子写（tmp+rename）+ 治理（只留最近 N 天）。
 * 结构：{ days: { "2026-11-02": { models: { "zjl/grok-4.7": {input,output,cacheRead,cacheWrite,totalTokens,cost} },
 *          convs: { convId: true } } } }
 */
import { readFileSync, writeFileSync, existsSync, renameSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const USAGE_PATH = process.env.DORAHUB_USAGE_FILE ?? "/var/lib/dorahub/usage-day.json";
/** 治理：只保留最近 90 天（足够回看月度趋势，体积可控） */
const KEEP_DAYS = 90;

interface ModelUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  costTotal: number;
  calls: number;
}

interface DayUsage {
  models: Record<string, ModelUsage>;
  /** 有动静的会话 id 集合（去重统计「今日活跃会话」） */
  convs: Record<string, true>;
}

interface UsageFile {
  days: Record<string, DayUsage>;
}

function dayKey(ts = Date.now()): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function load(): UsageFile {
  try {
    const raw = JSON.parse(readFileSync(USAGE_PATH, "utf8"));
    if (raw && typeof raw.days === "object") return raw;
  } catch { /* 首次/损坏 = 空 */ }
  return { days: {} };
}

function save(data: UsageFile) {
  try {
    // 治理：只留 KEEP_DAYS 天
    const keys = Object.keys(data.days).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete data.days[k];
    mkdirSync(dirname(USAGE_PATH), { recursive: true });
    const tmp = USAGE_PATH + ".tmp";
    writeFileSync(tmp, JSON.stringify(data, null, 1));
    renameSync(tmp, USAGE_PATH);
  } catch { /* 写失败不致命（下次事件再写） */ }
}

/** 记一笔 assistant 消息的 usage（内存聚合 + 防抖落盘）。 */
export function recordUsage(provider: string, modelId: string, usage: {
  input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number;
  cost?: { total: number };
}, convId: string) {
  const data = load();
  const day = dayKey();
  const d = (data.days[day] ??= { models: {}, convs: {} });
  const key = `${provider}/${modelId}`;
  const m = (d.models[key] ??= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, costTotal: 0, calls: 0 });
  m.input += usage.input;
  m.output += usage.output;
  m.cacheRead += usage.cacheRead;
  m.cacheWrite += usage.cacheWrite;
  m.totalTokens += usage.totalTokens;
  m.costTotal += usage.cost?.total ?? 0;
  m.calls += 1;
  d.convs[convId] = true;
  save(data);
}

export interface UsageTodayResult {
  day: string;
  models: Record<string, ModelUsage>;
  totals: ModelUsage & { activeConvs: number };
}

/** 今日汇总（供 /api/usage/today）。 */
export function usageToday(): UsageTodayResult {
  const data = load();
  const day = dayKey();
  const d = data.days[day] ?? { models: {}, convs: {} };
  const totals: ModelUsage & { activeConvs: number } = {
    input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, costTotal: 0, calls: 0,
    activeConvs: Object.keys(d.convs).length,
  };
  for (const m of Object.values(d.models)) {
    totals.input += m.input; totals.output += m.output;
    totals.cacheRead += m.cacheRead; totals.cacheWrite += m.cacheWrite;
    totals.totalTokens += m.totalTokens; totals.costTotal += m.costTotal;
    totals.calls += m.calls;
  }
  return { day, models: d.models, totals };
}

export function _dayKeyForTest(ts: number) { return dayKey(ts); }
export function _usagePath() { return USAGE_PATH; }
export function _fileExists() { return existsSync(USAGE_PATH); }
