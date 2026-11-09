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
async fn file_bridge_allows_the_shared_folder_but_not_other_sessions_folders() {
    let Workspace { state, cwd, .. } = workspace("temp", false).await;
    add_session_in(&state, "other", &cwd, false).await;
    let local = local_router(state.clone());
    let shared_dir = state.temp_root.join(bridge::SHARED_FOLDER);
    let other_dir = state.temp_root.join("other");
    for dir in [&shared_dir, &other_dir] {
        fs::create_dir_all(dir).await.unwrap();
    }
    let shared = shared_dir.join("shared-note.txt");
    let private = other_dir.join("id-private.txt");
    write_file(&shared, "shared").await;
    write_file(&private, "private").await;
    agent_says(&state, "temp", &format!("Saved {} and {}", shared.display(), private.display())).await;
    let fetch = |path: &FsPath| bridge_post(None, None, "/api/sessions/temp/bridge/file", json!({ "reference": path.to_string_lossy() }));
    let (status, _, body) = send(&local, fetch(&shared)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, _, body) = send(&local, fetch(&private)).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "another session's upload must stay private: {body}");
    // Not even when the working directory is wide enough to contain the temp root.
    add_session_in(&state, "wide", state.temp_root.parent().unwrap(), false).await;
    agent_says(&state, "wide", &format!("Saved {}", private.display())).await;
    let (status, _, body) = send(&local, bridge_post(None, None, "/api/sessions/wide/bridge/file", json!({ "reference": private.to_string_lossy() }))).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    let _ = fs::remove_dir_all(cwd.parent().unwrap()).await;
    let _ = fs::remove_dir_all(&state.temp_root).await;
}

#[tokio::test]
async fn file_bridge_fails_closed_without_a_usable_working_directory() {
    let state = test_state();
    let local = local_router(state.clone());
    let victim = scratch("victim");
    fs::create_dir_all(&victim).await.unwrap();
    let file = victim.join("notes.txt");
    write_file(&file, "x").await;
    let snapshots = [
        ("missing", json!({ "id": "missing", "remoteEnabled": false, "status": "idle" })),
        ("relative", json!({ "id": "relative", "remoteEnabled": false, "status": "idle", "cwd": "relative/dir" })),
        ("gone", json!({ "id": "gone", "remoteEnabled": false, "status": "idle", "cwd": "/definitely/not/here" })),
        ("root", json!({ "id": "root", "remoteEnabled": false, "status": "idle", "cwd": "/" })),
    ];
    for (id, snapshot) in snapshots {
        state.sessions.write().await.insert(id.to_string(), Session { snapshot, command_tx: None });
        agent_says(&state, id, &format!("Saved {}", file.display())).await;
        let path = format!("/api/sessions/{id}/bridge/file");
        let (status, _, body) = send(&local, bridge_post(None, None, &path, json!({ "reference": file.to_string_lossy() }))).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{id}: {body}");
    }
    let _ = fs::remove_dir_all(&victim).await;
}

#[tokio::test]
async fn file_bridge_mention_must_match_the_whole_path_and_supports_spaces() {
    let Workspace { state, cwd, .. } = workspace("names", false).await;
    let local = local_router(state.clone());
    let spaced_dir = cwd.join("My Docs");
    fs::create_dir_all(&spaced_dir).await.unwrap();
    let plain = cwd.join("report.html");
    let spaced = spaced_dir.join("a b.md");
    let encoded = spaced_dir.join("c d.md");
    for path in [&plain, &spaced, &encoded] {
        write_file(path, "x").await;
    }
    // `report.html.bak` and a longer name are not mentions of `report.html`.
    agent_says(&state, "names", &format!("Wrote {}.bak and {}/a b.md and {}", plain.display(), spaced_dir.display(), cwd.join("My%20Docs/c%20d.md").display())).await;
    let fetch = |path: String| bridge_post(None, None, "/api/sessions/names/bridge/file", json!({ "reference": path }));
    assert_eq!(send(&local, fetch(plain.to_string_lossy().to_string())).await.0, StatusCode::FORBIDDEN);
    assert_eq!(send(&local, fetch(spaced.to_string_lossy().to_string())).await.0, StatusCode::OK);
    // The UI sends a decoded path; the agent wrote it percent-encoded.
    assert_eq!(send(&local, fetch(encoded.to_string_lossy().to_string())).await.0, StatusCode::OK);
    let _ = fs::remove_dir_all(cwd.parent().unwrap()).await;
    let _ = fs::remove_dir_all(&state.temp_root).await;
}

#[tokio::test]
async fn file_bridge_enforces_the_size_limit_while_copying() {
    let Workspace { state, cwd, .. } = workspace("big", false).await;
    let local = local_router(state.clone());
    let big = cwd.join("big.txt");
    write_file(&big, &"x".repeat(2 * 1024 * 1024)).await;
    agent_says(&state, "big", &format!("Wrote {}", big.display())).await;
    state.settings.write().await.max_upload_mb = 1;
    let (status, _, body) = send(&local, bridge_post(None, None, "/api/sessions/big/bridge/file", json!({ "reference": big.to_string_lossy() }))).await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE, "{body}");
    assert!(session_files(&state, "big").await.is_empty());
    let leftovers = std::fs::read_dir(state.temp_root.join("big")).map(|entries| entries.count()).unwrap_or(0);
    assert_eq!(leftovers, 0, "a refused copy leaves nothing behind");
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

#[tokio::test]
async fn companions_own_listeners_cannot_be_bridged() {
    let Workspace { state, cwd, .. } = workspace("self", true).await;
    let local = local_router(state.clone());
    let remote = remote_router(state.clone());
    let (_, token) = pair(&state).await;
    agent_says(&state, "self", "Admin http://127.0.0.1:43721 device http://localhost:43722 and http://[::1]:43721").await;
    for url in ["http://127.0.0.1:43721", "http://localhost:43722", "http://[::1]:43721", "http://0.0.0.0:43721"] {
        let path = "/api/sessions/self/bridge/endpoint";
        let (status, _, body) = send(&local, bridge_post(None, None, path, json!({ "url": url }))).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "console {url}: {body}");
        let (status, _, body) = send(&remote, bridge_post(Some(DEVICE_ORIGIN), Some(&token), path, json!({ "url": url }))).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "device {url}: {body}");
    }
    assert_eq!(state.bridge.lock().await.len(), 0);
    let _ = fs::remove_dir_all(cwd.parent().unwrap()).await;
}

async fn open_device_link(remote: &Router, token: &str, session_id: &str, url: &str) -> String {
    let path = format!("/api/sessions/{session_id}/bridge/endpoint");
    let (status, _, body) = send(remote, bridge_post(Some(DEVICE_ORIGIN), Some(token), &path, json!({ "url": url }))).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    serde_json::from_str::<Value>(&body).unwrap()["path"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn turning_the_bridge_off_and_on_does_not_revive_old_links() {
    let Workspace { state, cwd, .. } = workspace("toggle", true).await;
    let local = local_router(state.clone());
    let remote = remote_router(state.clone());
    let (_, token) = pair(&state).await;
    let server = upstream().await;
    let origin = format!("http://127.0.0.1:{}", server.port());
    agent_says(&state, "toggle", &format!("Serving {origin}")).await;
    let path = open_device_link(&remote, &token, "toggle", &origin).await;
    assert_eq!(send(&remote, get(&path, Some("null"), None)).await.0, StatusCode::OK);

    let (_, _, settings) = send(&local, get("/api/settings", Some(CONSOLE_ORIGIN), None)).await;
    let mut settings: Value = serde_json::from_str::<Value>(&settings).unwrap()["settings"].clone();
    for enabled in [false, true] {
        settings["bridgeEnabled"] = json!(enabled);
        let update = request("PUT", "/api/settings", Some(CONSOLE_ORIGIN), None).header("content-type", "application/json").body(Body::from(settings.to_string())).unwrap();
        assert_eq!(send(&local, update).await.0, StatusCode::OK);
    }
    assert_eq!(send(&remote, get(&path, Some("null"), None)).await.0, StatusCode::NOT_FOUND, "the old link stays dead");
    let fresh = open_device_link(&remote, &token, "toggle", &origin).await;
    assert_ne!(fresh, path);
    assert_eq!(send(&remote, get(&fresh, Some("null"), None)).await.0, StatusCode::OK);
    let _ = fs::remove_dir_all(cwd.parent().unwrap()).await;
}

#[tokio::test]
async fn unsharing_a_session_or_revoking_a_device_ends_its_links_for_good() {
    let state = test_state();
    let local_addr = serve(local_router(state.clone())).await;
    let remote = remote_router(state.clone());
    let local = local_router(state.clone());
    let (device_id, token) = pair(&state).await;
    let mut pi = bridge(local_addr, "shared", true).await;
    let server = upstream().await;
    let origin = format!("http://localhost:{}", server.port());
    agent_says(&state, "shared", &format!("Serving {origin}")).await;
    let path = open_device_link(&remote, &token, "shared", &origin).await;
    assert_eq!(send(&remote, get(&path, Some("null"), None)).await.0, StatusCode::OK);

    send_json(&mut pi, json!({ "type": "session.update", "session": { "remoteEnabled": false } })).await;
    tokio::time::timeout(Duration::from_secs(2), async { while state.bridge.lock().await.len() > 0 { tokio::time::sleep(Duration::from_millis(10)).await; } }).await.expect("links revoked on unshare");
    send_json(&mut pi, json!({ "type": "session.update", "session": { "remoteEnabled": true } })).await;
    tokio::time::timeout(Duration::from_secs(2), async { while state.sessions.read().await["shared"].snapshot["remoteEnabled"] != json!(true) { tokio::time::sleep(Duration::from_millis(10)).await; } }).await.expect("reshared");
    assert_eq!(send(&remote, get(&path, Some("null"), None)).await.0, StatusCode::NOT_FOUND, "resharing must not revive the old link");

    let fresh = open_device_link(&remote, &token, "shared", &origin).await;
    assert_eq!(send(&remote, get(&fresh, Some("null"), None)).await.0, StatusCode::OK);
    let revoke = request("DELETE", &format!("/api/devices/{device_id}"), Some(CONSOLE_ORIGIN), None).body(Body::empty()).unwrap();
    assert_eq!(send(&local, revoke).await.0, StatusCode::NO_CONTENT);
    assert_eq!(state.bridge.lock().await.len(), 0);
}

#[tokio::test]
async fn closing_a_preview_revokes_only_the_openers_link() {
    let Workspace { state, cwd, .. } = workspace("close", true).await;
    let local = local_router(state.clone());
    let remote = remote_router(state.clone());
    let (_, token) = pair(&state).await;
    let (_, other_token) = pair(&state).await;
    let server = upstream().await;
    let origin = format!("http://localhost:{}", server.port());
    agent_says(&state, "close", &format!("Serving {origin}")).await;
    let path = open_device_link(&remote, &token, "close", &origin).await;
    let revoke_path = "/api/sessions/close/bridge/endpoint/revoke";

    // Another device and the console cannot end it; the opener can, even with the bridge off.
    let by_other = bridge_post(Some(DEVICE_ORIGIN), Some(&other_token), revoke_path, json!({ "path": path }));
    assert_eq!(send(&remote, by_other).await.0, StatusCode::NO_CONTENT);
    let by_console = bridge_post(None, None, revoke_path, json!({ "path": path }));
    assert_eq!(send(&local, by_console).await.0, StatusCode::NO_CONTENT);
    assert_eq!(send(&remote, get(&path, Some("null"), None)).await.0, StatusCode::OK, "foreign revoke is a no-op");
    state.settings.write().await.bridge_enabled = false;
    let by_opener = bridge_post(Some(DEVICE_ORIGIN), Some(&token), revoke_path, json!({ "path": path }));
    assert_eq!(send(&remote, by_opener).await.0, StatusCode::NO_CONTENT);
    assert_eq!(state.bridge.lock().await.len(), 0);
    state.settings.write().await.bridge_enabled = true;
    assert_eq!(send(&remote, get(&path, Some("null"), None)).await.0, StatusCode::NOT_FOUND);
    let bad = bridge_post(Some(DEVICE_ORIGIN), Some(&token), revoke_path, json!({ "path": "/etc/passwd" }));
    assert_eq!(send(&remote, bad).await.0, StatusCode::BAD_REQUEST);
    let anonymous = bridge_post(Some(DEVICE_ORIGIN), None, revoke_path, json!({ "path": path }));
    assert_eq!(send(&remote, anonymous).await.0, StatusCode::UNAUTHORIZED);
    let _ = fs::remove_dir_all(cwd.parent().unwrap()).await;
}

#[tokio::test]
async fn relays_are_capped_and_loopback_alias_redirects_stay_in_the_bridge() {
    let Workspace { state, cwd, .. } = workspace("limits", false).await;
    let local = local_router(state.clone());
    let alias = Router::new().route("/go", route_get(|headers: HeaderMap| async move {
        let host = headers.get("host").and_then(|value| value.to_str().ok()).unwrap_or_default().to_string();
        let port = host.rsplit(':').next().unwrap_or_default().to_string();
        Redirect::temporary(&format!("http://127.0.0.1:{port}/login"))
    }));
    let server = serve(alias).await;
    let origin = format!("http://localhost:{}", server.port());
    agent_says(&state, "limits", &format!("Serving {origin}")).await;
    let (_, _, body) = send(&local, bridge_post(None, None, "/api/sessions/limits/bridge/endpoint", json!({ "url": origin }))).await;
    let path = serde_json::from_str::<Value>(&body).unwrap()["path"].as_str().unwrap().to_string();
    let prefix = path.trim_end_matches('/').to_string();

    let (status, headers, _) = send(&local, get(&format!("{prefix}/go"), None, None)).await;
    assert!(status.is_redirection());
    assert_eq!(headers[header::LOCATION], format!("{prefix}/login").as_str(), "127.0.0.1 redirect from a localhost server stays bridged");

    state.bridge_permits.forget_permits(bridge::MAX_CONCURRENT_RELAYS);
    let (status, _, body) = send(&local, get(&format!("{prefix}/go"), None, None)).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE, "{body}");
    let _ = fs::remove_dir_all(cwd.parent().unwrap()).await;
}

#[tokio::test]
async fn two_previews_of_one_server_do_not_share_a_link() {
    let Workspace { state, cwd, .. } = workspace("tabs", true).await;
    let remote = remote_router(state.clone());
    let (_, token) = pair(&state).await;
    let server = upstream().await;
    let origin = format!("http://127.0.0.1:{}", server.port());
    agent_says(&state, "tabs", &format!("Serving {origin}")).await;
    let first = open_device_link(&remote, &token, "tabs", &origin).await;
    let second = open_device_link(&remote, &token, "tabs", &origin).await;
    assert_ne!(first, second, "each preview mints its own link");

    let revoke = bridge_post(Some(DEVICE_ORIGIN), Some(&token), "/api/sessions/tabs/bridge/endpoint/revoke", json!({ "path": first }));
    assert_eq!(send(&remote, revoke).await.0, StatusCode::NO_CONTENT);
    assert_eq!(send(&remote, get(&first, Some("null"), None)).await.0, StatusCode::NOT_FOUND);
    assert_eq!(send(&remote, get(&second, Some("null"), None)).await.0, StatusCode::OK, "closing one tab leaves the other working");
    let _ = fs::remove_dir_all(cwd.parent().unwrap()).await;
}

/// Wait for a condition that a background task will make true.
async fn eventually(what: &str, mut condition: impl AsyncFnMut() -> bool) {
    let waited = tokio::time::timeout(Duration::from_secs(3), async {
        while !condition().await {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await;
    assert!(waited.is_ok(), "timed out waiting for {what}");
}

async fn set_bridge_enabled(local: &Router, enabled: bool) {
    let (_, _, current) = send(local, get("/api/settings", Some(CONSOLE_ORIGIN), None)).await;
    let mut settings: Value = serde_json::from_str::<Value>(&current).unwrap()["settings"].clone();
    settings["bridgeEnabled"] = json!(enabled);
    let update = request("PUT", "/api/settings", Some(CONSOLE_ORIGIN), None).header("content-type", "application/json").body(Body::from(settings.to_string())).unwrap();
    assert_eq!(send(local, update).await.0, StatusCode::OK);
}

#[tokio::test]
async fn a_link_request_that_raced_turning_the_bridge_off_and_on_cannot_mint() {
    let Workspace { state, cwd, .. } = workspace("race-bridge", true).await;
    let local = local_router(state.clone());
    let (device_id, _) = pair(&state).await;
    let server = upstream().await;
    let origin = format!("http://127.0.0.1:{}", server.port());
    agent_says(&state, "race-bridge", &format!("Serving {origin}")).await;

    // The request read the generation, passed every check, and was then overtaken by off -> on.
    let generation = bridge::current_generation(&state).await;
    set_bridge_enabled(&local, false).await;
    set_bridge_enabled(&local, true).await;
    let raced = bridge::open_endpoint(&state, "race-bridge", &origin, bridge::Caller::Device(device_id.clone()), generation).await;
    assert_eq!(raced.unwrap_err().0, StatusCode::CONFLICT, "a token minted after the revocation would be live again");
    assert_eq!(state.bridge.lock().await.len(), 0);

    let fresh = bridge::current_generation(&state).await;
    assert!(bridge::open_endpoint(&state, "race-bridge", &origin, bridge::Caller::Device(device_id), fresh).await.is_ok());
    let _ = fs::remove_dir_all(cwd.parent().unwrap()).await;
}

#[tokio::test]
async fn a_link_request_that_raced_unsharing_and_resharing_cannot_mint() {
    let state = test_state();
    let addr = serve(local_router(state.clone())).await;
    let (device_id, _) = pair(&state).await;
    let mut pi = bridge(addr, "race-share", true).await;
    let server = upstream().await;
    let origin = format!("http://127.0.0.1:{}", server.port());
    agent_says(&state, "race-share", &format!("Serving {origin}")).await;

    let generation = bridge::current_generation(&state).await;
    for shared in [false, true] {
        send_json(&mut pi, json!({ "type": "session.update", "session": { "remoteEnabled": shared } })).await;
        eventually("the share flag to land", async || state.sessions.read().await["race-share"].snapshot["remoteEnabled"] == json!(shared)).await;
    }
    // Sharing is on again, so every permission check would pass; only the generation catches it.
    let raced = bridge::open_endpoint(&state, "race-share", &origin, bridge::Caller::Device(device_id), generation).await;
    assert_eq!(raced.unwrap_err().0, StatusCode::CONFLICT);
    assert_eq!(state.bridge.lock().await.len(), 0);
}

#[tokio::test]
async fn stopping_pi_ends_links_and_blocks_bridging_until_it_reconnects() {
    let state = test_state();
    let local_addr = serve(local_router(state.clone())).await;
    let local = local_router(state.clone());
    let remote = remote_router(state.clone());
    let (_, token) = pair(&state).await;
    let pi = bridge(local_addr, "stopping", true).await;
    let server = upstream().await;
    let origin = format!("http://127.0.0.1:{}", server.port());
    agent_says(&state, "stopping", &format!("Serving {origin}")).await;
    let path = open_device_link(&remote, &token, "stopping", &origin).await;
    assert_eq!(send(&remote, get(&path, Some("null"), None)).await.0, StatusCode::OK);

    drop(pi);
    eventually("the session to stop", async || state.sessions.read().await["stopping"].snapshot["status"] == json!("stopped")).await;
    assert_eq!(state.bridge.lock().await.len(), 0, "stopping Pi ends every link");
    assert_eq!(send(&remote, get(&path, Some("null"), None)).await.0, StatusCode::NOT_FOUND);

    let open = bridge_post(Some(DEVICE_ORIGIN), Some(&token), "/api/sessions/stopping/bridge/endpoint", json!({ "url": origin }));
    assert_eq!(send(&remote, open).await.0, StatusCode::CONFLICT, "no new links while Pi is away");
    let file = bridge_post(Some(DEVICE_ORIGIN), Some(&token), "/api/sessions/stopping/bridge/file", json!({ "reference": "/tmp/anything.txt" }));
    assert_eq!(send(&remote, file).await.0, StatusCode::CONFLICT, "no file copies while Pi is away");
    let console = bridge_post(None, None, "/api/sessions/stopping/bridge/endpoint", json!({ "url": origin }));
    assert_eq!(send(&local, console).await.0, StatusCode::CONFLICT);

    // Reconnecting does not revive the old link; a new one works.
    let _pi = bridge(local_addr, "stopping", true).await;
    assert_eq!(send(&remote, get(&path, Some("null"), None)).await.0, StatusCode::NOT_FOUND);
    let fresh = open_device_link(&remote, &token, "stopping", &origin).await;
    assert_eq!(send(&remote, get(&fresh, Some("null"), None)).await.0, StatusCode::OK);
}

/// A server that streams one chunk every 20 ms, forever.
async fn endless_stream() -> SocketAddr {
    let app = Router::new().route("/stream", route_get(|| async {
        let chunks = futures_util::stream::unfold((), |()| async {
            tokio::time::sleep(Duration::from_millis(20)).await;
            Some((Ok::<_, std::io::Error>(axum::body::Bytes::from_static(b"tick\n")), ()))
        });
        Body::from_stream(chunks)
    }));
    serve(app).await
}

async fn read_until_cut(response: axum::response::Response) -> bool {
    let mut body = response.into_body().into_data_stream();
    let cut = tokio::time::timeout(Duration::from_secs(3), async {
        while let Some(chunk) = futures_util::StreamExt::next(&mut body).await {
            if chunk.is_err() {
                return;
            }
        }
    })
    .await;
    cut.is_ok()
}

#[tokio::test]
async fn revoking_a_link_cuts_a_response_that_is_already_streaming() {
    let Workspace { state, cwd, .. } = workspace("cut", true).await;
    let local = local_router(state.clone());
    let remote = remote_router(state.clone());
    let (_, token) = pair(&state).await;
    let server = endless_stream().await;
    let origin = format!("http://127.0.0.1:{}", server.port());
    agent_says(&state, "cut", &format!("Serving {origin}")).await;
    let revoke_path = "/api/sessions/cut/bridge/endpoint/revoke";

    // 1. The opener closes the preview while a body is mid-stream.
    let path = open_device_link(&remote, &token, "cut", &origin).await;
    let response = remote.clone().oneshot(get(&format!("{}stream", path.trim_end_matches(&['/', '?'][..]).to_string() + "/"), Some("null"), None)).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let revoke = bridge_post(Some(DEVICE_ORIGIN), Some(&token), revoke_path, json!({ "path": path }));
    assert_eq!(send(&remote, revoke).await.0, StatusCode::NO_CONTENT);
    assert!(read_until_cut(response).await, "closing the preview must end the stream, not let it run for minutes");

    // 2. Unsharing the session while a body is mid-stream.
    let path = open_device_link(&remote, &token, "cut", &origin).await;
    let response = remote.clone().oneshot(get(&format!("{}/stream", path.trim_end_matches('/')), Some("null"), None)).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    state.bridge.lock().await.revoke_session_devices("cut");
    assert!(read_until_cut(response).await, "unsharing must end the stream");

    // 3. The bridge is switched off while a console body is mid-stream.
    let (_, _, body) = send(&local, bridge_post(None, None, "/api/sessions/cut/bridge/endpoint", json!({ "url": origin }))).await;
    let path = serde_json::from_str::<Value>(&body).unwrap()["path"].as_str().unwrap().to_string();
    let response = local.clone().oneshot(get(&format!("{}/stream", path.trim_end_matches('/')), None, None)).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    set_bridge_enabled(&local, false).await;
    assert!(read_until_cut(response).await, "turning the bridge off must end the stream");
    let _ = fs::remove_dir_all(cwd.parent().unwrap()).await;
}

#[tokio::test]
async fn open_previews_renew_their_lease_and_only_the_opener_can() {
    let Workspace { state, cwd, .. } = workspace("lease", true).await;
    let local = local_router(state.clone());
    let remote = remote_router(state.clone());
    let (_, token) = pair(&state).await;
    let (_, other_token) = pair(&state).await;
    let server = upstream().await;
    let origin = format!("http://127.0.0.1:{}", server.port());
    agent_says(&state, "lease", &format!("Serving {origin}")).await;
    let (_, _, minted) = send(&remote, bridge_post(Some(DEVICE_ORIGIN), Some(&token), "/api/sessions/lease/bridge/endpoint", json!({ "url": origin }))).await;
    let minted: Value = serde_json::from_str(&minted).unwrap();
    assert_eq!(minted["leaseSeconds"], bridge::ENDPOINT_LEASE_SECS);
    let path = minted["path"].as_str().unwrap().to_string();
    let renew_path = "/api/sessions/lease/bridge/endpoint/renew";

    let by_opener = bridge_post(Some(DEVICE_ORIGIN), Some(&token), renew_path, json!({ "path": path }));
    assert_eq!(send(&remote, by_opener).await.0, StatusCode::NO_CONTENT);
    let by_other = bridge_post(Some(DEVICE_ORIGIN), Some(&other_token), renew_path, json!({ "path": path }));
    assert_eq!(send(&remote, by_other).await.0, StatusCode::NOT_FOUND);
    let by_console = bridge_post(None, None, renew_path, json!({ "path": path }));
    assert_eq!(send(&local, by_console).await.0, StatusCode::NOT_FOUND);

    // Once the link has ended, a renewal says so and does not bring it back.
    state.bridge.lock().await.revoke_session("lease");
    let late = bridge_post(Some(DEVICE_ORIGIN), Some(&token), renew_path, json!({ "path": path }));
    assert_eq!(send(&remote, late).await.0, StatusCode::NOT_FOUND);
    let _ = fs::remove_dir_all(cwd.parent().unwrap()).await;
}

#[tokio::test]
async fn simultaneous_file_copies_are_capped() {
    let Workspace { state, cwd, .. } = workspace("copies", false).await;
    let local = local_router(state.clone());
    let file = cwd.join("a.txt");
    write_file(&file, "a").await;
    agent_says(&state, "copies", &format!("Wrote {}", file.display())).await;
    let fetch = || bridge_post(None, None, "/api/sessions/copies/bridge/file", json!({ "reference": file.to_string_lossy() }));
    state.bridge_copy_permits.forget_permits(bridge::MAX_CONCURRENT_COPIES);
    let (status, _, body) = send(&local, fetch()).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE, "{body}");
    state.bridge_copy_permits.add_permits(bridge::MAX_CONCURRENT_COPIES);
    assert_eq!(send(&local, fetch()).await.0, StatusCode::OK);
    let _ = fs::remove_dir_all(cwd.parent().unwrap()).await;
    let _ = fs::remove_dir_all(&state.temp_root).await;
}

/// Start a file fetch and hold it at the last step: the file has been copied to disk but is not yet
/// recorded, because the test holds the files lock. Returns the pending request.
async fn fetch_held_before_recording(
    state: &AppState,
    router: Router,
    request: HttpRequest<Body>,
    session_id: &str,
) -> (tokio::sync::OwnedRwLockWriteGuard<HashMap<String, Vec<TempFile>>>, tokio::task::JoinHandle<(StatusCode, HeaderMap, String)>) {
    let held = state.files.clone().write_owned().await;
    let pending = tokio::spawn(async move { send(&router, request).await });
    let session_dir = state.temp_root.join(session_id);
    eventually("the copy to reach the disk", async || {
        std::fs::read_dir(&session_dir).map(|entries| entries.count() > 0).unwrap_or(false)
    })
    .await;
    (held, pending)
}

async fn files_on_disk(state: &AppState, session_id: &str) -> usize {
    std::fs::read_dir(state.temp_root.join(session_id)).map(|entries| entries.count()).unwrap_or(0)
}

#[tokio::test]
async fn a_file_copy_in_flight_when_the_bridge_is_turned_off_is_not_kept() {
    let Workspace { state, cwd, .. } = workspace("late-off", false).await;
    let local = local_router(state.clone());
    let file = cwd.join("report.txt");
    write_file(&file, "report").await;
    agent_says(&state, "late-off", &format!("Wrote {}", file.display())).await;
    let fetch = bridge_post(None, None, "/api/sessions/late-off/bridge/file", json!({ "reference": file.to_string_lossy() }));
    let (held, pending) = fetch_held_before_recording(&state, local.clone(), fetch, "late-off").await;

    // Off, then on again: the permissions look fine by the time the copy finishes, but it started
    // before the withdrawal and must not survive it.
    set_bridge_enabled(&local, false).await;
    set_bridge_enabled(&local, true).await;
    drop(held);
    let (status, _, body) = pending.await.unwrap();
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert!(session_files(&state, "late-off").await.is_empty(), "no registered file");
    assert_eq!(files_on_disk(&state, "late-off").await, 0, "no copy left on disk");

    // Turned off for good while a copy is in flight: also refused.
    let fetch = bridge_post(None, None, "/api/sessions/late-off/bridge/file", json!({ "reference": file.to_string_lossy() }));
    let (held, pending) = fetch_held_before_recording(&state, local.clone(), fetch, "late-off").await;
    set_bridge_enabled(&local, false).await;
    drop(held);
    assert_eq!(pending.await.unwrap().0, StatusCode::CONFLICT);
    assert!(session_files(&state, "late-off").await.is_empty());
    assert_eq!(files_on_disk(&state, "late-off").await, 0);
    let _ = fs::remove_dir_all(cwd.parent().unwrap()).await;
    let _ = fs::remove_dir_all(&state.temp_root).await;
}

#[tokio::test]
async fn a_file_copy_in_flight_when_the_session_is_unshared_or_pi_stops_is_not_kept() {
    let state = test_state();
    let addr = serve(local_router(state.clone())).await;
    let remote = remote_router(state.clone());
    let (_, token) = pair(&state).await;
    let root = scratch("late-share");
    fs::create_dir_all(&root).await.unwrap();
    let root = fs::canonicalize(&root).await.unwrap();
    let file = root.join("report.txt");
    write_file(&file, "report").await;
    let mut pi = bridge(addr, "late-share", true).await;
    send_json(&mut pi, json!({ "type": "session.update", "session": { "cwd": root.to_string_lossy() } })).await;
    eventually("cwd", async || state.sessions.read().await["late-share"].snapshot["cwd"] == json!(root.to_string_lossy())).await;
    agent_says(&state, "late-share", &format!("Wrote {}", file.display())).await;
    let fetch = || bridge_post(Some(DEVICE_ORIGIN), Some(&token), "/api/sessions/late-share/bridge/file", json!({ "reference": file.to_string_lossy() }));

    // Unshared while the copy runs, and shared again before it finishes.
    let (held, pending) = fetch_held_before_recording(&state, remote.clone(), fetch(), "late-share").await;
    for shared in [false, true] {
        send_json(&mut pi, json!({ "type": "session.update", "session": { "remoteEnabled": shared } })).await;
        eventually("the share flag", async || state.sessions.read().await["late-share"].snapshot["remoteEnabled"] == json!(shared)).await;
    }
    drop(held);
    assert_eq!(pending.await.unwrap().0, StatusCode::CONFLICT);
    assert!(session_files(&state, "late-share").await.is_empty());
    assert_eq!(files_on_disk(&state, "late-share").await, 0, "resharing must not expose a copy made while unshared");

    // Pi stops while the copy runs.
    let (held, pending) = fetch_held_before_recording(&state, remote.clone(), fetch(), "late-share").await;
    drop(pi);
    eventually("the session to stop", async || state.sessions.read().await["late-share"].snapshot["status"] == json!("stopped")).await;
    drop(held);
    assert_eq!(pending.await.unwrap().0, StatusCode::CONFLICT);
    assert!(session_files(&state, "late-share").await.is_empty());
    assert_eq!(files_on_disk(&state, "late-share").await, 0);
    let _ = fs::remove_dir_all(&root).await;
    let _ = fs::remove_dir_all(&state.temp_root).await;
}
