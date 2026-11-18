/**
 * TypeScript contract of the Rust core (`mobile-core/`), derived from
 * `docs/mobile-protocol-spec.md` §6 ("Superficie del core Rust — congelada v1").
 *
 * This file is the ONLY place the UI learns about the native layer. Everything
 * product-level (daemon protocol parsing, tunnel protocol, state machines) stays
 * in TS so it can ship over EAS Update (stack doc — "regla de oro de la OTA").
 *
 * The v1 slice needed by the pairing flow is the four calls below; §6 also
 * freezes `sshDirectTcp`, `channelRead`, `channelWrite`, `sftpPut`, `execOnce`,
 * `deviceKeyPublic` and the `sqlite*` store, which get their own typed wrappers
 * when those screens land (V3+).
 *
 * ---------------------------------------------------------------------------
 * DEV FALLBACK — `coreStub` below is NOT the real core. It never fakes success:
 * every call rejects with `CoreUnavailableError` so the UI shows its honest
 * "core not compiled" state. The real binding (uniFFI) replaces `core` only.
 * ---------------------------------------------------------------------------
 */

/** Parsed QR payload (`gc://pair?…`, spec §1). */
export interface PairInfo {
  /** LAN IP or hostname of the host. */
  host: string;
  /** SSH port (22 when omitted in the QR). */
  port: number;
  /** SSH user on the host. */
  user: string;
  /** One-time invite token, TTL 5 min (spec §1, §8). */
  token: string;
  /** ed25519 host fingerprint shown to the user for MITM confirmation (TOFU). */
  fp: string;
  /** Daemon protocol minor version the host advertises. */
  proto: string;
}

/**
 * SSH credential for the first connection (spec §1 last paragraph): the user's
 * password, or an existing key already authorized on the host. Device ed25519
 * keys live in Keychain/Keystore and are never passed as a credential
 * (spec §2.1).
 */
export type SshCredential =
  | { type: 'password'; value: string }
  | { type: 'key'; path: string; passphrase?: string };

/** Live SSH session returned by `sshConnect`. */
export interface SshSessionHandle {
  /** Opaque session id owned by the core. */
  id: string;
  /** Host key fingerprint presented during the handshake, for TOFU comparison. */
  fingerprint: string;
  /** Releases the session and its channels. */
  close(): Promise<void>;
}

/**
 * Phone identity generated on the device (spec §2.1). The private half never
 * leaves Keychain/Keystore, so only the public description crosses the FFI.
 */
export interface DeviceKeyPair {
  /** ed25519 public key in OpenSSH wire form (`ssh-ed25519 AAAA…`). */
  publicKey: string;
  /** OpenSSH SHA256 fingerprint (`SHA256:…`), shown to the user. */
  fingerprint: string;
}

/** The native surface frozen in spec §6 (v1 slice). */
export interface MobileCore {
  /** Parses a scanned `gc://pair?…` string into a `PairInfo`. */
  pairFromQr(uri: string): Promise<PairInfo>;
  /** Opens the SSH session used for pairing and provisioning. */
  sshConnect(
    host: string,
    port: number,
    user: string,
    cred: SshCredential,
  ): Promise<SshSessionHandle>;
  /** Creates the device ed25519 key pair in secure storage on first use. */
  deviceKeyGenerate(): Promise<DeviceKeyPair>;
  /** Verifies a signature (release checksum, spec §3.2) against a public key. */
  cryptoVerify(
    pubkey: string,
    payload: Uint8Array,
    sig: Uint8Array,
  ): Promise<boolean>;
}

/**
 * Rejection reason used while the native core is not part of the build. The UI
 * must treat it as "no connection was made", never as success.
 */
export class CoreUnavailableError extends Error {
  /** Core method that was called. */
  readonly method: string;

  constructor(method: string) {
    super(
      `CoreUnavailableError: ${method} needs the Rust core (mobile-core), which is not compiled into this build.`,
    );
    this.name = 'CoreUnavailableError';
    this.method = method;
  }
}

/** Observable state of the dev fallback, so the UI can show `connecting`. */
export type CoreStubState = 'idle' | 'connecting';

/** Dev-only stub; typed separately so it can never masquerade as the core. */
export interface CoreStub extends MobileCore {
  /** Last state the stub reached before refusing the call. */
  readonly state: CoreStubState;
}

// TODO(ffi): replace with uniFFI binding of mobile-core (spec §6) — this stub is for UI dev only.
let stubState: CoreStubState = 'idle';

const coreStub: CoreStub = {
  get state() {
    return stubState;
  },
  async pairFromQr(uri) {
    throw new CoreUnavailableError('pairFromQr');
  },
  async sshConnect(host, port, user, cred) {
    // Flip to `connecting` before refusing: the pipeline really does start, so
    // the UI must not show a success state it did not reach.
    stubState = 'connecting';
    throw new CoreUnavailableError('sshConnect');
  },
  async deviceKeyGenerate() {
    throw new CoreUnavailableError('deviceKeyGenerate');
  },
  async cryptoVerify() {
    throw new CoreUnavailableError('cryptoVerify');
  },
};

/**
 * Single swap point for the native binding: screens and hooks import `core`
 * (typed as `MobileCore`), never the stub.
 */
export const core: MobileCore = coreStub;
