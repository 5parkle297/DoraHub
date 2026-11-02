/**
 * P1-7 会话摘要面板 e2e（preview 4399 + server 8787）：
 * 1. 会话页 ⋯ 菜单有「会话详情」
 * 2. 点开面板：基础信息（执行机/模型/消息数）渲染
 * 3. 跑过一轮后有「最近一轮」（tone + 统计）；没跑过显示占位
 * 4. 描述/关键词（有则显示）
 * 5. 关闭正常
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

// 建会话并跑一轮（产生 lastRunReport + 自动命名）
const created = await (await fetch(`${API}/api/conversations`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
})).json();
const id = created.id;
console.log(`测试会话: ${id}`);
await fetch(`${API}/api/conversations/${id}/messages`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ content: "回复「测试完成」四个字即可" }),
});
for (let i = 0; i < 60; i++) {
  const cs = await (await fetch(`${API}/api/conversations`)).json();
  if (cs.find((c) => c.id === id)?.status === "idle") break;
  await sleep(3000);
}
console.log("一轮跑完");

const browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:9222", defaultViewport: null });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 150)));
await page.setViewport({ width: 1280, height: 900 });
await page.goto(`${BASE}/`, { waitUntil: "networkidle2" });
await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())));
await page.goto(`${BASE}/#/conversations/${id}`, { waitUntil: "networkidle2" });
await sleep(2000);

// ⋯ 菜单
await page.click(".conv-actions .btn.ghost:last-of-type, .conv-actions button[title='更多操作']");
await sleep(500);
const hasItem = await page.evaluate(() => [...document.querySelectorAll(".menu-item")].some((b) => b.textContent.includes("会话详情")));
ok(hasItem, "⋯ 菜单有「会话详情」");
const item = await page.evaluateHandle(() => [...document.querySelectorAll(".menu-item")].find((b) => b.textContent.includes("会话详情")));
await item.asElement().click();
await sleep(600);

const r = await page.evaluate(() => JSON.stringify({
  panel: !!document.querySelector(".conv-summary"),
  grid: document.querySelector(".summary-grid")?.textContent ?? "",
  hasReport: !!document.querySelector(".summary-report"),
  reportText: document.querySelector(".summary-report")?.textContent ?? "",
  desc: document.querySelector(".summary-desc")?.textContent ?? null,
  kws: [...document.querySelectorAll(".kw-chip")].length,
}));
const d = JSON.parse(r);
ok(d.panel, "面板弹出");
ok(/执行机/.test(d.grid) && /消息数/.test(d.grid), "基础信息渲染", d.grid.slice(0, 60));
ok(d.hasReport && /完成|需注意|失败/.test(d.reportText), "最近一轮统计", d.reportText.slice(0, 60));
ok(d.desc != null || d.kws > 0, "描述或关键词有值（自动命名）", `desc=${d.desc ? "有" : "无"} kw=${d.kws}`);

// 深色
await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
await sleep(300);
ok(!!(await page.$(".conv-summary")), "深色模式面板在");
await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);

// 关闭
const closeBtn = await page.evaluateHandle(() => [...document.querySelectorAll(".conv-summary-head button")][0]);
await closeBtn.asElement().click();
await sleep(300);
ok(!(await page.$(".conv-summary")), "面板关闭");
ok(errors.length === 0, "零 pageerror", errors[0] ?? "");

// 手机 390px：面板不溢出
await page.setViewport({ width: 390, height: 844 });
await page.goto(`${BASE}/#/conversations/${id}`, { waitUntil: "networkidle2" });
await sleep(1500);
await page.click(".conv-actions button[title='更多操作']");
await sleep(400);
const mItem = await page.evaluateHandle(() => [...document.querySelectorAll(".menu-item")].find((b) => b.textContent.includes("会话详情")));
await mItem.asElement().click();
await sleep(500);
const fit = await page.evaluate(() => {
  const el = document.querySelector(".conv-summary");
  if (!el) return "missing";
  const r2 = el.getBoundingClientRect();
  return JSON.stringify({ overflow: r2.right > window.innerWidth + 1, w: Math.round(r2.width), vw: window.innerWidth });
});
ok(fit !== "missing" && !JSON.parse(fit).overflow, "手机 390px 面板不溢出", fit);

// 清理
await fetch(`${API}/api/conversations/${id}`, { method: "DELETE" });
console.log(`\n结果: ${pass} 过 / ${fail} 挂（测试会话已软删）`);
await page.close();
browser.disconnect();
process.exit(fail > 0 ? 1 : 0);
