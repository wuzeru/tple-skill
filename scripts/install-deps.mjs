#!/usr/bin/env node
/**
 * tple-skill — 自动安装缺失依赖（check-env 报缺时调用）
 *
 * Usage:
 *   node install-deps.mjs [--dry-run]
 *
 * 逻辑：读 check-env 的缺失清单 → 逐项执行安装指引 → 安装后复检。
 *   - agent-browser → npm i -g agent-browser && agent-browser install
 *   - ffmpeg/ffprobe → brew install ffmpeg（无 brew 则提示）
 *   - target 不可达 → 不是缺工具，跳过（提示用户起 dev server）
 * 退出码：复检全过 0；仍有缺失 1。
 */
import { spawnSync } from "node:child_process";

const dryRun = process.argv.includes("--dry-run");
const run = (bin, args, timeout = 300000) => {
  console.log(`  $ ${bin} ${args.join(" ")}`);
  if (dryRun) return { status: 0 };
  return spawnSync(bin, args, { stdio: "inherit", timeout });
};
const exists = (bin) => {
  const r = spawnSync("which", [bin], { encoding: "utf8" });
  return r.status === 0;
};

const missing = [];
if (!exists("agent-browser")) missing.push("agent-browser");
if (!exists("ffmpeg")) missing.push("ffmpeg");

if (missing.length === 0) {
  console.log("无缺失依赖，无需安装。");
  process.exit(0);
}
console.log(`缺失依赖: ${missing.join(", ")}`);

if (missing.includes("agent-browser")) {
  console.log("→ 安装 agent-browser（npm 全局）");
  let r = run("npm", ["i", "-g", "agent-browser"]);
  if (r.status === 0) run("agent-browser", ["install"]);
}
if (missing.includes("ffmpeg")) {
  if (exists("brew")) {
    console.log("→ 安装 ffmpeg（brew）");
    run("brew", ["install", "ffmpeg"], 600000);
  } else {
    console.log("✗ 未找到 brew，无法自动安装 ffmpeg；请用系统包管理器手动安装");
  }
}

// 复检
console.log("\n复检：");
const still = [];
if (!exists("agent-browser")) still.push("agent-browser");
if (!exists("ffmpeg")) still.push("ffmpeg");
if (still.length > 0) {
  console.log(`仍缺失: ${still.join(", ")} — 自动安装未成功，请用户介入`);
  process.exit(1);
}
console.log("依赖已补齐。");
