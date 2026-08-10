# tple-skill

**TPLE** = Test-Proof-Lifecycle-Engineering — 按 case 端到端录屏验收，生成带视频证据的 HTML 报告。

一个 skill（Claude Code / Cursor 及任何支持 SKILL.md 约定的 agent 均可），不是独立应用。

## 它能做什么

1. 定义测试用例（从用户输入、仓库 CSV、或按项目文档自动生成）
2. 用 `agent-browser` 逐 case 录屏执行
3. 录屏过短（< 4s）自动回退分镜截图
4. FAIL case 自动修复（最多 3 轮 analyze → fix → re-test）
5. 生成自包含 HTML 验收报告（侧栏导航 + 视频 + PASS/FAIL/BLOCKED）
6. **产品调研模式**：只给网址、无代码——agent 探索站点出 case 草案，确认后**实际走一遍产品核心功能**、逐 case 录屏，产出带视频的调研报告（使用场景、操作方法、交付结果；走不通的路径记为发现；不改本地项目内容、不进 auto-fix）

## 安装

skill 本体位置无关：所有脚本自定位（`scripts/*.mjs` 以自身位置解析）。SKILL.md 内脚本调用一律以 `$SKILL_DIR` 指代「SKILL.md 所在目录」——这是给 agent 看的占位符，agent 加载 skill 时按实际路径解析；你在终端手动跑脚本时 `cd` 到本目录用相对路径即可。因此安装只做一件事——**把本目录放进你的 agent 的 skill 扫描路径**（或等价位置）。

```bash
# 1. clone
git clone https://github.com/wuzeru/tple-skill.git ~/Documents/skill/tple-skill

# 2. 建软链（Claude Code + Cursor 示例）
ln -s ~/Documents/skill/tple-skill ~/.claude/skills/tple-skill
ln -s ~/Documents/skill/tple-skill ~/.cursor/skills/tple-skill
```

**其他 agent**（opencode 等任何支持 SKILL.md skill 约定的）：同理，把本目录（软链或拷贝）放到该 agent 扫描 skill 的目录即可，路径不限；agent 能否自动发现取决于它认不认 SKILL.md 约定，认不了的就按该 agent 自己的方式注册/指向 SKILL.md。

装好后在 agent 里说 `tple` / `TPLE` / `E2E 录屏验收` 即可触发；产品调研场景说 `调研/研究这个产品` + 给 URL 即进入调研模式。

## 更新

skill 更新 = 指令文档更新，落后版本会带着已修复的反模式/坑继续干活，建议保持最新。

**最简单的更新方式：在 agent 里直接说**

```
/tple-skill update
```

agent 会检查最新版本并直接执行更新（git 安装 → ff-only pull；zip 安装 → 下载 release zip 覆盖），更新后自动复检依赖并报告结果；被脏工作区等情况拒绝时会如实告知并给处理选项，不强拉。

TPLE 流程里 agent 也会自动做版本自检（`scripts/check-update.mjs`，24h 内不重复联网、离线静默降级、永不阻塞流程），发现落后会提示你确认后再更新；也可以手动跑脚本：

```bash
# 版本自检：当前版本 / 最新版本 / 落后摘要
node scripts/check-update.mjs          # --json 机器可读；--force 绕过缓存

# 确认后执行更新（按安装方式自动分流）
node scripts/check-update.mjs --apply
```

- **git clone 安装**（目录含 `.git`）：`--apply` 会先查本地改动——有未提交改动**拒绝拉取、列出改动并以退出码 1 报错**（不强拉）；干净则 `git pull --ff-only`。或直接 `git pull` 亦可
- **zip 安装**（无 `.git`）：`--apply` 下载最新 release zip 覆盖安装（根级布局、不含 CLAUDE.md，你本地新增的文件不受影响）；有 license key 的从 landingpage `/download?license=` 下载后解压覆盖即可
- 两种方式更新后脚本自动重跑 `check-env.mjs` 复检依赖（新版可能引入新依赖）

> 注：`/tple-skill update` 依赖本 README 所在版本的 SKILL.md 路由约定；更老的已安装版本还没有这个入口，老版本请先手动 `git pull`（git 安装）或重新下载 zip 覆盖（zip 安装）一次，之后即可用 `/tple-skill update`。

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
