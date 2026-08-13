import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const LIB_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SKILL_DIR = path.resolve(LIB_DIR, "../..");

export function getPlaywrightRuntimeDir({
  env = process.env,
  homeDir = os.homedir(),
} = {}) {
  return path.resolve(
    env.TPLE_PLAYWRIGHT_RUNTIME || path.join(homeDir, ".tple/runtime"),
  );
}

export function getPlaywrightSearchPaths({
  env = process.env,
  homeDir = os.homedir(),
  skillDir = DEFAULT_SKILL_DIR,
} = {}) {
  return [
    env.TPLE_PLAYWRIGHT_PATH,
    path.resolve(skillDir),
    getPlaywrightRuntimeDir({ env, homeDir }),
  ].filter(Boolean);
}

export function resolvePlaywrightModule({
  searchPaths = getPlaywrightSearchPaths(),
  resolvePackage = require.resolve,
} = {}) {
  for (const searchPath of searchPaths) {
    try {
      if (
        path.isAbsolute(searchPath) &&
        path.extname(searchPath) &&
        fs.existsSync(searchPath)
      ) {
        return searchPath;
      }
      if (
        path.isAbsolute(searchPath) &&
        fs.existsSync(path.join(searchPath, "package.json"))
      ) {
        const manifest = JSON.parse(
          fs.readFileSync(path.join(searchPath, "package.json"), "utf8"),
        );
        if (manifest.name === "playwright") {
          return resolvePackage(searchPath);
        }
      }
      return resolvePackage("playwright", { paths: [searchPath] });
    } catch {
      // 继续尝试下一个约定位置
    }
  }
  return null;
}

function findPackageDirectory(modulePath) {
  let current = path.dirname(modulePath);
  while (current !== path.dirname(current)) {
    const packagePath = path.join(current, "package.json");
    if (fs.existsSync(packagePath)) {
      const manifest = JSON.parse(fs.readFileSync(packagePath, "utf8"));
      if (manifest.name === "playwright") return { current, manifest };
    }
    current = path.dirname(current);
  }
  throw new Error(`无法定位 Playwright package.json：${modulePath}`);
}

export async function loadPlaywright(options = {}) {
  const modulePath = resolvePlaywrightModule(options);
  if (!modulePath) {
    throw new Error("未找到 Playwright 模块");
  }

  const imported = await import(pathToFileURL(modulePath).href);
  const { manifest } = findPackageDirectory(modulePath);
  return {
    playwright: imported.default || imported,
    modulePath,
    version: manifest.version || "unknown",
  };
}

export async function probePlaywright({
  load = loadPlaywright,
  existsSync = fs.existsSync,
} = {}) {
  let loaded;
  try {
    loaded = await load();
  } catch (error) {
    return {
      ok: false,
      hint: `${error.message}；运行 node scripts/install-deps.mjs`,
    };
  }

  const executablePath = loaded.playwright.chromium.executablePath();
  if (!existsSync(executablePath)) {
    return {
      ok: false,
      hint: "Playwright Chromium 未安装；运行 node scripts/install-deps.mjs",
    };
  }

  let browser;
  try {
    browser = await loaded.playwright.chromium.launch({ headless: true });
    await browser.close();
  } catch (error) {
    try {
      await browser?.close();
    } catch {
      // 启动探测的原错误更有诊断价值
    }
    return {
      ok: false,
      hint: `Playwright Chromium 启动失败：${error.message}`,
    };
  }

  return {
    ok: true,
    info: `v${loaded.version} · Chromium 可启动`,
  };
}
