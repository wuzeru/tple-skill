# tple-skill — 参考实现

## agent-browser 最小命令速查（先看这里，别猜）

```bash
agent-browser open <url>          # 导航
agent-browser snapshot -i         # a11y 树 + ref（@e1…）；页面一变 ref 即失效，重新 snapshot
agent-browser fill @e3 "文本"      # 输入（自带清空）；ref 来自上一次 snapshot
agent-browser click @e4           # 点击 ref（不自动滚动：视口外先 scrollintoview）
agent-browser wait 1500           # 等待毫秒（录屏中唯一允许的等待方式）
agent-browser eval "<js>"         # 执行 JS；JS 一律双引号包裹，内部字符串用单引号
agent-browser get url             # 当前 URL
agent-browser get text body       # 页面文本（注意：没有裸 `body` 命令）
agent-browser get count ".item"   # 元素计数
agent-browser screenshot out.png  # 截图
agent-browser record start x.webm / record stop
agent-browser close --all         # 关闭所有 session
agent-browser dashboard start     # 起观测仪表盘 :4848（套件开始前必做；幂等）
agent-browser dashboard stop      # 套件结束后关（幂等，不影响普通命令）
```

四条最贵的教训：

- **`@` 前缀只配 ref（`@e3`），CSS 选择器直接写**：`click button[data-testid="x"]` 可以，`click @button[...]` 必失败。
- **`eval` 的 JS 必须双引号包裹**：`agent-browser eval "localStorage.setItem('token','x')"`；外层用单引号或不加引号，括号会被 shell 吃掉报 `syntax error near unexpected token '('`。
- **断言数据拿不到 ≠ 断言通过**：`eval`/`get` 返回连接错误（如 `Failed to connect`）时，判 BLOCKED 或重试，绝不能按「无变化」判 PASS（曾把连接失败误判成「空标题被拦截」的假阳性）。
- **CSS 选择器 click 会在部分页面静默落空**（0.26.0 实测：the-internet 的 add_remove 页，`click "button[onclick=...]"` 返回 `✓ Done` 但 DOM 不变，连 JS `.click()` 都不触发 inline onclick）。优先 snapshot ref 点击；CSS 点击后效果验证不过就改 ref 重试，别先怀疑页面/风控。
- **录中 `open`（整页导航）会断帧捕获**（0.26.0）：见下方「原生 record 成功契约」。

完整版：`agent-browser skills get core --full`（与 CLI 版本匹配，优先于凭记忆猜命令）。

## meta.jsonl

每行一条，管道分隔：

```
01-login|登录成功进入工作台|PASS|可见侧栏「新建任务」
02-db-validation|数据库 Dialog 必填校验|FAIL|未见校验文案
07-authgate-retry|AuthGate 连接失败可重试|BLOCKED|找不到 api pid
```

**一行一记录是硬约束**：notes 来自命令 stderr 时常带换行，写前必须清洗——换行折叠成空格、`|` 替换、截断到 ~300 字符。否则碎片行混入 meta.jsonl，报告生成与解析全乱。

status 仅用：`PASS` | `FAIL` | `BLOCKED`（调研模式另允许 `OBSERVE`，见下「调研模式」章节）。

调研模式 OBSERVE 示例（观察项，不是对错判定）：

```
05-pricing|定价页信息完整度|OBSERVE|亮点：三档定价对比清晰；疑点：未展示退款政策
```

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

## 清理残留进程（录屏前必做，跨平台）

agent-browser 全平台可用（包内自带 darwin / linux / win32 二进制）。清理分两步：先关 session，再按平台杀残留 Chrome（只杀带 agent-browser user-data-dir 特征的进程，勿伤用户日常浏览器；两类特征都要匹配——`agent-browser-chrome-`，以及 `--profile <名字>` 复制出的 `agent-browser-profile-`）：

```bash
# 全平台
agent-browser close --all 2>/dev/null || true   # 先关 daemon 持有的 session

# macOS / Linux（两个特征都要杀：--profile 复制出的 profile 目录是 agent-browser-profile-*，
# 不带 agent-browser-chrome- 前缀，漏杀会残留）
pkill -f 'user-data-dir=.*/agent-browser-chrome-' 2>/dev/null || true
pkill -f 'user-data-dir=.*/agent-browser-profile-' 2>/dev/null || true
sleep 1.5
```

```powershell
# Windows（PowerShell）：两类 user-data-dir 特征都按命令行匹配
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -like '*agent-browser-chrome-*' -or $_.CommandLine -like '*agent-browser-profile-*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
```

**必须先 `close --all` 再杀进程**：daemon 可能残留指向别的项目页面的 session（实测曾串到 localhost:5173 的其他 dev server，造成整轮假 FAIL）。只杀进程不关 session 不够。

---

## 登录态决策（选项 A / B 实现参考）

SKILL.md Step 2.5 的展开：检测到需登录 → 暂停 → 问用户选哪条路。决策伪代码：

```
if 出现登录墙 / 关键路径 401/403 / case 依赖登录态:
    停下，把检测信号 + 四个选项（A 复用 profile / B headed 手动登录 / 提供凭据 / 公开路径）发给用户
    按用户所选执行（调研模式下用户不选且无凭据 → 公开路径 + 标注未登录态）
```

### 选项 A：复用本地 Chrome profile 登录态

**1) 列出本地 profile 供用户选：**

```bash
agent-browser profiles            # 人类可读：目录名 (显示名)
agent-browser profiles --json     # 机器可读；传错名字给 --profile 也会报错列出全部
```

备用（agent-browser 不可用时读 `Local State`，macOS）：

```bash
python3 -c "import json,os;d=json.load(open(os.path.expanduser(\"~/Library/Application Support/Google/Chrome/Local State\")))[\"profile\"][\"info_cache\"];[print(k,\"→\",v[\"name\"]) for k,v in d.items()]"
```

名字解析规则：**目录名精确匹配优先**（如 `Profile 1`），其次**显示名忽略大小写匹配**（如 `working`）；多个显示名撞车会报错要求用目录名。

**2) 用户选定后启动（macOS 关键：必须 `--executable-path` 指向系统真实 Chrome）：**

```bash
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"   # 按平台替换
agent-browser --session tple --profile "working" --executable-path "$CHROME" open <目标站登录后的页面>
```

**为什么必须 `--executable-path`（实测，0.26.0 macOS）**：`--profile <名字>` 会把所选 profile **复制到临时目录**（`$TMPDIR/agent-browser-profile-*`）再启动，不占用户正在用的 Chrome 的锁——这部分无需退出 Chrome，机制正确。但 agent-browser 默认启动的是自带的 **Chrome for Testing**：

| 二进制 | macOS Keychain 加密项 |
|---|---|
| 真实 Google Chrome | `Chrome Safe Storage` |
| Chrome for Testing（agent-browser 默认） | `Chromium Safe Storage` |

macOS 上 cookie 值用 Keychain 密钥加密（`v10` 前缀）。真实 Chrome profile 的 cookie 是用 `Chrome Safe Storage` 的密钥封的；Chrome for Testing 拿 `Chromium Safe Storage` 的密钥去解，全部失败、cookie 被静默丢弃——**启动成功、不报错，但登录态全丢**（实测：复制出的 Cookies DB 里有完整的 github `user_session`/`logged_in` 行，浏览器里却读不到；上游已确认为 vercel-labs/agent-browser#1502）。改用系统 Chrome 可执行路径后登录态完整继承（实测 github `user-login` 正确显示）。

**3) 验证登录态再续跑**（别信「应该登录了」）：

```bash
agent-browser --session tple --profile "working" --executable-path "$CHROME" eval "document.querySelector('meta[name=user-login]')?.content"   # github 例
# 或查登录态 cookie / 页面用户头像元素 / get url 是否不再重定向到登录页
```

**4) flag 纪律**：`--profile`（+ `--executable-path`）**每条命令都要带**——daemon 按命令参数决定浏览器启动方式，漏带一条命令就会以无登录态的默认 session 执行。run-cases.mjs 里把它们放进统一的命令构造器。

### 选项 B：headed 引导手动登录

**已实测**（captcha fixture :4175，图形验证码登录页）：headed 弹窗 → 人工过验证码+登录 → 轮询 3s 命中 → 跨会话登录态保持，整条链路可用。

```bash
PROF="$TMPDIR/tple-manual-login-profile"   # 独立临时目录，勿复用用户真实 Chrome 目录
mkdir -p "$PROF"
agent-browser --session tple --headed --profile "$PROF" open <目标站登录页>
# 提示用户在弹出的窗口里手动完成登录（含 2FA/SSO/人机验证）；登录完成前轮询等待
# （实测 get url 是最快信号——URL 跳转先于页面渲染完成；不要用 wait <selector>，
#  本 skill 约定 wait 只接毫秒数）：
for i in $(seq 1 60); do
  url=$(agent-browser --session tple get url 2>/dev/null | head -1)
  case "$url" in */app*|*/dashboard*) break;; esac   # 换成目标站的登录后 URL 特征
  sleep 3
done
# URL 命中后再用页面内信号复核（get count 登录态元素 / cookies get 会话 cookie），双确认才续跑
# 验证通过后，后续 case 继续带 --profile "$PROF" 续跑原流程
```

跨步骤保持（实测确认）：登录态写入该 `--profile` 目录，`close` 后**新 session 挂同一目录即复用**（目录路径模式不经过 Keychain 加解密差异，同产品持久化）。需要导出时用 `state save/load`（**仅限单浏览器/单 profile 场景**，见下对照表）。

### 选项 C：连接用户真实浏览器（人机检测 / 需要人在场操作的场景）

**适用**：登录/生成路径被**人机检测门闩**拦死（Cloudflare turnstile、hCaptcha 等，自动化不能也不应绕过），需要人在浏览器里手动完成，agent 随后在**同一浏览器上下文**续操作。

**连接方式（0.26.0 实测）**：Chrome M136+ 下 `--auto-connect` / `--cdp <port>` **发现不了**已开的 CDP 端口（DevToolsActivePort 不再写入，上游 vercel-labs/agent-browser#1321）；且 `--auto-connect` 每次失败都会触发「自动拉起浏览器」→ macOS 反复弹权限确认框。**唯一可靠的接入方式是显式 `connect <ws-url>`**：

```bash
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
# 1) 起带调试端口的 Chrome（独立临时 profile，勿动用户日常 Chrome）
"$CHROME" --remote-debugging-port=9222 --user-data-dir="$TMPDIR/tple-cdp-profile" \
  --no-first-run --no-default-browser-check "$URL" &

# 2) 预检（preflight）：一次普通调用完成权限握手，再进主流程
WS=$(curl -s http://localhost:9222/json/version | python3 -c "import json,sys;print(json.load(sys.stdin)['webSocketDebuggerUrl'])")
agent-browser --session tple connect "$WS"          # 首次连接：Chrome 弹「允许远程控制」，用户确认一次，之后不再出现
agent-browser --session tple get url                # 验证连接可用

# 3) 预检通过后，才进主流程（轮询门闩状态、等用户手动操作、续跑 case）
```

**预检纪律（重要，实测教训）**：进入「用户真实浏览器」分支时，**必须先做这一次预检调用并停下等用户确认权限**（首次连接会弹「允许远程控制」，用户点允许；之后再连不再弹）。确认后再进录屏/轮询主流程。**严禁用 `--auto-connect` 重试循环等就绪**——它既发现不了 M136+ 端口，每次失败还自动拉起浏览器，造成权限确认框连弹（实测：20 次重试 = 20+ 次弹窗，直接打断用户操作）。预检通过后后续命令都走 `--session tple`（已连接的会话），不再触发弹窗。

### 方案对照表（为什么只推荐 A 的名字模式 + 真实 Chrome）

| 方式 | 行为 | 结论 |
|---|---|---|
| `--auto-connect` + `state save` | 连到带 CDP 端口的 Chrome，`Network.getAllCookies` 导出**所有 profile** 的 cookie 混合体 | ❌ 多 profile 场景同站点 cookie 互相覆盖，登录态归属不可控 |
| `--profile <目录路径>` 直接挂用户 Chrome 目录 | 运行中的 Chrome 独占 profile 锁 | ⚠️ 锁冲突风险 |
| `--profile <名字>`（默认 Chrome for Testing） | 复制到临时目录启动、无锁冲突，但 cookie 解不开 | ⚠️ 无锁但**登录态静默丢失**（Keychain 密钥不同） |
| `--profile <名字>` + `--executable-path <系统 Chrome>` | 复制到临时目录 + 用真实 Chrome 启动 | ✅ 推荐：无锁冲突，登录态完整继承（macOS 实测） |
| 选项 B 临时目录 profile + headed 手动登录 | 与真实 Chrome 无关，同产品加解密一致 | ✅ 推荐：2FA/SSO/人机验证场景（实测：验证码页手动登录 → 轮询命中 → 跨会话保持） |
| 选项 C：起带 CDP 端口 Chrome + `connect <ws-url>` | 先预检握手（首次弹「允许远程控制」，确认后不再弹），再进主流程 | ✅ 人机检测门闩场景（实测：接入成功 + 轮询实时看到门闩状态） |
| `--auto-connect` / `--cdp <port>` 发现连接 | M136+ 发现不了端口（无 DevToolsActivePort），每次失败还自动拉起浏览器 → 权限确认框连弹 | ❌ 勿用；改用显式 `connect <ws-url>` 预检 |

不清理时常见症状：`record stop` ~20s、`duration` ~1.0–1.3s、约 10–15 帧。  
清理后同脚本可稳定到 6–12s、`stop` ~200ms。

---

## 原生 record 成功契约（0.26.0 实测修订）

```
ensureLoggedIn / preparePage     # 录外：open + wait，页面完全就位
record start path.webm
writeToken（eval 写 localStorage）# ⚠️ 录中不要 open，会断帧捕获
actions（点击/填表；页间移动用 click 链接或 back）+ agent-browser wait
wait 1500–2000                   # 结尾停顿
record stop
ffprobe duration → ≥4s 且体积 ≥50KB 采用；否则按下方重试；仍短再分镜回退
```

⚠️ **0.26.0 录中 `open`（整页导航）会断帧捕获**：`record stop` 报 `No frames captured`，webm 时长看着正常、体积只有 ~15KB 级空壳。旧版「record start 后 open 一次」的写法在该版本必产出空视频。登录态写回用 `eval`，不用 `open` 刷新。

**短/空 webm 的处理顺序（别直接回退，也别直接放弃原生）：**

1. `record start` 前页面必须已渲染（open + wait 之后再 start）
2. webm < 4s 或体积异常小（如 ~20KB）→ **先清理残留进程（见上，含 `close --all`），重试一次原生**
3. 重试后仍短 → 分镜回退，并在 logCase notes 或日志里标明「分镜回退」


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
preparePage(url)       # 录外：open + wait，页面完全就位
record start webm
writeToken via eval    # ⚠️ 录中不 open（断帧）；页间移动用 click 链接 / back
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

## 依赖检查（跑套件前）

```bash
node ~/.claude/skills/tple-skill/scripts/check-env.mjs --url <WEB_URL>
# 调研模式：--url 直接指向公网目标，加 --mode research
node ~/.claude/skills/tple-skill/scripts/check-env.mjs --url https://example.com --mode research
```

检查 node ≥18、agent-browser、ffmpeg、ffprobe、目标 web 可达；全 ✓ 退出码 0，缺项退出码 1 并打印安装指引。`--mode research` 时 401/403 视为「可达但受限」（需登录/反爬），不当环境故障。

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

## 调研模式（只给 URL、无代码）

与验收模式共用同一套 run-cases / logCase / build-report 管道，差异集中在「case 来源、状态语义、无 auto-fix」：

### 探索巡检（case 草案之前，只读）

```bash
agent-browser open https://example.com
agent-browser snapshot -i        # 首页结构 + 入口 ref
agent-browser screenshot explore-home.png
agent-browser open https://example.com/pricing
agent-browser snapshot -i        # 逐关键落地页重复；每页访问一次即可（节流）
```

- 探索产出只用于总结 5–12 条草案；**用户确认前不录屏、不出报告**（门闩与验收模式一致）
- 用户给了调研重点 → 优先覆盖；其余保持基础覆盖
- 表单只填到提交前一步截图；真实提交/下单/删除需用户明示
- 401/403/验证码/付费墙 → 记 `BLOCKED` + 实际现象（不瞎猜、不绕反爬）

### status 语义对照

| 状态 | 验收模式 | 调研模式 |
|------|----------|----------|
| `PASS` | 期望达成 | 路径可走通、行为符合描述 |
| `FAIL` | bug，进 auto-fix | 调研发现：该路径走不通（notes 记原因），**不进 auto-fix** |
| `BLOCKED` | 环境拿不到证据 | 需人工/凭据/付费/反爬 |
| `OBSERVE` | —（不用） | 观察项：产品亮点/疑点，非对错判定 |

### 报告命令示例

```bash
node ~/.claude/skills/tple-skill/scripts/build-report.mjs \
  --dir docs/research-example.com \
  --brand "产品调研 · example.com" \
  --title "example.com 产品调研报告" \
  --h1 "example.com 产品调研" \
  --lede "来源：https://example.com · 覆盖注册流程与定价页 · 未登录态调研" \
  --env "目标 example.com · 未登录态" \
  --recording "录屏方式：agent-browser 原生 record（调研模式，只读探索）；过短回退分镜。" \
  --cases docs/research-example.com/cases.json
```

有 `OBSERVE` case 时报告自动追加 `OBSERVE N` chip（nav `.dot` / badge 同步青色系 `--observe`）。凭据不落报告正文：env 只写「账号：用户提供」。

## 与 Issue #27 实例对照

仓库示例路径：`docs/issue27-e2e/`

| 脚本 | 职责 |
|------|------|
| `run-cases.mjs` | 9 case：原生 record + 过短分镜回退 + meta |
| `cases.json` | uc / steps / expected |
| `videos/` | 媒体 |
| `index.html` | 用 tple-skill `build-report.mjs` 生成 |

实测：清理进程后 01–06、08 原生约 6–12s；07（AuthGate STOP）与 09（375 viewport）可能仍短并走分镜回退。
