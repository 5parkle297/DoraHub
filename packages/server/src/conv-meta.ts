/**
 * 会话元数据（dorahub 自定义 doc，设计 04 §5 / 07 §4）。
 * name 供列表页展示；fork 语义继承当时的目标机（M4 envId）。
 */
import { defineDoc } from "@earendil-works/pi-durable";
import type { JsonObject, RewindableConversationDocToken } from "@earendil-works/pi-durable";

export interface ConvMetaState extends JsonObject {
  name: string;
  createdAt: number;
  /** M4：目标执行机 envId；缺省 = hub 本地执行。JsonValue 不允许 undefined，
   *  不设目标机时存 null。 */
  envId: string | null;
}

export const ConvMetaDoc: RewindableConversationDocToken<ConvMetaState> = defineDoc({
  kind: "dorahub.meta",
  version: 1,
  scope: "conversation",
  history: "rewindable",
  fork: "asOf",
  initial: () => ({ name: "", createdAt: Date.now(), envId: null }),
});
