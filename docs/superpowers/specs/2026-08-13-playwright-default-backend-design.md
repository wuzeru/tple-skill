# Playwright 默认浏览器后端迁移设计

## 目标

将 Playwright 设为 case 执行与录屏的默认后端，避免 `agent-browser record` 基于截图轮询造成的间歇性断帧，并通过 `storageState` 稳定恢复已登录 SPA 的认证状态。`agent-browser` 暂时保留用于探索和旧 case 兼容回退。

## 边界

- 不一次性删除现有 `tple-browser`、登录生命周期或旧 `createBrowser` API。
- 不把 npm 依赖写入 skill 仓库或交付 zip。
- 不复制认证值到 `meta.jsonl`、`runs.json`、`cases.json` 或 HTML。
- 每个 case 仍由独立 subagent 串行执行，套件编排与报告数据流保持不变。

## 后端职责

### Playwright（默认）

- case 页面操作；
- completionCheck 轮询；
- context 级 `recordVideo`；
- 失败截图、网络错误摘要与媒体落盘；
- 从套件级 `storageState` 创建隔离 context。

### agent-browser（兼容）

- 前期站点探索；
- 旧 `run-cases.mjs` 的临时回退；
- 迁移期间尚未改写的登录入口。

新生成的 case 不再使用 `agent-browser record`。只有明确标记兼容回退时，静态门闩才允许旧 `createBrowser` 契约。

## 依赖安装与检测

Playwright 安装到用户级 TPLE runtime，而不是仓库：

```text
~/.tple/runtime/node_modules/playwright
~/.cache/ms-playwright/...
```

新增共享解析模块，按以下顺序寻找 Playwright：

1. `TPLE_PLAYWRIGHT_PATH` 显式路径；
2. skill 本地 `node_modules/playwright`（开发与测试）；
3. `~/.tple/runtime/node_modules/playwright`。

`install-deps.mjs` 在缺失时执行 npm prefix 安装，并运行 Playwright 官方 Chromium 安装命令。`check-env.mjs` 不只检查 CLI，而是验证：

1. Playwright 模块可以动态加载；
2. Chromium executable 存在；
3. Chromium 能以 headless 模式启动并关闭；
4. Playwright 版本可读取。

任一项失败都作为硬依赖失败，并打印与 `install-deps` 一致的修复指引。

## 认证状态

套件登录完成后将认证信息保存为报告目录内的私有状态文件，例如 `.tple-auth-state.json`。该文件：

- 只供运行时读取；
- 由 `.gitignore` 覆盖；
- 在构建报告前做 secret 扫描；
- 不嵌入最终 HTML；
- suite teardown 时删除。

Playwright case 使用 `browser.newContext({ storageState, recordVideo })`。每个 case 得到独立 context，避免并发 profile 锁、跨 case tab 污染和登录态写回。

迁移初期，现有 agent-browser 登录流程可通过一次性 Playwright persistent context 读取临时 profile 副本并导出 `storageState`。后续再把 headed 登录入口改为 Playwright 原生流程，不阻塞本次默认后端迁移。

## Case API

新增 `createPlaywrightCase(reportDir, caseId, options)`，负责：

- 校验 suite phase 与认证状态；
- 加载共享 Playwright runtime；
- 启动 Chromium 和隔离 context；
- 自动开启视频；
- 暴露原生 `page` 供语义化 locator 操作；
- 在 `finally` 中关闭 page/context/browser；
- 将临时视频原子移动到规范路径；
- 用 ffprobe 校验时长与帧数。

API 不封装 Playwright locator、expect 或网络 API，避免重新发明一套浏览器 DSL。共享层只管理 TPLE 特有的生命周期、认证、媒体与产物安全。

## 静态门闩

`check-run-cases.mjs` 改为接受两类脚本：

- 默认 Playwright：必须导入 `createPlaywrightCase`，禁止自行 `chromium.launch`、手写 profile 路径或裸调 `agent-browser`；
- 兼容 agent-browser：必须显式声明 legacy backend，并继续遵守 `createBrowser`、`stopRecording` 和 session 门闩。

门闩同时拒绝把 `storageState`、cookie、token 或 profile 内容写入报告元数据。

## 完成条件与失败处理

每个 case 仍必须定义可观察的 `completionCheck`。条件成立后执行一次无副作用的可见页面变化并停留至少三秒，再关闭 context 落盘视频。

失败或超时时也必须：

1. 保存截图与脱敏网络摘要；
2. 关闭 context 使视频落盘；
3. 校验已有媒体；
4. 记录 FAIL/BLOCKED，不因录屏成功误判业务 PASS。

Playwright 录屏本身失败时，仅允许一次同后端重试；之后才进入现有分镜回退。

## 验证

- 单元/契约测试：runtime 解析、check-env 检测、install-deps dry-run、静态门闩、认证文件清理与 secret 安全；
- 回归：现有测试全部通过；
- 真实 E2E：用 SellX 单 case 验证已登录状态、页面完成判断、视频连续帧和 HTML 报告；
- 兼容：至少一个 legacy agent-browser fixture 仍可通过门闩。

## 迁移顺序

1. Playwright runtime 解析、安装与 check-env 检测；
2. Playwright case 生命周期库与测试；
3. 静态门闩双后端支持；
4. SKILL/reference 默认契约切换；
5. SellX E2E 验证；
6. 后续独立任务再移除 agent-browser 录屏与旧后端。
