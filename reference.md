# tple-skill — 参考实现

> **路径约定**：下文示例中的 `$SKILL_DIR` = 本 skill 的 SKILL.md 所在目录（随 agent 实际安装位置而定；是占位符不是环境变量，终端手动跑可 `cd` 到 skill 目录用相对路径），与 SKILL.md 开头的约定一致。
>
> **工作根 / 产物 / 记忆**（见 SKILL.md「工作根、项目记忆、产物目录」）：报告目录默认 `.tple/<slice>-e2e/`（或已约定的 `docs/<slice>-e2e/`）；项目记忆为工作根 `tple-memory.md`（编排开跑先读、可复用经验追加；站点业务断言不进 SKILL）。下文 `--dir docs/...` 示例与 `.tple/...` 等价，以实际报告目录为准。

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
agent-browser screenshot out.png  # 截图（决策点先看页面再动手，见「操作前双通道判断」）
agent-browser screenshot --annotate map.png  # 编号标签 [N] 对齐 @eN，给多模态模型看 canvas/自绘控件
agent-browser get box <sel>       # 元素包围盒（坐标点击用）
agent-browser mouse move <x> <y>  # CDP 可信鼠标事件（move / down / up）——自定义组件只认真实事件时的兜底
agent-browser mouse down / mouse up
agent-browser record start x.webm / record stop   # stop 幂等：无录制时返回 No recording in progress 不报错；每 case 开头防御性 stop 一次
# 以下三条禁止在 case/run-cases 手写——只经 tple-browser CLI：
#   close --all / dashboard start|stop / 特征 pkill
```

**语义化浏览器 API（强制）**：编排用 `scripts/tple-browser.mjs`；run-cases 用 `createBrowser`（见下「tple-browser」）。禁止 `spawnSync("agent-browser"`。

四条最贵的教训：

- **`@` 前缀只配 ref（`@e3`），CSS 选择器直接写**：`click button[data-testid="x"]` 可以，`click @button[...]` 必失败。
- **`eval` 的 JS 必须双引号包裹**：`agent-browser eval "localStorage.setItem('token','x')"`；外层用单引号或不加引号，括号会被 shell 吃掉报 `syntax error near unexpected token '('`。
- **断言数据拿不到 ≠ 断言通过**：`eval`/`get` 返回连接错误（如 `Failed to connect`）时，判 BLOCKED 或重试，绝不能按「无变化」判 PASS（曾把连接失败误判成「空标题被拦截」的假阳性）。
- **CSS 选择器 click 会在部分页面静默落空**（0.26.0 实测：the-internet 的 add_remove 页，`click "button[onclick=...]"` 返回 `✓ Done` 但 DOM 不变，连 JS `.click()` 都不触发 inline onclick）。优先 snapshot ref 点击；CSS 点击后效果验证不过就改 ref 重试，别先怀疑页面/风控。
- **录中 `open`（整页导航）会断帧捕获**（0.26.0）：见下方「原生 record 成功契约」。

完整版：`agent-browser skills get core --full`（与 CLI 版本匹配，优先于凭记忆猜命令）。

## 操作前双通道判断（screenshot + DOM）

CLI 自身不做视觉理解：`snapshot`/`click`/`fill` 走 a11y 树与选择器（确定、便宜），**视觉是给调用方（多模态模型）的证据层**。操作前把两条通道都拿上，综合判断再动手：

```bash
agent-browser screenshot before.png   # 视觉通道：布局/遮罩/loading/灰态/canvas 内容
agent-browser snapshot -i             # 结构通道：可操作元素 + @ref
# 综合判断：截图定「页面什么状态、哪里该点」，DOM 定「用哪个 ref 点」
agent-browser click @e5               # 动手
agent-browser screenshot after.png    # 或 get url / get text 验证效果（点击纪律）
```

规则：

- **决策点截，不逐操作截**：导航后、关键/破坏性操作前、DOM 与预期不符时。每张截图都是多模态 token + 时延，逐步全截既慢又贵；FAIL 取证截图已有约定，这里补的是「事前」半边。
- **冲突裁决**：信截图的可见性、信 DOM 的可操作性。典型：DOM 里有按钮但截图里被 modal/cookie 横幅盖住 → 先关遮罩再操作，不硬点 ref。
- **录屏契约不变**：判断性截图放 `record start` 之前；录中仍只做 click/fill/wait（截图时延会录进视频，见「原生 record 成功契约」）。
- **a11y 树看不透时升级 `--annotate`**（canvas、自绘组件、无名字图标按钮）：截图上打编号标签，`[N]` 一一对应 `@eN`，视觉判断直接映射回 DOM 操作。
- **坐标兜底**：`get box <sel>` 拿包围盒 + `mouse move <x> <y>` → `mouse down` → `mouse up`，DOM 与 annotate 都失效时的最后手段。**自定义组件只认真实鼠标事件的场景也用它**（实测：TikTok Symphony Creative Studio 的 Terms 弹窗 Accept 按钮，`KS-BUTTON`/`KS-MODAL` 自定义元素、class 含 `Ks*`，CSS/ref 点击与 JS `.click()` 全部静默无效——事件绑定校验 `isTrusted`）：`eval` 或 `get box` 拿按钮中心坐标 → `mouse move <x> <y>` → `mouse down` → `mouse up`（CDP 可信事件，一次成功）。点击纪律同前：点完验证效果，别信静默返回。

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

与 `meta.jsonl` 同目录。`logCase` 每次写入时累加 case 条目；整次 TPLE 会话的 token 用量写在顶层保留键 `usage`（可选）：

```json
{
  "usage": {
    "input": 12345,
    "output": 6789,
    "cacheRead": 1000,
    "total": 20134,
    "source": "transcript"
  },
  "01-login": {
    "lastRanAt": "2026-08-02T13:04:12.000Z",
    "runCount": 3
  }
}
```

- **case 条目**：报告 case 头展示 `最后跑 2026-08-02 21:04 · 共跑 3 次`（Asia/Shanghai）
- **`usage`（保留键，勿用作 case id）**：编排 + 全部 case subagent 会话合计用量，不是单个 case。由编排在出报告前写入：

  - 有数字：`{ input, output, cacheRead, total, source }`（至少 `total` + `source`）→ 报告头渲染用量行
  - 不支持 / 拿不到外部事实：`collect-usage` **不写** `usage`（若已有则删除）；报告头省略用量行（禁止编造、也不渲染「不支持」文案）
  - 老报告无 `usage` 字段：头部不渲染用量行（向后兼容）
- **`source`**：`ccusage` / `transcript` / `opencode-local` 等（有用量时）
- **采集降级**：ccusage → 本地账本 → 省略（禁止估算）

## commands.jsonl

与 `meta.jsonl` / `runs.json` 同目录。`tple-browser` 每执行一条 `agent-browser` 命令，就追加一行 JSON，供跨机器排障和审计。HTML 报告会在各 case 卡片中展示精简审计摘要（命令数、失败数、关键命令序列、脱敏状态与文件链接）；完整流水仍只保留在本文件，避免淹没 case 级叙事。

```json
{"ts":"2026-08-12T04:00:00.000Z","phase":"run","session":"01-login","argv":["--session","01-login","--args","--disable-session-crashed-bubble,--no-first-run,--no-default-browser-check,--headless=new,--hide-scrollbars","--headed","false","open","https://example.com"],"ok":true,"status":0,"durationMs":328,"out":"https://example.com","err":""}
```

- 字段：`ts`、`phase`（可用时）、`session`（可用时）、`argv`、`ok`、`status`、`durationMs`、`out`、`err`。
- `fill` 的值一律写为 `***`；可疑 `eval` 脚本会被整体打码。不要把凭据放进其他命令参数。
- `out` / `err` 会折叠换行并各截断到约 500 字符，避免 `snapshot -i` 等大输出膨胀报告目录。
- 日志写入失败会静默降级，绝不能改变浏览器命令本身的成功或失败结果。

出报告前：

```bash
node $SKILL_DIR/scripts/collect-usage.mjs --dir ./docs/<slice>-e2e
```

## 关键帧放大

模板内建 lightbox：`.shot-zoom` 按钮包裹结束帧 / 失败帧；点击放大，Esc / 遮罩关闭。`build-report.mjs` 勿手写去掉该结构。

---

## tple-browser（语义化套件 API，唯一合法路径）

状态文件：报告目录下 `.tple-browser.json`（`phase` / `loginMode` / `profile` / `executablePath`）。

### 编排 CLI

```bash
# 套件启动：close --all + 特征 pkill + dashboard start + 写状态
# mode=none → phase=run；reuse → phase=run（强制 profile+chrome）；manual → phase=login
node $SKILL_DIR/scripts/tple-browser.mjs suite-boot --dir docs/<slice>-e2e \
  --mode none|reuse|manual [--profile …] [--chrome …]

# 选项 B
node $SKILL_DIR/scripts/tple-browser.mjs login-open --dir … --url <登录页>
node $SKILL_DIR/scripts/tple-browser.mjs login-wait --dir … --ok-url-regex '\/app|\/dashboard'
node $SKILL_DIR/scripts/tple-browser.mjs login-done --dir …   # phase→run；关掉 headed；此后 headed 拒绝

# 套件结束
node $SKILL_DIR/scripts/tple-browser.mjs suite-teardown --dir …

node $SKILL_DIR/scripts/tple-browser.mjs status --dir …
# 探活（与 createBrowser.run 同门闩）
node $SKILL_DIR/scripts/tple-browser.mjs run --dir … --session probe -- get url
```

**仅 suite-boot / suite-teardown 可套件级清理**；禁止每个 case 前 purge。

### run-cases：createBrowser

```js
// 编排写 run-cases 时写入 skill 绝对路径；派发时 export TPLE_SKILL_DIR 供脚本/子进程使用
import { createBrowser } from "/ABS/tple-skill/scripts/lib/tple-browser.mjs";

const browser = createBrowser(import.meta.dirname); // 读同目录 .tple-browser.json
const r = browser.run(caseId, ["open", url]);       // 自动 --session + --profile
browser.run(caseId, ["snapshot", "-i"]);
browser.closeSession(caseId);
// browser.purge / closeAll / dashboard → throw
```

`record stop` 的「未在录制」返回在部分版本中是非零退出码；生成的 `run-cases.mjs` 必须用以下 helper，不能直接把 `browser.run(id, ["record", "stop"])` 包进通用失败守卫：

```js
function stopRecording(id) {
  const result = browser.run(id, ["record", "stop"]);
  const message = `${result.out}\n${result.err}`;

  if (result.ok || /No recording in progress/i.test(message)) {
    return;
  }
  throw new Error(`record stop 失败：${message}`);
}
```

每个原生录制 case 在 `record start` 前调用一次；录制结束也调用它。这样不会吞掉真实的 stop 错误，却能把「没有残留录制」当作预期状态继续执行。

派发前：`node $SKILL_DIR/scripts/check-run-cases.mjs --dir docs/<slice>-e2e`

### 清理残留（已封装，勿在 run-cases 复制）

`suite-boot` / `suite-teardown` 内部执行：`close --all` → 按平台杀 `agent-browser-chrome-` / `agent-browser-profile-` 特征进程 →（boot 时）`dashboard start` /（teardown 时）`dashboard stop`。

**必须先 `close --all` 再杀进程**：daemon 可能残留指向别的项目页面的 session。只杀进程不关 session 不够。

---

## 登录态决策（选项 A / B — 走 tple-browser）

SKILL.md Step 2.5 的展开：检测到需登录 → 暂停 → 问用户选哪条路。

```
if 出现登录墙 / 关键路径 401/403 / case 依赖登录态:
    停下，把检测信号 + 选项发给用户
    按用户所选执行 suite-boot / login-*（调研模式默认公开路径）
```

### 选项 A：复用本地 Chrome profile

```bash
agent-browser profiles            # 或 profiles --json
node $SKILL_DIR/scripts/tple-browser.mjs suite-boot --dir docs/<slice>-e2e \
  --mode reuse --profile "working" \
  --chrome "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
# phase=run；之后 createBrowser().run 自动注入 --profile + --executable-path
node $SKILL_DIR/scripts/tple-browser.mjs run --dir … --session probe -- get url
# 再用 eval / snapshot 验证登录态元素后再派发 case
```

**为什么必须系统 Chrome（`--chrome` / executable-path）**：`--profile <名字>` 会复制到 `$TMPDIR/agent-browser-profile-*`。默认 Chrome for Testing 用 `Chromium Safe Storage`，解不开真实 Chrome 的 `Chrome Safe Storage` v10 cookie → **静默丢登录态**（vercel-labs/agent-browser#1502）。

**同意状态重置**：每次以 profile **名**冷启会重新复制副本，Terms/Cookie 同意可能重置。有状态弹窗在同一实例内处理；不要遇阻就 suite 级重启。

### 选项 B：headed 引导手动登录

```bash
node $SKILL_DIR/scripts/tple-browser.mjs suite-boot --dir docs/<slice>-e2e --mode manual
# 默认 profile=<report>/chrome-profile
node $SKILL_DIR/scripts/tple-browser.mjs login-open --dir … --url <登录页>
# 用户在 headed 窗完成登录（2FA/SSO/验证码）
node $SKILL_DIR/scripts/tple-browser.mjs login-wait --dir … --ok-url-regex '\/app|\/home'
node $SKILL_DIR/scripts/tple-browser.mjs login-done --dir …
# 此后 case：无 headed、同 profile；login-open 再调会失败
```

跨 session 保持：登录态写在 `--profile` 目录；`closeSession` 后新 session 挂同一目录即复用。

### 选项 C：CDP 连接用户真实浏览器

`tple-browser --mode cdp` **本期未实现**（suite-boot 拒绝）。手工流程见下（仍须预检权限握手；禁止 `--auto-connect` 重试循环）。

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
record stop                      # 防御性：幂等，无录制时返回 No recording in progress 不报错
record start path.webm
restoreRecordingContextAuth      # 新录制 context：eval 写 localStorage / document.cookie → location.reload()
actions（点击/填表；页间移动用 click 链接或 back）
waitForCompletion(completionCheck, timeoutMs)
performVisiblePageChange          # 滚动、展开或其他无副作用交互
wait ≥3000                        # completionCheck 成立后展示结果；仍以 ffprobe 验收媒体门槛
record stop                       # 成功 / 超时均收尾落盘，非完成条件
ffprobe duration ≥4s 且帧数持续（-count_frames，≈10fps×秒数）采用；否则按下方重试；仍短再分镜回退
# ⚠️ 不用字节体积判健康：VP9 10fps 下 5s 干净录制仅 ~32KB；空壳真特征=时长正常但帧数极少
```

**防御性 `record stop`（每 case 开头必加）**：被用户中断的 `record start` 不会自动收尾，残留的录制状态会让下一次 `record start` 报 `Recording already active`，最终 `record stop` 产出上百秒的空壳长视频（实测 165.3s）。部分版本会以非零退出码返回 `No recording in progress`；必须通过上方 `stopRecording()` helper 将此特例视为成功，不能交给通用命令失败守卫。

⚠️ **0.26.0 录中 `open`（整页导航）会断帧捕获**：`record stop` 报 `No frames captured`，webm 时长看着正常、体积只有 ~15KB 级空壳。旧版「record start 后 open 一次」的写法在该版本必产出空视频。登录态恢复用 `eval`；仅“录制 context 初始化”可用 `location.reload()` 重载当前页面，不能改用 `open`。

**静态报告页必须制造可见的页面变化**：录制器按绘制帧采集，单纯 `wait` / `get text` 不会持续出帧。认证恢复后至少做一次用户可见的滚动、展开内容或无副作用的页面内交互，再展示结果至少 3 秒；仍须以 `ffprobe` 验收 4 秒媒体门槛，否则 WebM 可能只有初始的 1–2 帧。

### completionCheck：以页面行为决定下一步

每个 case 在编排写入 `run-cases.mjs` 时必须定义 `completionCheck`，并在录制中轮询。它必须是外部可观察事实，不是固定等待，例如：登录后的用户菜单、带 `session` 参数且已渲染关键区块的报告页、提交后的成功提示或新增列表项。

```js
function waitForCompletion(id, completionCheck, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = browser.run(id, ["eval", completionCheck]);
    if (result.ok && /\btrue\b/.test(result.out)) {
      return;
    }
    browser.run(id, ["wait", "250"]);
  }
  throw new Error("completionCheck 超时");
}

// 操作后：只在完成条件成立时才能判 PASS。
waitForCompletion(caseId, "location.search.includes('session=') && Boolean(document.querySelector('[data-report-ready]'))");
browser.run(caseId, ["wait", "1500"]);
stopRecording(caseId);
```

`completionCheck` 超时也必须调用 `stopRecording()`，以落盘失败证据；然后截图/读取页面实际状态，判 `FAIL` 或 `BLOCKED`。**不要**以“等了 N 秒”判 PASS，也不要让 `record stop` 充当完成条件。

### 录制 context 初始化（已登录 SPA / 报告页）

`record start` 创建 fresh browser context；即使录制前页面已登录，新的录制页也可能没有原 context 的 `localStorage` 或 JS 可读 cookie。若报告页依赖这些状态，编排在 `run-cases.mjs` 中为站点准备一个**不落盘**的初始化函数，并在 `record start` 后立即执行：

```js
function buildRecordingContextInitializer({ token, authStatus }) {
  return `(() => {
    localStorage.setItem('authing_token', ${JSON.stringify(token)});
    document.cookie = 'auth_status=' + encodeURIComponent(${JSON.stringify(authStatus)}) + '; Path=/; SameSite=Lax';
    localStorage.setItem('onboarding_dismissed', 'true');
    location.reload();
  })()`;
}

browser.run(caseId, ["record", "start", webm]);
browser.run(caseId, ["eval", buildRecordingContextInitializer(recordingAuth)]);
browser.run(caseId, ["wait", "1200"]);
```

- 初始化数据仅保存在运行时变量：不得写进 `meta.jsonl`、`cases.json`、截图、视频字幕或报告。
- `location.reload()` 必须保留当前带 session 参数的报告 URL；不要用 `open` 回到该 URL。
- 只恢复该站点实际需要、且页面 JS 可写的状态。`HttpOnly` cookie 不能通过 `document.cookie` 设置，必须改用已登录 profile 或正常登录流程。
- 初始化后重新读取页面文本或关键元素，确认仍在目标报告页；落到登录首页时判 `BLOCKED`，不要把未登录页面录为 PASS。

**短/断帧 webm 的处理顺序（别直接回退，也别直接放弃原生）：**

1. `record start` 前页面必须已渲染（open + wait 之后再 start）
2. webm < 4s 或**帧数寥寥**（`-count_frames` 实测，如 4s 却只有个位数帧）→ **先 `close` 本 case `--session` 后重试原生**（subagent 禁止 `close --all` / 全局 pkill；需套件级清理时回报编排）
3. 重试后仍短/断帧 → 分镜回退，并在 logCase notes 或日志里标明「分镜回退」

**为什么用帧数而不用体积判健康**（0.26.0 实测）：VP9 10fps 下 5s 的干净原生录制仅 ~32KB（1280 宽、画面近乎静止）。若沿用「体积 ≥50KB」阈值，会把**真实捕获**误判成空壳、白白降级成分镜。空壳/断帧的真特征是**时长看着正常但 `-count_frames` 解出的帧数极少**（如标称 30s 只有 ~15KB、十几帧）——帧数是唯一可靠的判据。

**录中点击回退：轮询 eval 点击（SPA 重挂载场景）**

`record start`（视口/焦点事件）会触发部分 SPA（React 等）重渲染、DOM 重建：录前 eval/snapshot 能定位的元素在录中「消失」，ref 几秒内过期，一次性 eval 落空（实测：录前能定位 3 个配置按钮，`record start` 后立刻 eval 全部落空，`record stop` 后又回来）。ref 点击录中失败时改用**轮询 eval 点击**等重挂载完成：

```bash
# 循环找元素并点击，等重挂载完成后点中（实测第 8~9 次命中，录到 9.6–16.4s 有效视频）
for i in $(seq 1 30); do
  ok=$(agent-browser --session tple eval "(() => { const el = document.querySelector('<selector>'); if (!el) return ''; el.click(); return 'ok'; })()")
  [ "$ok" = "ok" ] && break
  agent-browser --session tple wait 200
done
```

要点：这是**录中**允许的等待方式（`agent-browser wait`），别用 shell `sleep`；命中后照常做点击后效果验证；仍点不中再回基本事实（截图看状态），不要急着停录/重启。


```js
// 输入：禁止 Meta+a
ab(["fill", `@${ref}`, text]);
// 失败再 click + 设 value 并 dispatch input/change
```

环境变量：`WEB_URL` `API_URL` `LOGIN_NAME` `LOGIN_PASS` `CASE_ID` `MIN_NATIVE_SEC`（默认 4）。详见下文「编排与 case subagent」。

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

## 编排与 case subagent

TPLE **唯一**执行形态：编排 agent 锁定 `run-cases.mjs` → **串行**派发每 case 独立 subagent → 编排汇总与出报告。禁止主会话包办全部 case。

### `CASE_ID` 过滤（run-cases 必须支持）

```js
const CASE_ID = process.env.CASE_ID || "";
const selected = CASE_ID
  ? cases.filter((c) => c.id === CASE_ID)
  : []; // 无 CASE_ID 时不要在编排进程跑全量；全量只通过派发完成
if (!selected.length) {
  console.error(CASE_ID ? `unknown CASE_ID=${CASE_ID}` : "refuse full run without CASE_ID (orchestrator must dispatch subagents)");
  process.exit(1);
}
```

冒烟可用编排临时设 `CASE_ID` 自测单案脚本，但仍算「编排验证」，不是用主会话替代派发。

环境变量：`WEB_URL` `API_URL` `LOGIN_NAME` `LOGIN_PASS` `CASE_ID` `MIN_NATIVE_SEC`（默认 4）。（旧的 `CASE_LIMIT` 全量切片仅用于编排自检，正式套件用派发。）

### Subagent 提示词模板

```markdown
你是 TPLE case subagent。只做这一个 case。

- CASE_ID: <id>
- title: <title>
- steps / expected: …
- 报告目录: docs/<slice>-e2e/
- TPLE_SKILL_DIR: <skill 绝对路径>（环境变量已注入）
- 执行: `CASE_ID=<id> node docs/<slice>-e2e/run-cases.mjs`
- 浏览器：只用 createBrowser().run / closeSession；禁止裸 agent-browser、close --all、pkill、dashboard
- 禁止: 改 run-cases.mjs / cases.json、跑其他 case、build-report、collect-usage、改业务代码
- meta 必须经脚本 logCase 写成 `id|title|STATUS|notes` 一行
- 完成后打印: SUBAGENT_DONE <id> <PASS|FAIL|BLOCKED|OBSERVE>
```

### 套件级 vs case 级清理

| 动作 | 谁 |
|------|----|
| `tple-browser suite-boot` / `suite-teardown`（含 close --all、pkill、dashboard） | **仅编排** |
| `login-open` / `login-wait` / `login-done` | **仅编排** |
| `createBrowser().run` / `closeSession` | case subagent（经 run-cases） |
| `check-run-cases` | 编排（锁定后、派发前） |
| auto-fix 改代码 | 编排或单一 Fixer |
| `collect-usage` 合计 + `build-report` | 编排 |

### usage 多会话合计

出报告前把编排 session + 各 `tple-case-<id>` / 派发记录的 sessionId 的 input/output/cacheRead/total **相加**写入 `runs.json.usage`；`usage.note` 可列 session 列表。禁止只采「最后一个 session」。

---

## run-cases 结构建议

```
# 顶部：import createBrowser（禁止 spawnSync("agent-browser")）
const browser = createBrowser(import.meta.dirname)

# subagent 内：CASE_ID 已过滤到单案
stopRecording(id)                      # 防御性；无录制也继续
# ensureLoggedIn 若需写 token：browser.run(id, ["eval", "…"]) 录外
browser.run(id, ["open", url]); browser.run(id, ["wait", "2000"])  # 录外就位
browser.run(id, ["record", "start", webm])
# … click/fill/wait 仅经 browser.run；录中不 open
stopRecording(id)
# ffprobe → native or slideshow
browser.closeSession(id)              # 勿 close --all
logCase(…)
```

### logCase 标准实现（必须包含，禁止用简化版 writeMeta 替代）

生成 `run-cases.mjs` 时**必须**包含以下 `logCase` 函数，同时写 `meta.jsonl` 和 `runs.json`：

```js
const META  = path.join(OUT, "meta.jsonl");
const RUNS  = path.join(OUT, "runs.json");

function readRuns() {
  try { return JSON.parse(fs.readFileSync(RUNS, "utf8")); } catch { return {}; }
}

function logCase(id, title, status, notes) {
  // 1. meta.jsonl — 追加一行
  const clean = String(notes || "").replace(/\n/g, " ").replace(/\|/g, " ").slice(0, 300);
  fs.appendFileSync(META, `${id}|${title}|${status}|${clean}\n`);

  // 2. runs.json — 累加 runCount + 更新 lastRanAt（保留顶层 usage）
  const runs = readRuns();
  const prev = runs[id] || { runCount: 0 };
  runs[id] = {
    lastRanAt: new Date().toISOString(),
    runCount: Number(prev.runCount || 0) + 1,
  };
  fs.writeFileSync(RUNS, JSON.stringify(runs, null, 2));
}

/** 出报告前由编排写入多会话合计用量；优先 collect-usage / 手工合计。 */
function writeUsage(usage) {
  const runs = readRuns();
  runs.usage = usage;
  fs.writeFileSync(RUNS, JSON.stringify(runs, null, 2));
}
```

**禁止**用只写 `meta.jsonl` 的 `writeMeta` / `logMeta` 等简化函数替代——报告依赖 `runs.json` 展示「最后跑时间 · 共跑 N 次」。`logCase` 读写整文件时必须保留顶层 `usage`（上例已满足）。用量采集实现见 `scripts/lib/token-usage.mjs` / `scripts/collect-usage.mjs`。

---

## HTML 报告（规范模板，勿另起炉灶）

视觉与 DOM 以 skill 内文件为准：

- `assets/report.css`
- `templates/report.html` / `templates/case-section.html`
- `design.md`（核对清单）
- `scripts/build-report.mjs`（推荐生成器）

```bash
node $SKILL_DIR/scripts/build-report.mjs \
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
node $SKILL_DIR/scripts/check-env.mjs --url <WEB_URL>
# 调研模式：--url 直接指向公网目标，加 --mode research
node $SKILL_DIR/scripts/check-env.mjs --url https://example.com --mode research
```

检查 node ≥18、agent-browser、ffmpeg、ffprobe、**ccusage**、目标 web 可达；全 ✓ 退出码 0，缺项退出码 1 并打印安装指引。`--mode research` 时 401/403 视为「可达但受限」（需登录/反爬），不当环境故障。另输出软探测 `token-meter`（不阻断）：当前 agent 的用量采集路径或「不支持」。

```bash
node $SKILL_DIR/scripts/collect-usage.mjs --dir <report-dir>   # 出报告前写入 runs.json.usage
node $SKILL_DIR/scripts/collect-usage.mjs --probe              # 仅探测
```

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

### 探索巡检（case 草案之前）

```bash
agent-browser open https://example.com
agent-browser snapshot -i        # 首页结构 + 入口 ref
agent-browser screenshot explore-home.png
agent-browser open https://example.com/pricing
agent-browser snapshot -i        # 逐关键落地页重复；每页访问一次即可（节流）
```

- 探索产出只用于总结 5–12 条草案（核心功能占多数）；**用户确认前不录屏、不出报告**（门闩与验收模式一致）
- 用户给了调研重点 → 优先覆盖；其余保持基础覆盖
- 核心功能（创建/编辑/生成）默认实际走一遍并记录交付结果；真实支付/下单/删除/对外发送需用户明示，未明示的表单只填到提交前一步截图
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
node $SKILL_DIR/scripts/build-report.mjs \
  --dir docs/research-example.com \
  --brand "产品调研 · example.com" \
  --title "example.com 产品调研报告" \
  --h1 "example.com 产品调研" \
  --lede "来源：https://example.com · 覆盖注册流程与定价页 · 未登录态调研" \
  --env "目标 example.com · 未登录态" \
  --recording "录屏方式：agent-browser 原生 record（调研模式，实际走核心功能）；过短回退分镜。" \
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
