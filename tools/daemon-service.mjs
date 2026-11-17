#!/usr/bin/env node
// Install, remove and report the per-user background service for the
// pi-companion daemon, mirroring src/background-service.ts exactly so the
// extension-managed service and this tool never diverge.
//
// Usage:
//   node tools/daemon-service.mjs install   [--json] [--binary <path>]
//   node tools/daemon-service.mjs uninstall [--json]
//   node tools/daemon-service.mjs status    [--json]
//
// Platforms:
//   Linux   systemd --user unit  ~/.config/systemd/user/pi-companion.service
//   macOS   LaunchAgent          ~/Library/LaunchAgents/dev.pi-companion.daemon.plist
//   Windows Task Scheduler task  "Pi Companion"

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const name = "pi-companion";
const label = "dev.pi-companion.daemon";
const taskName = "Pi Companion";

function die(msg) {
  console.error(`error: ${msg}\n`);
  process.exit(1);
}

function usage() {
  console.log(`Usage: node tools/daemon-service.mjs <install|uninstall|status> [--json] [--binary <path>]

Commands:
  install    Write the supervisor script + daemon config and register the per-user service
  uninstall  Stop and deregister the per-user service (supervisor files are kept)
  status     Report whether the service is registered and the daemon answers

Options:
  --json            Emit one JSON object instead of human-readable text
  --binary <path>   Server binary to install (default: PI_COMPANION_SERVER, then
                    server/target/{release,debug}/gentle-companion-server, then PATH)`);
}

// --- Companion home (mirrors src/home.ts resolveCompanionHome) ---------------

function resolveCompanionHome() {
  const explicit = process.env.PI_COMPANION_HOME;
  if (explicit) return join(explicit);
  const agentHome =
    process.env.GENTLE_PI_AGENT_HOME ||
    process.env.PI_CODING_AGENT_DIR ||
    join(homedir(), ".pi", "agent");
  return join(agentHome, "pi-companion");
}

// --- Binary resolution -------------------------------------------------------

function repoRoot() {
  return new URL("..", import.meta.url).pathname;
}

function targetBinaryName() {
  return platform() === "win32" ? "gentle-companion-server.exe" : "gentle-companion-server";
}

function findOnPath(binaryName) {
  const path = process.env.PATH ?? "";
  for (const dir of path.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, binaryName);
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
      // unreadable PATH entry: skip
    }
  }
  return null;
}

export async function resolveBinary(explicit) {
  if (explicit) return explicit;
  const fromEnv = process.env.PI_COMPANION_SERVER;
  if (fromEnv) return fromEnv;
  const root = repoRoot();
  for (const profile of ["release", "debug"]) {
    const candidate = join(root, "server", "target", profile, targetBinaryName());
    if (existsSync(candidate)) return candidate;
  }
  return findOnPath(targetBinaryName());
}

// --- Shared service definition (mirrors src/background-service.ts) ----------

const SUPERVISOR_SCRIPT = `import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
let child; let stopping = false;
function run() {
  if (stopping) return;
  try {
    const { binary, env } = JSON.parse(readFileSync(new URL('./daemon.json', import.meta.url), 'utf8'));
    child = spawn(binary, [], { env: { ...process.env, ...env }, stdio: 'ignore', windowsHide: true });
    let scheduled = false;
    const retry = () => { if (!scheduled && !stopping) { scheduled = true; setTimeout(run, 3000); } };
    child.once('error', retry); child.once('exit', retry);
  } catch { setTimeout(run, 3000); }
}
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { stopping = true; child?.kill('SIGTERM'); setTimeout(() => process.exit(), 1000); });
run();
`;

function serviceEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) => value && (key.startsWith("PI_COMPANION_") || key === "PATH")
    )
  );
}

function xmlEscape(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function shellQuote(text) {
  return (
    '"' +
    text
      .replaceAll("\\", "\\\\")
      .replaceAll('"', '\\"')
      .replaceAll("%", "%%")
      .replaceAll("$", "$$") +
    '"'
  );
}

async function writeSupervisorFiles(dir, binary) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const script = join(dir, "supervisor.mjs");
  const config = join(dir, "daemon.json");
  await writeFile(config + ".tmp", JSON.stringify({ binary, env: serviceEnv() }), {
    mode: 0o600,
  });
  await rename(config + ".tmp", config);
  await writeFile(script, SUPERVISOR_SCRIPT, { mode: 0o600 });
  return { script, config };
}

// --- Platform registration ---------------------------------------------------

async function installLinux(dir, execRun) {
  const script = join(dir, "supervisor.mjs");
  const unitDir = join(homedir(), ".config", "systemd", "user");
  await mkdir(unitDir, { recursive: true });
  const unit = join(unitDir, name + ".service");
  await writeFile(
    unit,
    `[Unit]\nDescription=Pi Companion daemon\n[Service]\nExecStart=${shellQuote(process.execPath)} ${shellQuote(script)}\nRestart=always\nRestartSec=3\n[Install]\nWantedBy=default.target\n`,
    { mode: 0o600 }
  );
  await execRun("systemctl", ["--user", "daemon-reload"]);
  await execRun("systemctl", ["--user", "enable", "--now", name + ".service"]);
  return unit;
}

function linuxManualCommand() {
  return (
    `systemctl --user daemon-reload && ` +
    `systemctl --user enable --now ${name}.service`
  );
}

async function installDarwin(dir, execRun) {
  const script = join(dir, "supervisor.mjs");
  const launchAgents = join(homedir(), "Library", "LaunchAgents");
  await mkdir(launchAgents, { recursive: true });
  const plist = join(launchAgents, label + ".plist");
  await writeFile(
    plist,
    `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>${xmlEscape(process.execPath)}</string><string>${xmlEscape(script)}</string></array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/></dict></plist>`,
    { mode: 0o600 }
  );
  const domain = "gui/" + process.getuid();
  try {
    await execRun("launchctl", ["print", domain + "/" + label]);
  } catch {
    await execRun("launchctl", ["bootstrap", domain, plist]);
  }
  await execRun("launchctl", ["kickstart", domain + "/" + label]);
  return plist;
}

function darwinManualCommand() {
  const plist = join(homedir(), "Library", "LaunchAgents", label + ".plist");
  return `launchctl load -w ${plist}`;
}

async function installWin32(dir, execRun) {
  const script = join(dir, "supervisor.mjs");
  const user = [process.env.USERDOMAIN, process.env.USERNAME].filter(Boolean).join("\\");
  if (!user) throw new Error("Cannot resolve the current Windows account");
  const task = join(dir, "task.xml");
  // No default 72-hour limit, battery/idle stop, or overlapping task instances.
  await writeFile(
    task,
    `\uFEFF<?xml version="1.0" encoding="UTF-16"?><Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"><Triggers><LogonTrigger><Enabled>true</Enabled><UserId>${xmlEscape(user)}</UserId></LogonTrigger></Triggers><Principals><Principal id="User"><UserId>${xmlEscape(user)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals><Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><ExecutionTimeLimit>PT0S</ExecutionTimeLimit><RestartOnFailure><Interval>PT1M</Interval><Count>999</Count></RestartOnFailure></Settings><Actions Context="User"><Exec><Command>${xmlEscape(process.execPath)}</Command><Arguments>&quot;${xmlEscape(script)}&quot;</Arguments></Exec></Actions></Task>`,
    { encoding: "utf16le", mode: 0o600 }
  );
  await execRun("schtasks", ["/Create", "/F", "/TN", taskName, "/XML", task]);
  await execRun("schtasks", ["/Run", "/TN", taskName]);
  return task;
}

function win32ManualCommand() {
  const task = join(resolveCompanionHome(), "service", "task.xml");
  return `schtasks /Create /F /TN "${taskName}" /XML "${task}" && schtasks /Run /TN "${taskName}"`;
}

// --- Platform deregistration -------------------------------------------------

async function uninstallLinux(execRun) {
  const unit = join(homedir(), ".config", "systemd", "user", name + ".service");
  await execRun("systemctl", ["--user", "disable", "--now", name + ".service"]);
  await rm(unit, { force: true });
  await execRun("systemctl", ["--user", "daemon-reload"]);
  return unit;
}

function linuxUninstallManualCommand() {
  return `systemctl --user disable --now ${name}.service && rm ~/.config/systemd/user/${name}.service`;
}

async function uninstallDarwin(execRun) {
  const plist = join(homedir(), "Library", "LaunchAgents", label + ".plist");
  const domain = "gui/" + process.getuid();
  await execRun("launchctl", ["bootout", domain + "/" + label]);
  await rm(plist, { force: true });
  return plist;
}

function darwinUninstallManualCommand() {
  const plist = join(homedir(), "Library", "LaunchAgents", label + ".plist");
  return `launchctl bootout gui/$(id -u)/${label} && rm ${plist}`;
}

async function uninstallWin32(execRun) {
  await execRun("schtasks", ["/End", "/TN", taskName]);
  await execRun("schtasks", ["/Delete", "/TN", taskName, "/F"]);
  return taskName;
}

function win32UninstallManualCommand() {
  return `schtasks /End /TN "${taskName}" && schtasks /Delete /TN "${taskName}" /F`;
}

// --- Status ------------------------------------------------------------------

async function isRegistered() {
  if (platform() === "darwin") {
    return existsSync(join(homedir(), "Library", "LaunchAgents", label + ".plist"));
  }
  if (platform() === "linux") {
    return existsSync(join(homedir(), ".config", "systemd", "user", name + ".service"));
  }
  if (platform() === "win32") {
    try {
      await exec("schtasks", ["/Query", "/TN", taskName], { timeout: 15_000 });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

async function isDaemonUp(timeoutMs = 800) {
  const ws = process.env.PI_COMPANION_URL ?? "ws://127.0.0.1:43721";
  const base = ws.replace(/^ws/, "http").replace(/\/$/, "");
  try {
    const response = await fetch(base + "/api/context", {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// --- Actions -----------------------------------------------------------------

async function doInstall(options) {
  const binary = await resolveBinary(options.binary);
  if (!binary) {
    throw new Error(
      "No server binary found. Pass --binary <path>, set PI_COMPANION_SERVER, " +
        "build server/target/{release,debug}/gentle-companion-server, or put " +
        targetBinaryName() +
        " on PATH."
    );
  }
  const dir = join(resolveCompanionHome(), "service");
  const { script } = await writeSupervisorFiles(dir, binary);
  const run = (command, args) => exec(command, args, { timeout: 15_000 });
  let servicePath;
  let manual = null;
  try {
    if (platform() === "darwin") {
      servicePath = await installDarwin(dir, run);
    } else if (platform() === "linux") {
      servicePath = await installLinux(dir, run);
    } else if (platform() === "win32") {
      servicePath = await installWin32(dir, run);
    } else {
      throw new Error("No supported per-user background service on " + platform());
    }
  } catch (error) {
    // Registration unavailable (e.g. no user systemd session): leave the
    // supervisor files in place and print the exact manual command instead.
    if (platform() === "darwin") {
      servicePath = join(homedir(), "Library", "LaunchAgents", label + ".plist");
      manual = darwinManualCommand();
    } else if (platform() === "linux") {
      servicePath = join(homedir(), ".config", "systemd", "user", name + ".service");
      manual = linuxManualCommand();
    } else if (platform() === "win32") {
      servicePath = join(dir, "task.xml");
      manual = win32ManualCommand();
    } else {
      throw error;
    }
    return {
      registered: false,
      running: await isDaemonUp(),
      servicePath,
      manual,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  return {
    registered: true,
    running: await isDaemonUp(),
    servicePath,
    supervisor: script,
    manual: null,
    error: null,
  };
}

async function doUninstall() {
  const run = (command, args) => exec(command, args, { timeout: 15_000 });
  let servicePath;
  let manual = null;
  let error = null;
  try {
    if (platform() === "darwin") {
      servicePath = await uninstallDarwin(run);
    } else if (platform() === "linux") {
      servicePath = await uninstallLinux(run);
    } else if (platform() === "win32") {
      servicePath = await uninstallWin32(run);
    } else {
      throw new Error("No supported per-user background service on " + platform());
    }
  } catch (err) {
    if (platform() === "darwin") {
      servicePath = join(homedir(), "Library", "LaunchAgents", label + ".plist");
      manual = darwinUninstallManualCommand();
    } else if (platform() === "linux") {
      servicePath = join(homedir(), ".config", "systemd", "user", name + ".service");
      manual = linuxUninstallManualCommand();
    } else if (platform() === "win32") {
      servicePath = taskName;
      manual = win32UninstallManualCommand();
    } else {
      throw err;
    }
    error = err instanceof Error ? err.message : String(err);
  }
  return {
    registered: await isRegistered(),
    running: await isDaemonUp(),
    servicePath,
    manual,
    error,
  };
}

async function doStatus() {
  const servicePath =
    platform() === "darwin"
      ? join(homedir(), "Library", "LaunchAgents", label + ".plist")
      : platform() === "linux"
        ? join(homedir(), ".config", "systemd", "user", name + ".service")
        : platform() === "win32"
          ? taskName
          : null;
  return {
    registered: servicePath ? await isRegistered() : false,
    running: await isDaemonUp(),
    servicePath,
    manual: null,
    error: servicePath ? null : "No supported per-user background service on " + platform(),
  };
}

// --- CLI ---------------------------------------------------------------------

function parseArgv(argv) {
  const options = { action: null, json: false, binary: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--binary") {
      options.binary = argv[++i];
      if (!options.binary) die("--binary requires a path");
    } else if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    } else if (options.action === null && !arg.startsWith("-")) {
      options.action = arg;
    } else {
      die(`unknown argument: ${arg}`);
    }
  }
  return options;
}

const options = parseArgv(process.argv.slice(2));
if (!options.action) {
  usage();
  process.exit(1);
}
if (!["install", "uninstall", "status"].includes(options.action)) {
  die(`unknown action: ${options.action} (expected install|uninstall|status)`);
}

try {
  const result =
    options.action === "install"
      ? await doInstall(options)
      : options.action === "uninstall"
        ? await doUninstall()
        : await doStatus();
  const payload = {
    ok: !result.error,
    action: options.action,
    platform: platform(),
    servicePath: result.servicePath,
    registered: result.registered,
    running: result.running,
    error: result.error,
  };
  if (options.json) {
    console.log(JSON.stringify(payload));
  } else {
    console.log(`action:     ${payload.action}`);
    console.log(`platform:   ${payload.platform}`);
    console.log(`service:    ${payload.servicePath ?? "(none)"}`);
    console.log(`registered: ${payload.registered}`);
    console.log(`running:    ${payload.running}`);
    if (result.supervisor) console.log(`supervisor: ${result.supervisor}`);
    if (result.manual) {
      console.log(`\nAutomatic registration unavailable. Run manually:\n  ${result.manual}`);
    }
    if (payload.error) console.log(`error:      ${payload.error}`);
  }
  process.exit(payload.ok ? 0 : 1);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (options.json) {
    console.log(
      JSON.stringify({
        ok: false,
        action: options.action,
        platform: platform(),
        servicePath: null,
        registered: false,
        running: false,
        error: message,
      })
    );
  } else {
    die(message);
  }
  process.exit(1);
}
