# SellX Playwright 单 Case 验收 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 使用 Playwright 完整执行一次 SellX 报告生成，并交付带连续录屏的 TPLE HTML 报告。

**Architecture:** 编排会话只准备并锁定 Runner；独立 case subagent 使用临时 Playwright 依赖和临时 profile 副本执行浏览器流程。Runner 以 DOM/URL 条件判断完成，关闭 context 后校验视频并写入标准 case 元数据，编排最后调用现有报告构建器。

**Tech Stack:** Node.js、Playwright 1.62.1、系统 Chrome、ffprobe、TPLE `build-report.mjs`

## Global Constraints

- 仅执行一个“小米科技采购痛点和决策链”case。
- 登录 profile、认证值和临时 Playwright 依赖不得进入 Git 或报告正文。
- 只有报告完成条件和媒体门槛同时通过才记 PASS。
- case 必须由独立 subagent 执行。

---

### Task 1: 准备单 Case Runner

**Files:**
- Create: `.tple/sellx-playwright-e2e/run-cases.mjs`
- Create: `.tple/sellx-playwright-e2e/cases.json`
- Create: `.tple/sellx-playwright-e2e/meta.jsonl`
- Create: `.tple/sellx-playwright-e2e/runs.json`

**Interfaces:**
- Consumes: `CASE_ID=01-generate-report`、`TPLE_PLAYWRIGHT_DIR=/tmp/tple-playwright-test`、现有 `.tple/issue-26-e2e/chrome-profile`
- Produces: `videos/01-generate-report.webm`、`videos/01-generate-report.png`、一行 `meta.jsonl` 和对应 `runs.json` 条目

- [ ] **Step 1: 写 Runner 契约测试**

在 `tests/playwright-sellx-runner-contract.test.mjs` 断言 Runner 使用 `launchPersistentContext`、`recordVideo`、`waitForFunction`、`context.close()` 和 `ffprobe`，且不包含 token/cookie 字段。

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test tests/playwright-sellx-runner-contract.test.mjs`

Expected: FAIL，原因是 `.tple/sellx-playwright-e2e/run-cases.mjs` 尚不存在。

- [ ] **Step 3: 实现最小 Runner**

Runner 必须按以下顺序执行：

```js
const context = await chromium.launchPersistentContext(tempProfile, {
  headless: true,
  executablePath: SYSTEM_CHROME,
  recordVideo: { dir: temporaryVideoDir, size: { width: 1280, height: 800 } },
});
await page.goto("https://sellxagent.com", { waitUntil: "domcontentloaded" });
await page.getByRole("textbox", { name: "输入公司名称或拜访场景" }).fill(prompt);
await page.getByRole("button", { name: "发送" }).click();
await page.waitForFunction(
  () => location.search.includes("session=") &&
    document.body.innerText.includes("快速记忆卡"),
  null,
  { timeout: 600_000 },
);
await page.evaluate(() => window.scrollBy({ top: 500, behavior: "smooth" }));
await page.waitForTimeout(3000);
await page.screenshot({ path: posterPath });
await context.close();
```

关闭后将 `page.video().path()` 对应文件复制为 case WebM，使用 `ffprobe` 验证 `duration >= 4` 且 `frames >= 32`，再写 PASS；异常路径在 `finally` 关闭 context、保存已有视频并写 FAIL。

- [ ] **Step 4: 验证 Runner 契约**

Run: `node --test tests/playwright-sellx-runner-contract.test.mjs && node --check .tple/sellx-playwright-e2e/run-cases.mjs`

Expected: 全部 PASS，语法检查退出码 0。

### Task 2: 派发 Case 并生成 HTML

**Files:**
- Create: `.tple/sellx-playwright-e2e/videos/01-generate-report.webm`
- Create: `.tple/sellx-playwright-e2e/videos/01-generate-report.png`
- Create: `.tple/sellx-playwright-e2e/index.html`

**Interfaces:**
- Consumes: Task 1 Runner
- Produces: 可双击打开的最终验收报告

- [ ] **Step 1: 独立 subagent 执行 case**

Run:

```bash
CASE_ID=01-generate-report \
TPLE_PLAYWRIGHT_DIR=/tmp/tple-playwright-test \
node .tple/sellx-playwright-e2e/run-cases.mjs
```

Expected: `SUBAGENT_DONE 01-generate-report PASS`；超时或站点错误则如实 FAIL。

- [ ] **Step 2: 校验媒体**

Run:

```bash
ffprobe -v error -count_frames -select_streams v:0 \
  -show_entries format=duration:stream=nb_read_frames \
  -of default=nw=1 .tple/sellx-playwright-e2e/videos/01-generate-report.webm
```

Expected: duration ≥ 4，nb_read_frames ≥ 32。

- [ ] **Step 3: 生成并打开报告**

Run:

```bash
node scripts/build-report.mjs \
  --dir .tple/sellx-playwright-e2e \
  --brand "SellX · Playwright 验收" \
  --title "SellX 报告生成验收" \
  --lede "Playwright 复用已登录 profile，生成小米科技采购痛点和决策链报告" \
  --env "sellxagent.com · 已登录 · Playwright 原生录屏" \
  --cases .tple/sellx-playwright-e2e/cases.json
open .tple/sellx-playwright-e2e/index.html
```

Expected: 构建器媒体校验通过，报告视频可播放。
