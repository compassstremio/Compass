use std::sync::OnceLock;

use regex::Regex;

const REDACTED: &str = "[REDACTED]";

struct ScrubRules {
    network_url: Regex,
    request_target: Regex,
    private_header: Regex,
    bearer: Regex,
    authorization: Regex,
    storage_key: Regex,
    key_value: Regex,
    email: Regex,
    user_path: Regex,
    ip_addr: Regex,
    path_seg: Regex,
    base64_token: Regex,
    long_token: Regex,
}

fn rules() -> &'static ScrubRules {
    static RULES: OnceLock<ScrubRules> = OnceLock::new();
    RULES.get_or_init(|| ScrubRules {
        network_url: Regex::new(r#"(?i)\b(?:https?|ftp|rtsp|rtmp|smb)://[^\s\"'<>]+"#).unwrap(),
        request_target: Regex::new(
            r"(?i)\b(GET|POST|HEAD|PUT|PATCH|DELETE|OPTIONS)\s+\S+(\s+HTTP/\d(?:\.\d)?)",
        )
        .unwrap(),
        private_header: Regex::new(
            r"(?im)\b(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token|api-key)\s*:\s*[^\r\n]*",
        )
        .unwrap(),
        bearer: Regex::new(r"(?i)bearer\s+[A-Za-z0-9._~+/=\-]{8,}").unwrap(),
        authorization: Regex::new(
            r#"(?i)(authorization"?\s*[:=]\s*"?)(bearer\s+|basic\s+)?([^"'\s,;&}\)]+)"#,
        )
        .unwrap(),
        storage_key: Regex::new(
            r#"(?i)(compass\.(?:theme-session|session\.token|auth(?:\.[A-Za-z0-9_.-]+)?))("?\s*[:=]\s*"?)([^"'\s,;&}\)]+)"#,
        )
        .unwrap(),
        key_value: Regex::new(
            r#"(?i)(auth[_-]?key|api[_-]?key|access[_-]?token|refresh[_-]?token|session[_-]?token|client[_-]?secret|secret|token|password|passwd|pwd)("?\s*[:=]\s*"?)([^"'\s,;&}\)]+)"#,
        )
        .unwrap(),
        email: Regex::new(r"(?i)[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}").unwrap(),
        user_path: Regex::new(r#"(?i)([A-Za-z]:[\\/]+Users[\\/]+|/Users/|/home/)([^\\/\s"']+)"#)
            .unwrap(),
        ip_addr: Regex::new(r"\b(?:\d{1,3}\.){3}\d{1,3}\b").unwrap(),
        path_seg: Regex::new(r"(/)([A-Za-z0-9_+=\-]{12,})").unwrap(),
        base64_token: Regex::new(r"[A-Za-z0-9+/]{32,}={0,2}").unwrap(),
        long_token: Regex::new(r"[A-Za-z0-9_\-]{20,}").unwrap(),
    })
}

pub fn scrub(text: &str) -> String {
    let r = rules();
    // A playback URL's path can be the credential itself, even without a named token parameter.
    let urls =
        r.network_url
            .replace_all(text, |c: &regex::Captures| match url::Url::parse(&c[0]) {
                Ok(url) if url.host_str().is_some() => {
                    let port = url.port().map(|p| format!(":{p}")).unwrap_or_default();
                    format!(
                        "{}://{}{port}/{REDACTED}",
                        url.scheme(),
                        url.host_str().unwrap()
                    )
                }
                _ => REDACTED.to_string(),
            });
    let requests = r.request_target.replace_all(&urls, |c: &regex::Captures| {
        format!("{} {REDACTED}{}", &c[1], &c[2])
    });
    let headers = r
        .private_header
        .replace_all(&requests, |c: &regex::Captures| {
            let bearer = if c[0].to_ascii_lowercase().contains(": bearer ") {
                "Bearer "
            } else {
                ""
            };
            format!("{}: {bearer}{REDACTED}", &c[1])
        });
    let step1 = r
        .bearer
        .replace_all(&headers, |_: &regex::Captures| format!("Bearer {REDACTED}"));
    let step2 = r.authorization.replace_all(&step1, |c: &regex::Captures| {
        format!("{}{}{}", &c[1], &c[2], REDACTED)
    });
    let step3 = r.storage_key.replace_all(&step2, |c: &regex::Captures| {
        format!("{}{}{}", &c[1], &c[2], REDACTED)
    });
    let step4 = r.key_value.replace_all(&step3, |c: &regex::Captures| {
        format!("{}{}{}", &c[1], &c[2], REDACTED)
    });
    let step5 = r.email.replace_all(&step4, "<email>");
    let step6 = r
        .user_path
        .replace_all(&step5, |c: &regex::Captures| format!("{}<user>", &c[1]));
    let step7 = r.ip_addr.replace_all(&step6, "<ip>");
    let step8 = r.path_seg.replace_all(&step7, |c: &regex::Captures| {
        format!("{}{}", &c[1], REDACTED)
    });
    let step9 = r.base64_token.replace_all(&step8, REDACTED);
    r.long_token.replace_all(&step9, REDACTED).into_owned()
}

pub fn start_log(path: &std::path::Path) -> std::io::Result<std::sync::mpsc::SyncSender<String>> {
    use std::io::Write;

    // Only this worker writes the log; mpv's raw log-file output bypasses redaction.
    let mut file = std::fs::File::create(path)?;
    let (send, receive) = std::sync::mpsc::sync_channel::<String>(256);
    std::thread::Builder::new()
        .name("mpv-log".into())
        .spawn(move || {
            for message in receive {
                if writeln!(file, "{}", scrub(&message)).is_err() {
                    break;
                }
            }
        })?;
    Ok(send)
}

#[cfg(test)]
mod tests {
    use super::scrub;

    #[test]
    fn hides_torbox_and_other_provider_urls_without_changing_the_input() {
        for input in [
            "Opening https://cdn.torbox.app/download/short-key/file.mkv?token=other-key",
            "https://api.torbox.app/v1/api/torrents/requestdl?token=short&file_id=1",
            "https://user:pass@host.example:8443/d/short/file.mkv#secret",
            "https://real-debrid.example/d/short/file.mkv",
            "https://host.example/%73ecret/file.mkv?api_key=short",
        ] {
            let original = input.to_owned();
            let out = scrub(input);
            assert!(out.contains("[REDACTED]"));
            for secret in ["short", "other-key", "user:pass", "%73ecret", "file.mkv"] {
                assert!(!out.contains(secret), "{out}");
            }
            assert_eq!(input, original);
        }
    }

    #[test]
    fn hides_relative_http_targets_and_private_headers() {
        let out = scrub("GET /download/short?token=key HTTP/1.1\r\nAuthorization: Bearer tiny\r\nCookie: session=small; other=secret\r\nX-Api-Key: key\r\nHTTP/1.1 403 Forbidden");
        assert!(out.contains("GET [REDACTED] HTTP/1.1"));
        assert!(out.contains("HTTP/1.1 403 Forbidden"));
        for secret in ["short", "tiny", "small", "secret", ": key"] {
            assert!(!out.contains(secret), "{out}");
        }
    }

    #[test]
    fn preserves_playback_diagnostics_and_scrubs_legacy_log_exports() {
        assert_eq!(
            scrub("[vo/gpu] Vulkan initialized; dropped frames: 3"),
            "[vo/gpu] Vulkan initialized; dropped frames: 3"
        );
        let out = scrub("[ffmpeg] https://cdn.torbox.app/tiny/file: HTTP error 403");
        assert!(out.contains("cdn.torbox.app"));
        assert!(out.contains("HTTP error 403"));
        assert!(!out.contains("tiny"));
        assert_eq!(scrub(&out), out);
    }

    #[test]
    fn log_worker_replaces_old_raw_logs_and_writes_only_scrubbed_messages() {
        let path = std::env::temp_dir().join(format!(
            "compass-log-privacy-{}-{}.log",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::write(&path, "old-api-key").unwrap();
        let send = super::start_log(&path).unwrap();
        send.send("[ffmpeg] https://cdn.torbox.app/private-api-key/movie.mkv".into())
            .unwrap();
        send.send("HTTP error 403".into()).unwrap();
        drop(send);
        let mut output = String::new();
        for _ in 0..100 {
            output = std::fs::read_to_string(&path).unwrap();
            if output.contains("HTTP error 403") {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        assert!(output.contains("HTTP error 403"));
        assert!(output.contains("[REDACTED]"));
        assert!(!output.contains("private-api-key"));
        assert!(!output.contains("old-api-key"));
        std::fs::remove_file(path).unwrap();
    }
}
