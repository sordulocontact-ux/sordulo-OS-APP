# Île : réagir à la musique écoutée

## Ticket d'origine
Demande de Maël (21/11) : « on avait prévu dans la maquette d'ajouter aussi le fait que l'île elle réagisse à la musique qu'on écoute […] quand elle détecte de la musique, on a la cover de l'artiste à gauche dans l'île, et à droite […] l'espèce de statistique là qui bouge pour les basses et les aigus, de la couleur de la cover, même un petit dégradé au lieu d'avoir juste une couleur unique serait bien. Exactement comme ce qu'on a sur les iPhones, avec les derniers iPhones avec la barre en haut. »

## Contexte
- Maquette : `design/prototypes/ile-sordulo-os.html`, état `music` (pochette 28 px à gauche, égaliseur à droite).
- Déjà codé côté front : état `music` compact (`view/layers/ActivityLayers.tsx` MusicLayer, barres animées par `view/loop.ts`, `.cover` / `.eq` dans `view/Island.module.css`, dégradé orange fixe des tokens `--island-music*`), musique dans la bulle (`view/BubbleContent.tsx`), rang 4 dans `coordinator/ranking.ts`, Claude qui dansent (`mood.music` du jardin), bouton Musique du labo. Aucune source ne l'alimentait.
- Rust : conventions relevées (couche `platform/`, boucle de sondage façon `monitor.rs`, `emit_to(WINDOW_PROMPT, …)`, commandes dans `commands.rs` + `generate_handler!`, octets bruts par `tauri::ipc::Response` comme `read_recording`, AppleScript par `osascript` dans `macos/pages.rs` avec cache non bloquant et repli sur refus `-1743`).

## Décisions
- Source : lecteur du système, pas de connecteur Spotify (réponse de Maël). Windows : Global System Media Transport Controls (tous les lecteurs). macOS : Spotify et Musique par AppleScript (MediaRemote fermé depuis macOS 15.4), autorisation « Automatisation » par app, refus = pas de musique pour cette app, jamais lancer une app fermée.
- Barres : animation façon iPhone, pas d'analyse du son (réponse de Maël), couleurs et dégradé tirés de la pochette.
- Vue ouverte au survol : pochette en grand, titre, artiste, précédent / lecture-pause / suivant (réponse de Maël).
- Toute lecture signalée par le système sauf les apps d'appel (réponse de Maël).
- Ajouts retenus (réponse de Maël) : pause gardée 10 s puis l'île se range ; clic sur la pochette = lecteur au premier plan ; barre de progression (temps écoulé / durée) quand le lecteur la donne ; interrupteur « Afficher la musique dans l'île » dans le menu du soleil.
- Contrat front / Rust posé par l'orchestrateur avant les lots : `MusicState`, `MusicCommand`, `DESKTOP_EVENTS.music`, `DESKTOP_COMMANDS.getMusic / getMusicArtwork / musicCommand` (`src/shared/desktop-contract.ts`) ; `IslandMusic`, `MusicPalette`, taille `musicOpen` (`src/features/island/types.ts`, `geometry.ts`) ; props optionnelles `music` / `onMusicCommand` (`view/types.ts`) (choix par défaut : optionnelles pour garder le typecheck vert entre les lots).
- Pochette : octets bruts par commande (`getMusicArtwork`), URL `blob:` côté front, couleurs extraites côté front (canvas) par une fonction pure testée (choix par défaut, suit `read_recording`).
- Commit et push sur `main` à la fin (réponse de Maël).

## Hors périmètre
- Vraie analyse du son, connecteur Spotify, autres lecteurs Mac que Spotify et Musique, paroles, file d'attente.

## Critères d'acceptation
- [ ] (compilé et testé unitairement ; essai réel avec un lecteur chez Maël) Windows : un morceau qui joue (Spotify app, navigateur…) fait apparaître l'île `music` avec la vraie pochette ; changement de morceau = nouvelle pochette et nouvelles couleurs.
- [ ] (à tester chez Sacha) macOS : idem avec Spotify et Musique ; refus d'Automatisation sans plantage ni boucle de demandes.
- [x] Barres en dégradé aux couleurs de la pochette ; à plat en pause ; immobiles sous réduction des animations.
- [x] Survol : vue ouverte avec pochette, titre, artiste, lecteur, barre de progression si connue, boutons précédent / lecture-pause / suivant qui marchent ; clic pochette = lecteur au premier plan.
- [x] Pause : l'île reste 10 s puis se range ; reprise dans ce délai = elle revient en lecture.
- [x] Apps d'appel jamais montrées comme musique ; la musique cède la place à l'appel (rang 4, bulle).
- [ ] (à tester chez Maël et Sacha) Interrupteur du menu du soleil : coupé = plus de musique dans l'île et plus de sondage.
- [x] Variantes `win` et `mac` ; aucune valeur de style en dur ; textes en français ; accessibilité (boutons au clavier, noms accessibles).
- [x] Labo : musique simulée avec pochette, couleurs, pause, progression.
- [x] typecheck, lint, tests, build ; Rust relu (compilation chez Maël pour Windows, chez Sacha pour macOS).

## Lots
| Lot | Objectif | Fichiers possédés | Dépend de | Modèle / effort | Statut |
|---|---|---|---|---|---|
| L0 | Contrat et types partagés | `src/shared/desktop-contract.ts`, `src/features/island/types.ts`, `view/types.ts`, tailles `musicOpen` de `geometry.ts` | - | orchestrateur | validé |
| L1 | Rust : lecture en cours Windows + macOS, boucle, événement, commandes, interrupteur du menu | `src-tauri/**` (Cargo.toml, platform/, music.rs, events.rs, commands.rs, lib.rs, state.rs, tray.rs, Info.plist) | L0 | opus / high | validé |
| L2 | Front données : wrappers Tauri, source « musique » (pause 10 s, pochette, couleurs), branchement du contrôleur | `src/lib/desktop.ts`, `src/features/island/controller/**`, `src/features/island/music/**` | L0 | opus / high | validé |
| L3 | Front rendu : couches music / musicOpen, barres en dégradé, progression, bulle, labo | `src/features/island/view/**`, `geometry.ts`, `src/styles/tokens.css` (section Île), `src/features/island/lab/**` | L0 | opus / high | validé |

## Journal
- 21/11 Exploration (front lu par l'orchestrateur, Rust par un sous-agent Explore). Questions posées, réponses notées. L0 fait par l'orchestrateur, typecheck et tests de l'île verts. Les outils de cette session ne compilent pas le Rust (pas de bibliothèques MSVC visibles) : le lot L1 sera relu à la main.
- 21/11 L1, L2 et L3 lancés en parallèle (opus / high).
- 21/11 L2 validé après un aller-retour (mise à jour immédiate de lecture / pause ajoutée). Tests controller + music verts (133), lint OK.
- 21/11 L3 validé : relu, typecheck / lint / 325 tests verts, vérifié à l'œil dans le labo (Chrome) : compact et ouvert, Windows et Mac, pause (barres à plat), progression, boutons. Corrigé par l'orchestrateur : nom accessible « Commandes de le lecteur » sans données → « Commandes du lecteur ».
- 21/11 L1 rendu, relu (Windows : COM MTA par fil, attentes WinRT bornées à 3 s, verrou jamais tenu pendant un appel), un aller-retour : sur Mac, osascript seulement quand Core Audio entend Spotify / Musique ou qu'un morceau est suivi. Validé sans compilation (impossible dans cette session).
- 21/11 Validation finale : typecheck, lint, 821 tests, build verts. Labo vérifié dans Chrome.

## Rapport
**Fait** : l'île réagit à la musique jouée sur l'ordinateur. Compact : vraie pochette et barres d'égaliseur animées façon iPhone (basses amples, aigus vifs, battement), en dégradé aux couleurs extraites de la pochette ; à plat en pause, immobiles sous réduction des animations. Survol : grande pochette (clic = lecteur au premier plan), titre, artiste, lecteur, progression (si connue), précédent / lecture-pause / suivant, au clavier. Pause gardée 10 s. Musique dans la bulle derrière les autres activités, Claude du jardin qui dansent seulement en lecture. Case « Afficher la musique dans l'île » dans le menu du soleil. Labo complet (3 morceaux simulés, pause, suivant, sans pochette, sans progression).

**Rust** : `music.rs` (pur : nom du lecteur, exclusion des apps d'appel, détection de changement, artworkId, boucle 1 s), `platform/windows/media.rs` (GSMTC), `platform/macos/media.rs` (osascript Spotify / Musique, cache, refus -1743, curl pour la pochette Spotify), commandes `get_music`, `get_music_artwork`, `music_command`, événement `desktop://music`, case du menu (`tray.rs`, `state.rs`), features `windows` (Foundation, Media_Control, Storage_Streams), texte Automatisation (`Info.plist`).

**Front** : contrat (`desktop-contract.ts`), types (`types.ts`, `view/types.ts`), wrappers (`src/lib/desktop.ts`), source `controller/sources/music.ts` (pause 10 s, pochette blob, mise à jour immédiate de lecture / pause), `music/palette.ts` + `music/artwork.ts` (couleurs), rendu (`view/**`, `geometry.ts` taille `musicOpen`), tokens Île (`--island-size-56`, `--island-radius-music-cover`), labo.

**Vérifications** : typecheck, lint, 821 tests (dont source musique, palette, animation des barres, géométrie, annonces), build. Labo vérifié à l'œil dans Chrome (compact et ouvert, Windows et Mac, pause, progression, boutons). **Rust compilé sur Windows** après coup (compilateur MSVC portable installé sur le poste de Maël, voir Journal) : build complet sans erreur ni avertissement, `cargo test --lib` 114 tests verts, diagnostic `print_now_playing` qui interroge bien le lecteur Windows. macOS : à compiler et tester chez Sacha.

**Décisions prises sans demander** : props `music` / `onMusicCommand` optionnelles ; couleurs extraites côté front ; case du menu non mémorisée entre deux lancements (comme le mode concentration) ; progression affichée seulement si durée ET position sont connues ; Mac : un morceau en pause depuis 30 s dans un lecteur silencieux est oublié (plus d'osascript) ; Windows : statut « Changing » compté comme en lecture.

**Points à regarder** : après un clic sur un bouton, l'île reste ouverte tant qu'elle garde le focus (comportement existant de toutes les vues ouvertes, pas propre à la musique). Mac : vérifier que Core Audio voit bien Musique (streaming Apple Music) et Spotify en sortie, sinon ils ne seraient jamais interrogés. Le Figma ne couvre pas la vue ouverte de la musique : à signaler à Sacha.

**Hors périmètre / non retenu** : vraie analyse du son, connecteur Spotify, autres lecteurs Mac, contournement MediaRemote.
- 21/11 Les Build Tools de Visual Studio avaient disparu du poste (cl.exe introuvable aussi dans le terminal de Maël), réinstallation impossible sans droits admin. Compilateur MSVC 14.44 + Windows SDK 10.0.26100 installés sans droits admin dans C:Usersmauzenet1msvc (paquets officiels du catalogue Visual Studio), variables utilisateur INCLUDE, LIB, VCINSTALLDIR, Path. Rust compilé sans erreur ni avertissement, 114 tests verts.
