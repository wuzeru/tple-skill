#!/usr/bin/env node
/**
 * tple-skill — 自动安装缺失依赖（check-env 报缺时调用）
 *
 * Usage:
 *   node install-deps.mjs [--dry-run]
 *
 * 逻辑：自行用 which（macOS/Linux）或 where（Windows）探测 agent-browser /
 * ffmpeg / ffprobe / ccusage 是否缺失（与 check-env 同一判定标准），对缺失项执行安装
 * 指引，装完复检。
 *   - agent-browser → npm i -g agent-browser && agent-browser install
 *   - ffmpeg/ffprobe → brew（macOS/Linux）/ winget 或 choco（Windows），
 *     一次安装补齐两者；无可用包管理器则提示手动安装
 *   - ccusage → npm i -g ccusage（session token 用量采集）
 * 不处理 target 可达性（那是 dev server 的事，由 check-env 负责报告）。
 * 退出码：复检全过 0；仍有缺失 1。
 */
import { spawnSync } from "node:child_process";
import { resolveCcusage } from "./lib/token-usage.mjs";

const dryRun = process.argv.includes("--dry-run");
const IS_WIN = process.platform === "win32";
const run = (bin, args, timeout = 300000) => {
  console.log(`  $ ${bin} ${args.join(" ")}`);
  if (dryRun) return { status: 0 };
  return spawnSync(bin, args, { stdio: "inherit", timeout });
};
const exists = (bin) => {
  // which 仅 macOS/Linux；Windows 用 where（命令名需带 .exe）
  const r = IS_WIN
    ? spawnSync("where", [bin], { encoding: "utf8", shell: true })
    : spawnSync("which", [bin], { encoding: "utf8" });
  return r.status === 0;
};

const missing = [];
if (!exists("agent-browser")) missing.push("agent-browser");
if (!exists("ffmpeg")) missing.push("ffmpeg");
if (!exists("ffprobe")) missing.push("ffprobe");
// ccusage：与 check-env 同一探测（全局 / 已缓存 npx；不含联网下载）
if (!resolveCcusage()) missing.push("ccusage");

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
// ffmpeg 与 ffprobe 随同一个包安装（macOS brew / Windows winget/choco），缺任一都触发
if (missing.includes("ffmpeg") || missing.includes("ffprobe")) {
  if (exists("brew")) {
    console.log("→ 安装 ffmpeg（brew，一次补齐 ffmpeg + ffprobe）");
    run("brew", ["install", "ffmpeg"], 600000);
  } else if (IS_WIN && exists("winget")) {
    console.log("→ 安装 ffmpeg（winget，一次补齐 ffmpeg + ffprobe）");
    run("winget", ["install", "--id", "Gyan.FFmpeg", "-e", "--accept-package-agreements", "--accept-source-agreements"], 600000);
  } else if (IS_WIN && exists("choco")) {
    console.log("→ 安装 ffmpeg（choco，一次补齐 ffmpeg + ffprobe）");
    run("choco", ["install", "ffmpeg", "-y"], 600000);
  } else {
    console.log(`✗ 未找到可用包管理器（brew${IS_WIN ? " / winget / choco" : ""}），无法自动安装 ffmpeg/ffprobe；请用系统包管理器手动安装`);
  }
}
if (missing.includes("ccusage")) {
  console.log("→ 安装 ccusage（npm 全局）");
  run("npm", ["i", "-g", "ccusage"]);
}

// 复检
console.log("\n复检：");
const still = [];
if (!exists("agent-browser")) still.push("agent-browser");
if (!exists("ffmpeg")) still.push("ffmpeg");
if (!exists("ffprobe")) still.push("ffprobe");
if (!resolveCcusage()) still.push("ccusage");
if (still.length > 0) {
  console.log(`仍缺失: ${still.join(", ")} — 自动安装未成功，请用户介入`);
  process.exit(1);
}
console.log("依赖已补齐。");
