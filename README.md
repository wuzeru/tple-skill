# tple-skill

**TPLE** = Test-Proof-Lifecycle-Engineering — 按 case 端到端录屏验收，生成带视频证据的 HTML 报告。

一个 Claude Code / Cursor skill，不是独立应用。

## 它能做什么

1. 定义测试用例（从用户输入、仓库 CSV、或按项目文档自动生成）
2. 用 `agent-browser` 逐 case 录屏执行
3. 录屏过短（< 4s）自动回退分镜截图
4. FAIL case 自动修复（最多 3 轮 analyze → fix → re-test）
5. 生成自包含 HTML 验收报告（侧栏导航 + 视频 + PASS/FAIL/BLOCKED）

## 安装

```bash
# 1. clone
git clone https://github.com/wuzeru/tple-skill.git ~/Documents/skill/tple-skill

# 2. 建软链（Claude Code + Cursor）
ln -s ~/Documents/skill/tple-skill ~/.claude/skills/tple-skill
ln -s ~/Documents/skill/tple-skill ~/.cursor/skills/tple-skill
```

装好后在 Claude Code 或 Cursor 里说 `tple` / `TPLE` / `E2E 录屏验收` 即可触发。

## 依赖

- `agent-browser`（浏览器操作 + 录屏）
- `ffmpeg` / `ffprobe`（视频处理）
- Node.js 18+

## 目录结构

```
tple-skill/
├── SKILL.md              # Skill 主文件：7 步工作流定义
├── reference.md          # 实现参考：meta.jsonl、runs.json、分镜回退代码
├── design.md             # 视觉规范：色板、布局、DOM 约定
├── assets/
│   └── report.css        # HTML 报告样式（stone paper + 暖橙 accent）
├── templates/
│   ├── report.html       # 报告壳模板（侧栏 + main + lightbox）
│   └── case-section.html # 单 case 区块模板
├── scripts/
│   └── build-report.mjs  # 报告生成器（读 meta.jsonl → 内联 CSS → index.html）
└── README.md
```

## License

MIT
