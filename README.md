# tple-skill

**TPLE** = Test-Proof-Lifecycle-Engineering — 按 case 端到端录屏验收，生成带视频证据的 HTML 报告。

一个 Claude Code / Cursor skill，不是独立应用。

## 它能做什么

1. 定义测试用例（从用户输入、仓库 CSV、或按项目文档自动生成）
2. 用 `agent-browser` 逐 case 录屏执行
3. 录屏过短（< 4s）自动回退分镜截图
4. FAIL case 自动修复（最多 3 轮 analyze → fix → re-test）
5. 生成自包含 HTML 验收报告（侧栏导航 + 视频 + PASS/FAIL/BLOCKED）
6. **产品调研模式**：只给网址、无代码——agent 探索站点出 case 草案，确认后逐 case 录屏，产出带视频的调研报告（只读探索，走不通的路径记为发现，不改任何东西）

## 安装

```bash
# 1. clone
git clone https://github.com/wuzeru/tple-skill.git ~/Documents/skill/tple-skill

# 2. 建软链（Claude Code + Cursor）
ln -s ~/Documents/skill/tple-skill ~/.claude/skills/tple-skill
ln -s ~/Documents/skill/tple-skill ~/.cursor/skills/tple-skill
```

装好后在 Claude Code 或 Cursor 里说 `tple` / `TPLE` / `E2E 录屏验收` 即可触发；产品调研场景说 `调研/研究这个产品` + 给 URL 即进入调研模式。

## 更新

skill 更新 = 指令文档更新，落后版本会带着已修复的反模式/坑继续干活，建议保持最新。

TPLE 流程里 agent 会自动做版本自检（`scripts/check-update.mjs`，24h 内不重复联网、离线静默降级、永不阻塞流程），发现落后会提示你确认后再更新；也可以手动：

```bash
# 版本自检：当前版本 / 最新版本 / 落后摘要
node scripts/check-update.mjs          # --json 机器可读；--force 绕过缓存

# 确认后执行更新（按安装方式自动分流）
node scripts/check-update.mjs --apply
```

- **git clone 安装**（目录含 `.git`）：`--apply` 会先查本地改动——有未提交改动**拒绝拉取只警告**；干净则 `git pull --ff-only`。或直接 `git pull` 亦可
- **zip 安装**（无 `.git`）：`--apply` 下载最新 release zip 覆盖安装（根级布局、不含 CLAUDE.md，你本地新增的文件不受影响）；有 license key 的从 landingpage `/download?license=` 下载后解压覆盖即可
- 两种方式更新后脚本自动重跑 `check-env.mjs` 复检依赖（新版可能引入新依赖）

## 依赖

- `agent-browser`（浏览器操作 + 录屏）
- `ffmpeg` / `ffprobe`（视频处理）
- Node.js 18+

## 目录结构

```
tple-skill/
├── SKILL.md              # Skill 主文件：模式判定 + 7 步工作流（验收/调研双模式）
├── reference.md          # 实现参考：meta.jsonl、runs.json、分镜回退代码
├── design.md             # 视觉规范：色板、布局、DOM 约定
├── assets/
│   └── report.css        # HTML 报告样式（stone paper + 暖橙 accent）
├── templates/
│   ├── report.html       # 报告壳模板（侧栏 + main + lightbox）
│   └── case-section.html # 单 case 区块模板
├── scripts/
│   ├── build-report.mjs  # 报告生成器（读 meta.jsonl → 内联 CSS → index.html）
│   ├── check-env.mjs     # 环境依赖门闩（node/agent-browser/ffmpeg/ffprobe/目标可达）
│   ├── install-deps.mjs  # 缺啥装啥 + 复检
│   └── check-update.mjs  # 版本自检与更新（零依赖、24h 缓存、离线降级）
└── README.md
```

## License

MIT
