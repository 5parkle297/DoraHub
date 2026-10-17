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
  /** shell 路径（Windows 无 WSL 时给 Git Bash 绝对路径；缺省 = daemon 自探测） */
  shellPath?: string;
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
      shellPath: process.env[`${prefix}_SHELL`],
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
    private opts: { hubCwd: string; knownHostsFile?: string; identityFile?: string },
  ) {}

  private targetFor(envId: string, cfg: ExecutorConfig): import("@earendil-works/pi-env").SshConnectOptions {
    return {
      host: cfg.host,
      user: cfg.user,
      port: cfg.port,
      identityFile: this.opts.identityFile,
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
      // Windows 无 WSL 的解法：显式指定 Git Bash（设计 07 W-b）；不配则
      // daemon 自探测（Linux/装了 WSL 的机器）。bash 非登录 shell 不读
      // profile → PATH 缺 Git 的 usr/bin（uname/sed 等 coreutils 不在
      // Windows PATH）→ shellEnv 注入
      const shellEnv = this.shellEnvFor(cfg);
      return new RemoteExecutionEnv({
        connection: conn,
        id: `pi-env:${envId}`,
        cwd: target.cwd ?? cfg.defaultCwd,
        ...(cfg.shellPath ? { shellPath: cfg.shellPath } : {}),
        ...(shellEnv ? { shellEnv } : {}),
      });
    }
    return new NodeExecutionEnv({ cwd: target.cwd ?? this.opts.hubCwd });
  }

  /** shellPath = .../Git/usr/bin/bash.exe → PATH 前插 Git 的 usr/bin + mingw64/bin（coreutils + git）。 */
  private shellEnvFor(cfg: ExecutorConfig): Record<string, string> | undefined {
    if (!cfg.shellPath) return undefined;
    const m = cfg.shellPath.replace(/\\/g, "/").match(/^(.*\/Git)\/usr\/bin\/bash\.exe$/i);
    if (!m) return undefined;
    const gitRoot = m[1];
    return {
      PATH: `${gitRoot}/usr/bin;${gitRoot}/mingw64/bin;C:/Windows/System32;C:/Windows;C:/Windows/System32/Wbem`,
    };
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

  /** 探测一台执行机可达性。带超时（离线机器的 SSH 连接超时很长，不包超时会拖死
   *  /api/executors——2026-10-17 手机上实测 60s 无响应的根因）。
   *  超时后返回当前缓存状态，底层探测继续跑、成功后更新 lastSeen。 */
  async probe(envId: string, timeoutMs = 5000): Promise<{ envId: string; online: boolean; lastSeen: number | null }> {
    const cfg = this.executors.get(envId);
    const cached = () => ({ envId, online: false, lastSeen: this.lastSeen.get(envId) ?? null });
    if (!cfg) return cached();
    const doProbe = (async () => {
      let conn = this.connections.get(envId);
      if (!conn) {
        conn = sshConnection(this.targetFor(envId, cfg)).connection;
        this.connections.set(envId, conn);
      }
      await conn.info();
      this.lastSeen.set(envId, Date.now());
      return { envId, online: true, lastSeen: this.lastSeen.get(envId)! };
    })().catch(() => null); // 失败不抛，留给 race；lastSeen 不动
    const winner = await Promise.race([
      doProbe,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs).unref?.()),
    ]);
    if (winner) return winner;
    return cached(); // 超时/失败：返回缓存（doProbe 仍在后台跑，下次就是新鲜值）
  }

  /** 后台刷新所有执行机状态（fire-and-forget，/api/executors 用：立即返回缓存）。节流 30s。 */
  private lastRefresh = 0;
  refreshProbes(): void {
    if (Date.now() - this.lastRefresh < 30_000) return;
    this.lastRefresh = Date.now();
    for (const envId of this.executors.keys()) {
      this.probe(envId).catch(() => {});
    }
  }

  /** 该执行机最近一次探测成功时间（null = 从未）。 */
  lastSeenOf(envId: string): number | null {
    return this.lastSeen.get(envId) ?? null;
  }

  /** 为迁移等场景构建指定机器的 ExecutionEnv（不依赖会话的 envId）。 */
  async buildForEnv(envId: string, cwd: string): Promise<import("@earendil-works/pi-durable/env").ExecutionEnv | null> {
    if (envId === "hub" || !envId) {
      return new NodeExecutionEnv({ cwd: cwd || this.opts.hubCwd });
    }
    const cfg = this.executors.get(envId);
    if (!cfg) return null;
    let conn = this.connections.get(envId);
    if (!conn) {
      conn = sshConnection(this.targetFor(envId, cfg)).connection;
      this.connections.set(envId, conn);
    }
    const shellEnv = this.shellEnvFor(cfg);
    return new RemoteExecutionEnv({
      connection: conn,
      id: `pi-env:${envId}`,
      cwd: cwd || cfg.defaultCwd,
      ...(cfg.shellPath ? { shellPath: cfg.shellPath } : {}),
      ...(shellEnv ? { shellEnv } : {}),
    });
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
