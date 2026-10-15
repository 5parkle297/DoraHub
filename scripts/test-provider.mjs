// 验证 V-02：用 pi-ai 的 createProvider + openai-completions API 搭自定义 OpenAI 兼容 provider
import { createModels, createProvider } from "@earendil-works/pi-ai";
import { stream, streamSimple } from "@earendil-works/pi-ai/api/openai-completions";

const BASE_URL = process.env.ZJL_BASE_URL;
const API_KEY = process.env.ZJL_API_KEY;

const provider = createProvider({
  id: "zjl",
  name: "zjl",
  baseUrl: BASE_URL,
  auth: {
    apiKey: {
      name: "zjl API key",
      resolve: async () => ({ auth: { apiKey: API_KEY }, source: "env" }),
    },
  },
  models: [
    {
      id: "grok-4.7",
      provider: "zjl",
      api: "openai-completions",
      baseUrl: BASE_URL,
      name: "grok-4.7",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 500000,
      maxTokens: 8192,
      cost: {},
      compat: { supportsDeveloperRole: false, supportsStore: false },
    },
  ],
  api: { "openai-completions": { stream, streamSimple } },
});

const models = createModels();
models.setProvider(provider);

const model = models.getModel("zjl", "grok-4.7");
if (!model) throw new Error("model not found");
console.log("model ok:", model.id, "api:", model.api);

// 最小流式请求
const stream2 = models.streamSimple(model, {
  systemPrompt: "You are a helpful assistant. Reply in one short sentence.",
  messages: [{ role: "user", content: [{ type: "text", text: "Say hello and tell me what model you are." }] }],
});

for await (const ev of stream2) {
  if (ev.type === "text_delta") process.stdout.write(ev.delta);
  if (ev.type === "message_end") {
    const m = ev.message;
    console.log("\n[stopReason:", m.stopReason, "usage:", JSON.stringify(m.usage.totalTokens), "]");
  }
  if (ev.type === "error") console.log("\nERR:", ev.error.errorMessage ?? ev.error);
}
console.log("DONE");
