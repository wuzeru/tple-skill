# tple-skill — 参考实现

## meta.jsonl

每行一条，管道分隔：

```
01-login|登录成功进入工作台|PASS|可见侧栏「新建任务」
02-db-validation|数据库 Dialog 必填校验|FAIL|未见校验文案
07-authgate-retry|AuthGate 连接失败可重试|BLOCKED|找不到 api pid
```

status 仅用：`PASS` | `FAIL` | `BLOCKED`。

可选第 5、6 列：`lastRanAt|runCount`（优先仍读旁边的 `runs.json`）。

## runs.json

与 `meta.jsonl` 同目录。`logCase` 每次写入时累加：

```json
{
  "01-login": {
    "lastRanAt": "2026-08-02T13:04:12.000Z",
    "runCount": 3
  }
}
```

报告 case 头展示：`最后跑 2026-08-02 21:04 · 共跑 3 次`（Asia/Shanghai）。

## 关键帧放大

模板内建 lightbox：`.shot-zoom` 按钮包裹结束帧 / 失败帧；点击放大，Esc / 遮罩关闭。`build-report.mjs` 勿手写去掉该结构。

---

## 清理残留进程（录屏前必做）

```bash
pkill -f 'agent-browser-darwin-arm64' 2>/dev/null || true
pkill -f 'user-data-dir=.*/agent-browser-chrome-' 2>/dev/null || true
sleep 1.5
```

不清理时常见症状：`record stop` ~20s、`duration` ~1.0–1.3s、约 10–15 帧。  
清理后同脚本可稳定到 6–12s、`stop` ~200ms。

---

## 原生 record 成功契约

```
ensureLoggedIn / preparePage     # 录外
record start path.webm
writeToken + open url 一次       # record 刷新上下文
actions + agent-browser wait
wait 1500–2000                   # 结尾停顿
record stop
ffprobe duration → ≥4s 采用；否则分镜回退
```

```js
// 输入：禁止 Meta+a
ab(["fill", `@${ref}`, text]);
// 失败再 click + 设 value 并 dispatch input/change
```

环境变量：`WEB_URL` `API_URL` `LOGIN_NAME` `LOGIN_PASS` `CASE_LIMIT` `MIN_NATIVE_SEC`（默认 4）。

破坏性 case（停 API、network abort）必须 `try/finally` 或 `process.on("exit")` 恢复。

---

## 分镜回退（Node 片段）

仅当原生 `ffprobe` < `MIN_NATIVE_SEC` 时使用。

```js
const FRAME_HOLD_SEC = 1.6;

function buildSlideshow(name, frames, vidDir) {
  const listFile = `/tmp/e2e-concat-${name}.txt`;
  const lines = [];
  for (const f of frames) {
    lines.push(`file '${f.replaceAll("'", "'\\''")}'`);
    lines.push(`duration ${FRAME_HOLD_SEC}`);
  }
  lines.push(`file '${frames.at(-1).replaceAll("'", "'\\''")}'`);
  fs.writeFileSync(listFile, lines.join("\n") + "\n");

  const mp4 = path.join(vidDir, `${name}.mp4`);
  const webm = path.join(vidDir, `${name}.webm`);

  spawnSync("ffmpeg", [
    "-y", "-f", "concat", "-safe", "0", "-i", listFile,
    "-vf", "fps=10,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p",
    "-movflags", "+faststart", mp4,
  ], { stdio: "ignore" });

  spawnSync("ffmpeg", [
    "-y", "-i", mp4,
    "-c:v", "libvpx", "-b:v", "1M", "-auto-alt-ref", "0", webm,
  ], { stdio: "ignore" });
}
```

建议关键帧：进入页 → 操作中 → 结果态；失败路径多拍 `*-fail.png`。

---

## run-cases 结构建议

```
purgeAgentBrowser()
beginCase(id)          # purge + 新 session
ensureLoggedIn()       # 录外；缓存 token
preparePage(url)       # 录外
record start webm
resume: token + open
actions() + shot("end") + dwell(2000)
record stop → ffprobe → native or slideshow
close + logCase
```

### logCase 标准实现（必须包含，禁止用简化版 writeMeta 替代）

生成 `run-cases.mjs` 时**必须**包含以下 `logCase` 函数，同时写 `meta.jsonl` 和 `runs.json`：

```js
const META  = path.join(OUT, "meta.jsonl");
const RUNS  = path.join(OUT, "runs.json");

function logCase(id, title, status, notes) {
  // 1. meta.jsonl — 追加一行
  fs.appendFileSync(META, `${id}|${title}|${status}|${notes}\n`);

  // 2. runs.json — 累加 runCount + 更新 lastRanAt
  let runs = {};
  try { runs = JSON.parse(fs.readFileSync(RUNS, "utf8")); } catch { runs = {}; }
  const prev = runs[id] || { runCount: 0 };
  runs[id] = {
    lastRanAt: new Date().toISOString(),
    runCount: Number(prev.runCount || 0) + 1,
  };
  fs.writeFileSync(RUNS, JSON.stringify(runs, null, 2));
}
```

**禁止**用只写 `meta.jsonl` 的 `writeMeta` / `logMeta` 等简化函数替代——报告依赖 `runs.json` 展示「最后跑时间 · 共跑 N 次」。

---

## HTML 报告（规范模板，勿另起炉灶）

视觉与 DOM 以 skill 内文件为准：

- `assets/report.css`
- `templates/report.html` / `templates/case-section.html`
- `design.md`（核对清单）
- `scripts/build-report.mjs`（推荐生成器）

```bash
node ~/.claude/skills/tple-skill/scripts/build-report.mjs \
  --dir ./docs/<slice>-e2e \
  --brand "Issue #N E2E" \
  --title "…" --h1 "…" --lede "…" \
  --env "环境 …" \
  --recording "录屏方式：agent-browser 原生 record（开跑前清理残留）；过短回退分镜。" \
  --cases ./docs/<slice>-e2e/cases.json
```

`cases.json`：`{ "01-login": { "uc", "steps", "expected" } }`。

---

## 校验命令

```bash
ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 videos/01-login.webm

ffprobe -v error -count_frames -select_streams v:0 \
  -show_entries stream=nb_read_frames -of default=nw=1:nk=1 videos/01-login.webm

kill -CONT "$(lsof -tiTCP:<api-port> -sTCP:LISTEN | head -1)" 2>/dev/null
```

---

## auto-fix loop 参考实现

### 循环伪代码

```js
let round = 0;
const MAX_ROUNDS = 3;
let failedIds = parseFails(metaPath); // ["02-xxx", "05-yyy"]

while (failedIds.length > 0 && round < MAX_ROUNDS) {
  round++;
  const roundLog = [];

  for (const id of failedIds) {
    // 1. 证据采集
    const evidence = {
      stderr: getCaseStderr(id),
      failPng: exists(`videos/${id}-fail.png`) ? readImg(...) : null,
      lastFrame: ffmpegExtractLastFrame(`videos/${id}.mp4`),
      snapshot: agentBrowserSnapshot(),
      expected: cases[id].expected,
    };

    // 2. 分析根因（Claude 自己做，不需要外部 API）
    const analysis = analyzeFailure(evidence);

    // 3. 改代码（Edit/Write 工具直接操作项目文件）
    const changes = applyFix(analysis);

    // 4. 记录
    roundLog.push({ id, round, files: changes.files, change: changes.summary });
    cases[id].fixLog = cases[id].fixLog || [];
    cases[id].fixLog.push(roundLog.at(-1));
  }

  // 5. 重启 dev server（如果项目有 hot reload 则可跳过）
  if (needsRestart) restartDevServer();

  // 6. 仅重跑本轮改过的 FAIL case
  await rerunCases(failedIds);

  // 7. 检查进展
  const newFailed = parseFails(metaPath);
  const stagnant = failedIds.filter(id =>
    newFailed.includes(id) &&
    getNotes(id) === getPrevNotes(id) // notes 没变 = 没进展
  );
  // 连续 2 轮无进展 → BLOCKED
  for (const id of stagnant) {
    if (stagnantHistory.get(id) >= 1) setStatus(id, "BLOCKED");
    else stagnantHistory.set(id, (stagnantHistory.get(id) || 0) + 1);
  }

  failedIds = parseFails(metaPath).filter(id => getStatus(id) !== "BLOCKED");
}
```

### 证据采集优先级

1. `agent-browser` stderr/stdout（selector not found / timeout / console error）
2. `videos/{id}-fail.png`（FAIL 时主动 screenshot 的中间态）
3. 视频末帧：`ffmpeg -sseof -1 -i videos/{id}.mp4 -frames:v 1 -y tmp/{id}-last.png`
4. FAIL 时的 a11y snapshot（`agent-browser snapshot -i`）
5. case 的 `expected` vs 实际页面内容 diff

### 刹车条件

| 条件 | 处理 |
|------|------|
| round >= 3 | 停止循环，保留 FAIL，报告写「尝试 3 轮未修复」 |
| 同一 case 连续 2 轮 notes 无变化 | 标 BLOCKED，从 failedIds 移除 |
| 单轮修复改动 > 5 个文件 | 停止，向用户确认 |
| 修复过程产生新文件 > 3 个 | 停止，向用户确认 |

### fixLog 写入格式

`meta.jsonl` notes 字段：
```
02-xxx|标题|PASS|修复 2 轮: R1=button selector 改为 data-testid, R2=补 onSubmit 校验
```

`cases.json` 修复字段（报告会渲染「Bug 点 / 修复方案」）：
```json
{
  "02-xxx": {
    "uc": "UC-5",
    "steps": "...",
    "expected": "...",
    "bug": "汇总：最初失败现象",
    "fix": "汇总：最终怎么修好的",
    "fixLog": [
      {
        "round": 1,
        "bug": "本轮看到的问题",
        "fix": "本轮改法",
        "files": ["src/Dialog.tsx"]
      },
      {
        "round": 2,
        "bug": "…",
        "fix": "…",
        "files": ["src/Dialog.tsx", "src/validate.ts"],
        "change": "旧字段，等同 fix"
      }
    ]
  }
}
```

---

## 与 Issue #27 实例对照

仓库示例路径：`docs/issue27-e2e/`

| 脚本 | 职责 |
|------|------|
| `run-cases.mjs` | 9 case：原生 record + 过短分镜回退 + meta |
| `cases.json` | uc / steps / expected |
| `videos/` | 媒体 |
| `index.html` | 用 tple-skill `build-report.mjs` 生成 |

实测：清理进程后 01–06、08 原生约 6–12s；07（AuthGate STOP）与 09（375 viewport）可能仍短并走分镜回退。
