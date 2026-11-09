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
use tokio::fs;
use uuid::Uuid;

use crate::{ApiError, ApiResult, AppState, TempFile};

/// An endpoint token stays valid this long after its last request.
const ENDPOINT_IDLE_SECS: u64 = 2 * 60 * 60;
const MAX_ENDPOINTS_PER_SESSION: usize = 16;
/// HTML, CSS and JavaScript larger than this are refused rather than rewritten.
const MAX_REWRITE_BYTES: usize = 5 * 1024 * 1024;
const MAX_REQUEST_BYTES: usize = 50 * 1024 * 1024;
const UPSTREAM_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_REFERENCE_CHARS: usize = 1024;

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
    expires_at: u64,
}

#[derive(Default)]
pub struct Registry {
    endpoints: HashMap<String, Endpoint>,
}

impl Registry {
    /// Reuse a live token for the same target, otherwise mint one.
    fn open(&mut self, session_id: &str, caller: &Caller, target: &Target, now: u64) -> String {
        self.endpoints.retain(|_, endpoint| endpoint.expires_at > now);
        let existing = self.endpoints.iter_mut().find(|(_, endpoint)| {
            endpoint.session_id == session_id && &endpoint.caller == caller && endpoint.origin == target.origin
        });
        if let Some((token, endpoint)) = existing {
            endpoint.expires_at = now + ENDPOINT_IDLE_SECS;
            return token.clone();
        }
        self.evict_oldest(session_id);
        let token = Uuid::new_v4().simple().to_string() + &Uuid::new_v4().simple().to_string();
        self.endpoints.insert(
            token.clone(),
            Endpoint {
                session_id: session_id.to_string(),
                caller: caller.clone(),
                origin: target.origin.clone(),
                host_header: target.host_header.clone(),
                connect_authority: target.connect_authority.clone(),
                expires_at: now + ENDPOINT_IDLE_SECS,
            },
        );
        token
    }

    fn evict_oldest(&mut self, session_id: &str) {
        loop {
            let mut mine: Vec<(&String, u64)> = self
                .endpoints
                .iter()
                .filter(|(_, endpoint)| endpoint.session_id == session_id)
                .map(|(token, endpoint)| (token, endpoint.expires_at))
                .collect();
            if mine.len() < MAX_ENDPOINTS_PER_SESSION {
                return;
            }
            mine.sort_by_key(|(_, expires_at)| *expires_at);
            let oldest = mine[0].0.clone();
            self.endpoints.remove(&oldest);
        }
    }

    /// Look the token up and slide its expiry forward.
    fn touch(&mut self, token: &str, now: u64) -> Option<Endpoint> {
        let endpoint = self.endpoints.get_mut(token)?;
        if endpoint.expires_at <= now {
            self.endpoints.remove(token);
            return None;
        }
        endpoint.expires_at = now + ENDPOINT_IDLE_SECS;
        Some(endpoint.clone())
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

const SENSITIVE_FOLDERS: [&str; 6] = [".ssh", ".gnupg", ".aws", ".kube", ".azure", ".docker"];
const SENSITIVE_NAME_PREFIXES: [&str; 8] = [".env", ".netrc", ".npmrc", ".pypirc", "id_rsa", "id_ed25519", "id_ecdsa", "id_dsa"];
const SENSITIVE_EXTENSIONS: [&str; 6] = [".pem", ".key", ".p12", ".pfx", ".kdbx", ".keystore"];

/// Whether a canonical path lies inside one of the canonical roots a bridge may read from.
pub fn is_within_roots(path: &FsPath, allowed_roots: &[PathBuf]) -> bool {
    allowed_roots.iter().any(|root| path.starts_with(root))
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
    let in_pi_agent = parts.windows(2).any(|pair| pair[0] == ".pi" && pair[1] == "agent");
    let in_gcloud = parts.windows(2).any(|pair| pair[0] == ".config" && pair[1] == "gcloud");
    if in_pi_agent || in_gcloud {
        return true;
    }
    let name = parts.last().map(String::as_str).unwrap_or_default();
    let secret_name = SENSITIVE_NAME_PREFIXES.iter().any(|prefix| name.starts_with(prefix));
    let secret_extension = SENSITIVE_EXTENSIONS.iter().any(|extension| name.ends_with(extension));
    secret_name || secret_extension
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
    if !state.sessions.read().await.contains_key(session_id) {
        return Err((StatusCode::NOT_FOUND, "Session not found.".into()));
    }
    Ok(())
}

pub async fn fetch_file_local(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    Json(request): Json<FileRequest>,
) -> ApiResult<Json<TempFile>> {
    bridge_file(&state, &session_id, &request.reference).await.map(Json)
}

pub async fn fetch_file_remote(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    headers: HeaderMap,
    Json(request): Json<FileRequest>,
) -> ApiResult<Json<TempFile>> {
    crate::authorize_device(&state, crate::bearer_token(&headers)?).await?;
    crate::require_remote_session(&state, &session_id).await?;
    bridge_file(&state, &session_id, &request.reference).await.map(Json)
}

pub async fn open_endpoint_local(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    Json(request): Json<EndpointRequest>,
) -> ApiResult<Json<Value>> {
    open_endpoint(&state, &session_id, &request.url, Caller::Admin).await.map(Json)
}

pub async fn open_endpoint_remote(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    headers: HeaderMap,
    Json(request): Json<EndpointRequest>,
) -> ApiResult<Json<Value>> {
    let device_id = crate::authorize_device(&state, crate::bearer_token(&headers)?).await?;
    crate::require_remote_session(&state, &session_id).await?;
    open_endpoint(&state, &session_id, &request.url, Caller::Device(device_id)).await.map(Json)
}

/// Copy a file the agent mentioned into the session sandbox so it can be previewed/downloaded.
async fn bridge_file(state: &AppState, session_id: &str, reference: &str) -> ApiResult<TempFile> {
    ensure_bridgeable_session(state, session_id).await?;
    let cwd = session_cwd(state, session_id).await?;
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from);
    let requested = resolve_reference(reference, &cwd, home.as_deref())
        .ok_or_else(|| bad_request("That is not a file path or file:// link."))?;

    let mentioned = {
        let activity = state.activity.read().await;
        activity.mentions(session_id, reference.trim()) || activity.mentions(session_id, &requested.to_string_lossy())
    };
    if !mentioned {
        return Err((StatusCode::FORBIDDEN, "Only files the agent mentioned in this session can be fetched.".into()));
    }

    let not_found = || (StatusCode::NOT_FOUND, "That file was not found on the computer running Pi.".to_string());
    let canonical = fs::canonicalize(&requested).await.map_err(|_| not_found())?;
    let metadata = fs::metadata(&canonical).await.map_err(|_| not_found())?;
    if !metadata.is_file() {
        return Err(bad_request("Only regular files can be fetched, not folders."));
    }
    let allowed_roots = vec![
        fs::canonicalize(&cwd).await.map_err(|_| not_found())?,
        fs::canonicalize(&state.temp_root).await.unwrap_or_else(|_| state.temp_root.clone()),
    ];
    if !is_within_roots(&canonical, &allowed_roots) {
        return Err((
            StatusCode::FORBIDDEN,
            "Only files inside the session's working directory or the shared Companion temp folder can be fetched.".into(),
        ));
    }
    let data_root = fs::canonicalize(&state.data_dir).await.unwrap_or_else(|_| state.data_dir.clone());
    if is_sensitive_path(&canonical, &[data_root]) {
        return Err((StatusCode::FORBIDDEN, "That location looks like it holds credentials, so it is never bridged.".into()));
    }

    let settings = state.settings.read().await.clone();
    let max_bytes = settings.max_upload_mb * 1024 * 1024;
    if metadata.len() > max_bytes {
        return Err((StatusCode::PAYLOAD_TOO_LARGE, format!("File is larger than the {} MiB limit.", settings.max_upload_mb)));
    }
    let name = crate::safe_file_name(&canonical.file_name().map(|name| name.to_string_lossy().to_string()).unwrap_or_default());
    let mime = crate::upload_mime(&settings, &name, None)?;

    let session_dir = state.temp_root.join(session_id);
    fs::create_dir_all(&session_dir).await.map_err(crate::internal_error)?;
    crate::set_private_dir_permissions(&session_dir).await;
    let id = Uuid::new_v4().to_string();
    let disk_path = session_dir.join(format!("{id}-{name}"));
    if let Err(error) = fs::copy(&canonical, &disk_path).await {
        let _ = fs::remove_file(&disk_path).await;
        return Err(crate::internal_error(error));
    }

    let origin = canonical.to_string_lossy().to_string();
    let file = TempFile {
        source: "agent".into(),
        id,
        name,
        path: disk_path.to_string_lossy().to_string(),
        size: metadata.len(),
        mime,
        created_at: crate::now_secs(),
        origin: Some(origin.clone()),
    };
    let replaced = replace_previous_copies(state, session_id, &origin, file.clone()).await;
    for old_path in replaced {
        let _ = fs::remove_file(old_path).await;
    }
    crate::notify_session_files(state, session_id).await;
    Ok(file)
}

/// Fetching the same source again refreshes the copy instead of piling up duplicates.
async fn replace_previous_copies(state: &AppState, session_id: &str, origin: &str, file: TempFile) -> Vec<String> {
    let mut files = state.files.write().await;
    let list = files.entry(session_id.to_string()).or_default();
    let mut replaced = Vec::new();
    list.retain(|existing| {
        let same_source = existing.origin.as_deref() == Some(origin);
        if same_source {
            replaced.push(existing.path.clone());
        }
        !same_source
    });
    list.push(file);
    replaced
}

async fn session_cwd(state: &AppState, session_id: &str) -> ApiResult<PathBuf> {
    let sessions = state.sessions.read().await;
    let session = sessions.get(session_id).ok_or((StatusCode::NOT_FOUND, "Session not found.".to_string()))?;
    let cwd = session.snapshot.get("cwd").and_then(Value::as_str).unwrap_or("/");
    Ok(PathBuf::from(cwd))
}

async fn open_endpoint(state: &AppState, session_id: &str, url: &str, caller: Caller) -> ApiResult<Value> {
    ensure_bridgeable_session(state, session_id).await?;
    let target = parse_loopback_url(url).map_err(bad_request)?;
    let mentioned = state.activity.read().await.mentions(session_id, &target.origin);
    if !mentioned {
        return Err((StatusCode::FORBIDDEN, "Only servers the agent mentioned in this session can be bridged.".into()));
    }
    let now = crate::now_secs();
    let token = state.bridge.lock().await.open(session_id, &caller, &target, now);
    Ok(json!({
        "origin": target.origin,
        "path": format!("/bridge/{token}{}", target.path_and_query),
        "expiresAt": now + ENDPOINT_IDLE_SECS,
    }))
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
    let endpoint = state.bridge.lock().await.touch(token, crate::now_secs()).ok_or(expired.clone())?;
    if !state.sessions.read().await.contains_key(&endpoint.session_id) {
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

    let unreachable = || (StatusCode::BAD_GATEWAY, format!("Could not reach {}. Is the server still running?", endpoint.origin));
    let sent = tokio::time::timeout(UPSTREAM_TIMEOUT, state.bridge_client.request(upstream_request)).await;
    let upstream = sent
        .map_err(|_| (StatusCode::GATEWAY_TIMEOUT, format!("{} did not answer in time.", endpoint.origin)))?
        .map_err(|error| {
            tracing::debug!("bridge upstream failed: {error}");
            unreachable()
        })?;
    build_response(upstream, &endpoint, &prefix).await
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
) -> ApiResult<Response> {
    let (parts, incoming) = upstream.into_parts();
    let rewrite = rewrite_kind(&parts.headers);
    let mut response_headers = HeaderMap::new();
    for (name, value) in &parts.headers {
        if !FORWARDED_RESPONSE_HEADERS.contains(&name.as_str()) {
            continue;
        }
        if name == header::LOCATION {
            let location = value.to_str().ok().map(|location| rewrite_location(location, &endpoint.origin, prefix));
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
        Some(kind) => rewritten_body(incoming, kind, prefix, &endpoint.origin).await?,
        None => Body::new(incoming),
    };
    let mut response = Response::new(body);
    *response.status_mut() = parts.status;
    *response.headers_mut() = response_headers;
    Ok(response)
}

async fn rewritten_body(
    incoming: hyper::body::Incoming,
    kind: Rewrite,
    prefix: &str,
    origin: &str,
) -> ApiResult<Body> {
    let too_large = || (StatusCode::BAD_GATEWAY, format!("{origin} sent a page too large to bridge (over 5 MiB)."));
    let collected = Limited::new(incoming, MAX_REWRITE_BYTES).collect().await.map_err(|_| too_large())?;
    let bytes = collected.to_bytes();
    // Anything that is not UTF-8 text is passed through untouched rather than corrupted.
    let Ok(text) = String::from_utf8(bytes.to_vec()) else {
        return Ok(Body::from(bytes));
    };
    let rewritten = match kind {
        Rewrite::Html => rewrite_html(&text, prefix),
        Rewrite::Css => rewrite_css(&text, prefix),
        Rewrite::Script => rewrite_script(&text, prefix),
    };
    Ok(Body::from(rewritten))
}

/// Keep redirects inside the bridge: same-server absolute and root-relative locations get the
/// token prefix; anything else is left to the browser.
pub fn rewrite_location(location: &str, origin: &str, prefix: &str) -> String {
    if let Some(rest) = location.strip_prefix(origin) {
        if rest.is_empty() || rest.starts_with(['/', '?']) {
            let rest = if rest.starts_with('/') { rest.to_string() } else { format!("/{rest}") };
            return format!("{prefix}{rest}");
        }
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
// These helpers prefix such URLs. They are heuristics for common dev-server output, not a parser.
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

/// Index of the `/` that starts a root-relative URL right after `marker`, if there is one.
fn root_after_marker(bytes: &[u8], index: usize, marker: &Marker, prefix: &str) -> Option<usize> {
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
    let is_root = bytes.get(cursor) == Some(&b'/') && bytes.get(cursor + 1) != Some(&b'/');
    let already_prefixed = bytes[cursor.min(bytes.len())..].starts_with(prefix.as_bytes());
    if is_root && !already_prefixed { Some(cursor) } else { None }
}

fn prefix_root_urls(source: &str, markers: &[Marker], prefix: &str) -> String {
    let bytes = source.as_bytes();
    let mut output = String::with_capacity(source.len() + 256);
    let mut copied = 0;
    let mut index = 0;
    while index < bytes.len() {
        let root = markers.iter().find_map(|marker| root_after_marker(bytes, index, marker, prefix));
        match root {
            Some(root_index) => {
                output.push_str(&source[copied..root_index]);
                output.push_str(prefix);
                copied = root_index;
                index = root_index + 1;
            }
            None => index += 1,
        }
    }
    output.push_str(&source[copied..]);
    output
}

pub fn rewrite_css(css: &str, prefix: &str) -> String {
    prefix_root_urls(css, &CSS_MARKERS, prefix)
}

pub fn rewrite_script(script: &str, prefix: &str) -> String {
    prefix_root_urls(script, &SCRIPT_MARKERS, prefix)
}

/// Prefix root-relative attributes, then add the request shim as early as possible.
pub fn rewrite_html(html: &str, prefix: &str) -> String {
    let rewritten = prefix_root_urls(html, &HTML_MARKERS, prefix);
    let shim = request_shim(prefix);
    let lowered = rewritten.to_ascii_lowercase();
    for opening in ["<head", "<html"] {
        let Some(start) = lowered.find(opening) else { continue };
        let Some(close) = lowered[start..].find('>') else { continue };
        let insert_at = start + close + 1;
        return format!("{}{shim}{}", &rewritten[..insert_at], &rewritten[insert_at..]);
    }
    format!("{shim}{rewritten}")
}

/// Pages call `fetch("/api")` at runtime; send those through the bridge as well. WebSockets are
/// not proxied.
fn request_shim(prefix: &str) -> String {
    format!(
        "<script>(function(){{var P={prefix:?};\
function f(u){{return typeof u==='string'&&u.charCodeAt(0)===47&&u.charCodeAt(1)!==47&&u.indexOf(P+'/')!==0?P+u:u}}\
var F=window.fetch;if(F){{window.fetch=function(i,o){{return F.call(this,f(i),o)}}}}\
var X=window.XMLHttpRequest&&XMLHttpRequest.prototype.open;\
if(X){{XMLHttpRequest.prototype.open=function(m,u){{arguments[1]=f(String(u));return X.apply(this,arguments)}}}}\
var E=window.EventSource;if(E){{window.EventSource=function(u,o){{return new E(f(String(u)),o)}};window.EventSource.prototype=E.prototype}}\
}})();</script>"
    )
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
        ] {
            assert!(is_sensitive_path(FsPath::new(sensitive), &roots), "{sensitive} must be sensitive");
        }
        for fine in ["/tmp/report.html", "/work/app/docs/environment.md", "/home/me/.config/app/settings.json"] {
            assert!(!is_sensitive_path(FsPath::new(fine), &roots), "{fine} must be allowed");
        }
    }

    #[test]
    fn only_the_working_directory_and_temp_folder_are_in_scope() {
        let roots = vec![PathBuf::from("/work/app"), PathBuf::from("/tmp/pi-companion")];
        for inside in ["/work/app/docs/a.md", "/tmp/pi-companion/s1/id-report.html"] {
            assert!(is_within_roots(FsPath::new(inside), &roots), "{inside} must be in scope");
        }
        // Prefix matching is per path component: /work/app-secrets is not inside /work/app.
        for outside in ["/work/app-secrets/a.md", "/work/other/a.md", "/tmp/other.html", "/etc/hosts", "/home/me/notes.txt"] {
            assert!(!is_within_roots(FsPath::new(outside), &roots), "{outside} must be out of scope");
        }
    }

    #[test]
    fn registry_reuses_expires_and_caps_tokens() {
        let target = parse_loopback_url("http://localhost:3000").unwrap();
        let mut registry = Registry::default();
        let first = registry.open("s1", &Caller::Admin, &target, 100);
        assert_eq!(registry.open("s1", &Caller::Admin, &target, 200), first);
        assert_ne!(registry.open("s1", &Caller::Device("d".into()), &target, 200), first);
        assert!(registry.touch(&first, 200 + ENDPOINT_IDLE_SECS - 1).is_some());
        assert!(registry.touch(&first, 200 + 2 * ENDPOINT_IDLE_SECS).is_none());
        for port in 4000..4000 + MAX_ENDPOINTS_PER_SESSION as u16 + 5 {
            let other = parse_loopback_url(&format!("http://localhost:{port}")).unwrap();
            registry.open("s2", &Caller::Admin, &other, 1_000_000);
        }
        let count = registry.endpoints.values().filter(|endpoint| endpoint.session_id == "s2").count();
        assert_eq!(count, MAX_ENDPOINTS_PER_SESSION);
    }

    #[test]
    fn html_root_relative_urls_are_prefixed_once() {
        let html = r#"<html><head><link href="/style.css"><script src='/app.js'></script></head><body><a href="/about">x</a><a href="//cdn.example/x.js">y</a><img src="rel.png"><a href="/bridge/abc/done">z</a><div style="background:url(/bg.png)"></div></body></html>"#;
        let output = rewrite_html(html, PREFIX);
        assert!(output.contains(r#"href="/bridge/abc/style.css""#));
        assert!(output.contains(r#"src='/bridge/abc/app.js'"#));
        assert!(output.contains(r#"href="/bridge/abc/about""#));
        assert!(output.contains(r#"href="//cdn.example/x.js""#));
        assert!(output.contains(r#"src="rel.png""#));
        assert!(output.contains(r#"href="/bridge/abc/done""#));
        assert!(output.contains("url(/bridge/abc/bg.png)"));
        assert!(output.find("<script>(function(){").unwrap() < output.find("<link").unwrap(), "shim comes first in <head>");
        assert_eq!(rewrite_html(&output, PREFIX).matches("/bridge/abc/bridge/abc").count(), 0);
    }

    #[test]
    fn html_without_head_still_gets_the_shim_after_doctype_free_prefix() {
        let output = rewrite_html("<p>hi</p>", PREFIX);
        assert!(output.starts_with("<script>") && output.ends_with("<p>hi</p>"));
        let with_html = rewrite_html("<!doctype html><html lang=en><body></body></html>", PREFIX);
        assert!(with_html.starts_with("<!doctype html><html lang=en><script>"));
    }

    #[test]
    fn css_and_script_imports_are_prefixed() {
        let css = rewrite_css(r#"@import "/base.css"; a{background:url('/x.png')} b{background:url(data:image/png;base64,AAA)}"#, PREFIX);
        assert!(css.contains(r#"@import "/bridge/abc/base.css""#));
        assert!(css.contains("url('/bridge/abc/x.png')"));
        assert!(css.contains("url(data:image/png"));
        let script = rewrite_script(
            r#"import a from "/src/a.js"; import"/side.js"; const m = import('/lazy.js'); Array.from("/not"); import b from "./rel.js";"#,
            PREFIX,
        );
        assert!(script.contains(r#"from "/bridge/abc/src/a.js""#));
        assert!(script.contains(r#"import"/bridge/abc/side.js""#));
        assert!(script.contains("import('/bridge/abc/lazy.js')"));
        assert!(script.contains(r#"Array.from("/not")"#));
        assert!(script.contains(r#"from "./rel.js""#));
    }

    #[test]
    fn rewriting_keeps_multibyte_text_intact() {
        let output = rewrite_html("<p>héllo ✓</p><a href=\"/ü\">日本語</a>", PREFIX);
        assert!(output.contains("héllo ✓") && output.contains("日本語") && output.contains("/bridge/abc/ü"));
    }

    #[test]
    fn redirects_stay_inside_the_bridge() {
        let origin = "http://localhost:3000";
        assert_eq!(rewrite_location("http://localhost:3000/login", origin, PREFIX), "/bridge/abc/login");
        assert_eq!(rewrite_location("http://localhost:3000", origin, PREFIX), "/bridge/abc/");
        assert_eq!(rewrite_location("/login?next=/", origin, PREFIX), "/bridge/abc/login?next=/");
        assert_eq!(rewrite_location("/bridge/abc/login", origin, PREFIX), "/bridge/abc/login");
        assert_eq!(rewrite_location("http://localhost:30001/x", origin, PREFIX), "http://localhost:30001/x");
        assert_eq!(rewrite_location("https://example.com/", origin, PREFIX), "https://example.com/");
    }
}
