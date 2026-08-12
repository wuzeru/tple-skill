/**
 * tple-skill — 浏览器套件状态 + 强制 profile/phase 门闩
 *
 * 编排用 scripts/tple-browser.mjs 管生命周期；
 * run-cases 必须 createBrowser(reportDir) 调 run/closeSession，禁止裸 agent-browser。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const STATE_FILE = ".tple-browser.json";
export const PHASES = Object.freeze({
  cold: "cold",
  login: "login",
  run: "run",
  torn_down: "torn_down",
});
export const LOGIN_MODES = Object.freeze({
  none: "none",
  reuse: "reuse",
  manual: "manual",
  cdp: "cdp",
});
export const LOGIN_SESSION = "tple-login";
/** 套件 run 阶段唯一 keepalive session；探活禁止另开 probe session */
export const KEEP_ALIVE_SESSION = "tple-keepalive";

const DEFAULT_MAC_CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** 抑制崩溃恢复气泡 / 首跑干扰（仍须 scrub Sessions 才能彻底防多窗） */
export const DEFAULT_CHROME_ARGS =
  "--disable-session-crashed-bubble,--no-first-run,--no-default-browser-check";

/** run 阶段强制 headless（目录型 profile 上仅省略 --headed 仍可能弹出可见窗） */
export const HEADLESS_CHROME_ARGS = `${DEFAULT_CHROME_ARGS},--headless=new,--hide-scrollbars`;

export function resolveRunSession(session, state = null) {
  // 探活名一律映射到 keepalive
  if (session === "probe" || session === "tple-probe") {
    return KEEP_ALIVE_SESSION;
  }
  // 目录/复用 profile：同一 user-data-dir 不能并行多 session（占锁 → Chrome exit 21 + 多 daemon）
  // manual/reuse 整套 case 共用 keepalive；none 模式仍可用 case id 隔离
  if (
    state &&
    (state.loginMode === LOGIN_MODES.manual ||
      state.loginMode === LOGIN_MODES.reuse)
  ) {
    return KEEP_ALIVE_SESSION;
  }
  return session;
}
export function statePath(reportDir) {
  return path.join(path.resolve(reportDir), STATE_FILE);
}

export function defaultChromePath() {
  if (process.platform === "darwin" && fs.existsSync(DEFAULT_MAC_CHROME)) {
    return DEFAULT_MAC_CHROME;
  }
  return "";
}

export function loadState(reportDir) {
  const p = statePath(reportDir);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    throw new Error(`无法解析 ${p}: ${e.message}`);
  }
}

export function saveState(reportDir, state) {
  const dir = path.resolve(reportDir);
  fs.mkdirSync(dir, { recursive: true });
  const next = {
    ...state,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(statePath(dir), JSON.stringify(next, null, 2) + "\n");
  return next;
}

export function requireState(reportDir) {
  const state = loadState(reportDir);
  if (!state) {
    throw new Error(
      `缺少 ${STATE_FILE}：请先由编排执行 suite-boot --dir <report-dir>`,
    );
  }
  return state;
}

/** 裸调 agent-browser（仅库内 suite 清理 / login-open 等特权路径） */
export function rawAgentBrowser(args, { timeout = 120000, env } = {}) {
  const base = { ...process.env, ...(env || {}) };
  // run 阶段 argv 带 --headed false；同时清掉环境里的 headed 强制，避免可见窗
  if (args.includes("--headed") && args.includes("false")) {
    delete base.AGENT_BROWSER_HEADED;
  }
  const r = spawnSync("agent-browser", args, {
    encoding: "utf8",
    timeout,
    env: base,
  });
  return {
    ok: !r.error && r.status === 0,
    status: r.status,
    out: String(r.stdout || "").trim(),
    err: String(r.stderr || "").trim(),
    error: r.error || null,
  };
}

/** 目录型 profile 冷启前清 Session/Tabs，避免 Chrome 一次恢复几十个窗口 */
export function scrubProfileSessionRestore(profilePath) {
  if (!profilePath || !path.isAbsolute(profilePath)) return;
  if (!fs.existsSync(profilePath) || !fs.statSync(profilePath).isDirectory()) {
    return;
  }
  const def = path.join(profilePath, "Default");
  const victims = [
    path.join(def, "Sessions"),
    path.join(def, "Current Session"),
    path.join(def, "Last Session"),
    path.join(def, "Current Tabs"),
    path.join(def, "Last Tabs"),
  ];
  for (const p of victims) {
    try {
      if (!fs.existsSync(p)) continue;
      fs.rmSync(p, { recursive: true, force: true });
    } catch {
      /* ignore locked files */
    }
  }
}

export function suitePurge(extraProfilePath = "") {
  rawAgentBrowser(["close", "--all"], { timeout: 30000 });
  // 杀掉多余 daemon（曾出现 3 个 agent-browser-darwin 并存）
  if (process.platform === "win32") {
    spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_Process | Where-Object { $_.Name -like '*agent-browser*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }",
      ],
      { timeout: 15000 },
    );
  } else {
    // macOS / Linux 二进制名不同；pkill -f 按正则匹配
    spawnSync("pkill", ["-f", "agent-browser-(darwin|linux)"], {
      timeout: 10000,
    });
  }
  if (process.platform === "win32") {
    spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -like '*agent-browser-chrome-*' -or $_.CommandLine -like '*agent-browser-profile-*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }",
      ],
      { timeout: 15000 },
    );
  } else {
    spawnSync("pkill", ["-f", "user-data-dir=.*/agent-browser-chrome-"], {
      timeout: 10000,
    });
    spawnSync("pkill", ["-f", "user-data-dir=.*/agent-browser-profile-"], {
      timeout: 10000,
    });
    if (extraProfilePath && path.isAbsolute(extraProfilePath)) {
      // 目录型自定义 profile（如 chrome-profile-sellx）不在上述特征里
      spawnSync("pkill", ["-f", `user-data-dir=${extraProfilePath}`], {
        timeout: 10000,
      });
    }
  }
  spawnSync(process.execPath, ["-e", "setTimeout(() => {}, 1500)"], {
    timeout: 5000,
  });
}

export function dashboardStart(port) {
  const args = ["dashboard", "start"];
  if (port) args.push("--port", String(port));
  return rawAgentBrowser(args, { timeout: 30000 });
}

export function dashboardStop() {
  return rawAgentBrowser(["dashboard", "stop"], { timeout: 30000 });
}

/**
 * 从用户 args 去掉 session/profile/headed/executable-path，再按 state 重注。
 * @param {"run"|"login"} access
 */
export function buildArgv(state, session, userArgs, access = "run") {
  if (!Array.isArray(userArgs)) {
    throw new Error("args 必须是字符串数组");
  }

  const stripped = [];
  for (let i = 0; i < userArgs.length; i++) {
    const a = userArgs[i];
    if (
      a === "--session" ||
      a === "--profile" ||
      a === "--executable-path" ||
      a === "--args"
    ) {
      i += 1;
      continue;
    }
    if (a === "--headed") {
      const next = userArgs[i + 1];
      if (next === "true" || next === "false") i += 1;
      continue;
    }
    if (typeof a === "string" && a.startsWith("--session=")) continue;
    if (typeof a === "string" && a.startsWith("--profile=")) continue;
    if (typeof a === "string" && a.startsWith("--executable-path=")) continue;
    if (typeof a === "string" && a.startsWith("--args=")) continue;
    stripped.push(a);
  }

  if (stripped.length === 0) {
    throw new Error("缺少 agent-browser 子命令");
  }

  const cmd = stripped[0];
  const rest = stripped.slice(1);

  if (cmd === "dashboard") {
    throw new Error(
      "禁止在 case/run 路径调用 dashboard；请用编排 suite-boot / suite-teardown",
    );
  }
  if (cmd === "close" && rest.includes("--all")) {
    throw new Error(
      "禁止 close --all；case 只用 closeSession(session)，套件清理用 suite-teardown",
    );
  }

  if (access === "run") {
    if (state.phase !== PHASES.run) {
      throw new Error(
        `phase=${state.phase}，createBrowser().run 仅允许 phase=run（login 请用 login-* CLI）`,
      );
    }
  } else if (access === "login") {
    if (state.phase !== PHASES.login) {
      throw new Error(`phase=${state.phase}，login 操作仅允许 phase=login`);
    }
  }

  if (state.loginMode === LOGIN_MODES.cdp) {
    throw new Error("loginMode=cdp 本期未实现，请改用 reuse/manual/none");
  }

  const needsAuth =
    state.loginMode === LOGIN_MODES.reuse ||
    state.loginMode === LOGIN_MODES.manual;

  if (needsAuth && !state.profile) {
    throw new Error("状态缺少 profile：suite-boot 时必须提供 --profile");
  }

  const chromeArgs =
    access === "run"
      ? state.chromeArgsRun ||
        state.chromeArgs ||
        HEADLESS_CHROME_ARGS
      : state.chromeArgsLogin || DEFAULT_CHROME_ARGS;
  const prefix = ["--session", session, "--args", chromeArgs];
  if (needsAuth) {
    prefix.push("--profile", state.profile);
    if (state.executablePath) {
      prefix.push("--executable-path", state.executablePath);
    }
  }

  if (access === "login") {
    prefix.push("--headed");
  } else {
    // 显式关掉 headed（配置/环境里 headed:true 时仅省略 flag 不够）
    prefix.push("--headed", "false");
  }

  return [...prefix, cmd, ...rest];
}

export function runAgentBrowser(state, session, userArgs, opts = {}) {
  const access = opts.access || "run";
  const argv = buildArgv(state, session, userArgs, access);
  if (opts.dryRun) {
    return { ok: true, status: 0, out: "", err: "", argv, dryRun: true };
  }
  const result = rawAgentBrowser(argv, {
    timeout: opts.timeout ?? 120000,
  });
  const blob = `${result.out}\n${result.err}`;
  // daemon 已在跑时，后续命令再带 --profile/--args/--headed 会被忽略（警告）。
  // 若本命令仍成功，说明 keepalive 已用正确选项冷启过——只告警，不判死。
  // 仅当命令失败（或 open 后 settle 失败）才视为 daemon/profile 不一致。
  const ignored =
    /--profile.*ignored|daemon already running/i.test(blob);
  if (ignored && !result.ok) {
    return {
      ...result,
      ok: false,
      status: result.status || 1,
      err:
        (result.err ? result.err + "\n" : "") +
        "tple-browser: daemon/profile 不一致（--profile ignored 且命令失败）。" +
        "请编排重新 suite-boot / login-done（purge 后同 profile 强制 headless 冷启）。禁止继续连跑 case。",
      argv,
    };
  }
  if (ignored && result.ok) {
    // soft: flags ignored but command worked on existing daemon
    result.err =
      (result.err ? result.err + "\n" : "") +
      "tple-browser: note: --profile/--args/--headed ignored（复用已冷启 daemon，预期行为）";
  }

  // open 后活动焦点常停在首个 about:blank；内容在另一 tab 或尚未 settle
  const cmd = Array.isArray(userArgs) ? userArgs[0] : "";
  if (result.ok && cmd === "open" && opts.settle !== false) {
    const targetUrl = userArgs[1] || "";
    const settled = settleAfterOpen(state, session, targetUrl, {
      access,
      timeout: opts.timeout,
    });
    return {
      ...result,
      ok: settled.ok,
      out: settled.url || result.out,
      err: settled.ok ? result.err : settled.err || result.err,
      argv,
      tabs: settled.tabs,
      settledUrl: settled.url,
    };
  }

  return { ...result, argv };
}

/** 解析 `tab list --json` */
export function listTabs(state, session, opts = {}) {
  const access = opts.access || "run";
  const r = rawAgentBrowser(
    buildArgv(state, session, ["tab", "list", "--json"], access),
    { timeout: opts.timeout ?? 30000 },
  );
  try {
    const j = JSON.parse(r.out || "{}");
    const tabs = j?.data?.tabs || j?.tabs || [];
    return { ok: r.ok, tabs, raw: r.out };
  } catch {
    return { ok: false, tabs: [], raw: r.out, err: r.err };
  }
}

/**
 * 离开 about:blank：切到 preferUrl 匹配的 tab，否则第一个非 blank。
 * 冷启后第一个 tab 常是空白页，open 落在新 tab 或尚未激活内容 tab。
 */
export function focusContentTab(state, session, opts = {}) {
  const access = opts.access || "run";
  const prefer = String(opts.preferUrl || "");
  sleepMs(400);
  const listed = listTabs(state, session, { access, timeout: opts.timeout });
  if (!listed.tabs.length) return { ok: false, tabs: [], err: "no tabs" };

  const isBlank = (u) => !u || u === "about:blank" || u === "chrome://newtab/";
  let target =
    (prefer &&
      listed.tabs.find(
        (t) => t.url && (t.url === prefer || t.url.includes(prefer) || prefer.includes(t.url)),
      )) ||
    listed.tabs.find((t) => !isBlank(t.url)) ||
    listed.tabs.find((t) => t.active) ||
    listed.tabs[listed.tabs.length - 1];

  if (!target?.tabId) return { ok: false, tabs: listed.tabs, err: "no tabId" };

  if (!target.active) {
    rawAgentBrowser(
      buildArgv(state, session, ["tab", target.tabId], access),
      { timeout: opts.timeout ?? 30000 },
    );
    sleepMs(300);
  }

  const urlR = rawAgentBrowser(
    buildArgv(state, session, ["get", "url"], access),
    { timeout: opts.timeout ?? 30000 },
  );
  let url = String(urlR.out || "").trim().split("\n").pop();
  // get url 偶发仍报 blank，再信 tab list
  if (isBlank(url)) {
    sleepMs(500);
    const again = listTabs(state, session, { access, timeout: opts.timeout });
    const active = again.tabs.find((t) => t.active) || target;
    url = active?.url || url;
    if (!isBlank(active?.url) && active?.tabId) {
      rawAgentBrowser(
        buildArgv(state, session, ["tab", active.tabId], access),
        { timeout: opts.timeout ?? 30000 },
      );
      sleepMs(300);
      const urlR2 = rawAgentBrowser(
        buildArgv(state, session, ["get", "url"], access),
        { timeout: opts.timeout ?? 30000 },
      );
      url = String(urlR2.out || "").trim().split("\n").pop() || active.url;
    }
  }

  return {
    ok: !isBlank(url),
    url,
    tabId: target.tabId,
    tabs: listed.tabs,
  };
}

/**
 * open 成功后切到内容 tab；禁止二次 open（会新开窗/tab）。
 * 若仍 blank：在当前 tab 上 location.assign，不新开窗口。
 */
export function settleAfterOpen(state, session, targetUrl, opts = {}) {
  const access = opts.access || "run";
  const isBlank = (u) => !u || u === "about:blank" || u === "chrome://newtab/";

  sleepMs(600);
  let focused = focusContentTab(state, session, {
    access,
    preferUrl: targetUrl,
    timeout: opts.timeout,
  });
  if (focused.ok) return focused;

  // 同 tab 导航，禁止再调 open（open 易新开窗）
  if (targetUrl && isBlank(focused.url)) {
    const js = `location.assign(${JSON.stringify(targetUrl)})`;
    rawAgentBrowser(
      buildArgv(state, session, ["eval", js], access),
      { timeout: opts.timeout ?? 60000 },
    );
    sleepMs(800);
    focused = focusContentTab(state, session, {
      access,
      preferUrl: targetUrl,
      timeout: opts.timeout,
    });
    if (focused.ok) return focused;
  }

  return {
    ok: false,
    url: focused.url || "about:blank",
    tabs: focused.tabs,
    err:
      `open 后活动 tab 仍是 about:blank（未二次 open，避免多窗）。` +
      `tabs=${JSON.stringify(focused.tabs || [])}`,
  };
}

/**
 * run-cases 入口：绑定报告目录状态文件。
 * @param {string} reportDir
 */
export function createBrowser(reportDir) {
  const dir = path.resolve(reportDir);

  function refresh() {
    return requireState(dir);
  }

  return {
    dir,
    statePath: () => statePath(dir),
    getState: () => refresh(),

    /**
     * 执行一条 agent-browser 命令（自动注入 session/profile；拒绝 headed/close--all/dashboard）
     * @param {string} session
     * @param {string[]} args 子命令及参数，如 ["open", url] 或 ["snapshot", "-i"]
     */
    run(session, args, opts = {}) {
      const state = refresh();
      if (!session) throw new Error("session 必填（通常用 case id）");
      const resolved = resolveRunSession(session, state);
      return runAgentBrowser(state, resolved, args, {
        ...opts,
        access: "run",
      });
    },

    /** 只关闭本 case session；shared keepalive（manual/reuse）不关 */
    closeSession(session, opts = {}) {
      const state = refresh();
      if (!session) throw new Error("session 必填");
      const resolved = resolveRunSession(session, state);
      if (resolved === KEEP_ALIVE_SESSION) {
        return {
          ok: true,
          out: `skip close shared ${KEEP_ALIVE_SESSION}`,
          err: "",
          status: 0,
        };
      }
      return runAgentBrowser(state, resolved, ["close"], {
        ...opts,
        access: "run",
      });
    },

    purge() {
      throw new Error(
        "禁止 createBrowser().purge；套件清理请编排执行 suite-teardown / suite-boot",
      );
    },
    closeAll() {
      throw new Error(
        "禁止 createBrowser().closeAll；请用编排 suite-teardown",
      );
    },
    dashboard() {
      throw new Error(
        "禁止 createBrowser().dashboard；请用编排 suite-boot / suite-teardown",
      );
    },
  };
}

/** 选项 B：默认临时 profile 目录 */
export function defaultManualProfileDir(reportDir) {
  const base = path.resolve(reportDir);
  return path.join(base, "chrome-profile");
}

export function assertLoginMode(mode) {
  if (!Object.values(LOGIN_MODES).includes(mode)) {
    throw new Error(
      `无效 --mode ${mode}；允许: ${Object.values(LOGIN_MODES).join("|")}`,
    );
  }
  if (mode === LOGIN_MODES.cdp) {
    throw new Error("loginMode=cdp 本期未实现，请用 none|reuse|manual");
  }
}

export function sleepMs(ms) {
  spawnSync(process.execPath, ["-e", `setTimeout(() => {}, ${ms})`], {
    timeout: ms + 2000,
  });
}

export function tmpDirHint() {
  return os.tmpdir();
}
