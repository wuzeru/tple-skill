---
name: tple-skill
description: >-
  TPLE：按 case 做端到端验收——agent-browser 原生 record 录屏（残留进程需先清理），
  过短则回退分镜截图，再生成按 case 分区的 HTML 验收报告（含视频/截图/PASS|FAIL|BLOCKED）。
  也支持产品调研模式：只给网址、无代码，探索站点出 case 草案，逐 case 录屏产出调研报告。
  Use when the user asks for tple-skill, TPLE, E2E 录屏验收、按 case HTML 报告、
  issue 验收录屏、端到端 HTML report with video, or per-case acceptance evidence;
  also for 产品调研、竞品调研、研究/看看这个产品、只给 URL 的调研验收。
---

# tple-skill（TPLE）

把「功能切片 / Issue」做成**可打开的 HTML 验收包**：每个 case 一段视频 + 截图 + 步骤/期望/结果。

定位：不做 checklist + 截图 markdown 式验收，而是交付**带媒体的按 case 验收站**。

两种模式：

- **验收模式**（默认）：有代码、有仓库，按 case 录屏验收，FAIL 走 auto-fix 改代码重测。
- **调研模式**（产品调研）：只给网址、无代码，agent 探索站点后出 case 草案，逐 case 录屏产出**调研报告**。**禁止修改目标站任何东西**；走不通的路径记为发现/限制，不进 auto-fix。模式判定见 Step 0。

## 交付物

```
docs/user-cases.csv               # 无表时：确认后新建；有表则筛选/回写 status
docs/<slice>-e2e/                 # 或仓库约定目录
  index.html                      # 主报告（侧栏导航 + 每 case 区块）
  meta.jsonl                      # id|title|status|notes
  runs.json                       # { id: { lastRanAt, runCount } } 每 case 最后跑时间与次数
  cases.json                      # 报告文案（可由 csv 生成）
  videos/
    01-xxx.mp4 / .webm / .png     # 每 case 视频 + 结束帧
    01-xxx-fail.png               # 可选中间失败态
```

聊天里只回：报告路径、PASS/FAIL 汇总、异常 case。

## 流程总览

```
Task Progress:
- [ ] 0. 模式判定：验收模式（默认）/ 调研模式（见下）
- [ ] 1. 定 case 清单（有 csv 就筛；没有则按项目总结草案 → 用户确认 → 落盘 csv）
- [ ] 2. 起环境、确认端口，并清理残留 agent-browser
- [ ] 3. 写 run-cases（原生 record 为主；过短回退分镜）
- [ ] 4. 跑全量，写 meta.jsonl，用 ffprobe 验视频时长
- [ ] 5. auto-fix loop：FAIL case → 分析 → 改代码 → 重测（最多 3 轮）【仅验收模式】
- [ ] 6. build-report → index.html（必须用本 skill 模板）
- [ ] 7. 分发（直接打开本地报告，或自行托管/上传）
```

---

### 0. 模式判定（先判，再走流程）

| 信号 | 模式 |
|------|------|
| 有代码仓库 / 本地 dev server / issue 验收需求 | **验收模式**（默认） |
| 用户意图是「调研 / 研究 / 看看这个产品 / 竞品」+ 只给了 URL（无代码） | **调研模式** |
| 既没代码也没给 URL | 直接向用户要 URL，不要猜站点 |

**调研模式差异总览**（与验收模式逐项对照）：

| 维度 | 验收模式 | 调研模式 |
|------|----------|----------|
| case 来源 | 仓库 csv / Issue / diff 总结 | agent 自主探索站点（open + snapshot 巡检）后总结草案 |
| 环境 | 本地 dev server | 目标就是公网 URL，无需起服务 |
| auto-fix | FAIL → 改项目代码重测（Step 5） | **禁止改任何东西**；Step 5 整体跳过，FAIL 记为「调研发现/限制」 |
| 断言 | 对照 expected 判 PASS/FAIL | 「路径是否可走通、行为是否符合描述」；允许 OBSERVE 观察项 |
| 交付物 | 验收报告 | 调研报告（同模板）+ 可选「产品亮点/疑点」观察清单 |

调研模式专属流程见各步骤中带【调研模式】标注的段落；未标注的步骤两模式通用。

---

### 1. 定 case 清单

每个 case 固定字段：

| 字段 | 说明 |
|------|------|
| `id` | `01-login` 这类可排序 slug |
| `title` | 短标题 |
| `uc` | 用例号（如 UC-39），无则 `—` |
| `steps` | 人话步骤 |
| `expected` | 可观察期望 |
| `priority` | 优先 P0 |

#### Case 来源（按序）

1. **用户本次明示的清单**（聊天里已点名 UC / 验收点）— 可直接进入环境步骤；仍建议简短复述一眼确认  
2. **仓库内用例表**（有则读，按本次切片筛选）：
   - `docs/user-cases.csv`
   - 或同义路径：`docs/user_cases.csv`、`docs/usecases.csv`、`user-cases.csv`
3. **没有用例表时：先根据项目情况总结 user-case，再向用户确认（强制门闩）**

##### 无 `user-cases.csv` 时的总结与确认（不得跳过）

在写 `run-cases` / 开浏览器之前，必须先产出一份**待确认的 case 草案**，停下来等用户回复。

**总结依据（尽量都扫一遍，按项目实际有啥用啥）：**

- 产品/README：`README*`、`PRODUCT.md`、`CLAUDE.md`、`AGENTS.md` 中的产品定位与主路径  
- Issue / PR：`gh issue view`、`gh pr view`、验收标准 checklist、Summary  
- 代码与改动：`git diff <base>...HEAD`、关键路由/页面、本次修复点  
- 已有测试或文档：e2e 目录、`docs/**` 里的验收说明（若有）

**草案格式（发给用户 review）：**

```markdown
## 拟跑 TPLE cases（待确认）

来源：仓库无 user-cases.csv；依据 <Issue #N / README / 本分支 diff …>

| id | title | steps | expected | priority |
|----|-------|-------|----------|----------|
| 01-… | … | … | … | P0 |
| 02-… | … | … | … | P0 |

请确认：可直接开跑 / 要增删改哪几条？
```

**规则：**

- 总结 5–12 条可点验路径；过大则只保留本切片 / 本 PR 相关 P0  
- `uc`：无正式编号时用 `AC-1`… 或 `—`，**不要伪造仓库里不存在的 `UC-xx`**  
- **用户未确认前**：禁止跑全量 E2E、禁止生成最终 HTML 验收包  
- 用户确认（或给出修改）后：
  1. **落盘 CSV**（必须）：写入 `docs/user-cases.csv`（若无 `docs/` 则先建；表头与字段见下）  
  2. 同步生成报告用的 `cases.json`（可由 csv 导出或一并写出）  
  3. 再进入 Step 2  
- 报告 `lede` / `meta` 注明来源，例如：`来源：按项目文档与 Issue #N 总结，经用户确认后写入 docs/user-cases.csv`

**CSV 表头（保持不变）：**

```csv
id,module,title,precondition,steps,expected,priority,status,notes
```

确认后落盘时：`status` 初始为 `pending`；TPLE 跑完后再回写对应行为 `passed` / `failed`（与仓库用例惯例一致）。`module` 可按页面/能力归类（如 `auth`、`chat`）；缺前置条件则 `precondition` 留空或写「已启动本地环境」。

#### 【调研模式】case 草案 = 探索站点后总结（草案门闩同样不得跳过）

调研模式没有仓库可读，case 来源改为**agent 自主探索目标站点**：

1. **探索巡检**（只读，先于任何录屏）：`open` 目标 URL → 首页 `snapshot -i` + `screenshot` → 顺着导航/主入口逐个看关键落地页（定价、登录、注册、核心功能页）；每页 snapshot 记录结构与入口
   - 用户给了调研重点（如「重点看注册流程和定价页」）→ 优先覆盖该路径，其余保持基础覆盖
   - 探索时遵守下方「调研模式行为规范」（只读、节流、点击纪律）
2. **总结草案**：把探索所见总结成 **5–12 条可点验路径草案**（字段同上表；`uc` 一律 `—`；`priority` 按用户重点排），草案格式与上方一致，发给用户 review
3. **强制门闩**：用户确认前**禁止**逐 case 录屏、禁止生成最终报告。确认后同样落盘 `docs/user-cases.csv` + `cases.json`，`module` 按页面/能力归类，`precondition` 写「未登录态」或「已用提供凭据登录」
4. 报告 lede 注明来源：`来源：agent 探索 <URL> 后总结草案，经用户确认`

---

### 2. 环境

**先跑依赖检查（必须，缺依赖先自动安装，装不上再报告用户）：**

```bash
node ~/.claude/skills/tple-skill/scripts/check-env.mjs --url <WEB_URL>
# 例如 --url http://localhost:3000；不传 --url 则只查工具不查目标
# 【调研模式】--url 直接指向目标站点，并加 --mode research
node ~/.claude/skills/tple-skill/scripts/check-env.mjs --url https://example.com --mode research
```

检查 node ≥18 / agent-browser / ffmpeg / ffprobe / 目标 web 可达；全部 ✓ 才进入后续步骤。

**【调研模式】预期差异**：不需要本地 dev server；目标是公网 URL。401/403 会标为「可达但受限」——这是正常信号（需登录/反爬），如实带入报告与后续步骤，**不得**当成环境故障去「修」，也不得归因瞎猜。站点不可达时如实报告，不重试轰炸。

**退出码非 0 时：自动安装缺失工具，装完复检，通过才继续：**

```bash
node ~/.claude/skills/tple-skill/scripts/install-deps.mjs   # 一键：按缺失清单安装 + 复检
# 或按 check-env 打印的指引手动装：
#   agent-browser → npm i -g agent-browser && agent-browser install
#   ffmpeg/ffprobe → brew install ffmpeg（或系统包管理器）
```

装完**重跑 `check-env`** 确认全部 ✓，再进入后续步骤。安装失败（无网络 / 无权限 / 目标 web 起不来）才停下来向用户如实报告，不要带病继续，也不要假装检查通过。

- 确认 web / api 可访问；多 worktree 时**避开占用端口**，用 env 注入：
  - `WEB_URL` / `API_URL`
- 破坏性探测（如 `kill -STOP` API）跑完必须 `kill -CONT`
- **必须清理残留 agent-browser**（勿杀用户日常 Chrome.app）：

```bash
agent-browser close --all 2>/dev/null || true   # 先关 daemon session，防串页到其他项目
pkill -f 'agent-browser-darwin-arm64' 2>/dev/null || true
pkill -f 'user-data-dir=.*/agent-browser-chrome-' 2>/dev/null || true
sleep 1.5
```

套件开始时清一次；**每个 case 开始前再清一次**（上一 case 的 STOP API / 改 viewport 易污染 screencast）。

依赖：`agent-browser`、`ffmpeg`、`ffprobe`、Node 18+。

---

### 3. 逐 case 执行与录屏（关键）

#### 默认录屏策略：原生 `agent-browser record`（分镜仅作回退）

原生 record **可用**。曾出现「墙钟 30s、`record stop` 卡 ~20s、落盘只有 ~1s」时，根因通常是**残留 agent-browser Chrome 污染**，不是 record 本身不能用。单独 case 在清理后可稳定录到 6–12s。

**成功契约（agent-browser 0.26.0 实测修订，必须遵守）：**

1. 录前完成登录 / 导航准备（可用 API token + `localStorage`）
2. **录前把页面完全就位**：`open <url>` + `wait` 等渲染完成。⚠️ **0.26.0 中录中 `open`（整页导航）会断帧捕获**：`record stop` 报 `No frames captured`，webm 时长看着正常、体积只有 ~15KB 级空壳。旧版「record start 后 open 一次」的写法在该版本**必产出空视频**，不要照做
3. `record start <path.webm>`
4. 登录态需写回 token 时用 `eval` 写 localStorage（**不用 `open` 刷新页面**）；操作只做点击/填表，页间移动用**点击链接**（`click @ref`）或 `back`；停顿一律 `agent-browser wait <ms>`（不用 shell `sleep` 当录中唯一等待）
5. 结束再 `wait` 1–2s 给观众看清结果 → `record stop`
6. 立刻 `ffprobe`：duration **≥ 4s** 且**体积正常（≥50KB 级）**则转 mp4 采用；**短/空（<4s 或体积异常小）先清理残留进程（含 `close --all`）重试一次原生**，仍短再分镜回退

```bash
# 录后验收
ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 videos/02-xxx.webm
```

**分镜回退**（原生 < 4s 时）：关键步骤 `screenshot` → ffmpeg concat（每帧约 1.5–1.8s）。  
`scale=trunc(iw/2)*2:trunc(ih/2)*2` **必须**（375 奇数宽会导致空 mp4）。

**黑屏两个坑（必读）：**

1. **record 在页面渲染前 start → 开头黑帧。** 先 `open` + `wait` 等页面渲染完成，再 `record start`；不要在 open 之前或同一拍 start。
2. **纯 API case 没有录屏/截图 → 报告引用不存在的媒体 → 播放器黑块。** 每个 case 都必须产出 mp4 或 png（哪怕用终端输出截图做分镜）。生成报告前校验：meta 里每个 id 在 `videos/` 下至少有 `.mp4` 或 `.png`，缺了就补，勿让报告指向空文件。

已知仍易把原生打短、可接受回退的场景：`kill -STOP` API + 长轮询；录中反复 `set viewport`（如 375 移动端）。

#### agent-browser 操作要点

- **写脚本前先过一遍命令速查**（[reference.md](reference.md) 开头「最小命令速查」，或 `agent-browser skills get core`）：`@` 只配 ref（`@e3`）、CSS 选择器不带 `@`、`eval` 的 JS 用双引号包裹、读文本用 `get text body`（没有裸 `body` 命令）
- **每 case 独立 `--session`**，结束 `close`；case 前 `purge` 残留进程（含 `close --all`）
- **输入用 `fill @ref text`**（自带清空）；失败再用页面内设 value + `input`/`change` 事件  
  - **禁止** `press Meta+a` / `Cmd+A`：按键可能漏到 macOS 前台（曾误出「关于本机」等系统窗）
- 登录态：缓存 token；`record start` 后必须写回
- 页面变化后重新 `snapshot -i` 再点 ref
- 断言：`get text body` / snapshot；结果写入 `meta.jsonl`：`id|title|PASS|notes`
- **断言防假阳性**：命令报连接错误 / 页面为空时，判 BLOCKED 或重试，不能按「数据无变化」判 PASS（曾把 eval 连接失败误判成校验生效）
- 同步更新 `runs.json`：该 case 的 `lastRanAt`（ISO）与 `runCount`（累加）；报告展示「最后跑 / 共跑 N 次」
- 关键帧截图须可点击放大（模板已带 lightbox，勿去掉）
- 关键帧仍可 `screenshot`（报告 poster / 回退分镜），但不要用 `Meta+*` 系统快捷键

细节见 [reference.md](reference.md)。

#### 点击纪律（视口检查，必读）

`click @ref` **不会自动滚动**。元素在视口外时点击会**静默落空**：工具返回 `✓ Done`，但页面毫无反应，且没有任何报错。这是最隐蔽的失败模式，曾把一个真实支付按钮的点击误判成「PSP 反自动化」，浪费多轮排查。

**打开页面后、点击前，先检查目标元素是否在视口内；不在就先 `scrollintoview @ref` 再点：**

```bash
# 1) 查元素 bounding box 与视口关系
agent-browser eval "(() => { const el = document.querySelector('<selector>'); const r = el.getBoundingClientRect(); return JSON.stringify({ top: r.top, bottom: r.bottom, vh: innerHeight }); })()"
# 2) bottom > vh 或 top < 0 → 在视口外，先滚入再点
agent-browser scrollintoview @ref
agent-browser click @ref        # 或鼠标坐标点击
```

**点击后必须验证效果，不能信 `✓ Done`：** 截图确认状态、或确认 URL/DOM 变化、或查目标 API 是否产生记录。

**已知坑：CSS 选择器 click 会在部分页面静默落空**（0.26.0 实测：the-internet 的 add_remove 页，`click "button[onclick=...]"` 连 JS `.click()` 都不触发 inline onclick，返回 `✓ Done` 但 DOM 不变）。**优先用 snapshot ref 点击**（`snapshot -i` 拿 `@e3` 再 `click @ref`）；CSS 选择器点击后若效果验证不过，改 ref 点击重试，不要先怀疑页面/风控。

**连续两次「点击无效果」时，先回到基本事实**（元素在哪、可不可见、点没点上、坐标在不在视口内），不要急着归因到外部系统（风控、反自动化、第三方故障）。从「沉默」里编理论，是最贵的错误。

#### 【调研模式】行为规范（对外站必须遵守）

1. **只读探索**：不提交任何破坏性操作——不真实下单、不删除、不大量注册。表单可以填到「提交前一步」截图；**除非用户明示可提交，否则不点最终提交/购买/删除按钮**。
2. **登录态**：用户提供账号密码时，用 `fill` 登录并继续；未提供凭据则只走公开路径，并在报告 lede/env 明确标注「未登录态调研」。登录凭据只用于本次调研，不写入报告正文（env 里只写「账号：用户提供」）。
3. **节流**：同一页面访问一次即可，不刷量、不并发轰炸；尊重目标站负载。探索与录屏的访问节奏以「人能看清」为准。
4. **点击纪律继续适用**：视口检查、点击后验证对外站更重要——外站点不中更难归因，先回基本事实。
5. **遇阻如实记录**：验证码 / 付费墙 / 401/403 反爬拦截 → 记 `BLOCKED`，notes 写实际看到的现象（如「出现 hCaptcha 验证码」），不停摆、不瞎猜原因、不尝试绕过反爬。

---

### 4. 跑全量与校验

```bash
node docs/<slice>-e2e/run-cases.mjs
# 或 CASE_LIMIT=2 冒烟

for f in docs/<slice>-e2e/videos/*.mp4; do
  ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$f"
done
```

- 任一视频缺失 / duration≈0 → 修该 case 后重跑，勿只改 HTML
- AuthGate 类 case 后确认 API 未停在 `STOP`

**status 状态集**：验收模式用 `PASS | FAIL | BLOCKED`；调研模式另允许 `OBSERVE`（观察项：不是对错判定，是产品亮点/疑点记录，如「定价页未展示退款政策」）。`meta.jsonl` 写入规则不变（一行一记录，notes 清洗），见 [reference.md](reference.md)。

**【调研模式】FAIL 语义不同**：FAIL = 「这条路径走不通」，是调研发现（如「注册需邮箱验证无法继续」），不是要修的 bug。

---

### 5. auto-fix loop（全自动修复 FAIL case）【仅验收模式】

**调研模式跳过本步骤**：没有项目代码可改，也禁止改目标站任何东西。FAIL case 保留原状态与 notes，直接进 Step 6 生成调研报告；「走不通的原因」本身就是调研产出。

跑完 Step 4 后，如果 `meta.jsonl` 中存在 `FAIL` 状态的 case，进入自动修复循环。

#### 循环逻辑

```
round = 0
while FAIL count > 0 and round < 3:
    round += 1
    for each FAIL case:
        1. 收集证据（见下）
        2. 分析根因
        3. 用 Edit/Write 改项目代码
        4. 记录本轮到 fixLog[]（必填 bug + fix；并更新 case 级 bug/fix 汇总）
    5. 重启 dev server（如需要）
    6. 仅重跑本轮改过的 FAIL case（不跑全量）
    7. 更新 meta.jsonl
    8. 如果所有 case 都 PASS → break
    9. 如果某个 case 连续 2 轮 FAIL 且 notes 无变化 → 标 BLOCKED，不再尝试
```

#### 刹车机制

| 条件 | 行为 |
|------|------|
| 3 轮后仍有 FAIL | 停止，保留 FAIL 状态，报告写明「尝试 3 轮未修复」 |
| 同一个 case 连续 2 轮 notes 无变化 | 标 BLOCKED，跳过该 case |
| 单次修复改动 > 5 个文件 | 停止，向用户确认是否继续 |
| 修复过程中产生新文件 > 3 个 | 停止，向用户确认 |

#### 证据采集（每个 FAIL case）

按优先级：

1. **agent-browser 输出**：run-cases 脚本的 stderr/stdout，特别是 selector not found、timeout、console error
2. **失败帧截图**：`videos/{id}-fail.png`（如果有）
3. **视频末帧**：`videos/{id}.mp4` 的最后一帧（用 ffmpeg 提取）
4. **页面快照**：FAIL 时立即 `agent-browser snapshot` 拿到的 a11y tree 文本
5. **case 的 expected 字段**：对比「期望看到什么」vs「实际看到什么」

#### 修复记录（fixLog）

写入 `meta.jsonl` 的 notes 字段（扩展格式）：

```jsonl
02-db-validation|数据库 Dialog 必填校验|PASS|修复 2 轮: R1=button selector 改为 data-testid, R2=补 onSubmit 校验逻辑
```

写入 `cases.json`（有修复时**必须**填 Bug 点 + 修复方案，报告才会展示）：

```json
{
  "02-db-validation": {
    "uc": "UC-5",
    "steps": "...",
    "expected": "...",
    "bug": "提交空表单未见必填校验文案",
    "fix": "补 onSubmit 校验；按钮选择器改为 data-testid",
    "fixLog": [
      {
        "round": 1,
        "bug": "找不到提交按钮",
        "fix": "button selector 改为 data-testid",
        "files": ["src/components/Dialog.tsx"]
      },
      {
        "round": 2,
        "bug": "空提交无校验提示",
        "fix": "补 onSubmit 必填校验逻辑",
        "files": ["src/components/Dialog.tsx", "src/lib/validate.ts"]
      }
    ]
  }
}
```

兼容旧字段 `change`（当作该轮「修复方案」）；报告区块标题为「修复说明」，并分栏展示 **Bug 点** / **修复方案**。

---

### 6. 生成 HTML（必须用本 skill 模板）

**更稳的方案：视觉以仓库内文件为准，禁止临场重设计。**

| 文件 | 作用 |
|------|------|
| [assets/report.css](assets/report.css) | 唯一允许的样式（stone + 暖橙 accent） |
| [templates/report.html](templates/report.html) | 壳：侧栏 + main + summary |
| [templates/case-section.html](templates/case-section.html) | 单 case 区块 |
| [scripts/build-report.mjs](scripts/build-report.mjs) | 读 meta → 内联 CSS → 写出 `index.html` |

```bash
# 可选：cases.json 提供 uc/steps/expected
node ~/.claude/skills/tple-skill/scripts/build-report.mjs \
  --dir docs/<slice>-e2e \
  --brand "Issue #N E2E" \
  --title "Issue #N 端到端录屏验收" \
  --h1 "Issue #N 端到端录屏验收" \
  --lede "覆盖本切片 …" \
  --env "环境 web :3000 / api :8787 · 账号 demo" \
  --cases docs/<slice>-e2e/cases.json
```

也可把 `scripts/build-report.mjs` 拷进报告目录再跑；**不得改 CSS token / 布局骨架**。只填文案占位（brand、lede、env、cases）。

**【调研模式】品牌与文案**：brand 用可区分的前缀，如 `--brand "产品调研 · example.com"`；lede 写明来源 URL 与调研范围，未登录时注明：

```bash
node ~/.claude/skills/tple-skill/scripts/build-report.mjs \
  --dir docs/research-example.com \
  --brand "产品调研 · example.com" \
  --title "example.com 产品调研报告" \
  --h1 "example.com 产品调研" \
  --lede "来源：https://example.com · 覆盖注册流程与定价页 · 未登录态调研" \
  --env "目标 example.com · 未登录态 · 账号：无" \
  --cases docs/research-example.com/cases.json
```

case 备注（`notes`）里附观察（亮点/疑点）；观察项 case 用 `OBSERVE` 状态，报告 chip 会单列。

#### Design 硬约束（与当前验收 HTML 一致）

- **布局**：`shell` = 左侧 sticky 导航 280px + 右侧 main；`<960px` 单列
- **信息结构**：brand → CASES 锚点列表 → h1 / lede / meta → 汇总 chips → 每 case 卡片（左文案右媒体）
- **色板**：`--ink #1c1917`、`--bg #f5f5f4`、`--accent #9a3412`；PASS 绿 / FAIL 红 / BLOCKED 琥珀
- **字体**：IBM Plex Sans + Noto/PingFang；备注用 mono + `.notes` 浅底块
- **背景**：双径向暖灰渐变叠在 stone 底上（见 CSS），不要改成紫渐变 / 纯白扁平 / 深色主题
- **媒体**：`video` 黑底、`aspect-ratio 16/10`、`object-fit: contain`；截图两列 grid
- **状态**：nav `.dot`、chip、badge 三处状态色必须同步（class：`pass|fail|blocked`；调研模式另有 `observe`）
- **自包含**：CSS **内联进** `index.html`（`file://` 可开）；视频相对路径 `videos/...`

详细 token 与 DOM 约定见 [design.md](design.md)。

---

### 7. 分发

报告目录 `docs/<slice>-e2e/` 是自包含的（CSS 内联、视频相对路径），直接本地打开 `index.html` 即可验收。【调研模式】报告目录建议用 `docs/research-<域名>/`，与验收报告区分。

如需分享：把整个目录（含 `videos/`）压缩或上传到任意静态托管。注意保持 `videos/` 相对路径不变；若托管端需要绝对路径，需自行调整 HTML 中的引用。

---

## 质量门槛（完成前自检）

- [ ] 开跑前 / 每 case 前已清理残留 agent-browser（含 `agent-browser close --all`）
- [ ] run-cases.mjs 包含 logCase 函数（同时写 meta.jsonl + runs.json），未用简化版 writeMeta 替代
- [ ] 多数 case 为原生录屏且 duration ≥ 4s；回退 case 在日志里标明
- [ ] 无 `Meta+a` 等易泄漏到系统的快捷键
- [ ] HTML 可双击打开，侧栏跳转、视频可播；样式来自 `assets/report.css`
- [ ] index.html 由 `build-report.mjs` 生成（含 `run-meta` 元素），非手写或自定义 HTML；**生成后跑一遍 `build-report.mjs` 自带的媒体校验**——每个 case 的 poster（`videos/<id>.png`）与 `<video>` source 文件必须存在，缺了会裂图/黑块
- [ ] meta 与页面徽章一致；破坏性操作已恢复
- [ ] 报告写明录屏方式（原生为主 / 个别分镜回退）
- [ ] 【调研模式】全程无破坏性写操作（表单停在提交前一步，未提交/下单/删除）
- [ ] 【调研模式】无凭据时报告明确标注未登录态；有凭据时凭据未写入报告正文
- [ ] 【调研模式】验证码/付费墙/反爬记 BLOCKED 并如实记录现象，未尝试绕过
- [ ] 【调研模式】未进入 Step 5 auto-fix，未修改任何目标站/本地项目内容

## 反模式

| 不要 | 要 |
|------|-----|
| 残留 Chrome 不清理就开录 | suite / 每 case 前 `pkill` agent-browser 残留 |
| 信 `✓ Done` 不验点击效果 | 点击前查元素在不在视口内（不在先 `scrollintoview`），点击后截图/查 URL/查 API 验效果 |
| 视口外的按钮直接 `click @ref` | 先 `scrollintoview @ref` 再点；ref 点击不自动滚动，视口外点击静默落空 |
| 连续失败就归因外部系统（风控/反自动化） | 先回基本事实：元素坐标、可见性、是否在视口内 |
| 因一次 ~1s 空壳就放弃原生 | 先清理进程，按成功契约重试；仍短再分镜回退 |
| `record start` 后再 `open` 目标页（0.26.0 断帧捕获，产出空壳 webm） | 录前 open + wait 就位页面再 start；录中只用点击/`back` 移动，token 用 `eval` 写回 |
| CSS 选择器 `click` 返回 `✓ Done` 就当点上了 | 部分页面会静默落空；点击后验证 DOM/URL 效果，不过就改 snapshot ref 点击重试 |
| `press Meta+a` 清输入框 | `fill` 或页面内设 value |
| 全 suite 共用一个 session 不 close | 每 case 新 session + close |
| 只在聊天里贴 PASS 表 | 产出可打开的 HTML + videos |
| 奇数宽截图直接 x264 | `scale=trunc(iw/2)*2:...` |
| 跑完不管 API STOP | 始终 `kill -CONT` |
| 手写新 HTML 主题 / Tailwind 看板风 | 只用本 skill 的 css + templates |
| 只写 meta.jsonl、跳过 runs.json | 用标准 logCase 同时写两个文件（报告展示「最后跑 / 共跑 N 次」） |
| FAIL 后人工分析、手动改代码 | 用 Step 5 auto-fix loop 自动修复（最多 3 轮） |
| 无限制循环修复同一个 case | 连续 2 轮无进展标 BLOCKED，刹车退出 |
| `click @css-selector` / eval 不加引号就开跑 | 先看 reference.md「最小命令速查」：`@` 只配 ref，eval JS 双引号包裹 |
| 清理只 `pkill` 不 `close --all` | 先 `agent-browser close --all` 再 pkill，否则 daemon 残留 session 串页到别的项目 |
| 断言命令连接失败仍按「无变化」判 PASS | 数据拿不到判 BLOCKED/重试，防假阳性 |
| 【调研】在目标站真实下单/删除/批量注册 | 只读探索；表单填到提交前一步截图，用户明示才可提交 |
| 【调研】走不通就进 auto-fix「修复」 | 调研模式跳过 Step 5；FAIL 是调研发现，notes 记原因即可 |
| 【调研】遇 401/403/验证码就猜「风控针对我们」 | 如实记 BLOCKED + 实际现象；不绕过反爬，不重试轰炸 |
| 【调研】没凭据也硬走登录路径 | 无凭据只走公开路径，报告标注未登录态 |
| 【调研】把用户凭据写进报告正文 | env 只写「账号：用户提供」，凭据不落报告 |

## 依赖工具

- `agent-browser` — 浏览器操作与录屏（公网 npm 包：`npm i -g agent-browser`）
- `ffmpeg` / `ffprobe` — 视频处理（转码、分镜 concat、poster 提取、时长校验）
- Node.js 18+ — run-cases / build-report / check-env 脚本
- `curl` — check-env 探测目标 web 可达性（macOS/Linux 自带）

运行前检查：`node ~/.claude/skills/tple-skill/scripts/check-env.mjs --url <WEB_URL>`
