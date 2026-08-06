#!/usr/bin/env node
/**
 * 用 agent-browser 原生 record 重录 opencode web 执行界面（不再用 ffmpeg 屏幕录制）
 * 成功契约（0.26.0）：录前 open+wait 就位 → record start → 录内只 eval 滚动/截图（不 open）→ wait → record stop
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = __dirname;
const VID = path.join(OUT, "videos");
const META = path.join(OUT, "meta.jsonl");
const RUNS = path.join(OUT, "runs.json");
const MIN_NATIVE_SEC = 4;
const FRAME_HOLD_SEC = 1.6;

// 会话 URL 从环境变量读取，避免把本地路径/会话 ID 写死在脚本里
const URL_A = process.env.OPENCODE_URL_A || "";
const URL_B = process.env.OPENCODE_URL_B || "";
if (!URL_A || !URL_B) {
  console.error("缺少 OPENCODE_URL_A / OPENCODE_URL_B 环境变量（opencode web 会话页地址），请设置后重跑");
  process.exit(1);
}

fs.mkdirSync(VID, { recursive: true });

// ---------- logCase 标准实现 ----------
function logCase(id, title, status, notes) {
  const clean = String(notes || "").replace(/[\r\n]+/g, " ").replace(/\|/g, "/").slice(0, 300);
  fs.appendFileSync(META, `${id}|${title}|${status}|${clean}\n`);
  let runs = {};
  try { runs = JSON.parse(fs.readFileSync(RUNS, "utf8")); } catch { runs = {}; }
  const prev = runs[id] || { runCount: 0 };
  runs[id] = { lastRanAt: new Date().toISOString(), runCount: Number(prev.runCount || 0) + 1 };
  fs.writeFileSync(RUNS, JSON.stringify(runs, null, 2));
}

// ---------- agent-browser 封装 ----------
function ab(args, session, timeout = 60000) {
  const r = spawnSync("agent-browser", args, {
    encoding: "utf8", timeout,
    env: { ...process.env, AGENT_BROWSER_SESSION: session },
  });
  return { ok: r.status === 0, out: String(r.stdout || "").trim(), err: String(r.stderr || "").trim() };
}

function purge() {
  ab(["close", "--all"], "purge");
  spawnSync("pkill", ["-f", "agent-browser-darwin-arm64"]);
  spawnSync("pkill", ["-f", "user-data-dir=.*/agent-browser-chrome-"]);
  spawnSync("sleep", ["1.5"]);
}

function probeDuration(f) {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", f], { encoding: "utf8" });
  if (r.error || r.status !== 0) return 0;
  const n = Number(String(r.stdout).trim());
  return Number.isFinite(n) ? n : 0;
}

function toMp4(webm) {
  const mp4 = webm.replace(/\.webm$/, ".mp4");
  spawnSync("ffmpeg", ["-y", "-i", webm, "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p", "-movflags", "+faststart", mp4], { stdio: "ignore" });
  return mp4;
}

function poster(mp4, id) {
  const png = path.join(VID, `${id}.png`);
  spawnSync("ffmpeg", ["-y", "-sseof", "-0.1", "-i", mp4, "-frames:v", "1", "-update", "1", png], { stdio: "ignore" });
}

function buildSlideshow(id, frames) {
  const listFile = `/tmp/tple-ab-concat-${id}.txt`;
  const lines = [];
  for (const f of frames) { lines.push(`file '${f}'`); lines.push(`duration ${FRAME_HOLD_SEC}`); }
  lines.push(`file '${frames.at(-1)}'`);
  fs.writeFileSync(listFile, lines.join("\n") + "\n");
  const mp4 = path.join(VID, `${id}.mp4`);
  spawnSync("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-vf", "fps=10,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p", "-movflags", "+faststart", mp4], { stdio: "ignore" });
  return mp4;
}

let frames = [];
function shot(id, name) {
  const p = `/tmp/tple-ab-${id}-${frames.length + 1}-${name}.png`;
  ab(["screenshot", p], id);
  if (fs.existsSync(p)) frames.push(p);
}

// 会话日志滚动容器初始化
const INIT_SC = "(() => { const els=[...document.querySelectorAll('*')].filter(e=>e.scrollHeight>e.clientHeight+200&&e.clientHeight>300); const el=els.sort((a,b)=>b.scrollHeight-a.scrollHeight)[0]; if(!el) return 'noscroller'; window.__sc=el; return 'ok:'+el.scrollHeight; })()";
const scrollBy = (px) => `window.__sc.scrollBy(0, ${px})`;
const setTop = (v) => `window.__sc.scrollTop = ${v}`;
const SCROLL_INFO = "(() => window.__sc ? (window.__sc.scrollTop + '/' + window.__sc.scrollHeight) : 'no')()";

/**
 * 录一个 case：purge → open+wait 就位（录外）→ 可选预滚动 →
 * record start → 录内 eval 滚动 + 截图 → wait → record stop → ffprobe
 */
function recordCase(id, url, prepare, actions) {
  let result = { status: "BLOCKED", notes: "case 未执行" };
  for (let attempt = 1; attempt <= 2; attempt++) {
    frames = [];
    purge();
    ab(["open", url], id);
    ab(["wait", "2500"], id);
    // 滚动容器就位（录外）
    const init = ab(["eval", INIT_SC], id).out;
    if (prepare) prepare(id);
    const webm = path.join(VID, `${id}.webm`);
    try { fs.rmSync(webm); } catch {}
    ab(["record", "start", webm], id);
    ab(["wait", "1500"], id);
    shot(id, "enter");
    result = actions(id);   // 录内：只 eval 滚动/截图，不 open
    ab(["wait", "2500"], id);
    shot(id, "end");
    ab(["record", "stop"], id);
    const dur = probeDuration(webm);
    // 0.26.0 契约：空壳 webm 时长可能正常但体积异常小（~15KB 级，无帧），
    // 验收必须同时看时长与体积，不能只看 duration
    const size = fs.existsSync(webm) ? fs.statSync(webm).size : 0;
    console.log(`  [${id}] attempt ${attempt}: webm ${dur.toFixed(1)}s / ${size}B`);
    if (dur >= MIN_NATIVE_SEC && size >= 50 * 1024) {
      const mp4 = toMp4(webm);
      poster(mp4, id);
      return { ...result, recording: "native", dur };
    }
    if (attempt === 1) console.log(`  [${id}] 短/空壳录屏 → 清理残留重试原生`);
  }
  console.log(`  [${id}] 原生两次仍短 → 分镜回退`);
  const useFrames = frames.length >= 2 ? frames : frames.concat(frames);
  const mp4 = buildSlideshow(id, useFrames);
  poster(mp4, id);
  return { ...result, recording: "slideshow" };
}

// ---------- cases ----------
const cases = [
  {
    id: "01-session-a-open", title: "opencode web · 会话页打开与草案", url: URL_A,
    prepare(id) { ab(["eval", setTop(0)], id); ab(["wait", "600"], id); },
    run(id) {
      // 录内：从顶部缓滚，展示 prompt → skill 加载 → 探索 → 草案
      for (let i = 0; i < 5; i++) { ab(["eval", scrollBy(320)], id); ab(["wait", "800"], id); }
      const pos = ab(["eval", SCROLL_INFO], id).out;
      return { status: "PASS", notes: `会话页 A 从顶部滚动展示调研 prompt、skill 加载、探索与草案（滚动位置 ${pos}）；agent-browser 原生 record` };
    },
  },
  {
    id: "02-session-a-steps", title: "opencode web · 执行步骤流（工具调用）", url: URL_A,
    prepare(id) { ab(["eval", setTop(0)], id); ab(["wait", "400"], id); ab(["eval", scrollBy(1200)], id); ab(["wait", "400"], id); },
    run(id) {
      for (let i = 0; i < 6; i++) { ab(["eval", scrollBy(420)], id); ab(["wait", "750"], id); if (i === 2) shot(id, "steps-mid"); }
      const pos = ab(["eval", SCROLL_INFO], id).out;
      return { status: "PASS", notes: `缓滚展示 check-env、agent-browser 探索、落盘 user-cases.csv/cases.json/run-cases.mjs 等工具调用流（位置 ${pos}）` };
    },
  },
  {
    id: "03-session-a-final", title: "opencode web · 最终结果 5/5 PASS", url: URL_A,
    prepare(id) { ab(["eval", "window.__sc.scrollTop = window.__sc.scrollHeight"], id); ab(["wait", "400"], id); ab(["eval", scrollBy(-1600)], id); ab(["wait", "400"], id); },
    run(id) {
      for (let i = 0; i < 4; i++) { ab(["eval", scrollBy(400)], id); ab(["wait", "800"], id); }
      shot(id, "final");
      const pos = ab(["eval", SCROLL_INFO], id).out;
      return { status: "PASS", notes: `滚动至会话底部，展示最终汇总：TPLE 调研完成 5/5 PASS 与报告路径（位置 ${pos}）` };
    },
  },
  {
    id: "04-session-b-tour", title: "opencode web · 第二个会话（8 case 执行）巡览", url: URL_B,
    prepare(id) { ab(["eval", setTop(0)], id); ab(["wait", "600"], id); },
    run(id) {
      for (let i = 0; i < 7; i++) { ab(["eval", scrollBy(460)], id); ab(["wait", "700"], id); if (i === 3) shot(id, "b-mid"); }
      const pos = ab(["eval", SCROLL_INFO], id).out;
      return { status: "PASS", notes: `第二个会话（8 case 实时执行）从草案到录屏、FAIL 自愈重跑的执行流巡览（位置 ${pos}）` };
    },
  },
];

// ---------- 主流程 ----------
console.log("purge 残留 agent-browser…");
purge();
try { fs.rmSync(META); } catch {}

const summary = [];
for (const c of cases) {
  console.log(`▶ ${c.id} ${c.title}`);
  const r = recordCase(c.id, c.url, c.prepare, c.run);
  ab(["close"], c.id);
  logCase(c.id, c.title, r.status, r.notes);
  summary.push({ id: c.id, status: r.status, recording: r.recording });
  console.log(`  → ${r.status}（${r.recording}）`);
}

console.log("\n汇总：");
for (const s of summary) console.log(`  ${s.id} ${s.status} (${s.recording})`);
