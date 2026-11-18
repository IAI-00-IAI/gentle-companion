//! FFI-ready facade: the frozen surface of `docs/mobile-protocol-spec.md` §6.
//!
//! ## What this module is
//!
//! A deliberately boring binding surface. It has **no generics, no lifetimes in
//! signatures and no borrowed parameters**: every parameter and return value is an owned
//! `String`, `Vec<u8>`, integer, `Option` or a plain record of those. That is exactly what
//! UniFFI can bind (the `#[uniffi::export]` macros are a later task; this module only
//! enforces the shape), and it is also why the stateful part ([`MobileCore`]) keeps
//! sessions and channels in id-keyed maps instead of handing out trait objects.
//!
//! | spec §6 | here |
//! |---|---|
//! | `pairFromQr(uri) -> PairInfo` | [`MobileCore::pair_from_qr`] |
//! | `sshConnect(host, port, user, cred) -> SessionId` | [`MobileCore::ssh_connect`] |
//! | `sshDirectTcp(sessionId, targetHost, targetPort) -> ChannelId` | [`MobileCore::ssh_direct_tcp`] |
//! | `channelRead(channelId) -> bytes` | [`MobileCore::channel_read`] |
//! | `channelWrite(channelId, bytes)` | [`MobileCore::channel_write`] |
//! | `execOnce(sessionId, cmd) -> {exitCode, stdout, stderr}` | [`MobileCore::exec_once`] |
//! | `deviceKeyGenerate() -> PublicKey` | [`MobileCore::device_key_generate`] |
//! | `deviceKeyPublic() -> PublicKey` | [`MobileCore::device_key_public`] |
//! | `cryptoVerify(releasePubkey, payload, signature) -> bool` | [`MobileCore::crypto_verify`] |
//!
//! ## Deferred, on purpose
//!
//! * `sftpPut` belongs to the daemon-provisioning task (T7) — it needs a real SFTP client
//!   implementation, not a stub.
//! * `sqliteOpen`/`openStore` belongs to the local-mode store task (T9).
//! * §6 has **no teardown** call, so sessions and channels live as long as the
//!   [`MobileCore`] value; see `risks` in the task report.
//! * [`MobileCore::session_fingerprint`] / [`MobileCore::session_fingerprint_compact`] are
//!   additive read-only accessors: §8 requires the host key fingerprint to be visible and
//!   confirmable before the user trusts the host, and §6 forgot a way to read it.
//!
//! ## Device identity and the keystore
//!
//! [`MobileCore::device_key_generate`] returns the full [`DeviceKeyPair`] because the
//! **native** shell (Swift/Kotlin) is the only layer allowed to write the platform
//! keystore. The TypeScript layer must receive `public_hex` only: `secret` is the device
//! identity (§0.2, §2) and must never cross into the JS runtime or a log. Later sessions
//! hand the seed back through [`MobileCore::device_key_public`] /
//! [`mobile_core::ssh::SshCredential::Key`] after reading it from the keystore.
//!
//! ## Errors
//!
//! Every fallible call returns [`CoreErrorPayload`] (`{kind, message}`) instead of
//! [`crate::error::CoreError`], because the latter wraps a `std::io::Error` that cannot
//! cross an FFI boundary. `kind` is the stable discriminator documented on
//! [`CoreError::kind`](crate::error::CoreError::kind).

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

use crate::device_key::{self, DeviceKeyPair, StoredKey};
use crate::error::CoreError;
use crate::qr::{self, PairInfo};
use crate::ssh::{
    Channel, ChannelEvent, ConnectRequest, ExecOutput, RusshTransport, SshCredential, SshSession,
    Transport,
};

/// Opaque session handle. Values are never reused inside one [`MobileCore`].
pub type SessionId = u64;
/// Opaque channel handle. Values are never reused inside one [`MobileCore`].
pub type ChannelId = u64;

/// FFI-safe error record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CoreErrorPayload {
    /// Stable discriminator, one of `invalid_qr`, `ssh`, `io`, `crypto`,
    /// `unsupported_version`.
    pub kind: String,
    /// Human-readable message, safe to show in the UI.
    pub message: String,
}

impl From<CoreError> for CoreErrorPayload {
    fn from(error: CoreError) -> Self {
        Self {
            kind: error.kind().to_string(),
            message: error.to_string(),
        }
    }
}

impl std::fmt::Display for CoreErrorPayload {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.kind, self.message)
    }
}

/// The stateful object the native shell owns and the TS layer calls into.
///
/// Holds the SSH transport plus the id registries. It is `Send + Sync`, so a single value
/// can be shared by the app for its whole lifetime.
pub struct MobileCore {
    transport: Arc<dyn Transport>,
    sessions: Mutex<HashMap<SessionId, Arc<SshSession>>>,
    channels: Mutex<HashMap<ChannelId, Arc<Channel>>>,
    next_session_id: AtomicU64,
    next_channel_id: AtomicU64,
}

impl MobileCore {
    /// Facade over the real russh transport.
    pub fn new() -> Self {
        Self::with_transport(Arc::new(RusshTransport::new()))
    }

    /// Facade over a caller-provided transport (the offline test seam).
    pub fn with_transport(transport: Arc<dyn Transport>) -> Self {
        Self {
            transport,
            sessions: Mutex::new(HashMap::new()),
            channels: Mutex::new(HashMap::new()),
            next_session_id: AtomicU64::new(1),
            next_channel_id: AtomicU64::new(1),
        }
    }

    /// `pairFromQr`: parse and validate a scanned `gc://pair?v=1` invitation (§1).
    pub fn pair_from_qr(&self, uri: String) -> Result<PairInfo, CoreErrorPayload> {
        qr::pair_from_qr(&uri).map_err(CoreErrorPayload::from)
    }

    /// `sshConnect`: open an authenticated session and register it under a fresh id.
    pub async fn ssh_connect(
        &self,
        host: String,
        port: u16,
        user: String,
        credential: SshCredential,
    ) -> Result<SessionId, CoreErrorPayload> {
        let request = ConnectRequest::new(&host, port, &user, credential);
        let session = SshSession::connect_with(self.transport.as_ref(), request)
            .await
            .map_err(CoreErrorPayload::from)?;
        let session_id = next_id(&self.next_session_id);
        lock(&self.sessions).insert(session_id, Arc::new(session));
        Ok(session_id)
    }

    /// `sshDirectTcp`: open a direct-tcpip channel to `target_host:target_port` (§4).
    pub async fn ssh_direct_tcp(
        &self,
        session_id: SessionId,
        target_host: String,
        target_port: u16,
    ) -> Result<ChannelId, CoreErrorPayload> {
        let session = self.session(session_id)?;
        let channel = session
            .direct_tcp(&target_host, target_port)
            .await
            .map_err(CoreErrorPayload::from)?;
        let channel_id = next_id(&self.next_channel_id);
        lock(&self.channels).insert(channel_id, Arc::new(channel));
        Ok(channel_id)
    }

    /// `channelRead`: next chunk of the channel.
    ///
    /// An **empty `Vec` signals end of stream** (EOF or closed channel) — byte streams have
    /// no in-band EOF marker, and this is the convention the TS tunnel client consumes.
    /// Extended data on a tunnel channel is a protocol violation and is reported as an
    /// `ssh` error rather than silently dropped.
    pub async fn channel_read(&self, channel_id: ChannelId) -> Result<Vec<u8>, CoreErrorPayload> {
        let channel = self.channel(channel_id)?;
        match channel.read().await.map_err(CoreErrorPayload::from)? {
            ChannelEvent::Data(bytes) => Ok(bytes),
            ChannelEvent::Eof => Ok(Vec::new()),
            ChannelEvent::ExtendedData { ext, .. } => Err(CoreErrorPayload::from(CoreError::ssh(
                format!("unexpected extended data frame (ext {ext}) on a tunnel channel"),
            ))),
        }
    }

    /// `channelWrite`: write bytes to the channel.
    pub async fn channel_write(
        &self,
        channel_id: ChannelId,
        bytes: Vec<u8>,
    ) -> Result<(), CoreErrorPayload> {
        let channel = self.channel(channel_id)?;
        channel
            .write(&bytes)
            .await
            .map_err(CoreErrorPayload::from)
    }

    /// `execOnce`: run one command and collect its result (daemon detection, `uname -m`,
    /// `daemon restart`, … — §3, §5).
    pub async fn exec_once(
        &self,
        session_id: SessionId,
        command: String,
    ) -> Result<ExecOutput, CoreErrorPayload> {
        let session = self.session(session_id)?;
        session
            .exec_once(&command)
            .await
            .map_err(CoreErrorPayload::from)
    }

    /// Host key fingerprint of a live session in display form (`aa:bb:…`).
    ///
    /// Additive to §6 (see the module docs): §8 requires this value to be confirmable by
    /// the user before the host is trusted.
    pub fn session_fingerprint(&self, session_id: SessionId) -> Result<String, CoreErrorPayload> {
        Ok(self.session(session_id)?.fingerprint_of_host_key())
    }

    /// Host key fingerprint of a live session in compact form (64 hex chars), directly
    /// comparable with [`PairInfo::fingerprint`] from the scanned QR.
    pub fn session_fingerprint_compact(
        &self,
        session_id: SessionId,
    ) -> Result<String, CoreErrorPayload> {
        Ok(self.session(session_id)?.fingerprint_compact())
    }

    /// `deviceKeyGenerate`: create the phone's ed25519 identity (§2.1).
    ///
    /// Returns both halves because the native shell is the keystore writer; the TS layer
    /// must only ever see [`DeviceKeyPair::public_hex`].
    pub fn device_key_generate(&self) -> DeviceKeyPair {
        device_key::generate()
    }

    /// `deviceKeyPublic`: derive the public key of a stored secret (`§6`), used on every
    /// later connection to prove the stored keystore entry is still consistent.
    pub fn device_key_public(&self, secret: StoredKey) -> Result<String, CoreErrorPayload> {
        device_key::public_hex_from_secret(&secret).map_err(CoreErrorPayload::from)
    }

    /// `cryptoVerify`: verify a release signature (§3.2, §5).
    ///
    /// `false` on a bad key, bad payload, bad signature or malformed input: the caller
    /// must abort the download, so no failure mode may be a panic or an `Err`.
    pub fn crypto_verify(
        &self,
        release_pubkey: String,
        payload: Vec<u8>,
        signature: Vec<u8>,
    ) -> bool {
        device_key::verify(&release_pubkey, &payload, &signature)
    }

    /// Look up a live session, or fail with an `ssh` error naming the unknown id.
    fn session(&self, session_id: SessionId) -> Result<Arc<SshSession>, CoreErrorPayload> {
        match lock(&self.sessions).get(&session_id) {
            Some(session) => Ok(Arc::clone(session)),
            None => Err(CoreErrorPayload::from(CoreError::ssh(format!(
                "unknown session id {session_id}"
            )))),
        }
    }

    /// Look up a live channel, or fail with an `ssh` error naming the unknown id.
    fn channel(&self, channel_id: ChannelId) -> Result<Arc<Channel>, CoreErrorPayload> {
        match lock(&self.channels).get(&channel_id) {
            Some(channel) => Ok(Arc::clone(channel)),
            None => Err(CoreErrorPayload::from(CoreError::ssh(format!(
                "unknown channel id {channel_id}"
            )))),
        }
    }
}

impl Default for MobileCore {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Debug for MobileCore {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MobileCore")
            .field("sessions", &lock(&self.sessions).len())
            .field("channels", &lock(&self.channels).len())
            .finish_non_exhaustive()
    }
}

/// Allocate the next handle of a registry, never reusing a value.
fn next_id(counter: &AtomicU64) -> u64 {
    counter.fetch_add(1, Ordering::Relaxed)
}

/// Lock a registry, recovering from a poisoned mutex instead of propagating a panic.
fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::qr::DEFAULT_PORT;
    use crate::ssh::mock::{MockTransport, FP};

    fn core() -> (MobileCore, Arc<MockTransport>) {
        let transport = Arc::new(MockTransport::default());
        (
            MobileCore::with_transport(Arc::clone(&transport) as Arc<dyn Transport>),
            transport,
        )
    }

    const FP_HEX: &str = "66402c9468c58941dd19ffd650bf2b42f9226f83d3bd06ad515d0e5104a77020";

    fn valid_uri() -> String {
        format!(
            "gc://pair?v=1&host=192.168.1.42&port=2222&user=reaan&token=inv_7Qp2&fp={FP_HEX}&proto=1"
        )
    }

    #[test]
    fn pair_from_qr_returns_the_summary_record() {
        let (core, _) = core();
        let info = core.pair_from_qr(valid_uri()).expect("valid uri");
        assert_eq!(info.host, "192.168.1.42");
        assert_eq!(info.port, 2222);
        assert_eq!(info.user, "reaan");
        assert_eq!(info.token, "inv_7Qp2");
        assert_eq!(info.fingerprint, FP_HEX);
        assert_eq!(info.daemon_protocol_minor, Some(1));
        assert_eq!(info.version, 1);
    }

    #[test]
    fn pair_from_qr_defaults_the_port() {
        let (core, _) = core();
        let info = core
            .pair_from_qr(format!(
                "gc://pair?v=1&host=gentle.local&user=reaan&token=t&fp={FP_HEX}"
            ))
            .expect("valid uri");
        assert_eq!(info.port, DEFAULT_PORT);
    }

    #[test]
    fn pair_from_qr_maps_invalid_uris_to_an_invalid_qr_payload() {
        let (core, _) = core();
        let payload = core.pair_from_qr("gc://pair?v=1&host=&user=u&token=t".to_string())
            .expect_err("must fail");
        assert_eq!(payload.kind, "invalid_qr");
        assert_eq!(payload.message, "invalid pairing QR: host must not be empty");
    }

    #[test]
    fn pair_from_qr_maps_unknown_versions_to_an_unsupported_version_payload() {
        let (core, _) = core();
        let payload = core
            .pair_from_qr(format!(
                "gc://pair?v=9&host=h&user=u&token=t&fp={FP_HEX}"
            ))
            .expect_err("must fail");
        assert_eq!(payload.kind, "unsupported_version");
        assert_eq!(
            payload.message,
            "unsupported pairing QR major version 9 (this build speaks v1)"
        );
    }

    #[tokio::test]
    async fn ssh_connect_registers_sessions_under_increasing_ids() {
        let (core, transport) = core();
        let first = core
            .ssh_connect(
                "10.0.0.5".to_string(),
                2222,
                "reaan".to_string(),
                SshCredential::Password("pw".to_string()),
            )
            .await
            .expect("session");
        let second = core
            .ssh_connect(
                "10.0.0.5".to_string(),
                2222,
                "reaan".to_string(),
                SshCredential::Password("pw".to_string()),
            )
            .await
            .expect("session");
        assert_eq!((first, second), (1, 2));
        assert_eq!(
            transport.last_request().map(|request| request.host),
            Some("10.0.0.5".to_string())
        );
        assert_eq!(core.session_fingerprint_compact(first).expect("known"), FP);
        assert!(core
            .session_fingerprint(first)
            .expect("known")
            .contains(':'));
    }

    #[tokio::test]
    async fn ssh_connect_maps_authentication_failures_to_ssh_payloads() {
        let (core, _) = core();
        let payload = core
            .ssh_connect(
                "h".to_string(),
                22,
                "denied".to_string(),
                SshCredential::Password("x".to_string()),
            )
            .await
            .expect_err("must fail");
        assert_eq!(payload.kind, "ssh");
        assert!(payload.message.contains("authentication rejected"), "{payload}");
    }

    #[tokio::test]
    async fn direct_tcp_channels_are_registered_and_stream_bytes() {
        let (core, _) = core();
        let session = core
            .ssh_connect(
                "h".to_string(),
                22,
                "u".to_string(),
                SshCredential::Password("p".to_string()),
            )
            .await
            .expect("session");
        let channel = core
            .ssh_direct_tcp(session, "127.0.0.1".to_string(), crate::ssh::DAEMON_PORT)
            .await
            .expect("channel");
        assert_eq!(channel, 1);
        // The mock has nothing queued, so the first read is EOF => empty Vec.
        assert_eq!(core.channel_read(channel).await.expect("read"), Vec::<u8>::new());
        core.channel_write(channel, b"GET /device/ws".to_vec())
            .await
            .expect("write");
        assert_eq!(core.channel_read(channel).await.expect("read"), Vec::<u8>::new());
    }

    #[tokio::test]
    async fn exec_once_reaches_the_session() {
        let (core, _) = core();
        let session = core
            .ssh_connect(
                "h".to_string(),
                22,
                "u".to_string(),
                SshCredential::Password("p".to_string()),
            )
            .await
            .expect("session");
        let output = core
            .exec_once(session, "uname -m".to_string())
            .await
            .expect("exec");
        assert_eq!(output.exit_code, 0);
        assert_eq!(output.stdout, b"ran uname -m".to_vec());
    }

    #[tokio::test]
    async fn unknown_handles_are_reported_as_ssh_payloads() {
        let (core, _) = core();
        let session = core.session_fingerprint(42).expect_err("unknown session");
        assert_eq!(session.kind, "ssh");
        assert_eq!(session.message, "ssh: unknown session id 42");

        let channel = core
            .channel_read(7)
            .await
            .expect_err("unknown channel");
        assert_eq!(channel.kind, "ssh");
        assert_eq!(channel.message, "ssh: unknown channel id 7");
    }

    #[test]
    fn device_key_generate_produces_a_public_key_that_matches_its_secret() {
        let (core, _) = core();
        let pair = core.device_key_generate();
        assert_eq!(pair.public_hex.len(), 64);
        assert_eq!(
            core.device_key_public(pair.secret.clone()).expect("derivable"),
            pair.public_hex
        );
        assert_eq!(
            core.device_key_public(StoredKey {
                secret_seed: vec![0, 1]
            })
            .expect_err("bad seed")
            .kind,
            "crypto"
        );
    }

    #[test]
    fn crypto_verify_checks_release_signatures() {
        let (core, _) = core();
        let pair = core.device_key_generate();
        let payload = b"signed daemon descriptor";
        let signature = device_key::sign(&pair.secret, payload).expect("signable");
        assert!(core.crypto_verify(pair.public_hex.clone(), payload.to_vec(), signature.clone()));
        assert!(!core.crypto_verify(pair.public_hex, b"other".to_vec(), signature));
    }

    #[test]
    fn core_error_payloads_serialize_for_the_ts_layer() {
        let payload = CoreErrorPayload::from(CoreError::ssh("boom"));
        assert_eq!(
            serde_json::to_string(&payload).expect("serializes"),
            r#"{"kind":"ssh","message":"ssh: boom"}"#
        );
        assert_eq!(payload.to_string(), "ssh: ssh: boom");
    }

    #[test]
    fn debug_reports_the_registry_sizes_without_leaking_state() {
        let (core, _) = core();
        let rendered = format!("{core:?}");
        assert!(rendered.contains("sessions: 0"), "{rendered}");
        assert!(rendered.contains("channels: 0"), "{rendered}");
    }

    #[tokio::test]
    async fn extended_data_on_a_tunnel_channel_is_reported() {
        // A channel that yields stderr must not be mistaken for payload bytes.
        struct StderrChannel;

        impl crate::ssh::TransportChannel for StderrChannel {
            fn read<'a>(
                &'a self,
            ) -> crate::ssh::BoxFuture<'a, Result<ChannelEvent, CoreError>> {
                Box::pin(async {
                    Ok(ChannelEvent::ExtendedData {
                        ext: 1,
                        bytes: b"warn".to_vec(),
                    })
                })
            }

            fn write<'a>(
                &'a self,
                _bytes: &'a [u8],
            ) -> crate::ssh::BoxFuture<'a, Result<(), CoreError>> {
                Box::pin(async { Ok(()) })
            }

            fn close(&self) -> crate::ssh::BoxFuture<'_, Result<(), CoreError>> {
                Box::pin(async { Ok(()) })
            }
        }

        struct StderrSession;

        impl crate::ssh::TransportSession for StderrSession {
            fn host_key_fingerprint(&self) -> String {
                FP.to_string()
            }

            fn exec_once<'a>(
                &'a self,
                _command: &'a str,
            ) -> crate::ssh::BoxFuture<'a, Result<ExecOutput, CoreError>> {
                Box::pin(async {
                    Ok(ExecOutput {
                        exit_code: 0,
                        stdout: Vec::new(),
                        stderr: Vec::new(),
                    })
                })
            }

            fn direct_tcpip<'a>(
                &'a self,
                _target_host: &'a str,
                _target_port: u16,
            ) -> crate::ssh::BoxFuture<'a, Result<Box<dyn crate::ssh::TransportChannel>, CoreError>>
            {
                Box::pin(async { Ok(Box::new(StderrChannel) as Box<dyn crate::ssh::TransportChannel>) })
            }
        }

        struct StderrTransport;

        impl Transport for StderrTransport {
            fn connect<'a>(
                &'a self,
                _request: &'a ConnectRequest,
            ) -> crate::ssh::BoxFuture<'a, Result<Box<dyn crate::ssh::TransportSession>, CoreError>>
            {
                Box::pin(async { Ok(Box::new(StderrSession) as Box<dyn crate::ssh::TransportSession>) })
            }
        }

        let core = MobileCore::with_transport(Arc::new(StderrTransport));
        let session = core
            .ssh_connect(
                "h".to_string(),
                22,
                "u".to_string(),
                SshCredential::Password("p".to_string()),
            )
            .await
            .expect("session");
        let channel = core
            .ssh_direct_tcp(session, "127.0.0.1".to_string(), 43722)
            .await
            .expect("channel");
        let payload = core.channel_read(channel).await.expect_err("must fail");
        assert_eq!(payload.kind, "ssh");
        assert!(payload.message.contains("extended data"), "{payload}");
    }
}
