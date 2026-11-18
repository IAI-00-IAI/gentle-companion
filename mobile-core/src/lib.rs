//! Gentle Movil Rust core.
//!
//! Thin, stable native core behind the phone app: QR pairing, ed25519 device identity,
//! release-signature verification and the SSH transport (session, direct-tcpip tunnel,
//! one-shot exec). It implements the **frozen v1 FFI surface** of
//! `docs/mobile-protocol-spec.md` §6; the stack that consumes it is frozen in
//! `docs/mobile-app-stack.md`.
//!
//! ## Module tree
//!
//! | module | responsibility |
//! |---|---|
//! | [`error`] | [`CoreError`] — the single error type, with stable [`kind`](CoreError::kind) strings |
//! | [`qr`] | `gc://pair?v=1` parsing and the [`PairInfo`] summary record (§1) |
//! | [`fingerprint`] | host key fingerprint encoding: compact hex and `aa:bb:…` display form |
//! | [`device_key`] | ed25519 device identity, signing and `cryptoVerify` (§2, §3.2) |
//! | [`ssh`] | russh transport behind mockable traits: connect, host key, tunnel, exec (§4) |
//! | [`ffi`] | [`MobileCore`]: the owned, generic-free, FFI-ready facade of the frozen surface |
//!
//! ## OTA rule (`docs/mobile-app-stack.md`, "Regla de oro de la OTA")
//!
//! This crate is deliberately thin and stable: `connect`, `read`, `write`, `exec`, `pair`,
//! device keys and signature verification. Every product rule (UI, daemon protocol
//! parsing, automations, modes) lives in TypeScript so EAS Update can ship it without a
//! store build.
//!
//! ## Offline testability
//!
//! No test needs a network or an SSH server. Parsing, fingerprints, device keys, error
//! mapping and the whole session/channel bookkeeping run against in-memory mocks of the
//! [`ssh::Transport`] traits; russh itself is only reached through [`ssh::RusshTransport`],
//! which the unit tests never dial.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

pub mod device_key;
pub mod error;
pub mod ffi;
pub mod fingerprint;
pub mod qr;
pub mod ssh;

pub use device_key::{DeviceKeyPair, StoredKey};
pub use error::CoreError;
pub use ffi::{ChannelId, CoreErrorPayload, MobileCore, SessionId};
pub use qr::PairInfo;
pub use ssh::{Channel, ConnectRequest, ExecOutput, SshCredential, SshSession};
