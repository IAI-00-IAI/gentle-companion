#!/usr/bin/env node
// Install pi-companion into Gentle Shell (a Pi fork) as a standard Pi package.
//
// Gentle Shell reuses Pi's native package command, so pi-companion's `pi`
// manifest (extension + skills) is honored without any fork-specific glue.
//
// Usage:
//   node tools/install-gentle-shell.mjs [--no-verify-binary]
//
// Requires gentle-shell (or a compatible Pi) on PATH.

import { spawn, execFile } from "node:child_process";
import { constants } from "node:net";

const PACKAGE = "@rgaricano/gentle-companion";

function die(msg) {
  console.error(`error: ${msg}\n`);
  process.exit(1);
}

async function which(cmd) {
  try {
    const out = await execFile("which", [cmd], { encoding: "utf8" });
    return out.trim().split("\n")[0] || null;
  } catch {
    return null;
  }
}

const gentleBin = await which("gentle-shell");
const piBin = await which("pi");

if (!gentleBin && !piBin) {
  die(
    "neither `gentle-shell` nor `pi` was found on PATH. " +
      "Install Gentle Shell first, then re-run this script."
  );
}

const binary = gentleBin ?? piBin;
const isGentle = Boolean(gentleBin);

console.log(`Installing ${PACKAGE} with ${binary}`);
console.log(isGentle ? "target: Gentle Shell (gentle-pi)" : "target: Pi");

const args = ["install", `npm:${PACKAGE}`];
const child = spawn(binary, args, { stdio: "inherit" });

child.on("error", (err) => die(`spawn failed: ${err.message}`));

child.on("close", (code) => {
  if (code === 0) {
    console.log(`Installed ${PACKAGE}. Start ${isGentle ? "Gentle Shell" : "Pi"} to load the extension.`);
    console.log("Companion data home defaults to <agent home>/pi-companion. Set PI_COMPANION_HOME to override.");
  } else {
    die(`install exited with code ${code}`);
  }
});
