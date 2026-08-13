# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

**tple-skill 是一个 Agent skill，不是应用。** 没有构建、没有 lint、没有单元测试框架——产物是给 agent 读的指令文档（SKILL.md）+ 零依赖 Node 脚本（check-env / tple-browser / build-report 等）。"跑测试"意味着用被测目标（opencode 或 Claude Code）真实执行 skill 流程并检查产物，见下方「如何测试」。

skill 的能力：按 case 做端到端录屏验收/产品调研，产出带视频的自包含 HTML 报告。双模式（SKILL.md Step 0 判定）：

- **验收模式**：有代码仓库 → 录屏跑 case → FAIL 进 auto-fix loop（先判 product/script；脚本改 run-cases ≤10 轮不进报告，产品改业务代码 ≤3 轮）
- **调研模式**：只给网址无代码 → 探索站点出草案 → 录屏调研 → 禁止改任何东西、禁止真实破坏性提交

## Commands

```bash
# 脚本都零 npm 依赖（仅 Node 内置模块），直接 node 执行
node scripts/check-env.mjs --url <WEB_URL>   # 依赖门闩：node/agent-browser/ffmpeg/ffprobe/ccusage/目标可达；exit 0 = 齐全
node scripts/install-deps.mjs [--dry-run]    # 缺啥装啥（npm 装 agent-browser/ccusage、brew 装 ffmpeg/ffprobe）+ 复检
node scripts/check-update.mjs [--json|--force]  # 版本自检（24h 缓存、离线降级、永不阻塞，退出码恒 0）
node scripts/check-update.mjs --apply        # 确认后更新：git 装→脏检查+ff-only pull；zip 装→release zip 覆盖；之后自动复检依赖
# 用户在 Agent 里输 /tple-skill update：SKILL.md「参数路由」直接走更新流程（check-update --force → --apply），不进常规 TPLE 步骤
node scripts/tple-browser.mjs suite-boot --dir <report> [--mode none|reuse|manual]  # 套件级清理+dashboard+状态文件
node scripts/tple-browser.mjs login-open|login-wait|login-done --dir <report> …     # 选项 B 登录生命周期
node scripts/tple-browser.mjs suite-teardown --dir <report>                        # 套件结束清理
node scripts/check-run-cases.mjs --dir <report>   # 派发前：禁止裸 agent-browser；必须 createBrowser
node scripts/collect-usage.mjs --dir <report-dir>  # 出报告前：ccusage→本地账本→unsupported 写入 runs.json.usage
node scripts/build-report.mjs --dir <report-dir> \
  --brand "…" --title "…" --lede "…" --env "…" [--cases cases.json]
# build-report 生成 index.html 后自动做媒体校验：缺 poster 自动从视频末帧提取；
# mp4/webm/png 全缺 → 退出码 1（这是特性，不要"修复"成静默通过）
```

本仓库无 build/lint。改动后的验证方式 = 用 opencode web 驱动 skill 对真实目标跑一遍完整 TPLE 流程（回归目标：`/Users/zeru/tmp/tple-fixture`，一个埋了空标题 bug 的 Todo app；`node server.mjs` 起在 :4173，demo/demo123）。

## Architecture

**文档层（agent 读的）与脚本层（agent 执行的）职责分离，改一处必须同步另一处：**

- `SKILL.md` — 流程与规则的唯一权威（模式判定、7 步流程、质量门槛、反模式表）。改动行为约定先改这里
- `reference.md` — 实现参考：logCase 标准实现（meta.jsonl + runs.json 双写）、分镜回退代码、agent-browser 命令速查。SKILL.md 引用的硬约束在这里展开
- `design.md` + `assets/report.css` + `templates/` — 报告视觉的唯一来源。**禁止临场重设计**：CSS token、布局骨架、lightbox 结构不得改，只能填文案占位
- `scripts/` — build-report、collect-usage、tple-browser（套件生命周期）、check-run-cases、check-env、install-deps、lib/token-usage.mjs、lib/tple-browser.mjs
- `docs/<target>/` — 历史实测产物（也是回归样本）：`research-the-internet.herokuapp.com/` 是调研模式的完整实测，`ab-rec-opencode-web/` 是录屏能力实测

**报告数据流**：编排定位工作根（先读 `tple-memory.md`）→ `tple-browser suite-boot`（报告目录默认 `.tple/<slice>/`）→ 锁定 `run-cases.mjs`（`check-run-cases`）→ **按 case 串行派发 subagent**（`createBrowser` 写 meta/runs）→ 编排汇总、auto-fix、`suite-teardown`、多会话 `usage` → `build-report.mjs`；可复用经验追加 `tple-memory.md`（不写回 SKILL）。

禁止单 LLM 会话包办全部 case。套件级清理/dashboard **只**经 `tple-browser` CLI；subagent 只用 `createBrowser().run` / `closeSession`。

## 测试方法（血泪沉淀，务必遵守）

用 **opencode web** 驱动 skill 做回归：目标目录起 `opencode web --port 4096`，项目根 `opencode.json` 设 `"permission": "allow"` 免权限弹窗卡自动化（schema 合法值：`ask|allow|deny`）。关键机制：

1. **录屏设施必须与被测 agent 隔离**：被测 agent 跑 skill 的清理步骤会 `pkill agent-browser`——绝不能用 agent-browser 给被测过程录屏。录屏用 ffmpeg 屏幕录制（`-f avfoundation`），观看用独立 user-data-dir 的 Chrome 窗口
2. **ffmpeg 屏幕设备索引必须运行时解析**（`-list_devices` 找 "Capture screen"），shell 和 node 子进程里索引会漂移；多屏环境先按 PID 用 osascript 把观看窗口强制摆到目标屏并验证坐标，再开录
3. **断言用外部事实**：REST API 消息（opencode web 有完整 HTTP API：`POST /session`、`prompt_async`、`GET /session/{id}/message`）、文件系统落点、退出码；不信模型自报。断言只读 assistant 消息（用户消息含 skill 全文会污染匹配）
4. **模拟缺依赖**：受限 PATH shim 目录（只放允许的符号链接，不含 /opt/homebrew/bin）；npm 自动安装用 `npm_config_prefix` 指到 PATH 内的可写落点，坏件（离线 npm）模拟安装失败
5. **skill 的 Step 1 case 门闩会停下等确认**，自动化回归的提示词要自确认（「case 清单我已确认过，直接开跑」）；并写明「**必须按编排+subagent 派发，禁止主会话包办全部 case**」

## 发布与交付

zip 交付到 R2 私有桶 `tple-skill-packages`（对象 key 固定 `tple-skill.zip`），landingpage 站的 `/download?license=` 校验 key 后流式返回——桶私有、无公开 URL，key 校验即访问控制，**不需要配任何下载地址环境变量**。

- **自动发版**：merge 到 main 触发 `.github/workflows/release.yml`：patch+1 打 `vX.Y.Z` tag → 打包 zip（根级布局 + VERSION 文件：tag/commit/时间戳）→ 传 R2（`tple-skill.zip` 覆盖 latest + `tple-skill-vX.Y.Z.zip` 版本归档）→ GitHub Release。需 repo secrets：`CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN`（R2 写权限）
- **手动兜底**（CI secret 没配时）：
  ```bash
  zip -r /tmp/tple-skill.zip README.md SKILL.md reference.md design.md scripts templates assets -x '*.DS_Store'
  CLOUDFLARE_ACCOUNT_ID=<account-id> wrangler r2 object put tple-skill-packages/tple-skill.zip --file /tmp/tple-skill.zip --remote
  ```
- zip 是**根级布局**（README.md 在顶层，无外层目录），与历史手工包一致；**不含 CLAUDE.md**（仓库内部文档，不交付）
- R2 写入有短暂传播窗口：put 后立刻 get 可能报 "key does not exist"，等 1-2 分钟再验

## Conventions

- 分支流程：main 保护 → 新分支开发 → `gh pr create` → 等 Copilot review（inline 评论逐条处理，`gh api pulls/{n}/comments --paginate` 才算数）→ **合并前必须征得用户明确同意**——agent 不得以任何方式自行合并到 main（`gh pr merge`、GitHub API、直接 push main 都不行；squash 合并本身由用户执行）。教训：PR #9 未经确认被擅自合并 main，用户要求后以 revert PR 回滚。PR 模板见 finish-issue-pr skill
- **meta.jsonl 一行一记录是硬约束**：notes 写前必须清洗（换行折叠成空格、`|` 替换、截断 ~300 字符）
- SKILL.md「反模式表」是回归测试的负样本清单，新增已知坑就往里加一行
- 提交信息中文，说清用户可感知的结果；Co-Authored-By: Claude Fable 5

