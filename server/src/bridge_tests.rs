//! Bridge tests: file scope and endpoint proxy, on both the console and the device surface.

use axum::{
    http::HeaderMap,
    response::Redirect,
    routing::{get as route_get, post as route_post},
};

use super::*;

/// Make the agent "say" something, so references to it count as mentioned.
async fn agent_says(state: &AppState, session_id: &str, text: &str) {
    let message = json!({ "type": "event", "event": "assistant.delta", "payload": { "kind": "text", "delta": text } });
    state.activity.write().await.record(session_id, message);
}

async fn add_session_in(state: &AppState, id: &str, cwd: &FsPath, remote: bool) {
    let snapshot = json!({ "id": id, "remoteEnabled": remote, "status": "idle", "cwd": cwd.to_string_lossy() });
    state.sessions.write().await.insert(id.to_string(), Session { snapshot, command_tx: None });
}

fn bridge_post(router_origin: Option<&str>, token: Option<&str>, path: &str, body: Value) -> HttpRequest<Body> {
    let mut builder = request("POST", path, router_origin, token).header("content-type", "application/json");
    builder = builder.header("user-agent", "TestPhone/1.0");
    builder.body(Body::from(body.to_string())).unwrap()
}

async fn send(router: &Router, request: HttpRequest<Body>) -> (StatusCode, HeaderMap, String) {
    let response = router.clone().oneshot(request).await.expect("router call");
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = response.into_body().collect().await.expect("body").to_bytes();
    (status, headers, String::from_utf8_lossy(&bytes).into_owned())
}

struct Workspace {
    state: AppState,
    cwd: PathBuf,
    outside: PathBuf,
}

async fn workspace(session_id: &str, remote: bool) -> Workspace {
    let state = test_state();
    let root = scratch("work");
    let cwd = root.join("project");
    let outside = root.join("elsewhere");
    fs::create_dir_all(&cwd).await.unwrap();
    fs::create_dir_all(&outside).await.unwrap();
    // Canonical, so macOS /var -> /private/var does not matter to the assertions.
    let cwd = fs::canonicalize(&cwd).await.unwrap();
    let outside = fs::canonicalize(&outside).await.unwrap();
    add_session_in(&state, session_id, &cwd, remote).await;
    Workspace { state, cwd, outside }
}

async fn write_file(path: &FsPath, text: &str) {
    fs::write(path, text).await.unwrap();
}

#[tokio::test]
async fn file_bridge_copies_only_mentioned_files_inside_the_working_directory() {
    let Workspace { state, cwd, outside } = workspace("files", false).await;
    let local = local_router(state.clone());
    let report = cwd.join("report.html");
    let secret_env = cwd.join(".env");
    let elsewhere = outside.join("notes.txt");
    let unmentioned = cwd.join("unmentioned.txt");
    for path in [&report, &secret_env, &elsewhere, &unmentioned] {
        write_file(path, "<h1>hello</h1>").await;
    }
    agent_says(&state, "files", &format!("Wrote {} and docs/relative.md plus {} {} {}", report.display(), secret_env.display(), elsewhere.display(), cwd.join("gone.txt").display())).await;
    fs::create_dir_all(cwd.join("docs")).await.unwrap();
    write_file(&cwd.join("docs/relative.md"), "# rel").await;

    let fetch = |reference: String| bridge_post(None, None, "/api/sessions/files/bridge/file", json!({ "reference": reference }));

    let (status, _, body) = send(&local, fetch(report.to_string_lossy().to_string())).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let file: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(file["name"], "report.html");
    assert_eq!(file["source"], "agent");
    assert!(file.get("origin").is_none(), "host path must not be sent to browsers: {body}");

    // The copy is served by the existing download endpoint.
    let id = file["id"].as_str().unwrap();
    let (status, _, downloaded) = send(&local, get(&format!("/api/sessions/files/files/{id}"), None, None)).await;
    assert_eq!((status, downloaded.as_str()), (StatusCode::OK, "<h1>hello</h1>"));

    // Fetching again refreshes the copy instead of duplicating it.
    write_file(&report, "<h1>v2</h1>").await;
    let (status, _, body) = send(&local, fetch(format!("file://{}", report.display()))).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(session_files(&state, "files").await.len(), 1);
    let new_id = serde_json::from_str::<Value>(&body).unwrap()["id"].as_str().unwrap().to_string();
    assert_ne!(new_id, id);

    // Relative references resolve against the working directory.
    assert_eq!(send(&local, fetch("docs/relative.md".into())).await.0, StatusCode::OK);

    let refused = [
        (unmentioned.to_string_lossy().to_string(), StatusCode::FORBIDDEN, "not mentioned"),
        (elsewhere.to_string_lossy().to_string(), StatusCode::FORBIDDEN, "outside the working directory"),
        (secret_env.to_string_lossy().to_string(), StatusCode::FORBIDDEN, "credential file"),
        (cwd.join("gone.txt").to_string_lossy().to_string(), StatusCode::NOT_FOUND, "missing file"),
        ("https://example.com/a".to_string(), StatusCode::BAD_REQUEST, "not a path"),
    ];
    for (reference, expected, why) in refused {
        let (status, _, body) = send(&local, fetch(reference)).await;
        assert_eq!(status, expected, "{why}: {body}");
    }
    let _ = fs::remove_dir_all(cwd.parent().unwrap()).await;
    let _ = fs::remove_dir_all(&state.temp_root).await;
}

#[cfg(unix)]
#[tokio::test]
async fn file_bridge_resolves_symlinks_before_checking_scope() {
    let Workspace { state, cwd, outside } = workspace("links", false).await;
    let local = local_router(state.clone());
    let target = outside.join("private.txt");
    write_file(&target, "private").await;
    let link = cwd.join("innocent.txt");
    std::os::unix::fs::symlink(&target, &link).unwrap();
    agent_says(&state, "links", &format!("See {}", link.display())).await;
    let (status, _, body) = send(&local, bridge_post(None, None, "/api/sessions/links/bridge/file", json!({ "reference": link.to_string_lossy() }))).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    let _ = fs::remove_dir_all(cwd.parent().unwrap()).await;
}

#[tokio::test]
async fn file_bridge_allows_the_shared_temp_directory() {
    let Workspace { state, cwd, .. } = workspace("temp", false).await;
    let local = local_router(state.clone());
    let shared = state.temp_root.join("shared-note.txt");
    fs::create_dir_all(&state.temp_root).await.unwrap();
    write_file(&shared, "shared").await;
    agent_says(&state, "temp", &format!("Saved {}", shared.display())).await;
    let (status, _, body) = send(&local, bridge_post(None, None, "/api/sessions/temp/bridge/file", json!({ "reference": shared.to_string_lossy() }))).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let _ = fs::remove_dir_all(cwd.parent().unwrap()).await;
    let _ = fs::remove_dir_all(&state.temp_root).await;
}

#[tokio::test]
async fn prompts_cannot_vouch_for_files_and_the_settings_switch_disables_the_bridge() {
    let Workspace { state, cwd, .. } = workspace("vouch", false).await;
    let local = local_router(state.clone());
    let note = cwd.join("note.txt");
    write_file(&note, "note").await;
    let user_message = json!({ "type": "event", "event": "user.message", "payload": { "title": "You", "text": note.to_string_lossy() } });
    state.activity.write().await.record("vouch", user_message);
    let fetch = || bridge_post(None, None, "/api/sessions/vouch/bridge/file", json!({ "reference": note.to_string_lossy() }));
    assert_eq!(send(&local, fetch()).await.0, StatusCode::FORBIDDEN);

    agent_says(&state, "vouch", &format!("Created {}", note.display())).await;
    assert_eq!(send(&local, fetch()).await.0, StatusCode::OK);
    state.settings.write().await.bridge_enabled = false;
    assert_eq!(send(&local, fetch()).await.0, StatusCode::FORBIDDEN);
    let endpoint = bridge_post(None, None, "/api/sessions/vouch/bridge/endpoint", json!({ "url": "http://localhost:3000" }));
    assert_eq!(send(&local, endpoint).await.0, StatusCode::FORBIDDEN);
    let _ = fs::remove_dir_all(cwd.parent().unwrap()).await;
    let _ = fs::remove_dir_all(&state.temp_root).await;
}

#[tokio::test]
async fn devices_need_credentials_and_a_shared_session_for_the_file_bridge() {
    let Workspace { state, cwd, .. } = workspace("remote-files", true).await;
    let remote = remote_router(state.clone());
    let (_, token) = pair(&state).await;
    let note = cwd.join("note.txt");
    write_file(&note, "note").await;
    agent_says(&state, "remote-files", &format!("Created {}", note.display())).await;
    let path = "/api/sessions/remote-files/bridge/file";
    let body = json!({ "reference": note.to_string_lossy() });
    assert_eq!(send(&remote, bridge_post(Some(DEVICE_ORIGIN), None, path, body.clone())).await.0, StatusCode::UNAUTHORIZED);
    assert_eq!(send(&remote, bridge_post(Some(EVIL_ORIGIN), Some(&token), path, body.clone())).await.0, StatusCode::FORBIDDEN);
    assert_eq!(send(&remote, bridge_post(Some(DEVICE_ORIGIN), Some(&token), path, body.clone())).await.0, StatusCode::OK);
    state.sessions.write().await.get_mut("remote-files").unwrap().snapshot["remoteEnabled"] = json!(false);
    assert_eq!(send(&remote, bridge_post(Some(DEVICE_ORIGIN), Some(&token), path, body)).await.0, StatusCode::FORBIDDEN);
    let _ = fs::remove_dir_all(cwd.parent().unwrap()).await;
    let _ = fs::remove_dir_all(&state.temp_root).await;
}

/// A stand-in dev server on loopback.
async fn upstream() -> SocketAddr {
    let app = Router::new()
        .route(
            "/",
            route_get(|| async {
                (
                    [
                        ("content-type", "text/html; charset=utf-8"),
                        ("set-cookie", "upstream=1; Path=/"),
                        ("x-frame-options", "DENY"),
                        ("content-security-policy", "frame-ancestors 'none'"),
                        ("clear-site-data", "\"storage\""),
                    ],
                    r#"<html><head><title>app</title><script src="/main.js"></script></head><body><a href="/about">about</a></body></html>"#,
                )
            }),
        )
        .route("/main.js", route_get(|| async { ([("content-type", "text/javascript")], r#"import x from "/dep.js"; fetch("/api/echo");"#) }))
        .route("/old", route_get(|| async { Redirect::temporary("/new") }))
        .route(
            "/api/echo",
            route_post(|headers: HeaderMap, body: String| async move {
                let cookie = headers.get("cookie").and_then(|value| value.to_str().ok()).unwrap_or("none");
                let host = headers.get("host").and_then(|value| value.to_str().ok()).unwrap_or_default();
                format!("{body}|cookie={cookie}|host={host}")
            }),
        );
    serve(app).await
}

#[tokio::test]
async fn endpoint_proxy_rewrites_pages_and_strips_dangerous_headers() {
    let Workspace { state, cwd, .. } = workspace("proxy", false).await;
    let local = local_router(state.clone());
    let server = upstream().await;
    let origin = format!("http://127.0.0.1:{}", server.port());
    agent_says(&state, "proxy", &format!("Dev server running at {origin}/")).await;

    let open = |url: String| bridge_post(None, None, "/api/sessions/proxy/bridge/endpoint", json!({ "url": url }));
    let (status, _, body) = send(&local, open(format!("{origin}/"))).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let opened: Value = serde_json::from_str(&body).unwrap();
    let path = opened["path"].as_str().unwrap().to_string();
    let prefix = path.trim_end_matches('/').to_string();
    assert!(path.starts_with("/bridge/") && path.ends_with('/'), "{path}");

    let (status, headers, page) = send(&local, get(&path, None, None)).await;
    assert_eq!(status, StatusCode::OK, "{page}");
    assert!(page.contains(&format!("src=\"{prefix}/main.js\"")), "{page}");
    assert!(page.contains(&format!("href=\"{prefix}/about\"")), "{page}");
    assert!(page.contains("window.fetch"), "request shim injected: {page}");
    assert!(headers[header::CONTENT_SECURITY_POLICY].to_str().unwrap().starts_with("sandbox"));
    assert_eq!(headers[header::ACCESS_CONTROL_ALLOW_ORIGIN], "*");
    for dropped in ["set-cookie", "x-frame-options", "clear-site-data"] {
        assert!(headers.get(dropped).is_none(), "{dropped} must not reach the browser");
    }

    let (_, _, script) = send(&local, get(&format!("{prefix}/main.js"), None, None)).await;
    assert!(script.contains(&format!("from \"{prefix}/dep.js\"")), "{script}");

    let (status, headers, _) = send(&local, get(&format!("{prefix}/old"), None, None)).await;
    assert!(status.is_redirection());
    assert_eq!(headers[header::LOCATION], format!("{prefix}/new").as_str());

    // POST bodies pass through; cookies are withheld; Host names the real server.
    let echo = request("POST", &format!("{prefix}/api/echo"), Some("null"), None).header("cookie", "companion=secret").body(Body::from("ping")).unwrap();
    let (status, _, echoed) = send(&local, echo).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(echoed, format!("ping|cookie=none|host=127.0.0.1:{}", server.port()));

    // Sandboxed frames send `Origin: null`; a CORS preflight must succeed too.
    let preflight = request("OPTIONS", &format!("{prefix}/api/echo"), Some("null"), None).header("access-control-request-headers", "content-type").body(Body::empty()).unwrap();
    let (status, headers, _) = send(&local, preflight).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(headers[header::ACCESS_CONTROL_ALLOW_HEADERS], "content-type");

    // Unknown tokens, and the device surface for a console token, are plain 404s.
    assert_eq!(send(&local, get("/bridge/nope/", None, None)).await.0, StatusCode::NOT_FOUND);
    assert_eq!(send(&remote_router(state.clone()), get(&path, None, None)).await.0, StatusCode::NOT_FOUND);

    // Without the setting the token stops working immediately.
    state.settings.write().await.bridge_enabled = false;
    assert_eq!(send(&local, get(&path, None, None)).await.0, StatusCode::FORBIDDEN);
    let _ = fs::remove_dir_all(cwd.parent().unwrap()).await;
}

#[tokio::test]
async fn endpoint_bridge_refuses_remote_hosts_and_unmentioned_servers() {
    let Workspace { state, cwd, .. } = workspace("targets", false).await;
    let local = local_router(state.clone());
    agent_says(&state, "targets", "Try https://example.com and http://192.168.1.5:3000 and http://localhost:3000").await;
    let open = |url: &str| bridge_post(None, None, "/api/sessions/targets/bridge/endpoint", json!({ "url": url }));
    for (url, expected) in [
        ("http://192.168.1.5:3000", StatusCode::BAD_REQUEST),
        ("http://example.com", StatusCode::BAD_REQUEST),
        ("https://localhost:3000", StatusCode::BAD_REQUEST),
        ("http://localhost:4000", StatusCode::FORBIDDEN),
        ("http://localhost:3000", StatusCode::OK),
    ] {
        let (status, _, body) = send(&local, open(url)).await;
        assert_eq!(status, expected, "{url}: {body}");
    }
    let _ = fs::remove_dir_all(cwd.parent().unwrap()).await;
}

#[tokio::test]
async fn device_endpoint_tokens_work_on_the_device_surface_until_revoked() {
    let Workspace { state, cwd, .. } = workspace("device-proxy", true).await;
    let remote = remote_router(state.clone());
    let local = local_router(state.clone());
    let (device_id, token) = pair(&state).await;
    let server = upstream().await;
    let origin = format!("http://localhost:{}", server.port());
    agent_says(&state, "device-proxy", &format!("Serving {origin}")).await;

    let (status, _, body) = send(&remote, bridge_post(Some(DEVICE_ORIGIN), Some(&token), "/api/sessions/device-proxy/bridge/endpoint", json!({ "url": origin }))).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let path = serde_json::from_str::<Value>(&body).unwrap()["path"].as_str().unwrap().to_string();

    // Frames carry no credential and may send `Origin: null`; the token is the credential.
    let (status, _, page) = send(&remote, get(&path, Some("null"), None)).await;
    assert_eq!(status, StatusCode::OK, "{page}");
    assert!(page.contains("<title>app</title>"));
    // A device token is not valid on the console surface.
    assert_eq!(send(&local, get(&path, None, None)).await.0, StatusCode::NOT_FOUND);

    state.devices.write().await.remove(&device_id);
    assert_eq!(send(&remote, get(&path, Some("null"), None)).await.0, StatusCode::UNAUTHORIZED);
    let _ = fs::remove_dir_all(cwd.parent().unwrap()).await;
}
