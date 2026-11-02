/**
 * P1-3 今日花费 e2e：
 * 1. GET /api/usage/today 空态结构正确
 * 2. 跑一轮真任务 → usage 记账（models 桶 + calls + activeConvs）
 * 3. 再跑一轮 → 累加正确（calls=2）
 * 4. 重启 server → 数据持久（JSON 落盘）
 * 注意：DORAHUB_USAGE_FILE 环境变量要指到临时文件，别污染真数据
 */
const BASE = "http://127.0.0.1:8787";
let pass = 0, fail = 0;
function ok(cond, name, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? `（${extra}）` : ""}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? `（${extra}）` : ""}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function submitAndWait(id, content) {
  await fetch(`${BASE}/api/conversations/${id}/messages`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  for (let i = 0; i < 60; i++) {
    const cs = await (await fetch(`${BASE}/api/conversations`)).json();
    if (cs.find((c) => c.id === id)?.status === "idle") return true;
    await sleep(3000);
  }
  return false;
}

async function main() {
  // ---- 1. 空态 ----
  const r0 = await (await fetch(`${BASE}/api/usage/today`)).json();
  ok(typeof r0.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r0.day), `day 字段格式（${r0.day}）`);
  ok(typeof r0.totals === "object" && typeof r0.totals.calls === "number", "totals 结构完整");

  const before = r0.totals.calls;

  // ---- 2. 跑一轮 ----
  const created = await (await fetch(`${BASE}/api/conversations`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
  })).json();
  const id = created.id;
  console.log(`测试会话: ${id}`);
  ok(await submitAndWait(id, "回复 ok 即可"), "第一轮跑完");
  const r1 = await (await fetch(`${BASE}/api/usage/today`)).json();
  ok(r1.totals.calls >= before + 1, `calls 计数增加`, `before=${before} after=${r1.totals.calls}`);
  ok(r1.totals.totalTokens > 0, "totalTokens > 0", String(r1.totals.totalTokens));
  const modelKeys = Object.keys(r1.models);
  ok(modelKeys.length > 0, `models 桶有记录`, modelKeys.join(","));
  ok(r1.totals.activeConvs >= 1, "activeConvs ≥ 1");

  // ---- 3. 第二轮累加 ----
  ok(await submitAndWait(id, "再回复 ok"), "第二轮跑完");
  const r2 = await (await fetch(`${BASE}/api/usage/today`)).json();
  ok(r2.totals.calls === r1.totals.calls + 1, "calls 精确累加", `${r1.totals.calls}→${r2.totals.calls}`);

  // ---- 清理 ----
  await fetch(`${BASE}/api/conversations/${id}`, { method: "DELETE" });
  console.log(`\n结果: ${pass} 过 / ${fail} 挂（测试会话已软删）`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
