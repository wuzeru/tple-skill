#!/usr/bin/env node
/**
 * tple-skill — 版本自检与更新（零 npm 依赖，离线/限流静默降级）
 *
 * Usage:
 *   node check-update.mjs              # 自检：本地版本 vs GitHub 最新 release，落后时提示
 *   node check-update.mjs --json       # 机器可读输出（供 SKILL.md 流程解析）
 *   node check-update.mjs --force      # 绕过 24h 缓存强制联网复查
 *   node check-update.mjs --apply      # 执行更新（须先经用户确认，见 SKILL.md 门闩）：
 *                                      #   git 安装（有 .git）→ 脏检查（拒绝强拉）+ git pull --ff-only
 *                                      #   zip 安装（无 .git）→ 下载最新 release zip 覆盖（根级布局）
 *                                      #   更新后重跑 check-env.mjs 复检依赖
 *
 * 设计硬约束（issue #13）：
 *   - 不阻塞主流程：自检（不带 --apply）永远退出码 0；拿不到最新版本时静默降级
 *   - 24h 内不重复联网（缓存在 skill 目录 .tple-update-cache.json，--force 绕过）
 *   - 不静默更新：--apply 由调用方显式传入，SKILL.md 约定先提示用户、确认后才执行
 *   - git 安装：有未提交改动或无法 fast-forward 时拒绝拉取，只警告
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_DIR = dirname(dirname(fileURLToPath(import.meta.url))); // scripts/ → skill 根
const VERSION_FILE = join(SKILL_DIR, "VERSION");
const CACHE_FILE = join(SKILL_DIR, ".tple-update-cache.json");
const REPO = "wuzeru/tple-skill";
const API_LATEST = `https://api.github.com/repos/${REPO}/releases/latest`;
const ZIP_URL = `https://github.com/${REPO}/releases/latest/download/tple-skill.zip`;
const TTL_MS = 24 * 60 * 60 * 1000; // 24h 缓存

const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));
const asJson = flags.has("--json");
const force = flags.has("--force");
const apply = flags.has("--apply");
const IS_WIN = process.platform === "win32";

const run = (bin, args, opts = {}) =>
  spawnSync(bin, args, { encoding: "utf8", timeout: opts.timeout ?? 30000, ...opts });
const curlJson = (url) => {
  const r = run("curl", ["-sS", "-m", "10", "-H", "User-Agent: tple-skill-check-update", url]);
  if (r.error || r.status !== 0) return null;
  try {
    const j = JSON.parse(r.stdout);
    return j && !j.message ? j : null; // message 字段 = 报错（限流/404），不当有效数据
  } catch {
    return null;
  }
};

// ---- 版本解析 ----------------------------------------------------------
const TAG_RE = /^v(\d+)\.(\d+)\.(\d+)$/;
const parseTag = (t) => {
  const m = TAG_RE.exec(String(t || "").trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};
const cmpTag = (a, b) => {
  const [pa, pb] = [parseTag(a), parseTag(b)];
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
};
const git = (...args) => run("git", ["-C", SKILL_DIR, ...args]);

function localVersion() {
  const isGit = existsSync(join(SKILL_DIR, ".git"));
  if (isGit) {
    const tag = git("describe", "--tags", "--abbrev=0").stdout?.trim() || "";
    const desc = git("describe", "--tags", "--dirty").stdout?.trim() || "";
    if (tag) return { tag, source: "git describe", describe: desc, isGit };
  }
  if (existsSync(VERSION_FILE)) {
    // VERSION 格式：<tag> <commit> <ISO 时间戳>（release 流水线写入）
    const first = readFileSync(VERSION_FILE, "utf8").trim().split(/\s+/)[0];
    if (parseTag(first)) return { tag: first, source: "VERSION 文件", describe: "", isGit };
  }
  return { tag: "", source: "", describe: "", isGit };
}

// ---- 最新版本（API 优先，ls-remote 兜底，全败则降级） ------------------
function fetchLatest() {
  const rel = curlJson(API_LATEST);
  if (rel?.tag_name && parseTag(rel.tag_name)) {
    return { tag: rel.tag_name, source: "GitHub API", url: rel.html_url || "" };
  }
  // 兜底：git ls-remote（不需要本地是 git 仓库，有 git 二进制即可）
  const r = run("git", ["ls-remote", "--tags", `https://github.com/${REPO}.git`, "refs/tags/v*"], { timeout: 15000 });
  if (!r.error && r.status === 0) {
    const tags = r.stdout
      .split("\n")
      .map((l) => l.split("\t")[1] || "")
      .filter((ref) => ref && !ref.includes("^{}"))
      .map((ref) => ref.replace("refs/tags/", ""))
      .filter((t) => parseTag(t))
      .sort(cmpTag);
    if (tags.length) return { tag: tags[tags.length - 1], source: "git ls-remote", url: "" };
  }
  return null; // 离线 / 限流 / 无 git：静默降级
}

function readCache() {
  try {
    const c = JSON.parse(readFileSync(CACHE_FILE, "utf8"));
    if (parseTag(c.latest) && Date.now() - Number(c.checkedAt || 0) < TTL_MS) return c;
  } catch {}
  return null;
}
const writeCache = (latest, source) => {
  try {
    writeFileSync(CACHE_FILE, JSON.stringify({ checkedAt: Date.now(), latest, source }, null, 2));
  } catch {} // 缓存写失败不影响主流程
};

// ---- 落后摘要：compare API 拉 current..latest 的提交主题 ----------------
function behindSummary(current, latest) {
  if (!parseTag(current)) return [];
  const j = curlJson(`https://api.github.com/repos/${REPO}/compare/${current}...${latest}`);
  if (!j?.commits?.length) return [];
  return j.commits.slice(-10).map((c) => (c.commit?.message || "").split("\n")[0]).filter(Boolean);
}

// ---- 更新执行（--apply） ------------------------------------------------
function recheckEnv() {
  console.log("\n更新完成，复检运行依赖（新版可能引入新依赖）：");
  const envScript = join(SKILL_DIR, "scripts/check-env.mjs");
  if (!existsSync(envScript)) {
    console.log(`✗ 未找到 ${envScript}（更新产物异常），请手动检查安装目录`);
    process.exit(1);
  }
  const r = spawnSync(process.execPath, [envScript], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}

function applyGit() {
  // 必须在分支上（detached HEAD / checkout 到 tag 的状态无法 git pull）
  const branch = git("symbolic-ref", "--short", "-q", "HEAD").stdout?.trim();
  if (!branch) {
    console.log("✗ 当前处于 detached HEAD（如 checkout 到了某个 tag），无法 git pull。");
    console.log("  请先切回主分支（如 git checkout main）后重试，或改用 zip 覆盖安装到新目录。");
    process.exit(1);
  }
  const st = git("status", "--porcelain");
  // 排除脚本自身的产物（缓存文件），否则「自检写了缓存 → --apply 被自己的缓存拦住」
  const dirty = (st.stdout || "")
    .split("\n")
    .filter((l) => l.trim() && !l.includes(".tple-update-cache.json"))
    .join("\n");
  if (dirty) {
    console.log("✗ skill 目录有未提交的本地改动，拒绝强拉（避免覆盖你的修改）：");
    console.log(dirty.split("\n").slice(0, 10).map((l) => `    ${l}`).join("\n"));
    console.log("  请先自行处理（commit / stash）后重试，或改用 zip 覆盖安装到新目录。");
    process.exit(1);
  }
  const pull = git("pull", "--ff-only");
  if (pull.status !== 0) {
    console.log(`✗ git pull --ff-only 失败（离线、分支「${branch}」无上游，或本地提交导致无法 fast-forward）：`);
    console.log((pull.stderr || pull.stdout || "").trim().split("\n").slice(0, 8).map((l) => `    ${l}`).join("\n"));
    process.exit(1);
  }
  console.log("✓ git pull --ff-only 成功");
  const after = localVersion();
  console.log(`  当前版本：${after.describe || after.tag || "unknown"}`);
  writeCache(after.tag, "apply-git");
  recheckEnv();
}

function applyZip() {
  const has = (bin) => {
    const r = run(IS_WIN ? "where" : "which", [bin], IS_WIN ? { shell: true } : {});
    return !r.error && r.status === 0;
  };
  if (!has("unzip")) {
    console.log(`✗ 未找到 unzip，无法自动覆盖安装。`);
    console.log(`  手动更新：下载 ${ZIP_URL}（或有 license key 走 landingpage /download?license=），解压覆盖到 ${SKILL_DIR}（保持根级布局，zip 内本就不含 CLAUDE.md）。`);
    process.exit(1);
  }
  const tmp = join(tmpdir(), `tple-skill-up-${process.pid}`);
  mkdirSync(tmp, { recursive: true });
  const zipPath = join(tmp, "tple-skill.zip");
  try {
    console.log(`→ 下载最新 zip：${ZIP_URL}`);
    const dl = run("curl", ["-fsSL", "-m", "120", "-o", zipPath, ZIP_URL], { timeout: 150000 });
    if (dl.error || dl.status !== 0) {
      console.log("✗ 下载失败（离线或网络受限）。稍后重试，或手动下载覆盖。");
      process.exit(1);
    }
    const test = run("unzip", ["-t", zipPath]); // 先验完整性，坏包不落盘
    if (test.status !== 0) {
      console.log("✗ 下载的 zip 校验失败，放弃覆盖。");
      process.exit(1);
    }
    const ex = run("unzip", ["-o", zipPath, "-d", SKILL_DIR], { timeout: 60000 });
    if (ex.status !== 0) {
      console.log("✗ 解压覆盖失败：");
      console.log((ex.stderr || "").trim().split("\n").slice(0, 8).map((l) => `    ${l}`).join("\n"));
      process.exit(1);
    }
    console.log(`✓ 已覆盖安装到 ${SKILL_DIR}（根级布局；本地新增文件不受影响，zip 不含 CLAUDE.md）`);
    const after = localVersion();
    console.log(`  当前版本：${after.tag || "unknown"}`);
    writeCache(after.tag, "apply-zip");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  recheckEnv();
}

// ---- 主流程 --------------------------------------------------------------
const local = localVersion();
const installType = local.isGit ? "git" : "zip";

if (apply) {
  console.log(`tple-skill 更新（安装方式：${installType === "git" ? "git clone" : "zip"}）`);
  if (installType === "git") applyGit();
  else applyZip();
}

// 自检
let latest = null;
let fromCache = false;
const cached = force ? null : readCache();
if (cached) {
  latest = { tag: cached.latest, source: `cache (${cached.source || "previous"})`, url: "" };
  fromCache = true;
} else {
  latest = fetchLatest();
  if (latest) writeCache(latest.tag, latest.source);
}

const result = {
  current: local.tag || null,
  currentSource: local.source || null,
  describe: local.describe || null,
  latest: latest?.tag ?? null,
  latestSource: latest?.source ?? null,
  behind: null,
  summary: [],
  installType,
  checked: !!latest,
  cached: fromCache,
  updateHint: null,
};
if (latest && parseTag(latest.tag)) {
  if (!local.tag) {
    result.behind = null; // 本地版本未知，无法比较，但建议更新
  } else {
    result.behind = cmpTag(latest.tag, local.tag) > 0;
    if (result.behind) result.summary = behindSummary(local.tag, latest.tag);
  }
  result.updateHint =
    installType === "git"
      ? `git -C ${SKILL_DIR} pull --ff-only（或 node ${join(SKILL_DIR, "scripts/check-update.mjs")} --apply，脏工作区会被拒绝）`
      : `重新下载 ${ZIP_URL}（或 landingpage /download?license=）解压覆盖 ${SKILL_DIR}；或 node ${join(SKILL_DIR, "scripts/check-update.mjs")} --apply`;
}

if (asJson) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log("tple-skill 版本自检");
  console.log(`  当前版本    ${local.tag ? `${local.tag}（来源：${local.source}${local.describe && local.describe !== local.tag ? `，${local.describe}` : ""}）` : "未知（无 VERSION 文件且 git describe 不可用）"}`);
  console.log(`  安装方式    ${installType === "git" ? "git clone（git pull 更新）" : "zip（下载覆盖更新）"}`);
  if (!latest) {
    console.log("  最新版本    无法获取（离线或 GitHub API 限流）——已跳过本次检查，不阻塞流程");
  } else {
    console.log(`  最新版本    ${latest.tag}（来源：${latest.source}${latest.url ? `，${latest.url}` : ""}）`);
    if (result.behind === null) {
      console.log("  状态        本地版本未知，建议更新到最新");
    } else if (result.behind) {
      console.log(`  状态        ⚠ 落后——有新版 ${latest.tag}（当前 ${local.tag}），建议更新`);
      for (const line of result.summary) console.log(`    · ${line}`);
      console.log(`  更新方式    ${result.updateHint}`);
      console.log("  注意        更新需用户确认后执行（--apply）；跳过不影响本次 TPLE 流程");
    } else {
      console.log("  状态        ✓ 已是最新");
    }
  }
}
process.exit(0); // 自检永不阻塞：落后/降级都是退出码 0
