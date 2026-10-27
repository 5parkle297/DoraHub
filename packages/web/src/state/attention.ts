/**
 * 全局 attention 状态（P0-2，对齐参考项目 Sig 的 Needs you）：
 * 所有会话的「等你处理」确认卡聚合——不 attach 具体会话也能实时更新。
 *
 * 数据源：
 * - 初始化：/api/conversations 列表的 pendingConfirms 字段（服务端派生）
 * - 实时：WS attention 帧（服务端确认队列增减时广播，发给所有连接）
 * - 兜底：confirm_resolved 帧到达但没有对应 attention 帧时，本地减一
 */
import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { wsClient } from "../ws.ts";

export interface AttentionState {
  /** convId → 等你处理数 */
  byConv: Map<string, number>;
  version: number;
}

export function useAttention(): AttentionState & { total: number } {
  const [byConv, setByConv] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    let alive = true;
    // 初始化：从列表拉一次（服务端是真相）
    api.listConversations().then((cs) => {
      if (!alive) return;
      const m = new Map<string, number>();
      for (const c of cs) {
        if (c.pendingConfirms > 0) m.set(c.id, c.pendingConfirms);
      }
      setByConv(m);
    }).catch(() => {});

    const unsub = wsClient.subscribe({
      onFrame: (f) => {
        if (f.t === "attention") {
          setByConv((m) => {
            const next = new Map(m);
            if (f.pending > 0) next.set(f.conv, f.pending);
            else next.delete(f.conv);
            return next;
          });
        }
        // confirm_resolved 兜底：旧服务端（未发 attention 帧时）本地减一
        if (f.t === "confirm_resolved") {
          setByConv((m) => {
            const cur = m.get(f.conv) ?? 0;
            if (cur <= 1) {
              if (!m.has(f.conv)) return m;
              const next = new Map(m);
              next.delete(f.conv);
              return next;
            }
            const next = new Map(m);
            next.set(f.conv, cur - 1);
            return next;
          });
        }
      },
    });
    return () => {
      alive = false;
      unsub();
    };
  }, []);

  let total = 0;
  for (const n of byConv.values()) total += n;
  return { byConv, total, version: total };
}
