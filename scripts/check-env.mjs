#!/usr/bin/env node
/**
 * tple-skill — 运行前环境依赖检查
 *
 * Usage:
 *   node check-env.mjs [--url http://localhost:3000]
 *
 * 检查项：
 *   1. Node.js ≥ 18（run-cases.mjs / build-report.mjs）
 *   2. agent-browser（浏览器操作与 record 录屏）
 *   3. ffmpeg（转码 / 分镜 concat / poster 提取）
 *   4. ffprobe（录后时长校验）
 *   5. ccusage（session token 用量采集；全局或本机已缓存 npx，探测不联网安装）
 *   6. --url 给了目标地址时，探测 web 可达性
 *   · token-meter（软探测，不阻断）：ccusage → 本地账本 → 不支持则提示
 *
 * 可选 --mode research：调研模式。目标为公网 URL，无需本地 dev server；
 *   401/403 视为「可达但受限」（需登录/反爬，如实报告），不当环境故障。
 *
 * 全部通过退出码 0；缺依赖退出码 1（打印安装指引）。
 */
import { spawnSync } from "node:child_process";
import {
  probeCcusageInstall,
  probeTokenMeterLine,
} from "./lib/token-usage.mjs";

const ok = [];
const bad = [];
const soft = [];

function probe(bin, args = ["--version"], hint = "") {
  const r = spawnSync(bin, args, { encoding: "utf8", timeout: 15000 });
  if (r.error || r.status === null || r.status !== 0) {
    bad.push({ bin, hint });
    return null;
  }
  const out = String(r.stdout || "").trim().split("\n")[0];
  ok.push({ bin, info: out.slice(0, 80) });
  return out;
}

// 1. Node ≥ 18
const major = Number(process.versions.node.split(".")[0]);
if (major >= 18) {
  ok.push({ bin: "node", info: `v${process.versions.node}` });
} else {
  bad.push({ bin: "node", hint: `需要 Node 18+，当前 v${process.versions.node}` });
}

// 2. agent-browser
probe("agent-browser", ["--version"], "npm i -g agent-browser && agent-browser install");

// 3+4. ffmpeg / ffprobe
probe("ffmpeg", ["-version"], "brew install ffmpeg / winget install Gyan.FFmpeg / choco install ffmpeg（按系统包管理器）");
probe("ffprobe", ["-version"], "随 ffmpeg 一起安装");

// 5. ccusage（硬依赖：全局或 npx --no-install；安装走 install-deps）
const ccProbe = probeCcusageInstall();
if (ccProbe.ok) {
  ok.push({ bin: "ccusage", info: ccProbe.info });
} else {
  bad.push({ bin: "ccusage", hint: ccProbe.hint });
}

// 6. 可选：目标 web 可达性（用 curl，macOS/Linux 自带）
const urlIdx = process.argv.indexOf("--url");
const targetUrl = urlIdx >= 0 ? process.argv[urlIdx + 1] : "";
const modeIdx = process.argv.indexOf("--mode");
const modeRaw = modeIdx >= 0 ? process.argv[modeIdx + 1] : "acceptance";
const VALID_MODES = new Set(["acceptance", "research"]);
if (!VALID_MODES.has(modeRaw)) {
  bad.push({ bin: "mode", hint: `--mode 取值非法：「${modeRaw ?? "(缺值)"}」（应为 acceptance 或 research）；mode 会改变 401/403 的判定语义，不能带错跑` });
}
const mode = VALID_MODES.has(modeRaw) ? modeRaw : "acceptance";
const isResearch = mode === "research";
if (targetUrl) {
  const r = spawnSync("curl", ["-s", "-o", "/dev/null", "-m", "5", "-w", "%{http_code}", targetUrl], {
    encoding: "utf8",
    timeout: 15000,
  });
  const code = Number(String(r.stdout || "").trim());
  if (!r.error && code >= 200 && code < 500) {
    if (isResearch && (code === 401 || code === 403)) {
      // 调研模式：401/403 是正常信号（需登录/反爬），可达但受限，不当故障
      ok.push({ bin: "target", info: `${targetUrl} → HTTP ${code}（可达但受限：需登录或被反爬拦截，如实记入调研，勿当环境故障）` });
    } else {
      ok.push({ bin: "target", info: `${targetUrl} → HTTP ${code}` });
    }
  } else {
    const hint = isResearch
      ? `${targetUrl} 不可达（curl 返回 ${code || r.error?.code || "error"}）；确认 URL 是否正确、站点是否在线，如实报告，勿重试轰炸`
      : `${targetUrl} 不可达（curl 返回 ${code || r.error?.code || "error"}）；先起 dev server 或用 WEB_URL 指到正确地址`;
    bad.push({ bin: "target", hint });
  }
}

// · token-meter 软探测（ccusage 已装时）：不阻断主流程
if (ccProbe.ok) {
  const meter = probeTokenMeterLine();
  soft.push({ bin: "token-meter", info: meter.info });
}

// 输出
const pad = (s, n) => s + " ".repeat(Math.max(1, n - s.length));
for (const item of ok) console.log(`  ✓ ${pad(item.bin, 14)} ${item.info}`);
for (const item of soft) console.log(`  · ${pad(item.bin, 14)} ${item.info}`);
for (const item of bad) console.log(`  ✗ ${pad(item.bin, 14)} 缺失/不可用 — ${item.hint}`);

if (bad.length > 0) {
  console.log(`\n环境不满足：${bad.length} 项缺失。修好再跑 TPLE。`);
  process.exit(1);
}
console.log("\n环境依赖齐全，可以开始 TPLE。");
