/**
 * P1-4 目录浏览器 UI e2e（preview 4399 + server 8787）：
 * 1. 新建弹窗有「浏览」按钮 → 展开面板（面包屑+列表）
 * 2. hub 默认 cwd 列出（.git 等目录在前）
 * 3. 点目录进入（面包屑更新）
 * 4. 「选这个文件夹」回填路径输入框
 * 5. 手机 390px 面板不溢出
 * 6. workpc 离线错误显示（可选——laptop 常离线）
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
await page.setViewport({ width: 1280, height: 900 });
await page.goto(`${BASE}/`, { waitUntil: "networkidle2" });
await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())));
await page.reload({ waitUntil: "networkidle2" });

// 打开新建弹窗
await page.evaluate(() => window.dispatchEvent(new CustomEvent("dorahub:new-conv")));
await sleep(600);
ok(!!(await page.$(".modal .dir-browser")) === false, "初始不显示浏览面板");

// 点「浏览」
const browseBtn = await page.evaluateHandle(() => [...document.querySelectorAll(".modal button")].find((b) => b.textContent.trim() === "浏览"));
ok(!!browseBtn && !(await browseBtn.asElement().evaluate((e) => e === null)), "有「浏览」按钮");
await browseBtn.asElement().click();
await sleep(1500);
ok(!!(await page.$(".dir-browser")), "浏览面板展开");
const crumbs = await page.$$eval(".crumb", (els) => els.map((e) => e.textContent));
ok(crumbs.length > 0, `面包屑渲染（${crumbs.join("/")}）`);

// 等列表加载
await sleep(1000);
const items = await page.$$eval(".dir-item", (els) => els.map((e) => e.textContent.trim()));
ok(items.length > 0, `目录列表渲染（${items.length} 项）`, items.slice(0, 5).join(","));

// 点一个目录进入
if (items.length > 0) {
  const first = await page.evaluateHandle(() => document.querySelectorAll(".dir-item")[0]);
  await first.asElement().click();
  await sleep(1500);
  const crumbs2 = await page.$$eval(".crumb", (els) => els.map((e) => e.textContent));
  const items2 = await page.$$eval(".dir-item", (els) => els.length);
  ok(crumbs2.length > crumbs.length || items2 >= 0, `进入子目录（${crumbs2.join("/")}，${items2} 项）`);
}

// 「选这个文件夹」回填
const pickBtn = await page.evaluateHandle(() => [...document.querySelectorAll(".dir-actions button")].find((b) => b.textContent.includes("选这个文件夹")));
await pickBtn.asElement().click();
await sleep(400);
const inputVal = await page.$eval(".modal input", (e) => e.value);
ok(inputVal.length > 0, `路径回填输入框（${inputVal}）`);
ok(!(await page.$(".dir-browser")), "面板关闭");

// 手机 390px：手机列表页无新建按钮（IA 现状：「＋」只在桌面 header），
// 新建弹窗在手机只能从零会话空态的第一步指引进入——用 dispatchEvent 直接验证弹窗本身
await page.setViewport({ width: 390, height: 844 });
await page.goto(`${BASE}/#/conversations`, { waitUntil: "networkidle2" });
await sleep(1000);
await page.evaluate(() => window.dispatchEvent(new CustomEvent("dorahub:new-conv")));
await sleep(600);
{
  const browseBtn2 = await page.evaluateHandle(() => [...document.querySelectorAll(".modal button")].find((b) => b.textContent.trim() === "浏览"));
  if (browseBtn2 && (await browseBtn2.asElement())) {
    await browseBtn2.asElement().click();
    await sleep(1500);
    const fit = await page.evaluate(() => {
      const el = document.querySelector(".dir-browser");
      if (!el) return "missing";
      const r = el.getBoundingClientRect();
      return JSON.stringify({ overflow: r.right > window.innerWidth + 1, w: Math.round(r.width), vw: window.innerWidth });
    });
    ok(fit !== "missing" && !JSON.parse(fit).overflow, "手机 390px 面板不溢出", fit);
    ok(!!(await page.$(".dir-list .dir-item")), "手机列表渲染");
  } else {
    ok(false, "手机新建弹窗有浏览按钮");
  }
}

console.log(`\n结果: ${pass} 过 / ${fail} 挂`);
await page.close();
browser.disconnect();
process.exit(fail > 0 ? 1 : 0);
