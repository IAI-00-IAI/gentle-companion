use super::*;

use crate::config::Persisted;
use crate::tailcat::{TailcatError, TailcatManager};

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
async fn tailcat_manager_stop_when_not_running_is_error() {
    let mut manager = TailcatManager::new();
    assert!(matches!(manager.stop().await, Err(TailcatError::NotRunning)));
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
