import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  getPlaywrightRuntimeDir,
  getPlaywrightSearchPaths,
  probePlaywright,
  resolvePlaywrightModule,
} from "../scripts/lib/playwright-runtime.mjs";

test("getPlaywrightRuntimeDir 优先使用显式 runtime", () => {
  assert.equal(
    getPlaywrightRuntimeDir({
      env: { TPLE_PLAYWRIGHT_RUNTIME: "/custom/runtime" },
      homeDir: "/home/test",
    }),
    "/custom/runtime",
  );
});

test("getPlaywrightSearchPaths 依次返回显式包路径、skill 和用户 runtime", () => {
  assert.deepEqual(
    getPlaywrightSearchPaths({
      env: {
        TPLE_PLAYWRIGHT_PATH: "/custom/playwright",
        TPLE_PLAYWRIGHT_RUNTIME: "/custom/runtime",
      },
      homeDir: "/home/test",
      skillDir: "/skill",
    }),
    ["/custom/playwright", "/skill", "/custom/runtime"],
  );
});

test("resolvePlaywrightModule 跳过不可解析候选并返回首个可用模块", () => {
  const calls = [];
  const resolved = resolvePlaywrightModule({
    searchPaths: ["/missing", "/runtime"],
    resolvePackage(_name, options) {
      calls.push(options.paths[0]);
      if (options.paths[0] === "/missing") throw new Error("not found");
      return "/runtime/node_modules/playwright/index.js";
    },
  });

  assert.equal(resolved, "/runtime/node_modules/playwright/index.js");
  assert.deepEqual(calls, ["/missing", "/runtime"]);
});

test("resolvePlaywrightModule 不把 npm prefix 根目录误判为 Playwright 包", () => {
  const runtimeDir = fs.mkdtempSync("/tmp/tple-runtime-resolve-");
  fs.writeFileSync(
    `${runtimeDir}/package.json`,
    JSON.stringify({ dependencies: { playwright: "^1.55.0" } }),
  );
  const calls = [];

  const resolved = resolvePlaywrightModule({
    searchPaths: [runtimeDir],
    resolvePackage(name, options) {
      calls.push({ name, options });
      if (name !== "playwright") throw new Error("wrong package");
      return `${runtimeDir}/node_modules/playwright/index.js`;
    },
  });

  assert.equal(resolved, `${runtimeDir}/node_modules/playwright/index.js`);
  assert.equal(calls[0].name, "playwright");
});

test("probePlaywright 实际启动并关闭 Chromium", async () => {
  const calls = [];
  const result = await probePlaywright({
    load: async () => ({
      version: "1.55.0",
      playwright: {
        chromium: {
          executablePath: () => "/cache/chromium",
          launch: async (options) => {
            calls.push(["launch", options]);
            return {
              close: async () => calls.push(["close"]),
            };
          },
        },
      },
    }),
    existsSync: (target) => target === "/cache/chromium",
  });

  assert.deepEqual(result, {
    ok: true,
    info: "v1.55.0 · Chromium 可启动",
  });
  assert.deepEqual(calls, [
    ["launch", { headless: true }],
    ["close"],
  ]);
});

test("probePlaywright 在 Chromium 不存在时失败且不启动", async () => {
  let launched = false;
  const result = await probePlaywright({
    load: async () => ({
      version: "1.55.0",
      playwright: {
        chromium: {
          executablePath: () => "/missing/chromium",
          launch: async () => {
            launched = true;
          },
        },
      },
    }),
    existsSync: () => false,
  });

  assert.equal(result.ok, false);
  assert.match(result.hint, /Chromium/);
  assert.equal(launched, false);
});

test("probePlaywright 在 Chromium 启动失败时返回错误", async () => {
  const result = await probePlaywright({
    load: async () => ({
      version: "1.55.0",
      playwright: {
        chromium: {
          executablePath: () => "/cache/chromium",
          launch: async () => {
            throw new Error("browser crashed");
          },
        },
      },
    }),
    existsSync: () => true,
  });

  assert.equal(result.ok, false);
  assert.match(result.hint, /browser crashed/);
});

test("check-env 将 Playwright 实际启动探测作为硬依赖", () => {
  const source = fs.readFileSync(
    new URL("../scripts/check-env.mjs", import.meta.url),
    "utf8",
  );

  assert.match(source, /import\s+\{\s*probePlaywright\s*\}/);
  assert.match(source, /await probePlaywright\(\)/);
  assert.match(source, /bad\.push\(\{\s*bin: "playwright"/);
});

test("install-deps 安装用户 runtime 包和 Chromium", () => {
  const source = fs.readFileSync(
    new URL("../scripts/install-deps.mjs", import.meta.url),
    "utf8",
  );

  assert.match(source, /getPlaywrightRuntimeDir/);
  assert.match(
    source,
    /\["install", "--prefix", playwrightRuntimeDir, "playwright"\]/,
  );
  assert.match(
    source,
    /\[\s*"exec",\s*"--prefix",\s*playwrightRuntimeDir,\s*"--",\s*"playwright",\s*"install",\s*"chromium",?\s*\]/,
  );
});
