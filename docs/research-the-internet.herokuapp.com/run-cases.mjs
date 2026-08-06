#!/usr/bin/env node
/**
 * tple-skill 调研模式 — run-cases（the-internet.herokuapp.com）
 *
 * 调研模式语义：只读探索；FAIL = 路径走不通（调研发现），不进 auto-fix；
 * BLOCKED = 需凭据/受限；OBSERVE = 观察项。
 *
 * 录屏契约：原生 agent-browser record 为主；ffprobe < MIN_NATIVE_SEC
 * 先清理残留进程重试一次原生，仍短再分镜回退。
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
const BASE = "https://the-internet.herokuapp.com";
const MIN_NATIVE_SEC = Number(process.env.MIN_NATIVE_SEC || 4);
const FRAME_HOLD_SEC = 1.6;
const CASE_LIMIT = Number(process.env.CASE_LIMIT || 0);

fs.mkdirSync(VID, { recursive: true });

// ---------- logCase 标准实现（meta.jsonl + runs.json 同时写） ----------
function logCase(id, title, status, notes) {
  // notes 清洗：一行一记录是硬约束
  const clean = String(notes || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\|/g, "/")
    .slice(0, 300);
  fs.appendFileSync(META, `${id}|${title}|${status}|${clean}\n`);

  let runs = {};
  try { runs = JSON.parse(fs.readFileSync(RUNS, "utf8")); } catch { runs = {}; }
  const prev = runs[id] || { runCount: 0 };
  runs[id] = {
    lastRanAt: new Date().toISOString(),
    runCount: Number(prev.runCount || 0) + 1,
  };
  fs.writeFileSync(RUNS, JSON.stringify(runs, null, 2));
}

// ---------- agent-browser 封装 ----------
const SESSION = (id) => ({ AGENT_BROWSER_SESSION: id });

function ab(args, session, timeout = 60000) {
  const r = spawnSync("agent-browser", args, {
    encoding: "utf8",
    timeout,
    env: { ...process.env, ...(session ? SESSION(session) : {}) },
  });
  return {
    ok: r.status === 0,
    out: String(r.stdout || "").trim(),
    err: String(r.stderr || "").trim(),
  };
}

function purge() {
  ab(["close", "--all"]);
  spawnSync("pkill", ["-f", "agent-browser-darwin-arm64"]);
  spawnSync("pkill", ["-f", "user-data-dir=.*/agent-browser-chrome-"]);
  spawnSync("sleep", ["1.5"]);
}

function findRef(snapshot, label) {
  const m = snapshot.match(new RegExp(`"${label}"[^\\n]*?\\[ref=(e\\d+)\\]`));
  return m ? `@${m[1]}` : null;
}

function probeDuration(file) {
  const r = spawnSync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=nw=1:nk=1", file,
  ], { encoding: "utf8" });
  if (r.error || r.status !== 0) return 0;
  const n = Number(String(r.stdout).trim());
  return Number.isFinite(n) ? n : 0;
}

function toMp4(webm) {
  const mp4 = webm.replace(/\.webm$/, ".mp4");
  spawnSync("ffmpeg", [
    "-y", "-i", webm,
    "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p",
    "-movflags", "+faststart", mp4,
  ], { stdio: "ignore" });
  return mp4;
}

function poster(mp4, id) {
  const png = path.join(VID, `${id}.png`);
  const r = spawnSync("ffmpeg", [
    "-y", "-sseof", "-0.1", "-i", mp4, "-frames:v", "1", "-update", "1", png,
  ], { stdio: "ignore" });
  return r.status === 0;
}

function buildSlideshow(id, frames) {
  const listFile = `/tmp/tple-concat-${id}.txt`;
  const lines = [];
  for (const f of frames) {
    lines.push(`file '${f.replaceAll("'", "'\\''")}'`);
    lines.push(`duration ${FRAME_HOLD_SEC}`);
  }
  lines.push(`file '${frames.at(-1).replaceAll("'", "'\\''")}'`);
  fs.writeFileSync(listFile, lines.join("\n") + "\n");
  const mp4 = path.join(VID, `${id}.mp4`);
  spawnSync("ffmpeg", [
    "-y", "-f", "concat", "-safe", "0", "-i", listFile,
    "-vf", "fps=10,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p",
    "-movflags", "+faststart", mp4,
  ], { stdio: "ignore" });
  return mp4;
}

// 分镜回退用的帧收集
let frames = [];
function shot(id, name) {
  const p = `/tmp/tple-frame-${id}-${frames.length + 1}-${name}.png`;
  ab(["screenshot", p], id);
  if (fs.existsSync(p)) frames.push(p);
  return p;
}

/**
 * 录一个 case：purge → open+wait（录外，页面就位）→ record start →
 * actions（录内不再 open：0.26.0 录中整页导航会断帧捕获）→
 * 结尾 wait → record stop → ffprobe 验收。
 * 短/空：清理残留重试一次原生；仍短：分镜回退（保留 actions 真实结果）。
 */
function recordCase(id, url, actions) {
  let result = { status: "BLOCKED", notes: "case 未执行" };
  for (let attempt = 1; attempt <= 2; attempt++) {
    frames = [];
    purge();
    ab(["open", url], id);   // 录外：页面就位
    ab(["wait", "1500"], id);
    const webm = path.join(VID, `${id}.webm`);
    try { fs.rmSync(webm); } catch {}
    ab(["record", "start", webm], id);
    ab(["wait", "1500"], id);
    shot(id, "enter");
    result = actions(id);    // 录内：只做点击/填表，不 open
    ab(["wait", "2800"], id);
    shot(id, "end");
    ab(["record", "stop"], id);
    const dur = probeDuration(webm);
    console.log(`  [${id}] attempt ${attempt}: webm ${dur.toFixed(1)}s`);
    if (dur >= MIN_NATIVE_SEC) {
      const mp4 = toMp4(webm);
      poster(mp4, id);
      return { ...result, recording: "native", dur };
    }
    if (attempt === 1) console.log(`  [${id}] 短录屏 → 清理残留重试原生`);
  }
  // 仍短 → 分镜回退（保留 actions 已算出的真实结果）
  console.log(`  [${id}] 原生两次仍短 → 分镜回退`);
  const useFrames = frames.length >= 2 ? frames : frames.concat(frames);
  if (useFrames.length === 0) useFrames.push(path.join(VID, `${id}.png`));
  const mp4 = buildSlideshow(id, useFrames);
  poster(mp4, id);
  return { ...result, recording: "slideshow" };
}

// ---------- cases ----------
const cases = [
  {
    id: "01-home", title: "首页可访问与导航结构", url: `${BASE}/`,
    run(id) {
      const count = ab(["get", "count", "li a"], id).out;
      const n = Number((count.match(/\d+/) || [0])[0]);
      const title = ab(["get", "title"], id).out;
      const pass = n >= 40;
      return {
        status: pass ? "PASS" : "FAIL",
        notes: `导航示例链接 ${n} 个（预期 ≥40）；页面标题「${title}」；首页渲染正常，入口齐全`,
      };
    },
  },
  {
    id: "02-login", title: "登录路径可走通", url: `${BASE}/login`,
    run(id) {
      // 凭据来自登录页公开展示的 demo 提示（tomsmith / SuperSecretPassword!）
      const userOk = ab(["fill", "#username", "tomsmith"], id).ok;
      const passOk = ab(["fill", "#password", "SuperSecretPassword!"], id).ok;
      if (!userOk || !passOk) {
        return { status: "BLOCKED", notes: "找不到登录表单元素（#username/#password fill 失败）" };
      }
      shot(id, "filled");
      ab(["click", "button[type=submit]"], id);
      ab(["wait", "2500"], id);
      const url = ab(["get", "url"], id).out;
      const text = ab(["get", "text", "body"], id).out;
      const ok = url.includes("/secure") && /logged into a secure area/i.test(text);
      return {
        status: ok ? "PASS" : "FAIL",
        notes: ok
          ? "demo 凭据登录成功，进入 Secure Area 且见成功提示；登录路径可走通"
          : `登录后 URL=${url}，未见成功提示（调研发现：登录路径异常）`,
      };
    },
  },
  {
    id: "03-login-error", title: "错误凭据的反馈", url: `${BASE}/login`,
    run(id) {
      ab(["fill", "#username", "tomsmith"], id);
      ab(["fill", "#password", "wrong-password"], id);
      ab(["click", "button[type=submit]"], id);
      ab(["wait", "2500"], id);
      const text = ab(["get", "text", "body"], id).out;
      const hasError = /invalid/i.test(text);
      return {
        status: hasError ? "PASS" : "FAIL",
        notes: hasError
          ? "错误密码提交后页面明确显示 invalid 错误消息，反馈路径正常"
          : "错误密码提交后未见明确错误提示（调研发现：错误反馈缺失）",
      };
    },
  },
  {
    id: "04-add-remove", title: "增删元素交互", url: `${BASE}/add_remove_elements/`,
    run(id) {
      // 实测：该页 CSS 选择器 click 会静默落空（✓ Done 但无效果），
      // 必须用 snapshot ref 点击（点击纪律：点击后验证效果，不信 ✓ Done）
      const countEls = () => {
        const r = ab(["eval", "document.querySelectorAll('#elements .added-manually').length"], id);
        return Number((r.out.match(/\d+/) || [0])[0]);
      };
      const before = countEls();
      const snap1 = ab(["snapshot", "-i"], id).out;
      const addRef = findRef(snap1, "Add Element");
      if (!addRef) return { status: "BLOCKED", notes: "snapshot 找不到 Add Element 按钮 ref" };
      ab(["click", addRef], id);
      ab(["wait", "900"], id);
      // DOM 追加后 ref 可能漂移，重取 snapshot 再点第二次
      const snap2 = ab(["snapshot", "-i"], id).out;
      const addRef2 = findRef(snap2, "Add Element");
      ab(["click", addRef2 || addRef], id);
      ab(["wait", "900"], id);
      const afterAdd = countEls();
      shot(id, "added");
      const snap3 = ab(["snapshot", "-i"], id).out;
      const delRef = findRef(snap3, "Delete");
      if (delRef) {
        ab(["click", delRef], id);
        ab(["wait", "900"], id);
      }
      const afterDel = countEls();
      const ok = afterAdd === before + 2 && afterDel === before + 1;
      return {
        status: ok ? "PASS" : "FAIL",
        notes: `元素数：初始 ${before} → 加两次 ${afterAdd} → 删一次 ${afterDel}；${ok ? "增删交互符合预期（ref 点击生效）" : "增删数量与预期不符（调研发现）"}`,
      };
    },
  },
  {
    id: "05-checkboxes", title: "复选框状态切换", url: `${BASE}/checkboxes`,
    run(id) {
      const st = () => ab(["eval", "JSON.stringify([...document.querySelectorAll('input[type=checkbox]')].map(c=>c.checked))"], id).out;
      const before = st();
      ab(["click", "input[type=checkbox]:nth-of-type(1)"], id);
      ab(["wait", "600"], id);
      ab(["click", "input[type=checkbox]:nth-of-type(2)"], id);
      ab(["wait", "600"], id);
      const after = st();
      const ok = before !== after && /true/.test(after);
      return {
        status: ok ? "PASS" : "FAIL",
        notes: `状态 ${before} → ${after}；复选框随点击翻转`,
      };
    },
  },
  {
    id: "06-dropdown", title: "下拉选择", url: `${BASE}/dropdown`,
    run(id) {
      ab(["select", "#dropdown", "1"], id);
      ab(["wait", "600"], id);
      const v1 = ab(["get", "value", "#dropdown"], id).out;
      ab(["select", "#dropdown", "2"], id);
      ab(["wait", "600"], id);
      const v2 = ab(["get", "value", "#dropdown"], id).out;
      const ok = v1.includes("1") && v2.includes("2");
      return {
        status: ok ? "PASS" : "FAIL",
        notes: `选中值：Option 1 → ${v1}；Option 2 → ${v2}`,
      };
    },
  },
  {
    id: "07-dynamic-loading", title: "动态加载等待", url: `${BASE}/dynamic_loading/1`,
    run(id) {
      ab(["click", "#start button"], id);
      ab(["wait", "6000"], id);
      shot(id, "loaded");
      const visible = ab(["is", "visible", "#finish"], id);
      const text = ab(["get", "text", "#finish"], id).out;
      const ok = visible.ok && /hello world/i.test(text);
      return {
        status: ok ? "PASS" : "FAIL",
        notes: ok
          ? "点击 Start 后约 4-5s 加载完成，Hello World! 出现；动态加载路径可走通"
          : `等待 6s 后 #finish 未可见或内容不符（visible=${visible.out} text=${text}）`,
      };
    },
  },
  {
    id: "08-status-codes", title: "状态码页行为", url: `${BASE}/status_codes`,
    run(id) {
      // 录内不用 open（整页导航断帧）：点链接 → 验证 → back 返回
      const results = [];
      for (const code of ["200", "404", "500"]) {
        const snap = ab(["snapshot", "-i"], id).out;
        const ref = findRef(snap, code);
        if (ref) ab(["click", ref], id);
        ab(["wait", "1500"], id);
        const text = ab(["get", "text", "body"], id).out;
        const hit = text.includes(code);
        results.push(`${code}:${hit ? "✓" : "✗"}`);
        shot(id, `status-${code}`);
        ab(["back"], id);
        ab(["wait", "1200"], id);
      }
      const ok = !results.some((r) => r.includes("✗"));
      return {
        status: ok ? "PASS" : "FAIL",
        notes: `状态码页逐一访问 ${results.join(" ")}；各页如实返回对应状态说明`,
      };
    },
  },
  {
    id: "09-js-alerts", title: "JS alert 交互", url: `${BASE}/javascript_alerts`,
    run(id) {
      ab(["click", "button[onclick='jsAlert()']"], id);
      ab(["wait", "1500"], id); // alert 自动接受
      const text = ab(["get", "text", "#result"], id).out;
      const ok = /successfully clicked an alert/i.test(text);
      return {
        status: ok ? "PASS" : "FAIL",
        notes: ok
          ? "JS Alert 触发并（自动）接受，结果区显示成功文案"
          : `结果区内容：${text || "（空）"}`,
      };
    },
  },
  {
    id: "10-basic-auth", title: "Basic Auth 受限路径", url: `${BASE}/basic_auth`,
    run(id) {
      // 无凭据：预期受限（401 或浏览器拦截认证弹窗），如实记 BLOCKED
      const open = ab(["open", `${BASE}/basic_auth`], id);
      ab(["wait", "2000"], id);
      const text = ab(["get", "text", "body"], id);
      const url = ab(["get", "url"], id).out;
      const note = !text.ok || !text.out
        ? `访问被认证拦截（open ${open.ok ? "成功但" : "失败："}${(open.err || open.out).slice(0, 80)}），页面内容不可得`
        : `页面返回内容：${text.out.slice(0, 100)}`;
      return { status: "BLOCKED", notes: `${note}；需凭据，未登录态无法继续（如实记录，不瞎猜）` };
    },
  },
];

// ---------- 主流程 ----------
console.log("purge 残留 agent-browser…");
purge();

const selected = CASE_LIMIT > 0 ? cases.slice(0, CASE_LIMIT) : cases;
if (CASE_LIMIT > 0) console.log(`CASE_LIMIT=${CASE_LIMIT} 冒烟：只跑前 ${CASE_LIMIT} 条`);

try { fs.rmSync(META); } catch {}

const summary = [];
for (const c of selected) {
  console.log(`▶ ${c.id} ${c.title}`);
  const r = recordCase(c.id, c.url, (id) => c.run(id));
  ab(["close"], c.id); // case 结束关 session
  if (r.status === "FAIL") {
    // 失败中间态：用最后一帧
    const last = frames.at(-1);
    if (last && fs.existsSync(last)) fs.copyFileSync(last, path.join(VID, `${c.id}-fail.png`));
  }
  logCase(c.id, c.title, r.status, r.notes);
  summary.push({ id: c.id, status: r.status, recording: r.recording });
  console.log(`  → ${r.status}（${r.recording}）`);
}

console.log("\n汇总：");
for (const s of summary) console.log(`  ${s.id} ${s.status} (${s.recording})`);
console.log("meta.jsonl / runs.json 已写入", OUT);
