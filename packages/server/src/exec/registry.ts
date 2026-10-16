/**
 * exec registry（M4，设计 07 §2 实际方案）：
 * envId → pi-env SSH 连接的注册表 + buildEnv 路由。
 *
 * 用法：
 *   DORAHUB_EXEC_WORKPC_HOST / DORAHUB_EXEC_WORKPC_USER / DORAHUB_EXEC_WORKPC_CWD
 *   等环境变量按 envId 大写声明执行机；会话 dorahub.meta.envId 选中后，
 *   env() 在这里拿到 RemoteExecutionEnv（懒连接：首次操作才 ssh）。
 */
import type { Context } from "@earendil-works/chord";
import type { ConversationId, EnvTarget } from "@earendil-works/pi-durable";
import type { ExecutionEnv } from "@earendil-works/pi-durable/env";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { RemoteExecutionEnv, sshConnection, type Connection } from "@earendil-works/pi-env";
import { ConvMetaDoc } from "../conv-meta.ts";

export interface ExecutorConfig {
  host: string;
  user?: string;
  port?: number;
  defaultCwd: string;
}

/** 从环境变量扫描执行机：DORAHUB_EXEC_<ENVID>_HOST 等。 */
export function loadExecutorsFromEnv(): Map<string, ExecutorConfig> {
  const out = new Map<string, ExecutorConfig>();
  for (const [key, value] of Object.entries(process.env)) {
    const m = key.match(/^DORAHUB_EXEC_([A-Z0-9_]+)_HOST$/);
    if (!m || !value) continue;
    const envId = m[1].toLowerCase();
    const prefix = `DORAHUB_EXEC_${m[1]}`;
    out.set(envId, {
      host: value,
      user: process.env[`${prefix}_USER`],
      port: process.env[`${prefix}_PORT`] ? Number(process.env[`${prefix}_PORT`]) : undefined,
      defaultCwd: process.env[`${prefix}_CWD`] ?? ".",
    });
  }
  return out;
}

export class ExecRegistry {
  private connections = new Map<string, Connection>();
  /** envId → 最近一次探测结果（在线时间戳）；懒探测，不主动心跳 */
  private lastSeen = new Map<string, number>();

  constructor(
    public executors: Map<string, ExecutorConfig>,
    private opts: { hubCwd: string; knownHostsFile?: string },
  ) {}

  private targetFor(envId: string, cfg: ExecutorConfig): import("@earendil-works/pi-env").SshConnectOptions {
    return {
      host: cfg.host,
      user: cfg.user,
      port: cfg.port,
      knownHostsFile: this.opts.knownHostsFile ?? "~/.ssh/known_hosts",
      hostKeyAlias: `pi-env-${envId}`,
    };
  }

  /** buildEnv（harness 的 env 回调）。env() 绝不在 Session line 上跑（官方约束 ✅）。 */
  async build(target: EnvTarget, context: Context): Promise<ExecutionEnv> {
    const envId = await this.readEnvId(target, context);
    const cfg = envId && envId !== "hub" ? this.executors.get(envId) : undefined;
    if (cfg) {
      let conn = this.connections.get(envId!);
      if (!conn) {
        conn = sshConnection(this.targetFor(envId!, cfg)).connection;
        this.connections.set(envId!, conn);
      }
      return new RemoteExecutionEnv({
        connection: conn,
        id: `pi-env:${envId}`,
        cwd: target.cwd ?? cfg.defaultCwd,
      });
    }
    return new NodeExecutionEnv({ cwd: target.cwd ?? this.opts.hubCwd });
  }

  /** 读会话的 dorahub.meta.envId（EnvTarget.read = DocumentReader）。 */
  private async readEnvId(target: EnvTarget, context: Context): Promise<string | null | undefined> {
    try {
      const meta = await target.read.snapshot(ConvMetaDoc, target.conversationId as ConversationId, context);
      return meta?.envId ?? undefined;
    } catch {
      return undefined; // 读失败退化为 hub 本地执行（fail-open 到本地；远程配置错误不该阻塞会话）
    }
  }

  /** 探测一台执行机可达性（/api/executors 用；轻量：hello 一次）。 */
  async probe(envId: string): Promise<{ envId: string; online: boolean; lastSeen: number | null }> {
    const cfg = this.executors.get(envId);
    if (!cfg) return { envId, online: false, lastSeen: this.lastSeen.get(envId) ?? null };
    try {
      let conn = this.connections.get(envId);
      if (!conn) {
        conn = sshConnection(this.targetFor(envId, cfg)).connection;
        this.connections.set(envId, conn);
      }
      await conn.info();
      this.lastSeen.set(envId, Date.now());
      return { envId, online: true, lastSeen: this.lastSeen.get(envId)! };
    } catch {
      return { envId, online: false, lastSeen: this.lastSeen.get(envId) ?? null };
    }
  }

  list(): { envId: string; host: string; defaultCwd: string }[] {
    return [...this.executors.entries()].map(([envId, cfg]) => ({
      envId,
      host: cfg.host,
      defaultCwd: cfg.defaultCwd,
    }));
  }

  async close() {
    for (const conn of this.connections.values()) {
      try { conn.close(); } catch { /* 忽略 */ }
    }
    this.connections.clear();
  }
}
