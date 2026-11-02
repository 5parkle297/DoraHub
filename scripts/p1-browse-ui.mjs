/**
 * P1-4 目录树浏览器 UI e2e v2（对齐 Sig directory-picker 交互，preview 4399 + server 8787）：
 * 1. 展开面板：toolbar（主目录/电脑/上一级/隐藏目录开关）+ 面包屑 + 手输跳转
 * 2. 只列目录（无文件行）
 * 3. 点目录进入，面包屑更新
 * 4. 「电脑」→ 盘根（parent=null，「上一级」禁用）
 * 5. 手输路径跳转
 * 6. 隐藏目录开关（hidden=1 出现 .git 等）
 * 7. 选这个目录 → 回填
 */
import puppeteer from "file:///C:/Users/shiyu/.pi/agent/skills/pi-skills/browser-tools/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";

const BASE = "http://localhost:4399";
let pass = 0, fail = 0;
function ok(cond, name, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? `（${extra}）` : ""}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? `（${extra}）` : ""}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:9222", defaultViewport: null });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 150)));
await page.setViewport({ width: 1280, height: 900 });
await page.goto(`${BASE}/`, { waitUntil: "networkidle2" });
await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())));
await page.reload({ waitUntil: "networkidle2" });

// 打开新建 → 浏览
await page.evaluate(() => window.dispatchEvent(new CustomEvent("dorahub:new-conv")));
await sleep(600);
const browseBtn = await page.evaluateHandle(() => [...document.querySelectorAll(".modal button")].find((b) => b.textContent.trim() === "浏览"));
await browseBtn.asElement().click();
await sleep(2000);

// 1. 结构
ok(!!(await page.$(".dir-toolbar")), "toolbar 渲染（主目录/电脑/上一级）");
ok(!!(await page.$(".dir-go")), "手输跳转框");
ok(!!(await page.$(".dir-hidden-toggle")), "隐藏目录开关");
const crumbs1 = await page.$$eval(".crumb", (els) => els.map((e) => e.textContent));
ok(crumbs1.length > 0, "面包屑渲染", crumbs1.join("›"));

// 2. 只列目录
await sleep(800);
const items = await page.$$eval(".dir-item", (els) => els.map((e) => e.textContent.trim()));
ok(items.length > 0, `目录列表（${items.length} 项）`, items.slice(0, 4).join(","));
ok(!items.some((t) => t.includes("package.json") || t.includes("README")), "无文件噪声（只目录）");
ok(!items.some((t) => t.startsWith(".") || t.includes(".git")), "默认隐藏 . 目录");

// 3. 进子目录
const firstDir = await page.evaluateHandle(() => document.querySelector(".dir-item"));
await firstDir.asElement().click();
await sleep(1500);
const crumbs2 = await page.$$eval(".crumb", (els) => els.map((e) => e.textContent));
ok(crumbs2.length > crumbs1.length || crumbs2.join() !== crumbs1.join(), "进入子目录面包屑更新", crumbs2.join("›"));

// 4. 电脑 → 盘根
const computerBtn = await page.evaluateHandle(() => [...document.querySelectorAll(".dir-toolbar button")].find((b) => b.textContent.includes("电脑")));
await computerBtn.asElement().click();
await sleep(1800);
const rootCrumbs = await page.$$eval(".crumb", (els) => els.map((e) => e.textContent));
const upBtn = await page.evaluateHandle(() => [...document.querySelectorAll(".dir-toolbar button")].find((b) => b.textContent.includes("上一级")));
const upDisabled = await upBtn.asElement().evaluate((e) => e.disabled);
ok(rootCrumbs.length === 1 && /^([A-Za-z]:[\\/]?)?$|^\/$/.test(rootCrumbs[0]), "电脑根：盘符列表", rootCrumbs.join("›"));
ok(upDisabled, "盘根处「上一级」禁用");

// 5. 手输跳转
await page.evaluate(() => {
  const inp = document.querySelector(".dir-go input");
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(inp, "D:/hobby");
  inp.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.click(".dir-go .btn");
await sleep(1800);
const afterGo = await page.$$eval(".crumb", (els) => els.map((e) => e.textContent));
ok(afterGo.join("›").includes("hobby"), "手输跳转到 D:/hobby", afterGo.join("›"));

// 6. 隐藏目录开关
const before = await page.$$eval(".dir-item", (els) => els.length);
const toggle = await page.$(".dir-hidden-toggle input");
await toggle.click();
await sleep(1800);
const after = await page.$$eval(".dir-item", (els) => els.length);
ok(after >= before, `开关后目录数 ≥ 默认`, `${before}→${after}`);

// 关掉开关还原
const toggle2 = await page.$(".dir-hidden-toggle input");
await toggle2.click();
await sleep(1500);

// 7. 选这个目录回填
const pickBtn = await page.evaluateHandle(() => [...document.querySelectorAll(".dir-actions button")].find((b) => b.textContent.includes("选这个目录")));
await pickBtn.asElement().click();
await sleep(500);
const inputVal = await page.$eval(".modal input", (e) => e.value);
ok(inputVal.includes("hobby"), "路径回填", inputVal);
ok(!(await page.$(".dir-browser")), "面板关闭");
ok(errors.length === 0, "零 pageerror", errors[0] ?? "");

// 手机 390px
await page.setViewport({ width: 390, height: 844 });
await page.goto(`${BASE}/#/conversations`, { waitUntil: "networkidle2" });
await sleep(1200);
await page.evaluate(() => window.dispatchEvent(new CustomEvent("dorahub:new-conv")));
await sleep(600);
const bBtn2 = await page.evaluateHandle(() => [...document.querySelectorAll(".modal button")].find((b) => b.textContent.trim() === "浏览"));
await bBtn2.asElement().click();
await sleep(1800);
const fit = await page.evaluate(() => {
  const el = document.querySelector(".dir-browser");
  if (!el) return "missing";
  const r = el.getBoundingClientRect();
  return JSON.stringify({ overflow: r.right > window.innerWidth + 1, w: Math.round(r.width) });
});
ok(fit !== "missing" && !JSON.parse(fit).overflow, "手机 390px 不溢出", fit);

console.log(`\n结果: ${pass} 过 / ${fail} 挂`);
await page.close();
browser.disconnect();
process.exit(fail > 0 ? 1 : 0);
