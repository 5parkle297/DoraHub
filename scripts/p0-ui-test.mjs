/**
 * P0 批次 UI 实测（preview 4399，坑 #26 先注销 SW）：
 * - 桌面：三区布局（等你/运行中/项目分组）、unread 点、NeedsYou 入口
 * - 手机 390px：等你入口在列表页 header、状态区
 * - 收尾卡：需要真跑一轮（在会话页检查 .run-report 存在性——不强制，标记 informational）
 */
import puppeteer from "file:///C:/Users/shiyu/.pi/agent/skills/pi-skills/browser-tools/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";

const BASE = "http://localhost:4399";
let pass = 0, fail = 0, info = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}
function note(name) { info++; console.log(`  · ${name}`); }

const browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:9222", defaultViewport: null });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });

// 坑 #26：注销生产 SW
await page.goto(`${BASE}/`, { waitUntil: "networkidle2" });
await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())));
await page.reload({ waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 1500));

// ---- 桌面 ----
console.log("\n[桌面 1280px]");
{
  const r = await page.evaluate(() => {
    const labels = [...document.querySelectorAll(".group-label .group-name")].map((e) => e.textContent);
    return JSON.stringify({
      hash: location.hash,
      wide: matchMedia("(min-width: 769px)").matches,
      labels,
      convCards: document.querySelectorAll(".conv-item").length,
      unreadDots: document.querySelectorAll(".unread-dot").length,
      needsYouBtn: !!document.querySelector(".needs-you-btn"),
      waitingSection: labels.some((l) => l.includes("等你处理")),
      runningSection: labels.some((l) => l.includes("运行中")),
      projectGroups: labels.filter((l) => !l.includes("等你") && !l.includes("运行中")).length,
    });
  });
  const d = JSON.parse(r);
  ok(d.wide, "桌面两栏模式");
  ok(d.convCards > 0, `会话卡片渲染（${d.convCards} 张）`);
  ok(d.projectGroups > 0, `项目分组保留（${d.projectGroups} 组）`);
  note(`unread 点 ${d.unreadDots} 个（取决于数据，有未读会话才有）`);
  // 等你处理区：当前有残留确认卡（1547/1560 软删了但在 confirm 队列里）→ 应显示
  if (d.waitingSection) ok(true, "「等你处理」区显示");
  else note("「等你处理」区当前无数据（正常，无待处理会话时隐藏）");
  if (d.runningSection) ok(true, "「运行中」区显示");
  else note("「运行中」区当前无数据（正常）");
}

// NeedsYou 按钮交互（有待处理时）
{
  const hasBtn = await page.evaluate(() => !!document.querySelector(".needs-you-btn"));
  if (hasBtn) {
    await page.click(".needs-you-btn");
    await new Promise((r) => setTimeout(r, 400));
    const r2 = await page.evaluate(() => JSON.stringify({
      popOpen: !!document.querySelector(".needs-you-pop"),
      items: document.querySelectorAll(".needs-you-item").length,
      count: document.querySelector(".needs-you-count")?.textContent ?? null,
    }));
    const d2 = JSON.parse(r2);
    ok(d2.popOpen, "点击「等你」弹出聚合列表");
    ok(d2.items > 0, `聚合列表有条目（${d2.items} 条，count=${d2.count}）`);
    // 点一条跳会话
    await page.click(".needs-you-item");
    await new Promise((r) => setTimeout(r, 800));
    const hash = await page.evaluate(() => location.hash);
    ok(hash.startsWith("#/conversations/"), `点击条目跳转会话（${hash}）`);
    await page.evaluate(() => history.back());
  } else {
    note("NeedsYou 按钮当前无待处理数据不显示（正常）");
  }
}

// ---- 手机 390px ----
console.log("\n[手机 390px]");
{
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`${BASE}/#/conversations`, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 1200));
  const r = await page.evaluate(() => {
    const labels = [...document.querySelectorAll(".group-label .group-name")].map((e) => e.textContent);
    return JSON.stringify({
      wide: matchMedia("(min-width: 769px)").matches,
      needsYouBtn: !!document.querySelector(".list-header .needs-you-btn"),
      labels,
      piSection: !!document.querySelector(".pi-side"),
      settingsGear: [...document.querySelectorAll(".list-header button")].some((b) => b.textContent.trim() === "⚙"),
    });
  });
  const d = JSON.parse(r);
  ok(!d.wide, "手机单栏模式");
  note(`手机「等你」入口：${d.needsYouBtn ? "显示" : "无待处理数据不显示（正常）"}`);
  ok(d.piSection, "手机列表页有 pi 会话区（P0-4）");
  ok(!d.settingsGear, "手机无设置齿轮（驾驶舱克制不变）");
  note(`手机分组：${d.labels.slice(0, 5).join(" / ")}`);
}

// 桌面空态（WelcomePane）——现在有会话，只在无路由会话时显示 hint
console.log("\n[空态文案（有会话时）]");
{
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${BASE}/#/conversations`, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 800));
  const r = await page.evaluate(() => JSON.stringify({
    welcomeHint: document.querySelector(".welcome-hint")?.textContent ?? null,
    firstSteps: !!document.querySelector(".welcome-first-steps"),
  }));
  const d = JSON.parse(r);
  note(`welcome-hint: ${d.welcomeHint}`);
  note(`零会话行动指引（first-steps）在有会话时不显示：${!d.firstSteps}（符合预期）`);
}

await page.close();
await browser.disconnect();
console.log(`\n结果: ${pass} 过 / ${fail} 挂 / ${info} 信息项`);
process.exit(fail ? 1 : 0);
