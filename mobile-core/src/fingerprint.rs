//! Host-key fingerprint formatting.
//!
//! ## What a fingerprint is here
//!
//! A fingerprint is the SHA-256 digest of the SSH **wire encoding** of the host
//! public key (the same blob OpenSSH hashes, i.e. `algorithm || key material`), encoded
//! as **lowercase hex**. The digest itself is computed by `ssh-key`'s
//! [`Fingerprint`](russh::keys::ssh_key::Fingerprint) implementation so this crate never
//! re-implements key encoding.
//!
//! Two renderings exist and both are public API:
//!
//! * the **compact** form — 64 hex characters, no separators. This is the value that
//!   travels inside the pairing QR as `fp=<hex>` (`docs/mobile-protocol-spec.md` §1) and
//!   the value persisted for trust-on-first-use (TOFU).
//! * the **display** form — the same digest as colon-separated groups of two hex digits
//!   (`aa:bb:…`), which is what the pairing summary shows the user so it can be compared
//!   with the host's own output (§1, §8).

use russh::keys::{HashAlg, PublicKey};

/// Length in hex characters of a SHA-256 fingerprint (32 bytes × 2).
pub const FINGERPRINT_HEX_LEN: usize = 64;

/// Lowercase hex encoding of `bytes`.
pub fn hex_lower(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

/// Render a hex fingerprint as colon-separated groups of two hex digits.
///
/// Separators (`:` or `-`) already present in `value` are dropped and the digits are
/// lowercased, so both the compact and an already-grouped fingerprint render to the
/// same display form. An odd trailing digit is kept as its own group instead of being
/// silently discarded; callers that need a valid digest validate with [`normalize`]
/// first.
pub fn with_colons(value: &str) -> String {
    let digits: String = value
        .chars()
        .filter(|c| *c != ':' && *c != '-')
        .map(|c| c.to_ascii_lowercase())
        .collect();
    let mut out = String::with_capacity(digits.len() + digits.len() / 2);
    for (index, chunk) in digits.as_bytes().chunks(2).enumerate() {
        if index > 0 {
            out.push(':');
        }
        for byte in chunk {
            out.push(*byte as char);
        }
    }
    out
}

/// Validate and normalize a fingerprint to the compact lowercase form.
///
/// Returns `None` unless `value` (ignoring `:`/`-` separators and ASCII case) is
/// exactly [`FINGERPRINT_HEX_LEN`] hex digits.
pub fn normalize(value: &str) -> Option<String> {
    let compact: String = value
        .chars()
        .filter(|c| *c != ':' && *c != '-')
        .map(|c| c.to_ascii_lowercase())
        .collect();
    if compact.len() == FINGERPRINT_HEX_LEN && compact.bytes().all(|b| b.is_ascii_hexdigit()) {
        Some(compact)
    } else {
        None
    }
}

/// Compact (64 hex chars) SHA-256 fingerprint of an SSH host public key.
pub fn of_public_key(key: &PublicKey) -> String {
    let fingerprint = key.fingerprint(HashAlg::Sha256);
    let digest = fingerprint
        .sha256()
        .expect("HashAlg::Sha256 always produces a SHA-256 fingerprint");
    hex_lower(&digest)
}

/// Display form (`aa:bb:…`) of [`of_public_key`].
pub fn display_of_public_key(key: &PublicKey) -> String {
    with_colons(&of_public_key(key))
}

#[cfg(test)]
mod tests {
    use super::*;
    use russh::keys::ssh_key::public::{Ed25519PublicKey, KeyData};

    fn ed25519_key(bytes: [u8; 32]) -> PublicKey {
        PublicKey::from(KeyData::Ed25519(Ed25519PublicKey(bytes)))
    }

    #[test]
    fn hex_lower_pads_and_uses_lowercase() {
        assert_eq!(hex_lower(&[]), "");
        assert_eq!(hex_lower(&[0x00, 0x0f, 0xff, 0xa5]), "000fffa5");
    }

    #[test]
    fn with_colons_groups_in_pairs() {
        assert_eq!(with_colons("aabbccdd"), "aa:bb:cc:dd");
        assert_eq!(with_colons("AABBCCDD"), "aa:bb:cc:dd");
        assert_eq!(with_colons("aa:bb:cc:dd"), "aa:bb:cc:dd");
        assert_eq!(with_colons("aa-bb-cc-dd"), "aa:bb:cc:dd");
        assert_eq!(with_colons(""), "");
        // Odd input keeps the trailing digit instead of dropping it.
        assert_eq!(with_colons("aabbc"), "aa:bb:c");
    }

    #[test]
    fn normalize_accepts_compact_and_grouped_sha256_digests() {
        let compact = "66402c9468c58941dd19ffd650bf2b42f9226f83d3bd06ad515d0e5104a77020";
        assert_eq!(normalize(compact).as_deref(), Some(compact));
        let upper = compact.to_ascii_uppercase();
        assert_eq!(normalize(&upper).as_deref(), Some(compact));
        assert_eq!(normalize(&with_colons(compact)).as_deref(), Some(compact));
    }

    #[test]
    fn normalize_rejects_wrong_length_and_non_hex() {
        let compact = "66402c9468c58941dd19ffd650bf2b42f9226f83d3bd06ad515d0e5104a77020";
        assert_eq!(normalize(""), None);
        assert_eq!(normalize(&compact[..63]), None);
        assert_eq!(normalize(&format!("{compact}0")), None);
        assert_eq!(normalize(&format!("{}z", &compact[..63])), None);
        assert_eq!(normalize("sha256:abc"), None);
    }

    #[test]
    fn public_key_fingerprint_matches_independent_sha256_of_the_wire_blob() {
        // Fixture computed outside this crate: sha256(u32be(11) || "ssh-ed25519"
        // || u32be(32) || 0x00..0x1f).
        let key = ed25519_key(std::array::from_fn(|i| i as u8));
        assert_eq!(
            of_public_key(&key),
            "66402c9468c58941dd19ffd650bf2b42f9226f83d3bd06ad515d0e5104a77020"
        );
        assert_eq!(of_public_key(&key).len(), FINGERPRINT_HEX_LEN);
    }

    #[test]
    fn display_form_is_the_grouped_compact_form() {
        let key = ed25519_key([7u8; 32]);
        let compact = of_public_key(&key);
        assert_eq!(
            compact,
            "80d488456fb62328aebec769fdb823cb7f1bbd61f0eb0426dedba85eb9775a34"
        );
        assert_eq!(
            display_of_public_key(&key),
            "80:d4:88:45:6f:b6:23:28:ae:be:c7:69:fd:b8:23:cb:7f:1b:bd:61:f0:eb:04:26:de:db:a8:5e:b9:77:5a:34"
        );
        // 32 groups of 2 digits => 31 separators.
        assert_eq!(display_of_public_key(&key).len(), FINGERPRINT_HEX_LEN + 31);
    }

    #[test]
    fn different_keys_have_different_fingerprints() {
        let a = of_public_key(&ed25519_key([1u8; 32]));
        let b = of_public_key(&ed25519_key([2u8; 32]));
        assert_ne!(a, b);
    }
}
