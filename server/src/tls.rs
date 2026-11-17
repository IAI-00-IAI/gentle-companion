//! Opt-in TLS for the LAN-facing device surface.
//!
//! The client is served over plain HTTP by default. Browsers only expose a secure
//! context (service workers, the Cache API, installable web apps) over HTTPS, so a
//! phone opening the daemon by LAN IP can only "install this web page", not the app.
//!
//! Enabling TLS here fixes that without touching the tunnel: `tailcat serve` always
//! forwards tunneled connections to `127.0.0.1:<port>` as PLAIN HTTP, so the loopback
//! mirror listener (`tunnel_loopback_bind`) must never be wrapped in TLS. Only the
//! LAN-facing listener is.
//!
//! Configuration is explicit; with nothing set the daemon behaves exactly as before:
//!
//! - `PI_COMPANION_TLS_CERT` + `PI_COMPANION_TLS_KEY`: serve HTTPS with that PEM pair.
//! - `PI_COMPANION_TLS_SELF_SIGNED=1`: generate (once) and reuse a self-signed
//!   certificate under `<companion home>/tls/`, printing its fingerprint so the phone
//!   can trust it.

use std::path::{Path, PathBuf};

/// How the device surface should serve traffic.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TlsMode {
    /// Plain HTTP (the default, and the only mode before this feature existed).
    Off,
    /// Serve HTTPS from an explicit PEM certificate and key.
    Files { cert: PathBuf, key: PathBuf },
    /// Serve HTTPS from a self-signed certificate generated into `dir` on first use.
    SelfSigned { dir: PathBuf },
}

/// Reads the TLS configuration from the environment.
///
/// Returns an error naming the missing variable when only one of the cert/key pair is
/// set: silently falling back to HTTP would leave the user believing TLS is on.
/// Resolve the mode, honouring the persisted switch as well as the environment.
///
/// Precedence: an explicit certificate pair, then the persisted setting, then the
/// environment variable. The setting comes before the env var because the supervisor
/// rewrites the service environment on every upgrade.
pub fn resolve_mode(settings_self_signed: bool) -> Result<TlsMode, String> {
    mode_from(
        std::env::var("PI_COMPANION_TLS_CERT").ok(),
        std::env::var("PI_COMPANION_TLS_KEY").ok(),
        if settings_self_signed { Some("1".to_string()) } else { std::env::var("PI_COMPANION_TLS_SELF_SIGNED").ok() },
        default_tls_dir(),
    )
}

pub fn mode_from_env() -> Result<TlsMode, String> {
    mode_from(
        std::env::var("PI_COMPANION_TLS_CERT").ok(),
        std::env::var("PI_COMPANION_TLS_KEY").ok(),
        std::env::var("PI_COMPANION_TLS_SELF_SIGNED").ok(),
        default_tls_dir(),
    )
}

/// Testable form of [`mode_from_env`].
pub fn mode_from(
    cert: Option<String>,
    key: Option<String>,
    self_signed: Option<String>,
    dir: PathBuf,
) -> Result<TlsMode, String> {
    match (cert, key) {
        (Some(cert), Some(key)) => {
            let cert = PathBuf::from(cert);
            let key = PathBuf::from(key);
            if !cert.is_file() {
                return Err(format!(
                    "PI_COMPANION_TLS_CERT points at {} which does not exist",
                    cert.display()
                ));
            }
            if !key.is_file() {
                return Err(format!(
                    "PI_COMPANION_TLS_KEY points at {} which does not exist",
                    key.display()
                ));
            }
            Ok(TlsMode::Files { cert, key })
        }
        (Some(_), None) => Err(
            "PI_COMPANION_TLS_CERT is set but PI_COMPANION_TLS_KEY is missing; set both or neither"
                .to_string(),
        ),
        (None, Some(_)) => Err(
            "PI_COMPANION_TLS_KEY is set but PI_COMPANION_TLS_CERT is missing; set both or neither"
                .to_string(),
        ),
        (None, None) => {
            if truthy(self_signed.as_deref()) {
                Ok(TlsMode::SelfSigned { dir })
            } else {
                Ok(TlsMode::Off)
            }
        }
    }
}

fn truthy(value: Option<&str>) -> bool {
    matches!(
        value.map(|v| v.trim().to_ascii_lowercase()).as_deref(),
        Some("1") | Some("true") | Some("yes") | Some("on")
    )
}

/// `<companion home>/tls`, following the same home precedence as the rest of the daemon.
fn default_tls_dir() -> PathBuf {
    crate::config::data_dir().join("tls")
}

/// The certificate and key paths for a self-signed setup.
pub fn self_signed_paths(dir: &Path) -> (PathBuf, PathBuf) {
    (dir.join("cert.pem"), dir.join("key.pem"))
}

/// Generates a self-signed certificate for the given host names when the pair is absent,
/// and returns the paths either way. Reuses an existing pair so the fingerprint stays
/// stable across restarts (the phone trusts it once).
/// Certificate names for a bind address: the host itself plus loopback.
///
/// A wildcard bind is special. `0.0.0.0` is an instruction to the kernel, not a name a
/// client can dial, so putting it in the certificate produces one that every client
/// rejects for the wrong host — even after the CA is trusted. The wildcard is therefore
/// replaced by this machine's own addresses, which are what a phone actually types.
pub fn host_names_for(bind: &str) -> Vec<String> {
    let host = bind.rsplit_once(':').map(|(host, _)| host).unwrap_or(bind);
    let mut names: Vec<String> = Vec::new();
    let wildcard = matches!(host, "0.0.0.0" | "::" | "[::]" | "");
    if wildcard {
        names.extend(local_ipv4_addresses());
    } else {
        names.push(host.to_string());
    }
    for loopback in ["localhost", "127.0.0.1"] {
        if !names.iter().any(|name| name == loopback) {
            names.push(loopback.to_string());
        }
    }
    names.dedup();
    names
}

/// This machine's non-loopback IPv4 addresses, best effort.
///
/// Uses `getifaddrs` through libc so no new dependency is needed. A failure yields an
/// empty list: the certificate then covers only loopback, which is correct for a daemon
/// bound to loopback and merely degraded for a wildcard bind.
pub fn local_ipv4_addresses() -> Vec<String> {
    let mut addresses = Vec::new();
    // SAFETY: getifaddrs fills a linked list we own and free in the same call; every
    // pointer is checked for null before it is dereferenced.
    unsafe {
        let mut head: *mut libc::ifaddrs = std::ptr::null_mut();
        if libc::getifaddrs(&mut head) != 0 {
            return addresses;
        }
        let mut cursor = head;
        while !cursor.is_null() {
            let entry = &*cursor;
            let addr = entry.ifa_addr;
            if !addr.is_null() && (*addr).sa_family as i32 == libc::AF_INET {
                let sockaddr = addr as *const libc::sockaddr_in;
                let raw = u32::from_be((*sockaddr).sin_addr.s_addr);
                let octets = raw.to_be_bytes();
                let loopback = octets[0] == 127;
                let unspecified = octets == [0, 0, 0, 0];
                if !loopback && !unspecified {
                    let text = format!("{}.{}.{}.{}", octets[0], octets[1], octets[2], octets[3]);
                    if !addresses.contains(&text) {
                        addresses.push(text);
                    }
                }
            }
            cursor = entry.ifa_next;
        }
        libc::freeifaddrs(head);
    }
    addresses
}

pub fn ensure_self_signed(
    dir: &Path,
    host_names: &[String],
) -> Result<(PathBuf, PathBuf, bool), String> {
    let (cert_path, key_path) = self_signed_paths(dir);
    if cert_path.is_file() && key_path.is_file() {
        return Ok((cert_path, key_path, false));
    }
    std::fs::create_dir_all(dir)
        .map_err(|error| format!("cannot create {}: {error}", dir.display()))?;

    let mut params = rcgen::CertificateParams::new(host_names.to_vec())
        .map_err(|error| format!("cannot build certificate parameters: {error}"))?;
    params.distinguished_name.push(
        rcgen::DnType::CommonName,
        host_names.first().cloned().unwrap_or_else(|| "Gentle Companion".to_string()),
    );
    // A year is plenty for a LAN-only certificate the user re-issues on demand.
    params.not_before = rcgen::date_time_ymd(2024, 1, 1);
    params.not_after = rcgen::date_time_ymd(2036, 1, 1);
    // The certificate is installed on a phone as a CA, so it has to be one.
    //
    // `CertificateParams::new` produces a leaf: no basicConstraints, no keyUsage. Chrome
    // tolerates that once the user accepts the warning, but Firefox validates every
    // same-origin fetch against it and rejects the lot — the client cannot even download
    // its own runtime, which reads as "the daemon may be unreachable". Marking it as a CA
    // with the key-cert-sign usage is what makes the same file work in both browsers.
    params.is_ca = rcgen::IsCa::Ca(rcgen::BasicConstraints::Unconstrained);
    params.key_usages = vec![
        rcgen::KeyUsagePurpose::KeyCertSign,
        rcgen::KeyUsagePurpose::CrlSign,
        rcgen::KeyUsagePurpose::DigitalSignature,
    ];

    let key_pair = rcgen::KeyPair::generate()
        .map_err(|error| format!("cannot generate the private key: {error}"))?;
    let cert = params
        .self_signed(&key_pair)
        .map_err(|error| format!("cannot sign the certificate: {error}"))?;

    std::fs::write(&cert_path, cert.pem())
        .map_err(|error| format!("cannot write {}: {error}", cert_path.display()))?;
    write_private(&key_path, key_pair.serialize_pem().as_bytes())?;
    Ok((cert_path, key_path, true))
}

/// Writes a file readable only by the owner (the key must never be world-readable).
fn write_private(path: &Path, bytes: &[u8]) -> Result<(), String> {
    std::fs::write(path, bytes)
        .map_err(|error| format!("cannot write {}: {error}", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::Permissions::from_mode(0o600);
        std::fs::set_permissions(path, mode)
            .map_err(|error| format!("cannot restrict {}: {error}", path.display()))?;
    }
    Ok(())
}

/// SHA-256 fingerprint of a PEM certificate, formatted like browsers show it
/// (`AB:CD:…`), so the user can compare it against the one the phone displays.
pub fn fingerprint(cert_path: &Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    let pem = std::fs::read(cert_path)
        .map_err(|error| format!("cannot read {}: {error}", cert_path.display()))?;
    // The certificate is the first PEM block; hashing the whole file would include the
    // trailing newline and any chain, so extract the DER body.
    let der = pem_der(&pem)
        .ok_or_else(|| format!("{} does not contain a PEM certificate", cert_path.display()))?;
    let digest = Sha256::digest(der);
    Ok(digest
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(":"))
}

/// Extracts the DER bytes of the first `CERTIFICATE` PEM block.
fn pem_der(pem: &[u8]) -> Option<Vec<u8>> {
    let text = std::str::from_utf8(pem).ok()?;
    let begin = text.find("-----BEGIN CERTIFICATE-----")?;
    let body_start = begin + "-----BEGIN CERTIFICATE-----".len();
    let end = text[body_start..].find("-----END CERTIFICATE-----")? + body_start;
    let body: String = text[body_start..end]
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect();
    base64_decode(&body)
}

/// Minimal base64 decoder (the daemon has no base64 dependency and only needs this).
fn base64_decode(input: &str) -> Option<Vec<u8>> {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut lookup = [255u8; 256];
    for (index, byte) in TABLE.iter().enumerate() {
        lookup[*byte as usize] = index as u8;
    }
    let mut out = Vec::with_capacity(input.len() * 3 / 4);
    let mut buffer = 0u32;
    let mut bits = 0u32;
    for byte in input.bytes() {
        if byte == b'=' {
            break;
        }
        let value = lookup[byte as usize];
        if value == 255 {
            return None;
        }
        buffer = (buffer << 6) | u32::from(value);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buffer >> bits) as u8);
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("companion-tls-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn no_configuration_means_plain_http() {
        let mode = mode_from(None, None, None, PathBuf::from("/tmp/unused")).unwrap();
        assert_eq!(mode, TlsMode::Off);
    }

    #[test]
    fn a_certificate_without_a_key_is_rejected_and_names_the_missing_variable() {
        let dir = temp_dir("cert-only");
        let cert = dir.join("cert.pem");
        std::fs::write(&cert, b"x").unwrap();
        let error = mode_from(Some(cert.display().to_string()), None, None, dir).unwrap_err();
        assert!(error.contains("PI_COMPANION_TLS_KEY"), "error was: {error}");
    }

    #[test]
    fn a_key_without_a_certificate_is_rejected_and_names_the_missing_variable() {
        let dir = temp_dir("key-only");
        let key = dir.join("key.pem");
        std::fs::write(&key, b"x").unwrap();
        let error = mode_from(None, Some(key.display().to_string()), None, dir).unwrap_err();
        assert!(error.contains("PI_COMPANION_TLS_CERT"), "error was: {error}");
    }

    #[test]
    fn a_missing_certificate_file_is_reported() {
        let dir = temp_dir("missing-cert");
        let error = mode_from(
            Some(dir.join("nope.pem").display().to_string()),
            Some(dir.join("nope.key").display().to_string()),
            None,
            dir,
        )
        .unwrap_err();
        assert!(error.contains("does not exist"), "error was: {error}");
    }

    #[test]
    fn self_signed_flag_selects_the_self_signed_mode() {
        let dir = temp_dir("self-signed-mode");
        let mode = mode_from(None, None, Some("1".into()), dir.clone()).unwrap();
        assert_eq!(mode, TlsMode::SelfSigned { dir });
    }

    #[test]
    fn self_signed_generation_is_reused_on_the_second_call() {
        let dir = temp_dir("self-signed-reuse");
        let hosts = vec!["companion.test".to_string()];
        let (cert, key, created) = ensure_self_signed(&dir, &hosts).unwrap();
        assert!(created, "the first call must create the pair");
        assert!(cert.is_file() && key.is_file());
        let first = fingerprint(&cert).unwrap();
        let (_, _, created_again) = ensure_self_signed(&dir, &hosts).unwrap();
        assert!(!created_again, "the second call must reuse the pair");
        assert_eq!(first, fingerprint(&cert).unwrap(), "the fingerprint must be stable");
    }

    #[test]
    fn the_generated_key_is_not_world_readable() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let dir = temp_dir("self-signed-perms");
            let (_, key, _) = ensure_self_signed(&dir, &["companion.test".to_string()]).unwrap();
            let mode = std::fs::metadata(&key).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600, "the private key must stay owner-only");
        }
    }

    #[test]
    fn the_fingerprint_is_colon_separated_uppercase_hex() {
        let dir = temp_dir("fingerprint");
        let (cert, _, _) = ensure_self_signed(&dir, &["companion.test".to_string()]).unwrap();
        let value = fingerprint(&cert).unwrap();
        let parts: Vec<&str> = value.split(':').collect();
        assert_eq!(parts.len(), 32, "SHA-256 renders as 32 octets");
        assert!(parts.iter().all(|part| part.len() == 2
            && part.chars().all(|c| c.is_ascii_hexdigit() && !c.is_lowercase())));
    }

    /// A wildcard bind must not become a certificate name: `0.0.0.0` is not a name any
    /// client can match, so a phone would reject the certificate for the wrong host even
    /// after trusting the CA. The wildcard has to be replaced by the addresses a client
    /// actually dials.
    #[test]
    fn a_wildcard_bind_never_becomes_a_certificate_name() {
        let names = host_names_for("0.0.0.0:43723");
        assert!(
            !names.iter().any(|name| name == "0.0.0.0"),
            "0.0.0.0 is a bind address, not a name: {names:?}"
        );
        assert!(names.iter().any(|name| name == "localhost"));
        assert!(names.iter().any(|name| name == "127.0.0.1"));
        // Whatever this machine's LAN addresses are, they must be covered.
        for address in local_ipv4_addresses() {
            assert!(
                names.iter().any(|name| name == &address),
                "the LAN address {address} must be in the certificate: {names:?}"
            );
        }
    }

    #[test]
    fn a_specific_bind_host_is_kept_and_loopback_is_added() {
        let names = host_names_for("192.168.2.20:43723");
        assert_eq!(names.first().map(String::as_str), Some("192.168.2.20"));
        assert!(names.iter().any(|name| name == "localhost"));
        assert!(names.iter().any(|name| name == "127.0.0.1"));
    }

    #[test]
    fn host_names_are_unique() {
        let names = host_names_for("127.0.0.1:43723");
        let mut sorted = names.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(sorted.len(), names.len(), "duplicate names: {names:?}");
    }

    /// The certificate is installed on a phone as a CA, so it has to say it is one.
    ///
    /// `CertificateParams::new` produces a leaf certificate: no basicConstraints, no
    /// keyUsage. Chrome tolerates that when the user accepts the warning, but Firefox
    /// validates every same-origin fetch against it and rejects the lot, so the client
    /// cannot even download its own runtime. A self-signed certificate meant to be trusted
    /// as a CA must carry `CA:TRUE` and the key-cert-sign usage.
    #[test]
    fn the_self_signed_certificate_is_usable_as_a_ca() {
        let dir = temp_dir("ca-constraints");
        let (cert, _, _) = ensure_self_signed(&dir, &["companion.test".to_string()]).unwrap();
        let bytes = std::fs::read(&cert).unwrap();
        let text = String::from_utf8_lossy(&bytes).into_owned();
        let der = base64_decode(
            text.split("-----BEGIN CERTIFICATE-----")
                .nth(1)
                .and_then(|rest| rest.split("-----END CERTIFICATE-----").next())
                .map(|body| body.split_whitespace().collect::<String>())
                .unwrap_or_default()
                .as_str(),
        )
        .expect("the PEM body must be valid base64");

        // BasicConstraints ::= SEQUENCE { cA BOOLEAN DEFAULT FALSE, ... }
        // DER: 30 03 01 01 FF  (SEQUENCE len 3, BOOLEAN len 1, TRUE)
        let ca_marker: [u8; 5] = [0x30, 0x03, 0x01, 0x01, 0xFF];
        let has_ca = der.windows(5).any(|window| window == ca_marker);
        assert!(has_ca, "the certificate must carry basicConstraints CA:TRUE so it can be trusted as a CA");

        // KeyUsage with keyCertSign (bit 5) must be present too.
        let key_usage_marker: [u8; 5] = [0x06, 0x03, 0x55, 0x1D, 0x0F];
        let has_key_usage = der.windows(5).any(|window| window == key_usage_marker);
        assert!(has_key_usage, "the certificate must carry a keyUsage extension with keyCertSign");
    }

    #[test]
    fn base64_decoding_matches_a_known_value() {
        assert_eq!(base64_decode("aGVsbG8=").unwrap(), b"hello");
        assert_eq!(base64_decode("").unwrap(), Vec::<u8>::new());
        assert!(base64_decode("!!!!").is_none());
    }
}
