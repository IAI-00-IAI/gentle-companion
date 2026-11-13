import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Resolve the Pi Companion home directory.
 *
 * Precedence:
 * 1. `PI_COMPANION_HOME` — explicit, absolute or relative.
 * 2. `GENTLE_PI_AGENT_HOME` — the Gentle Shell / Gentle Pi agent home.
 * 3. `PI_CODING_AGENT_DIR` — the Pi coding agent home (also set by Gentle Shell).
 * 4. `~/.pi/agent` — the stock Pi fallback.
 *
 * Cases 2 through 4 resolve to `<agent home>/pi-companion`; case 1 is used
 * verbatim so existing `PI_COMPANION_HOME` installations keep their exact path.
 */
export function resolveCompanionHome(): string {
  const explicit = process.env.PI_COMPANION_HOME;
  if (explicit) return resolve(explicit);
  const agentHome =
    process.env.GENTLE_PI_AGENT_HOME ||
    process.env.PI_CODING_AGENT_DIR ||
    join(homedir(), ".pi", "agent");
  return join(agentHome, "pi-companion");
}
