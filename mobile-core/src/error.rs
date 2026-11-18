//! Error type of the core.
//!
//! Every fallible entry point of this crate returns [`CoreError`]. The variants are
//! the ones frozen by `docs/mobile-protocol-spec.md` §6, and each one maps to a
//! stable [`kind`](CoreError::kind) string so the TypeScript layer can branch on the
//! kind instead of parsing messages.
//!
//! This is the only error type in the library: internal helpers use the
//! `CoreError::invalid_qr` / `CoreError::ssh` / `CoreError::crypto` constructors so
//! the message shape stays consistent, and the FFI facade converts the value into a
//! plain [`crate::ffi::CoreErrorPayload`] record.

use thiserror::Error;

/// `InvalidQr` kind: the scanned URI is not a usable `gc://pair?v=1` invitation.
pub const KIND_INVALID_QR: &str = "invalid_qr";
/// `Ssh` kind: transport, authentication or channel failure.
pub const KIND_SSH: &str = "ssh";
/// `Io` kind: local operating-system failure.
pub const KIND_IO: &str = "io";
/// `Crypto` kind: key material or signature failure.
pub const KIND_CRYPTO: &str = "crypto";
/// `UnsupportedVersion` kind: the QR declares a major version this build cannot route.
pub const KIND_UNSUPPORTED_VERSION: &str = "unsupported_version";

/// Error returned by every fallible operation of the core.
#[derive(Debug, Error)]
pub enum CoreError {
    /// The pairing URI is malformed or fails the §1 validation rules.
    #[error("invalid pairing QR: {reason}")]
    InvalidQr {
        /// Human-readable reason, safe to show in the pairing UI.
        reason: String,
    },

    /// The SSH layer failed: connection, host key, authentication or channel error.
    #[error("ssh: {reason}")]
    Ssh {
        /// Human-readable reason, safe to show in the connection UI.
        reason: String,
    },

    /// Local I/O failed.
    #[error("io: {0}")]
    Io(#[from] std::io::Error),

    /// Key material could not be parsed or a signature could not be produced.
    #[error("crypto: {0}")]
    Crypto(String),

    /// The pairing URI carries a major version this build does not implement.
    #[error("unsupported pairing QR major version {found} (this build speaks v1)")]
    UnsupportedVersion {
        /// Major version found in the URI.
        found: u32,
    },
}

impl CoreError {
    /// Build an [`CoreError::InvalidQr`].
    pub fn invalid_qr(reason: impl Into<String>) -> Self {
        Self::InvalidQr {
            reason: reason.into(),
        }
    }

    /// Build an [`CoreError::Ssh`].
    pub fn ssh(reason: impl Into<String>) -> Self {
        Self::Ssh {
            reason: reason.into(),
        }
    }

    /// Build an [`CoreError::Crypto`].
    pub fn crypto(reason: impl Into<String>) -> Self {
        Self::Crypto(reason.into())
    }

    /// Stable machine-readable kind, used by the FFI payload and the TS bindings.
    pub fn kind(&self) -> &'static str {
        match self {
            Self::InvalidQr { .. } => KIND_INVALID_QR,
            Self::Ssh { .. } => KIND_SSH,
            Self::Io(_) => KIND_IO,
            Self::Crypto(_) => KIND_CRYPTO,
            Self::UnsupportedVersion { .. } => KIND_UNSUPPORTED_VERSION,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kind_is_stable_for_every_variant() {
        assert_eq!(CoreError::invalid_qr("x").kind(), "invalid_qr");
        assert_eq!(CoreError::ssh("x").kind(), "ssh");
        assert_eq!(CoreError::crypto("x").kind(), "crypto");
        assert_eq!(
            CoreError::Io(std::io::Error::other("boom")).kind(),
            "io"
        );
        assert_eq!(CoreError::UnsupportedVersion { found: 2 }.kind(), "unsupported_version");
    }

    #[test]
    fn messages_keep_the_frozen_prefixes() {
        assert_eq!(
            CoreError::invalid_qr("missing host").to_string(),
            "invalid pairing QR: missing host"
        );
        assert_eq!(CoreError::ssh("auth rejected").to_string(), "ssh: auth rejected");
        assert_eq!(CoreError::crypto("bad seed").to_string(), "crypto: bad seed");
        assert_eq!(
            CoreError::UnsupportedVersion { found: 2 }.to_string(),
            "unsupported pairing QR major version 2 (this build speaks v1)"
        );
    }

    #[test]
    fn io_errors_convert_through_the_from_impl() {
        let io = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "nope");
        let err: CoreError = io.into();
        assert_eq!(err.kind(), KIND_IO);
        assert!(err.to_string().contains("nope"));
    }
}
