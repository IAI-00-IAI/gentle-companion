export interface BridgeLink {
  path: string;
  origin: string;
  /** How long the daemon keeps the link without a request or renewal. */
  leaseSeconds?: number;
}

/** The daemon answered and the link is definitely gone (or was never ours): retrying cannot help. */
function isDefinitive(error: unknown) {
  const status = (error as { status?: unknown } | undefined)?.status;
  return status === 401 || status === 403 || status === 404 || status === 409;
}

type Timer = (run: () => void, ms: number) => () => void;
const browserTimer: Timer = (run, ms) => {
  const handle = setTimeout(run, ms);
  return () => clearTimeout(handle);
};

/**
 * Revocations that must survive their preview. A revoke that could not reach the daemon (phone went
 * offline just before Close) is kept and retried until it is confirmed, the daemon says the link is
 * already gone, or the daemon's own lease would have ended it anyway.
 */
export class RevocationQueue {
  private readonly pending = new Map<string, { sessionId: string; path: string; since: number }>();
  private cancelTimer: (() => void) | undefined;
  private readonly send: (sessionId: string, path: string) => Promise<void>;
  private readonly onUnconfirmed: (() => void) | undefined;
  private readonly timer: Timer;
  private readonly now: () => number;
  private readonly retryMs: number;
  private readonly giveUpMs: number;

  constructor(
    send: (sessionId: string, path: string) => Promise<void>,
    options: { onUnconfirmed?: () => void; timer?: Timer; now?: () => number; retryMs?: number; giveUpMs?: number } = {}
  ) {
    this.send = send;
    this.onUnconfirmed = options.onUnconfirmed;
    this.timer = options.timer ?? browserTimer;
    this.now = options.now ?? Date.now;
    this.retryMs = options.retryMs ?? 10_000;
    this.giveUpMs = options.giveUpMs ?? 6 * 60_000;
  }

  /** Links whose shutdown the daemon has not confirmed yet. */
  get unconfirmed() {
    return this.pending.size;
  }

  /** Try now; on a transient failure keep the revocation and retry. Never throws. */
  async revoke(sessionId: string, path: string): Promise<void> {
    const confirmed = await this.attempt(sessionId, path);
    if (confirmed) return;
    if (!this.pending.has(path)) {
      this.pending.set(path, { sessionId, path, since: this.now() });
      this.onUnconfirmed?.();
    }
    this.scheduleRetry();
  }

  /** Retry everything still pending (also called when the device comes back online). */
  async flush(): Promise<void> {
    this.cancelTimer?.();
    this.cancelTimer = undefined;
    for (const entry of [...this.pending.values()]) {
      const expired = this.now() - entry.since > this.giveUpMs;
      const confirmed = expired || (await this.attempt(entry.sessionId, entry.path));
      if (confirmed) this.pending.delete(entry.path);
    }
    this.scheduleRetry();
  }

  /** True when the daemon confirmed, or when retrying is pointless. */
  private async attempt(sessionId: string, path: string) {
    try {
      await this.send(sessionId, path);
      return true;
    } catch (error) {
      return isDefinitive(error);
    }
  }

  private scheduleRetry() {
    if (this.pending.size === 0 || this.cancelTimer) return;
    this.cancelTimer = this.timer(() => {
      this.cancelTimer = undefined;
      void this.flush();
    }, this.retryMs);
  }
}

export interface LeaseOptions {
  sessionId: () => string;
  revocations: RevocationQueue;
  /** Tell the daemon the preview is still open. */
  renew: (sessionId: string, path: string) => Promise<void>;
  /** The daemon says the link has ended (expired, revoked, Pi stopped): the preview must stop showing it. */
  onLost: () => void;
  timer?: (run: () => void, ms: number) => () => void;
}

/**
 * Owns the relay link of one preview. While the preview is open it renews the daemon's short lease;
 * when the preview ends, including while the link is still being created, the link is revoked through
 * the queue so a failed revoke is retried. A link that arrives after `end()` is revoked at once.
 */
export class BridgeLease {
  private link: BridgeLink | undefined;
  private ended = false;
  private stopHeartbeat: (() => void) | undefined;
  private readonly options: LeaseOptions;

  constructor(options: LeaseOptions) {
    this.options = options;
  }

  /** Take a newly created link. Returns it when the preview is still open, otherwise revokes it and returns nothing. */
  accept(link: BridgeLink): BridgeLink | undefined {
    if (this.ended) {
      void this.options.revocations.revoke(this.options.sessionId(), link.path);
      return undefined;
    }
    this.link = link;
    this.beat(link);
    return link;
  }

  /** The preview is closing or gone. Safe to call more than once. */
  end(): void {
    this.ended = true;
    this.stopHeartbeat?.();
    this.stopHeartbeat = undefined;
    const held = this.link;
    this.link = undefined;
    if (held) void this.options.revocations.revoke(this.options.sessionId(), held.path);
  }

  private beat(link: BridgeLink) {
    const leaseMs = (link.leaseSeconds ?? 300) * 1000;
    const timer = this.options.timer ?? browserTimer;
    // Five renewals per lease: a missed beat or two (a throttled background tab) is harmless.
    const wait = Math.max(1_000, Math.floor(leaseMs / 5));
    const schedule = () => {
      this.stopHeartbeat = timer(() => void this.renew(link, schedule), wait);
    };
    this.stopHeartbeat?.();
    schedule();
  }

  private async renew(link: BridgeLink, next: () => void) {
    if (this.ended || this.link !== link) return;
    try {
      await this.options.renew(this.options.sessionId(), link.path);
    } catch (error) {
      if (isDefinitive(error)) {
        this.link = undefined;
        this.stopHeartbeat = undefined;
        this.options.onLost();
        return;
      }
    }
    if (!this.ended && this.link === link) next();
  }
}
