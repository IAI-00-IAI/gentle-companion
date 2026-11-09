//! Companion bridge: lets a paired device use files and local web servers the agent mentions.
//!
//! Two capabilities, both gated by the Settings switch `bridgeEnabled` and by a prompt the
//! person confirms in the UI:
//!
//! - **File fetch.** The agent mentions a path or `file://` link. After confirmation the daemon
//!   copies that file into the session sandbox as an agent upload, so the existing preview and
//!   download endpoints serve it. The reference must appear in the session's agent output, the
//!   file must be a regular file under the upload limit, and its real path (symlinks resolved)
//!   must lie inside the session's working directory or the shared Companion temp directory.
//!   Credential-like locations are refused even there.
//! - **Endpoint proxy.** The agent mentions `http://localhost:PORT`. After confirmation the daemon
//!   mints an unguessable, expiring token and reverse-proxies `/bridge/{token}/...` to that
//!   loopback server. An iframe cannot send the device credential, so the token is the capability.
//!   Proxied responses carry a `sandbox` Content-Security-Policy, so they run in an opaque origin
//!   and cannot read the Companion app's storage, even when opened directly.
//!
//! Targets are limited to loopback hosts. This is not a general-purpose proxy.

use std::{
    collections::HashMap,
    io,
    net::IpAddr,
    path::{Path as FsPath, PathBuf},
    time::Duration,
};

use axum::{
    Json, Router,
    body::Body,
    extract::{Path, Request, State},
    http::{HeaderMap, HeaderName, HeaderValue, Method, StatusCode, Uri, header},
    response::{IntoResponse, Redirect, Response},
    routing::any,
};
use http_body_util::{BodyExt, Limited};
use hyper_util::{
    client::legacy::{Client, connect::HttpConnector},
    rt::TokioExecutor,
};
use serde::Deserialize;
use serde_json::{Value, json};
use futures_util::StreamExt;
use tokio::{fs, io::AsyncReadExt, sync::{OwnedSemaphorePermit, watch}};
use uuid::Uuid;

use crate::{ApiError, ApiResult, AppState, TempFile, activity::MentionKind};

/// A bridge link is a short lease: it ends this long after its last renewal by its owner (requests
/// through the link do not count). An open preview renews it about once a minute, so a link orphaned by a crash, a dropped connection or a
/// failed revoke stops working within minutes instead of lingering.
pub const ENDPOINT_LEASE_SECS: u64 = 5 * 60;
const MAX_ENDPOINTS_PER_SESSION: usize = 16;
/// HTML, CSS and JavaScript larger than this are refused rather than rewritten.
const MAX_REWRITE_BYTES: usize = 5 * 1024 * 1024;
const MAX_REQUEST_BYTES: usize = 50 * 1024 * 1024;
const UPSTREAM_TIMEOUT: Duration = Duration::from_secs(30);
/// Collecting a page to rewrite: it must arrive within this time, and not stall between chunks.
const REWRITE_TOTAL_TIMEOUT: Duration = Duration::from_secs(30);
const REWRITE_IDLE_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_REFERENCE_CHARS: usize = 1024;
/// Responses being relayed at once, across every token. Each holds a permit until its body ends.
pub const MAX_CONCURRENT_RELAYS: usize = 32;
/// A relayed response may not exceed this many bytes, last longer than this, or stall longer than the idle limit.
const MAX_RELAY_BYTES: usize = 100 * 1024 * 1024;
const MAX_RELAY_DURATION: Duration = Duration::from_secs(5 * 60);
const RELAY_IDLE_TIMEOUT: Duration = Duration::from_secs(60);
/// Sub-folder of the Companion temp root that every session may read bridged files from.
pub const SHARED_FOLDER: &str = ".shared";
/// File copies running at once. Copies are disk-bound, so they get their own small budget.
pub const MAX_CONCURRENT_COPIES: usize = 4;

/// How much disk bridged copies may use. The device can call the file endpoint directly, so the
/// dialog's confirmation is not a limit. Plain uploads are not counted here.
#[derive(Clone, Copy)]
struct CopyQuota {
    session_bytes: u64,
    session_files: usize,
    total_bytes: u64,
}

const COPY_QUOTA: CopyQuota = CopyQuota { session_bytes: 512 * 1024 * 1024, session_files: 64, total_bytes: 2 * 1024 * 1024 * 1024 };

pub type BridgeClient = Client<HttpConnector, Body>;

pub fn new_client() -> BridgeClient {
    let mut connector = HttpConnector::new();
    connector.set_connect_timeout(Some(Duration::from_secs(5)));
    Client::builder(TokioExecutor::new()).build(connector)
}

/// Who may use an endpoint token: the local console, or one specific paired device.
#[derive(Clone, Debug, PartialEq)]
pub enum Caller {
    Admin,
    Device(String),
}

#[derive(Clone)]
struct Endpoint {
    session_id: String,
    caller: Caller,
    /// `http://localhost:3000`, as the agent wrote it. Used to recognise redirects.
    origin: String,
    /// `localhost:3000`, sent as the Host header.
    host_header: String,
    /// Where to connect: `127.0.0.1:3000` when the agent wrote `0.0.0.0:3000`.
    connect_authority: String,
    port: u16,
    expires_at: u64,
    /// Monotonic lease deadline; renewals update it for requests already in flight.
    lease_deadline: watch::Sender<tokio::time::Instant>,
    /// Turns true when the token is revoked or expires, so responses already streaming stop too.
    revoked: watch::Sender<bool>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct RevocationEpoch {
    global: u64,
    session: u64,
    shared_session: u64,
    device: u64,
}

#[derive(Default)]
pub struct Registry {
    endpoints: HashMap<String, Endpoint>,
    global_generation: u64,
    session_generations: HashMap<String, u64>,
    shared_session_generations: HashMap<String, u64>,
    device_generations: HashMap<String, u64>,
}

impl Registry {
    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.endpoints.len()
    }

    fn epoch(&self, session_id: &str, caller: &Caller) -> RevocationEpoch {
        let mut epoch = RevocationEpoch {
            global: self.global_generation,
            session: self.session_generations.get(session_id).copied().unwrap_or_default(),
            ..RevocationEpoch::default()
        };
        if let Caller::Device(device_id) = caller {
            epoch.shared_session = self.shared_session_generations.get(session_id).copied().unwrap_or_default();
            epoch.device = self.device_generations.get(device_id).copied().unwrap_or_default();
        }
        epoch
    }

    fn epoch_is_current(&self, epoch: RevocationEpoch, session_id: &str, caller: &Caller) -> bool {
        self.epoch(session_id, caller) == epoch
    }

    /// Remove every token matching `ended`, telling streams already using it to stop.
    fn end_where(&mut self, ended: impl Fn(&Endpoint) -> bool) {
        let tokens: Vec<String> = self.endpoints.iter().filter(|(_, endpoint)| ended(endpoint)).map(|(token, _)| token.clone()).collect();
        for token in tokens {
            self.end_token(&token);
        }
    }

    fn end_token(&mut self, token: &str) {
        if let Some(endpoint) = self.endpoints.remove(token) {
            // send_replace stores the value even with no receiver yet. A request that cloned the
            // endpoint before this moment subscribes later and must still see the revocation.
            endpoint.revoked.send_replace(true);
        }
    }

    /// Like `open`, but only if a relevant revocation has not happened since checks began.
    fn open_if_current(&mut self, epoch: RevocationEpoch, session_id: &str, caller: &Caller, target: &Target, now: u64) -> Option<String> {
        if !self.epoch_is_current(epoch, session_id, caller) {
            return None;
        }
        Some(self.open(session_id, caller, target, now))
    }

    /// Mint a token for one preview. Every call gets its own token, even for the same server, so
    /// closing one preview (which revokes its token) never breaks another that is still open.
    /// Each caller holds at most `MAX_ENDPOINTS_PER_SESSION` tokens per session; the least recently
    /// used one is dropped to make room.
    fn open(&mut self, session_id: &str, caller: &Caller, target: &Target, now: u64) -> String {
        self.end_where(|endpoint| endpoint.expires_at <= now);
        self.evict_oldest(session_id, caller);
        let token = Uuid::new_v4().simple().to_string() + &Uuid::new_v4().simple().to_string();
        self.endpoints.insert(
            token.clone(),
            Endpoint {
                session_id: session_id.to_string(),
                caller: caller.clone(),
                origin: target.origin.clone(),
                host_header: target.host_header.clone(),
                connect_authority: target.connect_authority.clone(),
                port: target.port,
                expires_at: now + ENDPOINT_LEASE_SECS,
                lease_deadline: watch::channel(tokio::time::Instant::now() + Duration::from_secs(ENDPOINT_LEASE_SECS)).0,
                revoked: watch::channel(false).0,
            },
        );
        token
    }

    fn evict_oldest(&mut self, session_id: &str, caller: &Caller) {
        loop {
            let mut mine: Vec<(&String, u64)> = self
                .endpoints
                .iter()
                .filter(|(_, endpoint)| endpoint.session_id == session_id && &endpoint.caller == caller)
                .map(|(token, endpoint)| (token, endpoint.expires_at))
                .collect();
            if mine.len() < MAX_ENDPOINTS_PER_SESSION {
                return;
            }
            mine.sort_by_key(|(_, expires_at)| *expires_at);
            let oldest = mine[0].0.clone();
            self.end_token(&oldest);
        }
    }

    /// Every token, for when the bridge is switched off.
    pub fn revoke_all(&mut self) {
        self.global_generation += 1;
        self.end_where(|_| true);
    }

    /// Every token for a session (it was archived, removed or its Pi stopped).
    pub fn revoke_session(&mut self, session_id: &str) {
        *self.session_generations.entry(session_id.to_string()).or_default() += 1;
        self.end_where(|endpoint| endpoint.session_id == session_id);
    }

    /// Device tokens for a session, when it stops being shared. Console tokens are unaffected.
    pub fn revoke_session_devices(&mut self, session_id: &str) {
        *self.shared_session_generations.entry(session_id.to_string()).or_default() += 1;
        self.end_where(|endpoint| matches!(endpoint.caller, Caller::Device(_)) && endpoint.session_id == session_id);
    }

    /// Every token a device holds, when it is revoked.
    pub fn revoke_device(&mut self, device_id: &str) {
        *self.device_generations.entry(device_id.to_string()).or_default() += 1;
        let holder = Caller::Device(device_id.to_string());
        self.end_where(|endpoint| endpoint.caller == holder);
    }

    /// End one token on behalf of whoever opened it. Returns whether anything was revoked.
    fn revoke_token(&mut self, token: &str, session_id: &str, caller: &Caller) -> bool {
        let owned = self.owns(token, session_id, caller);
        if owned {
            self.end_token(token);
        }
        owned
    }

    fn owns(&self, token: &str, session_id: &str, caller: &Caller) -> bool {
        self.endpoints
            .get(token)
            .is_some_and(|endpoint| endpoint.session_id == session_id && &endpoint.caller == caller)
    }

    /// Extend a lease on behalf of whoever opened it. False when the link is gone or not theirs.
    fn renew(&mut self, token: &str, session_id: &str, caller: &Caller, now: u64) -> bool {
        let live = self.endpoints.get(token).is_some_and(|endpoint| endpoint.expires_at > now);
        if !live || !self.owns(token, session_id, caller) {
            return false;
        }
        if let Some(endpoint) = self.endpoints.get_mut(token) {
            endpoint.expires_at = now + ENDPOINT_LEASE_SECS;
            endpoint.lease_deadline.send_replace(tokio::time::Instant::now() + Duration::from_secs(ENDPOINT_LEASE_SECS));
        }
        true
    }

    /// Look a live token up. Using a link does NOT extend it: whoever holds the URL (a copy in
    /// another tab, say) cannot keep it alive. Only the owner's authenticated renewal can, so a
    /// link whose close never reached the daemon still ends at its last renewal plus the lease.
    fn lookup(&mut self, token: &str, now: u64) -> Option<Endpoint> {
        let expired = self.endpoints.get(token)?.expires_at <= now;
        if expired {
            self.end_token(token);
            return None;
        }
        self.endpoints.get(token).cloned()
    }
}

// ---------------------------------------------------------------------------------------------
// Target parsing
// ---------------------------------------------------------------------------------------------

#[derive(Debug, PartialEq)]
pub struct Target {
    pub origin: String,
    pub host_header: String,
    pub connect_authority: String,
    pub port: u16,
    pub path_and_query: String,
}

/// Accept only `http://` URLs whose host is this computer.
pub fn parse_loopback_url(url: &str) -> Result<Target, String> {
    let without_fragment = url.trim().split('#').next().unwrap_or_default();
    let uri: Uri = without_fragment.parse().map_err(|_| "That is not a valid URL.".to_string())?;
    if uri.scheme_str() != Some("http") {
        return Err("Only http:// servers on this computer can be bridged.".into());
    }
    let authority = uri.authority().ok_or("That URL has no host.")?;
    if authority.as_str().contains('@') {
        return Err("URLs with credentials cannot be bridged.".into());
    }
    let host = authority.host();
    let bare_host = host.trim_start_matches('[').trim_end_matches(']');
    let address = bare_host.parse::<IpAddr>().ok();
    let is_localhost = bare_host.eq_ignore_ascii_case("localhost");
    let is_loopback = address.is_some_and(|ip| ip.is_loopback() || ip.is_unspecified());
    if !is_localhost && !is_loopback {
        return Err("Only servers on this computer (localhost) can be bridged.".into());
    }
    let connect_host = match address {
        Some(IpAddr::V4(ip)) if ip.is_unspecified() => "127.0.0.1".to_string(),
        Some(IpAddr::V6(ip)) if ip.is_unspecified() => "[::1]".to_string(),
        _ => host.to_string(),
    };
    let port = authority.port_u16().unwrap_or(80);
    let path_and_query = match uri.path_and_query() {
        Some(value) if !value.as_str().is_empty() => value.as_str().to_string(),
        _ => "/".to_string(),
    };
    Ok(Target {
        origin: format!("http://{}", authority.as_str()),
        host_header: authority.as_str().to_string(),
        connect_authority: format!("{connect_host}:{port}"),
        port,
        path_and_query,
    })
}

// ---------------------------------------------------------------------------------------------
// File references
// ---------------------------------------------------------------------------------------------

fn percent_decode(input: &str) -> Option<String> {
    let bytes = input.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = input.get(index + 1..index + 3)?;
            decoded.push(u8::from_str_radix(hex, 16).ok()?);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded).ok()
}

fn file_url_path(reference: &str) -> Option<String> {
    let rest = reference.strip_prefix("file://")?;
    let rest = rest.split(['?', '#']).next().unwrap_or_default();
    let path = if rest.starts_with('/') {
        rest
    } else {
        rest.strip_prefix("localhost/").map(|_| &rest["localhost".len()..])?
    };
    let decoded = percent_decode(path)?;
    // file:///C:/work/report.html names C:\work\report.html on Windows.
    let bytes = decoded.as_bytes();
    let has_drive = bytes.len() > 2 && bytes[0] == b'/' && bytes[1].is_ascii_alphabetic() && bytes[2] == b':';
    if cfg!(windows) && has_drive {
        return Some(decoded[1..].to_string());
    }
    Some(decoded)
}

/// Turn what the agent wrote into an absolute path. Relative paths are relative to the
/// session's working directory.
pub fn resolve_reference(reference: &str, cwd: &FsPath, home: Option<&FsPath>) -> Option<PathBuf> {
    let reference = reference.trim();
    if reference.is_empty() || reference.chars().count() > MAX_REFERENCE_CHARS || reference.chars().any(char::is_control) {
        return None;
    }
    let text = if reference.starts_with("file://") {
        file_url_path(reference)?
    } else if reference.contains("://") {
        return None;
    } else {
        reference.to_string()
    };
    if text == "~" || text.starts_with("~/") {
        return Some(home?.join(text.trim_start_matches('~').trim_start_matches('/')));
    }
    let path = PathBuf::from(text);
    if path.is_absolute() {
        return Some(path);
    }
    Some(cwd.join(path))
}

// Best effort: no filename list can identify every secret, so this narrows accidents, and the
// person's confirmation plus the working-directory scope remain the real controls.
const SENSITIVE_FOLDERS: [&str; 10] = [".ssh", ".gnupg", ".aws", ".kube", ".azure", ".docker", ".git", ".terraform", ".gem", ".m2"];
/// Pairs of folders, such as `.config/gh`, that hold tokens.
const SENSITIVE_FOLDER_PAIRS: [(&str, &str); 4] = [(".config", "gcloud"), (".config", "gh"), (".config", "git"), (".pi", "agent")];
const SENSITIVE_NAME_PREFIXES: [&str; 17] = [
    ".env", ".netrc", ".npmrc", ".pypirc", ".git-credentials", ".pgpass", ".my.cnf", ".boto", ".s3cfg", ".htpasswd",
    ".bash_history", ".zsh_history", ".python_history", "id_rsa", "id_ed25519", "id_ecdsa", "id_dsa",
];
const SENSITIVE_EXTENSIONS: [&str; 9] = [".pem", ".key", ".p12", ".pfx", ".kdbx", ".keystore", ".jks", ".tfstate", ".tfvars"];
/// Names containing any of these are refused (`secrets.json`, `aws-credentials.csv`, `db_password.txt`).
const SENSITIVE_NAME_FRAGMENTS: [&str; 5] = ["secret", "credential", "password", "passwd", "apikey"];

/// The canonical folders one session may bridge files from.
pub struct FileScope {
    pub working_directory: PathBuf,
    pub temp_root: PathBuf,
    pub session_id: String,
}

impl FileScope {
    fn own_temp_folder(&self) -> PathBuf {
        self.temp_root.join(&self.session_id)
    }

    fn shared_temp_folder(&self) -> PathBuf {
        self.temp_root.join(SHARED_FOLDER)
    }

    /// Working directory, this session's temp folder, or the shared temp folder. Other sessions'
    /// temp folders are out of scope even when the working directory happens to contain them.
    pub fn allows(&self, canonical: &FsPath) -> bool {
        let in_temp_scope = canonical.starts_with(self.own_temp_folder()) || canonical.starts_with(self.shared_temp_folder());
        if in_temp_scope {
            return true;
        }
        if canonical.starts_with(&self.temp_root) {
            return false;
        }
        canonical.starts_with(&self.working_directory)
    }
}

/// Credential-like locations are never bridged, even inside an allowed root.
pub fn is_sensitive_path(path: &FsPath, protected_roots: &[PathBuf]) -> bool {
    if protected_roots.iter().any(|root| path.starts_with(root)) {
        return true;
    }
    let parts: Vec<String> = path
        .components()
        .filter_map(|component| component.as_os_str().to_str())
        .map(str::to_ascii_lowercase)
        .collect();
    if parts.iter().any(|part| SENSITIVE_FOLDERS.contains(&part.as_str())) {
        return true;
    }
    let in_sensitive_pair = SENSITIVE_FOLDER_PAIRS
        .iter()
        .any(|(first, second)| parts.windows(2).any(|pair| pair[0] == *first && pair[1] == *second));
    if in_sensitive_pair {
        return true;
    }
    let name = parts.last().map(String::as_str).unwrap_or_default();
    let secret_name = SENSITIVE_NAME_PREFIXES.iter().any(|prefix| name.starts_with(prefix));
    let secret_extension = SENSITIVE_EXTENSIONS.iter().any(|extension| name.ends_with(extension));
    let secret_fragment = SENSITIVE_NAME_FRAGMENTS.iter().any(|fragment| name.contains(fragment));
    secret_name || secret_extension || secret_fragment
}

// ---------------------------------------------------------------------------------------------
// API handlers
// ---------------------------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct FileRequest {
    reference: String,
}

#[derive(Deserialize)]
pub struct EndpointRequest {
    url: String,
}

fn bad_request(message: impl Into<String>) -> ApiError {
    (StatusCode::BAD_REQUEST, message.into())
}

async fn ensure_enabled(state: &AppState) -> ApiResult<()> {
    if state.settings.read().await.bridge_enabled {
        return Ok(());
    }
    Err((StatusCode::FORBIDDEN, "The bridge is turned off in Pi Companion settings.".into()))
}

async fn ensure_bridgeable_session(state: &AppState, session_id: &str) -> ApiResult<()> {
    crate::check_session_id(session_id)?;
    crate::require_interactive_session(state, session_id).await?;
    ensure_enabled(state).await?;
    ensure_pi_connected(state, session_id).await
}

/// A stopped session has no running Pi to ask, and no agent output that can vouch for new
/// requests, so nothing is bridged for it until Pi reconnects.
async fn ensure_pi_connected(state: &AppState, session_id: &str) -> ApiResult<()> {
    let sessions = state.sessions.read().await;
    let session = sessions.get(session_id).ok_or((StatusCode::NOT_FOUND, "Session not found.".to_string()))?;
    let status = session.snapshot.get("status").and_then(Value::as_str);
    if matches!(status, Some("stopped" | "disconnected")) {
        return Err((StatusCode::CONFLICT, "Pi is not connected for this session. Start it again to use the bridge.".into()));
    }
    Ok(())
}

pub async fn fetch_file_local(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    Json(request): Json<FileRequest>,
) -> ApiResult<Json<TempFile>> {
    let caller = Caller::Admin;
    let generation = current_generation(&state, &session_id, &caller).await;
    bridge_file(&state, &session_id, &request.reference, caller, generation).await.map(Json)
}

pub async fn fetch_file_remote(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    headers: HeaderMap,
    Json(request): Json<FileRequest>,
) -> ApiResult<Json<TempFile>> {
    let device_id = crate::authorize_device(&state, crate::bearer_token(&headers)?).await?;
    let caller = Caller::Device(device_id);
    let generation = current_generation(&state, &session_id, &caller).await;
    crate::require_remote_session(&state, &session_id).await?;
    bridge_file(&state, &session_id, &request.reference, caller, generation).await.map(Json)
}

pub async fn open_endpoint_local(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    Json(request): Json<EndpointRequest>,
) -> ApiResult<Json<Value>> {
    let caller = Caller::Admin;
    let generation = current_generation(&state, &session_id, &caller).await;
    open_endpoint(&state, &session_id, &request.url, caller, generation).await.map(Json)
}

pub async fn open_endpoint_remote(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    headers: HeaderMap,
    Json(request): Json<EndpointRequest>,
) -> ApiResult<Json<Value>> {
    let device_id = crate::authorize_device(&state, crate::bearer_token(&headers)?).await?;
    let caller = Caller::Device(device_id);
    // Read before checks: a relevant revocation after this makes the mint fail.
    let generation = current_generation(&state, &session_id, &caller).await;
    crate::require_remote_session(&state, &session_id).await?;
    open_endpoint(&state, &session_id, &request.url, caller, generation).await.map(Json)
}

/// Copy a file the agent mentioned into the session sandbox so it can be previewed/downloaded.
/// The caller's revocation epoch is captured before permission checks and validated at commit.
async fn bridge_file(state: &AppState, session_id: &str, reference: &str, caller: Caller, generation: RevocationEpoch) -> ApiResult<TempFile> {
    ensure_bridgeable_session(state, session_id).await?;
    let working_directory = session_working_directory(state, session_id).await?;
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from);
    let requested = resolve_reference(reference, &working_directory, home.as_deref())
        .ok_or_else(|| bad_request("That is not a file path or file:// link."))?;
    require_file_mention(state, session_id, reference, &requested).await?;

    let not_found = || (StatusCode::NOT_FOUND, "That file was not found on the computer running Pi.".to_string());
    let canonical = fs::canonicalize(&requested).await.map_err(|_| not_found())?;
    let scope = FileScope {
        working_directory,
        temp_root: fs::canonicalize(&state.temp_root).await.unwrap_or_else(|_| state.temp_root.clone()),
        session_id: session_id.to_string(),
    };
    let data_root = fs::canonicalize(&state.data_dir).await.unwrap_or_else(|_| state.data_dir.clone());
    check_file_allowed(&canonical, &scope, &data_root)?;

    let settings = state.settings.read().await.clone();
    let max_bytes = settings.max_upload_mb * 1024 * 1024;
    let name = crate::safe_file_name(&canonical.file_name().map(|name| name.to_string_lossy().to_string()).unwrap_or_default());
    let mime = crate::upload_mime(&settings, &name, None)?;

    let _copy_slot = state.bridge_copy_permits.clone().try_acquire_owned().map_err(|_| {
        (StatusCode::SERVICE_UNAVAILABLE, "Too many files are being copied right now. Try again shortly.".to_string())
    })?;

    // Open once, prove the handle is the file that was just checked, then copy from the handle.
    let source = open_checked_file(&canonical, &scope, &data_root).await?;
    let session_dir = state.temp_root.join(session_id);
    fs::create_dir_all(&session_dir).await.map_err(crate::internal_error)?;
    crate::set_private_dir_permissions(&session_dir).await;
    let id = Uuid::new_v4().to_string();
    let disk_path = session_dir.join(format!("{id}-{name}"));
    let size = match copy_bounded(source, &disk_path, max_bytes).await {
        Ok(size) => size,
        Err(error) => {
            let _ = fs::remove_file(&disk_path).await;
            return Err(error);
        }
    };

    let origin = canonical.to_string_lossy().to_string();
    let file = TempFile {
        source: "agent".into(),
        id,
        name,
        path: disk_path.to_string_lossy().to_string(),
        size,
        mime,
        created_at: crate::now_secs(),
        origin: Some(origin.clone()),
    };
    // Recheck permissions before admission. Then hold the registry lock across the epoch check and
    // the registry update so revocation cannot split validation from commit. Evicted files are not
    // unlinked until the new copy is known to be admissible.
    if let Err(error) = still_permitted(state, session_id, &caller).await {
        let _ = fs::remove_file(&disk_path).await;
        if current_generation(state, session_id, &caller).await != generation {
            return Err((StatusCode::CONFLICT, "Sharing or the bridge changed while this file was being fetched. Try again.".into()));
        }
        return Err(error);
    }
    let mut files = state.files.write().await;
    let registry = state.bridge.lock().await;
    if !registry.epoch_is_current(generation, session_id, &caller) {
        drop(registry);
        drop(files);
        let _ = fs::remove_file(&disk_path).await;
        return Err((StatusCode::CONFLICT, "Sharing or the bridge changed while this file was being fetched. Try again.".into()));
    }
    let admission = admit_copy(&mut *files, session_id, &origin, file.clone(), COPY_QUOTA);
    let removed = match admission.outcome {
        Ok(()) => admission.removed,
        Err(error) => {
            drop(registry);
            drop(files);
            let _ = fs::remove_file(&disk_path).await;
            return Err(error);
        }
    };
    drop(registry);
    drop(files);
    for old_path in removed {
        let _ = fs::remove_file(old_path).await;
    }
    crate::notify_session_files(state, session_id).await;
    Ok(file)
}

/// Recheck the permission state immediately before the epoch-checked commit.
async fn still_permitted(state: &AppState, session_id: &str, caller: &Caller) -> ApiResult<()> {
    ensure_bridgeable_session(state, session_id).await?;
    if let Caller::Device(device_id) = caller {
        if !state.devices.read().await.contains_key(device_id) {
            return Err((StatusCode::UNAUTHORIZED, "This device is no longer paired.".into()));
        }
        crate::require_remote_session(state, session_id).await?;
    }
    Ok(())
}

/// The reference, or the path it resolved to, must appear in what the agent produced. A path
/// written percent-encoded (`My%20Docs`) counts too, since the UI sends the decoded form.
async fn require_file_mention(state: &AppState, session_id: &str, reference: &str, resolved: &FsPath) -> ApiResult<()> {
    let resolved_text = resolved.to_string_lossy().to_string();
    let candidates = [
        reference.trim().to_string(),
        resolved_text.clone(),
        percent_encode_path(reference.trim()),
        percent_encode_path(&resolved_text),
    ];
    let activity = state.activity.read().await;
    let mentioned = candidates.iter().any(|candidate| activity.mentions(session_id, candidate, MentionKind::Path));
    if mentioned {
        return Ok(());
    }
    Err((StatusCode::FORBIDDEN, "Only files the agent mentioned in this session can be fetched.".into()))
}

fn percent_encode_path(path: &str) -> String {
    let mut encoded = String::with_capacity(path.len());
    for byte in path.bytes() {
        let plain = byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'.' | b'-' | b'_' | b'~' | b':');
        if plain {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

/// Scope and credential checks on a canonical path.
fn check_file_allowed(canonical: &FsPath, scope: &FileScope, data_root: &FsPath) -> ApiResult<()> {
    if !scope.allows(canonical) {
        return Err((
            StatusCode::FORBIDDEN,
            "Only files inside the session's working directory, its own temp folder or the shared Companion folder can be fetched.".into(),
        ));
    }
    if is_sensitive_path(canonical, &[data_root.to_path_buf()]) {
        return Err((StatusCode::FORBIDDEN, "That location looks like it may hold credentials, so it is not bridged.".into()));
    }
    Ok(())
}

/// Open without following a final symlink or blocking on a pipe, then confirm the open handle
/// is the regular file at the canonical path that was validated, even if the path changed meanwhile.
async fn open_checked_file(canonical: &FsPath, scope: &FileScope, data_root: &FsPath) -> ApiResult<fs::File> {
    let canonical = canonical.to_path_buf();
    let scope_copy = FileScope {
        working_directory: scope.working_directory.clone(),
        temp_root: scope.temp_root.clone(),
        session_id: scope.session_id.clone(),
    };
    let data_root = data_root.to_path_buf();
    let opened = tokio::task::spawn_blocking(move || open_checked_file_blocking(&canonical, &scope_copy, &data_root))
        .await
        .map_err(crate::internal_error)??;
    Ok(fs::File::from_std(opened))
}

fn open_checked_file_blocking(canonical: &FsPath, scope: &FileScope, data_root: &FsPath) -> ApiResult<std::fs::File> {
    let changed = || (StatusCode::CONFLICT, "That file changed while it was being fetched. Try again.".to_string());
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let file = options.open(canonical).map_err(|_| (StatusCode::NOT_FOUND, "That file was not found on the computer running Pi.".to_string()))?;
    let handle = file.metadata().map_err(crate::internal_error)?;
    if !handle.is_file() {
        return Err(bad_request("Only regular files can be fetched, not folders."));
    }
    let current = std::fs::canonicalize(canonical).map_err(|_| changed())?;
    if current != canonical {
        return Err(changed());
    }
    check_file_allowed(&current, scope, data_root)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let on_disk = std::fs::metadata(&current).map_err(|_| changed())?;
        if on_disk.dev() != handle.dev() || on_disk.ino() != handle.ino() {
            return Err(changed());
        }
    }
    Ok(file)
}

/// Copy at most `max_bytes` from the open handle; one more byte than that means it is too large.
async fn copy_bounded(source: fs::File, destination: &FsPath, max_bytes: u64) -> ApiResult<u64> {
    let too_large = || (StatusCode::PAYLOAD_TOO_LARGE, format!("File is larger than the {} MiB limit.", max_bytes / 1024 / 1024));
    let mut limited = source.take(max_bytes + 1);
    let mut output = fs::File::create(destination).await.map_err(crate::internal_error)?;
    let copied = tokio::io::copy(&mut limited, &mut output).await.map_err(crate::internal_error)?;
    if copied > max_bytes {
        return Err(too_large());
    }
    Ok(copied)
}

/// Fetching the same source again refreshes the copy instead of piling up duplicates.
struct Admission {
    /// Copies taken out of the list (replaced or evicted); the caller deletes them from disk.
    /// Empty when the new copy was refused: nothing changes then.
    removed: Vec<String>,
    /// Whether the new copy was recorded.
    outcome: ApiResult<()>,
}

fn bridged_bytes(list: &[TempFile]) -> u64 {
    list.iter().filter(|existing| existing.origin.is_some()).map(|existing| existing.size).sum()
}

fn bridged_count(list: &[TempFile]) -> usize {
    list.iter().filter(|existing| existing.origin.is_some()).count()
}

/// Record a finished copy, within the quota. A newer copy of the same source replaces the old one;
/// if the session is still over its limits, its oldest bridged copies go first. The copy is refused
/// when it cannot fit even then, or when all sessions together are over the total.
///
/// All-or-nothing: the changes are worked out on a scratch list and only applied when every limit
/// holds, so a refusal never deletes copies that were already shared.
fn admit_copy(files: &mut HashMap<String, Vec<TempFile>>, session_id: &str, origin: &str, file: TempFile, quota: CopyQuota) -> Admission {
    let elsewhere: u64 = files.iter().filter(|(id, _)| id.as_str() != session_id).map(|(_, other)| bridged_bytes(other)).sum();
    let mut proposed = files.get(session_id).cloned().unwrap_or_default();
    let mut removed = Vec::new();
    proposed.retain(|existing| {
        let same_source = existing.origin.as_deref() == Some(origin);
        if same_source {
            removed.push(existing.path.clone());
        }
        !same_source
    });
    while bridged_bytes(&proposed) + file.size > quota.session_bytes || bridged_count(&proposed) + 1 > quota.session_files {
        let oldest = proposed
            .iter()
            .enumerate()
            .filter(|(_, existing)| existing.origin.is_some())
            .min_by_key(|(_, existing)| existing.created_at)
            .map(|(index, _)| index);
        let Some(index) = oldest else { break };
        removed.push(proposed.remove(index).path);
    }
    let fits = file.size <= quota.session_bytes && elsewhere + bridged_bytes(&proposed) + file.size <= quota.total_bytes;
    if !fits {
        let full = (StatusCode::INSUFFICIENT_STORAGE, "Companion's storage for bridged files is full. Remove some files and try again.".to_string());
        return Admission { removed: Vec::new(), outcome: Err(full) };
    }
    proposed.push(file);
    files.insert(session_id.to_string(), proposed);
    Admission { removed, outcome: Ok(()) }
}

/// The canonical working directory, or an error. Never falls back to a wide default: a missing,
/// relative, unreadable or filesystem-root directory would turn the scope into the whole disk.
async fn session_working_directory(state: &AppState, session_id: &str) -> ApiResult<PathBuf> {
    let reported = {
        let sessions = state.sessions.read().await;
        let session = sessions.get(session_id).ok_or((StatusCode::NOT_FOUND, "Session not found.".to_string()))?;
        session.snapshot.get("cwd").and_then(Value::as_str).map(PathBuf::from)
    };
    let unknown = || bad_request("This session did not report a usable working directory, so files cannot be bridged.");
    let reported = reported.filter(|path| path.is_absolute()).ok_or_else(unknown)?;
    let canonical = fs::canonicalize(&reported).await.map_err(|_| unknown())?;
    if canonical.parent().is_none() {
        return Err(unknown());
    }
    Ok(canonical)
}

pub async fn current_generation(state: &AppState, session_id: &str, caller: &Caller) -> RevocationEpoch {
    state.bridge.lock().await.epoch(session_id, caller)
}

/// Mint a link after every permission check. The relevant revocation epoch was captured before checks began.
pub async fn open_endpoint(state: &AppState, session_id: &str, url: &str, caller: Caller, generation: RevocationEpoch) -> ApiResult<Value> {
    ensure_bridgeable_session(state, session_id).await?;
    if let Caller::Device(device_id) = &caller {
        if !state.devices.read().await.contains_key(device_id) {
            return Err((StatusCode::UNAUTHORIZED, "This device is no longer paired.".into()));
        }
    }
    let target = parse_loopback_url(url).map_err(bad_request)?;
    refuse_companion_port(target.port)?;
    let mentioned = state.activity.read().await.mentions(session_id, &target.origin, MentionKind::Origin);
    if !mentioned {
        return Err((StatusCode::FORBIDDEN, "Only servers the agent mentioned in this session can be bridged.".into()));
    }
    let now = crate::now_secs();
    let minted = state.bridge.lock().await.open_if_current(generation, session_id, &caller, &target, now);
    let token = minted.ok_or((StatusCode::CONFLICT, "Sharing or the bridge changed while opening this link. Try again.".to_string()))?;
    Ok(json!({
        "origin": target.origin,
        "path": format!("/bridge/{token}{}", target.path_and_query),
        "expiresAt": now + ENDPOINT_LEASE_SECS,
        "leaseSeconds": ENDPOINT_LEASE_SECS,
    }))
}

#[derive(Deserialize)]
pub struct RevokeRequest {
    path: String,
}

/// The token in `/bridge/<token>/...`.
fn token_in_path(path: &str) -> Option<&str> {
    let rest = path.strip_prefix("/bridge/")?;
    let token = rest.split(['/', '?', '#']).next().unwrap_or_default();
    if token.is_empty() { None } else { Some(token) }
}

pub async fn revoke_endpoint_local(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    Json(request): Json<RevokeRequest>,
) -> ApiResult<StatusCode> {
    revoke_endpoint(&state, &session_id, &request.path, Caller::Admin).await
}

pub async fn revoke_endpoint_remote(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    headers: HeaderMap,
    Json(request): Json<RevokeRequest>,
) -> ApiResult<StatusCode> {
    let device_id = crate::authorize_device(&state, crate::bearer_token(&headers)?).await?;
    crate::check_session_id(&session_id)?;
    revoke_endpoint(&state, &session_id, &request.path, Caller::Device(device_id)).await
}

pub async fn renew_endpoint_local(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    Json(request): Json<RevokeRequest>,
) -> ApiResult<StatusCode> {
    renew_endpoint(&state, &session_id, &request.path, Caller::Admin).await
}

pub async fn renew_endpoint_remote(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    headers: HeaderMap,
    Json(request): Json<RevokeRequest>,
) -> ApiResult<StatusCode> {
    let device_id = crate::authorize_device(&state, crate::bearer_token(&headers)?).await?;
    renew_endpoint(&state, &session_id, &request.path, Caller::Device(device_id)).await
}

/// An open preview calls this about once a minute. 404 means the link already ended.
async fn renew_endpoint(state: &AppState, session_id: &str, path: &str, caller: Caller) -> ApiResult<StatusCode> {
    crate::check_session_id(session_id)?;
    let token = token_in_path(path).ok_or_else(|| bad_request("That is not a bridge link."))?;
    let renewed = state.bridge.lock().await.renew(token, session_id, &caller, crate::now_secs());
    if renewed {
        return Ok(StatusCode::NO_CONTENT);
    }
    Err((StatusCode::NOT_FOUND, "This bridge link has ended. Open it again from the session.".into()))
}

/// End a link as soon as its preview is closed. Deliberately works with the bridge switched off.
async fn revoke_endpoint(state: &AppState, session_id: &str, path: &str, caller: Caller) -> ApiResult<StatusCode> {
    crate::check_session_id(session_id)?;
    let token = token_in_path(path).ok_or_else(|| bad_request("That is not a bridge link."))?;
    state.bridge.lock().await.revoke_token(token, session_id, &caller);
    Ok(StatusCode::NO_CONTENT)
}

/// Companion's own listeners must never be bridged, whatever loopback name or port override
/// reached them: the admin console has no credentials, so relaying to it would hand a paired
/// device the local administrator's powers.
fn refuse_companion_port(port: u16) -> ApiResult<()> {
    let own_ports = [crate::local_addr(), crate::remote_addr()]
        .into_iter()
        .filter_map(|address| address.rsplit(':').next().and_then(|value| value.parse::<u16>().ok()));
    if own_ports.into_iter().any(|own| own == port) {
        return Err((StatusCode::FORBIDDEN, "Pi Companion's own address cannot be bridged.".into()));
    }
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// Reverse proxy
// ---------------------------------------------------------------------------------------------

/// Proxy routes are deliberately outside the Origin checks: a sandboxed frame sends
/// `Origin: null`, and the unguessable token is the credential.
pub fn router(remote: bool) -> Router<AppState> {
    if remote {
        return Router::new()
            .route("/bridge/{token}", any(proxy_device))
            .route("/bridge/{token}/", any(proxy_device))
            .route("/bridge/{token}/{*rest}", any(proxy_device));
    }
    Router::new()
        .route("/bridge/{token}", any(proxy_admin))
        .route("/bridge/{token}/", any(proxy_admin))
        .route("/bridge/{token}/{*rest}", any(proxy_admin))
}

async fn proxy_admin(State(state): State<AppState>, Path(params): Path<HashMap<String, String>>, request: Request) -> Response {
    proxy(state, false, params, request).await
}

async fn proxy_device(State(state): State<AppState>, Path(params): Path<HashMap<String, String>>, request: Request) -> Response {
    proxy(state, true, params, request).await
}

fn plain(status: StatusCode, message: &str) -> Response {
    let mut response = (status, message.to_string()).into_response();
    add_isolation_headers(response.headers_mut());
    response
}

async fn proxy(state: AppState, remote: bool, params: HashMap<String, String>, request: Request) -> Response {
    let Some(token) = params.get("token") else {
        return plain(StatusCode::NOT_FOUND, "Not found.");
    };
    if request.method() == Method::OPTIONS {
        return preflight(request.headers());
    }
    match forward(&state, remote, token, request).await {
        Ok(response) => response,
        Err((status, message)) => plain(status, &message),
    }
}

fn preflight(request_headers: &HeaderMap) -> Response {
    let mut response = StatusCode::NO_CONTENT.into_response();
    let headers = response.headers_mut();
    add_isolation_headers(headers);
    let allowed = request_headers
        .get(header::ACCESS_CONTROL_REQUEST_HEADERS)
        .cloned()
        .unwrap_or_else(|| HeaderValue::from_static("*"));
    headers.insert(header::ACCESS_CONTROL_ALLOW_HEADERS, allowed);
    headers.insert(header::ACCESS_CONTROL_ALLOW_METHODS, HeaderValue::from_static("GET, POST, PUT, PATCH, DELETE, OPTIONS"));
    headers.insert(header::ACCESS_CONTROL_MAX_AGE, HeaderValue::from_static("600"));
    response
}

/// Headers every bridge response carries. `sandbox` gives the document an opaque origin, so
/// proxied pages can never read the Companion app's storage or device credential.
fn add_isolation_headers(headers: &mut HeaderMap) {
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("sandbox allow-scripts allow-forms allow-modals; frame-ancestors 'self'"),
    );
    headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
    headers.insert(header::ACCESS_CONTROL_EXPOSE_HEADERS, HeaderValue::from_static("*"));
    headers.insert(header::REFERRER_POLICY, HeaderValue::from_static("no-referrer"));
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(
        HeaderName::from_static("permissions-policy"),
        HeaderValue::from_static("camera=(), microphone=(), geolocation=(), payment=(), usb=()"),
    );
}

async fn authorize_endpoint(state: &AppState, remote: bool, token: &str) -> ApiResult<Endpoint> {
    ensure_enabled(state).await?;
    let expired = (StatusCode::NOT_FOUND, "This bridge link has expired. Open it again from the session.".to_string());
    let endpoint = state.bridge.lock().await.lookup(token, crate::now_secs()).ok_or(expired.clone())?;
    refuse_companion_port(endpoint.port)?;
    if ensure_pi_connected(state, &endpoint.session_id).await.is_err() {
        state.bridge.lock().await.revoke_session(&endpoint.session_id);
        return Err(expired);
    }
    match (&endpoint.caller, remote) {
        (Caller::Admin, false) => Ok(endpoint),
        (Caller::Device(device_id), true) => {
            if !state.devices.read().await.contains_key(device_id) {
                return Err((StatusCode::UNAUTHORIZED, "This device is no longer paired.".into()));
            }
            crate::require_remote_session(state, &endpoint.session_id).await?;
            Ok(endpoint)
        }
        _ => Err(expired),
    }
}

const HOP_BY_HOP: [&str; 9] = [
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "proxy-connection",
    "te", "trailer", "transfer-encoding", "upgrade",
];
/// Never forwarded upstream: cookies stay out of the bridge, and the rest is set explicitly.
const WITHHELD_REQUEST_HEADERS: [&str; 10] = [
    "host", "cookie", "origin", "referer", "accept-encoding", "range",
    "if-none-match", "if-modified-since", "if-match", "if-range",
];
/// Only these upstream response headers are passed on, so upstream cannot set cookies, clear
/// Companion's site data, lift the sandbox, or change framing rules.
const FORWARDED_RESPONSE_HEADERS: [&str; 11] = [
    "content-type", "content-length", "content-encoding", "content-language", "content-range",
    "accept-ranges", "content-disposition", "last-modified", "etag", "location", "x-content-type-options",
];

fn forwards_request_header(name: &HeaderName) -> bool {
    let name = name.as_str();
    !HOP_BY_HOP.contains(&name) && !WITHHELD_REQUEST_HEADERS.contains(&name)
}

async fn forward(state: &AppState, remote: bool, token: &str, request: Request) -> ApiResult<Response> {
    let endpoint = authorize_endpoint(state, remote, token).await?;
    let permit = state
        .bridge_permits
        .clone()
        .try_acquire_owned()
        .map_err(|_| (StatusCode::SERVICE_UNAVAILABLE, "Too many bridged requests are open at once. Try again shortly.".to_string()))?;
    let prefix = format!("/bridge/{token}");
    let (parts, body) = request.into_parts();
    let rest = parts.uri.path().strip_prefix(&prefix).unwrap_or_default();
    let query = parts.uri.query().map(|query| format!("?{query}")).unwrap_or_default();
    if rest.is_empty() {
        return Ok(Redirect::temporary(&format!("{prefix}/{query}")).into_response());
    }

    let upstream_uri: Uri = format!("http://{}{rest}{query}", endpoint.connect_authority)
        .parse()
        .map_err(|_| bad_request("That address cannot be forwarded."))?;
    let mut builder = axum::http::Request::builder().method(parts.method.clone()).uri(upstream_uri);
    let headers = builder.headers_mut().ok_or_else(|| bad_request("That request cannot be forwarded."))?;
    for (name, value) in &parts.headers {
        if forwards_request_header(name) {
            headers.append(name.clone(), value.clone());
        }
    }
    let host = HeaderValue::from_str(&endpoint.host_header).map_err(|_| bad_request("Invalid host."))?;
    headers.insert(header::HOST, host);
    headers.insert(header::ACCEPT_ENCODING, HeaderValue::from_static("identity"));
    if parts.headers.contains_key(header::ORIGIN) {
        let origin = HeaderValue::from_str(&endpoint.origin).map_err(|_| bad_request("Invalid origin."))?;
        headers.insert(header::ORIGIN, origin);
    }
    let upstream_request = builder
        .body(Body::new(Limited::new(body, MAX_REQUEST_BYTES)))
        .map_err(|_| bad_request("That request cannot be forwarded."))?;

    // Revoking the token (preview closed, sharing off, device removed, Pi stopped) also ends this
    // exchange, whether it is still waiting for the server or already streaming the body.
    let mut revoked = endpoint.revoked.subscribe();
    let mut lease_deadline = endpoint.lease_deadline.subscribe();
    let exchange = async {
        let unreachable = || (StatusCode::BAD_GATEWAY, format!("Could not reach {}. Is the server still running?", endpoint.origin));
        let sent = tokio::time::timeout(UPSTREAM_TIMEOUT, state.bridge_client.request(upstream_request)).await;
        let upstream = sent
            .map_err(|_| (StatusCode::GATEWAY_TIMEOUT, format!("{} did not answer in time.", endpoint.origin)))?
            .map_err(|error| {
                tracing::debug!("bridge upstream failed: {error}");
                unreachable()
            })?;
        build_response(upstream, &endpoint, &prefix, permit, endpoint.revoked.subscribe(), endpoint.lease_deadline.subscribe()).await
    };
    tokio::select! {
        biased;
        _ = until_revoked(&mut revoked) => Err((StatusCode::NOT_FOUND, "This bridge link has ended. Open it again from the session.".to_string())),
        _ = until_lease_expired(&mut lease_deadline) => Err((StatusCode::NOT_FOUND, "This bridge link has expired. Open it again from the session.".to_string())),
        response = exchange => response,
    }
}

/// Resolves once the token has been revoked (or is already). Also resolves if the registry is gone.
async fn until_revoked(revoked: &mut watch::Receiver<bool>) {
    let _ = revoked.wait_for(|ended| *ended).await;
}

/// Resolve at the current lease deadline, but follow later deadlines sent by an authorized renewal.
async fn until_lease_expired(deadline: &mut watch::Receiver<tokio::time::Instant>) {
    loop {
        let current_deadline = *deadline.borrow();
        tokio::select! {
            _ = tokio::time::sleep_until(current_deadline) => {
                if tokio::time::Instant::now() >= *deadline.borrow() {
                    return;
                }
            }
            changed = deadline.changed() => {
                if changed.is_err() {
                    return;
                }
            }
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Rewrite {
    Html,
    Css,
    Script,
}

fn rewrite_kind(headers: &HeaderMap) -> Option<Rewrite> {
    let encoded = headers
        .get(header::CONTENT_ENCODING)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| !value.eq_ignore_ascii_case("identity"));
    if encoded {
        return None;
    }
    let content_type = headers.get(header::CONTENT_TYPE)?.to_str().ok()?;
    let essence = content_type.split(';').next().unwrap_or_default().trim().to_ascii_lowercase();
    match essence.as_str() {
        "text/html" | "application/xhtml+xml" => Some(Rewrite::Html),
        "text/css" => Some(Rewrite::Css),
        "text/javascript" | "application/javascript" | "application/x-javascript" | "application/ecmascript" => Some(Rewrite::Script),
        _ => None,
    }
}

async fn build_response(
    upstream: axum::http::Response<hyper::body::Incoming>,
    endpoint: &Endpoint,
    prefix: &str,
    permit: OwnedSemaphorePermit,
    revoked: watch::Receiver<bool>,
    lease_deadline: watch::Receiver<tokio::time::Instant>,
) -> ApiResult<Response> {
    let (parts, incoming) = upstream.into_parts();
    let rewrite = rewrite_kind(&parts.headers);
    let mut response_headers = HeaderMap::new();
    for (name, value) in &parts.headers {
        if !FORWARDED_RESPONSE_HEADERS.contains(&name.as_str()) {
            continue;
        }
        if name == header::LOCATION {
            let location = value.to_str().ok().map(|location| rewrite_location(location, endpoint.port, prefix));
            if let Some(Ok(rewritten)) = location.map(|location| HeaderValue::from_str(&location)) {
                response_headers.insert(header::LOCATION, rewritten);
            }
            continue;
        }
        if rewrite.is_some() && name == header::CONTENT_LENGTH {
            continue;
        }
        response_headers.append(name.clone(), value.clone());
    }
    add_isolation_headers(&mut response_headers);

    let body = match rewrite {
        Some(kind) => rewritten_body(incoming, kind, prefix, endpoint).await?,
        None => relay_body(incoming, permit, revoked, lease_deadline),
    };
    let mut response = Response::new(body);
    *response.status_mut() = parts.status;
    *response.headers_mut() = response_headers;
    Ok(response)
}

#[derive(Debug, PartialEq)]
enum CollectFailure {
    TooLarge,
    Stalled,
    Broken,
}

/// Read a whole body, but never more than `max_bytes`, never longer than `total`, and never wait
/// longer than `idle` for the next chunk. A server that sends headers and then goes quiet fails
/// here instead of holding a relay slot forever.
async fn collect_bounded<S, E>(stream: S, max_bytes: usize, total: Duration, idle: Duration) -> Result<Vec<u8>, CollectFailure>
where
    S: futures_util::Stream<Item = Result<axum::body::Bytes, E>>,
{
    let mut stream = std::pin::pin!(stream);
    let deadline = tokio::time::Instant::now() + total;
    let mut collected: Vec<u8> = Vec::new();
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        let wait = remaining.min(idle);
        let next = tokio::time::timeout(wait, stream.next()).await.map_err(|_| CollectFailure::Stalled)?;
        match next {
            None => return Ok(collected),
            Some(Err(_)) => return Err(CollectFailure::Broken),
            Some(Ok(chunk)) => {
                if collected.len() + chunk.len() > max_bytes {
                    return Err(CollectFailure::TooLarge);
                }
                collected.extend_from_slice(&chunk);
            }
        }
    }
}

async fn rewritten_body(
    incoming: hyper::body::Incoming,
    kind: Rewrite,
    prefix: &str,
    endpoint: &Endpoint,
) -> ApiResult<Body> {
    let origin = &endpoint.origin;
    let stream = incoming.into_data_stream();
    let collected = collect_bounded(stream, MAX_REWRITE_BYTES, REWRITE_TOTAL_TIMEOUT, REWRITE_IDLE_TIMEOUT).await;
    let bytes = collected.map_err(|failure| match failure {
        CollectFailure::TooLarge => (StatusCode::BAD_GATEWAY, format!("{origin} sent a page too large to bridge (over 5 MiB).")),
        CollectFailure::Stalled => (StatusCode::GATEWAY_TIMEOUT, format!("{origin} stalled while sending a page.")),
        CollectFailure::Broken => (StatusCode::BAD_GATEWAY, format!("{origin} closed the connection while sending a page.")),
    })?;
    // Anything that is not UTF-8 text is passed through untouched rather than corrupted.
    let Ok(text) = String::from_utf8(bytes.clone()) else {
        return Ok(Body::from(bytes));
    };
    let rewritten = match kind {
        Rewrite::Html => rewrite_html(&text, prefix, endpoint.port),
        Rewrite::Css => rewrite_css(&text, prefix, endpoint.port),
        Rewrite::Script => rewrite_script(&text, prefix, endpoint.port),
    };
    Ok(Body::from(rewritten))
}

/// Stream an upstream body with a byte budget, a total-time budget and an idle timeout. The
/// concurrency permit is held until the stream ends, so slow or endless upstreams cannot pile up.
/// Hyper's pull-based body gives backpressure: nothing is read faster than the browser consumes.
/// Revoking the link cuts the stream at the next opportunity, even mid-body.
fn relay_body(
    incoming: hyper::body::Incoming,
    permit: OwnedSemaphorePermit,
    revoked: watch::Receiver<bool>,
    lease_deadline: watch::Receiver<tokio::time::Instant>,
) -> Body {
    struct Relay<S> {
        chunks: S,
        sent: usize,
        deadline: tokio::time::Instant,
        finished: bool,
        revoked: watch::Receiver<bool>,
        lease_deadline: watch::Receiver<tokio::time::Instant>,
        _permit: OwnedSemaphorePermit,
    }
    let relay = Relay {
        chunks: incoming.into_data_stream(),
        sent: 0,
        deadline: tokio::time::Instant::now() + MAX_RELAY_DURATION,
        finished: false,
        revoked,
        lease_deadline,
        _permit: permit,
    };
    let stream = futures_util::stream::unfold(relay, |mut relay| async move {
        if relay.finished {
            return None;
        }
        let remaining = relay.deadline.saturating_duration_since(tokio::time::Instant::now());
        let wait = remaining.min(RELAY_IDLE_TIMEOUT);
        let next = tokio::select! {
            biased;
            _ = until_revoked(&mut relay.revoked) => {
                relay.finished = true;
                let closed = io::Error::new(io::ErrorKind::ConnectionAborted, "The bridge link was closed.");
                return Some((Err(closed), relay));
            }
            _ = until_lease_expired(&mut relay.lease_deadline) => {
                relay.finished = true;
                let expired = io::Error::new(io::ErrorKind::ConnectionAborted, "The bridge link expired.");
                return Some((Err(expired), relay));
            }
            next = tokio::time::timeout(wait, relay.chunks.next()) => next,
        };
        let failure = |message: &str| io::Error::new(io::ErrorKind::TimedOut, message.to_string());
        let outcome = match next {
            Err(_) => Err(failure("The bridged server stalled or took too long.")),
            Ok(None) => return None,
            Ok(Some(Err(error))) => Err(io::Error::other(error)),
            Ok(Some(Ok(chunk))) => {
                relay.sent += chunk.len();
                if relay.sent > MAX_RELAY_BYTES { Err(failure("The bridged response was too large.")) } else { Ok(chunk) }
            }
        };
        relay.finished = outcome.is_err();
        Some((outcome, relay))
    });
    Body::from_stream(stream)
}

/// The port a redirect target names when it points at a loopback server, with the path to use.
fn loopback_location(location: &str) -> Option<(u16, String)> {
    let absolute = if location.starts_with("//") { format!("http:{location}") } else { location.to_string() };
    let target = parse_loopback_url(&absolute).ok()?;
    Some((target.port, target.path_and_query))
}

/// Keep redirects inside the bridge. Root-relative locations, and absolute or scheme-relative
/// locations naming the bridged server's port on any loopback name (`localhost`, `127.0.0.1`,
/// `[::1]`), get the token prefix. Relative locations already resolve inside the bridge.
pub fn rewrite_location(location: &str, bridged_port: u16, prefix: &str) -> String {
    if let Some((port, path_and_query)) = loopback_location(location) {
        if port == bridged_port {
            return format!("{prefix}{path_and_query}");
        }
        return location.to_string();
    }
    if location.starts_with('/') && !location.starts_with("//") && !location.starts_with(prefix) {
        return format!("{prefix}{location}");
    }
    location.to_string()
}

// ---------------------------------------------------------------------------------------------
// Root-relative URL rewriting
//
// A page served at /bridge/{token}/ that links to "/app.js" would escape to the Companion app.
// These helpers prefix such URLs, and turn absolute URLs to the bridged port
// (`http://localhost:3000/app.js`) into bridge URLs. They are heuristics for common dev-server output, not a parser.
// ---------------------------------------------------------------------------------------------

struct Marker {
    text: &'static str,
    quote_required: bool,
    /// The marker must not continue an identifier (`from` in `Array.from`).
    word_start: bool,
}

const fn marker(text: &'static str, quote_required: bool, word_start: bool) -> Marker {
    Marker { text, quote_required, word_start }
}

const HTML_MARKERS: [Marker; 7] = [
    marker("src=", true, false),
    marker("href=", true, false),
    marker("action=", true, false),
    marker("formaction=", true, false),
    marker("poster=", true, false),
    marker("url(", false, false),
    marker("@import", true, false),
];
const CSS_MARKERS: [Marker; 2] = [marker("url(", false, false), marker("@import", true, false)];
const SCRIPT_MARKERS: [Marker; 3] = [marker("from", true, true), marker("import", true, true), marker("import(", true, true)];

fn is_identifier_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'$' || byte == b'.'
}

/// Part of the source to swap for the bridge prefix. Root-relative URLs only gain the prefix
/// (`start == end`); absolute loopback URLs lose their `http://host:port` and gain it instead.
struct Replacement {
    start: usize,
    end: usize,
    /// The URL named only the server (`http://localhost:3000`), so the prefix needs a `/` after it.
    trailing_slash: bool,
}

/// Where the URL begins right after `marker` (past whitespace and an opening quote), if the marker is here.
fn url_start_after_marker(bytes: &[u8], index: usize, marker: &Marker) -> Option<usize> {
    let end = index + marker.text.len();
    if end > bytes.len() || !bytes[index..end].eq_ignore_ascii_case(marker.text.as_bytes()) {
        return None;
    }
    if marker.word_start && index > 0 && is_identifier_byte(bytes[index - 1]) {
        return None;
    }
    let mut cursor = end;
    while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
        cursor += 1;
    }
    let quoted = matches!(bytes.get(cursor), Some(b'"' | b'\'' | b'`'));
    if quoted {
        cursor += 1;
    } else if marker.quote_required {
        return None;
    }
    Some(cursor)
}

fn root_replacement(bytes: &[u8], cursor: usize, prefix: &str) -> Option<Replacement> {
    let is_root = bytes.get(cursor) == Some(&b'/') && bytes.get(cursor + 1) != Some(&b'/');
    let already_prefixed = bytes[cursor.min(bytes.len())..].starts_with(prefix.as_bytes());
    if is_root && !already_prefixed {
        return Some(Replacement { start: cursor, end: cursor, trailing_slash: false });
    }
    None
}

fn ends_url_authority(byte: u8) -> bool {
    byte.is_ascii_whitespace() || matches!(byte, b'/' | b'?' | b'#' | b'"' | b'\'' | b'`' | b')' | b'(' | b'\\' | b'<' | b'>' | b',' | b';')
}

/// `http://localhost:3000/x`, `//127.0.0.1:3000/x` and the like, when they name the bridged port.
/// Left in a page, the browser would ask its own localhost (often the phone's) for them.
fn loopback_replacement(bytes: &[u8], cursor: usize, bridged_port: u16) -> Option<Replacement> {
    let rest = bytes.get(cursor..)?;
    let scheme_length = if rest.len() >= 7 && rest[..7].eq_ignore_ascii_case(b"http://") {
        7
    } else if rest.starts_with(b"//") {
        2
    } else {
        return None;
    };
    let authority_start = cursor + scheme_length;
    let authority_length = bytes[authority_start..].iter().position(|byte| ends_url_authority(*byte)).unwrap_or(bytes.len() - authority_start);
    let authority_end = authority_start + authority_length;
    let authority = std::str::from_utf8(&bytes[authority_start..authority_end]).ok()?;
    let target = parse_loopback_url(&format!("http://{authority}")).ok()?;
    if target.port != bridged_port {
        return None;
    }
    let trailing_slash = bytes.get(authority_end) != Some(&b'/');
    Some(Replacement { start: cursor, end: authority_end, trailing_slash })
}

fn replacement_after_marker(bytes: &[u8], index: usize, marker: &Marker, prefix: &str, port: u16) -> Option<Replacement> {
    let cursor = url_start_after_marker(bytes, index, marker)?;
    root_replacement(bytes, cursor, prefix).or_else(|| loopback_replacement(bytes, cursor, port))
}

fn prefix_root_urls(source: &str, markers: &[Marker], prefix: &str, port: u16) -> String {
    let bytes = source.as_bytes();
    let mut output = String::with_capacity(source.len() + 256);
    let mut copied = 0;
    let mut index = 0;
    while index < bytes.len() {
        let found = markers.iter().find_map(|marker| replacement_after_marker(bytes, index, marker, prefix, port));
        match found {
            Some(replacement) => {
                output.push_str(&source[copied..replacement.start]);
                output.push_str(prefix);
                if replacement.trailing_slash {
                    output.push('/');
                }
                copied = replacement.end;
                index = replacement.end.max(replacement.start + 1);
            }
            None => index += 1,
        }
    }
    output.push_str(&source[copied..]);
    output
}

pub fn rewrite_css(css: &str, prefix: &str, port: u16) -> String {
    prefix_root_urls(css, &CSS_MARKERS, prefix, port)
}

pub fn rewrite_script(script: &str, prefix: &str, port: u16) -> String {
    prefix_root_urls(script, &SCRIPT_MARKERS, prefix, port)
}

/// Prefix root-relative attributes, then add the request shim as early as possible.
pub fn rewrite_html(html: &str, prefix: &str, port: u16) -> String {
    let rewritten = prefix_root_urls(html, &HTML_MARKERS, prefix, port);
    let shim = request_shim(prefix, port);
    let lowered = rewritten.to_ascii_lowercase();
    for opening in ["<head", "<html"] {
        let Some(start) = lowered.find(opening) else { continue };
        let Some(close) = lowered[start..].find('>') else { continue };
        let insert_at = start + close + 1;
        return format!("{}{shim}{}", &rewritten[..insert_at], &rewritten[insert_at..]);
    }
    format!("{shim}{rewritten}")
}

const SHIM_TEMPLATE: &str = include_str!("bridge_shim.js");

/// Runtime requests (`fetch`, XHR, `Request`, EventSource, `sendBeacon`, absolute URLs to the
/// bridged server) are sent through the bridge. WebSockets and workers are not supported.
fn request_shim(prefix: &str, port: u16) -> String {
    let quoted_prefix = serde_json::to_string(prefix).unwrap_or_default();
    let script = SHIM_TEMPLATE.replace("__PREFIX__", &quoted_prefix).replace("__PORT__", &port.to_string());
    format!("<script>{script}</script>")
}

#[cfg(test)]
mod tests {
    use super::*;

    const PREFIX: &str = "/bridge/abc";

    #[test]
    fn loopback_urls_parse_and_others_are_refused() {
        let target = parse_loopback_url("http://localhost:3000/app?x=1#top").unwrap();
        assert_eq!(target.origin, "http://localhost:3000");
        assert_eq!(target.connect_authority, "localhost:3000");
        assert_eq!(target.path_and_query, "/app?x=1");
        assert_eq!(parse_loopback_url("http://0.0.0.0:8000").unwrap().connect_authority, "127.0.0.1:8000");
        assert_eq!(parse_loopback_url("http://[::1]:5173/").unwrap().connect_authority, "[::1]:5173");
        assert_eq!(parse_loopback_url("http://127.0.0.1").unwrap().connect_authority, "127.0.0.1:80");
        for refused in [
            "https://localhost:3000",
            "http://192.168.1.5:3000",
            "http://example.com",
            "http://user:pw@localhost:3000",
            "http://localhost.evil.com",
            "ftp://localhost",
            "not a url",
        ] {
            assert!(parse_loopback_url(refused).is_err(), "{refused} must be refused");
        }
    }

    #[test]
    fn references_resolve_against_cwd_home_and_file_urls() {
        let cwd = FsPath::new("/work/app");
        let home = FsPath::new("/home/me");
        let resolve = |reference: &str| resolve_reference(reference, cwd, Some(home));
        assert_eq!(resolve("/tmp/report.html"), Some(PathBuf::from("/tmp/report.html")));
        assert_eq!(resolve("docs/a.md"), Some(PathBuf::from("/work/app/docs/a.md")));
        assert_eq!(resolve("~/notes.txt"), Some(PathBuf::from("/home/me/notes.txt")));
        assert_eq!(resolve("file:///tmp/my%20file.html#x"), Some(PathBuf::from("/tmp/my file.html")));
        assert_eq!(resolve("file://localhost/tmp/a.txt"), Some(PathBuf::from("/tmp/a.txt")));
        for refused in ["", "https://example.com/a", "file://other-host/a", "/tmp/a\u{0}b", "file:///bad%zz"] {
            assert_eq!(resolve(refused), None, "{refused:?} must not resolve");
        }
    }

    #[test]
    fn credential_locations_are_sensitive() {
        let roots = vec![PathBuf::from("/data/pi-companion")];
        for sensitive in [
            "/data/pi-companion/state.json",
            "/home/me/.ssh/id_ed25519.pub",
            "/home/me/.aws/credentials",
            "/home/me/.pi/agent/auth.json",
            "/home/me/.config/gcloud/creds.db",
            "/work/app/.env.production",
            "/work/app/certs/server.PEM",
            "/home/me/.git-credentials",
            "/home/me/.config/gh/hosts.yml",
            "/work/app/config/secrets.json",
            "/work/app/db_password.txt",
            "/work/app/.git/config",
            "/work/infra/prod.tfstate",
            "/work/infra/terraform.tfvars",
        ] {
            assert!(is_sensitive_path(FsPath::new(sensitive), &roots), "{sensitive} must be sensitive");
        }
        for fine in ["/tmp/report.html", "/work/app/docs/environment.md", "/home/me/.config/app/settings.json"] {
            assert!(!is_sensitive_path(FsPath::new(fine), &roots), "{fine} must be allowed");
        }
    }

    #[test]
    fn scope_is_the_working_directory_plus_this_sessions_and_the_shared_temp_folders() {
        let scope = FileScope {
            working_directory: PathBuf::from("/work/app"),
            temp_root: PathBuf::from("/tmp/pi-companion"),
            session_id: "s1".into(),
        };
        for inside in ["/work/app/docs/a.md", "/tmp/pi-companion/s1/id-report.html", "/tmp/pi-companion/.shared/note.txt"] {
            assert!(scope.allows(FsPath::new(inside)), "{inside} must be in scope");
        }
        // Prefix matching is per path component: /work/app-secrets is not inside /work/app.
        for outside in [
            "/work/app-secrets/a.md", "/work/other/a.md", "/tmp/other.html", "/etc/hosts", "/home/me/notes.txt",
            "/tmp/pi-companion/s2/id-report.html", "/tmp/pi-companion/s10/x.txt", "/tmp/pi-companion/other.txt",
        ] {
            assert!(!scope.allows(FsPath::new(outside)), "{outside} must be out of scope");
        }
        // A working directory that contains the temp root still cannot reach other sessions' folders.
        let wide = FileScope { working_directory: PathBuf::from("/tmp"), ..scope };
        assert!(wide.allows(FsPath::new("/tmp/notes.txt")));
        assert!(wide.allows(FsPath::new("/tmp/pi-companion/s1/x.txt")));
        assert!(!wide.allows(FsPath::new("/tmp/pi-companion/s2/x.txt")));
    }

    fn scratch_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("pi-companion-bridge-{label}-{}", Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::canonicalize(&dir).unwrap()
    }

    fn scope_of(dir: &FsPath) -> FileScope {
        FileScope { working_directory: dir.to_path_buf(), temp_root: dir.join("temp-root-unused"), session_id: "s1".into() }
    }

    #[test]
    fn opening_a_validated_file_returns_its_handle() {
        let dir = scratch_dir("open");
        let file = dir.join("a.txt");
        std::fs::write(&file, "hello").unwrap();
        assert!(open_checked_file_blocking(&file, &scope_of(&dir), &dir.join("data")).is_ok());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn opening_never_follows_a_symlink_swapped_in_after_validation() {
        let dir = scratch_dir("swap");
        let outside = scratch_dir("swap-outside");
        std::fs::write(outside.join("private.txt"), "private").unwrap();
        // The validated canonical path was a plain file; now that path is a link to elsewhere.
        let swapped = dir.join("a.txt");
        std::os::unix::fs::symlink(outside.join("private.txt"), &swapped).unwrap();
        let error = open_checked_file_blocking(&swapped, &scope_of(&dir), &dir.join("data")).unwrap_err();
        assert!(matches!(error.0, StatusCode::NOT_FOUND | StatusCode::CONFLICT | StatusCode::FORBIDDEN), "{error:?}");

        // A directory swapped for a link to another location changes the canonical path.
        std::fs::create_dir_all(dir.join("real")).unwrap();
        std::fs::write(dir.join("real/b.txt"), "b").unwrap();
        std::os::unix::fs::symlink(&outside, dir.join("alias")).unwrap();
        std::fs::write(outside.join("b.txt"), "other").unwrap();
        let through_alias = dir.join("alias/b.txt");
        let error = open_checked_file_blocking(&through_alias, &scope_of(&dir), &dir.join("data")).unwrap_err();
        assert_eq!(error.0, StatusCode::CONFLICT, "{error:?}");
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&outside);
    }

    #[test]
    fn folders_and_missing_files_are_not_opened_as_files() {
        let dir = scratch_dir("kinds");
        assert!(open_checked_file_blocking(&dir, &scope_of(&dir), &dir.join("data")).is_err());
        assert_eq!(open_checked_file_blocking(&dir.join("missing"), &scope_of(&dir), &dir.join("data")).unwrap_err().0, StatusCode::NOT_FOUND);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn percent_encoding_matches_how_agents_write_paths_with_spaces() {
        assert_eq!(percent_encode_path("/Users/me/My Docs/a b.pdf"), "/Users/me/My%20Docs/a%20b.pdf");
        assert_eq!(percent_encode_path("/plain/a-b_c.txt"), "/plain/a-b_c.txt");
    }

    #[test]
    fn companion_listeners_are_never_bridge_targets() {
        let admin = crate::local_addr().rsplit(':').next().unwrap().parse::<u16>().unwrap();
        let device = crate::remote_addr().rsplit(':').next().unwrap().parse::<u16>().unwrap();
        for port in [admin, device] {
            assert!(refuse_companion_port(port).is_err());
            for host in ["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "LOCALHOST"] {
                let target = parse_loopback_url(&format!("http://{host}:{port}/api/devices")).unwrap();
                assert!(refuse_companion_port(target.port).is_err(), "{host}:{port}");
            }
        }
        assert!(refuse_companion_port(3000).is_ok());
    }

    #[test]
    fn every_preview_gets_its_own_token_and_closing_one_leaves_the_others() {
        let target = parse_loopback_url("http://localhost:3000").unwrap();
        let mut registry = Registry::default();
        let first = registry.open("s1", &Caller::Admin, &target, 100);
        let second = registry.open("s1", &Caller::Admin, &target, 200);
        let device = registry.open("s1", &Caller::Device("d".into()), &target, 200);
        assert!(first != second && second != device && first != device);
        assert!(registry.revoke_token(&first, "s1", &Caller::Admin));
        assert!(registry.lookup(&first, 201).is_none(), "the closed preview's link is gone");
        assert!(registry.lookup(&second, 201).is_some(), "the other tab keeps working");
        assert!(registry.lookup(&device, 201).is_some());
    }

    #[test]
    fn tokens_expire_and_each_caller_is_capped_without_evicting_others() {
        let target = parse_loopback_url("http://localhost:3000").unwrap();
        let mut registry = Registry::default();
        let device = Caller::Device("d".into());
        let kept = registry.open("s2", &device, &target, 1_000_000);
        for _ in 0..MAX_ENDPOINTS_PER_SESSION + 5 {
            registry.open("s2", &Caller::Admin, &target, 1_000_000);
        }
        let admin_count = registry.endpoints.values().filter(|endpoint| endpoint.session_id == "s2" && endpoint.caller == Caller::Admin).count();
        assert_eq!(admin_count, MAX_ENDPOINTS_PER_SESSION);
        assert!(registry.lookup(&kept, 1_000_001).is_some(), "one caller cannot evict another's preview");

        let old = registry.open("s3", &Caller::Admin, &target, 100);
        assert!(registry.lookup(&old, 100 + ENDPOINT_LEASE_SECS - 1).is_some());
        assert!(registry.lookup(&old, 100 + 2 * ENDPOINT_LEASE_SECS).is_none());
    }

    #[tokio::test]
    async fn collecting_a_page_gives_up_on_stalls_overruns_and_broken_bodies() {
        use axum::body::Bytes;
        let chunk = |text: &'static str| Ok::<_, io::Error>(Bytes::from_static(text.as_bytes()));
        let total = Duration::from_millis(400);
        let idle = Duration::from_millis(80);

        let finished = futures_util::stream::iter(vec![chunk("<p>"), chunk("hi</p>")]);
        assert_eq!(collect_bounded(finished, 1024, total, idle).await.unwrap(), b"<p>hi</p>");

        // Headers arrived, then nothing: the idle timeout fires long before the total one.
        let silent = futures_util::stream::iter(vec![chunk("<p>")]).chain(futures_util::stream::pending());
        let started = tokio::time::Instant::now();
        assert_eq!(collect_bounded(silent, 1024, total, idle).await, Err(CollectFailure::Stalled));
        assert!(started.elapsed() < Duration::from_millis(300));

        // A trickle that never ends hits the total deadline even though no gap is idle for long.
        let trickle = futures_util::stream::unfold((), |()| async {
            tokio::time::sleep(Duration::from_millis(30)).await;
            Some((chunk("x"), ()))
        });
        assert_eq!(collect_bounded(trickle, 1024 * 1024, total, idle).await, Err(CollectFailure::Stalled));

        let large = futures_util::stream::iter(vec![chunk("0123456789"), chunk("0123456789")]);
        assert_eq!(collect_bounded(large, 15, total, idle).await, Err(CollectFailure::TooLarge));

        let broken = futures_util::stream::iter(vec![chunk("<p>"), Err(io::Error::other("reset"))]);
        assert_eq!(collect_bounded(broken, 1024, total, idle).await, Err(CollectFailure::Broken));
    }

    #[test]
    fn absolute_loopback_urls_to_the_bridged_port_become_bridge_urls() {
        let html = rewrite_html(
            concat!(
                r#"<script src="http://localhost:3000/app.js"></script>"#,
                r#"<img src='http://127.0.0.1:3000/logo.png?v=1#x'>"#,
                r#"<link href="HTTP://[::1]:3000/a.css"><a href="//localhost:3000/x">x</a>"#,
                r#"<a href="http://localhost:3000">home</a><a href="http://0.0.0.0:3000?q=1">q</a>"#,
                r#"<a href="http://localhost:3001/other">other port</a><a href="http://localhost:30001/">longer port</a>"#,
                r#"<a href="https://example.com/x">remote</a><a href="http://localhost.evil.com:3000/">lookalike</a>"#,
                r#"<style>a{background:url(http://localhost:3000/bg.png)} b{background:url("http://127.0.0.1:3000/f.woff2")}</style>"#,
            ),
            PREFIX,
            3000,
        );
        for expected in [
            r#"src="/bridge/abc/app.js""#,
            r#"src='/bridge/abc/logo.png?v=1#x'"#,
            r#"href="/bridge/abc/a.css""#,
            r#"href="/bridge/abc/x""#,
            r#"href="/bridge/abc/">home"#,
            r#"href="/bridge/abc/?q=1""#,
            "url(/bridge/abc/bg.png)",
            r#"url("/bridge/abc/f.woff2")"#,
        ] {
            assert!(html.contains(expected), "{expected} missing from {html}");
        }
        for untouched in [
            r#"href="http://localhost:3001/other""#,
            r#"href="http://localhost:30001/""#,
            r#"href="https://example.com/x""#,
            r#"href="http://localhost.evil.com:3000/""#,
        ] {
            assert!(html.contains(untouched), "{untouched} must stay as written");
        }
        let css = rewrite_css("@import 'http://localhost:3000/base.css'; a{background:url(http://localhost:4000/x.png)}", PREFIX, 3000);
        assert_eq!(css, "@import '/bridge/abc/base.css'; a{background:url(http://localhost:4000/x.png)}");
        // Running the rewrite again changes nothing.
        assert_eq!(rewrite_css(&css, PREFIX, 3000), css);
    }

    #[test]
    fn leases_renew_only_for_their_owner_and_only_while_live() {
        let target = parse_loopback_url("http://localhost:3000").unwrap();
        let mut registry = Registry::default();
        let device = Caller::Device("d".into());
        let token = registry.open("s1", &device, &target, 100);
        assert!(!registry.renew(&token, "s1", &Caller::Admin, 150), "not the opener");
        assert!(!registry.renew(&token, "s2", &device, 150), "wrong session");
        assert!(registry.renew(&token, "s1", &device, 100 + ENDPOINT_LEASE_SECS - 1));
        // Renewed at T = 100 + lease - 1, so it lives until that + lease; a missed heartbeat ends it.
        assert!(registry.lookup(&token, 100 + 2 * ENDPOINT_LEASE_SECS - 2).is_some());
        assert!(registry.lookup(&token, 100 + 4 * ENDPOINT_LEASE_SECS).is_none(), "an orphaned link stops by itself");
        assert!(!registry.renew(&token, "s1", &device, 100 + 4 * ENDPOINT_LEASE_SECS), "an expired link is not revived");
    }

    #[tokio::test(start_paused = true)]
    async fn active_stream_lease_expires_and_owner_renewal_moves_its_deadline() {
        let target = parse_loopback_url("http://localhost:3000").unwrap();
        let mut registry = Registry::default();
        let token = registry.open("s1", &Caller::Admin, &target, 0);
        let mut deadline = registry.lookup(&token, 0).unwrap().lease_deadline.subscribe();
        let expiry = tokio::spawn(async move { until_lease_expired(&mut deadline).await });
        tokio::task::yield_now().await;

        tokio::time::advance(Duration::from_secs(20)).await;
        assert!(registry.renew(&token, "s1", &Caller::Admin, 20));
        tokio::time::advance(Duration::from_secs(299)).await;
        assert!(!expiry.is_finished(), "an explicit renewal extends an active stream");

        tokio::time::advance(Duration::from_secs(1)).await;
        expiry.await.unwrap();
    }

    #[test]
    fn revocation_epochs_are_scoped_to_affected_callers_and_sessions() {
        let target = parse_loopback_url("http://localhost:3000").unwrap();
        let mut registry = Registry::default();
        let admin_epoch = registry.epoch("s1", &Caller::Admin);
        let device_epoch = registry.epoch("s1", &Caller::Device("d1".into()));
        registry.revoke_session_devices("s1");
        assert!(registry.epoch_is_current(admin_epoch, "s1", &Caller::Admin), "unsharing leaves console callers alone");
        assert!(!registry.epoch_is_current(device_epoch, "s1", &Caller::Device("d1".into())));

        let device_epoch = registry.epoch("s1", &Caller::Device("d1".into()));
        registry.revoke_device("d2");
        assert!(registry.epoch_is_current(device_epoch, "s1", &Caller::Device("d1".into())), "revoking another device is isolated");

        let old_epoch = registry.epoch("s1", &Caller::Admin);
        let other_session_epoch = registry.epoch("s2", &Caller::Admin);
        registry.revoke_session("s1");
        assert!(!registry.epoch_is_current(old_epoch, "s1", &Caller::Admin));
        assert!(registry.epoch_is_current(other_session_epoch, "s2", &Caller::Admin), "session revocations are isolated");
        let token = registry.open("s1", &Caller::Admin, &target, 100);
        assert!(registry.revoke_token(&token, "s1", &Caller::Admin));
        let current = registry.epoch("s1", &Caller::Admin);
        assert!(registry.open_if_current(current, "s1", &Caller::Admin, &target, 100).is_some(), "closing one preview does not invalidate an open request");
        let before = registry.epoch("s1", &Caller::Device("d1".into()));
        registry.revoke_all();
        assert!(!registry.epoch_is_current(before, "s1", &Caller::Device("d1".into())), "global disable invalidates every caller");
    }

    #[test]
    fn revoking_signals_streams_that_hold_the_token() {
        let target = parse_loopback_url("http://localhost:3000").unwrap();
        let mut registry = Registry::default();
        let token = registry.open("s1", &Caller::Admin, &target, 100);
        let in_flight = registry.lookup(&token, 101).unwrap();
        let listener = in_flight.revoked.subscribe();
        assert!(!*listener.borrow());
        registry.revoke_session("s1");
        assert!(*listener.borrow(), "the stream sees the revocation");

        let expiring = registry.open("s2", &Caller::Admin, &target, 100);
        let listener = registry.lookup(&expiring, 101).unwrap().revoked.subscribe();
        assert!(registry.lookup(&expiring, 101 + 2 * ENDPOINT_LEASE_SECS).is_none());
        assert!(*listener.borrow(), "an expired link also ends its streams");
    }

    fn copy(id: &str, size: u64, created_at: u64, origin: Option<&str>) -> TempFile {
        TempFile {
            source: "agent".into(),
            id: id.into(),
            name: format!("{id}.txt"),
            path: format!("/tmp/{id}"),
            size,
            mime: "text/plain".into(),
            created_at,
            origin: origin.map(str::to_string),
        }
    }

    #[test]
    fn copy_quotas_evict_the_oldest_bridged_copies_and_never_touch_uploads() {
        let quota = CopyQuota { session_bytes: 100, session_files: 3, total_bytes: 250 };
        let mut files: HashMap<String, Vec<TempFile>> = HashMap::new();
        files.insert("s1".into(), vec![copy("upload", 500, 1, None)]);
        let admit = |files: &mut HashMap<String, Vec<TempFile>>, id: &str, size, at, origin: &str| {
            admit_copy(files, "s1", origin, copy(id, size, at, Some(origin)), quota)
        };

        for (id, at) in [("a", 10), ("b", 11), ("c", 12)] {
            let admission = admit(&mut files, id, 10, at, id);
            assert!(admission.outcome.is_ok() && admission.removed.is_empty());
        }
        // A fourth copy exceeds the file count: the oldest bridged copy goes, the upload stays.
        let admission = admit(&mut files, "d", 10, 13, "d");
        assert!(admission.outcome.is_ok());
        assert_eq!(admission.removed, vec!["/tmp/a".to_string()]);
        let ids: Vec<&str> = files["s1"].iter().map(|file| file.id.as_str()).collect();
        assert_eq!(ids, ["upload", "b", "c", "d"]);

        // Bytes: a 95-byte copy evicts the others until it fits.
        let admission = admit(&mut files, "big", 95, 14, "big");
        assert!(admission.outcome.is_ok());
        assert_eq!(admission.removed.len(), 3);
        assert_eq!(bridged_bytes(&files["s1"]), 95);

        // Refetching the same source replaces the old copy instead of adding to the total.
        let admission = admit(&mut files, "big2", 95, 15, "big");
        assert!(admission.outcome.is_ok());
        assert_eq!(admission.removed, vec!["/tmp/big".to_string()]);
        assert_eq!(bridged_count(&files["s1"]), 1);

        // Larger than the whole per-session quota is refused and records nothing.
        let admission = admit(&mut files, "huge", 101, 16, "huge");
        assert_eq!(admission.outcome.unwrap_err().0, StatusCode::INSUFFICIENT_STORAGE);
        assert!(files["s1"].iter().all(|file| file.id != "huge"));
    }

    #[test]
    fn the_total_quota_spans_sessions_without_evicting_other_sessions() {
        let quota = CopyQuota { session_bytes: 100, session_files: 10, total_bytes: 150 };
        let mut files: HashMap<String, Vec<TempFile>> = HashMap::new();
        for (session, id) in [("s1", "one"), ("s2", "two")] {
            let admission = admit_copy(&mut files, session, id, copy(id, 70, 1, Some(id)), quota);
            assert!(admission.outcome.is_ok(), "{session}");
        }
        let admission = admit_copy(&mut files, "s3", "three", copy("three", 70, 2, Some("three")), quota);
        assert_eq!(admission.outcome.unwrap_err().0, StatusCode::INSUFFICIENT_STORAGE);
        assert!(admission.removed.is_empty(), "another session's files are never evicted");
        assert_eq!(files["s1"].len() + files["s2"].len(), 2);
        assert!(!files.contains_key("s3"), "a refusal records nothing");
    }

    #[test]
    fn a_revocation_between_lookup_and_subscribe_is_not_lost() {
        let target = parse_loopback_url("http://localhost:3000").unwrap();
        let mut registry = Registry::default();
        let token = registry.open("s1", &Caller::Admin, &target, 100);
        // What `forward` holds after authorizing: a clone of the endpoint, with no receiver yet.
        let authorized = registry.lookup(&token, 101).unwrap();
        registry.revoke_session("s1");
        let late_subscriber = authorized.revoked.subscribe();
        assert!(*late_subscriber.borrow(), "subscribing after the revocation must still see it");

        let expiring = registry.open("s2", &Caller::Admin, &target, 100);
        let authorized = registry.lookup(&expiring, 101).unwrap();
        assert!(registry.lookup(&expiring, 101 + 2 * ENDPOINT_LEASE_SECS).is_none());
        assert!(*authorized.revoked.subscribe().borrow(), "so must an expiry");
    }

    #[test]
    fn using_a_link_does_not_extend_it() {
        let target = parse_loopback_url("http://localhost:3000").unwrap();
        let mut registry = Registry::default();
        let token = registry.open("s1", &Caller::Admin, &target, 0);
        // Another tab hits the URL every minute for twenty minutes.
        let mut alive = Vec::new();
        for minute in 1..=20 {
            alive.push(registry.lookup(&token, minute * 60).is_some());
        }
        assert_eq!(alive.iter().filter(|live| **live).count(), (ENDPOINT_LEASE_SECS / 60 - 1) as usize);
        assert!(registry.lookup(&token, ENDPOINT_LEASE_SECS).is_none(), "the lease ended on schedule despite traffic");
        assert!(registry.lookup(&token, ENDPOINT_LEASE_SECS + 60).is_none(), "and stays ended");

        // Only the owner's renewal extends it.
        let kept = registry.open("s1", &Caller::Admin, &target, 1000);
        assert!(registry.renew(&kept, "s1", &Caller::Admin, 1000 + ENDPOINT_LEASE_SECS - 1));
        assert!(registry.lookup(&kept, 1000 + ENDPOINT_LEASE_SECS + 30).is_some());
    }

    #[test]
    fn a_refused_copy_leaves_earlier_copies_alone() {
        // Session cap 100 and global cap 180; s1 holds 20 + 30; other sessions hold 130.
        let quota = CopyQuota { session_bytes: 100, session_files: 10, total_bytes: 180 };
        let mut files: HashMap<String, Vec<TempFile>> = HashMap::new();
        files.insert("s1".into(), vec![copy("a", 20, 1, Some("/src/a")), copy("b", 30, 2, Some("/src/b"))]);
        files.insert("s2".into(), vec![copy("x", 130, 3, Some("/src/x"))]);

        let admission = admit_copy(&mut files, "s1", "/src/c", copy("c", 90, 4, Some("/src/c")), quota);
        assert_eq!(admission.outcome.unwrap_err().0, StatusCode::INSUFFICIENT_STORAGE);
        assert!(admission.removed.is_empty(), "nothing may be deleted for a copy that was refused");
        let ids: Vec<&str> = files["s1"].iter().map(|file| file.id.as_str()).collect();
        assert_eq!(ids, ["a", "b"]);
        assert_eq!(bridged_bytes(&files["s1"]), 50);
        assert_eq!(bridged_bytes(&files["s2"]), 130);

        // A refused refetch of a source keeps the copy it would have replaced.
        let again = admit_copy(&mut files, "s1", "/src/a", copy("a2", 90, 5, Some("/src/a")), quota);
        assert!(again.outcome.is_err() && again.removed.is_empty());
        assert!(files["s1"].iter().any(|file| file.id == "a"));

        // A refusal for a session with nothing yet does not create an empty entry.
        let fresh = admit_copy(&mut files, "s9", "/src/z", copy("z", 60, 6, Some("/src/z")), quota);
        assert!(fresh.outcome.is_err());
        assert!(!files.contains_key("s9"));
    }

    #[test]
    fn revocation_removes_tokens_so_they_never_return() {
        let target = parse_loopback_url("http://localhost:3000").unwrap();
        let device = Caller::Device("d1".into());
        let mut registry = Registry::default();
        let admin_token = registry.open("s1", &Caller::Admin, &target, 100);
        let device_token = registry.open("s1", &device, &target, 100);
        let other_device_token = registry.open("s1", &Caller::Device("d2".into()), &target, 100);
        let other_session_token = registry.open("s2", &device, &target, 100);

        registry.revoke_session_devices("s1");
        assert!(registry.lookup(&device_token, 101).is_none() && registry.lookup(&other_device_token, 101).is_none());
        assert!(registry.lookup(&admin_token, 101).is_some() && registry.lookup(&other_session_token, 101).is_some());

        let again = registry.open("s1", &device, &target, 102);
        assert_ne!(again, device_token, "a new link, never the revoked one");
        registry.revoke_device("d1");
        assert!(registry.lookup(&again, 103).is_none() && registry.lookup(&other_session_token, 103).is_none());

        assert!(!registry.revoke_token(&admin_token, "s1", &device), "only the opener may end a token");
        assert!(!registry.revoke_token(&admin_token, "s2", &Caller::Admin));
        assert!(registry.revoke_token(&admin_token, "s1", &Caller::Admin));
        let token = registry.open("s3", &Caller::Admin, &target, 200);
        registry.revoke_session("s3");
        assert!(registry.lookup(&token, 201).is_none());
        let kept = registry.open("s4", &Caller::Admin, &target, 300);
        registry.revoke_all();
        assert!(registry.lookup(&kept, 301).is_none());
    }

    #[test]
    fn bridge_links_name_their_token() {
        assert_eq!(token_in_path("/bridge/abc/app?x=1"), Some("abc"));
        assert_eq!(token_in_path("/bridge/abc"), Some("abc"));
        assert_eq!(token_in_path("/bridge/"), None);
        assert_eq!(token_in_path("/other/abc"), None);
    }

    #[test]
    fn html_root_relative_urls_are_prefixed_once() {
        let html = r#"<html><head><link href="/style.css"><script src='/app.js'></script></head><body><a href="/about">x</a><a href="//cdn.example/x.js">y</a><img src="rel.png"><a href="/bridge/abc/done">z</a><div style="background:url(/bg.png)"></div></body></html>"#;
        let output = rewrite_html(html, PREFIX, 3000);
        assert!(output.contains(r#"href="/bridge/abc/style.css""#));
        assert!(output.contains(r#"src='/bridge/abc/app.js'"#));
        assert!(output.contains(r#"href="/bridge/abc/about""#));
        assert!(output.contains(r#"href="//cdn.example/x.js""#));
        assert!(output.contains(r#"src="rel.png""#));
        assert!(output.contains(r#"href="/bridge/abc/done""#));
        assert!(output.contains("url(/bridge/abc/bg.png)"));
        assert!(output.find("<script>// Injected").unwrap() < output.find("<link").unwrap(), "shim comes first in <head>");
        assert_eq!(rewrite_html(&output, PREFIX, 3000).matches("/bridge/abc/bridge/abc").count(), 0);
    }

    #[test]
    fn html_without_head_still_gets_the_shim_after_doctype_free_prefix() {
        let output = rewrite_html("<p>hi</p>", PREFIX, 3000);
        assert!(output.starts_with("<script>") && output.ends_with("<p>hi</p>"));
        let with_html = rewrite_html("<!doctype html><html lang=en><body></body></html>", PREFIX, 3000);
        assert!(with_html.starts_with("<!doctype html><html lang=en><script>"));
    }

    #[test]
    fn css_and_script_imports_are_prefixed() {
        let css = rewrite_css(r#"@import "/base.css"; a{background:url('/x.png')} b{background:url(data:image/png;base64,AAA)}"#, PREFIX, 3000);
        assert!(css.contains(r#"@import "/bridge/abc/base.css""#));
        assert!(css.contains("url('/bridge/abc/x.png')"));
        assert!(css.contains("url(data:image/png"));
        let script = rewrite_script(
            r#"import a from "/src/a.js"; import"/side.js"; const m = import('/lazy.js'); Array.from("/not"); import b from "./rel.js";"#,
            PREFIX,
            3000,
        );
        assert!(script.contains(r#"from "/bridge/abc/src/a.js""#));
        assert!(script.contains(r#"import"/bridge/abc/side.js""#));
        assert!(script.contains("import('/bridge/abc/lazy.js')"));
        assert!(script.contains(r#"Array.from("/not")"#));
        assert!(script.contains(r#"from "./rel.js""#));
    }

    #[test]
    fn rewriting_keeps_multibyte_text_intact() {
        let output = rewrite_html("<p>héllo ✓</p><a href=\"/ü\">日本語</a>", PREFIX, 3000);
        assert!(output.contains("héllo ✓") && output.contains("日本語") && output.contains("/bridge/abc/ü"));
    }

    #[test]
    fn redirects_stay_inside_the_bridge_across_loopback_names() {
        let port = 3000;
        for (location, expected) in [
            ("http://localhost:3000/login", "/bridge/abc/login"),
            ("http://127.0.0.1:3000/login?next=/", "/bridge/abc/login?next=/"),
            ("http://[::1]:3000/", "/bridge/abc/"),
            ("http://LOCALHOST:3000", "/bridge/abc/"),
            ("//localhost:3000/login", "/bridge/abc/login"),
            ("//127.0.0.1:3000/x", "/bridge/abc/x"),
            ("/login?next=/", "/bridge/abc/login?next=/"),
            ("/bridge/abc/login", "/bridge/abc/login"),
            ("?page=2", "?page=2"),
            ("next", "next"),
            ("http://localhost:30001/x", "http://localhost:30001/x"),
            ("http://127.0.0.1:4000/x", "http://127.0.0.1:4000/x"),
            ("https://example.com/", "https://example.com/"),
            ("//cdn.example/x.js", "//cdn.example/x.js"),
        ] {
            assert_eq!(rewrite_location(location, port, PREFIX), expected, "{location}");
        }
    }
}
