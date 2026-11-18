use super::*;

use crate::config::Persisted;
use crate::tailcat::{TailcatError, TailcatManager};

use crate::tests::{call, post_json, test_state};

/// The tunnel pairing QR encodes the pairing URL with the tunnel address and device
/// port in the fragment (`#tunnel=<addr>&port=<port>`): the invite stays the only
/// query parameter, and fragments are never sent to the server, so neither value can
/// reach daemon logs. The phone's client reads the fragment into the tunnel-mode
/// localStorage keys at boot (feature tailcat-client T3, spec S3).
#[tokio::test]
async fn tunnel_pairing_encodes_the_tunnel_address_in_the_fragment() {
    let state = test_state();
    {
        let mut settings = state.settings.write().await;
        settings.tailcat_enabled = true;
        settings.tailcat_address = "tc-abc123".into();
        settings.tailcat_port = 12345;
    }
    state.tailcat.write().await.set_running_for_test("tc-abc123", 12345);
    let local = local_router(state.clone());
    let (_, body) = call(&local, post_json("/api/pairing/start", Some(LOCAL_ORIGIN), serde_json::json!({}))).await;
    let pairing: Value = serde_json::from_str(&body).unwrap();

    let url = pairing["url"].as_str().unwrap();
    let (base, fragment) = url.split_once('#').expect("tunnel pairing URL carries a fragment");
    assert!(!base.contains("tc-abc123"), "the tunnel address must not ride the query");
    assert!(!base.contains("12345"), "the device port must not ride the query");
    let query = base.split_once('?').unwrap().1;
    assert!(query.starts_with("invite="), "the invite stays the only query parameter: {query}");
    assert!(!query.contains('&'), "no second query parameter leaks the tunnel data: {query}");

    let fragment_params: Vec<(String, String)> = fragment
        .split('&')
        .map(|pair| pair.split_once('=').map_or_else(|| (pair.to_string(), String::new()), |(k, v)| (k.to_string(), v.to_string())))
        .collect();
    let tunnel = fragment_params.iter().find(|(key, _)| key == "tunnel").map(|(_, value)| value.clone());
    let port = fragment_params.iter().find(|(key, _)| key == "port").and_then(|(_, value)| value.parse::<u16>().ok());
    assert_eq!(fragment_params.len(), 2, "unexpected fragment parameters: {fragment}");
    assert_eq!(fragment_params[0].0, "tunnel", "the tunnel address comes first in the fragment");
    assert_eq!(tunnel.as_deref(), Some("tc-abc123"));
    assert_eq!(port, Some(12345));

    // The QR the console renders encodes the same URL: the svg is path data, so we
    // assert it is non-trivial and matches the URL's length class, not its text.
    let qr = pairing["qrSvg"].as_str().unwrap();
    assert!(qr.len() > 220, "the QR svg is rendered");
    assert!(qr.contains("shape-rendering=\"crispEdges\""));

    // The copyable fallback fields name the tunnel explicitly (T3).
    assert_eq!(pairing["tunnelAddr"].as_str(), Some("tc-abc123"));
    assert_eq!(pairing["tunnelPort"].as_u64(), Some(12345));
}

#[tokio::test]
async fn tailcat_manager_starts_and_reports_address_with_fake_binary() {
    let tmp = scratch("tailcat-test");
    std::fs::create_dir_all(&tmp).unwrap();

    // Fake tailcat binary: prints valid JSON, then sleeps.
    let fake = tmp.join("tailcat");
    std::fs::write(
        &fake,
        r#"#!/bin/sh
echo '{"listenAddr":"tc-abc123"}'
sleep 3
"#,
    )
    .unwrap();
    std::fs::set_permissions(&fake, std::os::unix::fs::PermissionsExt::from_mode(0o755))
        .unwrap();

    // Create a symlink named `tailcat` in the current directory so find_tailcat_bin can locate it.
    let cwd = std::env::current_dir().unwrap();
    let link = cwd.join("tailcat");
    let _ = std::fs::remove_file(&link); // Clean up any previous symlink
    let _ = std::os::unix::fs::symlink(&fake, &link);

    let mut manager = TailcatManager::new();
    let addr = manager.start(43722).await.unwrap();
    assert_eq!(addr, "tc-abc123");
    assert!(manager.is_running());
    assert_eq!(manager.port(), 43722);

    manager.stop().await.unwrap();
    assert!(!manager.is_running());

    let _ = std::fs::remove_file(&link);
    let _ = std::fs::remove_dir_all(&tmp);
}

#[tokio::test]
async fn tailcat_manager_records_error_when_binary_does_not_emit_address() {
    let tmp = scratch("tailcat-error-test");
    std::fs::create_dir_all(&tmp).unwrap();

    let fake = tmp.join("tailcat");
    std::fs::write(
        &fake,
        r#"#!/bin/sh
echo '{"noAddress": true}'
"#
    )
    .unwrap();
    std::fs::set_permissions(&fake, std::os::unix::fs::PermissionsExt::from_mode(0o755))
        .unwrap();

    let cwd = std::env::current_dir().unwrap();
    let link = cwd.join("tailcat");
    let _ = std::fs::remove_file(&link); // Clean up any previous symlink
    let _ = std::os::unix::fs::symlink(&fake, &link);

    let mut manager = TailcatManager::new();
    let error = manager.start(43722).await.expect_err("invalid fake binary should not produce an address");

    assert_eq!(error, TailcatError::AddressTimeout);
    assert!(!manager.is_running());
    assert!(manager.address().is_empty());
    assert!(!manager.status(false).error.is_empty());

    let _ = std::fs::remove_file(&link);
    let _ = std::fs::remove_dir_all(&tmp);
}

#[tokio::test]
async fn tailcat_manager_stop_when_not_running_is_error() {
    let mut manager = TailcatManager::new();
    assert!(matches!(manager.stop().await, Err(TailcatError::NotRunning)));
}

/// The tunnel address must survive a daemon restart.
///
/// tailcat with no `--key` generates an ephemeral identity, so every start yields a new
/// address. A phone that stored the previous one keeps dialling something that no longer
/// exists — which is exactly the failure observed live: the tunnel "did not respond in
/// time" because five restarts had invalidated five addresses. Passing a persistent key
/// path keeps the address stable, so a paired device keeps working across restarts,
/// upgrades and crashes.
#[test]
fn the_tailcat_command_uses_a_persistent_key_inside_the_data_directory() {
    let dir = std::path::Path::new("/tmp/companion-tailcat-test");
    let args = crate::tailcat::serve_args(43722, dir);

    let key_position = args.iter().position(|arg| arg == "--key").expect("--key must be passed");
    let key_path = &args[key_position + 1];

    assert!(
        key_path.starts_with(&dir.to_string_lossy().into_owned()),
        "the key must live in the daemon's data dir, not in a global config: {key_path}"
    );
    assert!(
        key_path.ends_with(".private.json"),
        "tailcat expects a *.private.json key path: {key_path}"
    );
    // Never "new": that is the ephemeral mode this fix exists to replace.
    assert_ne!(key_path, "new");
    // The port and --json keep working exactly as before.
    assert!(args.contains(&"--json".to_string()));
    assert!(args.contains(&43722.to_string()));
}

#[tokio::test]
async fn settings_roundtrip_preserves_tailcat_fields() {
    let tmp = scratch("settings-roundtrip");
    std::fs::create_dir_all(&tmp).unwrap();

    let settings = Settings {
        tailcat_enabled: true,
        tailcat_address: "tc-roundtrip".into(),
        tailcat_port: 43723,
        ..Settings::default()
    };
    assert!(settings.validate().is_ok());

    let persisted = Persisted {
        settings: settings.clone(),
        devices: Vec::new(),
    };
    let _ = config::save(&tmp, &persisted).await;

    let loaded = config::load(&tmp).await;
    assert_eq!(loaded.settings.tailcat_enabled, true);
    assert_eq!(loaded.settings.tailcat_address, "tc-roundtrip");
    assert_eq!(loaded.settings.tailcat_port, 43723);

    let _ = std::fs::remove_dir_all(&tmp);
}

#[tokio::test]
async fn put_settings_toggles_tailcat_address_in_state() {
    let state = test_state();
    let router = local_router(state.clone());

    // Initial: tailcat disabled.
    let (_status, body) = call(&router, get("/api/settings", None, None)).await;
    let value: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(value["settings"]["tailcatEnabled"].as_bool(), Some(false));

    // Turn on.
    let mut settings = Settings::default();
    settings.tailcat_enabled = true;
    let body_json = serde_json::to_value(&settings).unwrap();
    let (_status, _) = call(
        &router,
        request("PUT", "/api/settings", None, None)
            .header("content-type", "application/json")
            .body(Body::from(body_json.to_string()))
            .unwrap(),
    )
    .await;
    assert_eq!(_status, StatusCode::OK);

    let (_status, body) = call(&router, get("/api/settings", None, None)).await;
    assert_eq!(_status, StatusCode::OK);
    let value: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(value["settings"]["tailcatEnabled"].as_bool(), Some(true));

    // Turn off.
    settings.tailcat_enabled = false;
    let body_json = serde_json::to_value(&settings).unwrap();
    let (_status, _) = call(
        &router,
        request("PUT", "/api/settings", None, None)
            .header("content-type", "application/json")
            .body(Body::from(body_json.to_string()))
            .unwrap(),
    )
    .await;
    assert_eq!(_status, StatusCode::OK);

    let (_status, body) = call(&router, get("/api/settings", None, None)).await;
    assert_eq!(_status, StatusCode::OK);
    let value: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(value["settings"]["tailcatEnabled"].as_bool(), Some(false));
}

#[tokio::test]
async fn settings_validate_accepts_tailcat_port_values() {
    // 0 means "use the daemon device port"; every in-range u16 is a valid TCP port.
    let mut settings = Settings::default();
    assert!(settings.tailcat_port == 0);
    assert!(settings.validate().is_ok());

    settings.tailcat_port = 43723;
    assert!(settings.validate().is_ok());

    settings.tailcat_port = u16::MAX;
    assert!(settings.validate().is_ok());
}

#[tokio::test]
async fn tailcat_error_display_messages_are_sensible() {
    assert_eq!(
        TailcatError::NotFound("x".into()).to_string(),
        "tailcat binary not found: x"
    );
    assert_eq!(
        TailcatError::Spawn("y".into()).to_string(),
        "failed to spawn tailcat: y"
    );
    assert_eq!(TailcatError::AddressTimeout.to_string(), "timeout waiting for tailcat address");
    assert_eq!(TailcatError::ReadAddress("z".into()).to_string(), "failed to read tailcat address: z");
    assert_eq!(TailcatError::AlreadyRunning.to_string(), "process already running");
    assert_eq!(TailcatError::NotRunning.to_string(), "process not running");
}
