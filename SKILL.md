---
name: tple-skill
description: >-
  TPLE：按 case 做端到端验收——agent-browser 原生 record 录屏（残留进程需先清理），
  过短则回退分镜截图，再生成按 case 分区的 HTML 验收报告（含视频/截图/PASS|FAIL|BLOCKED）。
  Use when the user asks for tple-skill, TPLE, E2E 录屏验收、按 case HTML 报告、
  issue 验收录屏、端到端 HTML report with video, or per-case acceptance evidence.
---

# tple-skill（TPLE）

把「功能切片 / Issue」做成**可打开的 HTML 验收包**：每个 case 一段视频 + 截图 + 步骤/期望/结果。

与 `e2e-verify`（偏 checklist + 截图 markdown）和 `html-report`（偏方案/分析单页）不同：本 skill 交付**带媒体的按 case 验收站**。

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

副本（便于本地打开 / 走 html-report 工作流）：

```
~/Documents/_agent/html-report-skill/workspace/YYYYMMDD-<slice>-e2e/
```

聊天里只回：报告路径、PASS/FAIL 汇总、异常 case。

## 流程总览

```
Task Progress:
- [ ] 1. 定 case 清单（有 csv 就筛；没有则按项目总结草案 → 用户确认 → 落盘 csv）
- [ ] 2. 起环境、确认端口，并清理残留 agent-browser
- [ ] 3. 写 run-cases（原生 record 为主；过短回退分镜）
- [ ] 4. 跑全量，写 meta.jsonl，用 ffprobe 验视频时长
- [ ] 5. auto-fix loop：FAIL case → 分析 → 改代码 → 重测（最多 3 轮）
- [ ] 6. build-report → index.html（必须用本 skill 模板）
- [ ] 7. 复制到 html-report workspace（可选上传 R2）
```

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

---

### 2. 环境

- 确认 web / api 可访问；多 worktree 时**避开占用端口**，用 env 注入：
  - `WEB_URL` / `API_URL`
- 破坏性探测（如 `kill -STOP` API）跑完必须 `kill -CONT`
- **必须清理残留 agent-browser**（勿杀用户日常 Chrome.app）：

```bash
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

**成功契约（必须遵守）：**

1. 录前完成登录 / 导航准备（可用 API token + `localStorage`）
2. `record start <path.webm>`
3. 写回 token + **一次** `open` 到目标页（`record` 会刷新上下文）
4. 操作；停顿一律 `agent-browser wait <ms>`（不用 shell `sleep` 当录中唯一等待）
5. 结束再 `wait` 1–2s 给观众看清结果 → `record stop`
6. 立刻 `ffprobe`：duration **≥ 4s** 则转 mp4 采用；否则用分镜回退

```bash
# 录后验收
ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 videos/02-xxx.webm
```

**分镜回退**（原生 < 4s 时）：关键步骤 `screenshot` → ffmpeg concat（每帧约 1.5–1.8s）。  
`scale=trunc(iw/2)*2:trunc(ih/2)*2` **必须**（375 奇数宽会导致空 mp4）。

已知仍易把原生打短、可接受回退的场景：`kill -STOP` API + 长轮询；录中反复 `set viewport`（如 375 移动端）。

#### agent-browser 操作要点

- **每 case 独立 `--session`**，结束 `close`；case 前 `purge` 残留进程
- **输入用 `fill @ref text`**（自带清空）；失败再用页面内设 value + `input`/`change` 事件  
  - **禁止** `press Meta+a` / `Cmd+A`：按键可能漏到 macOS 前台（曾误出「关于本机」等系统窗）
- 登录态：缓存 token；`record start` 后必须写回
- 页面变化后重新 `snapshot -i` 再点 ref
- 断言：`body` 文本 / snapshot；结果写入 `meta.jsonl`：`id|title|PASS|notes`
- 同步更新 `runs.json`：该 case 的 `lastRanAt`（ISO）与 `runCount`（累加）；报告展示「最后跑 / 共跑 N 次」
- 关键帧截图须可点击放大（模板已带 lightbox，勿去掉）
- 关键帧仍可 `screenshot`（报告 poster / 回退分镜），但不要用 `Meta+*` 系统快捷键

细节见 [reference.md](reference.md)。

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

---

### 5. auto-fix loop（全自动修复 FAIL case）

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

#### Design 硬约束（与当前验收 HTML 一致）

- **布局**：`shell` = 左侧 sticky 导航 280px + 右侧 main；`<960px` 单列
- **信息结构**：brand → CASES 锚点列表 → h1 / lede / meta → 汇总 chips → 每 case 卡片（左文案右媒体）
- **色板**：`--ink #1c1917`、`--bg #f5f5f4`、`--accent #9a3412`；PASS 绿 / FAIL 红 / BLOCKED 琥珀
- **字体**：IBM Plex Sans + Noto/PingFang；备注用 mono + `.notes` 浅底块
- **背景**：双径向暖灰渐变叠在 stone 底上（见 CSS），不要改成紫渐变 / 纯白扁平 / 深色主题
- **媒体**：`video` 黑底、`aspect-ratio 16/10`、`object-fit: contain`；截图两列 grid
- **状态**：nav `.dot`、chip、badge 三处状态色必须同步（class：`pass|fail|blocked`）
- **自包含**：CSS **内联进** `index.html`（`file://` 可开）；视频相对路径 `videos/...`

详细 token 与 DOM 约定见 [design.md](design.md)。

---

### 7. 分发

```bash
DEST="$HOME/Documents/_agent/html-report-skill/workspace/$(date +%Y%m%d)-<slice>-e2e"
mkdir -p "$DEST/videos"
cp index.html meta.jsonl "$DEST/"
cp videos/* "$DEST/videos/"
```

公网分享时走 `html-report` skill 的 R2 流程（整目录需自行处理相对视频路径，或打 zip）。

---

## 质量门槛（完成前自检）

- [ ] 开跑前 / 每 case 前已清理残留 agent-browser
- [ ] run-cases.mjs 包含 logCase 函数（同时写 meta.jsonl + runs.json），未用简化版 writeMeta 替代
- [ ] 多数 case 为原生录屏且 duration ≥ 4s；回退 case 在日志里标明
- [ ] 无 `Meta+a` 等易泄漏到系统的快捷键
- [ ] HTML 可双击打开，侧栏跳转、视频可播；样式来自 `assets/report.css`
- [ ] index.html 由 `build-report.mjs` 生成（含 `run-meta` 元素），非手写或自定义 HTML
- [ ] meta 与页面徽章一致；破坏性操作已恢复
- [ ] 报告写明录屏方式（原生为主 / 个别分镜回退）

## 反模式

| 不要 | 要 |
|------|-----|
| 残留 Chrome 不清理就开录 | suite / 每 case 前 `pkill` agent-browser 残留 |
| 因一次 ~1s 空壳就放弃原生 | 先清理进程，按成功契约重试；仍短再分镜回退 |
| `press Meta+a` 清输入框 | `fill` 或页面内设 value |
| 全 suite 共用一个 session 不 close | 每 case 新 session + close |
| 只在聊天里贴 PASS 表 | 产出可打开的 HTML + videos |
| 奇数宽截图直接 x264 | `scale=trunc(iw/2)*2:...` |
| 跑完不管 API STOP | 始终 `kill -CONT` |
| 手写新 HTML 主题 / Tailwind 看板风 | 只用本 skill 的 css + templates |
| 只写 meta.jsonl、跳过 runs.json | 用标准 logCase 同时写两个文件（报告展示「最后跑 / 共跑 N 次」） |
| FAIL 后人工分析、手动改代码 | 用 Step 5 auto-fix loop 自动修复（最多 3 轮） |
| 无限制循环修复同一个 case | 连续 2 轮无进展标 BLOCKED，刹车退出 |

## 相关 skill

- `agent-browser` — 浏览器操作
- `e2e-verify` — 无长视频的 Issue checklist 验收
- `html-report` — 方案/分析 HTML 与 R2 上传
