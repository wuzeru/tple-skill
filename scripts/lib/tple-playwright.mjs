import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { PHASES, requireState } from "./tple-browser.mjs";
import { loadPlaywright } from "./playwright-runtime.mjs";

export const AUTH_STATE_FILE = ".tple-auth-state.json";
export const DEFAULT_VIDEO_SIZE = Object.freeze({
  width: 1280,
  height: 720,
});

export function authStatePath(reportDir) {
  return path.join(path.resolve(reportDir), AUTH_STATE_FILE);
}

function temporarySiblingPath(finalPath) {
  const extension = path.extname(finalPath);
  const base = extension ? finalPath.slice(0, -extension.length) : finalPath;
  return `${base}.tmp-${process.pid}-${randomUUID()}${extension}`;
}

export function resolveChromeProfileSource(
  state,
  {
    platform = process.platform,
    homeDir = os.homedir(),
    localAppData = process.env.LOCALAPPDATA,
  } = {},
) {
  if (!state.profile) throw new Error("状态缺少 Chrome profile");
  if (path.isAbsolute(state.profile)) {
    return {
      userDataDir: state.profile,
      profileDirectory: "Default",
      executablePath: state.executablePath || undefined,
    };
  }

  let userDataDir;
  if (platform === "darwin") {
    userDataDir = path.join(
      homeDir,
      "Library/Application Support/Google/Chrome",
    );
  } else if (platform === "win32") {
    if (!localAppData) throw new Error("Windows 缺少 LOCALAPPDATA");
    userDataDir = path.join(localAppData, "Google/Chrome/User Data");
  } else {
    userDataDir = path.join(homeDir, ".config/google-chrome");
  }

  return {
    userDataDir,
    profileDirectory: state.profile,
    executablePath: state.executablePath || undefined,
  };
}

export function copyChromeProfileWithDeps({
  source,
  mkdtempSync = fs.mkdtempSync,
  tmpdir = os.tmpdir,
  existsSync = fs.existsSync,
  cpSync = fs.cpSync,
  rmSync = fs.rmSync,
}) {
  const temporaryUserDataDir = mkdtempSync(
    path.join(tmpdir(), "tple-profile-copy-"),
  );
  try {
    const localState = path.join(source.userDataDir, "Local State");
    if (existsSync(localState)) {
      cpSync(localState, path.join(temporaryUserDataDir, "Local State"));
    }
    cpSync(
      path.join(source.userDataDir, source.profileDirectory),
      path.join(temporaryUserDataDir, source.profileDirectory),
      { recursive: true },
    );
    return temporaryUserDataDir;
  } catch (error) {
    try {
      rmSync(temporaryUserDataDir, { recursive: true, force: true });
    } catch {
      // 保留复制失败作为根因
    }
    throw error;
  }
}

export async function exportStorageStateFromProfile(
  reportDir,
  state,
  targetUrl,
  options = {},
) {
  if (!targetUrl || targetUrl === "about:blank") {
    throw new Error("导出 storageState 需要目标 URL，以包含该 origin 的 localStorage");
  }

  const dir = path.resolve(reportDir);
  fs.mkdirSync(dir, { recursive: true });
  const source = resolveChromeProfileSource(state, options);
  const copyProfile =
    options.copyProfile ||
    ((profileSource) => copyChromeProfileWithDeps({ source: profileSource }));
  const temporaryUserDataDir = copyProfile(source);
  const finalPath = authStatePath(dir);
  const temporaryStatePath = temporarySiblingPath(finalPath);
  const load = options.load || loadPlaywright;
  const rmSync = options.rmSync || fs.rmSync;
  let context;

  try {
    fs.writeFileSync(temporaryStatePath, "", { mode: 0o600, flag: "wx" });
    const { playwright } = await load();
    context = await playwright.chromium.launchPersistentContext(
      temporaryUserDataDir,
      {
        headless: true,
        ...(source.executablePath
          ? { executablePath: source.executablePath }
          : {}),
        args: [`--profile-directory=${source.profileDirectory}`],
      },
    );
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
    await context.storageState({ path: temporaryStatePath });
    await context.close();
    context = null;
    fs.renameSync(temporaryStatePath, finalPath);
    fs.chmodSync(finalPath, 0o600);
    return finalPath;
  } catch (error) {
    try {
      await context?.close();
    } catch {
      // 导出失败优先
    }
    fs.rmSync(temporaryStatePath, { force: true });
    throw error;
  } finally {
    rmSync(temporaryUserDataDir, { recursive: true, force: true });
  }
}

export function removeStorageState(reportDir) {
  const finalPath = authStatePath(reportDir);
  fs.rmSync(finalPath, { force: true });
  const directory = path.dirname(finalPath);
  const prefix = `${path.basename(finalPath, path.extname(finalPath))}.tmp-`;
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory)) {
    if (entry.startsWith(prefix)) {
      fs.rmSync(path.join(directory, entry), { force: true });
    }
  }
}

function requiresAuthentication(state) {
  return state.loginMode === "manual" || state.loginMode === "reuse";
}

function rememberFirstError(current, error) {
  return current || (error instanceof Error ? error : new Error(String(error)));
}

export function createPlaywrightCase(reportDir, caseId, options = {}) {
  const dir = path.resolve(reportDir);
  const state = (options.loadState || requireState)(dir);
  if (state.phase !== PHASES.run) {
    throw new Error(
      `phase=${state.phase}，createPlaywrightCase 仅允许 phase=run`,
    );
  }
  if (!caseId) throw new Error("caseId 必填");

  const storageState = authStatePath(dir);
  if (requiresAuthentication(state) && !fs.existsSync(storageState)) {
    throw new Error(
      `认证模式缺少 storageState：${storageState}；请先完成登录态导出`,
    );
  }

  const videoPath =
    options.videoPath || path.join(dir, "videos", `${caseId}.webm`);
  const videoSize = options.videoSize || DEFAULT_VIDEO_SIZE;
  const load = options.load || loadPlaywright;

  return {
    async run(callback) {
      if (typeof callback !== "function") {
        throw new Error("run(callback) 需要异步 case 回调");
      }

      const temporaryVideoDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "tple-playwright-video-"),
      );
      let browser;
      let context;
      let page;
      let video;
      let result;
      let mainError;
      let cleanupError;
      let temporaryOutputPath;

      try {
        const { playwright } = await load();
        browser = await playwright.chromium.launch({ headless: true });
        context = await browser.newContext({
          ...(requiresAuthentication(state) ? { storageState } : {}),
          viewport: videoSize,
          recordVideo: {
            dir: temporaryVideoDir,
            size: videoSize,
          },
        });
        page = await context.newPage();
        video = page.video();
        result = await callback({ page, context, browser });
      } catch (error) {
        mainError = rememberFirstError(mainError, error);
      } finally {
        if (context) {
          try {
            await context.close();
          } catch (error) {
            cleanupError = rememberFirstError(cleanupError, error);
          }
        }
        if (video) {
          try {
            fs.mkdirSync(path.dirname(videoPath), { recursive: true });
            temporaryOutputPath = temporarySiblingPath(videoPath);
            await video.saveAs(temporaryOutputPath);
            fs.renameSync(temporaryOutputPath, videoPath);
            temporaryOutputPath = null;
          } catch (error) {
            cleanupError = rememberFirstError(cleanupError, error);
          }
        }
        if (browser) {
          try {
            await browser.close();
          } catch (error) {
            cleanupError = rememberFirstError(cleanupError, error);
          }
        }
        try {
          if (temporaryOutputPath) {
            fs.rmSync(temporaryOutputPath, { force: true });
          }
          fs.rmSync(temporaryVideoDir, { recursive: true, force: true });
        } catch (error) {
          cleanupError = rememberFirstError(cleanupError, error);
        }
      }

      if (mainError) throw mainError;
      if (cleanupError) throw cleanupError;
      return result;
    },
  };
}

export function assertVideoMetrics(duration, frames) {
  if (!Number.isFinite(duration) || !Number.isFinite(frames)) {
    throw new Error("ffprobe 返回非数值指标");
  }
  if (duration < 4 || frames < 32) {
    throw new Error(
      `Playwright 录制不达标：${duration.toFixed(1)} 秒、${frames} 帧`,
    );
  }
}

export function readVideoMetrics(videoPath, run = spawnSync) {
  const result = run(
    "ffprobe",
    [
      "-v",
      "error",
      "-count_frames",
      "-select_streams",
      "v:0",
      "-show_entries",
      "format=duration:stream=nb_read_frames",
      "-of",
      "json",
      videoPath,
    ],
    { encoding: "utf8", timeout: 30000 },
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      `ffprobe 失败：${result.error?.message || result.stderr || result.status}`,
    );
  }

  const parsed = JSON.parse(result.stdout || "{}");
  const stream = parsed.streams?.[0] || {};
  return {
    duration: Number(parsed.format?.duration),
    frames: Number(stream.nb_read_frames),
  };
}

export function validateVideo(videoPath, run = spawnSync) {
  const metrics = readVideoMetrics(videoPath, run);
  assertVideoMetrics(metrics.duration, metrics.frames);
  return metrics;
}
