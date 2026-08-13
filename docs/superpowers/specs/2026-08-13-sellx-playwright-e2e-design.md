# SellX Playwright 单 Case 验收设计

## 目标

用 Playwright 复用现有 SellX 登录 profile，完整执行一次“小米科技采购痛点和决策链”报告生成流程，并产出可播放视频与 TPLE HTML 报告，以验证 Playwright 是否能替代不稳定的 `agent-browser record`。

## 范围

- 仅运行一个报告生成 case。
- 使用临时 Playwright Runner，不修改当前 TPLE 浏览器抽象。
- 产物写入 `.tple/sellx-playwright-e2e/`，登录 profile、依赖和认证值不提交。

## 执行流程

1. 用 `launchPersistentContext` 打开现有 SellX profile，并在创建 context 时启用 `recordVideo`。
2. 打开 SellX 首页，创建新简报并输入“帮我查一下小米科技，重点看采购痛点和决策链”。
3. 以页面可观察条件轮询完成状态：URL 包含 `session`，且报告关键区块已渲染。
4. 完成后滚动报告并停留三秒，关闭 context 使视频落盘。
5. 用 `ffprobe` 校验时长和帧数，保存结束帧与 case 元数据。
6. 调用现有 `build-report.mjs` 生成自包含 HTML 报告。

## 成功与失败

- PASS：报告完成条件成立，视频时长不少于 4 秒且帧数连续，HTML 媒体校验通过。
- FAIL：页面明确报错、报告未在超时内完成，或媒体不合格。
- 无论结果如何都关闭 context、保存视频，并确保认证值不进入报告产物。

## 隔离

Runner 由独立 case subagent 执行。Playwright 依赖安装在临时目录，报告目录只保留脚本、case 数据和媒体，不改变仓库零依赖约定。
