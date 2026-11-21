//! Réponses de l'API Web de Spotify (pur) : jetons, profil, lecture en cours → `NowPlaying`, et choix
//! entre le lecteur de l'ordinateur et Spotify à distance.

use serde::Deserialize;

use super::store::Tokens;
use crate::platform::NowPlaying;

/// Identifiant stable de la source « Spotify sur un autre appareil » (`MusicState.appId`).
pub const APP_ID: &str = "spotify:connect";
/// Largeur maximale voulue pour la pochette (Spotify donne 640, 300 et 64 px).
const ARTWORK_MAX_WIDTH: u32 = 640;
/// Longueur maximale d'une URL de pochette acceptée.
const ARTWORK_URL_MAX_LEN: usize = 2048;

// ---------------------------------------------------------------------------
// Jetons et profil
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct TokenReply {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    expires_in: Option<u64>,
}

/// Réponse de `POST /api/token` à l'instant `now` (ms). Sans `refresh_token` (rafraîchissement), on garde
/// `previous_refresh`.
pub fn parse_tokens(
    body: &str,
    now: u64,
    previous_refresh: Option<&str>,
) -> Result<Tokens, String> {
    let reply: TokenReply =
        serde_json::from_str(body).map_err(|e| format!("réponse de jetons illisible : {e}"))?;
    let refresh_token = reply
        .refresh_token
        .filter(|t| !t.is_empty())
        .or_else(|| previous_refresh.map(str::to_owned))
        .ok_or("jeton de rafraîchissement absent")?;
    if reply.access_token.is_empty() {
        return Err("jeton d'accès absent".into());
    }
    // Spotify donne 3600 s ; par défaut, une heure aussi.
    let expires_in = reply.expires_in.unwrap_or(3600);
    Ok(Tokens {
        access_token: reply.access_token,
        refresh_token,
        expires_at: now.saturating_add(expires_in.saturating_mul(1000)),
    })
}

/// Compte connecté (`GET /v1/me`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Profile {
    pub account: String,
    pub premium: bool,
}

#[derive(Deserialize)]
struct MeReply {
    #[serde(default)]
    display_name: Option<String>,
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    product: Option<String>,
}

pub fn parse_profile(body: &str) -> Result<Profile, String> {
    let me: MeReply =
        serde_json::from_str(body).map_err(|e| format!("profil Spotify illisible : {e}"))?;
    let account = [me.display_name, me.id]
        .into_iter()
        .flatten()
        .map(|name| name.trim().to_owned())
        .find(|name| !name.is_empty())
        .unwrap_or_else(|| "Compte Spotify".to_owned());
    Ok(Profile {
        account,
        premium: me.product.as_deref() == Some("premium"),
    })
}

/// Code d'erreur OAuth (`{"error":"invalid_grant",…}`) d'une réponse de `/api/token`.
pub fn oauth_error(body: &str) -> Option<String> {
    #[derive(Deserialize)]
    struct Reply {
        error: String,
    }
    serde_json::from_str::<Reply>(body).ok().map(|r| r.error)
}

/// Message et raison d'une erreur de l'API (`{"error":{"status":403,"message":"…","reason":"…"}}`).
pub fn api_error(body: &str) -> (Option<String>, Option<String>) {
    #[derive(Deserialize)]
    struct Inner {
        #[serde(default)]
        message: Option<String>,
        #[serde(default)]
        reason: Option<String>,
    }
    #[derive(Deserialize)]
    struct Reply {
        error: Inner,
    }
    match serde_json::from_str::<Reply>(body) {
        Ok(reply) => (reply.error.message, reply.error.reason),
        Err(_) => (None, None),
    }
}

// ---------------------------------------------------------------------------
// Lecture en cours
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct PlayerReply {
    #[serde(default)]
    device: Option<Device>,
    #[serde(default)]
    progress_ms: Option<u64>,
    #[serde(default)]
    is_playing: bool,
    #[serde(default)]
    item: Option<Item>,
}

#[derive(Deserialize)]
struct Device {
    #[serde(default)]
    name: Option<String>,
    #[serde(default, rename = "type")]
    kind: Option<String>,
    #[serde(default)]
    is_restricted: bool,
}

#[derive(Deserialize)]
struct Item {
    #[serde(default, rename = "type")]
    kind: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    duration_ms: Option<u64>,
    #[serde(default)]
    artists: Option<Vec<Named>>,
    #[serde(default)]
    album: Option<Collection>,
    /// Épisode : image de l'épisode.
    #[serde(default)]
    images: Option<Vec<Image>>,
    /// Épisode : l'émission.
    #[serde(default)]
    show: Option<Collection>,
}

#[derive(Deserialize)]
struct Named {
    #[serde(default)]
    name: Option<String>,
}

/// Album d'un morceau ou émission d'un épisode.
#[derive(Deserialize)]
struct Collection {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    images: Option<Vec<Image>>,
}

#[derive(Deserialize)]
struct Image {
    url: String,
    #[serde(default)]
    width: Option<u32>,
}

/// Ce qui joue sur le compte Spotify (n'importe quel appareil).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemotePlayback {
    /// `app_id` = [`APP_ID`], `artwork_key` = URL https de la pochette.
    pub track: NowPlaying,
    /// « Spotify sur iPhone de Maël », ou « Spotify » sans appareil connu.
    pub app_name: String,
    /// Appareil de type ordinateur (peut être celui-ci : appli de bureau ou lecteur web).
    pub on_computer: bool,
    /// Commandes possibles : compte Premium et appareil qui les accepte.
    pub can_control: bool,
}

/// URL de pochette acceptée : https seulement, longueur bornée, sans espace ni caractère de contrôle.
pub fn valid_artwork_url(url: &str) -> bool {
    url.starts_with("https://")
        && url.len() > "https://".len()
        && url.len() <= ARTWORK_URL_MAX_LEN
        && !url.chars().any(|c| c.is_whitespace() || c.is_control())
}

/// La plus grande image d'au plus 640 px de large, sinon la première (URL https seulement).
fn pick_image(images: &[Image]) -> Option<String> {
    let valid = || images.iter().filter(|i| valid_artwork_url(&i.url));
    valid()
        .filter(|i| i.width.is_some_and(|w| w <= ARTWORK_MAX_WIDTH))
        .max_by_key(|i| i.width)
        .or_else(|| valid().next())
        .map(|i| i.url.clone())
}

fn non_empty(text: Option<String>) -> Option<String> {
    text.map(|t| t.trim().to_owned()).filter(|t| !t.is_empty())
}

/// Lecture en cours d'après `GET /v1/me/player?additional_types=episode` (corps vide ou 204 : rien).
/// `read_at` : epoch en ms où `progress_ms` était juste (milieu de l'aller-retour). Publicité, morceau
/// inconnu ou sans titre : `None`.
pub fn parse_player(
    body: &str,
    premium: bool,
    read_at: u64,
) -> Result<Option<RemotePlayback>, String> {
    if body.trim().is_empty() {
        return Ok(None);
    }
    let reply: PlayerReply =
        serde_json::from_str(body).map_err(|e| format!("lecture Spotify illisible : {e}"))?;
    let Some(item) = reply.item else {
        return Ok(None);
    };
    let Some(title) = non_empty(item.name) else {
        return Ok(None);
    };
    let episode = item.kind.as_deref() == Some("episode");
    let (artist, album, artwork_key) = if episode {
        let show = item.show;
        let show_images = show
            .as_ref()
            .and_then(|s| s.images.as_deref())
            .unwrap_or(&[]);
        let artwork =
            pick_image(item.images.as_deref().unwrap_or(&[])).or_else(|| pick_image(show_images));
        (non_empty(show.and_then(|s| s.name)), None, artwork)
    } else {
        let names: Vec<String> = item
            .artists
            .unwrap_or_default()
            .into_iter()
            .filter_map(|a| non_empty(a.name))
            .collect();
        let artist = (!names.is_empty()).then(|| names.join(", "));
        let album = item.album;
        let artwork = album
            .as_ref()
            .and_then(|a| a.images.as_deref())
            .and_then(pick_image);
        (artist, non_empty(album.and_then(|a| a.name)), artwork)
    };
    let duration_ms = item.duration_ms.filter(|d| *d > 0);
    let position_ms = reply
        .progress_ms
        .map(|p| duration_ms.map_or(p, |d| p.min(d)));
    let device = reply.device;
    let device_name = device.as_ref().and_then(|d| non_empty(d.name.clone()));
    let app_name = match &device_name {
        Some(name) => format!("Spotify sur {name}"),
        None => "Spotify".to_owned(),
    };
    let on_computer = device
        .as_ref()
        .and_then(|d| d.kind.as_deref())
        .is_some_and(|k| k.eq_ignore_ascii_case("computer"));
    let restricted = device.as_ref().is_some_and(|d| d.is_restricted);
    Ok(Some(RemotePlayback {
        track: NowPlaying {
            app_id: APP_ID.to_owned(),
            title,
            artist,
            album,
            playing: reply.is_playing,
            position_ms,
            duration_ms,
            position_at: read_at,
            artwork_key,
        },
        app_name,
        on_computer,
        can_control: premium && !restricted,
    }))
}

// ---------------------------------------------------------------------------
// Choix de la source
// ---------------------------------------------------------------------------

fn same_title(a: &str, b: &str) -> bool {
    a.trim().to_lowercase() == b.trim().to_lowercase()
}

/// Le lecteur de l'ordinateur montre déjà cette lecture Spotify (l'appareil actif est cet ordinateur :
/// appli de bureau ou lecteur web) : même titre, et même état de lecture ou appareil de type ordinateur.
fn same_playback(local: &NowPlaying, remote: &RemotePlayback) -> bool {
    same_title(&local.title, &remote.track.title)
        && (local.playing == remote.track.playing || remote.on_computer)
}

/// L'ordinateur d'abord : ce qui JOUE sur l'ordinateur passe devant ; sinon Spotify à distance (en
/// lecture ou en pause), sauf si c'est la même lecture que celle vue par le lecteur du système ; sinon le
/// lecteur du système en pause. `true` : montrer `remote`.
pub fn prefer_remote(local: Option<&NowPlaying>, remote: &RemotePlayback) -> bool {
    match local {
        None => true,
        Some(local) if local.playing => false,
        Some(local) => !same_playback(local, remote),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TRACK: &str = r#"{
      "device": { "id": "d1", "is_active": true, "is_restricted": false, "name": "iPhone de Maël",
                  "type": "Smartphone", "volume_percent": 80 },
      "timestamp": 1700000000000,
      "progress_ms": 42000,
      "is_playing": true,
      "currently_playing_type": "track",
      "item": {
        "type": "track", "name": "One More Time", "duration_ms": 320357,
        "artists": [ { "name": "Daft Punk" }, { "name": "Romanthony" } ],
        "album": { "name": "Discovery", "images": [
          { "url": "https://i.scdn.co/image/grande", "width": 1000, "height": 1000 },
          { "url": "https://i.scdn.co/image/640", "width": 640, "height": 640 },
          { "url": "https://i.scdn.co/image/300", "width": 300, "height": 300 },
          { "url": "https://i.scdn.co/image/64", "width": 64, "height": 64 }
        ] }
      }
    }"#;

    const EPISODE: &str = r#"{
      "device": { "name": "Cuisine", "type": "Speaker", "is_restricted": true },
      "progress_ms": 5000, "is_playing": false, "currently_playing_type": "episode",
      "item": {
        "type": "episode", "name": "Épisode 12", "duration_ms": 1800000, "images": [],
        "show": { "name": "Le Podcast", "images": [ { "url": "https://i.scdn.co/image/show", "width": 640 } ] }
      }
    }"#;

    #[test]
    fn morceau_lu_sur_un_autre_appareil() {
        let p = parse_player(TRACK, true, 5_000).unwrap().expect("lecture");
        assert_eq!(p.track.app_id, APP_ID);
        assert_eq!(p.app_name, "Spotify sur iPhone de Maël");
        assert_eq!(p.track.title, "One More Time");
        assert_eq!(p.track.artist.as_deref(), Some("Daft Punk, Romanthony"));
        assert_eq!(p.track.album.as_deref(), Some("Discovery"));
        assert!(p.track.playing);
        assert_eq!(p.track.position_ms, Some(42_000));
        assert_eq!(p.track.duration_ms, Some(320_357));
        assert_eq!(p.track.position_at, 5_000);
        assert_eq!(
            p.track.artwork_key.as_deref(),
            Some("https://i.scdn.co/image/640")
        );
        assert!(!p.on_computer);
        assert!(p.can_control);
        // Sans Premium : pas de commandes.
        assert!(!parse_player(TRACK, false, 0).unwrap().unwrap().can_control);
    }

    #[test]
    fn episode_de_podcast() {
        let p = parse_player(EPISODE, true, 0).unwrap().expect("lecture");
        assert_eq!(p.track.title, "Épisode 12");
        assert_eq!(p.track.artist.as_deref(), Some("Le Podcast"));
        assert_eq!(p.track.album, None);
        assert!(!p.track.playing);
        // Pas d'image d'épisode : celle de l'émission.
        assert_eq!(
            p.track.artwork_key.as_deref(),
            Some("https://i.scdn.co/image/show")
        );
        assert_eq!(p.app_name, "Spotify sur Cuisine");
        // Appareil qui refuse les commandes.
        assert!(!p.can_control);
    }

    #[test]
    fn rien_publicite_ou_incomplet() {
        assert_eq!(parse_player("", true, 0).unwrap(), None);
        assert_eq!(
            parse_player(
                r#"{"is_playing":true,"currently_playing_type":"ad","item":null}"#,
                true,
                0
            )
            .unwrap(),
            None
        );
        assert_eq!(
            parse_player(
                r#"{"is_playing":true,"item":{"type":"track","name":"  "}}"#,
                true,
                0
            )
            .unwrap(),
            None
        );
        assert!(parse_player("{pas du json", true, 0).is_err());
    }

    #[test]
    fn sans_appareil_ni_pochette_valide() {
        let body = r#"{"progress_ms":999999,"is_playing":true,"item":{"type":"track","name":"X",
            "duration_ms":1000,"artists":[],"album":{"name":"","images":[
              {"url":"http://i.scdn.co/image/a","width":640},
              {"url":"javascript:alert(1)","width":300}]}}}"#;
        let p = parse_player(body, true, 0).unwrap().unwrap();
        assert_eq!(p.app_name, "Spotify");
        assert_eq!(p.track.artist, None);
        assert_eq!(p.track.album, None);
        // Jamais d'URL hors https.
        assert_eq!(p.track.artwork_key, None);
        // Position bornée à la durée.
        assert_eq!(p.track.position_ms, Some(1000));
    }

    #[test]
    fn image_sans_taille() {
        let body = r#"{"is_playing":true,"item":{"type":"track","name":"X","album":{"images":[
            {"url":"https://i.scdn.co/image/a","width":null}]}}}"#;
        let p = parse_player(body, true, 0).unwrap().unwrap();
        assert_eq!(
            p.track.artwork_key.as_deref(),
            Some("https://i.scdn.co/image/a")
        );
        assert!(valid_artwork_url("https://i.scdn.co/image/x"));
        assert!(!valid_artwork_url("https://"));
        assert!(!valid_artwork_url("https://a b"));
        assert!(!valid_artwork_url("file:///etc/passwd"));
    }

    #[test]
    fn jetons_et_profil() {
        let t = parse_tokens(
            r#"{"access_token":"a","token_type":"Bearer","expires_in":3600,"refresh_token":"r"}"#,
            1_000,
            None,
        )
        .unwrap();
        assert_eq!(t.access_token, "a");
        assert_eq!(t.refresh_token, "r");
        assert_eq!(t.expires_at, 3_601_000);
        // Rafraîchissement sans nouveau jeton de rafraîchissement : l'ancien est gardé.
        let t = parse_tokens(r#"{"access_token":"b","expires_in":60}"#, 0, Some("r")).unwrap();
        assert_eq!(
            (t.access_token.as_str(), t.refresh_token.as_str()),
            ("b", "r")
        );
        assert!(parse_tokens(r#"{"access_token":"b"}"#, 0, None).is_err());
        assert!(parse_tokens(r#"{"access_token":"","refresh_token":"r"}"#, 0, None).is_err());

        let p =
            parse_profile(r#"{"display_name":"Maël","id":"mael","product":"premium"}"#).unwrap();
        assert_eq!(
            p,
            Profile {
                account: "Maël".into(),
                premium: true
            }
        );
        let p = parse_profile(r#"{"display_name":null,"id":"mael","product":"free"}"#).unwrap();
        assert_eq!(
            p,
            Profile {
                account: "mael".into(),
                premium: false
            }
        );
        assert_eq!(parse_profile("{}").unwrap().account, "Compte Spotify");
    }

    #[test]
    fn erreurs_de_spotify() {
        assert_eq!(
            oauth_error(r#"{"error":"invalid_grant","error_description":"Refresh token revoked"}"#)
                .as_deref(),
            Some("invalid_grant")
        );
        assert_eq!(oauth_error("<html>"), None);
        assert_eq!(
            api_error(
                r#"{"error":{"status":403,"message":"Player command failed: Premium required","reason":"PREMIUM_REQUIRED"}}"#
            ),
            (
                Some("Player command failed: Premium required".into()),
                Some("PREMIUM_REQUIRED".into())
            )
        );
        assert_eq!(api_error(""), (None, None));
    }

    fn local(title: &str, playing: bool) -> NowPlaying {
        NowPlaying {
            app_id: "Spotify.exe".into(),
            title: title.into(),
            artist: None,
            album: None,
            playing,
            position_ms: None,
            duration_ms: None,
            position_at: 0,
            artwork_key: None,
        }
    }

    fn remote(title: &str, playing: bool, on_computer: bool) -> RemotePlayback {
        let mut p = parse_player(TRACK, true, 0).unwrap().unwrap();
        p.track.title = title.into();
        p.track.playing = playing;
        p.on_computer = on_computer;
        p
    }

    #[test]
    fn l_ordinateur_d_abord() {
        // Rien sur l'ordinateur : Spotify, en lecture comme en pause.
        assert!(prefer_remote(None, &remote("A", true, false)));
        assert!(prefer_remote(None, &remote("A", false, false)));
        // L'ordinateur joue : il passe devant.
        assert!(!prefer_remote(
            Some(&local("B", true)),
            &remote("A", true, false)
        ));
        // L'ordinateur en pause, le téléphone joue autre chose (ou la même chose) : Spotify.
        assert!(prefer_remote(
            Some(&local("B", false)),
            &remote("A", true, false)
        ));
        assert!(prefer_remote(
            Some(&local("A", false)),
            &remote("A", true, false)
        ));
        assert!(prefer_remote(
            Some(&local("B", false)),
            &remote("A", false, false)
        ));
        // Même lecture que celle de l'ordinateur (appareil actif = cet ordinateur) : la source système.
        assert!(!prefer_remote(
            Some(&local("a ", false)),
            &remote("A", false, false)
        ));
        assert!(!prefer_remote(
            Some(&local("A", false)),
            &remote("A", true, true)
        ));
    }
}
