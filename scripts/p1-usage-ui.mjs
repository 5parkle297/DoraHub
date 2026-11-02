/** P1-3 今日花费 UI 验证：设置「关于」页显示今日用量（preview 4399） */
import puppeteer from "file:///C:/Users/shiyu/.pi/agent/skills/pi-skills/browser-tools/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";

const BASE = "http://localhost:4399";
let pass = 0, fail = 0;
function ok(cond, name, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? `（${extra}）` : ""}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? `（${extra}）` : ""}`); }
}

const browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:9222", defaultViewport: null });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
await page.goto(`${BASE}/`, { waitUntil: "networkidle2" });
await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())));
await page.reload({ waitUntil: "networkidle2" });

// 桌面：点 ⚙ 打开设置 → 「关于」页签
const gear = await page.$(".sidebar .header-btns .icon-btn");
ok(!!gear, "找到设置按钮");
await gear.click();
await new Promise((r) => setTimeout(r, 500));
const tabs = await page.$$eval(".settings-tab", (els) => els.map((e) => e.textContent.trim()));
ok(tabs.includes("关于"), "设置有「关于」页签", tabs.join("/"));
await page.evaluate(() => {
  const t = [...document.querySelectorAll(".settings-tab")].find((e) => e.textContent.trim() === "关于");
  t?.click();
});
await new Promise((r) => setTimeout(r, 800));

const r = await page.evaluate(() => {
  const keys = [...document.querySelectorAll(".about-key")].map((e) => e.textContent);
  const grid = document.querySelector(".about-grid");
  const rows = grid ? grid.textContent : "";
  const models = [...document.querySelectorAll(".usage-model-row")].map((e) => e.textContent.trim());
  return JSON.stringify({ keys, hasUsage: rows.includes("今日花费"), rows: rows.slice(0, 150), models });
});
const d = JSON.parse(r);
ok(d.keys.some((k) => k.includes("今日花费")), "「关于」页有今日花费行", d.keys.join("/"));
ok(d.rows.includes("次调用"), "用量数字渲染", d.rows.match(/今日花费[^次]*次调用[^\s]*/)?.[0] ?? "");
ok(d.models.length > 0, "分模型明细渲染", d.models[0] ?? "");

// 深色对比度
await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
await new Promise((r) => setTimeout(r, 300));
const dark = await page.evaluate(() => {
  const el = document.querySelector(".usage-model-meta");
  if (!el) return null;
  const cs = getComputedStyle(el);
  return JSON.stringify({ color: cs.color, bg: getComputedStyle(document.querySelector(".settings-body")).backgroundColor });
});
ok(dark != null, "深色模式明细渲染", dark ?? "");

console.log(`\n结果: ${pass} 过 / ${fail} 挂`);
await page.close();
browser.disconnect();
process.exit(fail > 0 ? 1 : 0);
