// 深色模式 + 手机视觉检查（截图 + 关键样式断言）
import puppeteer from "file:///C:/Users/shiyu/.pi/agent/skills/pi-skills/browser-tools/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";

const browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:9222", defaultViewport: null });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });
await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
await page.goto("http://localhost:4399/#/conversations", { waitUntil: "networkidle2" });
await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())));
await page.reload({ waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 1200));

const r = await page.evaluate(() => {
  const cs = getComputedStyle(document.body);
  const card = document.querySelector(".conv-item");
  return JSON.stringify({
    bg: cs.backgroundColor,
    color: cs.color,
    cardBg: card ? getComputedStyle(card).backgroundColor : null,
    groupLabels: [...document.querySelectorAll(".group-label .group-name")].map((e) => e.textContent).slice(0, 4),
    convCount: document.querySelectorAll(".conv-item").length,
    piSection: !!document.querySelector(".pi-side"),
  });
});
console.log(r);
await page.screenshot({ path: "tmp/p0-mobile-dark.png" });
await page.close();
await browser.disconnect();
