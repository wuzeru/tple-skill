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

function readReportScript() {
  return fs.readFileSync(
    path.join(repositoryRoot, ".tple/issue-26-e2e/run-cases.mjs"),
    "utf8",
  );
}

test("录制契约要求在新 context 恢复认证并 reload 当前页面", () => {
  for (const name of ["SKILL.md", "reference.md"]) {
    const document = readDocument(name);

    assert.match(document, /fresh browser context|新录制 context/);
    assert.match(document, /document\.cookie/);
    assert.match(document, /location\.reload\(\)/);
  }
});

test("Issue 26 用例脚本从报告目录引用本仓库浏览器封装", () => {
  assert.match(
    readReportScript(),
    /from "\.\.\/\.\.\/scripts\/lib\/tple-browser\.mjs"/,
  );
});

test("空值 auth_status cookie 仍会恢复到录制 context", () => {
  assert.match(readReportScript(), /hasAuthStatus/);
});

test("Issue 26 用例解包 Agent Browser 返回的 JSON 字符串", () => {
  assert.match(readReportScript(), /parseBrowserJson/);
});

test("SellX 报告页用当前快照解析会话 ref", () => {
  const script = readReportScript();

  assert.match(script, /function getCompletedSessionRef/);
  assert.doesNotMatch(script, /click", "@e20/);
});

test("标准 run-cases 以容错 helper 执行防御性 record stop", () => {
  const reference = readDocument("reference.md");

  assert.match(reference, /function stopRecording/);
  assert.match(reference, /No recording in progress/);
});

test("派发门闩要求录制脚本定义 stopRecording helper", () => {
  assert.match(readDocument("scripts/check-run-cases.mjs"), /stopRecording/);
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
