//! Integration tests for the frozen FFI surface (`docs/mobile-protocol-spec.md` §6).
//!
//! These tests use only the public API — exactly what the native shell and the TypeScript
//! bindings can reach — and they never touch the network: the SSH paths they cover are the
//! handle registry and the pure value types.

use mobile_core::device_key;
use mobile_core::ffi::{CoreErrorPayload, MobileCore};
use mobile_core::qr::PairInfo;
use mobile_core::ssh::{ExecOutput, SshCredential};
use mobile_core::CoreError;

const FP: &str = "66402c9468c58941dd19ffd650bf2b42f9226f83d3bd06ad515d0e5104a77020";

fn core() -> MobileCore {
    MobileCore::new()
}

fn valid_uri() -> String {
    format!("gc://pair?v=1&host=192.168.1.42&port=2222&user=reaan&token=inv_7Qp2&fp={FP}&proto=2")
}

#[test]
fn pair_from_qr_is_the_frozen_entry_point() {
    let info = core().pair_from_qr(valid_uri()).expect("valid invitation");
    assert_eq!(info.version, 1);
    assert_eq!(info.host, "192.168.1.42");
    assert_eq!(info.port, 2222);
    assert_eq!(info.user, "reaan");
    assert_eq!(info.token, "inv_7Qp2");
    assert_eq!(info.fingerprint, FP);
    assert_eq!(info.daemon_protocol_minor, Some(2));
    assert_eq!(info.ssh_target(), "192.168.1.42:2222");
    assert!(info.fingerprint_display().contains(':'));
}

#[test]
fn pair_info_json_field_names_are_stable() {
    let info = core().pair_from_qr(valid_uri()).expect("valid invitation");
    let json = serde_json::to_string(&info).expect("serializes");
    assert_eq!(
        json,
        format!(
            r#"{{"version":1,"host":"192.168.1.42","port":2222,"user":"reaan","token":"inv_7Qp2","fingerprint":"{FP}","daemon_protocol_minor":2}}"#
        )
    );
}

#[test]
fn pair_from_qr_rejections_carry_a_stable_kind() {
    let core = core();

    let malformed = core.pair_from_qr("not-a-uri".to_string()).expect_err("fails");
    assert_eq!(malformed.kind, "invalid_qr");
    assert_eq!(malformed.message, "invalid pairing QR: missing gc:// scheme");

    let version = core
        .pair_from_qr(format!("gc://pair?v=2&host=h&user=u&token=t&fp={FP}"))
        .expect_err("fails");
    assert_eq!(version.kind, "unsupported_version");

    let port = core
        .pair_from_qr(format!("gc://pair?v=1&host=h&port=0&user=u&token=t&fp={FP}"))
        .expect_err("fails");
    assert_eq!(port.kind, "invalid_qr");
    assert_eq!(port.message, "invalid pairing QR: port must be 1..=65535");
}

#[test]
fn device_key_generate_and_public_are_consistent() {
    let core = core();
    let pair = core.device_key_generate();
    assert_eq!(pair.public_hex.len(), 64);
    assert_eq!(pair.secret.secret_seed.len(), 32);
    assert_eq!(
        core.device_key_public(pair.secret).expect("derivable"),
        pair.public_hex
    );
}

#[test]
fn crypto_verify_gates_a_signed_daemon_descriptor() {
    let core = core();
    let release = core.device_key_generate();
    let payload = b"daemon-descriptor:{\"version\":\"0.6.0\"}";
    let signature = device_key::sign(&release.secret, payload).expect("signable");

    assert!(core.crypto_verify(release.public_hex.clone(), payload.to_vec(), signature.clone()));
    assert!(!core.crypto_verify(
        release.public_hex,
        b"daemon-descriptor:{\"version\":\"9.9.9\"}".to_vec(),
        signature.clone()
    ));
    assert!(!core.crypto_verify(
        "0".repeat(64),
        payload.to_vec(),
        signature
    ));
    assert!(!core.crypto_verify("nonsense".to_string(), payload.to_vec(), Vec::new()));
}

#[test]
fn unknown_session_ids_fail_with_an_ssh_payload() {
    let core = core();
    let payload = core.session_fingerprint(99).expect_err("unknown session");
    assert_eq!(payload.kind, "ssh");
    assert_eq!(payload.message, "ssh: unknown session id 99");
}

#[test]
fn credential_enum_crosses_the_boundary_as_tagged_json() {
    let password = SshCredential::Password("pw".to_string());
    assert_eq!(
        serde_json::to_string(&password).expect("serializes"),
        r#"{"kind":"password","value":"pw"}"#
    );

    let key = SshCredential::Key {
        private: b"KEY".to_vec(),
        passphrase: Some("secret".to_string()),
    };
    assert_eq!(
        serde_json::to_string(&key).expect("serializes"),
        r#"{"kind":"key","value":{"private":[75,69,89],"passphrase":"secret"}}"#
    );
    let back: SshCredential = serde_json::from_str(&serde_json::to_string(&key).unwrap()).unwrap();
    assert_eq!(back, key);
}

#[test]
fn exec_output_matches_the_frozen_json_shape() {
    let output = ExecOutput {
        exit_code: 0,
        stdout: b"aarch64\n".to_vec(),
        stderr: Vec::new(),
    };
    assert_eq!(
        serde_json::to_string(&output).expect("serializes"),
        r#"{"exit_code":0,"stdout":[97,97,114,99,104,54,52,10],"stderr":[]}"#
    );
}

#[test]
fn error_payload_round_trips_for_the_ts_layer() {
    let payload = CoreErrorPayload::from(CoreError::invalid_qr("missing token parameter"));
    assert_eq!(payload.kind, "invalid_qr");
    let json = serde_json::to_string(&payload).expect("serializes");
    assert_eq!(
        json,
        r#"{"kind":"invalid_qr","message":"invalid pairing QR: missing token parameter"}"#
    );
    let back: CoreErrorPayload = serde_json::from_str(&json).expect("deserializes");
    assert_eq!(back, payload);
}

#[test]
fn pair_info_is_the_same_type_through_both_names() {
    // Guards against an FFI facade that drifts from the core record.
    let info: PairInfo = core().pair_from_qr(valid_uri()).expect("valid invitation");
    let json = serde_json::to_value(&info).expect("serializes");
    assert_eq!(json["fingerprint"], FP);
}
