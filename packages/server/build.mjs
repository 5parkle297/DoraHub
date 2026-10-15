/**
 * server 构建脚本：tsc 编译到 dist/server（保留 package.json 相对布局）。
 * systemd 的 ExecStart 指向 dist/server/index.js。
 */
import { build } from "esbuild";
import { mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const result = await build({
  entryPoints: [join(root, "packages/server/src/index.ts")],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: join(root, "packages/server/dist/index.js"),
  external: [
    "@earendil-works/pi-durable",
    "@earendil-works/pi-ai",
    "@earendil-works/chord",
    "@earendil-works/pi-env",
    "ws",
    "better-sqlite3",
    "node:*",
  ],
  sourcemap: true,
  packages: "external",
});

// guard-rules.json 随 dist 走
try {
  copyFileSync(join(root, "guard-rules.json"), join(root, "packages/server/dist/guard-rules.json"));
} catch {}

if (result.errors.length > 0) {
  process.exit(1);
}
console.log("server built -> packages/server/dist/index.js");
