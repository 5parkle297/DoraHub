/**
 * 会话元数据（dorahub 自定义 doc，设计 04 §5 / 07 §4）。
 * name 供列表页展示；fork 语义继承当时的目标机（M4 envId）。
 *
 * v2（2026-10-16 前端改造会话）：加自动命名字段——
 *   description：一句话概括本会话在做什么任务（自动生成）
 *   keywords：3-5 个关键词 chips（自动生成）
 *   autoNamed：name 是否由自动命名服务生成（手动 setName 后置 false，
 *              自动命名不再覆盖手动命名）
 *   namedAtTurn：上次自动命名时已见用户消息数（节流用）
 * 旧会话（v1）迁移时补空值。
 */
import { defineDoc } from "@earendil-works/pi-durable";
import type { JsonObject, RewindableConversationDocToken } from "@earendil-works/pi-durable";

export interface ConvMetaState extends JsonObject {
  name: string;
  createdAt: number;
  /** M4：目标执行机 envId；缺省 = hub 本地执行。JsonValue 不允许 undefined，
   *  不设目标机时存 null。 */
  envId: string | null;
  /** 自动生成的一句话任务描述 */
  description: string | null;
  /** 自动生成的关键词（3-5 个） */
  keywords: string[];
  /** name 来自自动命名服务（true 时自动命名可继续刷新；手动改名后为 false） */
  autoNamed: boolean;
  /** 上次自动命名时已见用户消息数（节流：每 +5 条用户消息刷新一次） */
  namedAtUserCount: number;
}

export const ConvMetaDoc: RewindableConversationDocToken<ConvMetaState> = defineDoc({
  kind: "dorahub.meta",
  version: 2,
  scope: "conversation",
  history: "rewindable",
  fork: "asOf",
  initial: () => ({
    name: "",
    createdAt: Date.now(),
    envId: null,
    description: null,
    keywords: [],
    autoNamed: false,
    namedAtUserCount: 0,
  }),
  migrate(value, fromVersion) {
    if (fromVersion < 2) {
      return {
        ...(value as any),
        description: null,
        keywords: [],
        autoNamed: false,
        namedAtUserCount: 0,
      };
    }
    return value as ConvMetaState;
  },
});
