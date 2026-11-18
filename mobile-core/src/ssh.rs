//! SSH transport: session, host key fingerprint, direct-tcpip tunnel, one-shot exec.
//!
//! ## Layering
//!
//! Everything russh-specific lives behind three small traits — [`Transport`],
//! [`TransportSession`] and [`TransportChannel`]. [`SshSession`] and [`Channel`] are thin
//! owners of those trait objects, so the whole upper layer (session bookkeeping, error
//! mapping, fingerprint presentation, credential encoding) is exercised in unit tests by
//! an in-memory mock, with no SSH server and no network. [`RusshTransport`] is the only
//! implementation that talks to a real host.
//!
//! ## Host key / TOFU (`docs/mobile-protocol-spec.md` §1, §8)
//!
//! The pairing QR carries `fp=<hex>`, and the first connection shows the *observed* host
//! key fingerprint to the user, who confirms it against the host's own output. Therefore
//! the default policy is [`HostKeyPolicy::TrustOnFirstUse`]: the transport records the
//! fingerprint (exposed by [`SshSession::fingerprint_of_host_key`]) and accepts the key so
//! the app can compare and warn. [`HostKeyPolicy::Pinned`] makes the transport itself
//! reject any other key, which is what later, already-paired connections use.
//!
//! ## Tunnel (`§4`)
//!
//! The app never exposes a local port: [`SshSession::direct_tcp`] opens an SSH
//! direct-tcpip channel to the daemon listener ([`DAEMON_PORT`]) and the bytes of that
//! channel are what the TS layer reads and writes.

use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use russh::client::Msg;
use russh::ChannelMsg;
use serde::{Deserialize, Serialize};

use crate::error::CoreError;
use crate::fingerprint;

/// A `Send` boxed future, so the transport traits stay object-safe without `async fn` in
/// traits (which is not dyn-compatible).
pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Daemon listener reached through the direct-tcpip tunnel (`docs/mobile-protocol-spec.md` §4).
pub const DAEMON_PORT: u16 = 43722;

/// Originator address reported for direct-tcpip channels: the tunnel is initiated by the
/// phone itself, so the daemon only needs a truthful loopback origin.
pub const ORIGINATOR_ADDRESS: &str = "127.0.0.1";

/// Originator port reported for direct-tcpip channels (the OS picks no port on the phone
/// side, so the conventional `0` is announced).
pub const ORIGINATOR_PORT: u16 = 0;

/// How the app authenticates the SSH user.
///
/// Serialized with an adjacent tag so the TS layer can carry it as plain JSON:
/// `{"kind":"password","value":"…"}` or
/// `{"kind":"key","value":{"private":[…],"passphrase":"…"}}`.
/// The `private` bytes are an OpenSSH/PEM key blob as read from disk or from the
/// platform keystore; `passphrase` is `None` for an unencrypted key.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum SshCredential {
    /// Password authentication for the initial pairing connection.
    Password(String),
    /// Public-key authentication (a key already authorized on the host, or later a
    /// device key registered by `REGISTER_DEVICE`).
    Key {
        /// OpenSSH/PEM encoded private key.
        private: Vec<u8>,
        /// Passphrase for an encrypted private key.
        #[serde(default)]
        passphrase: Option<String>,
    },
}

/// Everything needed to open an authenticated SSH session.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConnectRequest {
    /// Host IP address or hostname.
    pub host: String,
    /// SSH port.
    pub port: u16,
    /// SSH user.
    pub user: String,
    /// Credential to authenticate with.
    pub credential: SshCredential,
}

impl ConnectRequest {
    /// Build a request from the pieces a QR or the manual form provides.
    pub fn new(host: &str, port: u16, user: &str, credential: SshCredential) -> Self {
        Self {
            host: host.to_string(),
            port,
            user: user.to_string(),
            credential,
        }
    }
}

/// Result of [`SshSession::exec_once`] / `execOnce` in the FFI surface.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExecOutput {
    /// Remote process exit code.
    pub exit_code: u32,
    /// Standard output bytes.
    pub stdout: Vec<u8>,
    /// Standard error bytes.
    pub stderr: Vec<u8>,
}

/// One frame read from a channel.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChannelEvent {
    /// Standard data.
    Data(Vec<u8>),
    /// Extended data (`ext == 1` is stderr on a session channel).
    ExtendedData {
        /// Extended data type.
        ext: u32,
        /// Payload bytes.
        bytes: Vec<u8>,
    },
    /// End of stream: the peer sent EOF or closed the channel.
    Eof,
}

/// Policy applied to the server host key during the handshake.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostKeyPolicy {
    /// Record the observed fingerprint and accept the key; the app compares it with the
    /// QR `fp` / the host's output and warns on change.
    TrustOnFirstUse,
    /// Accept only the given compact (or grouped) hex fingerprint.
    Pinned(String),
}

impl HostKeyPolicy {
    /// Whether a key with these observed fingerprint bytes should be accepted.
    pub fn accepts(&self, observed_hex: &str) -> bool {
        match self {
            Self::TrustOnFirstUse => true,
            Self::Pinned(expected) => match (
                fingerprint::normalize(expected),
                fingerprint::normalize(observed_hex),
            ) {
                (Some(expected), Some(observed)) => expected == observed,
                // An unusable pin must never silently accept a key.
                _ => false,
            },
        }
    }
}

/// Boundary that opens authenticated sessions.
///
/// Implemented by [`RusshTransport`] in production and by an in-memory mock in tests.
pub trait Transport: Send + Sync {
    /// Connect, verify the host key against the configured policy and authenticate.
    fn connect<'a>(
        &'a self,
        request: &'a ConnectRequest,
    ) -> BoxFuture<'a, Result<Box<dyn TransportSession>, CoreError>>;
}

/// Boundary over one authenticated session.
pub trait TransportSession: Send + Sync {
    /// Compact (64 hex chars, no separators) fingerprint of the host key observed during
    /// the handshake.
    fn host_key_fingerprint(&self) -> String;

    /// Run `command` once, collect stdout/stderr and the exit code.
    fn exec_once<'a>(&'a self, command: &'a str) -> BoxFuture<'a, Result<ExecOutput, CoreError>>;

    /// Open a direct-tcpip channel to `target_host:target_port`.
    fn direct_tcpip<'a>(
        &'a self,
        target_host: &'a str,
        target_port: u16,
    ) -> BoxFuture<'a, Result<Box<dyn TransportChannel>, CoreError>>;
}

/// Boundary over one channel: the byte stream the TS layer tunnels its protocol through.
pub trait TransportChannel: Send + Sync {
    /// Read the next frame.
    fn read<'a>(&'a self) -> BoxFuture<'a, Result<ChannelEvent, CoreError>>;

    /// Write bytes to the peer.
    fn write<'a>(&'a self, bytes: &'a [u8]) -> BoxFuture<'a, Result<(), CoreError>>;

    /// Send EOF and close the channel.
    fn close(&self) -> BoxFuture<'_, Result<(), CoreError>>;
}

/// An authenticated SSH session.
pub struct SshSession {
    inner: Arc<dyn TransportSession>,
}

impl std::fmt::Debug for SshSession {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SshSession")
            .field("host_key_fingerprint", &self.inner.host_key_fingerprint())
            .finish_non_exhaustive()
    }
}

impl SshSession {
    /// Connect to `host:port` as `user` with `credential`, using the real russh
    /// transport and the trust-on-first-use host key policy.
    pub async fn connect(
        host: &str,
        port: u16,
        user: &str,
        credential: SshCredential,
    ) -> Result<Self, CoreError> {
        let transport = RusshTransport::new();
        Self::connect_with(&transport, ConnectRequest::new(host, port, user, credential)).await
    }

    /// Connect through a caller-provided [`Transport`].
    ///
    /// This is the seam the FFI facade and the tests use: no russh, no network.
    pub async fn connect_with(
        transport: &dyn Transport,
        request: ConnectRequest,
    ) -> Result<Self, CoreError> {
        let inner = transport.connect(&request).await?;
        Ok(Self {
            inner: Arc::from(inner),
        })
    }

    /// Host key fingerprint in display form (`aa:bb:…`), for the visible first-use
    /// confirmation (`docs/mobile-protocol-spec.md` §1, §8).
    pub fn fingerprint_of_host_key(&self) -> String {
        fingerprint::with_colons(&self.inner.host_key_fingerprint())
    }

    /// Host key fingerprint in compact form (64 hex chars), comparable with the QR `fp`.
    pub fn fingerprint_compact(&self) -> String {
        self.inner.host_key_fingerprint()
    }

    /// Run a command once over a new session channel (`execOnce`).
    pub async fn exec_once(&self, command: &str) -> Result<ExecOutput, CoreError> {
        self.inner.exec_once(command).await
    }

    /// Open a direct-tcpip channel, used for the daemon tunnel (`§4`).
    pub async fn direct_tcp(
        &self,
        target_host: &str,
        target_port: u16,
    ) -> Result<Channel, CoreError> {
        let inner = self.inner.direct_tcpip(target_host, target_port).await?;
        Ok(Channel {
            inner: Arc::from(inner),
        })
    }
}

/// A channel of a [`SshSession`], read and written from the TS layer.
pub struct Channel {
    inner: Arc<dyn TransportChannel>,
}

impl std::fmt::Debug for Channel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Channel").finish_non_exhaustive()
    }
}

impl Channel {
    /// Read the next frame of the channel.
    pub async fn read(&self) -> Result<ChannelEvent, CoreError> {
        self.inner.read().await
    }

    /// Write bytes to the channel.
    pub async fn write(&self, bytes: &[u8]) -> Result<(), CoreError> {
        self.inner.write(bytes).await
    }

    /// Close the channel.
    pub async fn close(&self) -> Result<(), CoreError> {
        self.inner.close().await
    }
}

/// Production [`Transport`] backed by russh.
pub struct RusshTransport {
    config: Arc<russh::client::Config>,
    policy: HostKeyPolicy,
}

impl RusshTransport {
    /// Transport with the default client configuration and trust-on-first-use host keys.
    pub fn new() -> Self {
        let config = russh::client::Config {
            // The phone keeps the tunnel open across app switches; a keepalive keeps
            // mobile NAT entries from silently expiring.
            keepalive_interval: Some(Duration::from_secs(30)),
            keepalive_max: 3,
            nodelay: true,
            ..Default::default()
        };
        Self {
            config: Arc::new(config),
            policy: HostKeyPolicy::TrustOnFirstUse,
        }
    }

    /// Transport that only accepts `fingerprint_hex` as the host key.
    pub fn pinned(fingerprint_hex: &str) -> Self {
        let mut transport = Self::new();
        transport.policy = HostKeyPolicy::Pinned(fingerprint_hex.to_string());
        transport
    }
}

impl Default for RusshTransport {
    fn default() -> Self {
        Self::new()
    }
}

impl Transport for RusshTransport {
    fn connect<'a>(
        &'a self,
        request: &'a ConnectRequest,
    ) -> BoxFuture<'a, Result<Box<dyn TransportSession>, CoreError>> {
        Box::pin(async move {
            let seen = Arc::new(Mutex::new(None));
            let handler = HostKeyCollector {
                policy: self.policy.clone(),
                seen: Arc::clone(&seen),
            };

            let mut handle = russh::client::connect(
                Arc::clone(&self.config),
                (request.host.as_str(), request.port),
                handler,
            )
            .await
            .map_err(map_russh_error)?;

            let auth_result = match &request.credential {
                SshCredential::Password(password) => handle
                    .authenticate_password(request.user.clone(), password.clone())
                    .await
                    .map_err(map_russh_error)?,
                SshCredential::Key {
                    private,
                    passphrase,
                } => {
                    let pem = std::str::from_utf8(private).map_err(|_| {
                        CoreError::ssh("private key is not UTF-8 OpenSSH/PEM text")
                    })?;
                    let key = russh::keys::decode_secret_key(pem, passphrase.as_deref())
                        .map_err(|_| {
                            CoreError::ssh(
                                "could not decode the private key (wrong passphrase or unsupported format)",
                            )
                        })?;
                    let key = Arc::new(key);
                    let hash_alg = if key.algorithm().is_rsa() {
                        handle
                            .best_supported_rsa_hash()
                            .await
                            .map_err(map_russh_error)?
                            .flatten()
                    } else {
                        None
                    };
                    handle
                        .authenticate_publickey(
                            request.user.clone(),
                            russh::keys::PrivateKeyWithHashAlg::new(key, hash_alg),
                        )
                        .await
                        .map_err(map_russh_error)?
                }
            };

            map_auth_result(&request.host, request.port, &request.user, auth_result)?;

            let fingerprint_hex = seen_fingerprint(&seen).ok_or_else(|| {
                CoreError::ssh("server did not present a host key during the handshake")
            })?;

            Ok(Box::new(RusshSession {
                handle,
                fingerprint_hex,
            }) as Box<dyn TransportSession>)
        })
    }
}

/// Reads the host key and applies the configured [`HostKeyPolicy`].
struct HostKeyCollector {
    policy: HostKeyPolicy,
    seen: Arc<Mutex<Option<String>>>,
}

impl russh::client::Handler for HostKeyCollector {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &russh::keys::PublicKey,
    ) -> Result<bool, russh::Error> {
        let observed = fingerprint::of_public_key(server_public_key);
        let accepted = self.policy.accepts(&observed);
        store_fingerprint(&self.seen, observed);
        Ok(accepted)
    }
}

/// Read the recorded fingerprint without panicking on a poisoned lock.
fn seen_fingerprint(seen: &Mutex<Option<String>>) -> Option<String> {
    match seen.lock() {
        Ok(guard) => guard.clone(),
        Err(poisoned) => poisoned.into_inner().clone(),
    }
}

/// Store the recorded fingerprint without panicking on a poisoned lock.
fn store_fingerprint(seen: &Mutex<Option<String>>, value: String) {
    match seen.lock() {
        Ok(mut guard) => *guard = Some(value),
        Err(poisoned) => *poisoned.into_inner() = Some(value),
    }
}

/// Live russh session.
struct RusshSession {
    handle: russh::client::Handle<HostKeyCollector>,
    fingerprint_hex: String,
}

impl TransportSession for RusshSession {
    fn host_key_fingerprint(&self) -> String {
        self.fingerprint_hex.clone()
    }

    fn exec_once<'a>(&'a self, command: &'a str) -> BoxFuture<'a, Result<ExecOutput, CoreError>> {
        Box::pin(async move {
            let mut channel = self
                .handle
                .channel_open_session()
                .await
                .map_err(map_russh_error)?;
            channel
                .exec(true, command.as_bytes().to_vec())
                .await
                .map_err(map_russh_error)?;

            let mut stdout = Vec::new();
            let mut stderr = Vec::new();
            let mut exit_code = None;
            while let Some(message) = channel.wait().await {
                match message {
                    ChannelMsg::Data { data } => stdout.extend_from_slice(&data),
                    ChannelMsg::ExtendedData { data, ext } => {
                        if ext == 1 {
                            stderr.extend_from_slice(&data);
                        }
                    }
                    ChannelMsg::ExitStatus { exit_status } => exit_code = Some(exit_status),
                    ChannelMsg::Eof | ChannelMsg::Close => break,
                    _ => {}
                }
            }

            let exit_code = exit_code.ok_or_else(|| {
                CoreError::ssh("exec channel closed without reporting an exit status")
            })?;
            Ok(ExecOutput {
                exit_code,
                stdout,
                stderr,
            })
        })
    }

    fn direct_tcpip<'a>(
        &'a self,
        target_host: &'a str,
        target_port: u16,
    ) -> BoxFuture<'a, Result<Box<dyn TransportChannel>, CoreError>> {
        Box::pin(async move {
            let channel = self
                .handle
                .channel_open_direct_tcpip(
                    target_host.to_string(),
                    u32::from(target_port),
                    ORIGINATOR_ADDRESS.to_string(),
                    u32::from(ORIGINATOR_PORT),
                )
                .await
                .map_err(map_russh_error)?;
            Ok(Box::new(RusshChannel {
                channel: tokio::sync::Mutex::new(channel),
            }) as Box<dyn TransportChannel>)
        })
    }
}

/// Live russh channel.
struct RusshChannel {
    // `Channel::wait` needs `&mut self` while `data`/`close` need `&self`; the async mutex
    // is held only for the duration of a single frame operation.
    channel: tokio::sync::Mutex<russh::Channel<Msg>>,
}

impl TransportChannel for RusshChannel {
    fn read<'a>(&'a self) -> BoxFuture<'a, Result<ChannelEvent, CoreError>> {
        Box::pin(async move {
            let mut channel = self.channel.lock().await;
            loop {
                match channel.wait().await {
                    Some(ChannelMsg::Data { data }) => return Ok(ChannelEvent::Data(data.to_vec())),
                    Some(ChannelMsg::ExtendedData { data, ext }) => {
                        return Ok(ChannelEvent::ExtendedData {
                            ext,
                            bytes: data.to_vec(),
                        })
                    }
                    Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => {
                        return Ok(ChannelEvent::Eof)
                    }
                    Some(_) => continue,
                }
            }
        })
    }

    fn write<'a>(&'a self, bytes: &'a [u8]) -> BoxFuture<'a, Result<(), CoreError>> {
        Box::pin(async move {
            let channel = self.channel.lock().await;
            channel.data(bytes).await.map_err(map_russh_error)
        })
    }

    fn close(&self) -> BoxFuture<'_, Result<(), CoreError>> {
        Box::pin(async move {
            let channel = self.channel.lock().await;
            channel.eof().await.map_err(map_russh_error)?;
            channel.close().await.map_err(map_russh_error)
        })
    }
}

/// Turn an authentication result into a [`CoreError`].
fn map_auth_result(
    host: &str,
    port: u16,
    user: &str,
    result: russh::client::AuthResult,
) -> Result<(), CoreError> {
    if result.success() {
        Ok(())
    } else {
        Err(CoreError::ssh(format!(
            "authentication rejected for user {user:?} on {host}:{port}"
        )))
    }
}

/// Turn a russh error into a [`CoreError`], keeping local I/O failures distinct.
fn map_russh_error(error: russh::Error) -> CoreError {
    match error {
        russh::Error::IO(io) => CoreError::Io(io),
        russh::Error::UnknownKey => CoreError::ssh(
            "server host key does not match the pinned fingerprint (possible man-in-the-middle)",
        ),
        russh::Error::NoAuthMethod => {
            CoreError::ssh("server offered no authentication method the app can satisfy")
        }
        other => CoreError::ssh(other.to_string()),
    }
}

/// In-memory [`Transport`] shared by the unit tests of this module and the FFI facade
/// tests: deterministic, socket-free, so the whole upper layer is exercised offline.
#[cfg(test)]
pub(crate) mod mock {
    use std::collections::VecDeque;

    use super::*;
    use tokio::sync::Mutex as AsyncMutex;

    /// Fingerprint the mock host presents.
    pub(crate) const FP: &str =
        "aa11bb22cc33dd44ee55ff6600778899aa11bb22cc33dd44ee55ff6600778899";

    /// Mock transport: no sockets, deterministic answers.
    #[derive(Default)]
    pub(crate) struct MockTransport {
        last_request: Mutex<Option<ConnectRequest>>,
    }

    impl MockTransport {
        /// Recorded request of the last `connect` call.
        pub(crate) fn last_request(&self) -> Option<ConnectRequest> {
            match self.last_request.lock() {
                Ok(guard) => guard.clone(),
                Err(poisoned) => poisoned.into_inner().clone(),
            }
        }
    }

    impl Transport for MockTransport {
        fn connect<'a>(
            &'a self,
            request: &'a ConnectRequest,
        ) -> BoxFuture<'a, Result<Box<dyn TransportSession>, CoreError>> {
            Box::pin(async move {
                if let Ok(mut slot) = self.last_request.lock() {
                    *slot = Some(request.clone());
                }
                if request.user == "denied" {
                    return Err(CoreError::ssh("authentication rejected by mock"));
                }
                Ok(Box::new(MockSession {
                    fingerprint_hex: FP.to_string(),
                    channel: Arc::new(MockChannel::default()),
                }) as Box<dyn TransportSession>)
            })
        }
    }

    struct MockSession {
        fingerprint_hex: String,
        channel: Arc<MockChannel>,
    }

    impl TransportSession for MockSession {
        fn host_key_fingerprint(&self) -> String {
            self.fingerprint_hex.clone()
        }

        fn exec_once<'a>(
            &'a self,
            command: &'a str,
        ) -> BoxFuture<'a, Result<ExecOutput, CoreError>> {
            Box::pin(async move {
                if command == "fail" {
                    return Ok(ExecOutput {
                        exit_code: 2,
                        stdout: Vec::new(),
                        stderr: b"boom\n".to_vec(),
                    });
                }
                Ok(ExecOutput {
                    exit_code: 0,
                    stdout: format!("ran {command}").into_bytes(),
                    stderr: Vec::new(),
                })
            })
        }

        fn direct_tcpip<'a>(
            &'a self,
            _target_host: &'a str,
            _target_port: u16,
        ) -> BoxFuture<'a, Result<Box<dyn TransportChannel>, CoreError>> {
            let shared = SharedChannel(Arc::clone(&self.channel));
            Box::pin(async move { Ok(Box::new(shared) as Box<dyn TransportChannel>) })
        }
    }

    /// Lets a mock channel be handed out by value while the test keeps a handle to it.
    pub(crate) struct SharedChannel(pub(crate) Arc<MockChannel>);

    impl TransportChannel for SharedChannel {
        fn read<'a>(&'a self) -> BoxFuture<'a, Result<ChannelEvent, CoreError>> {
            self.0.read()
        }

        fn write<'a>(&'a self, bytes: &'a [u8]) -> BoxFuture<'a, Result<(), CoreError>> {
            self.0.write(bytes)
        }

        fn close(&self) -> BoxFuture<'_, Result<(), CoreError>> {
            self.0.close()
        }
    }

    #[derive(Default)]
    struct MockChannelState {
        pending: VecDeque<ChannelEvent>,
        written: Vec<Vec<u8>>,
        closed: bool,
    }

    #[derive(Default)]
    pub(crate) struct MockChannel {
        state: AsyncMutex<MockChannelState>,
    }

    impl MockChannel {
        pub(crate) fn with_events(events: Vec<ChannelEvent>) -> Self {
            Self {
                state: AsyncMutex::new(MockChannelState {
                    pending: events.into(),
                    written: Vec::new(),
                    closed: false,
                }),
            }
        }

        pub(crate) async fn written(&self) -> Vec<Vec<u8>> {
            self.state.lock().await.written.clone()
        }

        pub(crate) async fn is_closed(&self) -> bool {
            self.state.lock().await.closed
        }
    }

    impl TransportChannel for MockChannel {
        fn read<'a>(&'a self) -> BoxFuture<'a, Result<ChannelEvent, CoreError>> {
            Box::pin(async move {
                let mut state = self.state.lock().await;
                Ok(state.pending.pop_front().unwrap_or(ChannelEvent::Eof))
            })
        }

        fn write<'a>(&'a self, bytes: &'a [u8]) -> BoxFuture<'a, Result<(), CoreError>> {
            Box::pin(async move {
                self.state.lock().await.written.push(bytes.to_vec());
                Ok(())
            })
        }

        fn close(&self) -> BoxFuture<'_, Result<(), CoreError>> {
            Box::pin(async move {
                self.state.lock().await.closed = true;
                Ok(())
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::mock::{MockChannel, MockTransport, SharedChannel, FP};
    use super::*;

    #[tokio::test]
    async fn connect_with_forwards_the_request_and_authenticates() {
        let transport = MockTransport::default();
        let request = ConnectRequest::new("10.0.0.5", 2222, "reaan", SshCredential::Password("pw".into()));
        let session = SshSession::connect_with(&transport, request.clone())
            .await
            .expect("mock session");
        assert_eq!(session.fingerprint_compact(), FP);
        assert_eq!(
            session.fingerprint_of_host_key(),
            "aa:11:bb:22:cc:33:dd:44:ee:55:ff:66:00:77:88:99:aa:11:bb:22:cc:33:dd:44:ee:55:ff:66:00:77:88:99"
        );
        let seen = transport.last_request();
        assert_eq!(seen, Some(request));
    }

    #[tokio::test]
    async fn connect_with_propagates_transport_errors() {
        let transport = MockTransport::default();
        let request = ConnectRequest::new("h", 22, "denied", SshCredential::Password("x".into()));
        let err = SshSession::connect_with(&transport, request)
            .await
            .expect_err("must fail");
        assert_eq!(err.kind(), "ssh");
        assert!(err.to_string().contains("authentication rejected"), "{err}");
    }

    #[tokio::test]
    async fn exec_once_round_trips_through_the_session() {
        let transport = MockTransport::default();
        let session = SshSession::connect_with(
            &transport,
            ConnectRequest::new("h", 22, "u", SshCredential::Password("x".into())),
        )
        .await
        .expect("mock session");

        let ok = session.exec_once("uname -m").await.expect("ok");
        assert_eq!(ok.exit_code, 0);
        assert_eq!(ok.stdout, b"ran uname -m".to_vec());
        assert!(ok.stderr.is_empty());

        let failed = session.exec_once("fail").await.expect("reported failure");
        assert_eq!(failed.exit_code, 2);
        assert_eq!(failed.stderr, b"boom\n".to_vec());
    }

    #[tokio::test]
    async fn direct_tcp_channel_reads_writes_and_closes() {
        let transport = MockTransport::default();
        let session = SshSession::connect_with(
            &transport,
            ConnectRequest::new("h", 22, "u", SshCredential::Password("x".into())),
        )
        .await
        .expect("mock session");
        let channel = session.direct_tcp("127.0.0.1", DAEMON_PORT).await.expect("channel");

        assert_eq!(channel.read().await.expect("read"), ChannelEvent::Eof);
        channel.write(b"GET /device/ws").await.expect("write");
        channel.close().await.expect("close");
    }

    #[tokio::test]
    async fn channel_streams_queued_frames_then_eof() {
        let channel = MockChannel::with_events(vec![
            ChannelEvent::Data(b"hello".to_vec()),
            ChannelEvent::ExtendedData {
                ext: 1,
                bytes: b"warn".to_vec(),
            },
        ]);
        let wrapped = Channel {
            inner: Arc::new(channel),
        };
        assert_eq!(
            wrapped.read().await.expect("read"),
            ChannelEvent::Data(b"hello".to_vec())
        );
        assert_eq!(
            wrapped.read().await.expect("read"),
            ChannelEvent::ExtendedData {
                ext: 1,
                bytes: b"warn".to_vec()
            }
        );
        assert_eq!(wrapped.read().await.expect("read"), ChannelEvent::Eof);
        wrapped.write(b"abc").await.expect("write");
        wrapped.close().await.expect("close");
    }

    #[tokio::test]
    async fn mock_channel_records_written_bytes_and_close() {
        let inner = Arc::new(MockChannel::default());
        let channel = Channel {
            inner: Arc::new(SharedChannel(Arc::clone(&inner))),
        };
        channel.write(b"first").await.expect("write");
        channel.write(b"second").await.expect("write");
        assert_eq!(
            inner.written().await,
            vec![b"first".to_vec(), b"second".to_vec()]
        );
        assert!(!inner.is_closed().await);
        channel.close().await.expect("close");
        assert!(inner.is_closed().await);
    }

    #[test]
    fn trust_on_first_use_accepts_any_key() {
        assert!(HostKeyPolicy::TrustOnFirstUse.accepts(FP));
        assert!(HostKeyPolicy::TrustOnFirstUse.accepts(""));
    }

    #[test]
    fn pinned_policy_compares_normalized_fingerprints() {
        let pinned = HostKeyPolicy::Pinned(fingerprint::with_colons(FP));
        assert!(pinned.accepts(FP));
        assert!(pinned.accepts(&FP.to_ascii_uppercase()));
        assert!(pinned.accepts(&fingerprint::with_colons(FP)));
        assert!(!pinned.accepts(&"bb".repeat(32)));
        assert!(!pinned.accepts("short"));
    }

    #[test]
    fn an_unusable_pin_rejects_every_key() {
        let pinned = HostKeyPolicy::Pinned("not-a-fingerprint".to_string());
        assert!(!pinned.accepts(FP));
        assert!(!pinned.accepts("not-a-fingerprint"));
    }

    #[test]
    fn russh_transport_defaults_to_trust_on_first_use_and_pins_on_request() {
        let transport = RusshTransport::default();
        assert_eq!(transport.policy, HostKeyPolicy::TrustOnFirstUse);
        let pinned = RusshTransport::pinned(FP);
        assert_eq!(pinned.policy, HostKeyPolicy::Pinned(FP.to_string()));
    }

    #[test]
    fn auth_results_map_to_ok_or_ssh_error() {
        let host = "10.0.0.5";
        let port = 2222;
        let user = "reaan";

        assert!(map_auth_result(host, port, user, russh::client::AuthResult::Success).is_ok());

        let failure = russh::client::AuthResult::Failure {
            remaining_methods: russh::MethodSet::empty(),
            partial_success: false,
        };
        let err = map_auth_result(host, port, user, failure).expect_err("must fail");
        assert_eq!(err.kind(), "ssh");
        assert_eq!(
            err.to_string(),
            "ssh: authentication rejected for user \"reaan\" on 10.0.0.5:2222"
        );
    }

    #[test]
    fn russh_errors_map_to_core_errors() {
        let rejected = map_russh_error(russh::Error::UnknownKey);
        assert_eq!(rejected.kind(), "ssh");
        assert!(rejected.to_string().contains("pinned fingerprint"), "{rejected}");

        let no_auth = map_russh_error(russh::Error::NoAuthMethod);
        assert_eq!(no_auth.kind(), "ssh");
        assert!(no_auth.to_string().contains("no authentication method"), "{no_auth}");

        let io = map_russh_error(russh::Error::IO(std::io::Error::new(
            std::io::ErrorKind::ConnectionRefused,
            "refused",
        )));
        assert_eq!(io.kind(), "io");
        assert!(io.to_string().contains("Connection refused") || io.to_string().contains("refused"));
    }

    #[test]
    fn credential_serializes_with_an_adjacent_tag() {
        let password = SshCredential::Password("hunter2".to_string());
        assert_eq!(
            serde_json::to_string(&password).expect("serializes"),
            r#"{"kind":"password","value":"hunter2"}"#
        );

        let key = SshCredential::Key {
            private: b"PEM".to_vec(),
            passphrase: None,
        };
        assert_eq!(
            serde_json::to_string(&key).expect("serializes"),
            r#"{"kind":"key","value":{"private":[80,69,77],"passphrase":null}}"#
        );

        let round_trip: SshCredential =
            serde_json::from_str(r#"{"kind":"key","value":{"private":[80,69,77]}}"#).expect("deserializes");
        assert_eq!(round_trip, key);
    }

    #[test]
    fn connect_request_round_trips_through_json() {
        let request = ConnectRequest::new(
            "gentle.local",
            22,
            "reaan",
            SshCredential::Password("pw".into()),
        );
        let json = serde_json::to_string(&request).expect("serializes");
        let back: ConnectRequest = serde_json::from_str(&json).expect("deserializes");
        assert_eq!(back, request);
    }

    #[test]
    fn exec_output_serializes_with_frozen_field_names() {
        let output = ExecOutput {
            exit_code: 1,
            stdout: b"out".to_vec(),
            stderr: b"err".to_vec(),
        };
        assert_eq!(
            serde_json::to_string(&output).expect("serializes"),
            r#"{"exit_code":1,"stdout":[111,117,116],"stderr":[101,114,114]}"#
        );
    }
}
