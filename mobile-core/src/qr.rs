//! Pairing QR parsing (`docs/mobile-protocol-spec.md` §1).
//!
//! The QR payload is the invitation the host prints and the phone scans:
//!
//! ```text
//! gc://pair?v=1&host=<ip|hostname>&port=<ssh-port>&user=<u>&token=<one-time>&fp=<hex>&proto=<minor>
//! ```
//!
//! The QR never contains key material (§0.1): it only carries the location, the SSH
//! user, a single-use invite token and the host key fingerprint the user is asked to
//! confirm. This module validates that shape and nothing else — no network, no state.
//!
//! Validation rules (all of them are [`CoreError::InvalidQr`] except the version gate):
//!
//! * scheme must be `gc` (ASCII case-insensitive), action must be `pair`;
//! * `v` must be present, must parse as `u32`, and must equal [`SUPPORTED_VERSION`];
//!   any other value is [`CoreError::UnsupportedVersion`];
//! * `host` and `user` must be present and non-empty;
//! * `port` is optional and defaults to [`DEFAULT_PORT`] (22) when absent; it must
//!   parse as `u16` and must not be `0`;
//! * `token` must be present and non-empty;
//! * `fp` must be present and be the 64-hex-character SHA-256 host key fingerprint
//!   (separators are accepted and normalized away, see [`crate::fingerprint`]);
//! * `proto` is optional and must parse as `u32` when present;
//! * duplicate parameters are rejected, unknown parameters are ignored so a future
//!   minor revision can add fields without breaking v1 clients.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::error::CoreError;
use crate::fingerprint;

/// URI scheme of a Gentle Movil pairing invitation.
pub const SCHEME: &str = "gc";
/// Action segment of a pairing invitation URI.
pub const ACTION: &str = "pair";
/// The only major protocol version this build understands.
pub const SUPPORTED_VERSION: u32 = 1;
/// SSH port assumed when the QR omits `port`.
pub const DEFAULT_PORT: u16 = 22;

/// Everything a scanned invitation tells the app about how to reach the host.
///
/// All fields are owned, plain values: this is also the record the FFI facade returns,
/// so it serializes to JSON with the same field names in Rust and TypeScript.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PairInfo {
    /// Major protocol version from `v` (always [`SUPPORTED_VERSION`] after parsing).
    pub version: u32,
    /// Host IP address or hostname from `host`.
    pub host: String,
    /// SSH port from `port`, or [`DEFAULT_PORT`] when the QR omitted it.
    pub port: u16,
    /// SSH user from `user`.
    pub user: String,
    /// Single-use invite token from `token`; burnt by the first `REGISTER_DEVICE`.
    pub token: String,
    /// Compact (64 hex chars, no separators) host key fingerprint from `fp`.
    pub fingerprint: String,
    /// Daemon protocol minor version from `proto`, when the QR carries one.
    pub daemon_protocol_minor: Option<u32>,
}

impl PairInfo {
    /// Fingerprint in the colon-grouped form the pairing screen shows the user.
    pub fn fingerprint_display(&self) -> String {
        fingerprint::with_colons(&self.fingerprint)
    }

    /// `host:port` target used by the SSH layer.
    pub fn ssh_target(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }
}

/// Parse and validate a scanned pairing URI.
///
/// Pure function: no I/O, no global state. Every rejection is a [`CoreError`] whose
/// message is safe to show in the pairing UI.
pub fn pair_from_qr(uri: &str) -> Result<PairInfo, CoreError> {
    let trimmed = uri.trim();
    let (scheme, rest) = trimmed
        .split_once("://")
        .ok_or_else(|| CoreError::invalid_qr("missing gc:// scheme"))?;
    if !scheme.eq_ignore_ascii_case(SCHEME) {
        return Err(CoreError::invalid_qr(format!(
            "unexpected scheme {scheme:?}, expected {SCHEME:?}"
        )));
    }

    let (action, query) = rest
        .split_once('?')
        .ok_or_else(|| CoreError::invalid_qr("missing query string"))?;
    let action = action.trim_end_matches('/');
    if !action.eq_ignore_ascii_case(ACTION) {
        return Err(CoreError::invalid_qr(format!(
            "unexpected action {action:?}, expected {ACTION:?}"
        )));
    }

    let params = parse_query(query)?;

    let version_raw = required(&params, "v")?;
    let version: u32 = version_raw
        .parse()
        .map_err(|_| CoreError::invalid_qr(format!("invalid v (version) {version_raw:?}")))?;
    if version != SUPPORTED_VERSION {
        return Err(CoreError::UnsupportedVersion { found: version });
    }

    let host = required(&params, "host")?;
    let user = required(&params, "user")?;
    let token = required(&params, "token")?;

    let port = match params.get("port") {
        None => DEFAULT_PORT,
        Some(raw) => {
            let port: u16 = raw
                .parse()
                .map_err(|_| CoreError::invalid_qr(format!("invalid port {raw:?}")))?;
            if port == 0 {
                return Err(CoreError::invalid_qr("port must be 1..=65535"));
            }
            port
        }
    };

    let fingerprint_raw = required(&params, "fp")?;
    let fingerprint = fingerprint::normalize(fingerprint_raw).ok_or_else(|| {
        CoreError::invalid_qr(format!(
            "fp must be {} hex characters, found {fingerprint_raw:?}",
            fingerprint::FINGERPRINT_HEX_LEN
        ))
    })?;

    let daemon_protocol_minor = match params.get("proto") {
        None => None,
        Some(raw) => Some(
            raw.parse()
                .map_err(|_| CoreError::invalid_qr(format!("invalid proto {raw:?}")))?,
        ),
    };

    Ok(PairInfo {
        version,
        host: host.to_string(),
        port,
        user: user.to_string(),
        token: token.to_string(),
        fingerprint,
        daemon_protocol_minor,
    })
}

/// Split a query string into parameters, rejecting duplicates and empty keys.
///
/// Values are kept verbatim: a QR generator emits URL-safe tokens and plain
/// host/user values, so no percent-decoding is applied on either side.
fn parse_query(query: &str) -> Result<BTreeMap<String, String>, CoreError> {
    let mut params = BTreeMap::new();
    for segment in query.split('&') {
        if segment.is_empty() {
            continue;
        }
        let (key, value) = segment.split_once('=').ok_or_else(|| {
            CoreError::invalid_qr(format!("parameter {segment:?} has no value"))
        })?;
        if key.is_empty() {
            return Err(CoreError::invalid_qr(format!(
                "parameter {segment:?} has an empty name"
            )));
        }
        if params.insert(key.to_string(), value.to_string()).is_some() {
            return Err(CoreError::invalid_qr(format!(
                "duplicate parameter {key:?}"
            )));
        }
    }
    Ok(params)
}

/// Fetch a required, non-empty parameter.
fn required<'a>(params: &'a BTreeMap<String, String>, key: &str) -> Result<&'a str, CoreError> {
    match params.get(key) {
        None => Err(CoreError::invalid_qr(format!("missing {key} parameter"))),
        Some(value) if value.is_empty() => Err(CoreError::invalid_qr(format!(
            "{key} must not be empty"
        ))),
        Some(value) => Ok(value),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FP: &str = "66402c9468c58941dd19ffd650bf2b42f9226f83d3bd06ad515d0e5104a77020";

    fn uri(query: &str) -> String {
        format!("gc://pair?{query}")
    }

    fn valid_query() -> String {
        format!("v=1&host=192.168.1.42&port=2222&user=reaan&token=inv_7Qp2&fp={FP}&proto=3")
    }

    #[test]
    fn parses_a_complete_invitation() {
        let info = pair_from_qr(&uri(&valid_query())).expect("valid QR must parse");
        assert_eq!(
            info,
            PairInfo {
                version: 1,
                host: "192.168.1.42".to_string(),
                port: 2222,
                user: "reaan".to_string(),
                token: "inv_7Qp2".to_string(),
                fingerprint: FP.to_string(),
                daemon_protocol_minor: Some(3),
            }
        );
        assert_eq!(info.ssh_target(), "192.168.1.42:2222");
    }

    #[test]
    fn port_defaults_to_22_when_absent() {
        let query = format!("v=1&host=gentle.local&user=reaan&token=t&fp={FP}");
        let info = pair_from_qr(&uri(&query)).expect("port is optional");
        assert_eq!(info.port, DEFAULT_PORT);
        assert_eq!(info.port, 22);
        assert_eq!(info.daemon_protocol_minor, None);
    }

    #[test]
    fn fingerprint_is_normalized_and_rendered_for_display() {
        let grouped = fingerprint::with_colons(FP);
        let query = format!("v=1&host=h&user=u&token=t&fp={grouped}");
        let info = pair_from_qr(&uri(&query)).expect("grouped fingerprint is accepted");
        assert_eq!(info.fingerprint, FP);
        assert_eq!(info.fingerprint_display(), grouped);
    }

    #[test]
    fn surrounding_whitespace_and_trailing_slash_are_tolerated() {
        let query = format!("v=1&host=h&user=u&token=t&fp={FP}");
        let padded = format!("  gc://pair/?{query}  ");
        assert_eq!(pair_from_qr(&padded).expect("tolerated").host, "h");
    }

    #[test]
    fn unknown_parameters_are_ignored_for_forward_compatibility() {
        let query = format!("v=1&host=h&user=u&token=t&fp={FP}&future=1");
        assert_eq!(pair_from_qr(&uri(&query)).expect("unknown keys ignored").version, 1);
    }

    #[test]
    fn rejects_a_missing_scheme() {
        let err = pair_from_qr(&format!("pair?v=1&host=h&user=u&token=t&fp={FP}")).unwrap_err();
        assert_eq!(err.kind(), "invalid_qr");
        assert!(err.to_string().contains("missing gc:// scheme"), "{err}");
    }

    #[test]
    fn rejects_a_foreign_scheme() {
        let err = pair_from_qr(&format!("https://pair?v=1&host=h&user=u&token=t&fp={FP}")).unwrap_err();
        assert_eq!(err.kind(), "invalid_qr");
        assert!(err.to_string().contains("unexpected scheme"), "{err}");
    }

    #[test]
    fn rejects_a_foreign_action() {
        let err = pair_from_qr(&format!("gc://connect?v=1&host=h&user=u&token=t&fp={FP}")).unwrap_err();
        assert_eq!(err.kind(), "invalid_qr");
        assert!(err.to_string().contains("unexpected action"), "{err}");
    }

    #[test]
    fn rejects_a_missing_query() {
        let err = pair_from_qr("gc://pair").unwrap_err();
        assert!(err.to_string().contains("missing query string"), "{err}");
    }

    #[test]
    fn rejects_a_missing_or_unparsable_version() {
        let missing = pair_from_qr(&format!("gc://pair?host=h&user=u&token=t&fp={FP}")).unwrap_err();
        assert_eq!(missing.kind(), "invalid_qr");
        assert!(missing.to_string().contains("missing v parameter"), "{missing}");

        let broken = pair_from_qr(&format!("gc://pair?v=one&host=h&user=u&token=t&fp={FP}")).unwrap_err();
        assert!(broken.to_string().contains("invalid v (version)"), "{broken}");

        let negative = pair_from_qr(&format!("gc://pair?v=-1&host=h&user=u&token=t&fp={FP}")).unwrap_err();
        assert_eq!(negative.kind(), "invalid_qr");
    }

    #[test]
    fn rejects_an_unknown_major_version() {
        let err = pair_from_qr(&format!("gc://pair?v=2&host=h&user=u&token=t&fp={FP}")).unwrap_err();
        assert_eq!(err.kind(), "unsupported_version");
        assert_eq!(
            err.to_string(),
            "unsupported pairing QR major version 2 (this build speaks v1)"
        );
        match err {
            CoreError::UnsupportedVersion { found } => assert_eq!(found, 2),
            other => panic!("expected UnsupportedVersion, got {other:?}"),
        }
    }

    #[test]
    fn rejects_an_empty_host_or_user_or_token() {
        for (query, expected) in [
            (format!("v=1&host=&user=u&token=t&fp={FP}"), "host must not be empty"),
            (format!("v=1&user=u&token=t&fp={FP}"), "missing host parameter"),
            (format!("v=1&host=h&user=&token=t&fp={FP}"), "user must not be empty"),
            (format!("v=1&host=h&token=t&fp={FP}"), "missing user parameter"),
            (format!("v=1&host=h&user=u&token=&fp={FP}"), "token must not be empty"),
            (format!("v=1&host=h&user=u&fp={FP}"), "missing token parameter"),
        ] {
            let err = pair_from_qr(&uri(&query)).unwrap_err();
            assert_eq!(err.kind(), "invalid_qr");
            assert!(err.to_string().contains(expected), "{query}: {err}");
        }
    }

    #[test]
    fn rejects_bad_ports() {
        for (port, expected) in [
            ("0", "port must be 1..=65535"),
            ("65536", "invalid port"),
            ("-1", "invalid port"),
            ("22a", "invalid port"),
            ("", "invalid port"),
            ("ssh", "invalid port"),
        ] {
            let query = format!("v=1&host=h&port={port}&user=u&token=t&fp={FP}");
            let err = pair_from_qr(&uri(&query)).unwrap_err();
            assert_eq!(err.kind(), "invalid_qr");
            assert!(err.to_string().contains(expected), "port {port}: {err}");
        }
    }

    #[test]
    fn rejects_bad_fingerprints() {
        for bad in ["abc", &FP[..63], &format!("{FP}0"), "not-hex-not-hex-not-hex-not-hex-not-hex-not-hex-not-hex-xyz"] {
            let query = format!("v=1&host=h&user=u&token=t&fp={bad}");
            let err = pair_from_qr(&uri(&query)).unwrap_err();
            assert_eq!(err.kind(), "invalid_qr");
            assert!(err.to_string().contains("fp must be 64 hex characters"), "fp {bad}: {err}");
        }
        let empty = pair_from_qr("gc://pair?v=1&host=h&user=u&token=t&fp=").unwrap_err();
        assert!(empty.to_string().contains("fp must not be empty"), "{empty}");
        let missing = pair_from_qr("gc://pair?v=1&host=h&user=u&token=t").unwrap_err();
        assert!(missing.to_string().contains("missing fp parameter"), "{missing}");
    }

    #[test]
    fn rejects_a_bad_daemon_protocol_minor() {
        let query = format!("v=1&host=h&user=u&token=t&fp={FP}&proto=three");
        let err = pair_from_qr(&uri(&query)).unwrap_err();
        assert_eq!(err.kind(), "invalid_qr");
        assert!(err.to_string().contains("invalid proto"), "{err}");
    }

    #[test]
    fn rejects_duplicate_and_malformed_parameters() {
        let duplicate = pair_from_qr(&format!(
            "gc://pair?v=1&host=h&host=h2&user=u&token=t&fp={FP}"
        ))
        .unwrap_err();
        assert!(duplicate.to_string().contains("duplicate parameter"), "{duplicate}");

        let no_value = pair_from_qr(&format!("gc://pair?v=1&host&user=u&token=t&fp={FP}")).unwrap_err();
        assert!(no_value.to_string().contains("has no value"), "{no_value}");

        let empty_name = pair_from_qr(&format!("gc://pair?v=1&=x&host=h&user=u&token=t&fp={FP}"))
            .unwrap_err();
        assert!(empty_name.to_string().contains("empty name"), "{empty_name}");
    }

    #[test]
    fn pair_info_round_trips_through_json() {
        let info = pair_from_qr(&uri(&valid_query())).expect("valid QR must parse");
        let json = serde_json::to_string(&info).expect("PairInfo serializes");
        assert!(json.contains("\"daemon_protocol_minor\":3"), "{json}");
        let back: PairInfo = serde_json::from_str(&json).expect("PairInfo deserializes");
        assert_eq!(back, info);
    }
}
