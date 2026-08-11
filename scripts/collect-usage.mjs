#!/usr/bin/env node
/**
 * tple-skill — 采集本次会话 token 用量写入 runs.json.usage
 *
 * Usage:
 *   node collect-usage.mjs --dir <report-dir> [--agent claude|opencode|codex|cursor|auto] [--cwd <path>]
 *   node collect-usage.mjs --probe [--agent …] [--cwd …]
 *
 * 降级：ccusage → 本地账本（Claude transcript / OpenCode message）→ unsupported
 * 禁止估算。unsupported 时仍写入 usage（source=unsupported），报告头显示提示文案。
 */
import fs from "node:fs";
import path from "node:path";
import {
  collectTokenUsage,
  probeCcusageInstall,
  probeTokenMeterLine,
  UNSUPPORTED_SOURCE,
} from "./lib/token-usage.mjs";

function arg(name, fallback = "") {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const cwdOpt = arg("--cwd", process.cwd());
const agentOpt = arg("--agent", "auto");
const agentArg = agentOpt === "auto" ? undefined : agentOpt;

if (process.argv.includes("--probe")) {
  const cc = probeCcusageInstall();
  if (!cc.ok) {
    console.log(`ccusage: missing (${cc.hint})`);
    process.exit(1);
  }
  console.log(`ccusage: ${cc.info}`);
  const meter = probeTokenMeterLine();
  // probeTokenMeterLine 跟当前环境；有 --agent/--cwd 时再打一次精确结果
  const exact = collectTokenUsage({ cwd: cwdOpt, agent: agentArg });
  console.log(`token-meter: ${meter.info}`);
  console.log(
    `token-meter(exact): agent=${exact.agent} via=${exact.path} source=${exact.usage.source}` +
      (exact.usage.total != null ? ` total=${exact.usage.total}` : ""),
  );
  process.exit(0);
}

const dir = path.resolve(arg("--dir", ""));
if (!dir || !fs.existsSync(dir)) {
  console.error(
    "用法: node collect-usage.mjs --dir <report-dir> [--agent …] [--cwd …]",
  );
  process.exit(1);
}

const runsPath = path.join(dir, "runs.json");
let runs = {};
if (fs.existsSync(runsPath)) {
  try {
    runs = JSON.parse(fs.readFileSync(runsPath, "utf8"));
  } catch {
    runs = {};
  }
}

const { usage, path: how, agent } = collectTokenUsage({
  cwd: cwdOpt,
  agent: agentArg,
});
runs.usage = usage;
fs.writeFileSync(runsPath, JSON.stringify(runs, null, 2) + "\n");

if (usage.source === UNSUPPORTED_SOURCE) {
  console.log(`usage: unsupported (agent=${agent}) → ${usage.message}`);
  console.log("wrote", runsPath);
  process.exit(0);
}

console.log(
  `usage: via ${how} (agent=${agent}) total=${usage.total} source=${usage.source}`,
);
console.log("wrote", runsPath);
