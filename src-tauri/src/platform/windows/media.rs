//! Windows — musique en cours par les contrôles multimédias du système (Global System Media Transport
//! Controls, WinRT `Windows.Media.Control`) : tous les lecteurs qui s'y déclarent (Spotify, navigateurs,
//! Deezer, Lecteur multimédia…), sans autorisation. C'est la même source que le panneau multimédia de Windows.
//!
//! - Choix de la session : celle qui joue (la session « courante » du système en premier à égalité), sinon la
//!   première en pause ; jamais une app d'appel (`music::pick_session`).
//! - Position : `GetTimelineProperties` donne la position à l'instant `LastUpdatedTime` (souvent figée entre
//!   deux mises à jour du lecteur) : `position_ms` et `position_at` sont donc cohérents, le front avance.
//! - Pochette : `Thumbnail` → `OpenReadAsync` → octets lus par un `DataReader`.
//! - Commandes : sur la session montrée en dernier. « open » : fenêtre du lecteur au premier plan (l'île vient
//!   d'être cliquée, notre processus a le droit de `SetForegroundWindow`), repli pour les apps du Store :
//!   `explorer.exe shell:AppsFolder\<AppUserModelId>`.
//!
//! WinRT est initialisé (MTA) dans chaque fil qui appelle : la boucle de la musique et les commandes Tauri.
//! Aucune opération asynchrone n'est attendue plus de `ASYNC_TIMEOUT` (un lecteur peut ne pas répondre).

use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

use anyhow::{anyhow, bail, ensure, Context, Result};
use windows::core::HSTRING;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as Session,
    GlobalSystemMediaTransportControlsSessionManager as SessionManager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlaybackStatus,
};
use windows::Storage::Streams::DataReader;
use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
use windows_sys::core::BOOL;
use windows_sys::Win32::Foundation::{HWND, LPARAM};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindow, GetWindowLongW, GetWindowTextLengthW, GetWindowTextW,
    GetWindowThreadProcessId, IsIconic, IsWindowVisible, SetForegroundWindow, ShowWindow,
    GWL_EXSTYLE, GW_OWNER, SW_RESTORE, WS_EX_TOOLWINDOW,
};

use super::activity::exe_stem;
use crate::music::{self, Playback};
use crate::platform::{MediaCommand, NowPlaying};
use crate::time::now_ms;

/// Attente maximale d'une opération WinRT (propriétés, pochette, commande).
const ASYNC_TIMEOUT: Duration = Duration::from_secs(3);
const ASYNC_POLL: Duration = Duration::from_millis(5);
/// Pochette plus grosse : refusée (une image de pochette fait quelques centaines de Ko).
const ARTWORK_MAX_BYTES: u64 = 10 * 1024 * 1024;
/// `DETACHED_PROCESS` : pas de console attachée.
const DETACHED_PROCESS: u32 = 0x0000_0008;
/// 1970-01-01 en FILETIME (intervalles de 100 ns depuis 1601-01-01).
const UNIX_EPOCH_AS_FILETIME: i64 = 116_444_736_000_000_000;
/// Intervalles de 100 ns par milliseconde.
const TICKS_PER_MS: i64 = 10_000;

/// Attend la fin d'une `IAsyncOperation` au plus `ASYNC_TIMEOUT` (annulée au-delà), puis rend son résultat.
/// Macro plutôt que fonction : le type `IAsyncOperation` vient de `windows-future`, pas de `windows`.
macro_rules! wait {
    ($operation:expr) => {{
        let operation = $operation;
        let started = Instant::now();
        loop {
            // AsyncStatus : 0 en cours, 1 terminée, 2 annulée, 3 en erreur (GetResults rend alors l'erreur).
            if operation.Status()?.0 != 0 {
                break operation.GetResults().map_err(anyhow::Error::from);
            }
            if started.elapsed() >= ASYNC_TIMEOUT {
                let _ = operation.Cancel();
                break Err(anyhow!("le lecteur ne répond pas (délai dépassé)"));
            }
            thread::sleep(ASYNC_POLL);
        }
    }};
}

/// Session montrée en dernier (pour la pochette et les commandes).
struct Current {
    session: Session,
    app_id: String,
    title: String,
}

struct Media {
    manager: Option<SessionManager>,
    current: Option<Current>,
}

static MEDIA: Mutex<Media> = Mutex::new(Media {
    manager: None,
    current: None,
});

/// Verrou court : jamais tenu pendant un appel WinRT.
fn media() -> MutexGuard<'static, Media> {
    MEDIA.lock().unwrap_or_else(|e| e.into_inner())
}

fn init_mta() {
    // SAFETY : initialise COM (et WinRT) en MTA sur ce fil, comme `pages.rs` ; déjà fait : S_FALSE, sans
    // effet. Fil déjà STA : refusé (RPC_E_CHANGED_MODE), les appels passent alors par le marshaling.
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
}

fn manager() -> Result<SessionManager> {
    if let Some(manager) = media().manager.clone() {
        return Ok(manager);
    }
    let manager =
        wait!(SessionManager::RequestAsync()?).context("contrôles multimédias du système")?;
    media().manager = Some(manager.clone());
    Ok(manager)
}

pub fn now_playing() -> Result<Option<NowPlaying>> {
    init_mta();
    let manager = manager()?;
    match read_now_playing(&manager) {
        Ok(Some((playing, current))) => {
            media().current = Some(current);
            Ok(Some(playing))
        }
        Ok(None) => {
            media().current = None;
            Ok(None)
        }
        Err(e) => {
            // Gestionnaire peut-être périmé (Explorer redémarré…) : recréé au prochain tour.
            let mut media = media();
            media.manager = None;
            media.current = None;
            Err(e)
        }
    }
}

fn playback_of(status: PlaybackStatus) -> Playback {
    match status {
        // « Changing » : passage d'un morceau au suivant, la lecture continue.
        PlaybackStatus::Playing | PlaybackStatus::Changing => Playback::Playing,
        PlaybackStatus::Paused => Playback::Paused,
        _ => Playback::Inactive,
    }
}

/// Session, identifiant et état de lecture ; `None` si la session ne répond pas (ignorée).
fn describe(session: Session) -> Option<(Session, String, Playback)> {
    let app_id = session.SourceAppUserModelId().ok()?.to_string_lossy();
    let status = session.GetPlaybackInfo().ok()?.PlaybackStatus().ok()?;
    Some((session, app_id, playback_of(status)))
}

fn non_empty(text: windows::core::Result<HSTRING>) -> Option<String> {
    let text = text.ok()?.to_string_lossy();
    let text = text.trim();
    (!text.is_empty()).then(|| text.to_owned())
}

fn read_now_playing(manager: &SessionManager) -> Result<Option<(NowPlaying, Current)>> {
    let mut sessions: Vec<(Session, String, Playback)> = Vec::new();
    // La session « courante » du système d'abord : elle gagne à égalité.
    if let Some(described) = manager.GetCurrentSession().ok().and_then(describe) {
        sessions.push(described);
    }
    let all = manager.GetSessions()?;
    for index in 0..all.Size()? {
        if let Some(described) = all.GetAt(index).ok().and_then(describe) {
            sessions.push(described);
        }
    }
    let chosen = {
        let candidates: Vec<(&str, Playback)> = sessions
            .iter()
            .map(|(_, app_id, playback)| (app_id.as_str(), *playback))
            .collect();
        music::pick_session(&candidates)
    };
    let Some(index) = chosen else {
        return Ok(None);
    };
    let (session, app_id, playback) = sessions.swap_remove(index);

    let properties = wait!(session.TryGetMediaPropertiesAsync()?)?;
    let Some(title) = non_empty(properties.Title()) else {
        return Ok(None);
    };
    let artist = non_empty(properties.Artist()).or_else(|| non_empty(properties.AlbumArtist()));
    let album = non_empty(properties.AlbumTitle());
    let has_artwork = properties.Thumbnail().is_ok();

    let now = now_ms();
    let (position_ms, duration_ms, position_at) = match session.GetTimelineProperties() {
        Ok(timeline) => timeline_ms(
            timeline.StartTime().map_or(0, |t| t.Duration),
            timeline.EndTime().map_or(0, |t| t.Duration),
            timeline.Position().map_or(0, |t| t.Duration),
            timeline.LastUpdatedTime().map_or(0, |t| t.UniversalTime),
            now,
        ),
        Err(_) => (None, None, now),
    };

    // Pas d'identifiant d'image dans l'API : même lecteur et même morceau = même pochette.
    let artwork_key = has_artwork.then(|| {
        format!(
            "{app_id}\u{1f}{title}\u{1f}{}\u{1f}{}",
            artist.as_deref().unwrap_or_default(),
            album.as_deref().unwrap_or_default()
        )
    });
    let playing = NowPlaying {
        app_id: app_id.clone(),
        title: title.clone(),
        artist,
        album,
        playing: playback == Playback::Playing,
        position_ms,
        duration_ms,
        position_at,
        artwork_key,
    };
    Ok(Some((
        playing,
        Current {
            session,
            app_id,
            title,
        },
    )))
}

/// Position, durée (ms) et instant de la position (epoch ms) depuis la ligne de temps WinRT (intervalles de
/// 100 ns ; `updated` en FILETIME). Durée inconnue (fin ≤ début) : ni position ni durée.
fn timeline_ms(
    start: i64,
    end: i64,
    position: i64,
    updated: i64,
    now: u64,
) -> (Option<u64>, Option<u64>, u64) {
    let at = filetime_to_unix_ms(updated)
        .filter(|&at| at <= now)
        .unwrap_or(now);
    if end <= start {
        return (None, None, at);
    }
    let length = end - start;
    let position = position.saturating_sub(start).clamp(0, length);
    (
        Some((position / TICKS_PER_MS) as u64),
        Some((length / TICKS_PER_MS) as u64),
        at,
    )
}

fn filetime_to_unix_ms(filetime: i64) -> Option<u64> {
    let since_epoch = filetime.checked_sub(UNIX_EPOCH_AS_FILETIME)?;
    (since_epoch > 0).then(|| (since_epoch / TICKS_PER_MS) as u64)
}

pub fn now_playing_artwork() -> Result<Option<Vec<u8>>> {
    init_mta();
    let Some(session) = media().current.as_ref().map(|c| c.session.clone()) else {
        return Ok(None);
    };
    let properties = wait!(session.TryGetMediaPropertiesAsync()?)?;
    let Ok(reference) = properties.Thumbnail() else {
        return Ok(None);
    };
    let stream = wait!(reference.OpenReadAsync()?)?;
    let size = stream.Size()?;
    if size == 0 {
        return Ok(None);
    }
    ensure!(
        size <= ARTWORK_MAX_BYTES,
        "pochette trop grosse ({size} octets)"
    );
    let reader = DataReader::CreateDataReader(&stream)?;
    let mut bytes = Vec::with_capacity(size as usize);
    while (bytes.len() as u64) < size {
        let wanted = (size - bytes.len() as u64) as u32;
        let loaded = wait!(reader.LoadAsync(wanted)?)?;
        if loaded == 0 {
            break;
        }
        let start = bytes.len();
        bytes.resize(start + loaded as usize, 0);
        reader.ReadBytes(&mut bytes[start..])?;
    }
    // Ferme aussi le flux.
    let _ = reader.Close();
    Ok((!bytes.is_empty()).then_some(bytes))
}

pub fn media_command(command: MediaCommand) -> Result<()> {
    init_mta();
    let (session, app_id, title) = {
        let media = media();
        let current = media
            .current
            .as_ref()
            .ok_or_else(|| anyhow!("aucune musique en cours"))?;
        (
            current.session.clone(),
            current.app_id.clone(),
            current.title.clone(),
        )
    };
    let operation = match command {
        MediaCommand::Previous => session.TrySkipPreviousAsync()?,
        MediaCommand::Next => session.TrySkipNextAsync()?,
        MediaCommand::PlayPause => session.TryTogglePlayPauseAsync()?,
        MediaCommand::Open => return bring_to_front(&app_id, &title),
    };
    let accepted = wait!(operation)?;
    ensure!(accepted, "le lecteur a refusé la commande");
    Ok(())
}

/// Nom d'exécutable probable (minuscules, sans `.exe`, comme `exe_stem`) d'après l'AppUserModelId :
/// `Spotify.exe` → `spotify`, `Chrome` → `chrome`, `MSEdge` → `msedge`, paquet `Famille!App` → `app`,
/// empreinte de Firefox → `firefox`.
fn exe_hint(app_id: &str) -> String {
    if music::is_firefox_app_id(app_id) {
        return "firefox".to_owned();
    }
    let lower = app_id.to_lowercase();
    let name = lower.split_once('!').map_or(lower.as_str(), |(_, app)| app);
    let name = name.rsplit(['\\', '/']).next().unwrap_or(name);
    name.strip_suffix(".exe").unwrap_or(name).to_owned()
}

/// AppUserModelId d'une app empaquetée (Store) : `Famille_empreinte!App`, caractères sûrs seulement
/// (passé à explorer.exe).
fn is_packaged_app_id(app_id: &str) -> bool {
    app_id.contains('!')
        && app_id.len() <= 256
        && app_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '!'))
}

/// Met au premier plan la fenêtre du lecteur (celle dont le titre contient le morceau de préférence).
fn bring_to_front(app_id: &str, title: &str) -> Result<()> {
    let exe = exe_hint(app_id);
    if let Some(hwnd) = find_window(&exe, title) {
        // SAFETY : `hwnd` vient d'EnumWindows (au pire fermée depuis : les appels échouent sans effet).
        unsafe {
            if IsIconic(hwnd) != 0 {
                ShowWindow(hwnd, SW_RESTORE);
            }
            if SetForegroundWindow(hwnd) == 0 {
                log::debug!("premier plan refusé par Windows pour {exe}");
            }
        }
        return Ok(());
    }
    if is_packaged_app_id(app_id) {
        let explorer = std::env::var_os("SystemRoot")
            .map(|root| PathBuf::from(root).join("explorer.exe"))
            .unwrap_or_else(|| PathBuf::from("explorer.exe"));
        Command::new(explorer)
            .arg(format!("shell:AppsFolder\\{app_id}"))
            .creation_flags(DETACHED_PROCESS)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .context("lancement d'explorer.exe impossible")?;
        return Ok(());
    }
    bail!("fenêtre du lecteur introuvable")
}

struct Search<'a> {
    exe: &'a str,
    /// Titre du morceau en minuscules (vide : pas de préférence).
    title: String,
    best: Option<HWND>,
    first: Option<HWND>,
}

fn find_window(exe: &str, title: &str) -> Option<HWND> {
    let mut search = Search {
        exe,
        title: title.trim().to_lowercase(),
        best: None,
        first: None,
    };
    // SAFETY : `search` ne vit que pendant EnumWindows, qui est synchrone.
    unsafe {
        EnumWindows(Some(on_window), &mut search as *mut Search as LPARAM);
    }
    search.best.or(search.first)
}

unsafe extern "system" fn on_window(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let search = &mut *(lparam as *mut Search);
    // Fenêtres principales seulement : visibles, sans propriétaire, pas des palettes d'outils.
    if IsWindowVisible(hwnd) == 0 || !GetWindow(hwnd, GW_OWNER).is_null() {
        return 1;
    }
    if (GetWindowLongW(hwnd, GWL_EXSTYLE) as u32) & WS_EX_TOOLWINDOW != 0 {
        return 1;
    }
    let len = GetWindowTextLengthW(hwnd);
    if len <= 0 {
        return 1;
    }
    let mut pid = 0u32;
    GetWindowThreadProcessId(hwnd, &mut pid);
    if exe_stem(pid).as_deref() != Some(search.exe) {
        return 1;
    }
    let mut buf = vec![0u16; len as usize + 1];
    let n = GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
    let text = String::from_utf16_lossy(&buf[..n.max(0) as usize]).to_lowercase();
    if !search.title.is_empty() && text.contains(&search.title) {
        search.best = Some(hwnd);
        return 0;
    }
    if search.first.is_none() {
        search.first = Some(hwnd);
    }
    1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ligne_de_temps_en_ms() {
        // 2026-11-21T10:00:00Z en FILETIME.
        let at_ms: u64 = 1_795_255_200_000;
        let filetime = UNIX_EPOCH_AS_FILETIME + at_ms as i64 * TICKS_PER_MS;
        assert_eq!(filetime_to_unix_ms(filetime), Some(at_ms));
        assert_eq!(filetime_to_unix_ms(0), None);
        let now = at_ms + 5_000;
        // 3 min 20, position 1 min 05 lue à `at_ms`.
        assert_eq!(
            timeline_ms(
                0,
                200_000 * TICKS_PER_MS,
                65_000 * TICKS_PER_MS,
                filetime,
                now
            ),
            (Some(65_000), Some(200_000), at_ms)
        );
        // Début non nul, position hors bornes : ramenée dans le morceau.
        assert_eq!(
            timeline_ms(
                10 * TICKS_PER_MS,
                110 * TICKS_PER_MS,
                500 * TICKS_PER_MS,
                filetime,
                now
            ),
            (Some(100), Some(100), at_ms)
        );
        // Lecteur sans ligne de temps (navigateur) : rien, horodatage = maintenant.
        assert_eq!(timeline_ms(0, 0, 0, 0, now), (None, None, now));
        // Horodatage dans le futur (horloge du lecteur) : maintenant.
        assert_eq!(
            timeline_ms(
                0,
                1_000 * TICKS_PER_MS,
                0,
                filetime + 60_000 * TICKS_PER_MS,
                now
            )
            .2,
            now
        );
    }

    #[test]
    fn executable_d_apres_l_identifiant() {
        assert_eq!(exe_hint("Spotify.exe"), "spotify");
        assert_eq!(
            exe_hint("SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify"),
            "spotify"
        );
        assert_eq!(exe_hint("Chrome"), "chrome");
        assert_eq!(exe_hint("MSEdge"), "msedge");
        assert_eq!(exe_hint("308046B0AF4A39CB"), "firefox");
        assert_eq!(exe_hint("TheBrowserCompany.Arc_ttt1ap7aakyb4!Arc"), "arc");
        assert_eq!(exe_hint("C:\\Programmes\\VideoLAN\\VLC\\vlc.exe"), "vlc");
    }

    #[test]
    fn identifiants_d_apps_du_store() {
        assert!(is_packaged_app_id(
            "AppleInc.AppleMusicWin_nzyj5cx40ttqa!App"
        ));
        assert!(is_packaged_app_id(
            "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify"
        ));
        assert!(!is_packaged_app_id("Spotify.exe"));
        assert!(!is_packaged_app_id("Chrome"));
        assert!(!is_packaged_app_id("x!y & calc"));
        assert!(!is_packaged_app_id("a!b\\..\\c"));
    }
}
