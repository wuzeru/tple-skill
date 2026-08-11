#!/usr/bin/env node
/**
 * tple-skill — 静态检查 run-cases.mjs 是否走语义化浏览器 API
 *
 * Usage:
 *   node check-run-cases.mjs --file <path/to/run-cases.mjs>
 *   node check-run-cases.mjs --dir <report-dir>   # 检查 <dir>/run-cases.mjs
 *
 * 失败 exit 1：禁止派发 subagent。
 */
import fs from "node:fs";
import path from "node:path";

function arg(name, fallback = "") {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function usage() {
  console.error(
    "用法: node scripts/check-run-cases.mjs --file <run-cases.mjs> | --dir <report-dir>",
  );
  process.exit(1);
}

const fileOpt = arg("--file", "");
const dirOpt = arg("--dir", "");
let file = fileOpt;
if (!file && dirOpt) file = path.join(path.resolve(dirOpt), "run-cases.mjs");
if (!file) usage();
file = path.resolve(file);

if (!fs.existsSync(file)) {
  console.error(`check-run-cases: 文件不存在 ${file}`);
  process.exit(1);
}

const src = fs.readFileSync(file, "utf8");
const errors = [];

const hasCreateBrowser =
  /\bcreateBrowser\b/.test(src) &&
  (/tple-browser\.mjs/.test(src) || /from\s+['"].*tple-browser/.test(src));

if (!hasCreateBrowser) {
  errors.push(
    "必须 import createBrowser（来自 scripts/lib/tple-browser.mjs），禁止手写 agent-browser 封装",
  );
}

const bareSpawn = [
  /spawnSync\s*\(\s*['"]agent-browser['"]/,
  /spawn\s*\(\s*['"]agent-browser['"]/,
  /execSync\s*\(\s*['"]agent-browser/,
  /execFileSync\s*\(\s*['"]agent-browser['"]/,
  /exec\s*\(\s*['"]agent-browser/,
];
for (const re of bareSpawn) {
  if (re.test(src)) {
    errors.push(`禁止裸调用 agent-browser（匹配 ${re}）；请用 createBrowser().run`);
    break;
  }
}

if (/function\s+purge\s*\(/.test(src) && /close\s+--all|close",\s*"--all"|close',\s*'--all'/.test(src)) {
  errors.push(
    "禁止本地 purge + close --all；套件清理只许编排 tple-browser suite-boot / suite-teardown",
  );
}

if (/pkill\s+.*agent-browser|pkill.*user-data-dir=\.\*\/agent-browser/.test(src)) {
  errors.push(
    "禁止在 run-cases 内 pkill agent-browser Chrome；套件清理交给 suite-boot/teardown",
  );
}

if (errors.length) {
  console.error(`check-run-cases: FAIL ${file}`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`check-run-cases: OK ${file}`);
process.exit(0);
