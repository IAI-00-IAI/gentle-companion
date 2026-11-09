export interface BridgeLink {
  path: string;
  origin: string;
}

/**
 * Owns the relay link of one preview. The link is revoked exactly once, whenever the preview ends,
 * including when it ends while the link is still being created: a link that arrives after
 * `end()` is revoked at once instead of being shown.
 */
export class BridgeLease {
  private link: BridgeLink | undefined;
  private ended = false;
  private readonly revoke: (path: string) => Promise<void>;

  constructor(revoke: (path: string) => Promise<void>) {
    this.revoke = revoke;
  }

  /** Take a newly created link. Returns it when the preview is still open, otherwise revokes it and returns nothing. */
  accept(link: BridgeLink): BridgeLink | undefined {
    if (this.ended) {
      this.revokeQuietly(link.path);
      return undefined;
    }
    this.link = link;
    return link;
  }

  /** The preview is closing or gone. Safe to call more than once. */
  end(): void {
    this.ended = true;
    const held = this.link;
    this.link = undefined;
    if (held) this.revokeQuietly(held.path);
  }

  private revokeQuietly(path: string) {
    void this.revoke(path).catch(() => {});
  }
}
