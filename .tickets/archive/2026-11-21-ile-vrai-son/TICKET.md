# Île : vraies basses / aigus et vrai rythme de la musique (Windows)

## Ticket d'origine
Demande de Maël (21/11) : « tu penses que c'est possible de le faire sur le rythme de la musique ? Et pareil pour les fausses basses et les faux sons aigus qui bougent tout seuls quand il y a une musique, de mettre les vrais. »

## Contexte
- Égaliseur simulé (`view/music.ts` stepEqualizer / stillEqualizer, 8 barres basses → aigus) écrit par `view/loop.ts` ; hochement des Claude (`garden/simulation.ts` walkerVisual, nodPulse sur `GARDEN.musicTempoBpm` = 116 fixe, de bas en haut depuis b1bb420).
- Musique : `src-tauri/src/music.rs` (boucle 1 s, lecteur du PC ou Spotify à distance, case du menu), source front `controller/sources/music.ts`.
- Capture loopback Windows existante pour l'enregistrement des appels (`platform/windows/capture.rs`, Source::System, crate wasapi), DSP (`platform/windows/dsp.rs`).

## Décisions
- Vrai son par analyse en direct du son de l'ordinateur ; pas de tempo par Spotify (audio-features fermé aux nouvelles apps) (réponse de Maël).
- Windows : loopback WASAPI du périphérique de sortie par défaut (sans autorisation ni voyant) (réponse de Maël).
- macOS : animation simulée gardée, sans capture (voyant violet sinon). Exception assumée par Maël à la règle « Windows ET macOS » : fonction plateforme macOS qui répond explicitement « non disponible », le front retombe sur la simulation ; à signaler à Sacha.
- Spotify à distance (aucun son sur le PC) ou capture indisponible : simulation actuelle (réponse de Maël).
- Ajouts retenus (réponse de Maël) : gain automatique (même mouvement à bas ou haut volume) ; silence = barres à plat même si le lecteur dit « en lecture ».
- Contrat posé par l'orchestrateur : `MusicLevels` (bands[8] 0..1, beatPeriodMs, lastBeatAt, at), `DESKTOP_EVENTS.musicLevels` (≈ 30/s, seulement pendant la musique du PC), `onMusicLevels` ; côté île `MusicLevelsReader { get(nowMs) }` (objet stable lu par la boucle, hors React), prop `musicLevels` de l'île.
- Commit et push sur main à la fin (réponse de Maël).

## Hors périmètre
- Vrai son sur macOS, vrai son pour Spotify à distance, case du menu « barres sur le vrai son », rythme simulé dans le labo (idées non retenues).

## Critères d'acceptation
- [ ] (à tester par Maël en écoutant) Windows, musique du PC : les barres suivent les vraies basses (gauche) et aigus (droite), au même niveau de mouvement à bas ou haut volume ; silence = à plat.
- [ ] (à tester par Maël) Les Claude hochent la tête sur les vrais temps (tempo détecté), le battement de l'égaliseur aussi ; sans tempo stable : tempo fixe.
- [x] Analyse seulement quand la musique joue sur le PC et que la musique est activée ; arrêt sinon ; CPU faible ; l'enregistrement d'un appel n'est pas gêné.
- [x] macOS, Spotify à distance, analyse absente depuis ~400 ms : simulation actuelle, sans erreur.
- [x] Animations réduites respectées.
- [x] typecheck, lint, tests, build ; `cargo test --lib` et `cargo build` sur Windows.

## Lots
| Lot | Objectif | Fichiers possédés | Dépend de | Modèle / effort | Statut |
|---|---|---|---|---|---|
| L0 | Contrat et types | `src/shared/desktop-contract.ts`, `src/lib/desktop.ts`, `src/features/island/types.ts`, `view/types.ts` | - | orchestrateur | validé |
| L1 | Rust : capture loopback, bandes, gain auto, détection des temps et du tempo, émission, cycle de vie ; macOS « non disponible » | `src-tauri/**` | L0 | opus / high | validé |
| L2 | Front : lecteur des niveaux (source musique), égaliseur sur le vrai son, hochement et battement sur les vrais temps, repli simulé | `src/features/island/controller/**`, `view/music.ts` (+test), `view/loop.ts`, `view/Island.tsx`, `garden/context.ts`, `garden/Garden.tsx`, `garden/simulation.ts` (+test), `lab/**` | L0 | opus / high | validé |

## Journal
- 21/11 Exploration, questions, contrat (L0).
- 21/11 L1 (Rust) et L2 (front) lancés en parallèle (opus / high).
- 21/11 L2 validé : relu, typecheck et 365 tests de l'île verts (lecteur stable sans rendu React par analyse, égaliseur sur les vraies bandes, hochement sur les vrais temps, repli simulé ; pas de notes en silence). Horloge : Rust et la webview lisent la même horloge système, pas de dérive.
- 21/11 L1 validé : relu, `cargo test --lib` 167 verts et `cargo build` sans avertissement (vérifiés par l'orchestrateur), capture loopback ouverte par le diagnostic. Validation finale : typecheck, lint, 868 tests, build.

## Rapport
**Fait** : sous Windows, l'île écoute le son que joue l'ordinateur pendant la musique du PC (loopback WASAPI de la sortie par défaut, flux partagé à part, l'enregistrement des appels n'est pas touché) : FFT maison (fenêtre ≈ 40 ms), 8 bandes 40 Hz → 16 kHz, gain automatique par bande, silence → bandes à 0, lissage, détection des temps (énergie des basses, seuil adaptatif) et du tempo (70-180 bpm, null si instable), émis ≈ 30 fois par seconde (`desktop://music-levels`) seulement quand la musique du PC joue et que la case du menu est cochée. Front : lecteur stable des niveaux (aucun rendu React par analyse), barres sur les vraies bandes avec battement des basses sur les vrais temps, hochement des Claude sur les vrais temps, aucun hochement ni note en silence ; repli sur la simulation sans analyse depuis 400 ms (Mac, Spotify à distance, erreur).

**Fichiers** : `src-tauri/src/music_levels/**`, `platform/windows/output_tap.rs`, `platform/mod.rs`, `platform/windows/{mod,capture,dsp}.rs`, `music.rs`, `events.rs`, `lib.rs` ; `src/features/island/` (source musique, contrôleur, égaliseur, boucle, Island, jardin) ; contrat, `src/lib/desktop.ts`, types ; `CLAUDE.md` (une phrase sur l'exception Mac).

**Vérifications** : typecheck, lint, 868 tests, build ; Rust Windows : 167 tests, build sans avertissement, diagnostic de capture ouvert (48 kHz). Non vérifié : rendu sur une vraie musique (rien ne jouait pendant les essais), macOS (à compiler chez Sacha).

**Décisions prises sans demander** : fenêtre de 2048 points (≈ 40 ms) au lieu de 1024 pour séparer les basses ; réouverture de l'écoute après 5 s de silence (changement de sortie) ; pas de notes ♪ en silence.

**À tester (Maël, Windows)** : musique du PC (basses à gauche, aigus à droite), volume bas (même mouvement après quelques secondes), hochement sur le rythme (si en retard : ajouter un décalage côté front), appel enregistré pendant la musique, CPU. Diagnostic : `cargo test --lib print_music_levels -- --ignored --nocapture` dans src-tauri pendant qu'un morceau joue. Réglages possibles dans `music_levels/analysis.rs`.

**Hors périmètre / non retenu** : vrai son sur Mac et pour Spotify à distance, case « barres sur le vrai son », rythme simulé dans le labo.
