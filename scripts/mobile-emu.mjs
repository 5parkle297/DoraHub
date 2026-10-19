// 手机仿真验证（S9）：CDP Emulation.setDeviceMetricsOverride（坑 #18：Browser.setWindowBounds 不改 viewport）
// 用法：node scripts/mobile-emu.mjs [width]  → 390 手机 / 1264 还原桌面
import puppeteer from "file:///C:/Users/shiyu/.pi/agent/skills/pi-skills/browser-tools/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";

const width = Number(process.argv[2] ?? 390);
const browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:9222", defaultViewport: null });
const page = (await browser.pages()).find((p) => p.url().startsWith("http://localhost:5173"));
if (!page) { console.error("no tab on :5173"); process.exit(1); }

const client = await page.createCDPSession();
await client.send("Emulation.setDeviceMetricsOverride", {
  width, height: 844, deviceScaleFactor: 2, mobile: width < 769,
});
await page.reload({ waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 1500));

const result = await page.evaluate(() => {
  const wide = matchMedia("(min-width: 769px)").matches;
  const isList = location.hash === "#/conversations" || location.hash === "";
  return JSON.stringify({
    innerW: innerWidth, wide,
    layout: wide ? "desktop-two-col" : "mobile-cockpit",
    headerBtns: [...document.querySelectorAll(".list-header button")].map((b) => b.textContent.trim()).slice(0, 5),
    groupLabels: [...document.querySelectorAll(".group-label .group-name")].map((e) => e.textContent),
    convCards: document.querySelectorAll(".conv-item").length,
    unnamedCards: document.querySelectorAll(".conv-name.unnamed").length,
    settingsGearVisible: [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "⚙"),
  });
});
console.log(result);
await browser.disconnect();
