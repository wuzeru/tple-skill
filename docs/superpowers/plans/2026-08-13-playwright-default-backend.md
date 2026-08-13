# Playwright Default Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Playwright 设为 TPLE case 执行与录屏默认后端，并让 check-env 验证 Playwright 模块和 Chromium 均可实际使用。

**Architecture:** 用户级 runtime 保存 Playwright 依赖；共享 runtime 模块负责解析和探测。新的 case 生命周期库直接暴露 Playwright `page`，只封装 TPLE 的 phase、storageState、录屏和清理。现有 agent-browser API 保留为显式 legacy 回退。

**Tech Stack:** Node.js 18+、Playwright、Chromium、ffprobe、node:test。

## Global Constraints

- 仓库和发布 zip 保持零 npm 依赖，不提交 `node_modules`。
- Playwright 默认安装到 `~/.tple/runtime`。
- 认证值不得进入 `meta.jsonl`、`runs.json`、`cases.json` 或 HTML。
- 新生成 case 默认使用 Playwright；agent-browser 仅作探索和兼容回退。
- 不在本计划中删除现有 `createBrowser` API。
- 未经用户明确要求不创建 git commit。

---

### Task 1: Playwright runtime 解析与环境门闩

**Files:**
- Create: `scripts/lib/playwright-runtime.mjs`
- Create: `tests/playwright-runtime.test.mjs`
- Modify: `scripts/check-env.mjs`
- Modify: `scripts/install-deps.mjs`

**Interfaces:**
- Produces: `getPlaywrightRuntimeDir(env?) -> string`
- Produces: `resolvePlaywrightModule(options?) -> { modulePath, packageDir } | null`
- Produces: `loadPlaywright(options?) -> Promise<object>`
- Produces: `probePlaywright(options?) -> Promise<{ ok, info?, hint? }>`

- [ ] 写测试：显式路径优先、用户 runtime 回退、模块缺失、Chromium 启动失败、启动成功后关闭。
- [ ] 运行 `node --test tests/playwright-runtime.test.mjs`，确认因模块不存在而失败。
- [ ] 实现 runtime 路径解析和可注入依赖的真实启动探测。
- [ ] 再运行测试，确认通过。
- [ ] 给 `check-env` 增加硬依赖项 `playwright`，调用 `probePlaywright`，失败提示统一指向 `node scripts/install-deps.mjs`。
- [ ] 给 `install-deps` 增加 `npm install --prefix <runtime> playwright` 和 `npm exec --prefix <runtime> -- playwright install chromium`；dry-run 不写磁盘。
- [ ] 增加脚本契约测试，先失败后实现，再验证 dry-run 输出包含两个官方安装步骤。

### Task 2: Playwright case 生命周期

**Files:**
- Create: `scripts/lib/tple-playwright.mjs`
- Create: `tests/tple-playwright.test.mjs`

**Interfaces:**
- Consumes: `loadPlaywright()`
- Consumes: `.tple-browser.json` 的 `phase`
- Consumes: 可选 `.tple-auth-state.json`
- Produces: `createPlaywrightCase(reportDir, caseId, options?)`
- Produces: `runner.run(callback: ({ page, context, browser }) => Promise<any>)`

- [ ] 写测试：非 run phase 拒绝、认证模式缺 storageState 拒绝、context 带 `recordVideo`、回调异常仍关闭 context/browser、视频在关闭后 `saveAs`、临时目录最终清理。
- [ ] 运行测试，确认因模块不存在而失败。
- [ ] 实现最小生命周期：加载状态、创建 browser/context/page、执行回调、finally 关闭并保存视频。
- [ ] 运行测试，确认通过并保持资源清理顺序。
- [ ] 写 ffprobe 非数值、短时长、少帧测试，再实现共享媒体验收函数。

### Task 3: 登录态导出和 teardown 清理

**Files:**
- Modify: `scripts/lib/tple-playwright.mjs`
- Modify: `scripts/tple-browser.mjs`
- Modify: `scripts/lib/tple-browser.mjs`
- Modify: `.gitignore`
- Test: `tests/tple-playwright.test.mjs`

**Interfaces:**
- Produces: `AUTH_STATE_FILE = ".tple-auth-state.json"`
- Produces: `exportStorageStateFromProfile(reportDir, state, targetUrl, options?)`
- Produces: `removeStorageState(reportDir)`

- [ ] 写测试：manual 绝对 profile 和 reuse profile 名均复制到临时 user-data-dir；复制包含 `Local State` 与选定 profile；原 profile 不被修改。
- [ ] 写测试：导出只写 Playwright storageState，失败时删除半成品，teardown 删除认证文件。
- [ ] 运行测试确认失败，再实现 profile 源解析、临时复制、persistent context 导出和清理。
- [ ] 修改 `login-done --url`：关闭 agent-browser headed daemon后导出 storageState，再进入 run phase；不再为默认后端预热 agent-browser recorder。
- [ ] 修改 `suite-boot mode=reuse`：在给定 URL 后导出 storageState；没有 URL 时明确要求编排在执行认证 case 前调用导出。
- [ ] 修改 `suite-teardown` 删除 storageState，并验证原有状态文件仍写 torn_down。
- [ ] 在 `.gitignore` 中显式忽略 `.tple-auth-state.json`，运行相关测试。

### Task 4: run-cases 双后端静态门闩

**Files:**
- Modify: `scripts/check-run-cases.mjs`
- Create: `tests/check-run-cases-playwright.test.mjs`

**Interfaces:**
- Default contract: import `createPlaywrightCase` from `scripts/lib/tple-playwright.mjs`
- Legacy contract: top-level `const TPLE_BROWSER_BACKEND = "agent-browser-legacy"`

- [ ] 写 fixture 测试：默认 Playwright 通过；裸 `chromium.launch`、裸 agent-browser、认证字段落元数据均失败；显式 legacy + `createBrowser` 通过。
- [ ] 运行测试确认现有门闩拒绝 Playwright fixture。
- [ ] 按 backend 声明拆分规则；默认分支要求 `createPlaywrightCase`，legacy 分支保留原门闩。
- [ ] 运行新测试和现有契约测试。

### Task 5: Skill 契约和示例迁移

**Files:**
- Modify: `SKILL.md`
- Modify: `reference.md`
- Modify: `docs/user-cases.csv`
- Modify: `tests/record-auth-context-contract.test.mjs`

**Interfaces:**
- New generated runner contract: `createPlaywrightCase(...).run(async ({ page }) => ...)`
- Existing report data contract remains unchanged.

- [ ] 先修改文档契约测试，使其要求 Playwright 默认、storageState 恢复、completionCheck、context 关闭后媒体验收和 legacy 显式标记。
- [ ] 运行测试确认旧文档不满足。
- [ ] 修改 SKILL 的依赖、登录、run-cases 骨架、录屏策略、反模式和 checklist。
- [ ] 修改 reference 的命令速查和标准实现；保留 agent-browser legacy 附录。
- [ ] 更新 user case，记录 check-env、默认后端、登录态和 legacy 兼容四项回归。
- [ ] 运行文档契约测试。

### Task 6: 全量验证与真实浏览器 smoke test

**Files:**
- No production file changes unless a failing regression requires a test-first fix.

- [ ] 运行 `node --test tests/*.test.mjs`，要求零失败。
- [ ] 运行 `node scripts/check-env.mjs --url https://sellxagent.com`，确认 Playwright 和 Chromium 实际启动探测通过。
- [ ] 运行 `node scripts/install-deps.mjs --dry-run`，确认已安装环境不会误装；在受限 PATH fixture 中确认缺失时打印正确命令。
- [ ] 为一个最小 Playwright fixture 运行 `check-run-cases`，确认默认后端通过。
- [ ] 用本地静态页运行最小 case，确认视频时长与帧数验收。
- [ ] 检查 `git diff`，确认没有 runtime、认证状态、profile 或 `.tple` 产物进入待提交文件。
