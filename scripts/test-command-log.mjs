#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { rawAgentBrowser } from "./lib/tple-browser.mjs";

const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), "tple-command-log-"));
const commandDir = path.join(temporaryDir, "bin");
const reportDir = path.join(temporaryDir, "report");
const commandPath = path.join(commandDir, "agent-browser");

try {
  fs.mkdirSync(commandDir);
  fs.mkdirSync(reportDir);
  fs.writeFileSync(
    commandPath,
    "#!/bin/sh\nprintf '%0600d\\n' 0\nprintf '%0600d\\n' 0 >&2\n",
  );
  fs.chmodSync(commandPath, 0o755);

  const audit = {
    reportDir,
    phase: "run",
    session: "case-login",
  };
  const env = { PATH: commandDir };

  assert.equal(rawAgentBrowser(["open", "https://example.com"], { env, audit }).ok, true);
  assert.equal(rawAgentBrowser(["fill", "@e3", "demo123"], { env, audit }).ok, true);
  assert.equal(
    rawAgentBrowser(["eval", "document.querySelector('input').value='demo123'"], {
      env,
      audit,
    }).ok,
    true,
  );

  const entries = fs
    .readFileSync(path.join(reportDir, "commands.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

  assert.equal(entries.length, 3);
  assert.equal(entries[0].phase, "run");
  assert.equal(entries[0].session, "case-login");
  assert.equal(typeof entries[0].durationMs, "number");
  assert.equal(entries[0].out.length, 500);
  assert.equal(entries[0].err.length, 500);
  assert.deepEqual(entries[1].argv, ["fill", "@e3", "***"]);
  assert.deepEqual(entries[2].argv, ["eval", "[redacted eval]"]);
  assert.equal(JSON.stringify(entries).includes("demo123"), false);

  const readOnlyReportDir = path.join(temporaryDir, "read-only-report");
  fs.mkdirSync(readOnlyReportDir);
  fs.chmodSync(readOnlyReportDir, 0o555);
  assert.equal(
    rawAgentBrowser(["snapshot", "-i"], {
      env,
      audit: { reportDir: readOnlyReportDir },
    }).ok,
    true,
  );
  fs.chmodSync(readOnlyReportDir, 0o755);

  console.log("command log: PASS");
} finally {
  fs.rmSync(temporaryDir, { recursive: true, force: true });
}
