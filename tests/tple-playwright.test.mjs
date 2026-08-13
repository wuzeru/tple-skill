import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  AUTH_STATE_FILE,
  assertVideoMetrics,
  copyChromeProfileWithDeps,
  createPlaywrightCase,
  exportStorageStateFromProfile,
  readVideoMetrics,
  removeStorageState,
  resolveChromeProfileSource,
} from "../scripts/lib/tple-playwright.mjs";

function createReportDir(state) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tple-playwright-test-"));
  fs.writeFileSync(
    path.join(dir, ".tple-browser.json"),
    JSON.stringify(state),
  );
  return dir;
}

function createFakePlaywright(order, contextOptions) {
  const page = {
    video: () => ({
      saveAs: async (target) => {
        order.push(["saveAs", target]);
        fs.writeFileSync(target, "video");
      },
    }),
  };
  const context = {
    newPage: async () => {
      order.push("newPage");
      return page;
    },
    close: async () => order.push("closeContext"),
  };
  const browser = {
    newContext: async (options) => {
      contextOptions.push(options);
      return context;
    },
    close: async () => order.push("closeBrowser"),
  };
  return {
    chromium: {
      launch: async (options) => {
        order.push(["launch", options]);
        return browser;
      },
    },
  };
}

test("createPlaywrightCase 只允许 run phase", () => {
  const reportDir = createReportDir({
    phase: "login",
    loginMode: "manual",
  });

  assert.throws(
    () => createPlaywrightCase(reportDir, "case-1"),
    /phase=login/,
  );
});

test("认证模式缺少 storageState 时拒绝启动", () => {
  const reportDir = createReportDir({
    phase: "run",
    loginMode: "manual",
  });

  assert.throws(
    () => createPlaywrightCase(reportDir, "case-1"),
    /storageState/,
  );
});

test("run 创建录屏 context 并在关闭后保存视频", async () => {
  const reportDir = createReportDir({
    phase: "run",
    loginMode: "none",
  });
  const order = [];
  const contextOptions = [];
  const playwright = createFakePlaywright(order, contextOptions);
  const videoPath = path.join(reportDir, "videos/case-1.webm");
  const runner = createPlaywrightCase(reportDir, "case-1", {
    videoPath,
    load: async () => ({ playwright }),
  });

  const result = await runner.run(async ({ page }) => {
    order.push("callback");
    assert.ok(page);
    return "done";
  });

  assert.equal(result, "done");
  assert.equal(contextOptions.length, 1);
  assert.match(contextOptions[0].recordVideo.dir, /tple-playwright-video-/);
  assert.deepEqual(contextOptions[0].recordVideo.size, {
    width: 1280,
    height: 720,
  });
  assert.equal(order[2], "callback");
  assert.equal(order[3], "closeContext");
  assert.match(order[4][1], /\.tmp-/);
  assert.equal(order[5], "closeBrowser");
  assert.equal(fs.existsSync(videoPath), true);
});

test("run 回调失败仍关闭 context、保存视频和关闭 browser", async () => {
  const reportDir = createReportDir({
    phase: "run",
    loginMode: "none",
  });
  const order = [];
  const playwright = createFakePlaywright(order, []);
  const runner = createPlaywrightCase(reportDir, "case-1", {
    videoPath: path.join(reportDir, "videos/case-1.webm"),
    load: async () => ({ playwright }),
  });

  await assert.rejects(
    () =>
      runner.run(async () => {
        order.push("callback");
        throw new Error("case failed");
      }),
    /case failed/,
  );

  assert.match(order.join(","), /callback,closeContext,saveAs/);
  assert.equal(order.at(-1), "closeBrowser");
});

test("认证模式把 storageState 传入 context", async () => {
  const reportDir = createReportDir({
    phase: "run",
    loginMode: "manual",
  });
  const authStatePath = path.join(reportDir, ".tple-auth-state.json");
  fs.writeFileSync(authStatePath, JSON.stringify({ cookies: [], origins: [] }));
  const contextOptions = [];
  const playwright = createFakePlaywright([], contextOptions);
  const runner = createPlaywrightCase(reportDir, "case-1", {
    load: async () => ({ playwright }),
  });

  await runner.run(async () => {});

  assert.equal(contextOptions[0].storageState, authStatePath);
});

test("assertVideoMetrics 拒绝非数值、短时长和少帧", () => {
  assert.throws(() => assertVideoMetrics(Number.NaN, 40), /非数值/);
  assert.throws(() => assertVideoMetrics(3.9, 40), /不达标/);
  assert.throws(() => assertVideoMetrics(5, 31), /不达标/);
  assert.doesNotThrow(() => assertVideoMetrics(5, 50));
});

test("readVideoMetrics 从 WebM format 读取 duration", () => {
  const metrics = readVideoMetrics("/tmp/video.webm", () => ({
    status: 0,
    stdout: JSON.stringify({
      format: { duration: "4.560000" },
      streams: [{ nb_read_frames: "112" }],
    }),
    stderr: "",
  }));

  assert.deepEqual(metrics, { duration: 4.56, frames: 112 });
});

test("resolveChromeProfileSource 解析 manual 绝对 profile", () => {
  assert.deepEqual(
    resolveChromeProfileSource(
      {
        loginMode: "manual",
        profile: "/report/chrome-profile",
        executablePath: "/Applications/Chrome",
      },
      { platform: "darwin", homeDir: "/home/test" },
    ),
    {
      userDataDir: "/report/chrome-profile",
      profileDirectory: "Default",
      executablePath: "/Applications/Chrome",
    },
  );
});

test("resolveChromeProfileSource 解析 macOS reuse profile 名", () => {
  assert.deepEqual(
    resolveChromeProfileSource(
      {
        loginMode: "reuse",
        profile: "Profile 7",
        executablePath: "/Applications/Chrome",
      },
      { platform: "darwin", homeDir: "/Users/test" },
    ),
    {
      userDataDir:
        "/Users/test/Library/Application Support/Google/Chrome",
      profileDirectory: "Profile 7",
      executablePath: "/Applications/Chrome",
    },
  );
});

test("copyChromeProfileWithDeps 只复制 Local State 和选定 profile", () => {
  const copies = [];
  const tempDir = copyChromeProfileWithDeps({
    source: {
      userDataDir: "/chrome",
      profileDirectory: "Profile 7",
    },
    mkdtempSync: () => "/tmp/tple-profile-copy",
    tmpdir: () => "/tmp",
    existsSync: () => true,
    cpSync: (source, target, options) =>
      copies.push({ source, target, options }),
    rmSync: () => {
      throw new Error("不应清理成功副本");
    },
  });

  assert.equal(tempDir, "/tmp/tple-profile-copy");
  assert.deepEqual(copies, [
    {
      source: "/chrome/Local State",
      target: "/tmp/tple-profile-copy/Local State",
      options: undefined,
    },
    {
      source: "/chrome/Profile 7",
      target: "/tmp/tple-profile-copy/Profile 7",
      options: { recursive: true },
    },
  ]);
});

test("exportStorageStateFromProfile 原子写入并清理临时 profile", async () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "tple-auth-export-"));
  const order = [];
  const state = {
    loginMode: "manual",
    profile: "/source/profile",
    executablePath: "/Applications/Chrome",
  };
  const context = {
    pages: () => [],
    newPage: async () => ({
      goto: async (url) => order.push(["goto", url]),
    }),
    storageState: async ({ path: target }) => {
      order.push(["storageState", path.basename(target)]);
      assert.equal(fs.statSync(target).mode & 0o777, 0o600);
      fs.writeFileSync(target, JSON.stringify({ cookies: [], origins: [] }));
    },
    close: async () => order.push("close"),
  };

  const result = await exportStorageStateFromProfile(
    reportDir,
    state,
    "https://example.com/app",
    {
      copyProfile: () => "/tmp/copied-profile",
      load: async () => ({
        playwright: {
          chromium: {
            launchPersistentContext: async (profile, options) => {
              order.push(["launch", profile, options]);
              return context;
            },
          },
        },
      }),
      rmSync: (target) => order.push(["rm", target]),
    },
  );

  assert.equal(result, path.join(reportDir, AUTH_STATE_FILE));
  assert.equal(fs.existsSync(result), true);
  assert.equal(fs.statSync(result).mode & 0o777, 0o600);
  assert.deepEqual(order.at(-1), ["rm", "/tmp/copied-profile"]);
});

test("removeStorageState 删除认证文件", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "tple-auth-remove-"));
  const target = path.join(reportDir, AUTH_STATE_FILE);
  fs.writeFileSync(target, "{}");

  removeStorageState(reportDir);

  assert.equal(fs.existsSync(target), false);
});

test("tple-browser 生命周期导出并清理 storageState", () => {
  const source = fs.readFileSync(
    new URL("../scripts/tple-browser.mjs", import.meta.url),
    "utf8",
  );

  assert.match(source, /exportStorageStateFromProfile/);
  assert.match(source, /removeStorageState/);
  assert.match(source, /mode=reuse 需要 --url/);
  assert.match(
    source,
    /removeStorageState\(dir\)[\s\S]*exportStorageStateFromProfile\(dir, state, targetUrl\)/,
  );
  assert.match(
    source,
    /login-done[\s\S]*exportStorageStateFromProfile\(dir, state, targetUrl\)/,
  );
  assert.match(
    source,
    /suite-teardown[\s\S]*removeStorageState\(dir\)/,
  );
});

test("仓库显式忽略认证状态文件", () => {
  const gitignore = fs.readFileSync(
    new URL("../.gitignore", import.meta.url),
    "utf8",
  );
  assert.match(gitignore, /^\*\*\/\.tple-auth-state\.json$/m);
});
