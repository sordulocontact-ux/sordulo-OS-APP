//! Tempo (BPM) du morceau montré par l'île, lu dans l'API publique de Deezer (sans clé ni compte). Même code
//! pour Windows et macOS.
//!
//! But : faire hocher la tête des Claude (et battre l'égaliseur) au bon tempo quand le vrai son n'est pas
//! analysé : musique sur le téléphone (Spotify sur un autre appareil), macOS (pas d'écoute de la sortie),
//! vrai son sans tempo stable. Le front calcule la phase avec la position dans le morceau ; le vrai son
//! garde la priorité quand il donne un tempo.
//!
//! - [`bpm`] est appelé à chaque tour de la boucle de la musique (~1 s) : il rend le tempo s'il est déjà
//!   connu, sinon `None` et confie la recherche au thread `music-tempo` (le tour suivant aura la réponse, et
//!   `music.rs` émet alors l'état avec son `tempoBpm`). Jamais d'appel réseau dans la boucle.
//! - Recherche : `GET api.deezer.com/search` (artiste + titre, puis « Artiste - Titre » des vidéos, puis
//!   recherche libre), on garde un résultat dont le titre (et l'artiste) correspond, puis
//!   `GET api.deezer.com/track/{id}` pour son `bpm`. Deezer donne souvent `bpm: 0` : on essaie quelques
//!   correspondances, sinon pas de tempo (le front garde le tempo fixe).
//! - Cache par artiste et titre nettoyés : trouvé ou inconnu de Deezer = gardé pour la session ; erreur réseau
//!   ou quota (50 requêtes / 5 s chez Deezer) = nouvel essai après [`RETRY_AFTER`].
//! - Seuls le titre et l'artiste partent chez Deezer. Rien dans les logs au-delà du debug.
//!
//! Tout ce qui est pur (nettoyage, requêtes, correspondance, lecture des réponses) est testé plus bas.

use std::collections::HashMap;
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use reqwest::blocking::Client;
use serde_json::Value;

use crate::spotify::form_body;

const SEARCH_URL: &str = "https://api.deezer.com/search";
const TRACK_URL: &str = "https://api.deezer.com/track/";
const TIMEOUT: Duration = Duration::from_secs(6);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(4);
/// Après une erreur réseau ou un refus de Deezer : nouvel essai pour ce morceau au plus tôt après ce délai.
const RETRY_AFTER: Duration = Duration::from_secs(60);
/// Résultats lus par recherche.
const SEARCH_LIMIT: &str = "10";
/// Morceaux de Deezer lus au plus pour un même morceau (chaque lecture = une requête).
const MAX_TRACK_READS: usize = 3;
/// Au-delà, le cache repart de zéro (session très longue).
const MAX_ENTRIES: usize = 500;
/// Tempo plausible : en dehors, Deezer s'est trompé (ou `0` : inconnu).
const BPM_RANGE: std::ops::RangeInclusive<f64> = 40.0..=250.0;

// ---------------------------------------------------------------------------
// Pur : nettoyage, requêtes, correspondance, réponses
// ---------------------------------------------------------------------------

/// Morceau cherché : artiste et titre tels que le lecteur les donne.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Wanted {
    pub artist: Option<String>,
    pub title: String,
}

impl Wanted {
    /// Clé du cache : artiste et titre nettoyés et repliés.
    pub fn key(&self) -> String {
        format!(
            "{}\u{1f}{}",
            fold(&clean_artist(self.artist.as_deref().unwrap_or(""))),
            fold(&clean_title(&self.title))
        )
    }
}

/// Minuscules, lettres et chiffres seulement (accents compris), espaces simples.
pub fn fold(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for word in text
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
    {
        if !out.is_empty() {
            out.push(' ');
        }
        out.extend(word.chars().flat_map(char::to_lowercase));
    }
    out
}

/// Retire les passages entre parenthèses et crochets (« (feat. X) », « [Official Video] », « (2011 Remaster) »).
fn strip_brackets(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut depth = 0usize;
    for c in text.chars() {
        match c {
            '(' | '[' => depth += 1,
            ')' | ']' => depth = depth.saturating_sub(1),
            _ if depth == 0 => out.push(c),
            _ => {}
        }
    }
    out
}

/// Coupe au premier marqueur trouvé (insensible à la casse), en gardant ce qui précède.
fn cut_at(text: &str, markers: &[&str]) -> String {
    let lower = text.to_lowercase();
    let cut = markers
        .iter()
        .filter_map(|m| lower.find(m))
        .min()
        // `to_lowercase` peut changer la longueur de certains caractères : on ne coupe que sur une frontière.
        .filter(|&i| text.is_char_boundary(i))
        .unwrap_or(text.len());
    text[..cut].to_owned()
}

/// Titre nettoyé : sans parenthèses, sans « feat. X », sans suffixe de version (« - Remastered 2011 »,
/// « - Radio Edit »).
pub fn clean_title(title: &str) -> String {
    let stripped = strip_brackets(title);
    let mut text = cut_at(&stripped, &[" feat. ", " feat ", " ft. ", " ft "]);
    if let Some(i) = text.rfind(" - ") {
        // Mots entiers seulement : « Alive » ou « Credit » ne sont pas des versions.
        let suffix = fold(&text[i + 3..]);
        let version = suffix.split(' ').any(|w| {
            [
                "remaster",
                "remastered",
                "version",
                "edit",
                "mono",
                "stereo",
                "live",
                "mix",
            ]
            .contains(&w)
        });
        if version {
            text.truncate(i);
        }
    }
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Premier artiste, sans « - Topic » ni « VEVO » (chaînes YouTube).
pub fn clean_artist(artist: &str) -> String {
    let first = cut_at(artist, &[", ", " & ", " feat", " ft.", " x ", " et "]);
    let mut text = first.trim().to_owned();
    for suffix in [" - Topic", "VEVO"] {
        if let Some(rest) = text.strip_suffix(suffix) {
            text = rest.trim().to_owned();
        }
    }
    text
}

/// Une recherche Deezer et ce qu'un résultat doit respecter.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Query {
    /// Paramètre `q`.
    pub q: String,
    /// Titre attendu (nettoyé).
    pub title: String,
    /// Artiste attendu (nettoyé) ; `None` : n'importe lequel.
    pub artist: Option<String>,
    /// Texte où l'artiste du résultat doit apparaître (recherche libre sur un titre de vidéo) ; `None` : pas
    /// de contrôle de ce genre.
    pub artist_in: Option<String>,
}

/// Recherches à essayer, dans l'ordre. Couples (artiste, titre) : celui du lecteur, puis « Artiste - Titre »
/// tiré du titre (vidéo, l'artiste donné étant alors la chaîne). D'abord une recherche stricte par couple
/// (`artist:"…" track:"…"`), puis une recherche libre par couple (la stricte de Deezer rate des morceaux
/// connus) : l'artiste trouvé doit alors figurer dans l'artiste ou le titre donnés.
pub fn queries(wanted: &Wanted) -> Vec<Query> {
    let title = clean_title(&wanted.title);
    if title.is_empty() {
        return Vec::new();
    }
    let artist = wanted
        .artist
        .as_deref()
        .map(clean_artist)
        .filter(|a| !a.is_empty());
    let mut pairs: Vec<(Option<String>, String)> = vec![(artist, title.clone())];
    if let Some((left, right)) = title.split_once(" - ") {
        let (a, t) = (clean_artist(left), clean_title(right));
        if !a.is_empty() && !t.is_empty() {
            pairs.push((Some(a), t));
        }
    }
    let haystack = format!(
        "{} {}",
        wanted.artist.as_deref().unwrap_or(""),
        wanted.title
    );
    let strict = pairs.iter().filter_map(|(a, t)| {
        a.as_ref().map(|a| Query {
            q: format!("artist:\"{a}\" track:\"{t}\""),
            title: t.clone(),
            artist: Some(a.clone()),
            artist_in: None,
        })
    });
    let loose = pairs.iter().map(|(a, t)| Query {
        q: a.as_ref().map_or_else(|| t.clone(), |a| format!("{a} {t}")),
        title: t.clone(),
        artist: None,
        artist_in: Some(haystack.clone()),
    });
    let mut out: Vec<Query> = Vec::new();
    for query in strict.chain(loose) {
        if !out.iter().any(|q| q.q == query.q) {
            out.push(query);
        }
    }
    out
}

/// URL d'une recherche.
pub fn search_url(query: &Query) -> String {
    format!(
        "{SEARCH_URL}?{}",
        form_body(&[("q", &query.q), ("limit", SEARCH_LIMIT)])
    )
}

/// Deux textes repliés correspondent : égaux, ou l'un contient l'autre (au moins 3 caractères).
fn matches(a: &str, b: &str) -> bool {
    let (a, b) = (fold(a), fold(b));
    if a.is_empty() || b.is_empty() {
        return false;
    }
    a == b || (a.len().min(b.len()) >= 3 && (a.contains(&b) || b.contains(&a)))
}

/// Erreur renvoyée par Deezer dans le corps (`{"error": {...}}`, avec un statut 200).
fn deezer_error(json: &Value) -> Option<String> {
    let error = json.get("error")?;
    Some(
        error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("erreur inconnue")
            .to_owned(),
    )
}

/// Identifiants des résultats d'une recherche qui correspondent à `query`, dans l'ordre de Deezer.
pub fn parse_search(body: &str, query: &Query) -> Result<Vec<u64>, String> {
    let json: Value = serde_json::from_str(body).map_err(|e| format!("réponse illisible : {e}"))?;
    if let Some(message) = deezer_error(&json) {
        return Err(message);
    }
    let data = json.get("data").and_then(Value::as_array);
    let ids = data
        .into_iter()
        .flatten()
        .filter(|item| {
            let title_ok = ["title_short", "title"].iter().any(|k| {
                item.get(*k)
                    .and_then(Value::as_str)
                    .is_some_and(|t| matches(&clean_title(t), &query.title))
            });
            let found_artist = item
                .pointer("/artist/name")
                .and_then(Value::as_str)
                .unwrap_or("");
            let artist_ok = query
                .artist
                .as_deref()
                .map_or(true, |a| matches(found_artist, a));
            let artist_in_ok = query.artist_in.as_deref().map_or(true, |hay| {
                let (found, hay) = (fold(found_artist), fold(hay));
                !found.is_empty() && hay.contains(&found)
            });
            title_ok && artist_ok && artist_in_ok
        })
        .filter_map(|item| item.get("id").and_then(Value::as_u64))
        .collect();
    Ok(ids)
}

/// Tempo d'un morceau Deezer : `None` si inconnu (`0`) ou peu plausible.
pub fn parse_track_bpm(body: &str) -> Result<Option<f64>, String> {
    let json: Value = serde_json::from_str(body).map_err(|e| format!("réponse illisible : {e}"))?;
    if let Some(message) = deezer_error(&json) {
        return Err(message);
    }
    Ok(json
        .get("bpm")
        .and_then(Value::as_f64)
        .filter(|bpm| BPM_RANGE.contains(bpm))
        .map(|bpm| (bpm * 10.0).round() / 10.0))
}

// ---------------------------------------------------------------------------
// Réseau
// ---------------------------------------------------------------------------

fn get(client: &Client, url: &str) -> Result<String, String> {
    let response = client
        .get(url)
        .send()
        .map_err(|e| e.without_url().to_string())?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("statut {}", status.as_u16()));
    }
    response.text().map_err(|e| e.without_url().to_string())
}

/// Cherche le tempo d'un morceau. `Ok(None)` : Deezer ne le connaît pas ; `Err` : réseau ou refus (réessayer).
fn lookup(client: &Client, wanted: &Wanted) -> Result<Option<f64>, String> {
    let mut reads = 0;
    for query in queries(wanted) {
        let ids = parse_search(&get(client, &search_url(&query))?, &query)?;
        for id in ids {
            if reads == MAX_TRACK_READS {
                return Ok(None);
            }
            reads += 1;
            if let Some(bpm) = parse_track_bpm(&get(client, &format!("{TRACK_URL}{id}"))?)? {
                return Ok(Some(bpm));
            }
        }
    }
    Ok(None)
}

// ---------------------------------------------------------------------------
// Cache et thread de recherche
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy)]
enum Entry {
    /// Recherche en attente ou en cours.
    Pending,
    /// Réponse de Deezer (`None` : pas de tempo connu).
    Known(Option<f64>),
    /// Erreur à cet instant : nouvel essai après `RETRY_AFTER`.
    Failed(Instant),
}

struct Tempo {
    entries: Mutex<HashMap<String, Entry>>,
    sender: Sender<(String, Wanted)>,
}

impl Tempo {
    fn lock(&self) -> MutexGuard<'_, HashMap<String, Entry>> {
        self.entries.lock().unwrap_or_else(|e| e.into_inner())
    }
}

static TEMPO: OnceLock<Option<Tempo>> = OnceLock::new();

/// Le cache et son thread (lancé au premier appel). `None` si le thread n'a pas pu démarrer.
fn tempo() -> Option<&'static Tempo> {
    TEMPO
        .get_or_init(|| {
            let (sender, receiver) = mpsc::channel();
            let spawned = thread::Builder::new()
                .name("music-tempo".into())
                .spawn(move || worker(receiver));
            match spawned {
                Ok(_) => Some(Tempo {
                    entries: Mutex::new(HashMap::new()),
                    sender,
                }),
                Err(e) => {
                    log::warn!("tempo de la musique indisponible : {e}");
                    None
                }
            }
        })
        .as_ref()
}

/// Tempo (BPM) du morceau, s'il est déjà connu. Sinon `None`, et la recherche est lancée en arrière-plan.
pub fn bpm(artist: Option<&str>, title: &str) -> Option<f64> {
    let wanted = Wanted {
        artist: artist.map(str::to_owned),
        title: title.to_owned(),
    };
    let key = wanted.key();
    if clean_title(title).is_empty() {
        return None;
    }
    let tempo = tempo()?;
    let mut entries = tempo.lock();
    match entries.get(&key) {
        Some(Entry::Known(bpm)) => return *bpm,
        Some(Entry::Pending) => return None,
        Some(Entry::Failed(at)) if at.elapsed() < RETRY_AFTER => return None,
        _ => {}
    }
    if entries.len() >= MAX_ENTRIES {
        entries.clear();
    }
    entries.insert(key.clone(), Entry::Pending);
    if tempo.sender.send((key.clone(), wanted)).is_err() {
        entries.insert(key, Entry::Failed(Instant::now()));
    }
    None
}

fn client() -> Result<Client, String> {
    Client::builder()
        .https_only(true)
        .timeout(TIMEOUT)
        .connect_timeout(CONNECT_TIMEOUT)
        .user_agent(concat!("SorduloOS/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| format!("client HTTP indisponible : {e}"))
}

/// Thread de recherche : seulement la dernière demande en attente compte (morceaux passés vite), les autres
/// sont oubliées et seront redemandées si elles reviennent.
fn worker(receiver: Receiver<(String, Wanted)>) {
    let mut client: Option<Client> = None;
    while let Ok(first) = receiver.recv() {
        let mut latest = first;
        let mut skipped = Vec::new();
        while let Ok(next) = receiver.try_recv() {
            skipped.push(std::mem::replace(&mut latest, next).0);
        }
        let (key, wanted) = latest;
        if client.is_none() {
            match self::client() {
                Ok(c) => client = Some(c),
                Err(e) => log::warn!("tempo de la musique : {e}"),
            }
        }
        let result = match &client {
            Some(c) => lookup(c, &wanted),
            None => Err("pas de client HTTP".into()),
        };
        let entry = match result {
            Ok(bpm) => {
                log::debug!("tempo de la musique : {bpm:?} BPM");
                Entry::Known(bpm)
            }
            Err(e) => {
                log::debug!("tempo de la musique (Deezer) : {e}");
                Entry::Failed(Instant::now())
            }
        };
        if let Some(tempo) = TEMPO.get().and_then(Option::as_ref) {
            let mut entries = tempo.lock();
            for key in skipped {
                if matches!(entries.get(&key), Some(Entry::Pending)) {
                    entries.remove(&key);
                }
            }
            entries.insert(key, entry);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wanted(artist: Option<&str>, title: &str) -> Wanted {
        Wanted {
            artist: artist.map(str::to_owned),
            title: title.to_owned(),
        }
    }

    #[test]
    fn titres_nettoyes() {
        assert_eq!(
            clean_title("Harder, Better, Faster, Stronger"),
            "Harder, Better, Faster, Stronger"
        );
        assert_eq!(
            clean_title("Get Lucky (feat. Pharrell Williams)"),
            "Get Lucky"
        );
        assert_eq!(
            clean_title("Bohemian Rhapsody - Remastered 2011"),
            "Bohemian Rhapsody"
        );
        assert_eq!(
            clean_title("Blinding Lights - Radio Edit"),
            "Blinding Lights"
        );
        assert_eq!(
            clean_title("Daft Punk - One More Time [Official Video]"),
            "Daft Punk - One More Time"
        );
        assert_eq!(clean_title("Alors on danse ft. Kanye"), "Alors on danse");
        // Un tiret qui fait partie du titre reste.
        assert_eq!(clean_title("Ça - c'est Paris"), "Ça - c'est Paris");
        assert_eq!(clean_title("Stromae - Alive"), "Stromae - Alive");
    }

    #[test]
    fn artistes_nettoyes() {
        assert_eq!(clean_artist("Daft Punk, Pharrell Williams"), "Daft Punk");
        assert_eq!(clean_artist("Simon & Garfunkel"), "Simon");
        assert_eq!(clean_artist("Stromae - Topic"), "Stromae");
        assert_eq!(clean_artist("TaylorSwiftVEVO"), "TaylorSwift");
        assert_eq!(clean_artist("Angèle"), "Angèle");
    }

    #[test]
    fn repli_et_cle() {
        assert_eq!(fold("  Ça, c'est  PARIS !"), "ça c est paris");
        assert_eq!(
            wanted(Some("Daft Punk, Pharrell"), "Get Lucky (Radio Edit)").key(),
            wanted(Some("daft punk"), "GET LUCKY").key()
        );
        assert_ne!(wanted(Some("A"), "B").key(), wanted(Some("B"), "A").key());
    }

    #[test]
    fn requetes_dans_l_ordre() {
        let q = queries(&wanted(Some("Daft Punk"), "One More Time"));
        assert_eq!(q.len(), 2);
        assert_eq!(q[0].q, "artist:\"Daft Punk\" track:\"One More Time\"");
        assert_eq!(q[0].artist.as_deref(), Some("Daft Punk"));
        assert_eq!(q[1].q, "Daft Punk One More Time");
        assert_eq!(q[1].artist, None);

        // Vidéo : l'artiste donné est la chaîne, le vrai artiste est dans le titre.
        let q = queries(&wanted(
            Some("Majestic"),
            "Daft Punk - One More Time (Official Video)",
        ));
        let texts: Vec<&str> = q.iter().map(|q| q.q.as_str()).collect();
        assert_eq!(
            texts,
            [
                "artist:\"Majestic\" track:\"Daft Punk - One More Time\"",
                "artist:\"Daft Punk\" track:\"One More Time\"",
                "Majestic Daft Punk - One More Time",
                "Daft Punk One More Time",
            ]
        );
        assert_eq!(q[3].title, "One More Time");

        // Sans artiste : recherche libre seulement.
        let q = queries(&wanted(None, "One More Time"));
        assert_eq!(q.len(), 1);
        assert_eq!(q[0].q, "One More Time");

        assert!(queries(&wanted(Some("X"), "(Official Video)")).is_empty());
    }

    #[test]
    fn url_encodee() {
        let q = &queries(&wanted(Some("Angèle"), "Balance ton quoi"))[0];
        assert_eq!(
            search_url(q),
            "https://api.deezer.com/search?q=artist%3A%22Ang%C3%A8le%22%20track%3A%22Balance%20ton%20quoi%22&limit=10"
        );
    }

    const SEARCH: &str = r#"{"data":[
        {"id":1,"title":"One More Time (Radio Edit)","title_short":"One More Time","artist":{"name":"Daft Punk"}},
        {"id":2,"title":"One More Time","artist":{"name":"Cover Band"}},
        {"id":3,"title":"Something Else","artist":{"name":"Daft Punk"}}
    ],"total":3}"#;

    #[test]
    fn resultats_qui_correspondent() {
        let q = queries(&wanted(Some("Daft Punk"), "One More Time"));
        assert_eq!(parse_search(SEARCH, &q[0]).unwrap(), vec![1]);
        // Recherche libre : l'artiste trouvé doit figurer dans ce que le lecteur donne.
        assert_eq!(parse_search(SEARCH, &q[1]).unwrap(), vec![1]);
        let q = queries(&wanted(None, "One More Time"));
        assert!(parse_search(SEARCH, &q[0]).unwrap().is_empty());
        let q = queries(&wanted(None, "Cover Band - One More Time"));
        assert_eq!(parse_search(SEARCH, q.last().unwrap()).unwrap(), vec![2]);
        assert!(parse_search(r#"{"data":[]}"#, &q[0]).unwrap().is_empty());
    }

    #[test]
    fn erreurs_de_deezer() {
        let q = &queries(&wanted(Some("A"), "Bcd"))[0];
        let quota = r#"{"error":{"type":"Exception","message":"Quota limit exceeded","code":4}}"#;
        assert_eq!(parse_search(quota, q).unwrap_err(), "Quota limit exceeded");
        assert!(parse_track_bpm(quota).is_err());
        assert!(parse_search("<html>", q).is_err());
    }

    #[test]
    fn tempo_d_un_morceau() {
        assert_eq!(
            parse_track_bpm(r#"{"id":1,"bpm":122.67}"#).unwrap(),
            Some(122.7)
        );
        assert_eq!(parse_track_bpm(r#"{"id":1,"bpm":0}"#).unwrap(), None);
        assert_eq!(parse_track_bpm(r#"{"id":1,"bpm":400}"#).unwrap(), None);
        assert_eq!(parse_track_bpm(r#"{"id":1}"#).unwrap(), None);
    }

    /// Essai réel (réseau) : `cargo test music_tempo::tests::deezer_en_vrai -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn deezer_en_vrai() {
        let client = client().unwrap();
        for (artist, title) in [
            (Some("Daft Punk"), "One More Time"),
            (Some("Stromae"), "Alors on danse"),
            (
                Some("Majestic"),
                "Daft Punk - Around the World (Official Video)",
            ),
        ] {
            println!(
                "{artist:?} · {title} → {:?}",
                lookup(&client, &wanted(artist, title))
            );
        }
    }
}
