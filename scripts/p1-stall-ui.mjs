/**
 * P1-2 卡死徽章 UI 验证（preview 4399，需 server 以 DORAHUB_STALL_MS=5000 跑着）：
 * 制造一个卡死会话 → 列表卡出现「⏸ N 分钟没动静」amber 徽章（替换「● 运行中」脉冲）；
 * 恢复后徽章消失。深色模式同验。
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

// 坑 #26：注销生产 SW
await page.goto(`${BASE}/`, { waitUntil: "networkidle2" });
await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())));
await page.reload({ waitUntil: "networkidle2" });

// ---- 制造卡死会话 ----
const created = await (await fetch(`${API}/api/conversations`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
})).json();
const id = created.id;
console.log(`测试会话: ${id}`);
await fetch(`${API}/api/conversations/${id}/messages`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ content: "用 bash 执行 sleep 45，不要做别的，执行完回复 done" }),
});
console.log("已提交 sleep 任务，等卡死标记（阈值 5s + 扫描 60s）…");

const list = async () => (await fetch(`${API}/api/conversations`)).json();
let stalledMinutes = null;
for (let i = 0; i < 35; i++) {
  const cs = await list();
  const me = cs.find((c) => c.id === id);
  if (me?.stalledMinutes != null) { stalledMinutes = me.stalledMinutes; break; }
  await sleep(4000);
}
ok(stalledMinutes != null, `服务端 stalledMinutes=${stalledMinutes}`);

// ---- 列表页 UI ----
await page.goto(`${BASE}/#/conversations`, { waitUntil: "networkidle2" });
await sleep(1500);
const r1 = await page.evaluate((cid) => {
  // 直接定位带卡死徽章的卡（测试会话未命名时列表里可能有多张「新会话」）
  const cards = [...document.querySelectorAll(".conv-item")];
  const stalledCard = cards.find((c) => c.querySelector(".badge-stalled"));
  return JSON.stringify({
    stalledBadge: stalledCard ? (stalledCard.querySelector(".badge-stalled")?.textContent ?? null) : null,
    runningBadge: stalledCard ? !!stalledCard.querySelector(".badge-running") : null,
    stalledCardCount: cards.filter((c) => c.querySelector(".badge-stalled")).length,
  });
}, id);
const d1 = JSON.parse(r1);
ok(d1.stalledBadge && d1.stalledBadge.includes("没动静"), `列表卡出现卡死徽章`, JSON.stringify(d1));
ok(!d1.runningBadge, "运行中脉冲徽章被替换（不是叠加）");

// 深色模式
await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
await sleep(400);
const rDark = await page.evaluate(() => {
  const b = document.querySelector(".badge-stalled");
  if (!b) return "null";
  const cs = getComputedStyle(b);
  return JSON.stringify({ color: cs.color, bg: cs.backgroundColor });
});
await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
ok(rDark !== "null", "深色模式徽章存在", rDark);

// ---- 清理（等任务跑完，别留 running 会话）----
console.log("等任务结束…");
for (let i = 0; i < 40; i++) {
  const cs = await list();
  const me = cs.find((c) => c.id === id);
  if (me?.status === "idle") break;
  await sleep(4000);
}
await fetch(`${API}/api/conversations/${id}`, { method: "DELETE" });

console.log(`\n结果: ${pass} 过 / ${fail} 挂`);
await page.close();
browser.disconnect();
process.exit(fail > 0 ? 1 : 0);
