use std::path::Path;

/// Identifiants de l'app Google de l'agence (client « Application de bureau »), compilés dans l'app et lus
/// par `option_env!` dans `src/google/` : variable d'environnement (secrets de la CI), sinon `../.env.local`
/// (poste de dev). Absents : l'app se compile quand même, les cartes Google disent « Indisponible ».
/// Les valeurs ne sont jamais affichées par ce script.
const GOOGLE_VARS: [&str; 2] = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"];
const ENV_FILE: &str = "../.env.local";

fn main() {
    google_credentials();
    tauri_build::build()
}

fn google_credentials() {
    let env_file = Path::new(ENV_FILE);
    // Fichier absent : pas de rerun-if-changed (Cargo relancerait ce script, donc l'app, à chaque build).
    // Créé plus tard : `cargo clean -p sordulo-os` ou toucher build.rs pour le prendre en compte.
    let file = if env_file.is_file() {
        println!("cargo:rerun-if-changed={ENV_FILE}");
        std::fs::read_to_string(env_file).unwrap_or_default()
    } else {
        String::new()
    };
    for name in GOOGLE_VARS {
        println!("cargo:rerun-if-env-changed={name}");
        let value = std::env::var(name)
            .ok()
            .map(|v| v.trim().to_owned())
            .filter(|v| !v.is_empty())
            .or_else(|| env_file_value(&file, name));
        match value {
            Some(value) if valid_value(&value) => println!("cargo:rustc-env={name}={value}"),
            Some(_) => println!("cargo:warning={name} ignorée : valeur sur plusieurs lignes ou invalide"),
            None => {}
        }
    }
}

/// Valeur de `name` dans un fichier `.env` (`NOM=valeur`, `export NOM=valeur`, guillemets simples ou
/// doubles, commentaires `#`). La dernière définition l'emporte, vide = absente.
fn env_file_value(file: &str, name: &str) -> Option<String> {
    let mut found = None;
    for line in file.lines() {
        let line = line.trim();
        let line = line.strip_prefix("export ").unwrap_or(line).trim_start();
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        if key.trim() != name {
            continue;
        }
        let value = value.trim();
        let value = match value.chars().next() {
            Some(quote @ ('"' | '\'')) => value[1..].split(quote).next().unwrap_or_default(),
            // Sans guillemets : un « # » précédé d'un espace commence un commentaire.
            _ => value.split(" #").next().unwrap_or_default().trim(),
        };
        found = Some(value.to_owned());
    }
    found.filter(|v| !v.is_empty())
}

/// Une valeur passée à `cargo:rustc-env` tient sur une ligne, sans caractère de contrôle.
fn valid_value(value: &str) -> bool {
    !value.chars().any(char::is_control)
}
