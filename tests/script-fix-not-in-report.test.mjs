import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const builder = path.join(repositoryRoot, "scripts/build-report.mjs");

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function section(html, id) {
  const start = html.indexOf(`id="${id}"`);
  assert.ok(start >= 0, `missing section ${id}`);
  const next = html.indexOf('class="case"', start + 1);
  return html.slice(start, next === -1 ? undefined : next);
}

function buildReport(cases, metaLines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tple-script-fix-report-"));
  try {
    fs.mkdirSync(path.join(dir, "videos"));
    fs.writeFileSync(path.join(dir, "cases.json"), JSON.stringify(cases, null, 2));
    fs.writeFileSync(path.join(dir, "meta.jsonl"), metaLines.join("\n") + "\n");
    for (const id of Object.keys(cases)) {
      fs.writeFileSync(path.join(dir, "videos", `${id}.png`), PNG_1X1);
    }

    const result = spawnSync(process.execPath, [builder, "--dir", dir], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return fs.readFileSync(path.join(dir, "index.html"), "utf8");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("纯脚本 fixLog 不渲染修复说明，case 仍按产品结果展示 PASS", () => {
  const html = buildReport(
    {
      "01-profile": {
        uc: "UC-1",
        steps: "填写行业并保存",
        expected: "行业字段为「物流」",
        cause: "script",
        bug: "locator 太宽，读到了自定义行业",
        fix: "收窄 locator；切 Tab 后等待 hydrate",
        fixLog: [
          {
            round: 1,
            cause: "script",
            bug: "locator 太宽",
            fix: "改 locator",
            files: ["run-cases.mjs"],
          },
          {
            round: 2,
            cause: "script",
            bug: "结束停留太短",
            fix: "补 completionCheck",
            files: ["run-cases.mjs"],
          },
        ],
      },
    },
    ["01-profile|画像保存|PASS|行业字段已按期望写入物流"],
  );

  const block = section(html, "01-profile");
  assert.match(block, /行业字段已按期望写入物流/);
  assert.match(block, />PASS</);
  assert.doesNotMatch(block, /修复说明/);
  assert.doesNotMatch(block, /Round /);
  assert.doesNotMatch(block, /locator/);
  assert.doesNotMatch(html, /自动修复/);
});

test("仅 run-cases.mjs 的 fixLog 即使未标 cause 也不进报告", () => {
  const html = buildReport(
    {
      "02-strict": {
        uc: "UC-2",
        steps: "打开详情",
        expected: "详情标题可见",
        bug: "getByText 命中摘要和详情两处",
        fix: "改 getByRole",
        fixLog: [
          {
            round: 1,
            bug: "getByText 触发 strict mode",
            fix: "改用 getByRole",
            files: ["docs/slice/run-cases.mjs"],
          },
        ],
      },
    },
    ["02-strict|详情标题|PASS|详情标题可见"],
  );

  const block = section(html, "02-strict");
  assert.doesNotMatch(block, /修复说明/);
  assert.doesNotMatch(block, /strict mode/);
  assert.doesNotMatch(html, /自动修复/);
});

test("产品 bug 的 fixLog 仍出现在报告里", () => {
  const html = buildReport(
    {
      "03-validate": {
        uc: "UC-3",
        steps: "空表单提交",
        expected: "出现必填校验",
        cause: "product",
        bug: "空提交无校验提示",
        fix: "补 onSubmit 必填校验",
        fixLog: [
          {
            round: 1,
            cause: "product",
            bug: "空提交无校验提示",
            fix: "补 onSubmit 必填校验逻辑",
            files: ["src/components/Dialog.tsx"],
          },
        ],
      },
    },
    ["03-validate|空提交校验|PASS|修复 1 轮: R1=补 onSubmit 校验逻辑"],
  );

  const block = section(html, "03-validate");
  assert.match(block, /修复说明/);
  assert.match(block, /空提交无校验提示/);
  assert.match(block, /补 onSubmit 必填校验/);
  assert.match(html, /自动修复 1 个 FAIL/);
});

test("混合 fixLog 只展示产品轮次，脚本轮次从报告消失", () => {
  const html = buildReport(
    {
      "04-tab": {
        uc: "UC-4",
        steps: "切 Tab 后回显行业",
        expected: "行业仍为物流",
        bug: "hydrate 把已填行业清空",
        fix: "hydrate 后保留已填字段",
        fixLog: [
          {
            round: 1,
            cause: "script",
            bug: "切 Tab 后立刻读值",
            fix: "等待 hydrate",
            files: ["run-cases.mjs"],
          },
          {
            round: 2,
            cause: "product",
            bug: "hydrate 把字段清空",
            fix: "保留已填行业",
            files: ["src/profile.tsx"],
          },
        ],
      },
    },
    ["04-tab|切 Tab 回显|PASS|行业字段回显正确"],
  );

  const block = section(html, "04-tab");
  assert.match(block, /修复说明/);
  assert.match(block, /保留已填行业/);
  assert.doesNotMatch(block, /等待 hydrate/);
  assert.doesNotMatch(block, /立刻读值/);
});

test("脚本污染的「修复 N 轮 locator」notes 不进 HTML", () => {
  const html = buildReport(
    {
      "05-notes": {
        uc: "UC-5",
        steps: "保存画像",
        expected: "保存成功",
        cause: "script",
        fixLog: [
          {
            round: 1,
            cause: "script",
            bug: "locator 太宽",
            fix: "收窄 locator",
            files: ["run-cases.mjs"],
          },
        ],
      },
    },
    ["05-notes|保存画像|PASS|修复 3 轮: R1=locator 太宽, R2=等待 hydrate, R3=结束停留"],
  );

  const block = section(html, "05-notes");
  assert.doesNotMatch(block, /修复说明/);
  assert.doesNotMatch(block, /修复 3 轮/);
  assert.doesNotMatch(block, /locator/);
});
