/**
 * 收尾汇报卡（P0-3）UI 实测：跑一轮带工具调用的会话，验证 run_end 后
 * 消息流末尾出现 .run-report（tone/结论/统计）。
 * 用 zjl/grok-4.7（快）跑读文件任务。
 */
import puppeteer from "file:///C:/Users/shiyu/.pi/agent/skills/pi-skills/browser-tools/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";

const API = "http://127.0.0.1:8787";
const BASE = "http://localhost:4399";
let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

async function main() {
  const cr = await fetch(`${API}/api/conversations`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ cwd: "D:/hobby/pi-durable" }),
  });
  const { id } = await cr.json();
  console.log(`测试会话: ${id}`);

  const browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:9222", defaultViewport: null });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${BASE}/#/conversations/${id}`, { waitUntil: "networkidle2" });
  await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())));
  await page.reload({ waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 1000));

  // 通过 UI 的 composer 发消息（真实用户路径）
  await page.type(".composer textarea", "请用 read 工具读 package.json 的 name 字段并告诉我");
  await page.keyboard.press("Enter");

  // 等 run 结束（状态徽章消失 / run-report 出现，最长 4 分钟）
  let reported = false;
  const t0 = Date.now();
  while (!reported && Date.now() - t0 < 240_000) {
    await new Promise((r) => setTimeout(r, 3000));
    reported = await page.evaluate(() => !!document.querySelector(".run-report"));
  }

  const r = await page.evaluate(() => {
    const card = document.querySelector(".run-report");
    if (!card) return JSON.stringify({ exists: false });
    return JSON.stringify({
      exists: true,
      tone: card.className.includes("run-done") ? "done" : card.className.includes("run-attention") ? "attention" : "failed",
      title: card.querySelector(".run-report-title")?.textContent ?? null,
      conclusion: card.querySelector(".run-report-conclusion")?.textContent?.slice(0, 60) ?? null,
      facts: [...card.querySelectorAll(".run-report-fact")].map((e) => e.textContent),
      time: card.querySelector(".run-report-time")?.textContent ?? null,
    });
  });
  const d = JSON.parse(r);
  ok(d.exists, "run-report 卡出现");
  if (d.exists) {
    ok(d.tone === "done", `tone=done（实际 ${d.tone}）`);
    ok(!!d.title, `标题（${d.title}）`);
    ok((d.conclusion ?? "").length > 0, `结论行（${d.conclusion?.slice(0, 40)}…）`);
    ok(d.facts.some((f) => f.includes("工具调用")), `工具统计（${d.facts.join(" / ")}）`);
    await page.screenshot({ path: "tmp/p0-run-report.png" });
  }

  // 清理
  await fetch(`${API}/api/conversations/${id}`, { method: "DELETE" });
  await page.close();
  await browser.disconnect();
  console.log(`\n结果: ${pass} 过 / ${fail} 挂（测试会话已软删）`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
