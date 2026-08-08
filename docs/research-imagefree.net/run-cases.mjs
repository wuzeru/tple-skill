#!/usr/bin/env node
// 调研模式 run-cases — imagefree.net（人机验证门闩专题，2 case）
// if-01 无头录屏观察门闩；if-02 headed 弹窗等待用户手动过 Cloudflare turnstile。
// 纪律：只读、不绕过反爬、人机验证由用户手动完成。
import fs from "node:fs";
import path from "node:path";
import { execSync, spawnSync, spawn } from "node:child_process";

const SITE = "https://imagefree.net/";
const OUT = path.dirname(new URL(import.meta.url).pathname);
const VIDEOS = path.join(OUT, "videos");
const META = path.join(OUT, "meta.jsonl");
const RUNS = path.join(OUT, "runs.json");
const MIN_NATIVE_SEC = Number(process.env.MIN_NATIVE_SEC || 4);
fs.mkdirSync(VIDEOS, { recursive: true });

function logCase(id, title, status, notes) {
  const clean = String(notes || "").replace(/\|/g, "/").replace(/\s+/g, " ").trim().slice(0, 300);
  fs.appendFileSync(META, `${id}|${title}|${status}|${clean}\n`);
  let runs = {};
  try { runs = JSON.parse(fs.readFileSync(RUNS, "utf8")); } catch { runs = {}; }
  const prev = runs[id] || { runCount: 0 };
  runs[id] = { lastRanAt: new Date().toISOString(), runCount: Number(prev.runCount || 0) + 1 };
  fs.writeFileSync(RUNS, JSON.stringify(runs, null, 2));
}

function purgeAgentBrowser() {
  try { execSync("agent-browser close --all 2>/dev/null || true", { stdio: "ignore" }); } catch {}
  try { execSync("pkill -f 'user-data-dir=.*/agent-browser-chrome-[0-9a-f]' 2>/dev/null || true", { stdio: "ignore" }); } catch {}
  try { execSync("pkill -f 'user-data-dir=.*/agent-browser-profile-' 2>/dev/null || true", { stdio: "ignore" }); } catch {}
  spawnSync("sleep", ["1.5"]);
}

function ab(session, args) {
  const r = spawnSync("agent-browser", ["--session", session, ...args], { encoding: "utf8", timeout: 120_000 });
  const out = ((r.stdout || "") + (r.stderr || "")).trim();
  if (r.status !== 0 && !out.includes("✓")) throw new Error(out.slice(0, 400));
  return out;
}
const tryAb = (session, args) => { try { return ab(session, args); } catch { return ""; } };

const ffprobeSec = (f) => Number(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", f], { encoding: "utf8" }).stdout.trim());
const frameCount = (f) => Number(spawnSync("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames", "-of", "default=nw=1:nk=1", f], { encoding: "utf8" }).stdout.trim());

function toMp4(id, webm) {
  const mp4 = path.join(VIDEOS, `${id}.mp4`);
  spawnSync("ffmpeg", ["-y", "-i", webm, "-c:v", "libx264", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p", "-movflags", "+faststart", mp4], { stdio: "ignore" });
  spawnSync("ffmpeg", ["-y", "-sseof", "-1", "-i", mp4, "-frames:v", "1", path.join(VIDEOS, `${id}.png`)], { stdio: "ignore" });
}

function buildSlideshow(id, frames) {
  const listFile = `/tmp/e2e-concat-${id}.txt`;
  const lines = [];
  for (const f of frames) { lines.push(`file '${f.replaceAll("'", "'\\''")}'`); lines.push("duration 1.6"); }
  lines.push(`file '${frames.at(-1).replaceAll("'", "'\\''")}'`);
  fs.writeFileSync(listFile, lines.join("\n") + "\n");
  const mp4 = path.join(VIDEOS, `${id}.mp4`);
  spawnSync("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-vf", "fps=10,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p", "-movflags", "+faststart", mp4], { stdio: "ignore" });
  spawnSync("ffmpeg", ["-y", "-i", mp4, "-c:v", "libvpx", "-b:v", "1M", "-auto-alt-ref", "0", path.join(VIDEOS, `${id}.webm`)], { stdio: "ignore" });
  spawnSync("ffmpeg", ["-y", "-sseof", "-1", "-i", mp4, "-frames:v", "1", path.join(VIDEOS, `${id}.png`)], { stdio: "ignore" });
}

// 门闩状态探针：Generate 按钮是否 disabled + turnstile 是否在页
function gateProbe(session) {
  const snap = tryAb(session, ["snapshot", "-i"]);
  const genLine = snap.split("\n").find((l) => l.includes('button "Generate'));
  const turnstile = snap.includes("验证您是真人") || snap.includes("Verify you are human") || snap.includes("Cloudflare");
  return {
    generateDisabled: !!genLine && genLine.includes("disabled"),
    generatePresent: !!genLine,
    turnstilePresent: turnstile,
  };
}

// ---------- case if-01：无头观察门闩 ----------
function case01() {
  purgeAgentBrowser();
  const session = "ifr-gate";
  const webm = path.join(VIDEOS, "if-01-captcha-gate.webm");
  try {
    ab(session, ["open", SITE]);
    ab(session, ["wait", "2500"]);
    const p0 = gateProbe(session);
    ab(session, ["record", "start", webm]);
    ab(session, ["wait", "2000"]);
    ab(session, ["screenshot", path.join(VIDEOS, "if-01-mid.png")]);
    ab(session, ["scroll", "down", "300"]);
    ab(session, ["wait", "1500"]);
    ab(session, ["scroll", "up", "300"]);
    ab(session, ["wait", "1500"]);
    ab(session, ["record", "stop"]);
    const p1 = gateProbe(session);
    const dur = ffprobeSec(webm);
    const frames = frameCount(webm);
    if (dur >= MIN_NATIVE_SEC && frames >= 4) { toMp4("if-01-captcha-gate", webm); }
    else buildSlideshow("if-01-captcha-gate", [path.join(VIDEOS, "if-01-mid.png")]);
    const rec = dur >= MIN_NATIVE_SEC && frames >= 4 ? `原生 ${dur.toFixed(1)}s/${frames}帧` : "分镜回退";
    const observed = p1.generatePresent && p1.generateDisabled && p1.turnstilePresent;
    logCase("if-01-captcha-gate", "人机验证门闩观察", observed ? "OBSERVE" : "BLOCKED",
      observed
        ? `Generate 按钮 disabled，Cloudflare「请验证您是真人」turnstile 在页；门闩未过，未尝试绕过 · 录屏:${rec}`
        : `门闩探针异常: gen=${p1.generatePresent} disabled=${p1.generateDisabled} turnstile=${p1.turnstilePresent} · 录屏:${rec}`);
    console.log(`if-01 ${observed ? "OBSERVE" : "BLOCKED"} — Generate disabled=${p1.generateDisabled}, turnstile=${p1.turnstilePresent} · ${rec}`);
  } catch (e) {
    logCase("if-01-captcha-gate", "人机验证门闩观察", "BLOCKED", `异常: ${String(e.message || e)}`);
    console.log(`if-01 BLOCKED — ${e.message}`);
  } finally {
    tryAb(session, ["close"]);
  }
}

// ---------- case if-02：连接用户真实浏览器（人机检测门闩），选项 C 预检 → 主流程 ----------
const CDP_PORT = 9222;
const CHROME_BIN = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const UDIR = path.join(process.env.TMPDIR || "/tmp", "tple-ifr-cdp-profile");

function wsUrl() {
  const r = spawnSync("curl", ["-s", "-m", "5", `http://localhost:${CDP_PORT}/json/version`], { encoding: "utf8" });
  try { return JSON.parse(r.stdout).webSocketDebuggerUrl; } catch { return null; }
}

// 阶段 1：预检——起 CDP Chrome + 一次普通连接调用完成权限握手（首次弹「允许远程控制」）
async function preflight() {
  const probe = wsUrl();
  if (!probe) {
    fs.rmSync(UDIR, { recursive: true, force: true });
    fs.mkdirSync(UDIR, { recursive: true });
    const p = spawn(CHROME_BIN, [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${UDIR}`, "--no-first-run", "--no-default-browser-check", SITE], { stdio: "ignore", detached: true });
    p.unref();
    for (let i = 0; i < 15; i++) { await new Promise((r) => setTimeout(r, 1000)); if (wsUrl()) break; }
  }
  const ws = wsUrl();
  if (!ws) { console.log("PREFLIGHT FAIL — Chrome 未起或 CDP 端口不通"); process.exit(1); }
  console.log(`WS: ${ws}`);
  const c1 = tryAb("preflight", ["connect", ws]);
  console.log(`connect: ${c1.slice(0, 60)}`);
  const url = tryAb("preflight", ["get", "url"]);
  console.log(`get url: ${url}`);
  console.log("\n>>> 预检完成。如果刚刚弹出了 Chrome「允许远程控制」确认框，请点允许；之后不会再出现。");
  console.log(">>> 确认无误后运行 CASE=if-02-main 进主流程。");
}

// 阶段 2：主流程——已授权的会话上录屏 + 轮询，等用户手动过门闩
async function case02() {
  const ws = wsUrl();
  if (!ws) { console.log("CDP 不可用，先跑 CASE=if-02-preflight"); process.exit(1); }
  purgeAgentBrowser();
  ab("if02", ["connect", ws]);           // 已授权，不再弹确认框
  ab("if02", ["open", SITE]);            // 连接会话里导航到目标站（门闩出现在用户窗口）
  ab("if02", ["wait", "2500"]);
  const webm = path.join(VIDEOS, "if-02-cdp-wait.webm");
  fs.rmSync(webm, { force: true });
  const MAX_WAIT_S = Number(process.env.MAX_WAIT_S || 240);
  console.log("\n>>> 主流程开始：请在 Chrome 窗口手动勾选 Cloudflare「请验证您是真人」");
  ab("if02", ["record", "start", webm]);
  const t0 = Date.now();
  let cleared = false, lastState = "";
  while ((Date.now() - t0) / 1000 < MAX_WAIT_S) {
    const snap = tryAb("if02", ["snapshot", "-i"]);
    const genLine = snap.split("\n").find((l) => l.includes('button "Generate'));
    const turnstile = snap.includes("验证您是真人") || snap.includes("Verify you are human");
    const genDisabled = !!genLine && genLine.includes("disabled");
    const state = `gen=${!!genLine} disabled=${genDisabled} turnstile=${turnstile}`;
    if (state !== lastState) { console.log(`    轮询状态: ${state}`); lastState = state; }
    if (genLine && !genDisabled) { cleared = true; break; }
    await new Promise((r) => setTimeout(r, 3000));
  }
  tryAb("if02", ["record", "stop"]);
  tryAb("if02", ["screenshot", path.join(VIDEOS, "if-02-cdp-wait.png")]);
  const dur = fs.existsSync(webm) ? ffprobeSec(webm) : 0;
  const frames = fs.existsSync(webm) ? frameCount(webm) : 0;
  let rec;
  if (dur >= MIN_NATIVE_SEC && frames >= 4) { toMp4("if-02-cdp-wait", webm); rec = `原生 ${dur.toFixed(1)}s/${frames}帧`; }
  else { buildSlideshow("if-02-cdp-wait", [path.join(VIDEOS, "if-02-cdp-wait.png")]); rec = "分镜兜底"; }
  const waitS = Math.round((Date.now() - t0) / 1000);
  const notes = `connect ws-url 预检接入（首次弹「允许远程控制」确认后不再弹），用户手动过 Cloudflare 验证，${waitS}s 后 Generate ${cleared ? "变可用" : "仍未放行"}，未绕过反爬 · 录屏:${rec}`;
  logCase("if-02-cdp-wait", "人机检测改用连接真实浏览器（选项 C 预检流程）", cleared ? "PASS" : "BLOCKED", notes);
  console.log(`if-02 ${cleared ? "PASS" : "BLOCKED"} — ${waitS}s · ${rec}`);
}

console.log(`调研模式 · imagefree.net 人机验证专题 · ${new Date().toISOString()}`);
const CASE = process.env.CASE || "";   // CASE=if-01 / if-02-preflight / if-02-main 可单跑
if (CASE === "if-02-preflight") { await preflight(); }
else if (CASE === "if-02-main") { await case02(); purgeAgentBrowser(); }
else { if (!CASE || CASE === "if-01") case01(); }
purgeAgentBrowser();
console.log("\n=== meta.jsonl ===");
console.log(fs.readFileSync(META, "utf8"));
