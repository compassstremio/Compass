use std::collections::HashMap;
use std::error::Error as StdError;
use std::sync::OnceLock;
use std::time::Duration;

use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaServerRequestArgs {
    origin: String,
    url: String,
    method: Option<String>,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
    timeout_ms: Option<u64>,
}

#[derive(Serialize)]
pub struct MediaServerResponse {
    status: u16,
    headers: HashMap<String, String>,
    body: String,
}

fn client() -> Result<&'static reqwest::Client, String> {
    static CLIENT: OnceLock<Result<reqwest::Client, String>> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(Duration::from_secs(10))
                // Media servers are user-configured hosts, frequently on the LAN
                // or a tailnet. Environment proxies (HTTPS_PROXY/ALL_PROXY, set
                // by VPN and proxy tools) would otherwise capture these requests
                // and fail, even though a browser reaches the same address.
                // Every other Compass HTTP client disables the proxy; match them.
                .no_proxy()
                .build()
                .map_err(|e| e.to_string())
        })
        .as_ref()
        .map_err(Clone::clone)
}

/// reqwest's `Display` stops at "error sending request for url (...)", which
/// hides whether the failure was DNS, a refused connection, or a rejected
/// certificate. Walk the source chain so the interface can show the cause.
fn describe_error(error: &reqwest::Error) -> String {
    let mut message = error.to_string();
    let mut source = StdError::source(error);
    while let Some(cause) = source {
        let text = cause.to_string();
        if !text.is_empty() && !message.contains(&text) {
            message.push_str(": ");
            message.push_str(&text);
        }
        source = cause.source();
    }
    message
}

fn normalized_origin(value: &str) -> Result<reqwest::Url, String> {
    let mut url = reqwest::Url::parse(value)
        .map_err(|_| "invalid configured media server origin".to_string())?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("invalid configured media server origin".into());
    }
    url.set_query(None);
    url.set_fragment(None);
    url.set_path("");
    Ok(url)
}

fn same_origin(a: &reqwest::Url, b: &reqwest::Url) -> bool {
    a.scheme() == b.scheme()
        && a.host_str() == b.host_str()
        && a.port_or_known_default() == b.port_or_known_default()
}

#[tauri::command]
pub async fn media_server_request(
    args: MediaServerRequestArgs,
) -> Result<MediaServerResponse, String> {
    let origin = normalized_origin(&args.origin)?;
    let target =
        reqwest::Url::parse(&args.url).map_err(|_| "invalid media server URL".to_string())?;
    if !same_origin(&origin, &target)
        || !target.username().is_empty()
        || target.password().is_some()
    {
        return Err("media server request is outside the configured origin".into());
    }
    let method = reqwest::Method::from_bytes(args.method.as_deref().unwrap_or("GET").as_bytes())
        .map_err(|_| "invalid method".to_string())?;
    let mut request = client()?
        .request(method, target)
        .timeout(Duration::from_millis(
            args.timeout_ms.unwrap_or(30_000).min(120_000),
        ));
    for (name, value) in args.headers.unwrap_or_default() {
        let lower = name.to_ascii_lowercase();
        if matches!(lower.as_str(), "host" | "content-length" | "connection") {
            continue;
        }
        request = request.header(name, value);
    }
    if let Some(body) = args.body {
        request = request
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(body);
    }
    let response = request
        .send()
        .await
        .map_err(|e| format!("media server request failed: {}", describe_error(&e)))?;
    if response.status().is_redirection() {
        return Err("media server redirects are not followed".into());
    }
    let status = response.status().as_u16();
    let headers = response
        .headers()
        .iter()
        .filter_map(|(k, v)| v.to_str().ok().map(|v| (k.to_string(), v.to_string())))
        .collect();
    let body = response
        .text()
        .await
        .map_err(|e| format!("media server response failed: {}", describe_error(&e)))?;
    Ok(MediaServerResponse {
        status,
        headers,
        body,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Sets proxy environment variables for the duration of a test and restores
    /// them afterwards, even if the test panics.
    struct ProxyEnv(Vec<(&'static str, Option<String>)>);

    impl ProxyEnv {
        fn set(pairs: &[(&'static str, &str)]) -> Self {
            let saved = pairs
                .iter()
                .map(|(key, value)| {
                    let previous = std::env::var(key).ok();
                    std::env::set_var(key, value);
                    (*key, previous)
                })
                .collect();
            Self(saved)
        }
    }

    impl Drop for ProxyEnv {
        fn drop(&mut self) {
            for (key, previous) in self.0.drain(..) {
                match previous {
                    Some(value) => std::env::set_var(key, value),
                    None => std::env::remove_var(key),
                }
            }
        }
    }

    #[test]
    fn origin_comparison_includes_scheme_and_port() {
        let a = reqwest::Url::parse("http://server:8096/a").unwrap();
        assert!(same_origin(
            &a,
            &reqwest::Url::parse("http://server:8096/b").unwrap()
        ));
        assert!(!same_origin(
            &a,
            &reqwest::Url::parse("https://server:8096/b").unwrap()
        ));
        assert!(!same_origin(
            &a,
            &reqwest::Url::parse("http://server:8097/b").unwrap()
        ));
    }

    #[tokio::test]
    async fn reaches_a_local_server_even_when_a_proxy_is_configured() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind test server");
        let addr = listener.local_addr().expect("test server address");
        let app = axum::Router::new().route(
            "/Users/AuthenticateByName",
            axum::routing::post(|| async {
                axum::Json(serde_json::json!({
                    "AccessToken": "token",
                    "User": { "Id": "user", "Name": "name" }
                }))
            }),
        );
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });

        // A proxy that cannot reach anything. Without `.no_proxy()` the request
        // would be routed here and fail with "error sending request". NO_PROXY
        // is cleared so a loopback host is not exempted by the machine.
        let _proxy = ProxyEnv::set(&[
            ("HTTP_PROXY", "http://127.0.0.1:1"),
            ("ALL_PROXY", "http://127.0.0.1:1"),
            ("NO_PROXY", ""),
            ("no_proxy", ""),
        ]);

        let origin = format!("http://{addr}");
        let response = media_server_request(MediaServerRequestArgs {
            origin: origin.clone(),
            url: format!("{origin}/Users/AuthenticateByName"),
            method: Some("POST".to_string()),
            headers: None,
            body: Some(r#"{"Username":"user","Pw":"password"}"#.to_string()),
            timeout_ms: Some(5_000),
        })
        .await
        .expect("a local media server is reached without the proxy");

        server.abort();
        assert_eq!(response.status, 200);
        let body: serde_json::Value = serde_json::from_str(&response.body).expect("json body");
        assert_eq!(body["AccessToken"], "token");
    }
}
