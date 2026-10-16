/**
 * DoraHub — Harness 装配（M1 核心，对应设计 04 §2）。
 *
 * 事实源：node_modules/@earendil-works/pi-durable/dist 下的 .d.ts 文件（1.2.0）。
 * - HarnessOptions: { models, registry, settings?, env?, conversationCreated?, onReport? }
 * - env 的入参是 EnvTarget { conversationId, cwd?, read }（不是裸 cwd）
 * - CodingTools 是 1.2.0 的 coding-tools 扩展（read/write/edit/bash）
 */
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { installZjl, ZJL_PROVIDER_ID } from "./zjl-provider.ts";

/** 解析 "provider:model" 形式的模型描述（如 "trial:glm-5.3"）；缺省 provider = zjl。 */
export function parseModelRef(desc?: string): { provider: string; modelId: string } {
  if (!desc) return { provider: "zjl", modelId: "grok-4.7" };
  const i = desc.indexOf(":");
  if (i > 0 && !desc.slice(0, i).includes("/")) {
    return { provider: desc.slice(0, i), modelId: desc.slice(i + 1) };
  }
  return { provider: "zjl", modelId: desc };
}

export const context = BACKGROUND_CONTEXT;

export interface HarnessConfig {
  dbPath: string;
  zjlBaseUrl: string;
  zjlApiKey: string;
  defaultCwd: string;
  defaultModelId?: string;
}

export async function startHarness(config: HarnessConfig) {
  const models = createModels();
  installZjl(models, config.zjlBaseUrl, config.zjlApiKey);

  const registry = createRegistry();
  registry.install(CodingTools);

  const env = (target: { cwd?: string }) =>
    new NodeExecutionEnv({ cwd: target.cwd ?? config.defaultCwd });

  const harness = await Harness.open(
    await openNodeSqliteStorage(config.dbPath),
    {
      models,
      registry,
      env,
      settings: {
        // 稍降 progress 频率，为 WS 转发省带宽（04 §2）
        progress: { partialIntervalMs: 200, outputIntervalMs: 200 },
      },
      onReport: (error) => {
        console.error("[harness report]", error);
      },
    },
    context,
  );
  harness.resume();
  return harness;
}

/** 新会话/根会话的默认 agent 配置。 */
export function defaultAgent(cwd: string, modelId?: string) {
  return {
    model: parseModelRef(modelId),
    cwd,
  };
}
