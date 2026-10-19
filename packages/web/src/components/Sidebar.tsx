/**
 * 会话侧栏（UI 收敛 2026-10-18）：
 * - 桌面 ≥769px：常驻左栏（design/06 §5 两栏布局），当前会话高亮，右侧是会话页
 * - 手机 <769px：整页列表（由 ConversationsPage 包裹），行为同旧版
 * 列表数据 + conv_status/conv_meta 实时推送都在这里（原 ConversationsPage 主体）。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.ts";
import { wsClient } from "../ws.ts";
import { navigate, useRoute } from "../route.ts";
import { ConvCard } from "./ConvCard.tsx";
import { CreateModal } from "./CreateModal.tsx";
import { PiSidebarSection } from "./PiSessions.tsx";
import type { ConversationSummary, ExecutorInfo } from "@dorahub/shared";

/** cwd → 项目显示名（basename） */
export function projectOf(cwd: string | null): { name: string; path: string } {
  if (!cwd) return { name: "未指定项目", path: "" };
  const norm = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  const base = norm.split("/").filter(Boolean).pop() ?? norm;
  return { name: base || norm, path: cwd };
}

/** 执行机显示：envId → 短名（hub 显示"云端"） */
export function envLabel(envId: string | null, host?: string): string {
  if (!envId || envId === "hub") return "☁ 云端 hub";
  return `🖥 ${envId}${host ? ` · ${host}` : ""}`;
}

export interface SidebarData {
  convs: ConversationSummary[];
  error: string;
  refresh: () => Promise<void>;
  executors: ExecutorInfo[];
  refreshExecutors: () => void;
}

export function ConversationsPage() {
  return <ConversationsInner />;
}

export function Sidebar() {
  return <ConversationsInner />;
}
function ConversationsInner() {
  const route = useRoute();
  const activeId = route.page === "conversation" ? route.id : null;
  const [convs, setConvs] = useState<ConversationSummary[]>([]);
  const [executors, setExecutors] = useState<ExecutorInfo[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  // 「＋ 新会话」按钮（App 头部）→ 打开弹窗前先刷新执行机状态（有意检查注册设备在线情况）
  useEffect(() => {
    const on = () => {
      api.executors().then(setExecutors).catch(() => {});
      setCreating(true);
    };
    window.addEventListener("dorahub:new-conv", on);
    return () => window.removeEventListener("dorahub:new-conv", on);
  }, []);
  function refreshExecutors() {
    api.executors().then(setExecutors).catch(() => {});
  }

  async function refresh() {
    try {
      setConvs(await api.listConversations());
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }

  useEffect(() => {
    refresh();
    refreshExecutors();
    const unsub = wsClient.subscribe({
      onFrame: (f) => {
        if (f.t === "conv_status") {
          setConvs((cs) => cs.map((c) => (c.id === f.conv ? { ...c, status: f.status } : c)));
        } else if (f.t === "conv_meta") {
          // 自动命名完成 → 无刷新换标题/描述（handoff S5）。
          // 不在列表里的（新建未发消息被隐藏、或快照后新建的）→ 补拉全量，
          // 否则被隐藏的空会话发首条消息后永远不出现。
          setConvs((cs) => {
            if (cs.some((c) => c.id === f.conv)) {
              return cs.map((c) =>
                c.id === f.conv
                  ? { ...c, name: f.name, description: f.description, keywords: f.keywords, envId: f.envId }
                  : c,
              );
            }
            refresh();
            return cs;
          });
        }
      },
    });
    return unsub;
  }, []);

  // 创建成功后关弹窗（P0-1：不关弹窗会让用户误以为没点上再点，4 秒连建 3 个的形态）
  async function create(opts: { cwd?: string; envId?: string }) {
    try {
      const { id } = await api.createConversation({
        ...(opts.cwd ? { cwd: opts.cwd } : {}),
        ...(opts.envId && opts.envId !== "hub" ? { envId: opts.envId } : {}),
      });
      setCreating(false);
      navigate({ page: "conversation", id });
    } catch (e: any) {
      setError(e.message);
      setCreating(false);
    }
  }

  // 按项目分组（cwd 为 key），组内按 updatedAt 倒序。
  // P0-1 问题 A：没发过消息的空会话（无自动标题且无预览）不进列表，
  // 防误触创建产生噪声；发首条消息后 conv_meta 推送会实时出现。
  const groups = useMemo(() => {
    const byCwd = new Map<string, ConversationSummary[]>();
    for (const c of convs) {
      if (!c.name && !c.lastPreview) continue;
      const key = c.cwd ?? "";
      if (!byCwd.has(key)) byCwd.set(key, []);
      byCwd.get(key)!.push(c);
    }
    const list = [...byCwd.entries()].map(([cwd, items]) => ({
      cwd,
      project: projectOf(cwd || null),
      items: items.sort((a, b) => b.updatedAt - a.updatedAt),
    }));
    // 最近活动的组排前面；"未指定"排最后
    list.sort((a, b) => {
      const aLast = Math.max(...a.items.map((c) => c.updatedAt));
      const bLast = Math.max(...b.items.map((c) => c.updatedAt));
      if (!a.cwd) return 1;
      if (!b.cwd) return -1;
      return bLast - aLast;
    });
    return list;
  }, [convs]);

  return (
    <div className="conv-list">
      {error && <div className="error-banner" onClick={() => setError("")}>{error} ✕</div>}

      {groups.length === 0 && (
        <div className="empty">还没有会话。创建一个，任何设备都能接着聊。</div>
      )}
      {groups.map((g) => (
        <div key={g.cwd || "_none"}>
          <div className="group-label" title={g.project.path}>
            <span className="group-name">{g.project.name}</span>
            <span className="group-count">{g.items.length} 个会话</span>
          </div>
          {g.items.map((c) => (
            <ConvCard key={c.id} conv={c} active={c.id === activeId} style={{ marginTop: 8 }} onDeleted={refresh} />
          ))}
        </div>
      ))}

      {/* pi 会话（P0-2 #1）：常驻侧栏，自动扫描，只留时间窗内的；手机列表页同体 */}
      <PiSidebarSection executors={executors} />

      {creating && (
        <CreateModal
          executors={executors}
          onClose={() => setCreating(false)}
          onCreate={create}
        />
      )}
    </div>
  );
}
