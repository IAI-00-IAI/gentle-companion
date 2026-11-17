#!/usr/bin/env node
// Assemble a publishable copy of the Companion client for a public HTTPS static host.
//
// Why: the client is served over plain HTTP from a LAN address by default, so a phone
// away from that network cannot load it and cannot install it as an app. Publishing the
// built client to an HTTPS host (GitHub Pages, Netlify, Cloudflare Pages, an object
// store) gives it a stable secure origin that works from anywhere; the daemon is then
// reached only through the tailcat tunnel.
//
// Usage:
//   node tools/publish-client.mjs [--out <dir>]
//   node tools/publish-client.mjs --check [--out <dir>]
//
// The UI must be built first (`npm run ui:build` writes server/web-dist).

import { cp, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WEB_DIST = join(ROOT, "server", "web-dist");
const VENDOR = join(ROOT, "bridge", "vendor");
const DEFAULT_OUT = join(ROOT, "dist", "client-pages");

/** Files the client needs from the tailcat runtime, at the paths it already requests. */
const VENDOR_FILES = ["wasm_exec.js", "main.wasm"];

/** Files that must exist in an assembled tree for it to be publishable. */
const REQUIRED = [
  "200.html",
  "_app",
  "manifest.webmanifest",
  "service-worker.js",
  "bridge/vendor/main.wasm",
  "bridge/vendor/wasm_exec.js",
];

function die(message) {
  console.error(`error: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = { out: DEFAULT_OUT, check: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--check") options.check = true;
    else if (arg === "--out") {
      const value = argv[++index];
      if (!value) die("--out needs a directory");
      options.out = resolve(value);
    } else if (arg === "--help" || arg === "-h") {
      console.log("usage: node tools/publish-client.mjs [--out <dir>] [--check]");
      process.exit(0);
    } else die(`unknown argument: ${arg}`);
  }
  return options;
}

async function treeSize(dir) {
  let total = 0;
  const walk = async (current) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else total += (await stat(path)).size;
    }
  };
  await walk(dir);
  return total;
}

function human(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function assemble(out) {
  if (!existsSync(WEB_DIST)) {
    die(`the UI is not built: ${WEB_DIST} is missing. Run \`npm run ui:build\` first.`);
  }
  for (const file of VENDOR_FILES) {
    if (!existsSync(join(VENDOR, file))) {
      die(`the tailcat runtime is missing: ${join(VENDOR, file)}. It ships in the repository.`);
    }
  }

  // Copy over the existing tree: cp with force replaces changed files. A stale asset
  // from a previous build is harmless because every asset name carries a content hash.
  await mkdir(out, { recursive: true });
  await cp(WEB_DIST, out, { recursive: true, force: true });
  const vendorOut = join(out, "bridge", "vendor");
  await mkdir(vendorOut, { recursive: true });
  for (const file of VENDOR_FILES) {
    await cp(join(VENDOR, file), join(vendorOut, file), { force: true });
  }
  // GitHub Pages runs Jekyll by default, which drops directories starting with "_" —
  // that would delete the entire `_app/` bundle.
  await writeFile(join(out, ".nojekyll"), "");

  const size = await treeSize(out);
  console.log(`assembled ${out}`);
  console.log(`size: ${human(size)}`);
  if (size > 100 * 1024 * 1024) {
    console.log("warning: above 100 MB — most static hosts accept it, but check the limits.");
  }
  console.log("");
  console.log("Next steps:");
  console.log("  1. Publish this directory to your HTTPS host (the pages.yml workflow does it for GitHub Pages).");
  console.log("  2. Open https://<host>/#tunnel=<tc-address>&port=<device-port> on the phone.");
  console.log("  3. Add that origin to PI_COMPANION_ALLOWED_ORIGINS on the daemon.");
}

async function check(out) {
  if (!existsSync(out)) die(`${out} does not exist. Run the publish step first.`);
  const missing = [];
  for (const relative of REQUIRED) {
    if (!existsSync(join(out, relative))) missing.push(relative);
  }
  if (missing.length) {
    console.error("error: the assembled tree is incomplete:");
    for (const relative of missing) console.error(`  missing: ${relative}`);
    process.exit(1);
  }
  const size = await treeSize(out);
  console.log(`ok: ${out} has every required file (${human(size)})`);
}

const options = parseArgs(process.argv.slice(2));
if (options.check) await check(options.out);
else await assemble(options.out);
