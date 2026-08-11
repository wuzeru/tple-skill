#!/usr/bin/env node
/**
 * tple-skill — 语义化浏览器套件 CLI（编排专用）
 *
 * Usage:
 *   node tple-browser.mjs suite-boot --dir <report> [--mode none|reuse|manual] [--profile …] [--chrome …] [--port n]
 *   node tple-browser.mjs login-open --dir <report> --url <url> [--session tple-login]
 *   node tple-browser.mjs login-wait --dir <report> --ok-url-regex <re> [--timeout-ms n] [--interval-ms n]
 *   node tple-browser.mjs login-done --dir <report>
 *   node tple-browser.mjs suite-teardown --dir <report>
 *   node tple-browser.mjs status --dir <report>
 *   node tple-browser.mjs run --dir <report> --session <id> -- <agent-browser args…>
 *
 * Case 路径请用 lib/tple-browser.mjs 的 createBrowser()，不要手写 agent-browser。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_CHROME_ARGS,
  HEADLESS_CHROME_ARGS,
  KEEP_ALIVE_SESSION,
  LOGIN_MODES,
  LOGIN_SESSION,
  PHASES,
  assertLoginMode,
  createBrowser,
  dashboardStart,
  dashboardStop,
  defaultChromePath,
  defaultManualProfileDir,
  focusContentTab,
  loadState,
  rawAgentBrowser,
  requireState,
  resolveRunSession,
  runAgentBrowser,
  saveState,
  scrubProfileSessionRestore,
  sleepMs,
  suitePurge,
} from "./lib/tple-browser.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(__dirname, "..");

function usage(code = 1) {
  console.error(`用法:
  node scripts/tple-browser.mjs suite-boot --dir <report> [--mode none|reuse|manual] [--profile …] [--chrome …] [--port n]
  node scripts/tple-browser.mjs login-open --dir <report> --url <url> [--session ${LOGIN_SESSION}]
  node scripts/tple-browser.mjs login-wait --dir <report> --ok-url-regex <re> [--timeout-ms 300000] [--interval-ms 3000]
  node scripts/tple-browser.mjs login-done --dir <report>
  node scripts/tple-browser.mjs suite-teardown --dir <report>
  node scripts/tple-browser.mjs status --dir <report>
  node scripts/tple-browser.mjs run --dir <report> --session <id> -- <args…>`);
  process.exit(code);
}

function arg(name, fallback = "") {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function requireDir() {
  const dir = arg("--dir", "");
  if (!dir) {
    console.error("缺少 --dir <report-dir>");
    usage(1);
  }
  return path.resolve(dir);
}

function fail(msg) {
  console.error(`tple-browser: ${msg}`);
  process.exit(1);
}

const verb = process.argv[2];
if (!verb || verb === "-h" || verb === "--help") usage(verb ? 0 : 1);

if (verb === "suite-boot") {
  const dir = requireDir();
  const mode = arg("--mode", LOGIN_MODES.none);
  assertLoginMode(mode);

  let profile = arg("--profile", "");
  let chrome = arg("--chrome", "");
  const port = arg("--port", "");

  if (mode === LOGIN_MODES.reuse) {
    if (!profile) fail("mode=reuse 必须 --profile <Chrome profile 名>");
    if (!chrome) chrome = defaultChromePath();
    if (!chrome) {
      fail(
        "mode=reuse 需要 --chrome <系统 Chrome 可执行路径>（macOS 默认未找到）",
      );
    }
  } else if (mode === LOGIN_MODES.manual) {
    if (!profile) profile = defaultManualProfileDir(dir);
  } else {
    profile = profile || "";
    chrome = "";
  }

  console.log("suite-boot: purge + dashboard start…");
  if (profile && path.isAbsolute(profile)) {
    scrubProfileSessionRestore(profile);
  }
  suitePurge(profile);

  const dash = dashboardStart(port || undefined);
  if (!dash.ok) {
    console.warn(
      `dashboard start 未成功（可忽略）: ${dash.err || dash.out || dash.status}`,
    );
  }

  const phase =
    mode === LOGIN_MODES.manual ? PHASES.login : PHASES.run;

  // mode=none/reuse：立刻 headless 冷启 keepalive，避免后续第一条命令才首次拉 Chrome
  if (phase === PHASES.run && (mode === LOGIN_MODES.reuse || mode === LOGIN_MODES.none)) {
    const bootState = {
      version: 1,
      phase: PHASES.run,
      loginMode: mode,
      profile: profile || null,
      executablePath: mode === LOGIN_MODES.reuse ? chrome : null,
      chromeArgs: HEADLESS_CHROME_ARGS,
      chromeArgsRun: HEADLESS_CHROME_ARGS,
      chromeArgsLogin: DEFAULT_CHROME_ARGS,
      dashboard: { started: dash.ok, port: port ? Number(port) : 4848 },
      skillDir: SKILL_DIR,
      createdAt: new Date().toISOString(),
    };
    saveState(dir, bootState);
    if (mode === LOGIN_MODES.reuse) scrubProfileSessionRestore(profile);
    const warm = runAgentBrowser(
      bootState,
      KEEP_ALIVE_SESSION,
      ["open", "about:blank"],
      { access: "run", timeout: 120000, settle: false },
    );
    if (!warm.ok) {
      fail(`冷启 keepalive 失败: ${warm.err || warm.out || warm.status}`);
    }
  }

  const state = saveState(dir, {
    version: 1,
    phase,
    loginMode: mode,
    profile: profile || null,
    executablePath: mode === LOGIN_MODES.reuse ? chrome : null,
    chromeArgs: HEADLESS_CHROME_ARGS,
    chromeArgsRun: HEADLESS_CHROME_ARGS,
    chromeArgsLogin: DEFAULT_CHROME_ARGS,
    dashboard: {
      started: dash.ok,
      port: port ? Number(port) : 4848,
    },
    skillDir: SKILL_DIR,
    createdAt: new Date().toISOString(),
  });

  console.log(
    `suite-boot: ok phase=${state.phase} mode=${state.loginMode}` +
      (state.profile ? ` profile=${state.profile}` : "") +
      (state.executablePath ? ` chrome=${state.executablePath}` : ""),
  );
  console.log(`state: ${path.join(dir, ".tple-browser.json")}`);
  process.exit(0);
}

if (verb === "login-open") {
  const dir = requireDir();
  const url = arg("--url", "");
  if (!url) fail("login-open 需要 --url");
  const session = arg("--session", LOGIN_SESSION);

  let state = requireState(dir);
  if (state.loginMode !== LOGIN_MODES.manual) {
    fail(`login-open 仅用于 mode=manual（当前 mode=${state.loginMode}）`);
  }
  if (state.phase === PHASES.run) {
    fail("phase=run：登录已结束，禁止再 headed login-open");
  }
  if (state.phase === PHASES.torn_down) {
    fail("phase=torn_down：请重新 suite-boot");
  }
  if (state.phase !== PHASES.login) {
    // cold 等异常：拉回 login
    state = saveState(dir, { ...state, phase: PHASES.login });
  }
  if (!state.profile) fail("状态缺少 profile");

  // headed 冷启前清 Session，否则脏 profile 一次恢复几十个窗口
  scrubProfileSessionRestore(state.profile);
  suitePurge(state.profile);

  const result = runAgentBrowser(state, session, ["open", url], {
    access: "login",
    timeout: 120000,
  });
  console.log(`login-open: argv=${JSON.stringify(result.argv)}`);
  if (!result.ok) {
    fail(`open 失败: ${result.err || result.out || result.status}`);
  }
  console.log(result.out || "opened");
  process.exit(0);
}

if (verb === "login-wait") {
  const dir = requireDir();
  const reStr = arg("--ok-url-regex", "");
  if (!reStr) fail("login-wait 需要 --ok-url-regex");
  const session = arg("--session", LOGIN_SESSION);
  const timeoutMs = Number(arg("--timeout-ms", "300000"));
  const intervalMs = Number(arg("--interval-ms", "3000"));

  let re;
  try {
    re = new RegExp(reStr);
  } catch (e) {
    fail(`无效正则: ${e.message}`);
  }

  const state = requireState(dir);
  if (state.phase !== PHASES.login) {
    fail(`login-wait 仅 phase=login（当前 ${state.phase}）`);
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const focused = focusContentTab(state, session, {
      access: "login",
      timeout: 30000,
    });
    const url = String(focused.url || "").trim();
    console.log(`login-wait: url=${url} tabs=${focused.tabs?.length || 0}`);
    if (url && re.test(url)) {
      console.log("login-wait: ok");
      process.exit(0);
    }
    // 也扫一遍所有 tab url
    const hit = (focused.tabs || []).some((t) => t.url && re.test(t.url));
    if (hit) {
      console.log("login-wait: ok (matched non-active tab, focused)");
      process.exit(0);
    }
    sleepMs(intervalMs);
  }
  fail(`登录超时（${timeoutMs}ms），URL 未匹配 /${reStr}/`);
}

if (verb === "login-done") {
  const dir = requireDir();
  const state = requireState(dir);
  if (state.loginMode !== LOGIN_MODES.manual) {
    fail(`login-done 仅用于 mode=manual（当前 ${state.loginMode}）`);
  }
  if (state.phase !== PHASES.login) {
    fail(`login-done 期望 phase=login（当前 ${state.phase}）`);
  }

  // 关键：拆掉 headed daemon，再强制 headless + 同 profile 冷启唯一 keepalive。
  console.log("login-done: purge headed daemon…");
  scrubProfileSessionRestore(state.profile);
  suitePurge(state.profile);

  const runState = {
    ...state,
    phase: PHASES.run,
    chromeArgs: HEADLESS_CHROME_ARGS,
    chromeArgsRun: HEADLESS_CHROME_ARGS,
    chromeArgsLogin: DEFAULT_CHROME_ARGS,
  };
  saveState(dir, runState);

  console.log(
    `login-done: cold-start ${KEEP_ALIVE_SESSION} (forced headless)…`,
  );
  const keepUrl = arg("--url", "https://sellxagent.com/");
  const warm = runAgentBrowser(
    runState,
    KEEP_ALIVE_SESSION,
    ["open", keepUrl],
    { access: "run", timeout: 120000 },
  );
  if (!warm.ok) {
    fail(
      `headless 冷启失败（cookie 应已落盘；可重试 login-done）: ${warm.err || warm.out || warm.status}`,
    );
  }
  console.log(`login-done: keepalive url=${warm.settledUrl || warm.out}`);
  console.log(
    `login-done: phase=run session=${KEEP_ALIVE_SESSION}（探活请 --session ${KEEP_ALIVE_SESSION} 或 probe→自动映射；禁止新开 session 拉浏览器）`,
  );
  process.exit(0);
}

if (verb === "suite-teardown") {
  const dir = requireDir();
  const prev = loadState(dir);
  console.log("suite-teardown: close --all + purge + dashboard stop…");
  suitePurge(prev?.profile || "");
  const dash = dashboardStop();
  if (!dash.ok) {
    console.warn(
      `dashboard stop: ${dash.err || dash.out || "not running / ignored"}`,
    );
  }
  if (prev) {
    saveState(dir, {
      ...prev,
      phase: PHASES.torn_down,
      dashboard: { ...(prev.dashboard || {}), started: false },
    });
  } else {
    saveState(dir, {
      version: 1,
      phase: PHASES.torn_down,
      loginMode: LOGIN_MODES.none,
      profile: null,
      executablePath: null,
      dashboard: { started: false },
      skillDir: SKILL_DIR,
      createdAt: new Date().toISOString(),
    });
  }
  console.log("suite-teardown: ok");
  process.exit(0);
}

if (verb === "status") {
  const dir = requireDir();
  const state = loadState(dir);
  if (!state) {
    console.log(JSON.stringify({ ok: false, error: "no state file" }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, state }, null, 2));
  process.exit(0);
}

if (verb === "run") {
  const dir = requireDir();
  const sessionRaw = arg("--session", "");
  if (!sessionRaw) fail("run 需要 --session <id>");
  const session = resolveRunSession(sessionRaw, requireState(dir));
  if (session !== sessionRaw) {
    console.error(
      `tple-browser: --session ${sessionRaw} → ${session}（manual/reuse 共用 keepalive，禁止多 session 抢 profile）`,
    );
  }
  const dash = process.argv.indexOf("--");
  if (dash < 0 || dash === process.argv.length - 1) {
    fail("run 需要 -- 后跟 agent-browser 子命令，如: -- get url");
  }
  const userArgs = process.argv.slice(dash + 1);
  // get url 等非 open：直接走 keepalive，不要 settle
  const browser = createBrowser(dir);
  const result = browser.run(session, userArgs, {
    settle: userArgs[0] === "open",
  });
  if (result.argv) console.error(`argv: ${JSON.stringify(result.argv)}`);
  if (result.out) console.log(result.out);
  if (result.err) console.error(result.err);
  process.exit(result.ok ? 0 : result.status || 1);
}

fail(`未知动词: ${verb}`);
