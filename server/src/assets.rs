//! Embedded single-page app.
//!
//! Cache strategy:
//! - `/_app/immutable/**` files are content-hashed by Vite, so they are cached for a year
//!   with `immutable`; a new build produces new file names.
//! - everything else (the SPA shell `200.html`, `_app/version.json`, icons) is served with
//!   `no-cache` plus a strong ETag, so browsers revalidate and get a cheap 304 when nothing
//!   changed, and the new shell immediately after a daemon upgrade.
//! - unknown paths that look like files return 404 instead of the HTML shell, so a stale tab
//!   never receives HTML for a missing script.
//! - client-side routes (`/sessions/abc`, `/devices`, …) fall back to the SPA shell.

use axum::{
    http::{HeaderMap, HeaderValue, StatusCode, Uri, header},
    response::{IntoResponse, Response},
};
use rust_embed::RustEmbed;

#[derive(RustEmbed)]
#[folder = "web-dist/"]
struct WebAssets;

/// Tailcat client runtime vendored in the repository (see `bridge/vendor/`). Embedded
/// directly from its source folder instead of copying it into `web-dist/`, so the
/// ~35 MB WASM binary is not duplicated at build time. Only the two files the client
/// UI needs are embedded; the precompressed `.gz` and the READMEs are not.
#[derive(RustEmbed)]
#[folder = "../bridge/vendor/"]
#[include = "main.wasm"]
#[include = "main.wasm.gz"]
#[include = "wasm_exec.js"]
struct BridgeVendorAssets;

const SPA_SHELL: &str = "200.html";
const IMMUTABLE_PREFIX: &str = "_app/immutable/";

/// App resources remain same-origin. HTTPS frames are reserved for explicit,
/// sandboxed website previews; shared HTML uses a stricter sandboxed srcdoc policy.
/// Inline scripts support SvelteKit/bootstrap and inline styles support the UI.
const CSP: &str = "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; \
img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' https://tailcat.dev ws: wss:; font-src 'self'; object-src 'none'; \
base-uri 'self'; form-action 'self'; frame-src 'self' https:; frame-ancestors 'none'";

fn looks_like_file(path: &str) -> bool {
    path.rsplit('/').next().is_some_and(|segment| segment.contains('.'))
}

pub async fn serve(uri: Uri, request_headers: HeaderMap) -> Response {
    let requested = uri.path().trim_start_matches('/');
    let name = if requested.is_empty() {
        SPA_SHELL
    } else if WebAssets::get(requested).is_some() {
        requested
    } else if requested.starts_with("_app/") || looks_like_file(requested) {
        return (StatusCode::NOT_FOUND, "Not found").into_response();
    } else {
        SPA_SHELL
    };

    let Some(asset) = WebAssets::get(name) else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            "Gentle Companion UI is not built. Run `npm run ui:build` and restart the daemon.",
        )
            .into_response();
    };

    let hash = asset.metadata.sha256_hash();
    // HTML validators cover security-policy changes even when shell bytes match.
    let policy_revision = if name.ends_with(".html") { "-camera-v2-preview-v1" } else { "" };
    let etag = format!("\"{}{policy_revision}\"", hash.iter().take(16).map(|b| format!("{b:02x}")).collect::<String>());
    let cache = if name.starts_with(IMMUTABLE_PREFIX) {
        "public, max-age=31536000, immutable"
    } else {
        "no-cache"
    };

    let mut headers = HeaderMap::new();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static(cache));
    if let Ok(value) = HeaderValue::from_str(&etag) {
        headers.insert(header::ETAG, value);
    }
    headers.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    headers.insert(header::REFERRER_POLICY, HeaderValue::from_static("no-referrer"));
    // A 304 updates the cached response headers, so include policy headers before
    // conditional handling rather than leaving stale camera restrictions in cache.
    if name.ends_with(".html") {
        headers.insert(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static(CSP));
        headers.insert(header::HeaderName::from_static("permissions-policy"), HeaderValue::from_static("camera=(self)"));
        headers.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    }

    let not_modified = request_headers
        .get(header::IF_NONE_MATCH)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.split(',').any(|tag| tag.trim() == etag || tag.trim() == "*"));
    if not_modified {
        return (StatusCode::NOT_MODIFIED, headers).into_response();
    }

    let mime = mime_guess::from_path(name).first_or_octet_stream();
    let content_type = if mime.type_() == "text" || mime.essence_str() == "application/javascript" {
        format!("{}; charset=utf-8", mime.essence_str())
    } else {
        mime.essence_str().to_string()
    };
    if let Ok(value) = HeaderValue::from_str(&content_type) {
        headers.insert(header::CONTENT_TYPE, value);
    }
    (headers, asset.data.into_owned()).into_response()
}

/// Serve the vendored tailcat client runtime from the daemon's origin, on both the
/// console and the device surface, so the client works over LAN and through the
/// tunnel loopback mirror. `WebAssembly.instantiateStreaming` requires the exact
/// `application/wasm` Content-Type, and the Go support script must run as JavaScript.
pub async fn serve_bridge_vendor(uri: Uri, request_headers: HeaderMap) -> Response {
    // Embed keys are relative to the vendor folder ("main.wasm"), while requests
    // arrive as "/bridge/vendor/main.wasm".
    const PREFIX: &str = "bridge/vendor/";
    let requested = uri.path().trim_start_matches('/');
    let name = requested.strip_prefix(PREFIX).unwrap_or(requested);
    let Some(asset) = BridgeVendorAssets::get(name) else {
        return (StatusCode::NOT_FOUND, "Not found").into_response();
    };

    let hash = asset.metadata.sha256_hash();
    let etag = format!("\"{}\"", hash.iter().take(16).map(|b| format!("{b:02x}")).collect::<String>());
    let mut headers = HeaderMap::new();
    // Vendored artifacts change with tailcat releases, so revalidate instead of
    // caching forever.
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    if let Ok(value) = HeaderValue::from_str(&etag) {
        headers.insert(header::ETAG, value);
    }
    headers.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    let not_modified = request_headers
        .get(header::IF_NONE_MATCH)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.split(',').any(|tag| tag.trim() == etag || tag.trim() == "*"));
    if not_modified {
        return (StatusCode::NOT_MODIFIED, headers).into_response();
    }

    let mime = mime_guess::from_path(requested).first_or_octet_stream();
    let content_type = match mime.essence_str() {
        // The contract fixes these types: WebAssembly.instantiateStreaming requires
        // `application/wasm`, and the Go support script must run as JavaScript.
        "application/wasm" => "application/wasm".to_string(),
        "application/javascript" | "text/javascript" => "application/javascript; charset=utf-8".to_string(),
        other => other.to_string(),
    };
    if let Ok(value) = HeaderValue::from_str(&content_type) {
        headers.insert(header::CONTENT_TYPE, value);
    }

    // The Go runtime is ~34 MB raw and a precompressed copy ships next to it. A client
    // that accepts gzip gets ~8 MB instead, which is the difference between the tunnel
    // starting and timing out on mobile data. The wire bytes are gzipped, but the
    // Content-Type stays the uncompressed type and Content-Encoding says how to read
    // them: `instantiateStreaming` still needs `application/wasm`.
    if accepts_gzip(&request_headers) {
        if let Some(compressed) = BridgeVendorAssets::get(&format!("{name}.gz")) {
            headers.insert(header::CONTENT_ENCODING, HeaderValue::from_static("gzip"));
            let mut vary = HeaderValue::from_static("accept-encoding");
            vary.set_sensitive(false);
            headers.insert(header::VARY, vary);
            return (headers, compressed.data.into_owned()).into_response();
        }
    }

    (headers, asset.data.into_owned()).into_response()
}

/// Whether the request advertises gzip support. `q=0` is an explicit refusal, so it
/// must win over a bare token in the same header.
fn accepts_gzip(headers: &HeaderMap) -> bool {
    let Some(value) = headers.get(header::ACCEPT_ENCODING).and_then(|value| value.to_str().ok()) else {
        return false;
    };
    value.split(',').any(|part| {
        let mut pieces = part.split(';');
        let coding = pieces.next().unwrap_or_default().trim();
        if !coding.eq_ignore_ascii_case("gzip") {
            return false;
        }
        !pieces.any(|param| {
            let mut kv = param.split('=');
            let key = kv.next().unwrap_or_default().trim();
            let val = kv.next().unwrap_or_default().trim();
            key.eq_ignore_ascii_case("q") && val.parse::<f32>().is_ok_and(|q| q == 0.0)
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use http_body_util::BodyExt;

    #[tokio::test]
    async fn the_vendored_runtime_is_served_gzipped_when_the_client_accepts_it() {
        let mut request_headers = HeaderMap::new();
        request_headers.insert(header::ACCEPT_ENCODING, HeaderValue::from_static("gzip, deflate, br"));
        let response = serve_bridge_vendor("/bridge/vendor/main.wasm".parse().unwrap(), request_headers).await;

        assert_eq!(response.status(), StatusCode::OK);
        // The wire bytes are compressed, but the type must stay the uncompressed one:
        // WebAssembly.instantiateStreaming rejects anything that is not application/wasm.
        assert_eq!(response.headers()[header::CONTENT_TYPE], "application/wasm");
        assert_eq!(response.headers()[header::CONTENT_ENCODING], "gzip");
        assert_eq!(response.headers()[header::VARY], "accept-encoding");

        let body = response.into_body().collect().await.unwrap().to_bytes();
        assert_eq!(&body[..2], &[0x1f, 0x8b], "a gzip member starts with 1f 8b");
        assert!(body.len() < 12_000_000, "compressed body should be ~8 MB, got {}", body.len());
    }

    #[tokio::test]
    async fn a_client_without_gzip_gets_the_raw_runtime() {
        let response = serve_bridge_vendor("/bridge/vendor/main.wasm".parse().unwrap(), HeaderMap::new()).await;

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::CONTENT_TYPE], "application/wasm");
        assert!(response.headers().get(header::CONTENT_ENCODING).is_none());

        let body = response.into_body().collect().await.unwrap().to_bytes();
        assert_eq!(&body[..4], &[0x00, 0x61, 0x73, 0x6d], "a wasm module starts with \0asm");
    }

    #[tokio::test]
    async fn q_zero_is_a_refusal() {
        let mut request_headers = HeaderMap::new();
        request_headers.insert(header::ACCEPT_ENCODING, HeaderValue::from_static("gzip;q=0, identity"));
        let response = serve_bridge_vendor("/bridge/vendor/main.wasm".parse().unwrap(), request_headers).await;

        assert!(response.headers().get(header::CONTENT_ENCODING).is_none());
    }

    #[tokio::test]
    async fn the_support_script_is_not_compressed() {
        let mut request_headers = HeaderMap::new();
        request_headers.insert(header::ACCEPT_ENCODING, HeaderValue::from_static("gzip"));
        let response = serve_bridge_vendor("/bridge/vendor/wasm_exec.js".parse().unwrap(), request_headers).await;

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::CONTENT_TYPE], "application/javascript; charset=utf-8");
        assert!(response.headers().get(header::CONTENT_ENCODING).is_none());
    }

    #[tokio::test]
    async fn pwa_assets_are_served_with_correct_types_and_revalidation() {
        for (path, expected_type) in [
            ("/manifest.webmanifest", "application/manifest+json"),
            ("/icon-192.png", "image/png"),
            ("/icon-512.png", "image/png"),
        ] {
            let response = serve(path.parse().unwrap(), HeaderMap::new()).await;
            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(response.headers()[header::CONTENT_TYPE], expected_type);
            assert_eq!(response.headers()[header::CACHE_CONTROL], "no-cache");
            let mut headers = HeaderMap::new();
            headers.insert(header::IF_NONE_MATCH, response.headers()[header::ETAG].clone());
            assert_eq!(serve(path.parse().unwrap(), headers).await.status(), StatusCode::NOT_MODIFIED);
            let bytes = response.into_body().collect().await.unwrap().to_bytes();
            assert!(!bytes.is_empty());
        }
    }

    #[tokio::test]
    async fn html_revalidation_refreshes_camera_security_headers() {
        let response = serve("/pair".parse().unwrap(), HeaderMap::new()).await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()["permissions-policy"], "camera=(self)");
        assert!(response.headers()[header::ETAG].to_str().unwrap().contains("-camera-v2"));
        let policy = response.headers()[header::CONTENT_SECURITY_POLICY].to_str().unwrap();
        assert!(policy.contains("media-src 'self' blob:"));
        assert!(policy.contains("frame-src 'self' https:"));
        assert!(policy.contains("frame-ancestors 'none'"));
        assert!(policy.contains("connect-src 'self' https://tailcat.dev ws: wss:"));
        // The canonical tailcat DERP map is the only cross-origin connect the UI needs.
        // The tailcat WASM runtime compiles in the browser: wasm-unsafe-eval, not
        // blanket unsafe-eval (JS is still barred from eval()).
        assert!(policy.contains("script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'"));
        assert!(response.headers()[header::ETAG].to_str().unwrap().contains("-preview-v1"));
        let mut headers = HeaderMap::new();
        headers.insert(header::IF_NONE_MATCH, response.headers()[header::ETAG].clone());
        let revalidated = serve("/pair".parse().unwrap(), headers).await;
        assert_eq!(revalidated.status(), StatusCode::NOT_MODIFIED);
        assert_eq!(revalidated.headers()["permissions-policy"], "camera=(self)");
        assert_eq!(revalidated.headers()[header::CONTENT_SECURITY_POLICY], response.headers()[header::CONTENT_SECURITY_POLICY]);
        assert_eq!(revalidated.headers()[header::X_FRAME_OPTIONS], "DENY");
    }

    #[tokio::test]
    async fn nested_routes_include_the_install_manifest() {
        let response = serve("/sessions/example".parse().unwrap(), HeaderMap::new()).await;
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let html = std::str::from_utf8(&bytes).unwrap();
        assert!(html.contains("/manifest.webmanifest"));
        assert!(html.contains("apple-mobile-web-app-capable"));
    }
}
