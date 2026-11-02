/** 会话页冒烟（防白屏）：打开一个会话页，断言核心元素渲染 + 无 pageerror。
 * 背景：坑 #25——tsc --noCheck 查不出未定义引用，P1-2 时 useState 插错位置
 * 造成会话页白屏三天没发现（stalledMinutes is not defined）。
 * 发版前/大改后必跑。 */
import puppeteer from "file:///C:/Users/shiyu/.pi/agent/skills/pi-skills/browser-tools/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";

const BASE = "http://localhost:4399";
const API = "http://127.0.0.1:8787";
let pass = 0, fail = 0;
function ok(cond, name, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? `（${extra}）` : ""}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? `（${extra}）` : ""}`); }
}

const created = await (await fetch(`${API}/api/conversations`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
})).json();

const browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:9222", defaultViewport: null });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));

await page.setViewport({ width: 1280, height: 900 });
await page.goto(`${BASE}/`, { waitUntil: "networkidle2" });
await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())));
await page.goto(`${BASE}/#/conversations/${created.id}`, { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 2000));

const r = await page.evaluate(() => JSON.stringify({
  convHeader: !!document.querySelector(".conv-header"),
  composer: !!document.querySelector(".composer"),
  textarea: !!document.querySelector(".composer textarea"),
  sendBtn: !!document.querySelector(".send-btn"),
  msgList: !!document.querySelector(".msg-list, .messages, main"),
}));
const d = JSON.parse(r);
ok(d.convHeader, "会话页 header 渲染");
ok(d.composer && d.textarea, "Composer 渲染");
ok(d.sendBtn, "发送按钮渲染");
ok(errors.length === 0, `零 pageerror（白屏防线）`, errors[0] ?? "");

await fetch(`${API}/api/conversations/${created.id}`, { method: "DELETE" });
console.log(`\n结果: ${pass} 过 / ${fail} 挂`);
await page.close();
browser.disconnect();
process.exit(fail > 0 ? 1 : 0);
