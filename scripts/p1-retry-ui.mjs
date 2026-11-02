/**
 * P1-5 发送失败重试 UI e2e（preview 4399 + server 8787）：
 * 1. CDP Fetch.failRequest 拦截 /messages POST → 发送失败
 * 2. 错误条出现（没发出去 + 重试按钮），输入框文本保留
 * 3. 取消拦截 → 点重试 → 发送成功（错误条消失、文本清空、消息上屏）
 * 4. 「知道了」按钮关闭错误条
 */
import puppeteer from "file:///C:/Users/shiyu/.pi/agent/skills/pi-skills/browser-tools/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";

const BASE = "http://localhost:4399";
const API = "http://127.0.0.1:8787";
let pass = 0, fail = 0;
function ok(cond, name, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? `（${extra}）` : ""}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? `（${extra}）` : ""}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 建测试会话
const created = await (await fetch(`${API}/api/conversations`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
})).json();
const id = created.id;
console.log(`测试会话: ${id}`);

const browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:9222", defaultViewport: null });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
await page.goto(`${BASE}/`, { waitUntil: "networkidle2" });
await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())));
await page.reload({ waitUntil: "networkidle2" });

await page.goto(`${BASE}/#/conversations/${id}`, { waitUntil: "networkidle2" });
await sleep(1500);

// 开 Fetch 拦截：/messages POST 一律失败（先导航后开，避免拦截干扰页面加载）
const client = await page.createCDPSession();
await client.send("Fetch.enable", { patterns: [{ urlPattern: "*/messages*", requestStage: "Request" }] });
client.on("Fetch.requestPaused", async (ev) => {
  if (ev.request.url.includes("/messages") && ev.request.method === "POST") {
    await client.send("Fetch.failRequest", { requestId: ev.requestId, errorReason: "ConnectionRefused" });
  } else {
    await client.send("Fetch.continueRequest", { requestId: ev.requestId }).catch(() => {});
  }
});

// 输入并发送（失败）
await page.type(".composer textarea", "重试测试消息 abc123");
await page.click(".send-btn");
await sleep(1500);
const failedBar = await page.$(".send-failed-bar");
ok(!!failedBar, "失败后出现错误条");
const textKept = await page.$eval(".composer textarea", (e) => e.value);
ok(textKept.includes("abc123"), "文本保留在输入框", textKept.slice(0, 30));

// 关拦截 → 重试
await client.send("Fetch.disable");
const retryBtn = await page.evaluateHandle(() => [...document.querySelectorAll(".send-failed-bar button")].find((b) => b.textContent.includes("重试")));
ok(!!(retryBtn && await retryBtn.asElement()), "有重试按钮");
await retryBtn.asElement().click();
await sleep(2500);
const barGone = await page.$(".send-failed-bar");
ok(!barGone, "重试成功后错误条消失");
const textCleared = await page.$eval(".composer textarea", (e) => e.value);
ok(textCleared === "", "重试成功后文本清空");

// 等消息进快照（WS 事件流确认服务端收到了）
let sent = false;
for (let i = 0; i < 10; i++) {
  const snap = await (await fetch(`${API}/api/conversations/${id}/snapshot`)).json();
  const all = JSON.stringify(snap);
  if (all.includes("abc123")) { sent = true; break; }
  await sleep(1000);
}
ok(sent, "消息真的发出去了（服务端 snapshot 有 abc123）");

// 「知道了」路径：再拦一次
await client.send("Fetch.enable", { patterns: [{ urlPattern: "*/messages*", requestStage: "Request" }] });
await page.type(".composer textarea", "第二条 xyz789");
await page.click(".send-btn");
await sleep(1500);
const knowBtn = await page.evaluateHandle(() => [...document.querySelectorAll(".send-failed-bar button")].find((b) => b.textContent.includes("知道了")));
ok(!!(knowBtn && await knowBtn.asElement()), "第二条失败也有错误条");
await knowBtn.asElement().click();
await sleep(300);
ok(!(await page.$(".send-failed-bar")), "「知道了」关闭错误条");
const text2 = await page.$eval(".composer textarea", (e) => e.value);
ok(text2.includes("xyz789"), "文本仍保留（可手动再发）");
await client.send("Fetch.disable");

// 清理
await fetch(`${API}/api/conversations/${id}`, { method: "DELETE" });
console.log(`\n结果: ${pass} 过 / ${fail} 挂（测试会话已软删）`);
await page.close();
browser.disconnect();
process.exit(fail > 0 ? 1 : 0);
