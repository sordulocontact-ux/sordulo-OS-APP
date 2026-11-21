//! macOS — musique en cours dans Spotify et Musique, par AppleScript (JXA via `osascript`).
//!
//! MediaRemote (« À l'écoute » du centre de contrôle) est fermé aux apps tierces depuis macOS 15.4 : on
//! demande donc directement aux deux lecteurs, comme `pages.rs` le fait pour les onglets des navigateurs.
//! macOS demande une fois à l'utilisateur d'autoriser Sordulo OS à contrôler Spotify, puis Musique (en dev,
//! la demande est faite au nom du terminal qui a lancé l'app). Refusé : cette app est ignorée 10 min (pas de
//! boucle de demandes), l'autre continue. Une app fermée n'est jamais lancée : `running()` est vérifié dans
//! chaque script (lecture et commandes), et seul « open » (`open -b`) ouvre le lecteur, à la demande.
//!
//! Lecture en arrière-plan mise en cache : `now_playing` ne bloque jamais (le premier tour ne trouve rien,
//! les suivants si). Un seul `osascript` lit les deux lecteurs. Si les deux ont un morceau : celui qui joue,
//! sinon celui en pause (Spotify d'abord).
//!
//! `osascript` seulement quand c'est utile (`should_ask`) : un lecteur n'est interrogé que s'il joue du son
//! d'après Core Audio (`audio.rs`, sans autorisation, chaque helper rattaché à son app :
//! `com.spotify.client.helper` compte pour Spotify), ou si l'un de ses morceaux est suivi (pour voir passer la
//! pause, la reprise, le changement de morceau). Un morceau en pause depuis plus de `FORGET_PAUSED_AFTER`
//! (l'île l'a rangé depuis longtemps) n'est plus suivi ; il revient dès que le lecteur rejoue du son. Rien ne
//! joue et rien n'est suivi : aucun `osascript`, donc aucune demande d'autorisation à qui n'écoute rien.
//!
//! Pochette : Spotify donne l'URL de l'image (téléchargée par `curl`, délai court), Musique ses octets (écrits
//! dans un fichier temporaire par AppleScript, puis lus). Gardée en cache par clé de pochette.

use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::{Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

use anyhow::{anyhow, bail, ensure, Context, Result};
use serde::Deserialize;

use super::audio::{self, Direction};
use crate::music::{self, Playback};
use crate::platform::{MediaCommand, NowPlaying};
use crate::time::now_ms;

const SPOTIFY: &str = "com.spotify.client";
const MUSIC: &str = "com.apple.Music";

/// Âge maximal de la lecture en cache : 1 s si un morceau est connu, 2 s sinon. Une relecture due regarde
/// d'abord Core Audio, puis lance `osascript` seulement si `should_ask` le dit.
const REFRESH_KNOWN: Duration = Duration::from_secs(1);
const REFRESH_IDLE: Duration = Duration::from_secs(2);
/// Morceau en pause (et lecteur silencieux) oublié au-delà : plus d'`osascript` pour lui.
const FORGET_PAUSED_AFTER: Duration = Duration::from_secs(30);
/// Délai maximal d'`osascript` pour la lecture (une demande d'autorisation affichée le bloque).
const SCRIPT_TIMEOUT: Duration = Duration::from_secs(30);
/// Délai maximal d'une commande (précédent, suivant, lecture / pause) et de la lecture de la pochette.
const COMMAND_TIMEOUT: Duration = Duration::from_secs(5);
const ARTWORK_TIMEOUT: Duration = Duration::from_secs(5);
/// `curl` : délai total (s) pour télécharger la pochette de Spotify.
const DOWNLOAD_MAX_SECS: &str = "5";
/// Pause après un refus d'autorisation, une app absente, ou une erreur.
const BACKOFF_AFTER_DENIAL: Duration = Duration::from_secs(600);
const BACKOFF_WHEN_ABSENT: Duration = Duration::from_secs(600);
const BACKOFF_AFTER_ERROR: Duration = Duration::from_secs(10);
/// Pochette plus grosse : refusée.
const ARTWORK_MAX_BYTES: usize = 10 * 1024 * 1024;

/// JXA : état des deux lecteurs (`argv[0]` / `argv[1]` = « 1 » pour lire Spotify / Musique). Un objet par
/// lecteur : `absent`, `running: false`, état sans morceau, morceau, ou `error` (numéro d'erreur Apple Event,
/// -1743 = autorisation refusée). Ne lance jamais un lecteur fermé.
const READ_SCRIPT: &str = r#"function opt(f) {
  try { const v = f(); return v === undefined || v === null ? null : v; } catch (e) { return null; }
}
function read(id, spotify) {
  let app;
  try { app = Application(id); } catch (e) { return { absent: true }; }
  try {
    if (!app.running()) return { running: false };
    const state = String(app.playerState());
    if (state !== "playing" && state !== "paused" && state !== "fast forwarding" && state !== "rewinding") {
      return { running: true, state: state };
    }
    const t = app.currentTrack;
    return {
      running: true,
      state: state,
      name: opt(() => t.name()),
      artist: opt(() => t.artist()),
      album: opt(() => t.album()),
      duration: opt(() => t.duration()),
      position: opt(() => app.playerPosition()),
      trackId: opt(() => String(spotify ? t.id() : t.persistentID())),
      artworkUrl: spotify ? opt(() => t.artworkUrl()) : null
    };
  } catch (e) {
    return { error: String(e && e.errorNumber !== undefined ? e.errorNumber : e) };
  }
}
function run(argv) {
  const out = {};
  if (argv[0] === "1") out.spotify = read("com.spotify.client", true);
  if (argv[1] === "1") out.music = read("com.apple.Music", false);
  return JSON.stringify(out);
}"#;

/// JXA : commande au lecteur `argv[0]` (bundle id), `argv[1]` = `previousTrack`, `nextTrack` ou `playpause`.
const COMMAND_SCRIPT: &str = r#"function run(argv) {
  const app = Application(argv[0]);
  if (!app.running()) return "closed";
  if (argv[1] === "previousTrack") app.previousTrack();
  else if (argv[1] === "nextTrack") app.nextTrack();
  else if (argv[1] === "playpause") app.playpause();
  else return "unknown";
  return "ok";
}"#;

/// AppleScript : écrit les octets de la pochette du morceau de Musique dans le fichier `item 1 of argv`.
/// Rend « none » sans pochette (ou Musique fermée), « ok » sinon.
const MUSIC_ARTWORK_SCRIPT: &str = r#"on run argv
	if not (application id "com.apple.Music" is running) then return "none"
	tell application id "com.apple.Music"
		try
			set artData to raw data of artwork 1 of current track
		on error
			return "none"
		end try
	end tell
	set outFile to open for access (POSIX file (item 1 of argv)) with write permission
	try
		set eof outFile to 0
		write artData to outFile
		close access outFile
	on error errorText number errorNumber
		close access outFile
		error errorText number errorNumber
	end try
	return "ok"
end run"#;

/// Réponse de `READ_SCRIPT`.
#[derive(Debug, Default, Deserialize)]
struct Reply {
    spotify: Option<AppReply>,
    music: Option<AppReply>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppReply {
    #[serde(default)]
    absent: bool,
    state: Option<String>,
    name: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    /// Spotify : ms ; Musique : secondes.
    duration: Option<f64>,
    /// Secondes (les deux).
    position: Option<f64>,
    track_id: Option<String>,
    artwork_url: Option<String>,
    error: Option<String>,
}

/// Morceau lu dans un lecteur.
#[derive(Debug, Clone, PartialEq)]
struct Track {
    bundle_id: &'static str,
    title: String,
    artist: Option<String>,
    album: Option<String>,
    playing: bool,
    position_ms: Option<u64>,
    duration_ms: Option<u64>,
    position_at: u64,
    track_id: Option<String>,
    artwork_url: Option<String>,
}

fn text(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .map(str::to_owned)
}

/// Morceau d'une réponse, `None` si le lecteur est fermé, arrêté ou sans titre. `read_at` : epoch ms.
fn track_of(bundle_id: &'static str, reply: &AppReply, read_at: u64) -> Option<Track> {
    let playing = match reply.state.as_deref()? {
        "playing" | "fast forwarding" | "rewinding" => true,
        "paused" => false,
        _ => return None,
    };
    let title = text(reply.name.as_deref())?;
    let duration_ms = reply
        .duration
        .filter(|d| d.is_finite() && *d > 0.0)
        .map(|d| if bundle_id == SPOTIFY { d } else { d * 1000.0 })
        .map(|ms| ms.round() as u64);
    let position_ms = reply
        .position
        .filter(|p| p.is_finite() && *p >= 0.0)
        .map(|p| (p * 1000.0).round() as u64)
        .map(|ms| duration_ms.map_or(ms, |d| ms.min(d)));
    Some(Track {
        bundle_id,
        title,
        artist: text(reply.artist.as_deref()),
        album: text(reply.album.as_deref()),
        playing,
        position_ms,
        duration_ms,
        position_at: read_at,
        track_id: text(reply.track_id.as_deref()),
        artwork_url: text(reply.artwork_url.as_deref()).filter(|u| valid_artwork_url(u)),
    })
}

/// URL de pochette acceptée pour `curl` : https seulement, sans espace ni caractère de contrôle.
fn valid_artwork_url(url: &str) -> bool {
    url.starts_with("https://")
        && url.len() <= 2048
        && !url.chars().any(|c| c.is_whitespace() || c.is_control())
}

impl Track {
    /// Spotify : l'URL de l'image ; Musique : le morceau (chaque morceau peut avoir sa pochette).
    fn artwork_key(&self) -> Option<String> {
        match self.bundle_id {
            SPOTIFY => self
                .artwork_url
                .as_ref()
                .map(|url| format!("{SPOTIFY}\u{1f}{url}")),
            _ => Some(format!(
                "{}\u{1f}{}",
                self.bundle_id,
                self.track_id.as_deref().unwrap_or(&self.title)
            )),
        }
    }

    fn now_playing(&self) -> NowPlaying {
        NowPlaying {
            app_id: self.bundle_id.to_owned(),
            title: self.title.clone(),
            artist: self.artist.clone(),
            album: self.album.clone(),
            playing: self.playing,
            position_ms: self.position_ms,
            duration_ms: self.duration_ms,
            position_at: self.position_at,
            artwork_key: self.artwork_key(),
        }
    }
}

/// Interroger ce lecteur par AppleScript à ce tour ? Jamais pendant une pause forcée (refus, absence,
/// erreur) ; sinon seulement s'il joue du son (Core Audio) ou si l'un de ses morceaux est suivi.
fn should_ask(allowed: bool, sounding: bool, following: bool) -> bool {
    allowed && (sounding || following)
}

/// Dernière lecture d'un lecteur et pause éventuelle (refus, absence, erreur).
struct AppEntry {
    track: Option<Track>,
    paused_until: Option<Instant>,
    /// Depuis quand le morceau connu est en pause.
    paused_since: Option<Instant>,
}

impl AppEntry {
    const EMPTY: Self = Self {
        track: None,
        paused_until: None,
        paused_since: None,
    };

    fn allowed(&self, now: Instant) -> bool {
        self.paused_until.is_none_or(|until| now >= until)
    }

    /// Un morceau est suivi : en lecture, ou en pause depuis moins de `FORGET_PAUSED_AFTER`.
    fn following(&self, now: Instant) -> bool {
        match &self.track {
            None => false,
            Some(track) if track.playing => true,
            Some(_) => self
                .paused_since
                .is_none_or(|since| now.duration_since(since) < FORGET_PAUSED_AFTER),
        }
    }

    /// Oublie un morceau qui n'est plus suivi quand le lecteur est silencieux (il ne serait plus jamais
    /// relu, donc resterait « en pause » pour toujours).
    fn forget_if_stale(&mut self, now: Instant, sounding: bool) {
        if self.track.is_some() && !sounding && !self.following(now) {
            self.track = None;
            self.paused_since = None;
        }
    }

    /// Met à jour `paused_since` après une nouvelle lecture.
    fn note_pause(&mut self, now: Instant) {
        match &self.track {
            Some(track) if !track.playing => {
                self.paused_since.get_or_insert(now);
            }
            _ => self.paused_since = None,
        }
    }

    fn apply(
        &mut self,
        name: &str,
        bundle_id: &'static str,
        reply: Option<AppReply>,
        read_at: u64,
    ) {
        let now = Instant::now();
        match reply {
            None => self.track = None,
            Some(reply) if reply.absent => {
                self.track = None;
                self.paused_until = Some(now + BACKOFF_WHEN_ABSENT);
                log::debug!("{name} n'est pas installé");
            }
            Some(AppReply {
                error: Some(error), ..
            }) => {
                self.track = None;
                let denied = error.contains("-1743");
                self.paused_until = Some(
                    now + if denied {
                        BACKOFF_AFTER_DENIAL
                    } else {
                        BACKOFF_AFTER_ERROR
                    },
                );
                if denied {
                    log::info!(
                        "musique de {name} : autorisation refusée (Réglages > Confidentialité et sécurité > Automatisation)"
                    );
                } else {
                    log::debug!("musique de {name} : erreur {error}");
                }
            }
            Some(reply) => {
                self.track = track_of(bundle_id, &reply, read_at);
                self.paused_until = None;
            }
        }
        self.note_pause(now);
    }
}

struct Cache {
    spotify: AppEntry,
    music: AppEntry,
    fetched: Option<Instant>,
    in_flight: bool,
    /// Morceau rendu en dernier par `now_playing` (pochette, commandes).
    current: Option<Track>,
    /// Dernière pochette lue : clé et octets.
    artwork: Option<(String, Vec<u8>)>,
}

static CACHE: Mutex<Cache> = Mutex::new(Cache {
    spotify: AppEntry::EMPTY,
    music: AppEntry::EMPTY,
    fetched: None,
    in_flight: false,
    current: None,
    artwork: None,
});

/// Verrou court : jamais tenu pendant un `osascript` ou un téléchargement.
fn cache() -> MutexGuard<'static, Cache> {
    CACHE.lock().unwrap_or_else(|e| e.into_inner())
}

pub fn now_playing() -> Result<Option<NowPlaying>> {
    let now = Instant::now();
    let due = {
        let cache = cache();
        let refresh_after = if cache.current.is_some() {
            REFRESH_KNOWN
        } else {
            REFRESH_IDLE
        };
        !cache.in_flight
            && cache
                .fetched
                .is_none_or(|at| now.duration_since(at) >= refresh_after)
    };
    // Core Audio hors du verrou (quelques ms) et seulement quand une relecture est due.
    let sounding: Vec<String> = if due {
        audio::apps_with_running(Direction::Output)
            .into_iter()
            .map(|app| app.id)
            .collect()
    } else {
        Vec::new()
    };
    let mut cache = cache();
    if due && !cache.in_flight {
        let spotify_sounding = sounding.iter().any(|id| id.eq_ignore_ascii_case(SPOTIFY));
        let music_sounding = sounding.iter().any(|id| id.eq_ignore_ascii_case(MUSIC));
        cache.spotify.forget_if_stale(now, spotify_sounding);
        cache.music.forget_if_stale(now, music_sounding);
        let ask_spotify = should_ask(
            cache.spotify.allowed(now),
            spotify_sounding,
            cache.spotify.following(now),
        );
        let ask_music = should_ask(
            cache.music.allowed(now),
            music_sounding,
            cache.music.following(now),
        );
        if ask_spotify || ask_music {
            cache.in_flight = true;
            let spawned = thread::Builder::new()
                .name("music-players".into())
                .spawn(move || refresh(ask_spotify, ask_music));
            if let Err(e) = spawned {
                cache.in_flight = false;
                log::debug!("lecture de Spotify / Musique impossible : {e}");
            }
        }
    }
    let tracks = [cache.spotify.track.clone(), cache.music.track.clone()];
    let candidates: Vec<(&str, Playback)> = tracks
        .iter()
        .map(|track| match track {
            Some(t) if t.playing => (t.bundle_id, Playback::Playing),
            Some(t) => (t.bundle_id, Playback::Paused),
            None => ("", Playback::Inactive),
        })
        .collect();
    let chosen = music::pick_session(&candidates).and_then(|index| tracks[index].clone());
    let playing = chosen.as_ref().map(Track::now_playing);
    cache.current = chosen;
    Ok(playing)
}

fn refresh(ask_spotify: bool, ask_music: bool) {
    let result = read_players(ask_spotify, ask_music);
    let read_at = now_ms();
    let mut guard = cache();
    let cache = &mut *guard;
    cache.in_flight = false;
    cache.fetched = Some(Instant::now());
    match result {
        Ok(reply) => {
            if ask_spotify {
                cache
                    .spotify
                    .apply("Spotify", SPOTIFY, reply.spotify, read_at);
            }
            if ask_music {
                cache.music.apply("Musique", MUSIC, reply.music, read_at);
            }
        }
        Err(e) => {
            log::debug!("lecture de Spotify / Musique : {e}");
            let until = Instant::now() + BACKOFF_AFTER_ERROR;
            for (asked, entry) in [
                (ask_spotify, &mut cache.spotify),
                (ask_music, &mut cache.music),
            ] {
                if asked {
                    entry.track = None;
                    entry.paused_since = None;
                    entry.paused_until = Some(until);
                }
            }
        }
    }
}

fn read_players(ask_spotify: bool, ask_music: bool) -> Result<Reply, String> {
    let flag = |ask: bool| if ask { "1" } else { "0" };
    let stdout = run_osascript(
        &[
            "-l",
            "JavaScript",
            "-e",
            READ_SCRIPT,
            flag(ask_spotify),
            flag(ask_music),
        ],
        SCRIPT_TIMEOUT,
    )?;
    serde_json::from_str(&stdout).map_err(|e| format!("réponse illisible : {e}"))
}

/// Lance `osascript` avec `args`, tué au-delà de `timeout`. Rend la sortie (sans espaces autour), ou le
/// texte d'erreur (qui contient le numéro d'erreur, ex. -1743).
fn run_osascript(args: &[&str], timeout: Duration) -> Result<String, String> {
    let mut child = Command::new("/usr/bin/osascript")
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("osascript : {e}"))?;
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() < timeout => thread::sleep(Duration::from_millis(50)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("osascript : délai dépassé".into());
            }
            Err(e) => return Err(format!("osascript : {e}")),
        }
    };
    let mut stdout = String::new();
    let mut stderr = String::new();
    if let Some(mut out) = child.stdout.take() {
        let _ = out.read_to_string(&mut stdout);
    }
    if let Some(mut err) = child.stderr.take() {
        let _ = err.read_to_string(&mut stderr);
    }
    if !status.success() {
        return Err(stderr.trim().to_owned());
    }
    Ok(stdout.trim().to_owned())
}

pub fn now_playing_artwork() -> Result<Option<Vec<u8>>> {
    let (current, cached) = {
        let cache = cache();
        (cache.current.clone(), cache.artwork.clone())
    };
    let Some(track) = current else {
        return Ok(None);
    };
    let Some(key) = track.artwork_key() else {
        return Ok(None);
    };
    if let Some((cached_key, bytes)) = cached {
        if cached_key == key {
            return Ok(Some(bytes));
        }
    }
    let bytes = match track.bundle_id {
        SPOTIFY => download_artwork(track.artwork_url.as_deref())?,
        _ => music_artwork()?,
    };
    if let Some(bytes) = &bytes {
        cache().artwork = Some((key, bytes.clone()));
    }
    Ok(bytes)
}

/// Pochette de Spotify : image téléchargée par `curl` (https seulement, délai et taille bornés).
fn download_artwork(url: Option<&str>) -> Result<Option<Vec<u8>>> {
    let Some(url) = url.filter(|u| valid_artwork_url(u)) else {
        return Ok(None);
    };
    let max_bytes = ARTWORK_MAX_BYTES.to_string();
    let output = Command::new("/usr/bin/curl")
        .args([
            "--silent",
            "--show-error",
            "--fail",
            "--location",
            "--proto",
            "=https",
            "--proto-redir",
            "=https",
            "--connect-timeout",
            "3",
            "--max-time",
            DOWNLOAD_MAX_SECS,
            "--max-filesize",
            max_bytes.as_str(),
        ])
        .arg(url)
        .stdin(Stdio::null())
        .output()
        .context("curl introuvable")?;
    ensure!(
        output.status.success(),
        "téléchargement de la pochette : {}",
        String::from_utf8_lossy(&output.stderr).trim()
    );
    let bytes = output.stdout;
    Ok((!bytes.is_empty() && bytes.len() <= ARTWORK_MAX_BYTES).then_some(bytes))
}

/// Pochette de Musique : AppleScript écrit les octets dans un fichier temporaire, lu puis supprimé.
fn music_artwork() -> Result<Option<Vec<u8>>> {
    let path = std::env::temp_dir().join(format!("sordulo-pochette-{}.img", std::process::id()));
    let _ = std::fs::remove_file(&path);
    let path_text = path.to_string_lossy().into_owned();
    let result = run_osascript(
        &["-e", MUSIC_ARTWORK_SCRIPT, path_text.as_str()],
        ARTWORK_TIMEOUT,
    )
    .map_err(|e| anyhow!("pochette de Musique : {e}"));
    let bytes = match result {
        Ok(reply) if reply == "ok" => std::fs::read(&path).ok(),
        Ok(_) => None,
        Err(e) => {
            let _ = std::fs::remove_file(&path);
            return Err(e);
        }
    };
    let _ = std::fs::remove_file(&path);
    Ok(bytes.filter(|b| !b.is_empty() && b.len() <= ARTWORK_MAX_BYTES))
}

pub fn media_command(command: MediaCommand) -> Result<()> {
    let bundle_id = cache()
        .current
        .as_ref()
        .map(|track| track.bundle_id)
        .ok_or_else(|| anyhow!("aucune musique en cours"))?;
    let action = match command {
        MediaCommand::Previous => "previousTrack",
        MediaCommand::Next => "nextTrack",
        MediaCommand::PlayPause => "playpause",
        MediaCommand::Open => return open_player(bundle_id),
    };
    let reply = run_osascript(
        &["-l", "JavaScript", "-e", COMMAND_SCRIPT, bundle_id, action],
        COMMAND_TIMEOUT,
    )
    .map_err(|e| anyhow!("{e}"))?;
    if reply == "closed" {
        bail!("le lecteur est fermé");
    }
    // Relire le lecteur dès le prochain tour de la boucle.
    cache().fetched = None;
    Ok(())
}

/// Met le lecteur au premier plan (`open -b`, comme `editor.rs`).
fn open_player(bundle_id: &str) -> Result<()> {
    let status = Command::new("/usr/bin/open")
        .arg("-b")
        .arg(bundle_id)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .context("open introuvable")?;
    ensure!(
        status.success(),
        "impossible d'ouvrir le lecteur ({status})"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reply(json: &str) -> AppReply {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn morceau_de_spotify() {
        let r = reply(
            r#"{"running":true,"state":"playing","name":"One More Time","artist":"Daft Punk","album":"Discovery",
                "duration":320357,"position":12.5,"trackId":"spotify:track:0DiWol3AO6WpXZgp0goxAV",
                "artworkUrl":"https://i.scdn.co/image/ab67616d0000b273"}"#,
        );
        let t = track_of(SPOTIFY, &r, 42).expect("morceau");
        assert!(t.playing);
        assert_eq!(t.duration_ms, Some(320_357));
        assert_eq!(t.position_ms, Some(12_500));
        assert_eq!(t.position_at, 42);
        assert_eq!(
            t.artwork_key().as_deref(),
            Some("com.spotify.client\u{1f}https://i.scdn.co/image/ab67616d0000b273")
        );
        let p = t.now_playing();
        assert_eq!(p.app_id, SPOTIFY);
        assert_eq!(p.artist.as_deref(), Some("Daft Punk"));
    }

    #[test]
    fn morceau_de_musique() {
        let r = reply(
            r#"{"running":true,"state":"paused","name":"Voyager","artist":"","album":"Discovery",
                "duration":227.4,"position":300.0,"trackId":"ABCDEF0123456789","artworkUrl":null}"#,
        );
        let t = track_of(MUSIC, &r, 7).expect("morceau");
        assert!(!t.playing);
        assert_eq!(t.duration_ms, Some(227_400));
        // Position au-delà de la durée : ramenée à la fin.
        assert_eq!(t.position_ms, Some(227_400));
        assert_eq!(t.artist, None);
        assert_eq!(
            t.artwork_key().as_deref(),
            Some("com.apple.Music\u{1f}ABCDEF0123456789")
        );
    }

    #[test]
    fn rien_a_montrer() {
        assert_eq!(track_of(SPOTIFY, &reply(r#"{"running":false}"#), 0), None);
        assert_eq!(
            track_of(MUSIC, &reply(r#"{"running":true,"state":"stopped"}"#), 0),
            None
        );
        // Publicité Spotify sans titre.
        assert_eq!(
            track_of(
                SPOTIFY,
                &reply(r#"{"running":true,"state":"playing","name":" "}"#),
                0
            ),
            None
        );
        // Spotify sans URL d'image (ou URL refusée) : pas de pochette.
        let t = track_of(
            SPOTIFY,
            &reply(
                r#"{"state":"playing","name":"Podcast","artworkUrl":"http://exemple.fr/a.jpg"}"#,
            ),
            0,
        )
        .expect("morceau");
        assert_eq!(t.artwork_key(), None);
        assert_eq!(t.duration_ms, None);
    }

    #[test]
    fn reponse_complete_et_refus() {
        let r: Reply =
            serde_json::from_str(r#"{"spotify":{"error":"-1743"},"music":{"absent":true}}"#)
                .unwrap();
        let mut spotify = AppEntry::EMPTY;
        spotify.apply("Spotify", SPOTIFY, r.spotify, 0);
        assert!(spotify.track.is_none());
        assert!(!spotify.allowed(Instant::now()));
        let mut musique = AppEntry::EMPTY;
        musique.apply("Musique", MUSIC, r.music, 0);
        assert!(!musique.allowed(Instant::now()));
        assert!(AppEntry::EMPTY.allowed(Instant::now()));
    }

    #[test]
    fn interroger_seulement_si_utile() {
        // Rien ne joue, rien n'est suivi : aucun osascript.
        assert!(!should_ask(true, false, false));
        // Le lecteur joue du son (Core Audio) : on lit son morceau.
        assert!(should_ask(true, true, false));
        // Morceau suivi (pause, reprise, changement de morceau) même sans son.
        assert!(should_ask(true, false, true));
        // Pause forcée (refus d'autorisation, absent, erreur) : jamais, même s'il joue.
        assert!(!should_ask(false, true, true));
    }

    #[test]
    fn morceau_suivi_puis_oublie_en_pause() {
        let start = Instant::now();
        let mut entry = AppEntry::EMPTY;
        assert!(!entry.following(start));
        let playing = reply(r#"{"state":"playing","name":"Voyager"}"#);
        entry.apply("Spotify", SPOTIFY, Some(playing), 0);
        assert!(entry.following(start + Duration::from_secs(3600)));
        // En pause : suivi encore un moment (l'île le garde 10 s), puis plus.
        let paused = || reply(r#"{"state":"paused","name":"Voyager"}"#);
        entry.apply("Spotify", SPOTIFY, Some(paused()), 0);
        let since = entry.paused_since.expect("pause notée");
        // Une relecture en pause ne repousse pas le début de la pause.
        entry.apply("Spotify", SPOTIFY, Some(paused()), 0);
        assert_eq!(entry.paused_since, Some(since));
        assert!(entry.following(since + Duration::from_secs(10)));
        let later = since + FORGET_PAUSED_AFTER + Duration::from_secs(1);
        assert!(!entry.following(later));
        // Le lecteur rejoue du son : gardé (il sera relu).
        entry.forget_if_stale(later, true);
        assert!(entry.track.is_some());
        // Silencieux : oublié, plus aucun osascript pour lui.
        entry.forget_if_stale(later, false);
        assert!(entry.track.is_none());
        assert!(!should_ask(
            entry.allowed(later),
            false,
            entry.following(later)
        ));
        // Reprise : la pause est effacée.
        entry.apply(
            "Spotify",
            SPOTIFY,
            Some(reply(r#"{"state":"playing","name":"Voyager"}"#)),
            0,
        );
        assert_eq!(entry.paused_since, None);
    }

    #[test]
    fn urls_de_pochette() {
        assert!(valid_artwork_url(
            "https://i.scdn.co/image/ab67616d0000b273"
        ));
        assert!(!valid_artwork_url("http://i.scdn.co/image/x"));
        assert!(!valid_artwork_url("file:///etc/passwd"));
        assert!(!valid_artwork_url("https://a.b/c d"));
        assert!(!valid_artwork_url("-o/tmp/x https://a"));
    }
}
