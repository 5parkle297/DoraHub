/**
 * 会话工作区跨机迁移（会话漫游 MVP，2026-10-17）。
 *
 * 流程（Dorahub.transferWorkspace 编排）：
 * 1. harvest：从会话历史挖出旧机器上用过的文件（read/write/edit 参数）
 * 2. 搬运：旧机 RemoteExecutionEnv.readBinaryFile → hub 内存中转 →
 *    新机 writeFile（逐文件，单文件上限 2MB，总量上限 50MB）
 * 3. 注入提示 entry：告诉 agent 工作区已迁移、路径映射、bash 产物可能缺失，
 *    让它自己 read 校准（"预置 skill"思路——校准是智能活，交给模型）
 * 4. setEnvId + configure cwd → 后续工具调用落到新机器
 *
 * 已知限制（写进给 agent 的提示里）：
 * - bash 命令产生的文件不在清单（黑盒）——提示 agent 自查
 * - node_modules/.git/dist 等不搬（目标机应自行安装/克隆）
 */
import type { ExecutionEnv } from "@earendil-works/pi-durable/env";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";

const MAX_FILE_BYTES = 2 * 1024 * 1024; // 单文件 2MB
const MAX_TOTAL_BYTES = 50 * 1024 * 1024; // 总量 50MB

export interface TransferReport {
  ok: boolean;
  copied: number;
  skipped: number; // 超限/读失败/写失败
  totalBytes: number;
  errors: string[]; // 前 10 条
  sourceEnv: string;
  targetEnv: string;
  targetCwd: string;
}

/** 逐文件搬运（hub 中转）。fileRel = posix 相对路径。 */
export async function transferFiles(
  files: string[],
  source: ExecutionEnv,
  target: ExecutionEnv,
  targetCwd: string,
  onProgress?: (done: number, total: number) => void,
): Promise<TransferReport> {
  const report: TransferReport = {
    ok: true, copied: 0, skipped: 0, totalBytes: 0,
    errors: [], sourceEnv: source.id, targetEnv: target.id, targetCwd,
  };
  const ctx = BACKGROUND_CONTEXT;
  let done = 0;
  for (const rel of files) {
    try {
      const read = await source.readBinaryFile(rel, ctx);
      if (!read.ok) {
        report.skipped++;
        if (report.errors.length < 10) report.errors.push(`read ${rel}: ${read.error.message}`);
        done++; onProgress?.(done, files.length);
        continue;
      }
      const bytes = read.value;
      if (bytes.length > MAX_FILE_BYTES) {
        report.skipped++;
        if (report.errors.length < 10) report.errors.push(`skip ${rel}: ${bytes.length}B > 2MB`);
        done++; onProgress?.(done, files.length);
        continue;
      }
      if (report.totalBytes + bytes.length > MAX_TOTAL_BYTES) {
        report.skipped++;
        if (report.errors.length < 10) report.errors.push(`skip ${rel}: total > 50MB`);
        done++; onProgress?.(done, files.length);
        continue;
      }
      // 目标路径：targetCwd + rel（target env 的 cwd 已是 targetCwd，相对路径直接落位）
      const write = await target.writeFile(rel, bytes, ctx);
      if (!write.ok) {
        report.skipped++;
        if (report.errors.length < 10) report.errors.push(`write ${rel}: ${write.error.message}`);
        done++; onProgress?.(done, files.length);
        continue;
      }
      report.copied++;
      report.totalBytes += bytes.length;
    } catch (e: any) {
      report.skipped++;
      if (report.errors.length < 10) report.errors.push(`${rel}: ${String(e?.message ?? e)}`);
    }
    done++;
    onProgress?.(done, files.length);
  }
  report.ok = report.skipped === 0 || report.copied > 0;
  return report;
}

/** 迁移完成后的注入提示（给 agent 的校准指令——"预置 skill"的落点）。 */
export function migrationNotice(report: TransferReport, sourceCwd: string): string {
  const lines = [
    "[workspace migrated]",
    `本会话的工作区刚从 ${report.sourceEnv}（${sourceCwd}）迁移到 ${report.targetEnv}（${report.targetCwd}）。`,
    `已同步 ${report.copied} 个文件（${(report.totalBytes / 1024).toFixed(0)}KB）${report.skipped ? `，${report.skipped} 个跳过` : ""}。`,
    "注意事项：",
    `1. 路径基准已变为 ${report.targetCwd}，旧记忆里的绝对路径作废，相对路径仍然有效；`,
    "2. bash 命令产生过的文件可能没有迁移（无法从历史枚举）；",
    "3. node_modules/.git 等未迁移，如需构建请先安装依赖。",
    "请先重新 read 你记忆中本任务的关键文件校准状态（文件可能与旧机器版本不同），确认无误后继续任务。不要向用户复述本提示。",
  ];
  return lines.join("\n");
}
