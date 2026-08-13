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

test("SKILL 与 reference 要求 auto-fix 先判定 product / script 根因", () => {
  for (const name of ["SKILL.md", "reference.md"]) {
    const document = readDocument(name);
    assert.match(document, /product/);
    assert.match(document, /script/);
    assert.match(document, /根因/);
  }
});

test("脚本修复最多 10 轮，产品修复维持 3 轮", () => {
  for (const name of ["SKILL.md", "reference.md"]) {
    const document = readDocument(name);
    assert.match(document, /10/);
    assert.match(document, /脚本/);
    assert.match(document, /3/);
    assert.match(document, /产品/);
  }
  const skill = readDocument("SKILL.md");
  assert.match(skill, /脚本[^。]{0,40}10/);
  assert.match(skill, /产品[^。]{0,40}3/);
});

test("脚本轮次禁止写入报告用的 bug / fix / fixLog 与最终 notes 修复叙事", () => {
  const skill = readDocument("SKILL.md");
  const reference = readDocument("reference.md");
  for (const document of [skill, reference]) {
    assert.match(document, /script-fix-log/);
    assert.match(document, /不写入/);
  }
  assert.match(skill, /fixLog/);
  assert.match(skill, /meta\.jsonl/);
  assert.doesNotMatch(
    skill.split("### 5. auto-fix")[1]?.split("### 6.")[0] || skill,
    /while FAIL count > 0 and round < 3/,
  );
});

test("连续 2 轮 notes 无变化仍可标 BLOCKED", () => {
  for (const name of ["SKILL.md", "reference.md"]) {
    const document = readDocument(name);
    assert.match(document, /连续 2 轮/);
    assert.match(document, /BLOCKED/);
  }
});

test("build-report 忽略纯脚本 fixLog", () => {
  const builder = readDocument("scripts/build-report.mjs");
  assert.match(builder, /cause/);
  assert.match(builder, /script/);
  assert.match(builder, /productFixLog|isScriptFix|hasProductFix/);
});
