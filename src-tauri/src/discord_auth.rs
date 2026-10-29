use axum::extract::Query;
use axum::response::Html;
use axum::routing::get;
use axum::Router;
use serde::Serialize;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::net::TcpListener;
use tokio::sync::{oneshot, Mutex};

// Fixed, unlike Stremio's ephemeral port: Discord only redirects to a URI registered on
// the application, so this must match DISCORD_REDIRECT_URI on the server
// (http://127.0.0.1:51988/cb).
const PORT: u16 = 51988;
const TIMEOUT_SECS: u64 = 300;

static RUNNING: AtomicBool = AtomicBool::new(false);

const PAGE_OK: &str = r#"<!doctype html><html><head><meta charset="utf-8"><title>Compass</title><style>body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,sans-serif;background:#0d0f14;color:#e9ebf2}.c{text-align:center;max-width:380px;padding:32px}h1{font-size:21px;margin:0 0 10px;font-weight:600}p{color:#9aa1ad;font-size:14px;line-height:1.55;margin:0}</style></head><body><div class="c"><h1>Discord approved</h1><p>You can close this tab and head back to Compass.</p></div></body></html>"#;

const PAGE_FAIL: &str = r#"<!doctype html><html><head><meta charset="utf-8"><title>Compass</title><style>body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,sans-serif;background:#0d0f14;color:#e9ebf2}.c{text-align:center;max-width:380px;padding:32px}p{color:#9aa1ad;font-size:14px;line-height:1.55}</style></head><body><div class="c"><p>Discord did not approve the link. Return to Compass and try again.</p></div></body></html>"#;

#[derive(Clone, Serialize)]
struct DiscordCallback {
    code: String,
    state: String,
    error: String,
}

#[tauri::command]
pub async fn discord_auth_start(app: AppHandle) -> Result<(), String> {
    // A second click while the first listener is still waiting reuses it: the port is
    // fixed, so binding again would fail, and the waiting listener emits the same event.
    if RUNNING.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    let listener = match TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], PORT))).await {
        Ok(l) => l,
        Err(e) => {
            RUNNING.store(false, Ordering::SeqCst);
            return Err(format!("port {} is busy: {}", PORT, e));
        }
    };

    let (tx, rx) = oneshot::channel::<()>();
    let done = Arc::new(Mutex::new(Some(tx)));
    let app_handle = app.clone();

    let router = Router::new().route(
        "/cb",
        get(move |Query(params): Query<HashMap<String, String>>| {
            let app = app_handle.clone();
            let done = done.clone();
            async move {
                let field = |k: &str| params.get(k).cloned().unwrap_or_default();
                let payload = DiscordCallback {
                    code: field("code"),
                    state: field("state"),
                    error: field("error"),
                };
                if payload.code.is_empty() && payload.error.is_empty() {
                    return Html(PAGE_FAIL);
                }
                let ok = !payload.code.is_empty();
                let _ = app.emit("discord-auth", payload);
                if let Some(sender) = done.lock().await.take() {
                    let _ = sender.send(());
                }
                Html(if ok { PAGE_OK } else { PAGE_FAIL })
            }
        }),
    );

    tokio::spawn(async move {
        let shutdown = async {
            tokio::select! {
                _ = rx => {}
                _ = tokio::time::sleep(std::time::Duration::from_secs(TIMEOUT_SECS)) => {}
            }
        };
        let _ = axum::serve(listener, router)
            .with_graceful_shutdown(shutdown)
            .await;
        RUNNING.store(false, Ordering::SeqCst);
    });

    Ok(())
}
