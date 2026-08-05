#!/usr/bin/env node
/**
 * tple-skill — 用规范模板生成 index.html
 *
 * Usage:
 *   node build-report.mjs --dir <report-dir> \
 *     --brand "Issue #27 E2E" \
 *     --title "Issue #27 端到端录屏验收" \
 *     --lede "覆盖本切片 …" \
 *     --env "环境 web :3003 / api :8788 · 账号 demo" \
 *     [--cases cases.json]
 *
 * 读取 <dir>/meta.jsonl
 * 可选 <dir>/cases.json 或 --cases：{ "01-login": { uc, steps, expected } }
 * 可选 <dir>/runs.json：{ "01-login": { lastRanAt, runCount } }
 * CSS/HTML 模板来自本 skill 的 assets/ + templates/（禁止另起视觉稿）
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(__dirname, "..");

function arg(name, fallback = "") {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fill(tpl, map) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) =>
    map[k] !== undefined ? String(map[k]) : "",
  );
}

/** 展示用本地时间：2026-08-02 21:04 */
function formatRanAt(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

/** mp4 时长（秒）；ffprobe 不可用/失败返回 null */
function mediaDuration(file) {
  const r = spawnSync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=nw=1:nk=1",
    file,
  ], { encoding: "utf8" });
  if (r.error || r.status !== 0) return null;
  const n = Number(String(r.stdout).trim());
  return Number.isFinite(n) ? n : null;
}

/** 缺 videos/<id>.png 时从 mp4 末帧提取（报告 poster / 结束帧依赖它） */
function ensurePoster(dir, id) {
  const videosDir = path.join(dir, "videos");
  const png = path.join(videosDir, `${id}.png`);
  if (fs.existsSync(png)) return png;
  const mp4 = path.join(videosDir, `${id}.mp4`);
  const webm = path.join(videosDir, `${id}.webm`);
  const src = fs.existsSync(mp4) ? mp4 : fs.existsSync(webm) ? webm : null;
  if (!src) return null;
  const r = spawnSync("ffmpeg", [
    "-y", "-sseof", "-0.1", "-i", src,
    "-frames:v", "1", "-update", "1", png,
  ], { stdio: "ignore" });
  return r.status === 0 && fs.existsSync(png) ? png : null;
}

/**
 * 报告媒体完整性校验（生成后运行）。
 * 规则：
 *  - 每个 case 至少要有 mp4 或 png（模板 video/img 引用它们）
 *  - poster（videos/<id>.png）缺失时自动从末帧补
 *  - mp4 时长 < minDuration 给 warning（不阻断：分镜回退本来就短）
 *  - 缺媒体 → error，退出码 1（报告不允许指向不存在的文件）
 */
function validateMedia(dir, ids, minDuration) {
  const errors = [];
  const warnings = [];
  for (const id of ids) {
    const mp4 = path.join(dir, "videos", `${id}.mp4`);
    const png = path.join(dir, "videos", `${id}.png`);
    if (!fs.existsSync(mp4) && !fs.existsSync(png)) {
      errors.push(`videos/${id}.mp4 与 videos/${id}.png 都不存在 → 报告会出现黑块/裂图`);
      continue;
    }
    if (!ensurePoster(dir, id)) {
      warnings.push(`videos/${id}.png 缺失且无法从末帧提取（poster/结束帧将裂图）`);
    }
    if (fs.existsSync(mp4)) {
      const d = mediaDuration(mp4);
      if (d === null) warnings.push(`无法用 ffprobe 读取 videos/${id}.mp4 时长`);
      else if (d < minDuration) warnings.push(`videos/${id}.mp4 时长 ${d.toFixed(1)}s < ${minDuration}s（确认是分镜回退；原生录屏应 ≥${minDuration}s）`);
    }
  }
  for (const w of warnings) console.warn(`[media] warn: ${w}`);
  for (const e of errors) console.error(`[media] ERROR: ${e}`);
  if (errors.length > 0) process.exit(1);
}

function hasFixInfo(row) {
  if (row.bug || row.fix) return true;
  return Array.isArray(row.fixLog) && row.fixLog.length > 0;
}

/**
 * 有修复时展示：Bug 点 + 修复方案（+ 可选分轮次）
 * 兼容旧字段 change；新字段优先 bug / fix
 */
function renderFixBlock(row) {
  if (!hasFixInfo(row)) return "";

  const fixLog = Array.isArray(row.fixLog) ? row.fixLog : [];
  const summaryBug =
    row.bug ||
    fixLog
      .map((f) => f.bug)
      .filter(Boolean)
      .join("；") ||
    "";
  const summaryFix =
    row.fix ||
    fixLog
      .map((f) => f.fix || f.change)
      .filter(Boolean)
      .join("；") ||
    "";

  const roundsHtml =
    fixLog.length > 0
      ? `<ol class="fix-rounds">${fixLog
          .map((f) => {
            const bug = f.bug || "";
            const fix = f.fix || f.change || "";
            const files = (f.files || [])
              .map((fp) => `<code>${esc(fp)}</code>`)
              .join(", ");
            return `<li>
              <span class="fix-round">Round ${esc(f.round ?? "?")}</span>
              ${bug ? `<div class="fix-kv"><span class="fix-k">Bug</span><span>${esc(bug)}</span></div>` : ""}
              ${fix ? `<div class="fix-kv"><span class="fix-k">修复</span><span>${esc(fix)}</span></div>` : ""}
              ${files ? `<div class="fix-files">${files}</div>` : ""}
            </li>`;
          })
          .join("\n")}</ol>`
      : "";

  return `<div class="fix-log">
      <h3>修复说明</h3>
      <div class="fix-pair">
        <div class="fix-item bug">
          <span class="fix-label">Bug 点</span>
          <p>${esc(summaryBug || "（未填写，见下方轮次）")}</p>
        </div>
        <div class="fix-item fix">
          <span class="fix-label">修复方案</span>
          <p>${esc(summaryFix || "（未填写，见下方轮次）")}</p>
        </div>
      </div>
      ${roundsHtml ? `<h3 class="fix-rounds-title">修复轮次</h3>${roundsHtml}` : ""}
    </div>`;
}

const dir = path.resolve(arg("--dir", "."));
const brand = arg("--brand", "TPLE E2E");
const brandSpan = arg("--brand-span", "按 case 录屏验收");
const title = arg("--title", brand);
const h1 = arg("--h1", title);
const lede = arg("--lede", "端到端录屏验收报告。");
const envExtra = arg("--env", "");
const recordingNote = arg(
  "--recording",
  "录屏方式：默认 agent-browser 原生 record（开跑前/每 case 前清理残留进程）；ffprobe < 4s 时回退分镜截图。",
);
const casesPath = arg("--cases", path.join(dir, "cases.json"));

const css = fs.readFileSync(path.join(SKILL_ROOT, "assets/report.css"), "utf8");
const shellTpl = fs.readFileSync(
  path.join(SKILL_ROOT, "templates/report.html"),
  "utf8",
);
const caseTpl = fs.readFileSync(
  path.join(SKILL_ROOT, "templates/case-section.html"),
  "utf8",
);

const metaPath = path.join(dir, "meta.jsonl");
if (!fs.existsSync(metaPath)) {
  console.error("missing meta.jsonl in", dir);
  process.exit(1);
}

let caseMeta = {};
if (fs.existsSync(casesPath)) {
  caseMeta = JSON.parse(fs.readFileSync(casesPath, "utf8"));
}

const runsPath = path.join(dir, "runs.json");
let runStats = {};
if (fs.existsSync(runsPath)) {
  try {
    runStats = JSON.parse(fs.readFileSync(runsPath, "utf8"));
  } catch {
    runStats = {};
  }
}

const VALID_STATUS = new Set(["PASS", "FAIL", "BLOCKED"]);
const rawLines = fs
  .readFileSync(metaPath, "utf8")
  .trim()
  .split("\n")
  .filter(Boolean);
const skipped = rawLines.filter((l) => {
  const [, , status] = l.split("|");
  return !(l.match(/^\S+\|/) && VALID_STATUS.has(status));
});
for (const l of skipped) {
  console.warn(`[meta] 跳过无法解析的行: ${l.slice(0, 80)}`);
}

const rows = rawLines
  .filter((l) => {
    const [, , status] = l.split("|");
    return l.match(/^\S+\|/) && VALID_STATUS.has(status);
  })
  .map((line) => {
    const [id, titleRow, status, notes, lastRanAtField, runCountField] =
      line.split("|");
    const fromRuns = runStats[id] || {};
    const lastRanAt = fromRuns.lastRanAt || lastRanAtField || "";
    const runCount = Number(
      fromRuns.runCount ?? runCountField ?? (lastRanAt ? 1 : 0),
    );
    return {
      id,
      title: titleRow,
      status,
      notes,
      ...(caseMeta[id] || {}),
      lastRanAt,
      runCount:
        Number.isFinite(runCount) && runCount > 0 ? runCount : lastRanAt ? 1 : 0,
    };
  });

const pass = rows.filter((r) => r.status === "PASS").length;
const fail = rows.filter((r) => r.status === "FAIL").length;
const blocked = rows.filter((r) => r.status === "BLOCKED").length;
const now = new Date().toISOString();

// auto-fix summary: how many cases were fixed, max rounds used
const fixedCases = rows.filter((r) => hasFixInfo(r));
const maxRound = fixedCases.reduce((m, r) => {
  const rounds = Array.isArray(r.fixLog)
    ? r.fixLog.map((f) => Number(f.round) || 0)
    : [0];
  return Math.max(m, ...rounds, 0);
}, 0);
const stillFail = rows.filter(
  (r) => r.status === "FAIL" && hasFixInfo(r),
).length;

const nav = rows
  .map(
    (r) =>
      `<a href="#${esc(r.id)}" class="nav-item ${r.status.toLowerCase()}"><span class="dot"></span>${esc(r.id)} · ${esc(r.title)}</a>`,
  )
  .join("\n");

const sections = rows
  .map((r) => {
    const failPng = path.join(dir, "videos", `${r.id}-fail.png`);
    const failShot = fs.existsSync(failPng)
      ? `<figure><button type="button" class="shot-zoom" data-full="videos/${esc(r.id)}-fail.png" data-caption="失败中间态 · ${esc(r.id)}" aria-label="放大失败中间态"><img src="videos/${esc(r.id)}-fail.png" alt="${esc(r.id)} fail" /></button><figcaption>失败中间态 · 点击放大</figcaption></figure>`
      : "";
    const fixHtml = renderFixBlock(r);
    return fill(caseTpl, {
      ID: esc(r.id),
      UC: esc(r.uc || "—"),
      TITLE: esc(r.title),
      STATUS: esc(r.status),
      STATUS_LC: esc(String(r.status || "").toLowerCase()),
      STEPS: esc(r.steps || "—"),
      EXPECTED: esc(r.expected || "—"),
      NOTES: esc(r.notes),
      LAST_RAN: esc(formatRanAt(r.lastRanAt)),
      RUN_COUNT: esc(String(r.runCount || 0)),
      FAIL_SHOT: failShot,
      FIX_LOG: fixHtml,
    });
  })
  .join("\n");

// build fix summary HTML (only render if fixes happened)
let fixSummaryHtml = "";
if (fixedCases.length > 0) {
  const partial = stillFail > 0;
  const cls = partial ? "fix-summary partial" : "fix-summary";
  const msg = partial
    ? `修复 ${fixedCases.length - stillFail}/${fixedCases.length} 个 FAIL（${maxRound} 轮），${stillFail} 个仍未修复`
    : `自动修复 ${fixedCases.length} 个 FAIL（${maxRound} 轮）`;
  fixSummaryHtml = `<div class="${cls}">${msg}</div>`;
}

const html = fill(shellTpl, {
  TITLE: esc(title),
  CSS: css,
  BRAND_STRONG: esc(brand),
  BRAND_SPAN: esc(brandSpan),
  NAV: nav,
  H1: esc(h1),
  LEDE: esc(lede),
  META_ENV: esc(
    `生成时间 ${now}${envExtra ? ` · ${envExtra}` : ""}`,
  ),
  META_RECORDING: esc(recordingNote),
  PASS: String(pass),
  FAIL: String(fail),
  BLOCKED: String(blocked),
  TOTAL: String(rows.length),
  FIX_SUMMARY: fixSummaryHtml,
  SECTIONS: sections,
});

const outPath = path.join(dir, "index.html");
fs.writeFileSync(outPath, html);
console.log("wrote", outPath);

// 生成后校验媒体引用（缺 poster 自动补；缺 mp4/png 直接报错退出码 1）
validateMedia(dir, rows.map((r) => r.id), 4);
