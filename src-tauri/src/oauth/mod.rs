//! Briques OAuth communes aux connecteurs (Spotify, Google), même code pour Windows et macOS :
//! PKCE S256, `state` aléatoire, encodage des formulaires (`pkce.rs`) et petit serveur local qui reçoit la
//! redirection du navigateur (`callback.rs`). Chaque connecteur garde ses adresses, ses textes et ses appels.

pub mod callback;
pub mod pkce;
