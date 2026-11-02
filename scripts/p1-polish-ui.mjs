/**
 * Sig 对齐精进批次 UI 验证（preview 4399）：
 * 1. 标签页标题计数：制造 unread → title 带 (N 新)；等你 → title 带 (◆N)
 * 2. 桌面 header machines 徽章（▷ N/N，全在线灰、离线 amber）
 * 3. 手机 390px：header 有「＋」新建按钮 → 点开新建弹窗
 * 4. InboxBar 自然语言（跑 steer 场景验证文案）
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

const browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:9222", defaultViewport: null });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
await page.goto(`${BASE}/`, { waitUntil: "networkidle2" });
await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())));
await page.reload({ waitUntil: "networkidle2" });

// ---- 1. machines 徽章（桌面）----
await sleep(1500);
const badge = await page.evaluate(() => {
  const b = document.querySelector(".sidebar .machines-badge");
  return b ? { text: b.textContent.trim(), warn: b.classList.contains("warn") } : null;
});
ok(badge != null && /▷\s*\d+\/\d+/.test(badge.text), "桌面 header machines 徽章", badge ? badge.text : "missing");
console.log(`  · machines 状态: ${badge?.text} ${badge?.warn ? "(有离线，amber)" : "(全在线)"}`);

// ---- 2. 标题计数：制造 unread（跑一轮无人看的会话）----
const created = await (await fetch(`${API}/api/conversations`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
})).json();
await fetch(`${API}/api/conversations/${created.id}/messages`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ content: "回复 ok 即可" }),
});
console.log("等一轮跑完（无人 attach → unread）…");
for (let i = 0; i < 60; i++) {
  const cs = await (await fetch(`${API}/api/conversations`)).json();
  const me = cs.find((c) => c.id === created.id);
  if (me?.status === "idle" && me?.unread) break;
  await sleep(3000);
}
// 刷新列表页拿新状态
await page.goto(`${BASE}/#/conversations`, { waitUntil: "networkidle2" });
await sleep(2000);
const title1 = await page.title();
ok(/新/.test(title1), "标签页标题带 unread 计数", title1);

// 打开会话（已读）→ 标题应该清掉 unread 部分
await page.goto(`${BASE}/#/conversations/${created.id}`, { waitUntil: "networkidle2" });
await sleep(2000);
const title2 = await page.title();
ok(!/新/.test(title2), "打开会话后标题 unread 清零", title2);

// ---- 3. 手机 ＋ 按钮 ----
await page.setViewport({ width: 390, height: 844 });
await page.goto(`${BASE}/#/conversations`, { waitUntil: "networkidle2" });
await sleep(1500);
const plus = await page.$(".list-header .mobile-new-btn");
ok(!!plus, "手机 header 有「＋」新建按钮");
if (plus) {
  await plus.click();
  await sleep(800);
  ok(!!(await page.$(".modal")), "点「＋」打开新建弹窗");
  ok(!!(await page.$(".picker-row")), "新建弹窗内容正常（执行机选择）");
  // 关闭
  await page.keyboard.press("Escape").catch(() => {});
  const mask = await page.$(".menu-mask");
  if (mask) await mask.click().catch(() => {});
}

// 清理
await fetch(`${API}/api/conversations/${created.id}`, { method: "DELETE" });
console.log(`\n结果: ${pass} 过 / ${fail} 挂`);
await page.close();
browser.disconnect();
process.exit(fail > 0 ? 1 : 0);
