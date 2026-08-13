---
name: tple-skill
description: >-
  TPLE：编排 agent + 每 case 独立 subagent 串行录屏验收（禁止单会话包办全套），
  agent-browser 原生 record，过短回退分镜，生成按 case 分区的 HTML 验收报告。
  也支持产品调研模式：只给网址、无代码，探索后同样按 case 派发 subagent 出调研报告。
  Use when the user asks for tple-skill, TPLE, E2E 录屏验收、按 case HTML 报告、
  issue 验收录屏、端到端 HTML report with video, or per-case acceptance evidence;
  also for 产品调研、竞品调研、研究/看看这个产品、只给 URL 的调研验收。
---

# tple-skill（TPLE）

把「功能切片 / Issue」做成**可打开的 HTML 验收包**：每个 case 一段视频 + 截图 + 步骤/期望/结果。

定位：不做 checklist + 截图 markdown 式验收，而是交付**带媒体的按 case 验收站**。

**路径约定**：`SKILL_DIR` = 本 SKILL.md 所在目录（agent 加载本 skill 时所在的路径，与安装位置无关——可能是 Claude Code、Cursor 或任何其他 agent 的 skill 目录）。下文所有脚本调用一律以 `$SKILL_DIR/scripts/...` 为准：

- **`SKILL_DIR` 是占位符，不是已存在的环境变量**。执行时把它替换为你实际加载本 skill 的目录路径，**不要硬编码任何特定 agent 的安装路径**
- 终端手动运行：`cd` 到本 skill 目录后用相对路径即可，如 `node scripts/check-env.mjs --url <WEB_URL>`（脚本以自身位置定位，与 cwd 无关）

### 工作根、项目记忆、产物目录

**工作根（PROJECT_ROOT）**：验收模式 = 目标代码仓库根；调研模式 = 用户指定的运行目录（或当前 cwd）。所有相对路径相对工作根。

| 路径 | 用途 |
|------|------|
| `tple-memory.md` | **项目级记忆**（建议入库）。本项目跑 TPLE 时发现的可复用经验：登录/断言坑、选择器、站点特有可见性信号等 |
| `.tple/<slice>/` | **本次运行产物**（默认；是否入库由项目自定）。报告、`meta.jsonl`、`runs.json`、`cases.json`、`run-cases.mjs`、`videos/`、`.tple-browser.json`、临时 `state` 等 |
| `docs/user-cases.csv` | 验收模式 case 清单（团队可读的产品文档，可继续放 `docs/`）；调研草案确认后也可落盘于此或 `.tple/user-cases.csv` |

**记忆怎么用（编排必做，自然发现）：**

1. Step 0/1 开始时：若工作根存在 `tple-memory.md`（兼容 `.tple/memory.md`）→ **先读**，当作本项目硬约束，与本 SKILL 通用规则叠加。
2. 跑中/跑完：把**可复用**经验追加进去（注明日期与 slice）；断言细节可同时写进当次 `run-cases.mjs`。
3. **禁止**把某站点业务断言（章节名、文案、产品特有 DOM）写回本 SKILL.md / 反模式表——那些属于项目记忆，不是通用 skill。

**产物默认路径**（新建 slice 时优先）：

- 验收：`.tple/<slice>-e2e/`（例：`.tple/issue-23-e2e/`）
- 调研：`.tple/research-<域名>/`（例：`.tple/research-sellxagent.com/`）

仓库若**已约定** `docs/<slice>-e2e/` 且在用，可继续沿用该路径；**新开跑默认 `.tple/`**。下文示例里的 `docs/<slice>-e2e` 与 `.tple/<slice>-e2e` 等价，以工作根内实际报告目录为准（`--dir`）。

两种模式：

- **验收模式**（默认）：有代码、有仓库；编排锁定脚本后按 case 派发 subagent 录屏；FAIL 由编排 auto-fix 后重派。
- **调研模式**（产品调研）：只给网址、无代码，编排探索出草案，确认后同样按 case 派发 subagent 录屏出调研报告。**核心功能写操作（创建/编辑/生成）默认允许；真实支付/删除/大量注册/对外发送需用户明示**；不改本地项目内容，走不通的路径记为发现/限制，不进 auto-fix。模式判定见 Step 0。

## 参数路由：`update`（自更新，优先于一切步骤）

调用参数（ARGUMENTS）含 `update` / `更新` / `升级` → **进入更新流程，跳过常规 TPLE 全部步骤**（不做模式判定、不定 case、不开录屏；用户的 update 调用本身就是更新意图，无需再次确认）：

```bash
node $SKILL_DIR/scripts/check-update.mjs --force   # 绕过 24h 缓存，拿真实的最新版本
```

按输出分支处理：

- **已是最新** → 报告「已是最新 vX.Y.Z」，结束
- **落后** → 直接执行 `node $SKILL_DIR/scripts/check-update.mjs --apply`（脚本按安装来源自动分流：git → 脏检查 + `git pull --ff-only`；zip → 下载最新 release zip 覆盖，根级布局；更新后脚本自动重跑 `check-env.mjs` 复检依赖），然后报告「vX.Y.Z → vA.B.C + 复检结果」
- **`--apply` 被拒绝**（脏工作区 / detached HEAD / 无法 fast-forward / 下载失败，脚本退出码 1）→ 把脚本的报错与改动清单**如实转告用户**并给选项：commit / stash 后重试；detached HEAD 先 `git checkout` 回主分支；或手动下载 zip 覆盖。**不得强拉、不得静默换更新方式**
- **离线 / 限流**（拿不到最新版本）→ 告知「当前无法获取最新版本（网络原因），稍后重试」，退出码 0，不当失败

更新流程**在报告结果后结束**，不继续 TPLE 验收/调研。无 update 参数时走下方正常流程（Step 2 环境阶段另有非阻塞版本自检，落后只提示不自动更新）。

## 交付物

```
tple-memory.md                    # 项目记忆（有则先读；跑中追加可复用经验）
docs/user-cases.csv               # 无表时：确认后新建；有表则筛选/回写 status（可仍放 docs/）
.tple/<slice>-e2e/                # 默认运行产物目录（或仓库已约定的 docs/<slice>-e2e/）
  index.html                      # 主报告（侧栏导航 + 每 case 区块）
  meta.jsonl                      # id|title|status|notes
  runs.json                       # case 条目 { lastRanAt, runCount } + 可选顶层 usage
  cases.json                      # 报告文案（可由 csv 生成）
  run-cases.mjs                   # 编排锁定的执行脚本
  .tple-browser.json              # 浏览器套件状态（编排 CLI 维护）
  videos/
    01-xxx.mp4 / .webm / .png     # 每 case 视频 + 结束帧
    01-xxx-fail.png               # 可选中间失败态
```

聊天里只回：报告路径、PASS/FAIL 汇总、异常 case；若更新了 `tple-memory.md` 可一句带过。

## 执行架构（唯一模式，不可切换）

TPLE **禁止**由单个 LLM 会话串行包办全部 case（长上下文会导致注意力发散、反复改同一大脚本）。唯一合法形态：

| 角色 | 谁 | 职责 |
|------|----|------|
| **编排 agent（Orchestrator）** | 加载本 skill 的主会话 | Step 0–2.5；写并锁定一份 `run-cases.mjs` + `cases.json`；**按 case 串行派发** subagent；汇总 `meta.jsonl` / 媒体校验；Step 5 auto-fix（改代码）；重派失败 case 的 subagent；Step 6–7 采集 usage（多会话合计）+ build-report + 分发 |
| **Case subagent** | 每个 case 一个**独立**短会话 | **只跑自己的 `CASE_ID`**：执行 `CASE_ID=<id> node run-cases.mjs`（或等价只跑该 id）；写本 case 的媒体 + 经 `logCase` 追加 meta/runs；结束回报 `SUBAGENT_DONE <id> <STATUS>` |
| **Fixer** | 默认即编排 agent（可另起专用会话，但仍是「单点改代码」） | 只改目标仓库代码与（必要时）`run-cases.mjs` 中该 case 片段；**禁止**多个 subagent 同时改同一仓库 |

**硬约束：**

1. **串行派发**：同一时刻只跑一个 case subagent（避免互相 `pkill` / 抢 daemon）。禁止「主会话自己点完所有 case」替代派发。
2. **Subagent 禁令**：禁止裸调 `agent-browser` / 手写 `ab()`；禁止 `close --all` / 按特征 `pkill`；禁止 `dashboard start|stop`；禁止改公共 `run-cases.mjs` 骨架 / 其他 case 分支 / `cases.json` 全局字段；禁止跑 `CASE_ID` 以外的 case；禁止 `build-report` / `collect-usage` / 改 skill 文档。浏览器操作**只**经 `createBrowser(reportDir).run(session, args)` / `closeSession(session)`（库会强制注入 profile、拒绝 headed/`close --all`/dashboard）。
3. **套件级生命周期只归编排 CLI**：`node $SKILL_DIR/scripts/tple-browser.mjs suite-boot|login-*|suite-teardown`（内部才做 `close --all` + pkill + dashboard）。**禁止**每个 case 开始前再 purge。Subagent 结束只 `closeSession(caseId)`。
4. **脚本锁定**：`run-cases.mjs` 由编排写好后须过 `check-run-cases.mjs` 再派发；subagent 默认只执行不改写。若录屏契约必须改脚本，回传原因由编排改完再重派该 case。
5. **宿主适配**：用当前 agent 的「子 agent / Task / 独立 `opencode run` / Claude Agent」等能力派发；没有子 agent API 时，用**新开独立会话**（新 session 标题 `tple-case-<id>`）等价替代——仍须上下文隔离，禁止在主会话里假装跑完。

派发提示词模板与 `CASE_ID` 约定见 [reference.md](reference.md)「编排与 case subagent」。

## 流程总览

```
Task Progress:
- [ ] 0. 模式判定 + 定位工作根；若有 `tple-memory.md` 先读【编排】
- [ ] 1. 定 case 清单（有 csv 就筛；没有则按项目总结草案 → 用户确认 → 落盘 csv）【编排】
- [ ] 2. 起环境、确认端口，版本自检，`tple-browser suite-boot`（清理+dashboard+状态文件）【编排】
- [ ] 2.5 登录态决策 → `login-open` / `login-wait` / `login-done`（或 reuse mode boot）【编排】
- [ ] 3. 编排写好并锁定 run-cases.mjs + cases.json；`check-run-cases` 通过后再派发
- [ ] 4. 按 case 串行派发 subagent → 各写 meta/媒体；编排 ffprobe/媒体门闩汇总
- [ ] 5. auto-fix：编排改代码 → 只重派 FAIL case 的 subagent（≤3 轮）【仅验收】
- [ ] 6. 编排：多会话 usage 合计写入 runs.json → build-report → index.html；可复用经验追加 `tple-memory.md`
- [ ] 7. 分发【编排】
```

---

### 0. 模式判定（先判，再走流程）

先定 **PROJECT_ROOT**（验收=目标仓库根；调研=用户指定运行目录或 cwd）。若存在 `tple-memory.md` 或 `.tple/memory.md` → **先读完再定 case / 写断言**。

| 信号 | 模式 |
|------|------|
| 有代码仓库 / 本地 dev server / issue 验收需求 | **验收模式**（默认） |
| 用户意图是「调研 / 研究 / 看看这个产品 / 竞品」+ 只给了 URL（无代码） | **调研模式** |
| 既没代码也没给 URL | 直接向用户要 URL，不要猜站点 |

**调研模式差异总览**（与验收模式逐项对照）：

| 维度 | 验收模式 | 调研模式 |
|------|----------|----------|
| case 来源 | 仓库 csv / Issue / diff 总结 | agent 自主探索站点（open + snapshot 巡检 + 实际走核心功能）后总结草案 |
| 环境 | 本地 dev server | 目标就是公网 URL，无需起服务 |
| auto-fix | 编排改代码后**重派** FAIL case subagent（Step 5） | **不改本地项目内容**；Step 5 整体跳过，FAIL 记为「调研发现/限制」 |
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

调研的目的不是只看不碰，而是**实际走一遍产品核心功能**，了解其使用场景、操作方法和交付结果。调研模式没有仓库可读，case 来源改为**agent 自主探索目标站点**：

1. **探索巡检**（先于任何录屏）：`open` 目标 URL → 首页 `snapshot -i` + `screenshot` → 顺着导航/主入口逐个看关键落地页（定价、登录、注册、核心功能页）；每页 snapshot 记录结构与入口；**核心功能路径要实际走一遍**（创建/编辑/生成等，遵守下方行为规范）
   - 用户给了调研重点（如「重点看注册流程和定价页」）→ 优先覆盖该路径，其余保持基础覆盖
   - 探索时遵守下方「调研模式行为规范」（节流、点击纪律、真实动作同意层）
2. **总结草案**：把探索所见总结成 **5–12 条可点验路径草案**（字段同上表；`uc` 一律 `—`；`priority` 按用户重点排），**核心功能应占草案多数**，草案格式与上方一致，发给用户 review
3. **强制门闩**：用户确认前**禁止**逐 case 录屏、禁止生成最终报告。确认后同样落盘 `docs/user-cases.csv` + `cases.json`，`module` 按页面/能力归类，`precondition` 写「未登录态」或「已用提供凭据登录」
4. 报告 lede 注明来源：`来源：agent 探索 <URL> 后总结草案，经用户确认`

---

### 2. 环境

**先跑依赖检查（必须，缺依赖先自动安装，装不上再报告用户）：**

```bash
node $SKILL_DIR/scripts/check-env.mjs --url <WEB_URL>
# 例如 --url http://localhost:3000；不传 --url 则只查工具不查目标
# 【调研模式】--url 直接指向目标站点，并加 --mode research
node $SKILL_DIR/scripts/check-env.mjs --url https://example.com --mode research
```

检查 node ≥18 / agent-browser / ffmpeg / ffprobe / **ccusage** / 目标 web 可达；全部 ✓ 才进入后续步骤。另有软探测 `token-meter`（· 行）：用 ccusage→本地账本探测当前 agent 能否采集用量；不支持只提示、不阻断。

**【调研模式】预期差异**：不需要本地 dev server；目标是公网 URL。401/403 会标为「可达但受限」——这是正常信号（需登录/反爬），如实带入报告与后续步骤，**不得**当成环境故障去「修」，也不得归因瞎猜。站点不可达时如实报告，不重试轰炸。

**退出码非 0 时：自动安装缺失工具，装完复检，通过才继续：**

```bash
node $SKILL_DIR/scripts/install-deps.mjs   # 一键：按缺失清单安装 + 复检
# 或按 check-env 打印的指引手动装：
#   agent-browser → npm i -g agent-browser && agent-browser install（全平台）
#   ffmpeg/ffprobe → brew install ffmpeg（macOS/Linux）或 winget install Gyan.FFmpeg（Windows）
#   ccusage → npm i -g ccusage
```

装完**重跑 `check-env`** 确认全部 ✓，再进入后续步骤。安装失败（无网络 / 无权限 / 目标 web 起不来）才停下来向用户如实报告，不要带病继续，也不要假装检查通过。

**版本自检（非阻塞：落后仅提示，不静默更新、不中止流程）：**

```bash
node $SKILL_DIR/scripts/check-update.mjs   # 本地版本 vs GitHub 最新 release；24h 内不重复联网；离线/限流静默降级
```

- 自检**永远退出码 0**：拿不到最新版本（离线/API 限流）不当环境故障，静默跳过继续主流程
- **落后时向用户提示**（当前 vX.Y.Z / 最新 vA.B.C / 落后版本摘要），让用户选择：更新或跳过。用户确认后才执行更新；跳过则照常继续，**不因未更新而中止 TPLE**
- **更新须用户明示确认**：`node $SKILL_DIR/scripts/check-update.mjs --apply`。脚本按安装来源自动分流：
  - **git 安装**（目录含 .git）：先查本地改动——有未提交改动**拒绝拉取、列出改动并以退出码 1 报错**（不强拉）；干净则 `git pull --ff-only`（无法 fast-forward 时报错退出，不硬合并）
  - **zip 安装**（无 .git）：下载最新 release zip 覆盖安装（保持根级布局、zip 内本就不含 CLAUDE.md）；用户本地新增的文件不受影响。有 license key 的用户可改走 landingpage `/download?license=` 下载后手动覆盖
- 两种路径更新后脚本都会自动**重跑 `check-env.mjs` 复检依赖**（新版可能引入新依赖）；复检不过再走 install-deps 流程

**浏览器套件生命周期（唯一路径，禁止手写 close/pkill/dashboard）：**

```bash
# Step 2：套件启动（内部：close --all + 特征 pkill + dashboard start + 写 .tple-browser.json）
# 报告目录默认 .tple/<slice>-e2e/；仓库已约定 docs/ 时改 --dir 即可
# mode=none 公开路径；reuse=选项A；manual=选项B（phase=login，须再走 login-*）
node $SKILL_DIR/scripts/tple-browser.mjs suite-boot --dir .tple/<slice>-e2e \
  --mode none|reuse|manual [--profile …] [--chrome …] [--port 4848]
open http://localhost:4848   # macOS；Windows: start http://localhost:4848

# Step 7 / 套件结束（内部：close --all + pkill + dashboard stop；phase=torn_down）
node $SKILL_DIR/scripts/tple-browser.mjs suite-teardown --dir .tple/<slice>-e2e
```

- **禁止**每个 case 开始前再 purge / `close --all`（会拆掉登录 profile、诱发多开 Chrome）。
- case 间只 `createBrowser(dir).closeSession(caseId)`。
- dashboard 由 suite-boot/teardown 管；失败不阻塞主流程。排查「页面没到位/ref 失效/录屏断帧」优先看 :4848。

- 确认 web / api 可访问；多 worktree 时**避开占用端口**，用 env 注入：
  - `WEB_URL` / `API_URL`
- 破坏性探测（如 `kill -STOP` API）跑完必须 `kill -CONT`
- 派发 subagent 时注入 `TPLE_SKILL_DIR=$SKILL_DIR`（run-cases import 库用）

依赖：`agent-browser`、`ffmpeg`、`ffprobe`、Node 18+。

---

### 2.5 登录态决策（检测到需登录时暂停询问，不得静默选路径）

**检测信号**（任一即触发）：打开关键页面出现登录墙 / 被重定向到登录页、关键路径 401/403、case 清单里有依赖登录态的项（看 `precondition` 字段，如「需登录态」「已用提供凭据登录」）。

触发后**暂停流程**，向用户说明检测到的信号，并让用户在以下选项中选（不要替用户静默决定）：

| 选项 | 做法（必须走 `tple-browser`，禁止手拼 flag） | 适用 |
|------|------|------|
| **A. 复用本地 Chrome profile** | `agent-browser profiles` 列出 → 用户选定后：`suite-boot --dir … --mode reuse --profile "<名>" [--chrome <系统Chrome>]`（脚本写入状态并强制后续每条命令注入 profile + executable-path） | 用户本地 Chrome 已登录目标站点（最常见） |
| **B. headed 引导手动登录** | `suite-boot --mode manual` → `login-open --url …` → 用户在 headed 窗完成登录 → `login-wait --ok-url-regex …` → `login-done`（phase→run，**此后 headed 永久拒绝**；case 无 headed、同 profile） | 无法/不愿复用本地 profile，或登录涉及验证码/2FA |
| **C. 连接用户真实浏览器（人机检测场景）** | `tple-browser` 的 `loginMode=cdp` **本期未实现**（suite-boot 会拒）；仍按 [reference.md](reference.md)「选项 C」手工 CDP 流程，并在报告注明。后续版本再收口 | 登录/生成路径被**人机检测门闩**拦死 |
| 提供凭据 | 用户给出账号密码；`suite-boot --mode none` 后用 `createBrowser().run` 做 `fill` 登录（凭据不落报告正文） | 用户明示愿意提供 |
| 放弃登录 | `suite-boot --mode none`；只走公开路径，报告 lede/env 标注「未登录态」 | 用户不想登录或调研模式默认 |

**关键约束：**

- **选项 A/B 的 profile 注入由库强制**，禁止在 run-cases 手写 `spawnSync("agent-browser"…)` 或「为躲 DevTools 删掉 --profile」。漏带即丢登录态——脚本层直接 throw。
- **选项 B：headed 仅 `login-open` 一次**；`login-done` 会 **purge 全部 daemon + 同 profile 强制 headless（`--headed false` + `--headless=new`）冷启唯一 `tple-keepalive`**。manual/reuse 下**整套 case 共用该 session**（同一 `user-data-dir` 不能并行多 session，否则 Chrome exit 21 + daemon 膨胀）。探活 `probe`→自动映射 keepalive。`open` 后 settle 只切 tab / 同 tab `location.assign`，**禁止二次 open**。目录型 profile 冷启前清 `Default/Sessions`。
- **选项 C 必须先预检**（见 reference）；严禁 `--auto-connect` 重试循环。
- 选定登录态后，先验证登录成功再进 Step 3；验证不过就回报用户，不带病开跑。
- **不要用 `--auto-connect` + `state save` 导 cookie 复用多 profile 登录态**（见反模式表）。
- **强同意弹窗**：尽量同一 profile 实例内处理；不要遇阻就 suite 级重启。
- 报告 env 注明登录态：`复用本地 Chrome profile "…"` / `headed 手动登录` / `未登录态`

【调研模式】同一决策门闩：无凭据且用户不选 A/B/C 时，维持原行为——只走公开路径，并在报告 lede/env 标注「未登录态调研」。用户选择复用/手动登录/连接真实浏览器后按选项 A/B/C 执行，登录态同样不落报告正文。

---

### 3. 编排准备 `run-cases`（锁定后再派发）

本步由**编排 agent**完成，写完即锁定，再进入 Step 4 派发。

1. 在工作根创建报告目录 `.tple/<slice>-e2e/`（或已约定的 `docs/<slice>-e2e/`：含 `videos/`、空 `meta.jsonl`、初始 `runs.json`）；Step 2 已写出 `.tple-browser.json`
2. 写出标准 `run-cases.mjs`：**必须** `import { createBrowser } from "$SKILL_DIR/scripts/lib/tple-browser.mjs"`（路径写绝对或经 `TPLE_SKILL_DIR`）；用 `browser.run(caseId, […])` / `closeSession`；含 `logCase` 双写；支持 `CASE_ID=<id>` 单跑；禁止本地 `ab()`/`purge`/`spawnSync("agent-browser"`
3. 写出 `cases.json`（uc/steps/expected）
4. **锁定前门闩**：`node $SKILL_DIR/scripts/check-run-cases.mjs --dir docs/<slice>-e2e`（exit 0 才派发）
5. 派发时注入 `TPLE_SKILL_DIR=$SKILL_DIR`；录屏契约 / `WEB_URL` 写进脚本或 env

#### 默认录屏策略：原生 `agent-browser record`（分镜仅作回退）

（编排写入脚本；**case subagent 执行时遵守同一契约**。）

原生 record **可用**。曾出现「墙钟 30s、`record stop` 卡 ~20s、落盘只有 ~1s」时，根因通常是**残留 agent-browser Chrome 污染**，不是 record 本身不能用。单独 case 在清理后可稳定录到 6–12s。

**成功契约（agent-browser 0.26.0 实测修订，必须遵守）：**

1. 录前完成登录 / 导航准备（可用 API token + `localStorage`）
2. **录前把页面完全就位**：`open <url>` + `wait` 等渲染完成。⚠️ **0.26.0 中录中 `open`（整页导航）会断帧捕获**：`record stop` 报 `No frames captured`，webm 时长看着正常、体积只有 ~15KB 级空壳。旧版「record start 后 open 一次」的写法在该版本**必产出空视频**，不要照做
3. **防御性 `stopRecording(caseId)` → `record start <path.webm>`**。`stopRecording` 是 `run-cases.mjs` 必备 helper：`No recording in progress` 即使以非零退出码返回也必须视为成功，其他 stop 错误才抛出。被中断的录制会残留状态：下一次 `record start` 报 `Recording already active`，最终 `record stop` 产出上百秒空壳长视频——每 case 开头先兜底一次
4. `record start` 会进入**新录制 context**，不会继承旧页面的 runtime 登录态。报告类已登录 SPA 须在 `run-cases.mjs` 为该站点定义“录制 context 初始化”：开始录制后立刻经 `eval` 恢复所需的 `localStorage` 与 JS 可写 cookie（`document.cookie`），再用 `location.reload()` 重载**当前**报告 URL 并等待页面恢复。`reload` 是这里唯一允许的整页导航；**不得**改用 `open`，也不得把 token/cookie 写入 `meta.jsonl`、截图或报告。HttpOnly cookie 无法由 `document.cookie` 恢复，仍须用已登录 profile 或站点登录流程。
5. 每个 case 必须定义 `completionCheck`：一个可观察的 URL、DOM 或 API 条件。操作完成后轮询该条件，**不得**用固定等待代替完成判断；例如登录后出现用户菜单、报告 URL 保留 `session` 参数并出现关键区块、提交后出现成功提示或新增项。
6. `completionCheck` 成立后，再完成一次可见页面变化并展示结果至少 3s，再 `record stop`；仅在后续媒体门槛也通过时才 PASS。达到 timeout（超时）仍不成立时，先截图/读取实际页面 → `record stop` 落盘证据 → FAIL 或 BLOCKED。`record stop` 是收尾动作，不是完成条件。
7. 立刻 `ffprobe` 双指标验收：duration **≥ 4s** 且**帧数持续（≈10fps×秒数，4s ≈ 32 帧以上）**则转 mp4 采用；**短/断帧（<4s 或帧数寥寥）先只 `close` 本 case `--session` 后重试一次原生**（subagent **不得** `close --all` / 全局 pkill；需要套件级清理时回报编排），仍短再分镜回退。**不要用字节体积判健康**：VP9 10fps 下 5s 干净录制仅 ~32KB，字节阈值会误杀真捕获；空壳的真特征是时长看着正常但**帧数极少**

**录中点击回退（SPA 因 `record start` 重挂载）**：`record start`（视口/焦点事件）可能触发 React 等 SPA 重渲染、DOM 重建——录前有效的 ref/eval 全部落空（元素「消失」、ref 几秒内过期）。ref 点击录中失败时改**轮询 eval 点击**：循环 ≤30 次 `{ eval 找元素；找到就 click；等 200ms }`，等重挂载完成后点中（实测第 8~9 次命中）。不要因此停止录制或重启浏览器。代码见 [reference.md](reference.md)「原生 record 成功契约」

```bash
# 录后验收：时长 + 实际帧数（-count_frames 逐帧解算，比体积可靠）
ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 videos/02-xxx.webm
ffprobe -v error -count_frames -select_streams v:0 \
  -show_entries stream=nb_read_frames -of default=nw=1:nk=1 videos/02-xxx.webm
```

**分镜回退**（原生 < 4s 时）：关键步骤 `screenshot` → ffmpeg concat（每帧约 1.5–1.8s）。  
`scale=trunc(iw/2)*2:trunc(ih/2)*2` **必须**（375 奇数宽会导致空 mp4）。

**黑屏两个坑（必读）：**

1. **record 在页面渲染前 start → 开头黑帧。** 先 `open` + `wait` 等页面渲染完成，再 `record start`；不要在 open 之前或同一拍 start。
2. **纯 API case 没有录屏/截图 → 报告引用不存在的媒体 → 播放器黑块。** 每个 case 都必须产出 mp4 或 png（哪怕用终端输出截图做分镜）。生成报告前校验：meta 里每个 id 在 `videos/` 下至少有 `.mp4` 或 `.png`，缺了就补，勿让报告指向空文件。

已知仍易把原生打短、可接受回退的场景：`kill -STOP` API + 长轮询；录中反复 `set viewport`（如 375 移动端）。

#### agent-browser 操作要点

- **写脚本前先过一遍命令速查**（[reference.md](reference.md) 开头「最小命令速查」，或 `agent-browser skills get core`）：`@` 只配 ref（`@e3`）、CSS 选择器不带 `@`、`eval` 的 JS 用双引号包裹、读文本用 `get text body`（没有裸 `body` 命令）
- **浏览器只经 `createBrowser`**：`browser.run(caseId, ["open", url])` 等；库自动 `--session` + `--profile`。结束 `browser.closeSession(caseId)`。套件级清理**只** `tple-browser suite-boot|suite-teardown`
- **输入用 `fill @ref text`**（自带清空）；失败再用页面内设 value + `input`/`change` 事件  
  - **禁止** `press Meta+a` / `Cmd+A`：按键可能漏到 macOS 前台（曾误出「关于本机」等系统窗）
- 登录态：报告类已登录 SPA 在 `record start` 后必须执行站点专属的录制 context 初始化（`eval` 写回 token / JS 可写 cookie → `location.reload()`）；选项 A/B 的 profile 由 `.tple-browser.json` + 库注入，**禁止**漏带或中途删 profile
- 页面变化后重新 `snapshot -i` 再点 ref
- **操作前双通道判断（screenshot + DOM）**：决策点（导航后、关键/破坏性操作前、DOM 与预期不符时）先 `screenshot` 看页面再 `snapshot -i` 拿 ref，**综合判断后动手**——截图负责「页面什么状态、什么可见、有无遮罩/loading/灰态/canvas 内容」，DOM 负责「用哪个 ref 操作」。两通道冲突时信截图的可见性（DOM 有按钮但被 modal 盖住 → 先关遮罩，不硬点 ref）、信 DOM 的可操作性。a11y 树看不透（canvas/自绘控件）用 `screenshot --annotate`，编号 `[N]` 对齐 `@eN`。判断性截图放 `record start` **之前**，录中仍只做 click/fill/wait（见录屏成功契约）；决策点截，不逐原子操作截（多模态 token/时延成本）。展开见 [reference.md](reference.md)「操作前双通道判断」
- 断言：`get text body` / snapshot；结果写入 `meta.jsonl`：`id|title|PASS|notes`
- **断言防假阳性**：命令报连接错误 / 页面为空时，判 BLOCKED 或重试，不能按「数据无变化」判 PASS（曾把 eval 连接失败误判成校验生效）
- 同步更新 `runs.json`：该 case 的 `lastRanAt`（ISO）与 `runCount`（累加）；报告展示「最后跑 / 共跑 N 次」。顶层 `usage` 在出报告前另写（见 Step 6），`logCase` 不得抹掉它
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

**已知坑：自定义组件只认真实鼠标事件**（实测：TikTok Symphony Creative Studio 的 Terms & Conditions 弹窗，Accept 按钮是自定义元素 `KS-BUTTON`/`KS-MODAL`、class 含 `Ks*`，`el.click()` 返回 "clicked"、snapshot ref 点击也无效——事件绑定校验 `isTrusted`，程序化 click 不触发 React 合成事件）。CSS/ref 点击后效果验证不过、且元素是自定义组件（tagName 带连字符，或类名特征如 `Ks*`）时，改**坐标鼠标点击**：`eval` 拿按钮中心坐标 → `agent-browser mouse move <x> <y>` → `mouse down` → `mouse up`（CDP 可信事件）。不要先怀疑风控。

**已知坑：瞬态菜单（flyout/下拉）在两次命令之间就消失**（实测：Tools → Translate & dub 菜单，点开后的下一次 snapshot 里已不见）。菜单项要点，须在**同一拍**内 `eval` 拿坐标 + 坐标点击；或跳过菜单，直接用已知的目标页 URL 导航（如 `/onboard/<tool>`）。

**连续两次「点击无效果」时，先回到基本事实**（元素在哪、可不可见、点没点上、坐标在不在视口内），不要急着归因到外部系统（风控、反自动化、第三方故障）。从「沉默」里编理论，是最贵的错误。

#### 【调研模式】行为规范（对外站必须遵守）

1. **实际走核心功能，真实动作过同意层**：调研要实际走一遍产品核心功能（使用场景、操作方法、交付结果）——创建/编辑/生成内容、体验完整流程、记录交付结果（生成物、导出结果等）默认允许。**真实支付/下单、删除、大量注册、对外发送（发邮件、公开发布、第三方付款）需用户明示**；表单可填到「提交前一步」截图，点最终提交/购买/删除按钮需用户明示。
2. **登录态**：用户提供账号密码时，用 `fill` 登录并继续；未提供凭据则只走公开路径，并在报告 lede/env 明确标注「未登录态调研」。登录凭据只用于本次调研，不写入报告正文（env 里只写「账号：用户提供」）。
3. **节流**：同一页面访问一次即可，不刷量、不并发轰炸；尊重目标站负载。探索与录屏的访问节奏以「人能看清」为准。
4. **点击纪律继续适用**：视口检查、点击后验证对外站更重要——外站点不中更难归因，先回基本事实。
5. **遇阻如实记录**：验证码 / 付费墙 / 401/403 反爬拦截 → 记 `BLOCKED`，notes 写实际看到的现象（如「出现 hCaptcha 验证码」），不停摆、不瞎猜原因、不尝试绕过反爬。

---

### 4. 串行派发 case subagent 与校验

编排 agent **不得**在本会话内逐 case 点完浏览器；必须为每个 case 派发独立 subagent（或独立会话）。

```bash
# subagent 内唯一执行入口（示例）
CASE_ID=01-login node docs/<slice>-e2e/run-cases.mjs

# 编排在全部 subagent 结束后做媒体校验
for f in docs/<slice>-e2e/videos/*.mp4; do
  ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$f"
done
```

**派发循环（编排）：**

```
for each case id in 清单（按 id 排序）:
  1. （可选）轻量确认无残留：仅 close 已知死 session；勿在 subagent 仍可能存活时盲目 pkill
  2. 派发 subagent，提示词含：CASE_ID、title、steps/expected、报告目录、SKILL_DIR、禁令、WEB_URL/登录态 flag
  3. 等待结束；断言产出：meta.jsonl 有该 id 一行（pipe 格式）；videos/<id>.mp4|webm|png 至少满足媒体门闩
  4. 若缺媒体 / meta 格式错误 → 编排修复脚本或补派，不得默认可过
全部完成后编排跑 ffprobe 汇总；缺视频或 duration≈0 → 重派该 case，勿只改 HTML
```

- AuthGate 类 case 后确认 API 未停在 `STOP`
- Subagent 回报格式：`SUBAGENT_DONE <id> <PASS|FAIL|BLOCKED|OBSERVE>`

**status 状态集**：验收模式用 `PASS | FAIL | BLOCKED`；调研模式另允许 `OBSERVE`（观察项：不是对错判定，是产品亮点/疑点记录，如「定价页未展示退款政策」）。`meta.jsonl` 写入规则不变（一行一记录，notes 清洗），见 [reference.md](reference.md)。

**【调研模式】FAIL 语义不同**：FAIL = 「这条路径走不通」，是调研发现（如「注册需邮箱验证无法继续」），不是要修的 bug。

---

### 5. auto-fix loop（编排改代码 + 重派 FAIL subagent）【仅验收模式】

**调研模式跳过本步骤**：不改本地项目内容；目标站上的操作按行为规范的同意层执行（核心功能默认、真实/对外动作需明示）。FAIL case 保留原状态与 notes，直接进 Step 6 生成调研报告；「走不通的原因」本身就是调研产出。

跑完 Step 4 后，如果 `meta.jsonl` 中存在 `FAIL` 状态的 case，由**编排 agent（或单一 Fixer 会话）**进入自动修复循环。**禁止**让失败 case 的 subagent 自己改业务代码。

#### 循环逻辑

```
round = 0
while FAIL count > 0 and round < 3:
    round += 1
    for each FAIL case:
        1. 收集证据（见下）
        2. 分析根因
        3. 编排用 Edit/Write 改项目代码（必要时只改 run-cases 中该 case 片段）
        4. 记录本轮到 fixLog[]（必填 bug + fix；并更新 case 级 bug/fix 汇总）
    5. 重启 dev server（如需要）
    6. 仅重派本轮涉及的 FAIL case subagent（CASE_ID=…；不跑全量、不并行）
    7. 汇总更新后的 meta.jsonl
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

1. **agent-browser 输出**：该 case subagent 日志 / run-cases stderr/stdout，特别是 selector not found、timeout、console error
2. **失败帧截图**：`videos/{id}-fail.png`（如果有）
3. **视频末帧**：`videos/{id}.mp4` 的最后一帧（用 ffmpeg 提取）
4. **页面快照**：FAIL 时 subagent 或编排立即 `agent-browser snapshot` 拿到的 a11y tree 文本
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

**出报告前：写入本次 TPLE 的 token 用量**（验收 / 调研均适用）。用量 = **编排会话 + 所有 case subagent 会话**的合计（含 auto-fix 重派），不是「最后一个 session」。

```bash
# 若宿主能一次取到合计（例如仅一条编排会话且未真正派发——非法，应避免）：
node $SKILL_DIR/scripts/collect-usage.mjs --dir docs/<slice>-e2e

# 多 subagent 时：对每个 case session / 编排 session 分别采集后把 input/output/cacheRead/total 相加写入 runs.json.usage
# source 用 ccusage / transcript / opencode-local 等真实来源；可在 note 字段标明 session 列表
# 嵌套宿主误判时加：--agent opencode|claude --cwd <项目根>
```

降级顺序（**禁止估算、禁止从 case 数倒推**）：

1. **ccusage**（优先）：按 agent 取 session 列表，**累加**本次编排标题 / `tple-case-*` / 派发时记录的 sessionId
2. **本地账本**：各 session 本地 usage 相加 → `source: "transcript"` / `"opencode-local"`（合计时可在 `usage.note` 写 `sum of N sessions`）
3. **不支持**：拿不到任何会话计量 → **不写** `runs.json.usage`（报告头省略用量行；禁止编造，也不渲染「不支持」提示）

字段形如 `{ input, output, cacheRead, total, source }`（有用量时至少 `total` + `source`）。`usage` 是**编排 + 全部 case subagent（含重派）**合计，不是单个 case。实现见 [reference.md](reference.md) 与 `scripts/lib/token-usage.mjs`。

**更稳的方案：视觉以仓库内文件为准，禁止临场重设计。**

| 文件 | 作用 |
|------|------|
| [assets/report.css](assets/report.css) | 唯一允许的样式（stone + 暖橙 accent） |
| [templates/report.html](templates/report.html) | 壳：侧栏 + main + summary |
| [templates/case-section.html](templates/case-section.html) | 单 case 区块 |
| [scripts/build-report.mjs](scripts/build-report.mjs) | 读 meta → 内联 CSS → 写出 `index.html` |

```bash
# 可选：cases.json 提供 uc/steps/expected
node $SKILL_DIR/scripts/build-report.mjs \
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
node $SKILL_DIR/scripts/build-report.mjs \
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
- **信息结构**：brand → CASES 锚点列表 → h1 / lede / meta（含可选 Token 用量行）→ 汇总 chips → 每 case 卡片（左文案右媒体）
- **色板**：`--ink #1c1917`、`--bg #f5f5f4`、`--accent #9a3412`；PASS 绿 / FAIL 红 / BLOCKED 琥珀
- **字体**：IBM Plex Sans + Noto/PingFang；备注用 mono + `.notes` 浅底块
- **背景**：双径向暖灰渐变叠在 stone 底上（见 CSS），不要改成紫渐变 / 纯白扁平 / 深色主题
- **媒体**：`video` 黑底、`aspect-ratio 16/10`、`object-fit: contain`；截图两列 grid
- **状态**：nav `.dot`、chip、badge 三处状态色必须同步（class：`pass|fail|blocked`；调研模式另有 `observe`）
- **自包含**：CSS **内联进** `index.html`（`file://` 可开）；视频相对路径 `videos/...`

详细 token 与 DOM 约定见 [design.md](design.md)。

---

### 7. 分发

报告目录（默认 `.tple/<slice>-e2e/`，或仓库约定的 `docs/...`）是自包含的（CSS 内联、视频相对路径），直接本地打开 `index.html` 即可验收。【调研模式】报告目录建议用 `.tple/research-<域名>/`，与验收报告区分。跑中沉淀的可复用经验写入工作根 `tple-memory.md`，不要改 SKILL.md。

如需分享：把整个目录（含 `videos/`）压缩或上传到任意静态托管。注意保持 `videos/` 相对路径不变；若托管端需要绝对路径，需自行调整 HTML 中的引用。

---

## 质量门槛（完成前自检）

- [ ] 以编排 + 每 case 独立 subagent 执行（主会话未包办全部 case）
- [ ] 已定位工作根；若有 `tple-memory.md` / `.tple/memory.md` 已先读；本趟可复用经验已追加（未把站点业务断言写进 SKILL.md）
- [ ] 报告目录在 `.tple/<slice>/`（或仓库已约定的 `docs/...`）
- [ ] 编排已跑 `tple-browser suite-boot`（存在 `.tple-browser.json`）；套件结束已 `suite-teardown`；**未**在每个 case 前 purge
- [ ] subagent / run-cases **未**裸调 `agent-browser`、未手写 `ab()`/`purge`；只用 `createBrowser().run` / `closeSession`
- [ ] 环境阶段跑过 `check-update.mjs` 版本自检；落后时已提示用户并可跳过（未静默更新、未因未更新中止流程；--apply 前经用户确认）
- [ ] dashboard 由 suite-boot/teardown 管理（未在 case 中反复 start/stop）
- [ ] 检测到需登录时走了 Step 2.5；选项 A 用 `--mode reuse`；选项 B 走 `login-open`→`login-wait`→`login-done` 且登录后无 headed
- [ ] `check-run-cases.mjs --dir …` 通过后再派发；`run-cases` 含 logCase + `CASE_ID`；subagent 默认不改公共脚本
- [ ] 多数 case 为原生录屏且 duration ≥ 4s；回退 case 在日志里标明
- [ ] 无 `Meta+a` 等易泄漏到系统的快捷键
- [ ] 决策点（导航后/关键操作前/DOM 与预期不符）已先 screenshot + snapshot 双通道判断再动手；判断性截图在 `record start` 之前
- [ ] HTML 可双击打开，侧栏跳转、视频可播；样式来自 `assets/report.css`
- [ ] 出报告前写入多会话合计 `usage`（拿不到则省略、不写 unsupported）；**未估算、未从 case 数倒推**
- [ ] index.html 由 `build-report.mjs` 生成（含 `run-meta` 元素），非手写或自定义 HTML；**生成后跑一遍 `build-report.mjs` 自带的媒体校验**——每个 case 的 poster（`videos/<id>.png`）与 `<video>` source 文件必须存在，缺了会裂图/黑块
- [ ] meta 与页面徽章一致；破坏性操作已恢复
- [ ] 报告写明录屏方式（原生为主 / 个别分镜回退）
- [ ] FAIL 的 auto-fix 由编排/单一 Fixer 改代码后重派 subagent，非多 subagent 并行改仓
- [ ] 【调研模式】核心功能已实际走一遍；真实支付/删除/大量注册/对外发送均经用户明示（未明示的停在提交前一步）
- [ ] 【调研模式】无凭据时报告明确标注未登录态；有凭据时凭据未写入报告正文
- [ ] 【调研模式】验证码/付费墙/反爬记 BLOCKED 并如实记录现象，未尝试绕过
- [ ] 【调研模式】未进入 Step 5 auto-fix，未修改本地项目内容（目标站操作按同意层执行）

## 反模式

| 不要 | 要 |
|------|-----|
| 单 LLM 会话串行包办全部 case（长上下文硬扛） | 编排锁定脚本 + 每 case 独立 subagent 串行派发 |
| case 里裸 `agent-browser` / 手写 `ab()` / 漏 `--profile` | `createBrowser(dir).run`；profile 由状态文件强制注入 |
| case subagent 里 `close --all` / 全局 pkill / `dashboard *` | 只 `closeSession`；套件用 `suite-boot` / `suite-teardown` |
| 每个 case 开始前 purge / 登录后继续 headed | headed 仅 `login-open` 一次；`login-done` 后 headless + 同 profile |
| 为躲 DevTools「ignored」而删掉 `--profile` | 冲突时只允许编排重新 `suite-boot`（带对 profile），禁止漏 flag |
| subagent 改公共 `run-cases.mjs` / 跑别人的 CASE_ID | 只执行 `CASE_ID=<自己>`；脚本变更回传编排 |
| 多个 subagent 同时改业务代码 | 单一 Fixer/编排改代码后重派 |
| 残留 Chrome 不清理就开录（套件级） | 编排 `suite-boot`（含 close --all + 特征 pkill） |
| 跳过 `check-run-cases` 就派发 | 锁定后必须 exit 0 再派发 |
| 检测到落后版本就静默自动更新（`--apply` 不经确认直接跑） | 先提示「当前 vX / 最新 vY」让用户选更新或跳过；确认后才执行更新，跳过照常继续 |
| 未确认就在有本地未提交改动的 skill 仓库上 `git pull` 强拉 | `--apply` 自带脏检查会拒绝；有改动先让用户 commit/stash，或改 zip 覆盖到新目录 |
| 每次调用 TPLE 都强制联网查版本 / 版本查不到就中止流程 | 24h 缓存不重复联网；离线/限流静默降级继续主流程（自检永远退出码 0） |
| 因未更新就中止验收 / 把「落后」当环境故障 | 落后只提示；未更新照常跑完本次 TPLE，报告可注明 skill 版本 |
| 信 `✓ Done` 不验点击效果 | 点击前查元素在不在视口内（不在先 `scrollintoview`），点击后截图/查 URL/查 API 验效果 |
| 视口外的按钮直接 `click @ref` | 先 `scrollintoview @ref` 再点；ref 点击不自动滚动，视口外点击静默落空 |
| 连续失败就归因外部系统（风控/反自动化） | 先回基本事实：元素坐标、可见性、是否在视口内 |
| 因一次 ~1s 空壳就放弃原生 | 先按成功契约重试（subagent 不全局杀进程）；仍短再分镜回退 |
| `record start` 后再 `open` 目标页（0.26.0 断帧捕获，产出空壳 webm） | 录前 open + wait 就位页面再 start；录中只用点击/`back` 移动，token 用 `eval` 写回 |
| `record start` 后假定登录态仍在（新录制 context 常丢 localStorage / JS cookie） | 在录制开始后，经 `eval` 写回站点所需 localStorage 与 `document.cookie`，再 `location.reload()` 当前 URL；不可写的 HttpOnly cookie 改走 profile / 登录流程 |
| 把某站点业务断言/文案坑写进 SKILL.md 反模式表 | 写入工作根 `tple-memory.md`（或当次 `run-cases` 断言）；SKILL 只留通用规则 |
| CSS 选择器 `click` 返回 `✓ Done` 就当点上了 | 部分页面会静默落空；点击后验证 DOM/URL 效果，不过就改 snapshot ref 点击重试 |
| 自定义组件点击无效就归因风控、反复重试 | 元素是自定义组件（tagName 带连字符 / `Ks*` 类名）→ 改坐标鼠标点击：`eval` 拿中心坐标 + `mouse move <x> <y>` → `mouse down` → `mouse up`（CDP 可信事件） |
| 遇阻就重启浏览器（`close --all` + `pkill` 当万能药） | 有状态弹窗（Terms/引导页）在**同一实例内**处理（坐标点击）；`--profile <名字>` 每次启动都重新复制 profile，客户端存储的同意状态从「未同意」重置；套件级重启只由编排做 |
| 被中断的录制不管，或把 `No recording in progress` 当失败 | 每 case 用 `stopRecording()` 防御性清理；它只忽略该预期状态，其他错误仍抛出 |
| `press Meta+a` 清输入框 | `fill` 或页面内设 value |
| 全 suite 共用一个 session 不 close | 每 case 新 session + close |
| 只在聊天里贴 PASS 表 | 产出可打开的 HTML + videos |
| 奇数宽截图直接 x264 | `scale=trunc(iw/2)*2:...` |
| 跑完不管 API STOP | 始终 `kill -CONT` |
| 手写新 HTML 主题 / Tailwind 看板风 | 只用本 skill 的 css + templates |
| 只写 meta.jsonl、跳过 runs.json | 用标准 logCase 同时写两个文件（报告展示「最后跑 / 共跑 N 次」） |
| 估算 token / 只采最后一个 session 当整次用量 | 编排 + 全部 case subagent usage 合计；禁止编数字 |
| FAIL 后人工分析、手动改代码 | 用 Step 5：编排 auto-fix + 重派 subagent（最多 3 轮） |
| 无限制循环修复同一个 case | 连续 2 轮无进展标 BLOCKED，刹车退出 |
| `click @css-selector` / eval 不加引号就开跑 | 先看 reference.md「最小命令速查」：`@` 只配 ref，eval JS 双引号包裹 |
| 清理只 `pkill` 不 `close --all`（编排套件级） | 只用 `tple-browser suite-boot|teardown`（内部先 close --all 再 pkill） |
| 每个 case / 每次重试都 `dashboard stop/start` | dashboard 套件级各一次；与 browser session 独立，stop 不清 cookie |
| 断言命令连接失败仍按「无变化」判 PASS | 数据拿不到判 BLOCKED/重试，防假阳性 |
| 检测到登录墙/401/403 仍静默走公开路径或静默猜登录方式 | 停下走 Step 2.5：列选项问用户（复用 profile / headed 手动登录 / 提供凭据 / 公开路径） |
| 用 `--auto-connect` + `state save` 导 cookie 复用多 profile 登录态 | `Network.getAllCookies` 是 browser 级，混入所有 profile 的 cookie、归属不可控；复用登录态用 `--profile <名字>`（见 reference.md「登录态决策」） |
| `--profile <名字>` 复用真实 Chrome 登录态但不带 `--executable-path` | Chrome for Testing 的 Keychain 密钥（`Chromium Safe Storage`）与真实 Chrome 不同，v10 cookie 静默解不开、登录态全丢；必须 `--executable-path` 指向系统 Chrome |
| 用 `--auto-connect` 重试循环等 CDP 就绪（人机检测/连用户浏览器场景） | M136+ 发现不了端口（无 DevToolsActivePort），每次失败还自动拉起浏览器，权限确认框连弹打断用户；改用显式 `connect <ws-url>`（从 `:9222/json/version` 取）|
| 连接用户真实浏览器不做预检就直接进录屏/轮询主流程 | 首次连接 Chrome 会弹「允许远程控制」，先做一次普通调用完成权限握手、等用户确认，再进主流程 |
| 【调研】未经明示做真实支付/删除/批量注册/对外发送 | 核心功能（创建/编辑/生成）默认实际走；真实支付/删除/大量注册/对外发送需用户明示，表单可填到提交前一步截图 |
| 【调研】走不通就进 auto-fix「修复」 | 调研模式跳过 Step 5；FAIL 是调研发现，notes 记原因即可 |
| 【调研】遇 401/403/验证码就猜「风控针对我们」 | 如实记 BLOCKED + 实际现象；不绕过反爬，不重试轰炸 |
| 【调研】没凭据也硬走登录路径 | 无凭据只走公开路径，报告标注未登录态 |
| 【调研】把用户凭据写进报告正文 | env 只写「账号：用户提供」，凭据不落报告 |

## 依赖工具

- `agent-browser` — 浏览器操作与录屏（公网 npm 包：`npm i -g agent-browser`）
- `ffmpeg` / `ffprobe` — 视频处理（转码、分镜 concat、poster 提取、时长校验）
- `ccusage` — session token 用量采集（`npm i -g ccusage`；出报告前 `collect-usage.mjs`）
- Node.js 18+ — run-cases / build-report / check-env / tple-browser 脚本
- `curl` — check-env 探测目标 web 可达性（macOS/Linux 自带）

运行前检查：`node $SKILL_DIR/scripts/check-env.mjs --url <WEB_URL>`
版本自检（非阻塞）：`node $SKILL_DIR/scripts/check-update.mjs`（落后提示 + 确认后 `--apply`）
浏览器套件：`node $SKILL_DIR/scripts/tple-browser.mjs suite-boot|login-*|suite-teardown --dir …`
run-cases 闸：`node $SKILL_DIR/scripts/check-run-cases.mjs --dir docs/<slice>-e2e`
用量采集：`node $SKILL_DIR/scripts/collect-usage.mjs --dir docs/<slice>-e2e`（build-report 之前）
