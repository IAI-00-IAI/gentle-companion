import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const moduleURL = (source: string) =>
  "data:text/javascript;base64," + Buffer.from(source).toString("base64");

const transpile = async (text: string) =>
  (await import("typescript")).default.transpileModule(text, {
    compilerOptions: { module: 99, target: 99 },
  }).outputText;

const { resolveCompanionHome } = await import(
  moduleURL(
    await transpile(
      await readFile(new URL("../src/home.ts", import.meta.url), "utf8")
    )
  )
);

function withEnv(env: Record<string, string | undefined>): () => void {
  const saved: Record<string, string | undefined> = {};
  const keys = Object.keys(env);
  for (const key of keys) {
    saved[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  return () => {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  };
}

test("PI_COMPANION_HOME wins and is resolved absolute", () => {
  const restore = withEnv({ PI_COMPANION_HOME: "/opt/companion" });
  try {
    assert.equal(resolveCompanionHome(), "/opt/companion");
  } finally {
    restore();
  }
});

test("GENTLE_PI_AGENT_HOME takes precedence over the stock fallback", () => {
  const home = "/agent/home";
  const restore = withEnv({ GENTLE_PI_AGENT_HOME: home, PI_CODING_AGENT_DIR: "/other" });
  try {
    assert.equal(resolveCompanionHome(), join(home, "pi-companion"));
  } finally {
    restore();
  }
});

test("PI_CODING_AGENT_DIR takes precedence when GENTLE_PI_AGENT_HOME is unset", () => {
  const home = "/agent/home";
  const restore = withEnv({
    GENTLE_PI_AGENT_HOME: undefined,
    PI_CODING_AGENT_DIR: home,
  });
  try {
    assert.equal(resolveCompanionHome(), join(home, "pi-companion"));
  } finally {
    restore();
  }
});

test("falls back to ~/.pi/agent/pi-companion when no env vars are set", () => {
  const restore = withEnv({
    PI_COMPANION_HOME: undefined,
    GENTLE_PI_AGENT_HOME: undefined,
    PI_CODING_AGENT_DIR: undefined,
  });
  try {
    assert.equal(
      resolveCompanionHome(),
      join(homedir(), ".pi", "agent", "pi-companion"),
    );
  } finally {
    restore();
  }
});
