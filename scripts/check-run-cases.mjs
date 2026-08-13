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

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const executableSource = stripComments(src);
const isLegacyBackend =
  /^\s*(?:export\s+)?const\s+TPLE_BROWSER_BACKEND\s*=\s*["']agent-browser-legacy["']\s*;?\s*$/m.test(
    executableSource,
  );

const hasCreateBrowser =
  /\bcreateBrowser\b/.test(executableSource) &&
  (/tple-browser\.mjs/.test(executableSource) ||
    /from\s+['"].*tple-browser/.test(executableSource));

if (isLegacyBackend) {
  if (!hasCreateBrowser) {
    errors.push(
      "legacy 后端必须 import createBrowser（来自 scripts/lib/tple-browser.mjs）",
    );
  }
} else {
  const hasCreatePlaywrightCase =
    /\bcreatePlaywrightCase\b/.test(executableSource) &&
    (/tple-playwright\.mjs/.test(executableSource) ||
      /from\s+['"].*tple-playwright/.test(executableSource));
  if (!hasCreatePlaywrightCase) {
    errors.push(
      "默认后端必须 import createPlaywrightCase（来自 scripts/lib/tple-playwright.mjs）；旧 createBrowser 需显式声明 agent-browser-legacy",
    );
  }
  if (
    /\bchromium\s*\.\s*(?:launch|launchPersistentContext)\s*\(/.test(
      executableSource,
    )
  ) {
    errors.push(
      "禁止自行 chromium.launch/launchPersistentContext；请用 createPlaywrightCase 管理录屏与清理",
    );
  }
  if (
    /authing_token|auth_status|document\s*\.\s*cookie|localStorage\s*\.\s*(?:getItem|setItem)/i.test(
      executableSource,
    ) ||
    /\.tple-auth-state\.json|authStatePath\s*\(|\.\s*(?:cookies|storageState)\s*\(|\[\s*["'](?:cookies|storageState)["']\s*\]\s*\(/i.test(
      executableSource,
    )
  ) {
    errors.push(
      "默认 Playwright runner 禁止读取认证值；登录态只通过 storageState 注入且不得写入报告产物",
    );
  }
}

const bareSpawn = [
  /spawnSync\s*\(\s*['"]agent-browser['"]/,
  /spawn\s*\(\s*['"]agent-browser['"]/,
  /execSync\s*\(\s*['"]agent-browser/,
  /execFileSync\s*\(\s*['"]agent-browser['"]/,
  /exec\s*\(\s*['"]agent-browser/,
];
for (const re of bareSpawn) {
  if (re.test(executableSource)) {
    const hint = isLegacyBackend
      ? "请用 createBrowser().run"
      : "默认请用 createPlaywrightCase，不要裸调 agent-browser";
    errors.push(`禁止裸调用 agent-browser（匹配 ${re}）；${hint}`);
    break;
  }
}

if (
  /function\s+purge\s*\(/.test(executableSource) &&
  /close\s+--all|close",\s*"--all"|close',\s*'--all'/.test(executableSource)
) {
  errors.push(
    "禁止本地 purge + close --all；套件清理只许编排 tple-browser suite-boot / suite-teardown",
  );
}

if (
  /pkill\s+.*agent-browser|pkill.*user-data-dir=\.\*\/agent-browser/.test(
    executableSource,
  )
) {
  errors.push(
    "禁止在 run-cases 内 pkill agent-browser Chrome；套件清理交给 suite-boot/teardown",
  );
}

const hasRecordStop = /["']record["']\s*,\s*["']stop["']/.test(executableSource);
const hasStopRecordingHelper = /function\s+stopRecording\s*\(/.test(
  executableSource,
);
if (isLegacyBackend && hasRecordStop && !hasStopRecordingHelper) {
  errors.push(
    "录制脚本必须定义 stopRecording()：仅 No recording in progress 可忽略，其他 record stop 错误必须失败",
  );
}

if (errors.length) {
  console.error(`check-run-cases: FAIL ${file}`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`check-run-cases: OK ${file}`);
process.exit(0);
