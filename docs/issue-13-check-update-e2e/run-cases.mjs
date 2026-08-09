#!/usr/bin/env node
/**
 * run-cases.mjs — issue #13「版本自检与自更新」端到端验收
 *
 * 被测对象：tple-skill 仓库 scripts/check-update.mjs（本分支最新代码）
 * 录屏方式：终端实况回放——命令真实执行、输出真实捕获（断言只读退出码 + stdout
 *           外部事实），随后把真实输出渲染成终端回放页，用 agent-browser 录制。
 *
 * Usage: node run-cases.mjs [ONLY=11,12 只跑指定 case]
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.dirname(fileURLToPath(import.meta.url)); // docs/issue-13-check-update-e2e
const REPO = path.resolve(OUT, "..", ".."); // tple-skill 仓库根
const TARGET = path.join(REPO, "scripts/check-update.mjs"); // 被测脚本
const VIDEOS = path.join(OUT, "videos");
const FIX = "/tmp/tple-issue13";
const META = path.join(OUT, "meta.jsonl");
const RUNS = path.join(OUT, "runs.json");
const ONLY = new Set((process.env.ONLY || "").split(",").filter(Boolean));

fs.mkdirSync(VIDEOS, { recursive: true });

// ---- logCase 标准实现（meta.jsonl + runs.json 双写） ----
function logCase(id, title, status, notes) {
  const clean = String(notes || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\|/g, "∣")
    .slice(0, 300);
  fs.appendFileSync(META, `${id}|${title}|${status}|${clean}\n`);
  let runs = {};
  try { runs = JSON.parse(fs.readFileSync(RUNS, "utf8")); } catch { runs = {}; }
  const prev = runs[id] || { runCount: 0 };
  runs[id] = { lastRanAt: new Date().toISOString(), runCount: Number(prev.runCount || 0) + 1 };
  fs.writeFileSync(RUNS, JSON.stringify(runs, null, 2));
}

// ---- 基础工具 ----
const sh = (cmd, opts = {}) => {
  const r = spawnSync("bash", ["-c", cmd], { encoding: "utf8", timeout: opts.timeout ?? 180000, ...opts });
  return { stdout: String(r.stdout || ""), stderr: String(r.stderr || ""), status: r.status };
};
const ab = (args, timeout = 60000) => {
  const r = spawnSync("agent-browser", args, { encoding: "utf8", timeout });
  return { stdout: String(r.stdout || ""), stderr: String(r.stderr || ""), status: r.status };
};
const cleanResiduals = () => {
  ab(["close", "--all"]);
  spawnSync("pkill", ["-f", "user-data-dir=.*/agent-browser-chrome-"]);
  spawnSync("pkill", ["-f", "user-data-dir=.*/agent-browser-profile-"]);
  sh("sleep 1.5");
};
const trimLines = (text, max = 22) => {
  const lines = String(text || "").replace(/\r/g, "").split("\n").filter((l) => l.length > 0);
  if (lines.length <= max) return lines;
  return [...lines.slice(0, max - 1), `…（省略 ${lines.length - max + 1} 行）`];
};

// ---- 终端回放页（真实捕获的命令与输出，逐行打字动画） ----
function makeReplayPage(id, title, steps) {
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const total = steps.reduce((n, s) => n + 1 + trimLines(s.out).length, 0);
  const perLine = Math.max(80, Math.min(180, Math.floor(4200 / Math.max(total, 1))));
  const body = steps.map((s, i) => {
    const lines = trimLines(s.out);
    const outHtml = lines.map((l, j) => {
      const cls = s.status === 0 ? "out" : "err";
      return `<div class="${cls}" style="animation-delay:${((i * (lines.length + 1) + j + 1) * perLine)}ms">${esc(l)}</div>`;
    }).join("\n");
    const badge = `<span class="badge ${s.status === 0 ? "ok" : "bad"}">exit ${s.status}</span>`;
    return `<div class="cmd" style="animation-delay:${i * (lines.length + 1) * perLine}ms"><span class="prompt">❯</span> ${esc(s.cmd)} ${badge}</div>\n${outHtml}`;
  }).join("\n");
  const holdMs = (total + 2) * perLine + 1500;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(id)}</title><style>
  body{margin:0;background:#0d1117;font-family:'SF Mono',Menlo,Consolas,monospace;font-size:15px;color:#c9d1d9}
  .bar{background:#161b22;padding:10px 16px;color:#8b949e;font-size:13px;border-bottom:1px solid #21262d}
  .bar b{color:#58a6ff}
  .term{padding:22px 26px;line-height:1.55;max-width:1080px}
  .cmd,.out,.err{opacity:0;animation:fadein .18s forwards}
  .prompt{color:#3fb950;font-weight:700}
  .cmd{color:#e6edf3;margin-top:14px;font-weight:600}
  .out{color:#9fb6c9}
  .err{color:#ff9e8f}
  .badge{font-size:12px;padding:1px 7px;border-radius:9px;margin-left:8px;vertical-align:1px}
  .ok{background:#12351f;color:#3fb950;border:1px solid #238636}
  .bad{background:#3d1418;color:#ff7b72;border:1px solid #b62324}
  @keyframes fadein{to{opacity:1}}
  </style></head><body>
  <div class="bar">TPLE · issue #13 · <b>${esc(id)}</b> ${esc(title)} — 真实执行输出回放（断言基于真实退出码与 stdout）· 动画时长 ~${(total * perLine / 1000).toFixed(1)}s / hold 至 ${Math.ceil(holdMs / 1000)}s</div>
  <div class="term">${body}</div>
  </body></html>`;
}

// ---- 录屏（原生 record 契约：页面先就位 → 防御 stop → start → wait → stop → ffprobe） ----
function recordCase(id, title, steps) {
  const sid = `tple-i13-${id}`;
  const replayPath = path.join(FIX, `replay-${id}.html`);
  fs.writeFileSync(replayPath, makeReplayPage(id, title, steps));
  const webm = path.join(VIDEOS, `${id}.webm`);
  const mp4 = path.join(VIDEOS, `${id}.mp4`);

  for (let attempt = 1; attempt <= 2; attempt++) {
    cleanResiduals();
    ab(["--session", sid, "open", `file://${replayPath}`]);
    ab(["--session", sid, "wait", "800"]); // 页面渲染就位（录前）
    ab(["--session", sid, "record", "stop"]); // 防御性（幂等）
    const start = ab(["--session", sid, "record", "start", webm]);
    if (start.status !== 0) { console.log(`  ! record start 失败：${start.stderr.slice(0, 120)}`); }
    ab(["--session", sid, "wait", "6500"], 30000); // 覆盖 ~5s 动画 + 余量
    ab(["--session", sid, "wait", "1200"], 15000); // 给观众看清结果
    ab(["--session", sid, "record", "stop"], 60000);
    const probe = sh(`ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "${webm}"`);
    const dur = Number(probe.stdout.trim());
    const size = fs.existsSync(webm) ? fs.statSync(webm).size : 0;
    console.log(`  attempt ${attempt}: duration=${dur.toFixed(1)}s size=${(size / 1024).toFixed(0)}KB`);
    if (dur >= 4 && size >= 50 * 1024) {
      const tr = sh(`ffmpeg -y -loglevel error -i "${webm}" -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" -c:v libx264 -pix_fmt yuv420p -movflags +faststart "${mp4}"`, { timeout: 120000 });
      ab(["--session", sid, "close"]);
      if (tr.status === 0 && fs.existsSync(mp4)) return { mode: "native", dur };
    }
  }
  // 分镜回退：逐段截图 → ffmpeg concat（每帧 1.6s）
  console.log("  ! 原生录屏短/空 → 分镜回退");
  cleanResiduals();
  const frames = [];
  ab(["--session", sid, "open", `file://${replayPath}`]);
  for (let i = 0; i < 4; i++) {
    const f = path.join(FIX, `frame-${id}-${i}.png`);
    ab(["--session", sid, "screenshot", f]);
    frames.push(f);
    ab(["--session", sid, "wait", "1600"]);
  }
  const listFile = path.join(FIX, `concat-${id}.txt`);
  fs.writeFileSync(listFile, frames.map((f) => `file '${f}'\nduration 1.6`).join("\n") + `\nfile '${frames[3]}'`);
  sh(`ffmpeg -y -loglevel error -f concat -safe 0 -i "${listFile}" -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" -c:v libx264 -pix_fmt yuv420p -movflags +faststart "${mp4}"`, { timeout: 120000 });
  ab(["--session", sid, "close"]);
  return { mode: "storyboard", dur: 6.4 };
}

function failShot(id, sid) {
  try { ab(["--session", sid, "screenshot", path.join(VIDEOS, `${id}-fail.png`)]); } catch {}
}

// ---- fixture：git 安装目录（钉在 v0.0.5，落后状态） ----
function setupGitFixture() {
  sh(`rm -rf ${FIX}/git-install`);
  sh(`git clone -q https://github.com/wuzeru/tple-skill.git ${FIX}/git-install`, { timeout: 300000 });
  sh(`cd ${FIX}/git-install && git checkout -q v0.0.5`);
  sh(`mkdir -p ${FIX}/git-install/scripts && cp "${TARGET}" ${FIX}/git-install/scripts/check-update.mjs`);
}

// ---- cases ----
const CASES = {
  "11-selfcheck-git": {
    title: "git 安装自检：落后检测 + 摘要",
    run(steps) {
      setupGitFixture();
      steps.push({ cmd: "git clone … && git checkout v0.0.5（制造落后 fixture）", out: sh(`cd ${FIX}/git-install && git describe --tags`).stdout, status: 0 });
      const r = sh(`cd ${FIX}/git-install && node scripts/check-update.mjs --force`);
      steps.push({ cmd: "node scripts/check-update.mjs --force", out: r.stdout, status: r.status });
      const ok = r.status === 0
        && /v0\.0\.5/.test(r.stdout)
        && /v0\.0\.7/.test(r.stdout)
        && /落后/.test(r.stdout)
        && /·/.test(r.stdout); // 落后摘要条目
      return { pass: ok, notes: `exit=${r.status}；当前 v0.0.5 / 最新 v0.0.7 / 落后摘要 均输出=${ok}（GitHub API 真实对比）` };
    },
  },
  "12-json-cache": {
    title: "--json 输出与 24h 缓存",
    run(steps) {
      const j = sh(`cd ${FIX}/git-install && node scripts/check-update.mjs --json`);
      steps.push({ cmd: "node scripts/check-update.mjs --json", out: j.stdout, status: j.status });
      let fieldsOk = false;
      try {
        const o = JSON.parse(j.stdout);
        fieldsOk = o.current === "v0.0.5" && o.latest === "v0.0.7" && o.behind === true && o.installType === "git";
      } catch {}
      const c = sh(`cd ${FIX}/git-install && node scripts/check-update.mjs`);
      steps.push({ cmd: "node scripts/check-update.mjs（第二次，应命中缓存）", out: c.stdout, status: c.status });
      const cacheOk = /cache/.test(c.stdout) && c.status === 0;
      const ok = j.status === 0 && fieldsOk && cacheOk;
      return { pass: ok, notes: `--json exit=${j.status} 字段(current/latest/behind/installType)正确=${fieldsOk}；第二次缓存命中=${cacheOk}` };
    },
  },
  "13-offline-degrade": {
    title: "离线静默降级（永不阻塞）",
    run(steps) {
      const env = "https_proxy=http://127.0.0.1:1 HTTPS_PROXY=http://127.0.0.1:1 http_proxy=http://127.0.0.1:1";
      const r = sh(`cd ${FIX}/git-install && ${env} node scripts/check-update.mjs --force`);
      steps.push({ cmd: "https_proxy=127.0.0.1:1 node scripts/check-update.mjs --force（强制离线）", out: r.stdout, status: r.status });
      const ok = r.status === 0 && /无法获取/.test(r.stdout) && /不阻塞/.test(r.stdout) && !/Error|throw/.test(r.stdout + r.stderr);
      return { pass: ok, notes: `exit=${r.status}；降级提示输出=${/无法获取/.test(r.stdout)}；无堆栈报错（永不阻塞契约）` };
    },
  },
  "14-git-dirty-refuse": {
    title: "--apply 拒绝脏 git 仓库",
    run(steps) {
      const headBefore = sh(`cd ${FIX}/git-install && git rev-parse HEAD`).stdout.trim();
      sh(`cd ${FIX}/git-install && git checkout -qb dirty-test && echo 'local edit' >> README.md`);
      steps.push({ cmd: "git checkout -b dirty-test && echo 'local edit' >> README.md（制造脏工作区）", out: sh(`cd ${FIX}/git-install && git status --porcelain`).stdout, status: 0 });
      const r = sh(`cd ${FIX}/git-install && node scripts/check-update.mjs --apply`);
      steps.push({ cmd: "node scripts/check-update.mjs --apply", out: r.stdout, status: r.status });
      const headAfter = sh(`cd ${FIX}/git-install && git rev-parse HEAD`).stdout.trim();
      steps.push({ cmd: "git rev-parse HEAD（核验未被强拉）", out: `before: ${headBefore}\nafter:  ${headAfter}`, status: 0 });
      const ok = r.status === 1 && /拒绝强拉/.test(r.stdout) && /README\.md/.test(r.stdout) && headBefore === headAfter;
      return { pass: ok, notes: `exit=${r.status}（期望 1）；拒绝强拉提示=${/拒绝强拉/.test(r.stdout)}；HEAD 未动=${headBefore === headAfter}` };
    },
  },
  "15-git-apply-ff": {
    title: "--apply 干净 git 安装：ff-only 成功 + 复检",
    run(steps) {
      sh(`rm -rf ${FIX}/remote.git ${FIX}/ff-install`);
      sh(`git clone -q --bare "${REPO}" ${FIX}/remote.git`);
      sh(`git -C ${FIX}/remote.git update-ref refs/heads/main refs/heads/wuzeru/skill-git-pull-zip`);
      sh(`git clone -q -b main ${FIX}/remote.git ${FIX}/ff-install`);
      sh(`cd ${FIX}/ff-install && git branch -u origin/main main
          cp "${TARGET}" scripts/check-update.mjs
          git -c user.email=t@t -c user.name=test add scripts/check-update.mjs
          git -c user.email=t@t -c user.name=test commit -qm "feat: check-update"
          echo marker > DUMMY.txt
          git -c user.email=t@t -c user.name=test add DUMMY.txt
          git -c user.email=t@t -c user.name=test commit -qm "chore: dummy release"
          git push -q origin main:main
          git reset -q --hard origin/main~1`);
      const behind = sh(`cd ${FIX}/ff-install && git rev-list --count main..origin/main`).stdout.trim();
      steps.push({ cmd: "裸仓模拟远端 + 安装目录 reset 到落后 1 提交（树干净、脚本已追踪）", out: `behind origin/main by ${behind} commit(s)\n${sh(`cd ${FIX}/ff-install && git status --porcelain`).stdout || "(工作树干净)"}`, status: 0 });
      const r = sh(`cd ${FIX}/ff-install && node scripts/check-update.mjs --apply`, { timeout: 240000 });
      steps.push({ cmd: "node scripts/check-update.mjs --apply", out: r.stdout, status: r.status });
      const headAfter = sh(`cd ${FIX}/ff-install && git rev-parse HEAD`).stdout.trim();
      const remoteHead = sh(`git -C ${FIX}/remote.git rev-parse main`).stdout.trim();
      const ok = r.status === 0
        && /git pull --ff-only 成功/.test(r.stdout)
        && /环境依赖齐全/.test(r.stdout)
        && headAfter === remoteHead;
      return { pass: ok, notes: `exit=${r.status}；ff-only 成功=${/ff-only 成功/.test(r.stdout)}；check-env 复检=${/环境依赖齐全/.test(r.stdout)}；HEAD 已前进到远端最新=${headAfter === remoteHead}` };
    },
  },
  "16-zip-apply": {
    title: "--apply zip 安装：覆盖保持根级布局",
    run(steps) {
      sh(`rm -rf ${FIX}/zip-install && mkdir -p ${FIX}/zip-install/scripts ${FIX}/zip-install/docs`);
      sh(`cd ${FIX}/zip-install
          echo "v0.0.5 abc1234 2026-08-01T00:00:00Z" > VERSION
          echo "# local skill" > SKILL.md
          echo "user local notes" > MY-NOTES.md
          echo "report" > docs/report.html
          cp "${TARGET}" scripts/check-update.mjs
          cp "${REPO}/scripts/check-env.mjs" scripts/check-env.mjs`);
      steps.push({ cmd: "搭 zip 形态安装：VERSION=v0.0.5、无 .git、含本地附加文件 MY-NOTES.md", out: sh(`ls ${FIX}/zip-install`).stdout, status: 0 });
      const r = sh(`cd ${FIX}/zip-install && node scripts/check-update.mjs --apply`, { timeout: 300000 });
      steps.push({ cmd: "node scripts/check-update.mjs --apply", out: r.stdout, status: r.status });
      const version = sh(`cat ${FIX}/zip-install/VERSION`).stdout.trim();
      const noClaude = !fs.existsSync(path.join(FIX, "zip-install/CLAUDE.md"));
      const notesKept = sh(`cat ${FIX}/zip-install/MY-NOTES.md`).stdout.trim() === "user local notes";
      steps.push({ cmd: "核验：VERSION / CLAUDE.md / 本地附加文件", out: `VERSION: ${version}\nCLAUDE.md 存在: ${!noClaude}\nMY-NOTES.md 保留: ${notesKept}`, status: 0 });
      const ok = r.status === 0
        && /^v0\.0\.7/.test(version)
        && noClaude
        && notesKept
        && /已覆盖安装/.test(r.stdout)
        && /环境依赖齐全/.test(r.stdout);
      return { pass: ok, notes: `exit=${r.status}；VERSION=${version}；无 CLAUDE.md=${noClaude}；本地附加文件保留=${notesKept}；check-env 复检=${/环境依赖齐全/.test(r.stdout)}` };
    },
  },
  "17-update-route": {
    title: "/tple-skill update 路由：落后直接执行更新",
    run(steps) {
      // fixture：裸仓远端钉在 v0.0.5；安装目录 main=v0.0.5，脚本入库推远端后 reset 回退 → 落后 1 提交、树干净、脚本已追踪
      sh(`rm -rf ${FIX}/route.git ${FIX}/route-install`);
      sh(`git clone -q --bare "${REPO}" ${FIX}/route.git`);
      sh(`git -C ${FIX}/route.git update-ref refs/heads/main refs/tags/v0.0.5`);
      sh(`git clone -q -b main ${FIX}/route.git ${FIX}/route-install`);
      // 两个提交再回退一个：脚本保持已追踪（reset 后仍在工作树），同时落后远端 1 提交可 ff
      sh(`cd ${FIX}/route-install && git branch -u origin/main main
          cp "${TARGET}" scripts/check-update.mjs
          git -c user.email=t@t -c user.name=test add scripts/check-update.mjs
          git -c user.email=t@t -c user.name=test commit -qm "feat: check-update"
          echo marker > DUMMY.txt
          git -c user.email=t@t -c user.name=test add DUMMY.txt
          git -c user.email=t@t -c user.name=test commit -qm "chore: dummy"
          git push -q origin main:main
          git reset -q --hard origin/main~1`);
      const behind = sh(`cd ${FIX}/route-install && git rev-list --count main..origin/main`).stdout.trim();
      const curVer = sh(`cd ${FIX}/route-install && git describe --tags`).stdout.trim();
      steps.push({ cmd: "fixture：裸仓远端钉 v0.0.5，安装目录落后 1 提交（脚本已追踪、树干净）", out: `当前 ${curVer}，behind origin/main by ${behind} commit(s)\n${sh(`cd ${FIX}/route-install && git status --porcelain`).stdout || "(工作树干净)"}`, status: 0 });
      // 路由第一步：ARGUMENTS=update → check-update --force（绕过缓存拿真实最新版）
      const s1 = sh(`cd ${FIX}/route-install && node scripts/check-update.mjs --force`);
      steps.push({ cmd: "① 路由：check-update.mjs --force（自检）", out: s1.stdout, status: s1.status });
      const s1ok = s1.status === 0 && /v0\.0\.5/.test(s1.stdout) && /v0\.0\.7/.test(s1.stdout) && /落后/.test(s1.stdout) && /·/.test(s1.stdout);
      // 路由第二步：落后 → 直接执行 --apply（update 调用本身即意图，不二次确认）
      const s2 = sh(`cd ${FIX}/route-install && node scripts/check-update.mjs --apply`, { timeout: 240000 });
      steps.push({ cmd: "② 路由：落后 → 直接 check-update.mjs --apply（不再二次确认）", out: s2.stdout, status: s2.status });
      const headAfter = sh(`cd ${FIX}/route-install && git rev-parse HEAD`).stdout.trim();
      const remoteHead = sh(`git -C ${FIX}/route.git rev-parse main`).stdout.trim();
      steps.push({ cmd: "git rev-parse HEAD（外部核验已更新到远端最新）", out: `after:  ${headAfter}\nremote: ${remoteHead}`, status: 0 });
      const s2ok = s2.status === 0 && /git pull --ff-only 成功/.test(s2.stdout) && /环境依赖齐全/.test(s2.stdout) && headAfter === remoteHead;
      const ok = s1ok && s2ok;
      return { pass: ok, notes: `①自检 exit=${s1.status} 报落后+摘要=${s1ok}；②apply exit=${s2.status} ff-only+复检=${/ff-only 成功/.test(s2.stdout)}；HEAD 前进到远端最新=${headAfter === remoteHead}` };
    },
  },
};

// ---- 主流程 ----
let pass = 0, fail = 0;
for (const [id, c] of Object.entries(CASES)) {
  if (ONLY.size && !ONLY.has(id.split("-")[0]) && !ONLY.has(id)) continue;
  console.log(`\n=== ${id} ${c.title} ===`);
  const steps = [];
  let result;
  try {
    result = c.run(steps);
  } catch (e) {
    result = { pass: false, notes: `执行异常: ${String(e).slice(0, 200)}` };
    steps.push({ cmd: "(异常)", out: String(e), status: 1 });
  }
  const rec = recordCase(id, c.title, steps);
  const status = result.pass ? "PASS" : "FAIL";
  if (result.pass) pass++; else fail++;
  logCase(id, c.title, status, `${result.notes}；录屏：${rec.mode === "native" ? `原生 record ${rec.dur.toFixed(1)}s` : `分镜回退 ${rec.dur.toFixed(1)}s`}（终端实况回放：命令真跑、输出真捕获）`);
  console.log(`  → ${status}: ${result.notes}`);
}
console.log(`\n完成：${pass} PASS / ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
