/**
 * 完整 UI 验证：真触发一张确认卡（guard），在页面上验证「等你处理」区 +
 * NeedsYou 按钮弹出 + 跳转 + 确认卡渲染。跑完清理。
 */
import puppeteer from "file:///C:/Users/shiyu/.pi/agent/skills/pi-skills/browser-tools/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";

const API = "http://127.0.0.1:8787";
const BASE = "http://localhost:4399";
let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

const list = async () => (await fetch(`${API}/api/conversations`)).json();

async function main() {
  // 造一个会话 + 触发 guard
  const cr = await fetch(`${API}/api/conversations`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ cwd: "D:/hobby/pi-durable" }),
  });
  const { id } = await cr.json();
  console.log(`测试会话: ${id}`);
  await fetch(`${API}/api/conversations/${id}/messages`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: "请用 bash 工具执行：git push origin main", mode: "input" }),
  });

  const browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:9222", defaultViewport: null });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${BASE}/`, { waitUntil: "networkidle2" });
  await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())));
  await page.reload({ waitUntil: "networkidle2" });

  // 等确认卡弹出（轮询列表接口）
  let pending = 0;
  const t0 = Date.now();
  while (pending === 0 && Date.now() - t0 < 240_000) {
    await new Promise((r) => setTimeout(r, 3000));
    const cs = await list();
    pending = cs.find((c) => c.id === id)?.pendingConfirms ?? 0;
  }
  console.log(`确认卡状态: pending=${pending}`);

  await page.reload({ waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 1200));

  // 1) 侧栏「等你处理」区
  const r1 = await page.evaluate(() => JSON.stringify({
    waitingSection: [...document.querySelectorAll(".group-label .group-name")].some((e) => e.textContent.includes("等你处理")),
    waitingCards: [...document.querySelectorAll(".state-waiting .conv-item")].length,
    waitingBadge: document.querySelector(".state-waiting .conv-item .badge-waiting")?.textContent ?? null,
  }));
  const d1 = JSON.parse(r1);
  ok(d1.waitingSection, "侧栏「等你处理」区显示");
  ok(d1.waitingCards === 1, `等你区有该会话（${d1.waitingCards} 张）`);
  ok(!!d1.waitingBadge, `等你徽章（${d1.waitingBadge}）`);

  // 2) NeedsYou 按钮 + 弹出
  const r2 = await page.evaluate(() => JSON.stringify({
    btn: !!document.querySelector(".needs-you-btn"),
    count: document.querySelector(".needs-you-count")?.textContent ?? null,
  }));
  const d2 = JSON.parse(r2);
  ok(d2.btn, "header「等你」按钮显示");
  ok(d2.count === "1", `按钮计数=1（实际 ${d2.count}）`);

  await page.click(".needs-you-btn");
  await new Promise((r) => setTimeout(r, 400));
  const r3 = await page.evaluate(() => JSON.stringify({
    popOpen: !!document.querySelector(".needs-you-pop"),
    items: [...document.querySelectorAll(".needs-you-item")].length,
    firstName: document.querySelector(".needs-you-item-name")?.textContent ?? null,
  }));
  const d3 = JSON.parse(r3);
  ok(d3.popOpen, "弹出聚合列表");
  ok(d3.items === 1, `聚合 1 条（${d3.items}）`);
  ok((d3.firstName ?? "").length > 0, `条目名（${d3.firstName?.slice(0, 20)}）`);

  // 3) 点条目 → 跳会话 → 确认卡渲染
  await page.click(".needs-you-item");
  await new Promise((r) => setTimeout(r, 1200));
  const r4 = await page.evaluate(() => JSON.stringify({
    hash: location.hash,
    confirmCard: !!document.querySelector(".confirm-zone .confirm-card"),
  }));
  const d4 = JSON.parse(r4);
  ok(d4.hash === `#/conversations/${id}`, `跳转到测试会话（${d4.hash}）`);
  ok(d4.confirmCard, "会话页确认卡渲染");

  // 4) 手机模式同验（等你区 + 列表 header）
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`${BASE}/#/conversations`, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 1000));
  const r5 = await page.evaluate(() => JSON.stringify({
    needsYouBtn: !!document.querySelector(".list-header .needs-you-btn"),
    count: document.querySelector(".list-header .needs-you-count")?.textContent ?? null,
    waitingSection: [...document.querySelectorAll(".group-label .group-name")].some((e) => e.textContent.includes("等你处理")),
  }));
  const d5 = JSON.parse(r5);
  ok(d5.needsYouBtn, "手机列表页「等你」按钮");
  ok(d5.count === "1", `手机计数=1（${d5.count}）`);
  ok(d5.waitingSection, "手机「等你处理」区");

  // 截图存档
  await page.screenshot({ path: "tmp/p0-mobile-waiting.png" });

  // 清理：拒绝确认卡 + 软删
  const confirms = await (await fetch(`${API}/api/confirmations`)).json();
  const mine = confirms.find((c) => c.conv === id);
  if (mine) {
    await fetch(`${API}/api/confirmations/${mine.id}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ approved: false }),
    });
  }
  await new Promise((r) => setTimeout(r, 3000));
  await fetch(`${API}/api/conversations/${id}`, { method: "DELETE" });
  await page.close();
  await browser.disconnect();
  console.log(`\n结果: ${pass} 过 / ${fail} 挂（测试会话已拒绝+软删）`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
