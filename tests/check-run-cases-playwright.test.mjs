import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const checker = new URL("../scripts/check-run-cases.mjs", import.meta.url);

function check(source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tple-run-case-check-"));
  const file = path.join(dir, "run-cases.mjs");
  fs.writeFileSync(file, source);
  return spawnSync(process.execPath, [checker.pathname, "--file", file], {
    encoding: "utf8",
  });
}

test("默认 Playwright runner 通过门闩", () => {
  const result = check(`
    import { createPlaywrightCase } from "/skill/scripts/lib/tple-playwright.mjs";
    const runner = createPlaywrightCase(reportDir, caseId);
    await runner.run(async ({ page }) => page.goto(targetUrl));
  `);

  assert.equal(result.status, 0, result.stderr);
});

test("默认 runner 禁止自行启动 Chromium", () => {
  const result = check(`
    import { createPlaywrightCase } from "/skill/scripts/lib/tple-playwright.mjs";
    const browser = await chromium.launch({ headless: true });
  `);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /禁止自行 chromium\.launch/);
});

test("默认 runner 禁止裸调 agent-browser", () => {
  const result = check(`
    import { createPlaywrightCase } from "/skill/scripts/lib/tple-playwright.mjs";
    spawnSync("agent-browser", ["open", targetUrl]);
  `);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /禁止裸调用 agent-browser/);
});

test("默认 runner 禁止读取认证值写入产物", () => {
  const result = check(`
    import { createPlaywrightCase } from "/skill/scripts/lib/tple-playwright.mjs";
    const token = localStorage.getItem("authing_token");
    fs.writeFileSync(metaPath, JSON.stringify({ token }));
  `);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /认证值/);
});

test("默认 runner 禁止直接读取 auth state 或 context cookies", () => {
  for (const authRead of [
    'fs.readFileSync(path.join(reportDir, ".tple-auth-state.json"))',
    "await context.cookies()",
    "await context.storageState()",
    'await context["cookies"]()',
    'await context["storageState"]()',
  ]) {
    const result = check(`
      import { createPlaywrightCase } from "/skill/scripts/lib/tple-playwright.mjs";
      ${authRead};
    `);
    assert.equal(result.status, 1, authRead);
    assert.match(result.stderr, /认证值/);
  }
});

test("显式 legacy runner 保留 createBrowser 契约", () => {
  const result = check(`
    import { createBrowser } from "/skill/scripts/lib/tple-browser.mjs";
    const TPLE_BROWSER_BACKEND = "agent-browser-legacy";
    const browser = createBrowser(reportDir);
    browser.run(caseId, ["open", targetUrl]);
  `);

  assert.equal(result.status, 0, result.stderr);
});

test("createBrowser 未声明 legacy 时失败", () => {
  const result = check(`
    import { createBrowser } from "/skill/scripts/lib/tple-browser.mjs";
    const browser = createBrowser(reportDir);
  `);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /默认后端必须 import createPlaywrightCase/);
});

test("注释不能伪造 legacy 后端声明", () => {
  const result = check(`
    import { createBrowser } from "/skill/scripts/lib/tple-browser.mjs";
    // const TPLE_BROWSER_BACKEND = "agent-browser-legacy";
    const browser = createBrowser(reportDir);
  `);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /默认后端必须 import createPlaywrightCase/);
});

test("注释不能伪造 createPlaywrightCase import", () => {
  const result = check(`
    // import { createPlaywrightCase } from "/skill/scripts/lib/tple-playwright.mjs";
    console.log("no browser runner");
  `);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /默认后端必须 import createPlaywrightCase/);
});
