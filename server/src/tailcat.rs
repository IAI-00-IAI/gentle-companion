//! Manages the tailcat tunnel server that exposes the device surface.
//!
//! When enabled, the daemon spawns `tailcat serve <port> --json` as a child
//! process and captures the tailcat address from stdout. The address is used
//! by the UI to display the tunnel endpoint for phone clients.

use std::time::Duration;

use tokio::io::AsyncBufReadExt;
use tokio::process::Command;
use tracing::debug;

/// Errors that can occur while managing the tailcat tunnel.
#[derive(Debug)]
pub enum TailcatError {
    NotFound(String),
    Spawn(String),
    AddressTimeout,
    ReadAddress(String),
    AlreadyRunning,
    NotRunning,
}

impl std::fmt::Display for TailcatError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TailcatError::NotFound(s) => write!(f, "tailcat binary not found: {s}"),
            TailcatError::Spawn(s) => write!(f, "failed to spawn tailcat: {s}"),
            TailcatError::AddressTimeout => write!(f, "timeout waiting for tailcat address"),
            TailcatError::ReadAddress(s) => write!(f, "failed to read tailcat address: {s}"),
            TailcatError::AlreadyRunning => write!(f, "process already running"),
            TailcatError::NotRunning => write!(f, "process not running"),
        }
    }
}

impl std::error::Error for TailcatError {}

/// Manages a tailcat tunnel server process.
/// Status of the tailcat tunnel, exposed to the UI as a live indicator.
#[derive(Clone, Debug, PartialEq)]
pub struct TailcatStatus {
    pub enabled: bool,
    pub running: bool,
    pub address: String,
    pub port: u16,
    pub error: String,
}

/// Manages a tailcat tunnel server process.
#[derive(Debug)]
#[must_use]
pub struct TailcatManager {
    child: Option<tokio::process::Child>,
    address: String,
    port: u16,
    running: bool,
    error: String,
}

impl TailcatManager {
    pub fn new() -> Self {
        Self {
            child: None,
            address: String::new(),
            port: 0,
            running: false,
            error: String::new(),
        }
    }

    /// Current status for the UI indicator.
    pub fn status(&self, enabled: bool) -> TailcatStatus {
        TailcatStatus {
            enabled,
            running: self.running,
            address: self.address.clone(),
            port: self.port,
            error: self.error.clone(),
        }
    }

    /// Start the tailcat server on the given port. Returns the tailcat address.
    /// On failure the spawned child is killed and the error is recorded in `self.error`.
    pub async fn start(&mut self, port: u16) -> Result<String, TailcatError> {
        if self.running {
            return Err(TailcatError::AlreadyRunning);
        }
        self.error.clear();

        let hint = tailcat_install_hint().to_string();
        let tailcat_bin = find_tailcat_bin()
            .ok_or_else(|| TailcatError::NotFound(hint))
            ?;

        debug!(tailcat_bin = ?tailcat_bin, "starting tailcat server");

        let mut output = Command::new(&tailcat_bin)
            .args(["serve", &port.to_string(), "--json"])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::inherit())
            .spawn()
            .map_err(|e| TailcatError::Spawn(e.to_string()))?;

        // Read the JSON address from stdout.
        let stdout = output.stdout.take().unwrap();
        let mut line_buf = tokio::io::BufReader::new(stdout);
        let mut line = String::new();
        let timeout = Duration::from_secs(10);
        let address = tokio::time::timeout(timeout, async move {
            loop {
                line.clear();
                let bytes = line_buf
                    .read_line(&mut line)
                    .await
                    .map_err(|e| TailcatError::ReadAddress(e.to_string()))?;
                if bytes == 0 {
                    return Err(TailcatError::AddressTimeout);
                }
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) {
                    if let Some(addr) = json.get("listenAddr").and_then(|v| v.as_str()) {
                        return Ok(addr.to_string());
                    }
                }
            }
        })
        .await;

        match address {
            Ok(inner) => match inner {
                Ok(addr) => {
                    self.child = Some(output);
                    self.address = addr.clone();
                    self.port = port;
                    self.running = true;

                    debug!(address = ?addr, "tailcat server started");
                    Ok(addr)
                }
                Err(err) => {
                    // Address was never read: kill the orphaned child.
                    let _ = output.kill().await;
                    let _ = output.wait().await;
                    self.error = err.to_string();
                    debug!(error = ?err, "tailcat server failed to start");
                    Err(err)
                }
            },
            Err(_) => {
                // Timed out waiting for the address: kill the orphaned child.
                let _ = output.kill().await;
                let _ = output.wait().await;
                self.error = TailcatError::AddressTimeout.to_string();
                debug!("tailcat server failed to start: timeout waiting for address");
                Err(TailcatError::AddressTimeout)
            },
        }
    }

    /// Stop the tailcat server and clear any recorded error.
    pub async fn stop(&mut self) -> Result<(), TailcatError> {
        if !self.running {
            return Err(TailcatError::NotRunning);
        }

        if let Some(mut child) = self.child.take() {
            let _ = child.kill().await.ok();
            let _ = child.wait().await;
            debug!("tailcat tunnel stopped");
        }

        self.address.clear();
        self.error.clear();
        self.running = false;
        Ok(())
    }

    pub fn address(&self) -> &str {
        &self.address
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    pub fn is_running(&self) -> bool {
        self.running
    }


}

/// Find the tailcat binary. Checks PATH first, then the bundled binaries shipped
/// with this repository (`server/tailcat/<arch>`), then common system locations.
/// Name of the bundled tailcat binary for the current OS/arch, or None (no
/// bundled binary for this platform, fall back to PATH). macOS has no bundled
/// binary; the user must install tailcat separately (e.g. `brew install tailcat`).
fn bundled_tailcat_name() -> Option<&'static str> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("linux", "x86_64") => Some("tailcat-amd64"),
        ("linux", "aarch64") => Some("tailcat-arm64"),
        ("linux", "arm") => Some("tailcat-armv7"),
        ("windows", "x86_64" | "i686") => Some("tailcat-win-amd64.exe"),
        ("windows", "aarch64" | "arm64") => Some("tailcat-win-arm64.exe"),
        _ => None,
    }
}

/// Install hint for the current platform, used in the error message.
fn tailcat_install_hint() -> &'static str {
    match std::env::consts::OS {
        "linux" => "install tailcat from https://github.com/tailscale/tailcat/releases or copy the binary to a PATH directory",
        "macos" => "brew install tailcat",
        "windows" => "download tailcat-<version>_windows_<arch>.zip from https://github.com/tailscale/tailcat/releases and put tailcat.exe on PATH",
        _ => "see https://github.com/tailscale/tailcat for a build for your platform",
    }
}

fn find_tailcat_bin() -> Option<String> {
    // 1) System PATH: `which` on Unix, `PATH`/`where` on Windows.
    #[cfg(unix)]
    if let Ok(output) = std::process::Command::new("which").arg("tailcat").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Some(path);
            }
        }
    }
    #[cfg(windows)]
    {
        if let Some(path) = std::env::var("PATH").ok() {
            for dir in path.split(':') {
                let candidate = std::path::Path::new(dir).join("tailcat.exe");
                if candidate.exists() {
                    return Some(candidate.to_string_lossy().into());
                }
            }
        }
        if let Ok(output) = std::process::Command::new("where").arg("tailcat.exe").output() {
            if output.status.success() {
                let text = String::from_utf8_lossy(&output.stdout);
                if let Some(first) = text.lines().next() {
                    let first = first.trim();
                    if !first.is_empty() {
                        return Some(first.to_string());
                    }
                }
            }
        }
    }

    let cwd = std::env::current_dir().ok();
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();

    if let Some(cwd) = &cwd {
        // Generic names first (dev/test: a binary named `tailcat` in cwd or
        // bin/). These win over the bundled binary, so a local override is
        // honored and the test's fake binary in cwd/ is found.
        candidates.push(cwd.join("tailcat"));
        candidates.push(cwd.join("bin").join("tailcat"));

        // Bundled third-party binaries: pick the one matching this daemon's
        // OS/arch, searched from the repo root or the server directory (covers
        // `cargo run` from either location).
        if let Some(name) = bundled_tailcat_name() {
            candidates.push(cwd.join("vendor").join("tailcat").join(name));
            candidates.push(cwd.join("server").join("vendor").join("tailcat").join(name));
        }
        // Fallback generic names in the server dir.
        candidates.push(cwd.join("server").join("tailcat"));
    }

    // Common system locations (Unix only).
    #[cfg(unix)]
    {
        candidates.push(std::path::PathBuf::from("/usr/local/bin/tailcat"));
        candidates.push(std::path::PathBuf::from("/usr/bin/tailcat"));
    }
    #[cfg(windows)]
    {
        if let Some(dir) = std::env::var("ProgramFiles").ok() {
            candidates.push(std::path::Path::new(&dir).join("tailcat.exe"));
        }
    }

    for candidate in candidates {
        if candidate.exists() {
            return Some(candidate.to_string_lossy().into());
        }
    }
    None
}
