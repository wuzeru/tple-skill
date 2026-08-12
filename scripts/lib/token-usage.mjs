/**
 * Token 用量采集：ccusage → 本地账本 → unsupported
 * 供 check-env 探测与 collect-usage 写入共用。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const UNSUPPORTED_SOURCE = "unsupported";
export const UNSUPPORTED_MESSAGE = "当前 agent 不支持 token 消耗采集";

/**
 * 解析 ccusage 可执行方式：全局优先，否则仅本机已缓存的 npx（--no-install，不联网下载）。
 * 真正安装留给 install-deps 的 `npm i -g ccusage`。
 */
export function resolveCcusage() {
  const direct = spawnSync("ccusage", ["--version"], {
    encoding: "utf8",
    timeout: 15000,
  });
  if (!direct.error && direct.status === 0) {
    return {
      bin: "ccusage",
      argsPrefix: [],
      version: String(direct.stdout || "").trim().split("\n")[0],
    };
  }
  // 探测禁止 --yes / @latest：避免 check-env 隐式联网安装、离线卡超时
  const viaNpx = spawnSync("npx", ["--no-install", "ccusage", "--version"], {
    encoding: "utf8",
    timeout: 15000,
  });
  if (!viaNpx.error && viaNpx.status === 0) {
    return {
      bin: "npx",
      argsPrefix: ["--no-install", "ccusage"],
      version: String(viaNpx.stdout || "").trim().split("\n")[0],
    };
  }
  return null;
}

export function runCcusage(cc, args, timeout = 60000) {
  const r = spawnSync(cc.bin, [...cc.argsPrefix, ...args], {
    encoding: "utf8",
    timeout,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (r.error || r.status !== 0) {
    return { ok: false, stdout: "", stderr: String(r.stderr || r.error || "") };
  }
  return { ok: true, stdout: String(r.stdout || ""), stderr: String(r.stderr || "") };
}

function isCursorEnv(env) {
  return !!(
    env.CURSOR_AGENT ||
    env.CURSOR_TRACE_ID ||
    env.CURSOR_SESSION_ID ||
    env.CURSOR_CONVERSATION_ID ||
    env.CURSOR_INVOKED_AS
  );
}

/** OpenCode 运行时标记；勿单看 OPENCODE_CONFIG_DIR（orca 钩子会常驻注入） */
function isOpenCodeEnv(env) {
  return !!(env.OPENCODE || env.OPENCODE_DATA_DIR || env.OPENCODE_SERVER_PASSWORD);
}

/** Cursor 拉起 opencode 时子 shell 会继承 CURSOR_*，需看父进程是否为 opencode */
function parentLooksLikeOpenCode() {
  let pid = process.ppid;
  for (let depth = 0; depth < 6 && pid > 1; depth++) {
    const r = spawnSync("ps", ["-o", "command=", "-p", String(pid)], {
      encoding: "utf8",
      timeout: 2000,
    });
    if (!r.error && /opencode/i.test(String(r.stdout || ""))) return true;
    const pp = spawnSync("ps", ["-o", "ppid=", "-p", String(pid)], {
      encoding: "utf8",
      timeout: 2000,
    });
    const next = Number(String(pp.stdout || "").trim());
    if (!Number.isFinite(next) || next === pid) break;
    pid = next;
  }
  return false;
}

/** 粗判当前宿主 agent */
export function detectAgent(cwd = process.cwd(), env = process.env) {
  if (env.CLAUDECODE || env.CLAUDE_CODE_ENTRYPOINT) return "claude";

  // Cursor 嵌套拉起 OpenCode 时 CURSOR_* 会污染子进程；OpenCode 优先
  if (isOpenCodeEnv(env) || parentLooksLikeOpenCode()) return "opencode";

  if (isCursorEnv(env)) return "cursor";
  if (env.CODEX_HOME || env.CODEX_THREAD_ID) return "codex";

  const slug = cwdToClaudeSlug(cwd);
  const claudeDir = path.join(os.homedir(), ".claude", "projects", slug);
  if (fs.existsSync(claudeDir)) {
    const files = fs.readdirSync(claudeDir).filter((f) => f.endsWith(".jsonl"));
    if (files.length > 0) return "claude";
  }

  return "unknown";
}

export function cwdToClaudeSlug(cwd) {
  return path.resolve(cwd).replace(/\//g, "-");
}

function num(...vals) {
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function normalizeUsage(partial, source) {
  const input = num(partial.input, partial.inputTokens);
  const output = num(partial.output, partial.outputTokens);
  const cacheRead = num(partial.cacheRead, partial.cacheReadTokens);
  const cacheCreate = num(partial.cacheCreate, partial.cacheCreationTokens);
  const summed = input + output + cacheRead + cacheCreate;
  const total = num(partial.total, partial.totalTokens, summed > 0 ? summed : NaN);
  if (!Number.isFinite(total) || total <= 0) return null;
  const usage = { source, total };
  if (input > 0) usage.input = input;
  if (output > 0) usage.output = output;
  if (cacheRead > 0) usage.cacheRead = cacheRead;
  return usage;
}

function unsupported(agent) {
  return {
    source: UNSUPPORTED_SOURCE,
    agent,
    message: UNSUPPORTED_MESSAGE,
  };
}

function parseSessionList(jsonText) {
  let data;
  try {
    data = JSON.parse(jsonText);
  } catch {
    return [];
  }
  if (Array.isArray(data?.session)) return data.session;
  if (Array.isArray(data?.sessions)) return data.sessions;
  return [];
}

function pickLatestSession(rows, { agent, cwd } = {}) {
  if (!rows.length) return null;
  let filtered = rows;
  if (agent) {
    const byAgent = rows.filter(
      (r) => String(r.agent || "").toLowerCase() === agent || !r.agent,
    );
    if (byAgent.length) filtered = byAgent;
  }
  if (cwd) {
    const slug = cwdToClaudeSlug(cwd);
    const byPath = filtered.filter((r) => {
      const p = r.metadata?.projectPath || r.projectPath || "";
      return p && (p.includes(slug) || slug.includes(String(p).replace(/^-+/, "")));
    });
    if (byPath.length) filtered = byPath;
  }
  filtered = [...filtered].sort((a, b) => {
    const ta = Date.parse(a.metadata?.lastActivity || a.lastActivity || 0) || 0;
    const tb = Date.parse(b.metadata?.lastActivity || b.lastActivity || 0) || 0;
    return tb - ta;
  });
  return filtered[0] || null;
}

/** 1) ccusage */
export function collectViaCcusage(cc, { agent, cwd } = {}) {
  if (!cc) return null;

  const attempts = [];
  if (agent && agent !== "unknown" && agent !== "cursor") {
    attempts.push([agent, "session", "--json"]);
  }
  attempts.push(["session", "--json"]);

  for (const args of attempts) {
    const r = runCcusage(cc, args);
    if (!r.ok) continue;
    const rows = parseSessionList(r.stdout);
    const row = pickLatestSession(rows, {
      agent: agent === "unknown" || agent === "cursor" ? null : agent,
      cwd,
    });
    if (!row) continue;
    const usage = normalizeUsage(row, "ccusage");
    if (usage) {
      usage.agent = row.agent || agent;
      if (row.period || row.sessionId) usage.sessionId = row.period || row.sessionId;
      return usage;
    }
  }
  return null;
}

/** 2) 本地账本（Claude / OpenCode） */
export function collectViaLocal(agent, cwd = process.cwd()) {
  if (agent === "claude" || agent === "unknown") {
    const fromClaude = sumClaudeTranscript(cwd);
    if (fromClaude) return fromClaude;
  }
  if (agent === "opencode" || agent === "unknown") {
    const fromOc = sumOpenCodeMessages(cwd);
    if (fromOc) return fromOc;
  }
  return null;
}

function sumClaudeTranscript(cwd) {
  const slug = cwdToClaudeSlug(cwd);
  const roots = [
    path.join(os.homedir(), ".claude", "projects", slug),
    path.join(os.homedir(), ".config", "claude", "projects", slug),
  ];
  let bestFile = null;
  let bestMtime = 0;
  for (const dir of roots) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".jsonl")) continue;
      const fp = path.join(dir, name);
      const st = fs.statSync(fp);
      if (st.mtimeMs > bestMtime) {
        bestMtime = st.mtimeMs;
        bestFile = fp;
      }
    }
  }
  if (!bestFile) return null;

  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheCreate = 0;
  for (const line of fs.readFileSync(bestFile, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const u = o?.message?.usage || o?.usage;
    if (!u || typeof u !== "object") continue;
    input += num(u.input_tokens, u.inputTokens);
    output += num(u.output_tokens, u.outputTokens);
    cacheRead += num(u.cache_read_input_tokens, u.cacheReadTokens);
    cacheCreate += num(u.cache_creation_input_tokens, u.cacheCreationTokens);
  }
  return normalizeUsage(
    { input, output, cacheRead, cacheCreate },
    "transcript",
  );
}

function sumOpenCodeMessages(cwd) {
  const root = path.join(os.homedir(), ".local", "share", "opencode", "storage", "message");
  if (!fs.existsSync(root)) return null;

  const abs = path.resolve(cwd);
  let best = null;
  for (const ses of fs.readdirSync(root)) {
    const sesDir = path.join(root, ses);
    if (!fs.statSync(sesDir).isDirectory()) continue;
    const files = fs.readdirSync(sesDir).filter((f) => f.endsWith(".json"));
    if (!files.length) continue;
    let matchCwd = false;
    let mtime = 0;
    for (const f of files) {
      const fp = path.join(sesDir, f);
      const st = fs.statSync(fp);
      mtime = Math.max(mtime, st.mtimeMs);
      try {
        const msg = JSON.parse(fs.readFileSync(fp, "utf8"));
        const msgCwd = msg?.path?.cwd || msg?.cwd;
        if (msgCwd && path.resolve(msgCwd) === abs) matchCwd = true;
      } catch {
        /* ignore */
      }
    }
    if (!matchCwd) continue;
    if (!best || mtime > best.mtime) best = { mtime, sesDir, files };
  }
  if (!best) return null;

  let input = 0;
  let output = 0;
  let cacheRead = 0;
  for (const f of best.files) {
    try {
      const msg = JSON.parse(fs.readFileSync(path.join(best.sesDir, f), "utf8"));
      const t = msg?.tokens;
      if (!t) continue;
      input += num(t.input);
      output += num(t.output);
      cacheRead += num(t.cache?.read, t.cacheRead);
    } catch {
      /* ignore */
    }
  }
  return normalizeUsage({ input, output, cacheRead }, "opencode-local");
}

/**
 * 完整降级链。返回 { usage, path, agent }
 * path: 'ccusage' | 'local' | 'unsupported'
 */
export function collectTokenUsage({ cwd = process.cwd(), agent } = {}) {
  const detected = agent || detectAgent(cwd);

  // Cursor 本地 transcript 无 token 字段；勿误用其他 agent 的 ccusage session
  if (detected === "cursor") {
    return {
      usage: unsupported(detected),
      path: "unsupported",
      agent: detected,
    };
  }

  const cc = resolveCcusage();

  const viaCc = collectViaCcusage(cc, { agent: detected, cwd });
  if (viaCc) return { usage: viaCc, path: "ccusage", agent: detected };

  const viaLocal = collectViaLocal(detected, cwd);
  if (viaLocal) return { usage: viaLocal, path: "local", agent: detected };

  return {
    usage: unsupported(detected),
    path: "unsupported",
    agent: detected,
  };
}

/** check-env：ccusage 硬依赖探测 */
export function probeCcusageInstall() {
  const cc = resolveCcusage();
  if (!cc) {
    return {
      ok: false,
      bin: "ccusage",
      hint: "npm i -g ccusage",
    };
  }
  return { ok: true, bin: "ccusage", info: cc.version };
}

/** check-env：用量采集能力软探测（不阻断） */
export function probeTokenMeterLine() {
  const cc = resolveCcusage();
  if (!cc) {
    return {
      ok: false,
      bin: "token-meter",
      info: "",
      hint: "需先安装 ccusage",
    };
  }
  const { usage, path: how, agent } = collectTokenUsage();
  if (usage.source === UNSUPPORTED_SOURCE) {
    return {
      ok: true,
      bin: "token-meter",
      info: `agent=${agent} · ${UNSUPPORTED_MESSAGE}`,
      soft: true,
    };
  }
  return {
    ok: true,
    bin: "token-meter",
    info: `agent=${agent} · via ${how} · total ${usage.total.toLocaleString("en-US")}`,
    soft: true,
  };
}
