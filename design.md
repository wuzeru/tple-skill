# tple-skill Design Spec

规范来源：Issue #27 E2E 录屏验收 HTML（`docs/issue27-e2e/index.html`）。  
**实现时直接使用 [assets/report.css](assets/report.css) + [templates/](templates/)，本文件只作核对清单。**

## 视觉方向

- 浅色 stone 纸感，非深色、非紫靛渐变、非奶油+衬线+陶土那套 AI 默认审美
- 暖橙 accent（`--accent: #9a3412`）只用于 brand 标题，不铺大面积
- 背景：左上暖橙淡晕 + 右上冷灰淡晕 + `#f5f5f4` 底
- 圆角卡片（16px）+ 极轻阴影；状态用小圆点 / pill，不堆 emoji

## Token

| Token | Value | 用途 |
|-------|-------|------|
| `--ink` | `#1c1917` | 正文 |
| `--muted` | `#57534e` | 次要文字、eyebrow、h3 |
| `--line` | `#e7e5e4` | 边框 |
| `--bg` | `#f5f5f4` | 页面底 |
| `--panel` | `#ffffff` | case 卡片 |
| `--accent` | `#9a3412` | brand strong |
| `--ok` / `--ok-bg` | `#15803d` / `#dcfce7` | PASS |
| `--fail` / `--fail-bg` | `#b91c1c` / `#fee2e2` | FAIL |
| `--blocked` / `--blocked-bg` | `#a16207` / `#fef3c7` | BLOCKED |
| `--observe` / `--observe-bg` | `#0e7490` / `#cffafe` | OBSERVE（调研模式观察项） |
| `--font` | IBM Plex Sans, Noto Sans SC, PingFang SC, system-ui | UI |
| `--mono` | IBM Plex Mono, ui-monospace | `.notes` |

## 布局

```
┌────────────┬─────────────────────────────┐
│ brand      │ h1                          │
│ CASES      │ lede + meta                 │
│ · 01 …     │ chips PASS/FAIL/BLOCKED     │
│ · 02 …     │ ┌ case card ─────────────┐  │
│            │ │ eyebrow + title + badge│  │
│ sticky     │ │ steps | video          │  │
│ 280px      │ │ expect| shots          │  │
│            │ └────────────────────────┘  │
└────────────┴─────────────────────────────┘
```

- `.shell`：`grid-template-columns: 280px minmax(0, 1fr)`
- `.grid`（case 内）：`1fr 1.2fr`（文案 | 媒体）
- `<960px`：单列；nav 取消 sticky

## DOM 约定

### Nav item

```html
<a href="#01-login" class="nav-item pass">
  <span class="dot"></span>01-login · 登录成功进入工作台
</a>
```

`pass|fail|blocked|observe` 写在 `.nav-item` 上，驱动 `.dot` 颜色（`observe` 仅调研模式用）。

### Header meta

`main` 内 h1 / lede 之后是 `.meta` 行：环境（生成时间 + `--env`）、录屏说明；若 `runs.json` 有顶层 `usage`：有 `total` 则渲染 Token 用量数字行，`source=unsupported` 则渲染「当前 agent 不支持 token 消耗采集」。无 usage 字段时不渲染该行（老报告兼容）。只加文案行，不改布局/色板。

### Case section

顺序固定：eyebrow（`UC · id`）→ `h2` → `.run-meta`（最后跑时间 · 共跑次数）→ badge → 步骤 / 期望 / 结果备注 → 录屏 video → 关键帧截图。

- `h3`：uppercase 小标签（步骤 / 期望 / 结果备注 / 录屏 / 关键帧截图）
- `.notes`：等宽 + 浅底，放原始结果串
- `.run-meta`：等宽小字，来自 `runs.json` / meta 可选列
- 有修复时：`.fix-log` 展示「Bug 点 / 修复方案」双栏 + 可选分轮次（数据来自 `cases.json` 的 `bug`/`fix`/`fixLog`）
- `video`：`controls playsinline preload="metadata"` + poster png；source 顺序 mp4 → webm
- 关键帧：`.shot-zoom` 可点击放大（lightbox）；可选 `videos/{id}-fail.png` 作为「失败中间态」第二张图

### Summary chips

```html
<span class="chip pass">PASS N</span>
<span class="chip fail">FAIL N</span>
<span class="chip blocked">BLOCKED N</span>
<!-- 调研模式且存在 OBSERVE case 时追加 -->
<span class="chip observe">OBSERVE N</span>
<span class="chip">合计 N</span>
```

## 禁止改动

- 不要换成 Inter/Roboto 默认栈主导
- 不要深色 mode、紫 glow、大面积卡片阴影层叠
- 不要 dashboard 多栏 KPI；第一屏就是 brand + 汇总 + case 流
- 不要外链 stylesheet（必须内联，保证 `file://`）
- 不要把视频改成仅 gif / 仅外链云播放器（本地相对路径优先）
