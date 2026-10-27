/**
 * 收尾汇报卡（P0-3，对齐参考项目 Sig 的三段式汇报）：
 * agent 一轮跑完（run_end）在消息流末尾插一张确定性的总结卡——
 * tone 徽章 + 结论行 + 事实统计（不调 LLM，数事件生成）。
 *
 * 手机上的意义：不用点开会话翻流式记录，一眼知道「跑完了没有/成没成/干了什么」。
 */
import type { RunReport } from "../state/conv.ts";

function fmtDuration(ms: number): string {
  if (ms < 1000) return "<1 秒";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分 ${s % 60} 秒`;
  return `${Math.floor(m / 60)} 时 ${m % 60} 分`;
}

const TONE_META = {
  done: { icon: "✅", label: "完成", cls: "run-done" },
  attention: { icon: "⚠️", label: "需注意", cls: "run-attention" },
  failed: { icon: "⛔", label: "失败", cls: "run-failed" },
} as const;

export function RunReportCard({ report, hasPending }: { report: RunReport; hasPending: boolean }) {
  const tone = TONE_META[report.tone];
  const lines: string[] = [];
  if (report.toolCalls > 0) {
    lines.push(`工具调用 ${report.toolCalls} 次${report.toolErrors > 0 ? `（${report.toolErrors} 次出错）` : ""}`);
  }
  if (report.replies > 0) lines.push(`回复 ${report.replies} 条`);
  if (report.userInputs > 1) lines.push(`期间你追加了 ${report.userInputs - 1} 条指示`);
  lines.push(`耗时 ${fmtDuration(report.durationMs)}`);

  return (
    <div className={`run-report ${tone.cls}`} role="status">
      <div className="run-report-head">
        <span className="run-report-icon" aria-hidden>{tone.icon}</span>
        <span className="run-report-title">{tone.label}</span>
        <span className="run-report-time">{fmtDuration(report.durationMs)}</span>
      </div>
      {report.lastText && (
        <div className="run-report-conclusion" title={report.lastText}>{report.lastText}</div>
      )}
      <div className="run-report-facts">
        {lines.map((l, i) => <span key={i} className="run-report-fact">{l}</span>)}
      </div>
      {hasPending && (
        <div className="run-report-needs">◆ 有确认请求等你处理（见上方确认卡）</div>
      )}
    </div>
  );
}
