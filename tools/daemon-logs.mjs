#!/usr/bin/env node
// Show Pi Companion daemon logs, dependency-free.
//
// Usage:
//   node tools/daemon-logs.mjs [--lines N] [--follow] [--source auto|service|file]
//
// Sources:
//   service  the per-user OS service logs (Linux journalctl, macOS log show/stream).
//            Windows Task Scheduler keeps no log stream, so it falls back to files.
//   file     log files under the companion home (<home>/daemon.log, <home>/logs/*.log).
//            The supervisor starts the daemon with stdio: 'ignore', so a file may
//            not exist; when none is found the exact manual capture command is shown.
//   auto     service first, then file, always ending with an actionable hint.
//
// Mirrors the companion-home precedence of src/home.ts without TypeScript.

import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

const IS_WIN = platform() === "win32";
const IS_MAC = platform() === "darwin";
const SYSTEMD_UNIT = "pi-companion.service";
const LAUNCHD_LABEL = "dev.pi-companion.daemon";
const LOG_PREDICATE = 'process == "gentle-companion-server"';
const USAGE =
  "usage: node tools/daemon-logs.mjs [--lines N] [--follow] [--source auto|service|file]";

function die(msg) {
  console.error(`error: ${msg}\n${USAGE}\n`);
  process.exit(1);
}

function resolveCompanionHome() {
  // Same precedence as resolveCompanionHome in src/home.ts:
  // PI_COMPANION_HOME verbatim, otherwise <agent home>/pi-companion.
  const explicit = process.env.PI_COMPANION_HOME;
  if (explicit) return resolve(explicit);
  const agentHome =
    process.env.GENTLE_PI_AGENT_HOME ||
    process.env.PI_CODING_AGENT_DIR ||
    join(homedir(), ".pi", "agent");
  return join(agentHome, "pi-companion");
}

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  let lines = 100;
  let follow = false;
  let source = "auto";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--follow") {
      follow = true;
    } else if (arg === "--lines") {
      const raw = argv[++i];
      if (raw === undefined) die("--lines requires a value");
      const n = Number(raw);
      if (!Number.isInteger(n) || n <= 0) {
        die(`--lines must be a positive integer, got ${raw === "" ? "(empty)" : raw}`);
      }
      lines = n;
    } else if (arg === "--source") {
      const raw = argv[++i];
      if (!["auto", "service", "file"].includes(raw)) {
        die(`--source must be auto, service or file, got ${raw ?? "(missing)"}`);
      }
      source = raw;
    } else if (arg === "--help" || arg === "-h") {
      console.log(USAGE);
      console.log("  --lines N       number of lines to show (default 100)");
      console.log("  --follow        keep streaming new output");
      console.log("  --source ...    auto (default) | service | file");
      process.exit(0);
    } else {
      die(`unknown argument: ${arg}`);
    }
  }
  return { lines, follow, source };
}

// ---------------------------------------------------------------------------
// Output helpers. Logs can carry pairing tokens or auth headers; redact the
// common shapes instead of trusting the daemon to never log a secret.
// ---------------------------------------------------------------------------

function redactLine(line) {
  return line
    .replace(
      /\b(authorization|auth|token|password|passwd|secret|api[_-]?key|api[_-]?secret|bearer)(\s*[:=]\s*)\S+/gi,
      "$1$2[redacted]"
    )
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]");
}

function printHeader(text) {
  console.log(`\n=== ${text} ===`);
}

/**
 * Spawn a command, stream its stdout line by line through redaction.
 * Resolves { ok, empty } once the process exits (or immediately with
 * { ok: true, streaming: true } in follow mode, where the child keeps running).
 */
function runCommand(cmd, args, { follow, lines, tail }) {
  return new Promise((resolveRun) => {
    let child;
    try {
      child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      resolveRun({ ok: false, empty: true, error: error.message });
      return;
    }
    child.on("error", (error) => {
      resolveRun({ ok: false, empty: true, error: error.message });
    });

    let sawOutput = false;
    const recent = [];
    const emit = (line) => {
      sawOutput = true;
      if (tail) {
        recent.push(line);
        if (recent.length > lines) recent.shift();
      } else {
        console.log(redactLine(line));
      }
    };

    const pump = (stream) => {
      const rl = createInterface({ input: stream });
      rl.on("line", emit);
      return new Promise((done) => rl.on("close", done));
    };

    child.on("close", async (code) => {
      await pumpDone;
      if (tail) for (const line of recent) console.log(redactLine(line));
      resolveRun({ ok: code === 0, empty: !sawOutput, code });
    });

    let pumpDone = Promise.resolve();
    if (child.stdout) pumpDone = pumpDone.then(() => pump(child.stdout));
    if (child.stderr) pumpDone = pumpDone.then(() => pump(child.stderr));

    if (follow) {
      // Keep streaming until the user interrupts; report as a live stream.
      resolveRun({ ok: true, empty: false, streaming: true });
    }
  });
}

// ---------------------------------------------------------------------------
// Service source
// ---------------------------------------------------------------------------

async function runServiceSource({ lines, follow }) {
  if (IS_WIN) {
    printHeader("service source — Windows");
    console.log(
      "Windows Task Scheduler runs the Pi Companion task but keeps no log stream,\n" +
        "so there is nothing to query with --source service. Falling back to files.\n" +
        `You can also check the task with: schtasks /Query /TN "Pi Companion" /V`
    );
    return { ok: false, reason: "windows-has-no-service-log" };
  }

  if (IS_MAC) {
    printHeader(`service source — launchd ${LAUNCHD_LABEL}`);
    const args = follow
      ? ["stream", "--predicate", LOG_PREDICATE]
      : ["show", "--predicate", LOG_PREDICATE, "--last", "1h"];
    // `log show` has no -n; buffer and keep only the last --lines lines.
    const result = await runCommand("log", args, { follow, lines, tail: !follow });
    if (!result.ok && result.error) {
      console.error(`error: could not run \`log\`: ${result.error}`);
    } else if (result.empty) {
      console.log(
        `no entries for ${LOG_PREDICATE} in the last hour.\n` +
          `the daemon may be logging under a different process name, or not running.`
      );
    }
    return { ok: result.ok && !result.empty };
  }

  // Linux: systemd --user unit.
  printHeader(`service source — systemd --user ${SYSTEMD_UNIT}`);
  const args = ["--user", "-u", SYSTEMD_UNIT, "-n", String(lines)];
  if (follow) args.push("-f");
  const result = await runCommand("journalctl", args, { follow, lines, tail: false });
  if (!result.ok && result.error) {
    console.error(`error: could not run journalctl: ${result.error}`);
    console.error("is systemd --user available for your account?");
  } else if (result.empty) {
    console.log(`no entries for unit ${SYSTEMD_UNIT}.`);
  }
  return { ok: result.ok && !result.empty };
}

// ---------------------------------------------------------------------------
// File source
// ---------------------------------------------------------------------------

function findLogFiles(home) {
  const files = [];
  const daemonLog = join(home, "daemon.log");
  if (existsSync(daemonLog)) files.push(daemonLog);
  const logsDir = join(home, "logs");
  if (existsSync(logsDir)) {
    try {
      for (const name of readdirSync(logsDir)) {
        if (!name.endsWith(".log")) continue;
        const path = join(logsDir, name);
        if (statSync(path).isFile()) files.push(path);
      }
    } catch { /* unreadable dir */ }
  }
  // Newest first.
  return files
    .map((path) => ({ path, mtime: statSync(path).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .map((f) => f.path);
}

function tailLines(path, lines) {
  try {
    const all = readFileSync(path, "utf8").split("\n");
    while (all.length && all[all.length - 1] === "") all.pop();
    return all.slice(-lines);
  } catch (error) {
    return [`(could not read ${path}: ${error.message})`];
  }
}

async function runFileSource({ lines, follow }) {
  const home = resolveCompanionHome();
  const files = findLogFiles(home);
  printHeader(`file source — ${home}`);

  if (files.length === 0) {
    console.log("no daemon log files found. Checked:");
    console.log(`  ${join(home, "daemon.log")}`);
    console.log(`  ${join(home, "logs", "*.log")}`);
    console.log("");
    console.log(
      "the service supervisor starts the daemon with stdio: 'ignore', so nothing\n" +
        "is written to a file unless you capture it. To capture logs manually, run\n" +
        "the daemon in the foreground with:"
    );
    console.log("");
    console.log("  RUST_LOG=info gentle-companion-server 2>&1 | tee -a <companion home>/daemon.log");
    console.log("");
    console.log(
      "if gentle-companion-server is not on PATH, point PI_COMPANION_SERVER at the\n" +
        "binary first (see the daemon binary resolution table in the README)."
    );
    return { ok: false };
  }

  if (follow) {
    if (IS_WIN) {
      console.log(
        "--follow is not supported for the file source on Windows; showing the last " +
          `${lines} lines instead.`
      );
    } else {
      const newest = files[0];
      console.log(`following ${newest} (Ctrl-C to stop)`);
      const result = await runCommand("tail", ["-n", String(lines), "-F", newest], {
        follow: true,
        lines,
        tail: false
      });
      if (!result.ok && result.error) {
        console.error(`error: could not run tail: ${result.error}`);
      }
      return { ok: result.ok };
    }
  }

  let any = false;
  for (const path of files) {
    console.log(`\n==> ${path} <==`);
    for (const line of tailLines(path, lines)) {
      console.log(redactLine(line));
      any = true;
    }
  }
  if (!any) console.log("(log files exist but are empty)");
  return { ok: any };
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

const { lines, follow, source } = parseArgs(process.argv.slice(2));

async function main() {
  if (source === "service") {
    const result = await runServiceSource({ lines, follow });
    if (!result.ok && !follow) {
      console.log(
        "\nhint: try --source file, or run the daemon in the foreground with RUST_LOG=info to capture logs."
      );
    }
    process.exit(result.ok || follow ? 0 : 1);
  }

  if (source === "file") {
    const result = await runFileSource({ lines, follow });
    process.exit(result.ok || follow ? 0 : 1);
  }

  // auto: service first, then file, always ending with an actionable hint.
  const service = await runServiceSource({ lines, follow });
  if (service.ok) {
    if (!follow) {
      console.log("\nhint: add --follow to stream new output, or --source file for captured log files.");
    }
    process.exit(0);
  }
  const file = await runFileSource({ lines, follow });
  if (file.ok) {
    if (!follow) {
      console.log("\nhint: add --follow to stream new output, or --source service for OS service logs.");
    }
    process.exit(0);
  }
  console.log(
    "\nhint: no logs found yet. Run the daemon in the foreground with " +
      "`RUST_LOG=info gentle-companion-server` to see and capture its logs, " +
      "or check `node tools/daemon.mjs status` to see whether it is running at all."
  );
  process.exit(1);
}

main();
