#!/usr/bin/env node
// Manual Pi Companion daemon lifecycle, dependency-free.
//
// Usage:
//   node tools/daemon.mjs <start|stop|status|restart> [--json]
//
// Mirrors the lifecycle logic of src/daemon.ts and the companion-home
// precedence of src/home.ts, without depending on TypeScript at runtime.

import { spawn, execFile } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir, platform } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const IS_WIN = platform() === "win32";
const EXE = IS_WIN ? "gentle-companion-server.exe" : "gentle-companion-server";
const DEFAULT_URL = "ws://127.0.0.1:43721";
const PROBE_TIMEOUT_MS = 800;
const START_TIMEOUT_MS = 10_000;
const STOP_TIMEOUT_MS = 10_000;

function die(msg) {
  console.error(`error: ${msg}\n`);
  process.exit(1);
}

export function adminHttpUrl() {
  const ws = process.env.PI_COMPANION_URL ?? DEFAULT_URL;
  return ws.replace(/^ws/, "http").replace(/\/$/, "");
}

export function resolveCompanionHome() {
  const explicit = process.env.PI_COMPANION_HOME;
  if (explicit) return resolve(explicit);
  const agentHome =
    process.env.GENTLE_PI_AGENT_HOME ||
    process.env.PI_CODING_AGENT_DIR ||
    join(homedir(), ".pi", "agent");
  return join(agentHome, "pi-companion");
}

export function packageVersion() {
  try {
    return JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")).version;
  } catch {
    return "0.0.0";
  }
}

async function daemonContext(timeoutMs = PROBE_TIMEOUT_MS) {
  try {
    const response = await fetch(adminHttpUrl() + "/api/context", {
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function isDaemonUp(timeoutMs = PROBE_TIMEOUT_MS) {
  return Boolean(await daemonContext(timeoutMs));
}

async function waitForDaemon(ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const context = await daemonContext(500);
    if (context) return context;
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

async function waitForDaemonDown(ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (!(await isDaemonUp(300))) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

function onPath() {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (dir && existsSync(join(dir, EXE))) return join(dir, EXE);
  }
  return null;
}

/**
 * Binary resolution order (same precedence as resolveDaemonBinary in src/daemon.ts):
 * 1. PI_COMPANION_SERVER (explicit override)
 * 2. local cargo build: newest of server/target/{release,debug}
 * 3. cached release download: <companion home>/cache/<version>/
 * 4. gentle-companion-server on PATH
 */
export function resolveDaemonBinary() {
  if (process.env.PI_COMPANION_SERVER) return process.env.PI_COMPANION_SERVER;

  let dev = null;
  let devMtime = -1;
  for (const profile of ["release", "debug"]) {
    const path = join(PACKAGE_ROOT, "server", "target", profile, EXE);
    try {
      const mtime = statSync(path).mtimeMs;
      if (mtime > devMtime) {
        dev = path;
        devMtime = mtime;
      }
    } catch { /* missing */ }
  }
  if (dev) return dev;

  const cached = join(resolveCompanionHome(), "cache", packageVersion(), EXE);
  if (existsSync(cached)) return cached;

  return onPath();
}

function spawnDetached(binary) {
  return new Promise((resolveSpawn, reject) => {
    const child = spawn(binary, [], {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolveSpawn();
    });
  });
}

async function stopDaemon(context) {
  const pid = context?.pid;
  if (!Number.isInteger(pid) || pid <= 1) {
    return { stopped: false, reason: "the daemon did not report a usable PID" };
  }
  try {
    if (IS_WIN) {
      await execFileAsync("taskkill", ["/PID", String(pid)], { timeout: 5_000 });
    } else {
      process.kill(pid, "SIGTERM");
    }
  } catch {
    // The process may already have exited between the probe and the stop attempt.
  }
  const stopped = await waitForDaemonDown(STOP_TIMEOUT_MS);
  return {
    stopped,
    reason: stopped ? null : `pid ${pid} did not exit within ${STOP_TIMEOUT_MS / 1000}s`
  };
}

// ---------------------------------------------------------------------------
// Actions. Each returns { ok, error?, ... } and the caller prints/exit-codes.
// ---------------------------------------------------------------------------

async function actionStatus() {
  const context = await daemonContext();
  const running = Boolean(context);
  const binary = resolveDaemonBinary();
  return {
    ok: running,
    running,
    version: context?.version,
    pid: context?.pid,
    binary,
    url: adminHttpUrl().replace(/^http/, "ws"),
    error: running ? null : "no daemon answered on " + adminHttpUrl()
  };
}

async function actionStart() {
  const existing = await daemonContext();
  if (existing) {
    return {
      ok: true,
      running: true,
      version: existing.version,
      pid: existing.pid,
      url: adminHttpUrl().replace(/^http/, "ws"),
      error: null,
      note: "already running"
    };
  }

  const binary = resolveDaemonBinary();
  if (!binary) {
    return {
      ok: false,
      running: false,
      binary: null,
      url: adminHttpUrl().replace(/^http/, "ws"),
      error:
        "no daemon binary found. Set PI_COMPANION_SERVER, build server/target/release, or install gentle-companion-server on PATH"
    };
  }

  try {
    await spawnDetached(binary);
  } catch (error) {
    return {
      ok: false,
      running: false,
      binary,
      url: adminHttpUrl().replace(/^http/, "ws"),
      error: "could not spawn " + binary + ": " + (error instanceof Error ? error.message : String(error))
    };
  }

  const context = await waitForDaemon(START_TIMEOUT_MS);
  if (!context) {
    return {
      ok: false,
      running: false,
      binary,
      url: adminHttpUrl().replace(/^http/, "ws"),
      error: `spawned ${binary} but it did not become ready within ${START_TIMEOUT_MS / 1000}s`
    };
  }
  return {
    ok: true,
    running: true,
    version: context.version,
    pid: context.pid,
    binary,
    url: adminHttpUrl().replace(/^http/, "ws"),
    error: null
  };
}

async function actionStop() {
  const context = await daemonContext();
  if (!context) {
    return { ok: true, running: false, error: null, note: "not running" };
  }
  const { stopped, reason } = await stopDaemon(context);
  return {
    ok: stopped,
    running: !stopped,
    pid: context.pid,
    version: context.version,
    url: adminHttpUrl().replace(/^http/, "ws"),
    error: stopped ? null : reason
  };
}

async function actionRestart() {
  const stopResult = await actionStop();
  if (!stopResult.ok) return { ...stopResult, action: "restart" };
  const startResult = await actionStart();
  return { ...startResult, action: "restart" };
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

const [actionArg, ...rest] = process.argv.slice(2);
const jsonMode = rest.includes("--json");
if (rest.filter((a) => a !== "--json").length > 0 || !["start", "stop", "status", "restart"].includes(actionArg)) {
  die("usage: node tools/daemon.mjs <start|stop|status|restart> [--json]");
}

const ACTION_LABEL = { start: "start", stop: "stop", status: "status", restart: "restart" };
const result = { action: ACTION_LABEL[actionArg] };
Object.assign(result, await ({ start: actionStart, stop: actionStop, status: actionStatus, restart: actionRestart })[actionArg]());

if (jsonMode) {
  console.log(
    JSON.stringify({
      ok: result.ok ?? false,
      action: result.action,
      running: result.running ?? false,
      version: result.version ?? null,
      pid: result.pid ?? null,
      binary: result.binary ?? null,
      url: result.url ?? null,
      error: result.error ?? null
    })
  );
} else {
  const wsUrl = result.url;
  switch (result.action) {
    case "status":
      if (result.ok) {
        console.log(`Pi Companion daemon is running (v${result.version ?? "unknown"}, pid ${result.pid ?? "?"})`);
        console.log(`console: ${wsUrl}`);
      } else {
        console.log("Pi Companion daemon is not running.");
        console.log(`start it with: node tools/daemon.mjs start  (binary: ${result.binary ?? "not found"})`);
      }
      if (result.action === "status") {
        console.log(`binary: ${result.binary ?? "not found"}`);
      }
      break;
    case "start":
      if (result.ok && result.note === "already running") {
        console.log(`Pi Companion daemon is already running (v${result.version ?? "unknown"}, pid ${result.pid ?? "?"}).`);
        console.log(`console: ${wsUrl}`);
      } else if (result.ok) {
        console.log(`Pi Companion daemon started (v${result.version ?? "unknown"}, pid ${result.pid ?? "?"}).`);
        console.log(`console: ${wsUrl}`);
      } else {
        die(result.error);
      }
      break;
    case "stop":
      if (result.ok && result.note === "not running") {
        console.log("Pi Companion daemon is not running; nothing to stop.");
      } else if (result.ok) {
        console.log("Pi Companion daemon stopped.");
      } else {
        die(result.error);
      }
      break;
    case "restart":
      if (result.ok) {
        console.log(`Pi Companion daemon restarted (v${result.version ?? "unknown"}, pid ${result.pid ?? "?"}).`);
        console.log(`console: ${wsUrl}`);
      } else {
        die(result.error);
      }
      break;
  }
}
process.exit(result.ok ? 0 : 1);
