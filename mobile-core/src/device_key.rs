//! ed25519 device identity and release-signature verification.
//!
//! ## The phone owns its identity (`docs/mobile-protocol-spec.md` §0.2, §2.1)
//!
//! At the first pairing the phone generates an ed25519 key pair. The **public** half is
//! sent in `REGISTER_DEVICE` and persisted by the host daemon; every later connection
//! uses the **private** half as the SSH credential. The private half therefore never
//! leaves the device:
//!
//! * on device it is written to the platform keystore (iOS Keychain / Android Keystore)
//!   by the native shell and read back through the platform API — see
//!   [`crate::ffi`] for the exact FFI policy;
//! * [`StoredKey`] carries the raw 32-byte ed25519 seed so the native bridge and the
//!   tests can move it around. It is **not** part of the JS-visible FFI surface, it has
//!   a redacted [`Debug`] implementation, and it must never be logged or serialized
//!   outside the keystore writer.
//!
//! Seed sizes and encodings are fixed: 32-byte seed, 32-byte public key, 64-byte
//! signature. Public keys and signatures travel as lowercase hex strings.

use std::fmt;

use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use rand_core::{CryptoRngCore, OsRng};
use serde::{Deserialize, Serialize};

use crate::error::CoreError;
use crate::fingerprint;

/// Length of an ed25519 secret seed, in bytes.
pub const SECRET_SEED_LEN: usize = 32;
/// Length of an ed25519 public key, in bytes.
pub const PUBLIC_KEY_LEN: usize = 32;
/// Length of an ed25519 signature, in bytes.
pub const SIGNATURE_LEN: usize = 64;

/// Raw ed25519 secret seed, waiting to be sealed in the platform keystore.
///
/// **Security:** this value is the device identity. The native shell must hand it to
/// the Keychain/Keystore and drop it; it must never reach JS, logs or a snapshot.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoredKey {
    /// The 32-byte ed25519 seed, exactly [`SECRET_SEED_LEN`] bytes.
    pub secret_seed: Vec<u8>,
}

impl fmt::Debug for StoredKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("StoredKey")
            .field(
                "secret_seed",
                &format_args!("<redacted {} bytes>", self.secret_seed.len()),
            )
            .finish()
    }
}

/// A freshly generated device identity.
///
/// Returned by [`generate`]. The public half is what the app shows and registers; the
/// private half is the [`StoredKey`] the keystore writer consumes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeviceKeyPair {
    /// Lowercase hex (64 chars) ed25519 public key.
    pub public_hex: String,
    /// Private half, to be sealed by the platform keystore.
    pub secret: StoredKey,
}

impl DeviceKeyPair {
    /// Public half as raw bytes.
    pub fn public_bytes(&self) -> Result<[u8; PUBLIC_KEY_LEN], CoreError> {
        decode_public_hex(&self.public_hex)
    }
}

/// Generate a new device identity with the operating system RNG.
pub fn generate() -> DeviceKeyPair {
    generate_with(&mut OsRng)
}

/// Generate a new device identity with a caller-provided RNG.
///
/// Exists so tests can pin the seed without touching OS entropy; production code calls
/// [`generate`].
pub fn generate_with(rng: &mut impl CryptoRngCore) -> DeviceKeyPair {
    let signing_key = SigningKey::generate(rng);
    DeviceKeyPair {
        public_hex: fingerprint::hex_lower(signing_key.verifying_key().as_bytes()),
        secret: StoredKey {
            secret_seed: signing_key.to_bytes().to_vec(),
        },
    }
}

/// Derive the lowercase hex public key from a stored secret (`deviceKeyPublic`).
pub fn public_hex_from_secret(secret: &StoredKey) -> Result<String, CoreError> {
    let signing_key = signing_key_from_secret(secret)?;
    Ok(fingerprint::hex_lower(
        signing_key.verifying_key().as_bytes(),
    ))
}

/// Sign `payload` with the device identity.
///
/// Used by the handshake to authenticate `REGISTER_DEVICE` (§2) and by the tests; the
/// signature is 64 bytes and the FFI/daemon encoding is lowercase hex.
pub fn sign(secret: &StoredKey, payload: &[u8]) -> Result<Vec<u8>, CoreError> {
    let signing_key = signing_key_from_secret(secret)?;
    Ok(signing_key.sign(payload).to_bytes().to_vec())
}

/// Verify `signature` over `payload` with a hex ed25519 public key (`cryptoVerify`).
///
/// Returns `false` for a wrong key, a tampered payload, a bad signature **and** for
/// unparsable inputs: the release-signature check (§3.2) needs a boolean go/no-go, and
/// any malformed input must mean "reject the binary", never "panic".
pub fn verify(release_pubkey_hex: &str, payload: &[u8], signature: &[u8]) -> bool {
    let Ok(public_bytes) = decode_public_hex(release_pubkey_hex) else {
        return false;
    };
    let Ok(verifying_key) = VerifyingKey::from_bytes(&public_bytes) else {
        return false;
    };
    let Ok(signature) = Signature::from_slice(signature) else {
        return false;
    };
    verifying_key.verify_strict(payload, &signature).is_ok()
}

/// Parse a lowercase or uppercase hex ed25519 public key into raw bytes.
fn decode_public_hex(public_hex: &str) -> Result<[u8; PUBLIC_KEY_LEN], CoreError> {
    let expected = PUBLIC_KEY_LEN * 2;
    if public_hex.len() != expected {
        return Err(CoreError::crypto(format!(
            "ed25519 public key must be {expected} hex characters, found {}",
            public_hex.len()
        )));
    }
    let mut bytes = [0u8; PUBLIC_KEY_LEN];
    for (index, chunk) in public_hex.as_bytes().chunks(2).enumerate() {
        let text = std::str::from_utf8(chunk)
            .map_err(|_| CoreError::crypto("ed25519 public key is not ASCII hex"))?;
        bytes[index] = u8::from_str_radix(text, 16)
            .map_err(|_| CoreError::crypto(format!("ed25519 public key is not hex: {text:?}")))?;
    }
    Ok(bytes)
}

/// Rebuild the signing key from a stored secret seed.
fn signing_key_from_secret(secret: &StoredKey) -> Result<SigningKey, CoreError> {
    let seed: [u8; SECRET_SEED_LEN] = secret.secret_seed.as_slice().try_into().map_err(|_| {
        CoreError::crypto(format!(
            "ed25519 secret seed must be {SECRET_SEED_LEN} bytes, found {}",
            secret.secret_seed.len()
        ))
    })?;
    Ok(SigningKey::from_bytes(&seed))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Deterministic RNG so a generated identity is reproducible in tests.
    struct FixedRng(u8);

    impl rand_core::RngCore for FixedRng {
        fn next_u32(&mut self) -> u32 {
            u32::from_le_bytes([self.0; 4])
        }

        fn next_u64(&mut self) -> u64 {
            u64::from_le_bytes([self.0; 8])
        }

        fn fill_bytes(&mut self, dest: &mut [u8]) {
            dest.fill(self.0);
        }

        fn try_fill_bytes(&mut self, dest: &mut [u8]) -> Result<(), rand_core::Error> {
            self.fill_bytes(dest);
            Ok(())
        }
    }

    impl rand_core::CryptoRng for FixedRng {}

    #[test]
    fn generate_returns_hex_public_key_and_32_byte_seed() {
        let pair = generate();
        assert_eq!(pair.public_hex.len(), PUBLIC_KEY_LEN * 2);
        assert!(pair.public_hex.bytes().all(|b| b.is_ascii_hexdigit()));
        assert!(pair.public_hex.chars().all(|c| !c.is_ascii_uppercase()));
        assert_eq!(pair.secret.secret_seed.len(), SECRET_SEED_LEN);
        assert!(pair.public_bytes().is_ok());
    }

    #[test]
    fn generate_with_the_same_rng_is_reproducible() {
        let first = generate_with(&mut FixedRng(7));
        let second = generate_with(&mut FixedRng(7));
        assert_eq!(first, second);
        let other = generate_with(&mut FixedRng(8));
        assert_ne!(first.public_hex, other.public_hex);
    }

    #[test]
    fn public_key_is_derived_from_the_secret() {
        let pair = generate_with(&mut FixedRng(3));
        assert_eq!(
            public_hex_from_secret(&pair.secret).expect("derivable"),
            pair.public_hex
        );
    }

    #[test]
    fn a_wrong_size_seed_is_a_crypto_error() {
        let short = StoredKey {
            secret_seed: vec![1, 2, 3],
        };
        let err = public_hex_from_secret(&short).unwrap_err();
        assert_eq!(err.kind(), "crypto");
        assert!(err.to_string().contains("must be 32 bytes"), "{err}");
        assert!(sign(&short, b"payload").is_err());
    }

    #[test]
    fn sign_then_verify_round_trips() {
        let pair = generate_with(&mut FixedRng(11));
        let payload = b"REGISTER_DEVICE{\"deviceName\":\"pixel\"}";
        let signature = sign(&pair.secret, payload).expect("signable");
        assert_eq!(signature.len(), SIGNATURE_LEN);
        assert!(verify(&pair.public_hex, payload, &signature));
    }

    #[test]
    fn verify_rejects_tampering_and_foreign_keys() {
        let pair = generate_with(&mut FixedRng(5));
        let other = generate_with(&mut FixedRng(6));
        let payload = b"daemon-v0.6.0";
        let signature = sign(&pair.secret, payload).expect("signable");

        assert!(!verify(&pair.public_hex, b"daemon-v0.6.1", &signature));
        assert!(!verify(&other.public_hex, payload, &signature));
        assert!(!verify(
            &pair.public_hex,
            payload,
            &signature[..SIGNATURE_LEN - 1]
        ));
    }

    #[test]
    fn verify_returns_false_for_malformed_inputs() {
        let pair = generate_with(&mut FixedRng(9));
        let signature = sign(&pair.secret, b"x").expect("signable");
        assert!(!verify("", b"x", &signature));
        assert!(!verify("zz", b"x", &signature));
        assert!(!verify(&pair.public_hex, b"x", &[]));
        assert!(!verify(&pair.public_hex, b"x", &[0u8; SIGNATURE_LEN]));
        assert!(!verify(
            "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
            b"x",
            &signature
        ));
    }

    #[test]
    fn public_key_hex_accepts_uppercase_input() {
        let pair = generate_with(&mut FixedRng(4));
        let payload = b"payload";
        let signature = sign(&pair.secret, payload).expect("signable");
        assert!(verify(&pair.public_hex.to_ascii_uppercase(), payload, &signature));
    }

    #[test]
    fn debug_does_not_leak_the_seed() {
        let pair = generate_with(&mut FixedRng(2));
        let rendered = format!("{:?}", pair);
        assert!(rendered.contains("<redacted 32 bytes>"), "{rendered}");
        // FixedRng fills the seed with its byte, so this is the exact secret to hide.
        assert_eq!(pair.secret.secret_seed, vec![2u8; SECRET_SEED_LEN]);
        assert!(!rendered.contains(&fingerprint::hex_lower(&pair.secret.secret_seed)));
        assert!(!rendered.contains("02, 02, 02"), "{rendered}");
    }

    #[test]
    fn device_key_pair_round_trips_through_json() {
        let pair = generate_with(&mut FixedRng(13));
        let json = serde_json::to_string(&pair).expect("serializes");
        let back: DeviceKeyPair = serde_json::from_str(&json).expect("deserializes");
        assert_eq!(back, pair);
        assert_eq!(back.public_hex, pair.public_hex);
        // The seed survives the round-trip unchanged (byte-for-byte), which is what the
        // keystore writer relies on.
        assert_eq!(back.secret.secret_seed, pair.secret.secret_seed);
    }

    #[test]
    fn decode_public_hex_rejects_bad_length_and_digits() {
        assert!(decode_public_hex("").is_err());
        assert!(decode_public_hex(&"0".repeat(63)).is_err());
        assert!(decode_public_hex(&format!("{}g", "0".repeat(63))).is_err());
        assert!(decode_public_hex(&"0".repeat(64)).is_ok());
    }
}
