/// SMTC timelines are measured in 100 ns ticks. Returns (end, position), or None without a
/// usable duration; the position is clamped into the track so a late tick can't exceed it.
#[cfg_attr(not(windows), allow(dead_code))]
fn timeline_ticks(duration_sec: Option<f64>, position_sec: Option<f64>) -> Option<(i64, i64)> {
    const TICKS: f64 = 10_000_000.0;
    let duration = duration_sec.filter(|d| d.is_finite() && *d > 0.0)?;
    let end = (duration * TICKS) as i64;
    let position = position_sec
        .filter(|p| p.is_finite())
        .map_or(0, |p| ((p.max(0.0) * TICKS) as i64).min(end));
    Some((end, position))
}

#[cfg(test)]
mod timeline_tests {
    use super::timeline_ticks;

    #[test]
    fn converts_seconds_to_ticks_and_clamps_position() {
        assert_eq!(timeline_ticks(Some(200.0), Some(12.5)), Some((2_000_000_000, 125_000_000)));
        assert_eq!(timeline_ticks(Some(10.0), Some(99.0)), Some((100_000_000, 100_000_000)));
        assert_eq!(timeline_ticks(Some(10.0), Some(-3.0)), Some((100_000_000, 0)));
        assert_eq!(timeline_ticks(Some(10.0), None), Some((100_000_000, 0)));
    }

    #[test]
    fn rejects_unusable_durations() {
        assert_eq!(timeline_ticks(None, Some(1.0)), None);
        assert_eq!(timeline_ticks(Some(0.0), Some(1.0)), None);
        assert_eq!(timeline_ticks(Some(f64::NAN), Some(1.0)), None);
        assert_eq!(timeline_ticks(Some(f64::INFINITY), Some(1.0)), None);
        assert_eq!(timeline_ticks(Some(10.0), Some(f64::NAN)), Some((100_000_000, 0)));
    }
}

#[cfg(windows)]
mod win {
    use std::sync::{Mutex, OnceLock};
    use tauri::{AppHandle, Emitter, Manager};
    use windows::core::HSTRING;
    use windows::Foundation::{TimeSpan, TypedEventHandler, Uri};
    use windows::Media::{
        MediaPlaybackStatus, MediaPlaybackType, SystemMediaTransportControls,
        SystemMediaTransportControlsButton, SystemMediaTransportControlsButtonPressedEventArgs,
        SystemMediaTransportControlsTimelineProperties,
    };
    use windows::Storage::Streams::RandomAccessStreamReference;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::WinRT::ISystemMediaTransportControlsInterop;

    struct Holder(SystemMediaTransportControls);
    unsafe impl Send for Holder {}
    unsafe impl Sync for Holder {}

    static SMTC: OnceLock<Option<Holder>> = OnceLock::new();
    static LAST_PUSHED: OnceLock<Mutex<Option<Pushed>>> = OnceLock::new();

    #[derive(PartialEq)]
    struct Pushed {
        playing: bool,
        title: String,
        subtitle: String,
        album: String,
        music: bool,
        art: String,
    }

    fn controls() -> Option<&'static SystemMediaTransportControls> {
        SMTC.get().and_then(|h| h.as_ref()).map(|h| &h.0)
    }

    pub fn init(app: &AppHandle) {
        let created = SMTC.get_or_init(|| match build(app) {
            Ok(smtc) => Some(Holder(smtc)),
            Err(e) => {
                eprintln!("[compass::media] SMTC init failed: {e:?}");
                None
            }
        });
        if created.is_some() {
            eprintln!("[compass::media] SMTC session registered");
        }
    }

    fn build(app: &AppHandle) -> windows::core::Result<SystemMediaTransportControls> {
        let window = app
            .get_webview_window("main")
            .ok_or_else(windows::core::Error::empty)?;
        let raw = window.hwnd().map_err(|_| windows::core::Error::empty())?;
        let hwnd = HWND(raw.0 as *mut _);
        let interop = windows::core::factory::<
            SystemMediaTransportControls,
            ISystemMediaTransportControlsInterop,
        >()?;
        let smtc: SystemMediaTransportControls = unsafe { interop.GetForWindow(hwnd)? };
        smtc.SetIsPlayEnabled(true)?;
        smtc.SetIsPauseEnabled(true)?;
        smtc.SetIsNextEnabled(true)?;
        smtc.SetIsPreviousEnabled(true)?;
        smtc.SetIsStopEnabled(true)?;
        smtc.SetIsEnabled(false)?;
        let handle = app.clone();
        smtc.ButtonPressed(&TypedEventHandler::new(
            move |_,
                  args: windows::core::Ref<
                '_,
                SystemMediaTransportControlsButtonPressedEventArgs,
            >| {
                if let Some(a) = args.as_ref() {
                    let name = match a.Button()? {
                        SystemMediaTransportControlsButton::Play => "play",
                        SystemMediaTransportControlsButton::Pause => "pause",
                        SystemMediaTransportControlsButton::Next => "next",
                        SystemMediaTransportControlsButton::Previous => "previous",
                        SystemMediaTransportControlsButton::Stop => "stop",
                        _ => return Ok(()),
                    };
                    let _ = handle.emit("compass://media-key", name);
                }
                Ok(())
            },
        ))?;
        Ok(smtc)
    }

    fn sanitize(s: &str) -> String {
        s.trim()
            .chars()
            .map(|c| if c.is_control() { ' ' } else { c })
            .take(256)
            .collect()
    }

    /// Music is published as a Music session (title, artist, album) so desktop-player readers such
    /// as WebNowPlaying see artist and album; video keeps the Video shape it always had.
    pub fn update(
        playing: bool,
        title: &str,
        subtitle: &str,
        album: Option<&str>,
        music: bool,
        art_url: Option<&str>,
        duration_sec: Option<f64>,
        position_sec: Option<f64>,
    ) {
        let Some(smtc) = controls() else { return };
        let next = Pushed {
            playing,
            title: sanitize(title),
            subtitle: sanitize(subtitle),
            album: album.map(sanitize).unwrap_or_default(),
            music,
            art: art_url
                .filter(|url| url.starts_with("https://"))
                .unwrap_or_default()
                .to_string(),
        };

        let last = LAST_PUSHED.get_or_init(|| Mutex::new(None));
        let mut guard = last.lock().unwrap_or_else(|error| error.into_inner());
        if guard.as_ref() != Some(&next) {
            let result = (|| -> windows::core::Result<()> {
                smtc.SetIsEnabled(true)?;
                smtc.SetPlaybackStatus(if playing {
                    MediaPlaybackStatus::Playing
                } else {
                    MediaPlaybackStatus::Paused
                })?;
                let du = smtc.DisplayUpdater()?;
                if next.music {
                    du.SetType(MediaPlaybackType::Music)?;
                    let mp = du.MusicProperties()?;
                    mp.SetTitle(&HSTRING::from(next.title.as_str()))?;
                    mp.SetArtist(&HSTRING::from(next.subtitle.as_str()))?;
                    mp.SetAlbumTitle(&HSTRING::from(next.album.as_str()))?;
                } else {
                    du.SetType(MediaPlaybackType::Video)?;
                    let vp = du.VideoProperties()?;
                    vp.SetTitle(&HSTRING::from(next.title.as_str()))?;
                    vp.SetSubtitle(&HSTRING::from(next.subtitle.as_str()))?;
                }
                // The thumbnail is fetched by Windows itself; a bad URL must not fail the update.
                if !next.art.is_empty() {
                    if let Ok(uri) = Uri::CreateUri(&HSTRING::from(next.art.as_str())) {
                        if let Ok(stream) = RandomAccessStreamReference::CreateFromUri(&uri) {
                            let _ = du.SetThumbnail(&stream);
                        }
                    }
                }
                du.Update()
            })();
            // Failed pushes must remain retryable on the next update.
            let pushed = result.is_ok();
            *guard = if pushed { Some(next) } else { None };
        }
        drop(guard);

        // Position moves without any metadata change, so the timeline is refreshed every call.
        if let Some((end, position)) = super::timeline_ticks(duration_sec, position_sec) {
            if let Ok(props) = SystemMediaTransportControlsTimelineProperties::new() {
                let span = |duration: i64| TimeSpan { Duration: duration };
                let _ = props.SetStartTime(span(0));
                let _ = props.SetMinSeekTime(span(0));
                let _ = props.SetEndTime(span(end));
                let _ = props.SetMaxSeekTime(span(end));
                let _ = props.SetPosition(span(position));
                let _ = smtc.UpdateTimelineProperties(&props);
            }
        }
    }

    pub fn clear() {
        let Some(smtc) = controls() else { return };
        let last = LAST_PUSHED.get_or_init(|| Mutex::new(None));
        let mut guard = last.lock().unwrap_or_else(|error| error.into_inner());
        // Refocusing or replaying the same title must enable the session again.
        *guard = None;
        let _ = smtc.SetPlaybackStatus(MediaPlaybackStatus::Closed);
        if let Ok(du) = smtc.DisplayUpdater() {
            let _ = du.ClearAll();
            let _ = du.Update();
        }
        let _ = smtc.SetIsEnabled(false);
    }
}

#[cfg(target_os = "linux")]
mod linux {
    use std::collections::HashMap;
    use std::sync::{Arc, OnceLock};
    use tauri::{AppHandle, Emitter, Manager};
    use tokio::sync::Mutex;
    use zbus::zvariant::{ObjectPath, Value};
    use zbus::{interface, connection::Connection};

    #[derive(Clone)]
    pub struct PlaybackState {
        pub playing: bool,
        pub title: String,
        pub subtitle: String,
        pub art_url: Option<String>,
        pub duration_us: i64,
        pub position_us: i64,
        pub volume: f64,
        pub updated_at: std::time::Instant,
    }

    impl Default for PlaybackState {
        fn default() -> Self {
            Self {
                playing: false,
                title: String::new(),
                subtitle: String::new(),
                art_url: None,
                duration_us: 0,
                position_us: 0,
                volume: 1.0,
                updated_at: std::time::Instant::now(),
            }
        }
    }

    pub struct MprisHandle {
        connection: Connection,
        state: Arc<Mutex<PlaybackState>>,
    }

    static MPRIS: OnceLock<Option<MprisHandle>> = OnceLock::new();

    fn get_connection() -> Option<Connection> {
        MPRIS.get().and_then(|h| h.as_ref()).map(|h| h.connection.clone())
    }

    struct MprisRoot {
        app: AppHandle,
    }

    #[interface(name = "org.mpris.MediaPlayer2")]
    impl MprisRoot {
        async fn raise(&self) {
            if let Some(window) = self.app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }

        async fn quit(&self) {
            self.app.exit(0);
        }

        #[zbus(property)]
        fn can_quit(&self) -> bool {
            true
        }

        #[zbus(property)]
        fn can_raise(&self) -> bool {
            true
        }

        #[zbus(property)]
        fn has_track_list(&self) -> bool {
            false
        }

        #[zbus(property)]
        fn identity(&self) -> &str {
            "Compass"
        }

        #[zbus(property)]
        fn desktop_entry(&self) -> String {
            if let Ok(flatpak_id) = std::env::var("FLATPAK_ID") {
                if !flatpak_id.trim().is_empty() {
                    return flatpak_id;
                }
            }

            let candidates = [
                "Compass Beta.desktop",
                "app.compass.desktop",
                "compass.desktop",
                "site.compass.Compass.desktop",
            ];

            let mut search_dirs: Vec<std::path::PathBuf> = Vec::new();
            if let Ok(data_home) = std::env::var("XDG_DATA_HOME") {
                search_dirs.push(std::path::PathBuf::from(data_home).join("applications"));
            } else if let Some(home) = std::env::var_os("HOME") {
                search_dirs.push(std::path::PathBuf::from(home).join(".local/share/applications"));
            }

            let xdg_dirs = std::env::var("XDG_DATA_DIRS")
                .unwrap_or_else(|_| "/usr/local/share:/usr/share".to_string());
            for d in xdg_dirs.split(':') {
                if !d.is_empty() {
                    search_dirs.push(std::path::Path::new(d).join("applications"));
                }
            }

            for dir in &search_dirs {
                for candidate in candidates {
                    if dir.join(candidate).exists() {
                        return candidate.trim_end_matches(".desktop").to_string();
                    }
                }
            }

            "app.compass".to_string()
        }

        #[zbus(property)]
        fn supported_uri_schemes(&self) -> Vec<&str> {
            vec!["http", "https", "file"]
        }

        #[zbus(property)]
        fn supported_mime_types(&self) -> Vec<&str> {
            vec!["video/*", "audio/*"]
        }
    }

    struct MprisPlayer {
        app: AppHandle,
        state: Arc<Mutex<PlaybackState>>,
    }

    #[interface(name = "org.mpris.MediaPlayer2.Player")]
    impl MprisPlayer {
        async fn next(&self) {
            let _ = self.app.emit("compass://media-key", "next");
        }

        async fn previous(&self) {
            let _ = self.app.emit("compass://media-key", "previous");
        }

        async fn pause(&self) {
            let _ = self.app.emit("compass://media-key", "pause");
        }

        async fn play_pause(&self) {
            let _ = self.app.emit("compass://media-key", "playpause");
        }

        async fn stop(&self) {
            let _ = self.app.emit("compass://media-key", "stop");
        }

        async fn play(&self) {
            let _ = self.app.emit("compass://media-key", "play");
        }

        async fn seek(&self, offset_us: i64) {
            let offset_sec = offset_us as f64 / 1_000_000.0;
            let _ = self.app.emit("compass://media-seek-relative", offset_sec);
            let new_pos = {
                let mut s = self.state.lock().await;
                let current = if s.playing {
                    s.position_us + s.updated_at.elapsed().as_micros() as i64
                } else {
                    s.position_us
                };
                let new_pos = (current + offset_us).max(0);
                let new_pos = if s.duration_us > 0 { new_pos.min(s.duration_us) } else { new_pos };
                s.position_us = new_pos;
                s.updated_at = std::time::Instant::now();
                new_pos
            };
            if let Some(conn) = get_connection() {
                if let Ok(iface) = conn.object_server().interface::<_, MprisPlayer>("/org/mpris/MediaPlayer2").await {
                    let _ = MprisPlayer::seeked(iface.signal_emitter(), new_pos).await;
                }
            }
        }

        async fn set_position(&self, _track_id: ObjectPath<'_>, position_us: i64) {
            let pos_sec = position_us as f64 / 1_000_000.0;
            let _ = self.app.emit("compass://media-seek-absolute", pos_sec);
            let new_pos = {
                let mut s = self.state.lock().await;
                let p = position_us.max(0);
                let p = if s.duration_us > 0 { p.min(s.duration_us) } else { p };
                s.position_us = p;
                s.updated_at = std::time::Instant::now();
                p
            };
            if let Some(conn) = get_connection() {
                if let Ok(iface) = conn.object_server().interface::<_, MprisPlayer>("/org/mpris/MediaPlayer2").await {
                    let _ = MprisPlayer::seeked(iface.signal_emitter(), new_pos).await;
                }
            }
        }

        #[zbus(signal)]
        async fn seeked(emitter: &zbus::object_server::SignalEmitter<'_>, position_us: i64) -> zbus::Result<()>;

        #[zbus(property)]
        async fn playback_status(&self) -> String {
            let s = self.state.lock().await;
            if s.title.is_empty() {
                "Stopped".to_string()
            } else if s.playing {
                "Playing".to_string()
            } else {
                "Paused".to_string()
            }
        }

        #[zbus(property)]
        fn loop_status(&self) -> &str {
            "None"
        }

        #[zbus(property)]
        fn set_loop_status(&self, _status: &str) -> zbus::Result<()> {
            Ok(())
        }

        #[zbus(property)]
        fn rate(&self) -> f64 {
            1.0
        }

        #[zbus(property)]
        fn set_rate(&self, _rate: f64) -> zbus::Result<()> {
            Ok(())
        }

        #[zbus(property)]
        fn shuffle(&self) -> bool {
            false
        }

        #[zbus(property)]
        fn set_shuffle(&self, _shuffle: bool) -> zbus::Result<()> {
            Ok(())
        }

        #[zbus(property)]
        async fn volume(&self) -> f64 {
            self.state.lock().await.volume
        }

        #[zbus(property)]
        async fn set_volume(&self, vol: f64) -> zbus::Result<()> {
            let clamped = vol.clamp(0.0, 1.0);
            {
                let mut s = self.state.lock().await;
                s.volume = clamped;
            }
            let _ = self.app.emit("compass://media-set-volume", clamped);
            if let Some(conn) = get_connection() {
                if let Ok(iface) = conn.object_server().interface::<_, MprisPlayer>("/org/mpris/MediaPlayer2").await {
                    let player = iface.get().await;
                    let _ = MprisPlayer::volume_changed(&*player, iface.signal_emitter()).await;
                }
            }
            Ok(())
        }

        #[zbus(property)]
        async fn position(&self) -> i64 {
            let s = self.state.lock().await;
            if s.playing {
                let elapsed = s.updated_at.elapsed().as_micros() as i64;
                let cur = s.position_us + elapsed;
                if s.duration_us > 0 {
                    cur.min(s.duration_us)
                } else {
                    cur
                }
            } else {
                s.position_us
            }
        }

        #[zbus(property)]
        fn minimum_rate(&self) -> f64 {
            1.0
        }

        #[zbus(property)]
        fn maximum_rate(&self) -> f64 {
            1.0
        }

        #[zbus(property)]
        fn can_control(&self) -> bool {
            true
        }

        #[zbus(property)]
        fn can_play(&self) -> bool {
            true
        }

        #[zbus(property)]
        fn can_pause(&self) -> bool {
            true
        }

        #[zbus(property)]
        fn can_seek(&self) -> bool {
            true
        }

        #[zbus(property)]
        fn can_go_next(&self) -> bool {
            true
        }

        #[zbus(property)]
        fn can_go_previous(&self) -> bool {
            true
        }

        #[zbus(property)]
        async fn metadata(&self) -> HashMap<String, Value<'static>> {
            let s = self.state.lock().await;
            let mut meta = HashMap::new();
            let track_id = ObjectPath::try_from("/org/mpris/MediaPlayer2/track/0")
                .unwrap_or_else(|_| ObjectPath::from_static_str_unchecked("/org/mpris/MediaPlayer2/TrackList/NoTrack"));
            meta.insert("mpris:trackid".to_string(), Value::from(track_id));

            if !s.title.is_empty() {
                meta.insert("xesam:title".to_string(), Value::from(s.title.clone()));
            }
            if !s.subtitle.is_empty() {
                meta.insert("xesam:album".to_string(), Value::from(s.subtitle.clone()));
            }
            if let Some(art) = &s.art_url {
                if !art.is_empty() {
                    meta.insert("mpris:artUrl".to_string(), Value::from(art.clone()));
                }
            }
            if s.duration_us > 0 {
                meta.insert("mpris:length".to_string(), Value::from(s.duration_us));
            }
            meta
        }
    }

    pub fn init(app: &AppHandle) {
        let app_handle = app.clone();
        tauri::async_runtime::spawn(async move {
            let state = Arc::new(Mutex::new(PlaybackState::default()));
            let root = MprisRoot {
                app: app_handle.clone(),
            };
            let player = MprisPlayer {
                app: app_handle.clone(),
                state: state.clone(),
            };

            let primary_name = "org.mpris.MediaPlayer2.compass";
            let fallback_name = format!("org.mpris.MediaPlayer2.compass.instance{}", std::process::id());

            let build_result = match zbus::connection::Builder::session() {
                Ok(builder) => builder
                    .name(primary_name)
                    .and_then(|b| b.serve_at("/org/mpris/MediaPlayer2", root))
                    .and_then(|b| b.serve_at("/org/mpris/MediaPlayer2", player)),
                Err(e) => {
                    eprintln!("[compass::mpris] Session bus unavailable: {e:?}");
                    return;
                }
            };

            let conn = match build_result {
                Ok(builder) => match builder.build().await {
                    Ok(c) => c,
                    Err(e) => {
                        eprintln!("[compass::mpris] Primary bus name '{primary_name}' failed ({e:?}), retrying with '{fallback_name}'");
                        // If primary name failed, retry with fallback instance name
                        let root = MprisRoot {
                            app: app_handle.clone(),
                        };
                        let player = MprisPlayer {
                            app: app_handle.clone(),
                            state: state.clone(),
                        };
                        match zbus::connection::Builder::session()
                            .and_then(|b| b.name(fallback_name.as_str()))
                            .and_then(|b| b.serve_at("/org/mpris/MediaPlayer2", root))
                            .and_then(|b| b.serve_at("/org/mpris/MediaPlayer2", player))
                        {
                            Ok(builder) => match builder.build().await {
                                Ok(c) => c,
                                Err(e) => {
                                    eprintln!("[compass::mpris] Fallback bus name also failed: {e:?}");
                                    return;
                                }
                            },
                            Err(e) => {
                                eprintln!("[compass::mpris] Fallback builder error: {e:?}");
                                return;
                            }
                        }
                    }
                },
                Err(e) => {
                    eprintln!("[compass::mpris] Failed to configure MPRIS server: {e:?}");
                    return;
                }
            };

            let _ = MPRIS.set(Some(MprisHandle {
                connection: conn,
                state,
            }));
            eprintln!("[compass::mpris] Registered D-Bus interface org.mpris.MediaPlayer2");
        });
    }

    pub fn update(
        playing: bool,
        title: &str,
        subtitle: &str,
        art_url: Option<&str>,
        duration_sec: Option<f64>,
        position_sec: Option<f64>,
        volume: Option<f64>,
    ) {
        let Some(Some(handle)) = MPRIS.get() else { return };
        let state = handle.state.clone();
        let conn = handle.connection.clone();
        let title = title.to_string();
        let subtitle = subtitle.to_string();
        let art_url = art_url.map(|s| s.to_string());
        let duration_us = duration_sec
            .filter(|d| d.is_finite() && *d > 0.0)
            .map(|d| (d * 1_000_000.0) as i64)
            .unwrap_or(0);
        let position_us = position_sec
            .filter(|p| p.is_finite() && *p >= 0.0)
            .map(|p| (p * 1_000_000.0) as i64)
            .unwrap_or(0);

        tauri::async_runtime::spawn(async move {
            let mut vol_changed = false;
            let mut status_changed = false;
            let mut meta_changed = false;
            let mut pos_jumped = false;

            {
                let mut s = state.lock().await;
                if s.playing != playing {
                    s.playing = playing;
                    s.updated_at = std::time::Instant::now();
                    status_changed = true;
                }
                if s.title != title || s.subtitle != subtitle || s.art_url != art_url || s.duration_us != duration_us {
                    s.title = title;
                    s.subtitle = subtitle;
                    s.art_url = art_url;
                    s.duration_us = duration_us;
                    meta_changed = true;
                }
                let current = if s.playing {
                    s.position_us + s.updated_at.elapsed().as_micros() as i64
                } else {
                    s.position_us
                };
                let drift = (current - position_us).abs();
                if drift > 1_200_000 || status_changed {
                    s.position_us = position_us;
                    s.updated_at = std::time::Instant::now();
                    if drift > 1_200_000 {
                        pos_jumped = true;
                    }
                }
                if let Some(vol) = volume {
                    let clamped = vol.clamp(0.0, 1.0);
                    if (s.volume - clamped).abs() > 0.005 {
                        s.volume = clamped;
                        vol_changed = true;
                    }
                }
            }

            if let Ok(iface) = conn.object_server().interface::<_, MprisPlayer>("/org/mpris/MediaPlayer2").await {
                let player = iface.get().await;
                if status_changed {
                    let _ = MprisPlayer::playback_status_changed(&*player, iface.signal_emitter()).await;
                }
                if meta_changed {
                    let _ = MprisPlayer::metadata_changed(&*player, iface.signal_emitter()).await;
                }
                if vol_changed {
                    let _ = MprisPlayer::volume_changed(&*player, iface.signal_emitter()).await;
                }
                if pos_jumped {
                    let _ = MprisPlayer::seeked(iface.signal_emitter(), position_us).await;
                }
            }
        });
    }

    pub fn seeked(position_sec: f64) {
        let Some(Some(handle)) = MPRIS.get() else { return };
        let state = handle.state.clone();
        let conn = handle.connection.clone();
        let position_us = (position_sec.max(0.0) * 1_000_000.0) as i64;
        tauri::async_runtime::spawn(async move {
            {
                let mut s = state.lock().await;
                s.position_us = position_us;
                s.updated_at = std::time::Instant::now();
            }
            if let Ok(iface) = conn.object_server().interface::<_, MprisPlayer>("/org/mpris/MediaPlayer2").await {
                let _ = MprisPlayer::seeked(iface.signal_emitter(), position_us).await;
            }
        });
    }

    pub fn clear() {
        let Some(Some(handle)) = MPRIS.get() else { return };
        let state = handle.state.clone();
        let conn = handle.connection.clone();

        tauri::async_runtime::spawn(async move {
            {
                let mut s = state.lock().await;
                s.playing = false;
                s.title.clear();
                s.subtitle.clear();
                s.art_url = None;
                s.duration_us = 0;
                s.position_us = 0;
                s.updated_at = std::time::Instant::now();
            }

            if let Ok(iface) = conn.object_server().interface::<_, MprisPlayer>("/org/mpris/MediaPlayer2").await {
                let player = iface.get().await;
                let _ = MprisPlayer::playback_status_changed(&*player, iface.signal_emitter()).await;
                let _ = MprisPlayer::metadata_changed(&*player, iface.signal_emitter()).await;
            }
        });
    }
}

pub fn ensure_started_on_setup(app: &tauri::AppHandle) {
    #[cfg(windows)]
    win::init(app);
    #[cfg(target_os = "linux")]
    linux::init(app);
    #[cfg(not(any(windows, target_os = "linux")))]
    let _ = app;
}

#[tauri::command]
pub fn media_controls_update(
    playing: bool,
    title: String,
    subtitle: String,
    art_url: Option<String>,
    duration_sec: Option<f64>,
    position_sec: Option<f64>,
    volume: Option<f64>,
    album: Option<String>,
    music: Option<bool>,
) {
    #[cfg(windows)]
    win::update(
        playing,
        &title,
        &subtitle,
        album.as_deref(),
        music.unwrap_or(false),
        art_url.as_deref(),
        duration_sec,
        position_sec,
    );
    #[cfg(windows)]
    crate::taskbar::set_playing(playing);
    #[cfg(windows)]
    let _ = volume;
    #[cfg(not(windows))]
    let _ = (&album, music);
    #[cfg(target_os = "linux")]
    linux::update(
        playing,
        &title,
        &subtitle,
        art_url.as_deref(),
        duration_sec,
        position_sec,
        volume,
    );
    #[cfg(not(any(windows, target_os = "linux")))]
    let _ = (
        playing,
        title,
        subtitle,
        art_url,
        duration_sec,
        position_sec,
        volume,
    );
}

#[tauri::command]
pub fn media_controls_music_state(playing: bool, liked: bool, muted: bool) {
    #[cfg(windows)]
    crate::taskbar::update(playing, liked, muted);
    #[cfg(not(windows))]
    let _ = (playing, liked, muted);
}

#[tauri::command]
pub fn media_controls_music_art(art_url: Option<String>, app_icon: bool) {
    #[cfg(windows)]
    crate::taskbar::set_artwork(art_url, app_icon);
    #[cfg(not(windows))]
    let _ = (art_url, app_icon);
}

#[tauri::command]
pub fn media_controls_seeked(position_sec: f64) {
    #[cfg(target_os = "linux")]
    linux::seeked(position_sec);
    #[cfg(not(target_os = "linux"))]
    let _ = position_sec;
}

#[tauri::command]
pub fn media_controls_clear() {
    #[cfg(windows)]
    win::clear();
    #[cfg(target_os = "linux")]
    linux::clear();
}
