import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function readDocument(name) {
  return fs.readFileSync(path.join(repositoryRoot, name), "utf8");
}

test("默认录制契约使用 Playwright storageState 和 recordVideo", () => {
  for (const name of ["SKILL.md", "reference.md"]) {
    const document = readDocument(name);

    assert.match(document, /createPlaywrightCase/);
    assert.match(document, /storageState/);
    assert.match(document, /recordVideo/);
  }
});

test("reference 将 agent-browser record 标为显式 legacy 回退", () => {
  const reference = readDocument("reference.md");

  assert.match(reference, /agent-browser-legacy/);
  assert.match(reference, /function stopRecording/);
  assert.match(reference, /No recording in progress/);
});

test("派发门闩默认要求 Playwright 并保留 legacy stopRecording", () => {
  const checker = readDocument("scripts/check-run-cases.mjs");
  assert.match(checker, /createPlaywrightCase/);
  assert.match(checker, /agent-browser-legacy/);
  assert.match(checker, /stopRecording/);
});

test("静态报告页录制在停止前制造可见变化", () => {
  assert.match(readDocument("reference.md"), /可见的页面变化/);
});

test("录制契约以可观察完成条件而非固定等待决定结束", () => {
  for (const name of ["SKILL.md", "reference.md"]) {
    const document = readDocument(name);

    assert.match(document, /completionCheck/);
    assert.match(document, /超时/);
  }
});

test("依赖文档要求 check-env 实际检测 Playwright 和 Chromium", () => {
  for (const name of ["SKILL.md", "reference.md"]) {
    const document = readDocument(name);
    assert.match(document, /check-env/);
    assert.match(document, /Playwright/);
    assert.match(document, /Chromium/);
  }
});

test("build-report 默认录屏说明使用 Playwright", () => {
  const builder = readDocument("scripts/build-report.mjs");
  assert.match(builder, /Playwright context recordVideo/);
  assert.doesNotMatch(builder, /agent-browser 原生 record、每 case 前清理/);
});
