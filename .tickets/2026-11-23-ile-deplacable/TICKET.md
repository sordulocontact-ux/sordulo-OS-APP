# Île déplaçable (glisser, lancer, 4 bords, version verticale)

## Ticket d'origine
> je voudrais aussi ajouter le fait de pouvoir deplacer l'ile en la dragant et quelle se fit vert la ou je l'ai drag car des fois elle peut géner. quand je la drag et que je la jete vers l'endroit que j eveux, je veux quelle se fit un peu comme la physique du logo de next dans un serveur local, de bas eil est en bas a gauche ais si il gene du tu drag a un autre endroit et il si met bien. pour l'ile je voudrais qu'on puisse la fit, en bas de l'écran, mais aussi a gauche et a droite, et donc qu'il y est une version vertical

(Maël, 23/11/2026)

## Contexte
L'île est la fenêtre Tauri `prompt` (transparente, toujours devant, 640 × 300, clics qui passent à travers sauf sur les zones envoyées par le front). Elle est collée en haut au centre de la zone de travail de l'écran principal (`src-tauri/src/island_window.rs`, replacée toutes les 2 s), avec une variante `mac` autour de l'encoche (`?platform=mac`). Le front (`src/features/island/`) suppose partout une île collée en haut et horizontale : forme SVG calculée en JS (`geometry.ts` `shapeGeometry`), tailles par état (`ISLAND_SIZES`), positions des éléments partagés mesurées depuis le haut (`SHARED_ELEMENTS`), zones cliquables (`hitRectsFor`, y = 0), couches `top: 0`, jardin dont le sol est le bas de la forme. Environ 25 à 30 endroits.

Réutilisé : boucle du curseur Rust à ~60 Hz (`platform::cursor_state`, bouton gauche compris, Windows et Mac), placement et replacement de `island_window.rs`, ressort du front (`engine.ts`), labo `/desktop/ile-labo`.

## Décisions
- 4 places : milieu de chaque bord (haut au centre, bas au centre, gauche au milieu, droite au milieu). Le lancer choisit la place la plus proche du point projeté (position + vitesse × temps de projection), puis un ressort amène la fenêtre. (réponse utilisateur)
- Gauche / droite : île verticale au repos (états compacts : repos, peek, meet, music, musicGarden, progress, agent, multi, dragWake), éléments empilés le long du bord ; états ouverts (survol, notification, proposition d'appel, questions, dragOver…) en carte horizontale qui sort du bord, centrée sur le milieu du bord. Tout le texte reste horizontal. (réponse utilisateur)
- Ajouts retenus : « Replacer l'île en haut » dans le menu du soleil, aperçu de la place pendant le glisser (fenêtre `island-ghost`), lancer vers un autre écran. Non retenu : animations réduites. (réponse utilisateur)
- Fin : commit et push sur `main` (publie une version). (réponse utilisateur)
- Le glisser est piloté par Rust : le front détecte l'appui + un déplacement au-delà d'un seuil (6 px) et appelle `island_drag_start` ; Rust suit le curseur global (la fenêtre ignore la souris ailleurs que sur la forme, le front ne peut pas suivre seul), calcule la vitesse, choisit la place au relâchement, anime la fenêtre. Le clic qui suit le glisser est annulé. (choix par défaut : seule façon fiable avec une fenêtre transparente aux clics, même code Windows / Mac)
- Pendant le glisser, l'île reste dans son orientation et fermée (pas de survol) ; au relâchement, `island-placement` donne le nouveau bord, la fenêtre prend la taille du bord (`ISLAND_WINDOW_SIZE` : 640 × 300 horizontale, 520 × 480 verticale) et le ressort de la forme fait la transition. (choix par défaut)
- Encoche : variante `mac` seulement en haut d'un écran à encoche ; ailleurs (bas, côtés, autre écran) tailles `win`, sans encoche, même sur Mac. Sur Mac, en bas et sur les côtés, la zone de travail évite le Dock. (déduit de CLAUDE.md + exploration)
- Place mémorisée (bord + écran) dans `app_config_dir()` ; écran disparu = même bord sur l'écran principal. (choix par défaut, comme le témoin `island-hidden`)
- Contrat écrit par l'orchestrateur avant les lots : `src/shared/desktop-contract.ts` (IslandEdge, IslandPlacement, IslandDragStart, IslandDrag, IslandGhost, ISLAND_WINDOW_SIZE, fenêtre `island-ghost`, route `/desktop/ile-apercu`, événements `island-placement` / `island-drag` / `island-ghost`, commandes `get_island_placement` / `island_drag_start`), `src/lib/desktop.ts` (wrappers), `src-tauri/src/events.rs` (constantes), `src/features/island/types.ts` (réexport IslandEdge).

## Hors périmètre
- Positions libres le long d'un bord, coins.
- Mise en page verticale des états ouverts (ils restent des cartes horizontales).
- Maquette Figma de la version verticale : à signaler à Sacha (règle 8 de CLAUDE.md).

## Critères d'acceptation
- [ ] On saisit l'île et on la glisse ; un clic simple sur un bouton de l'île marche toujours (seuil). **Code fait, à tester dans l'app** : seuil 6 px et clic annulé (`view/drag.ts`, tests `isDragMove`).
- [ ] Relâchée ou lancée, elle se pose au milieu du bord visé avec un ressort ; le lancer compte. **Code fait, à tester dans l'app** : tests Rust de la projection, du choix du bord sur 2 écrans et du ressort (`island_window/geometry.rs`).
- [x] En bas : forme miroir, contenu lisible, Claude au sol. Preuve : labo, musique avec sessions, fermée et ouverte (défaut corrigé : la pochette était en miroir dans la carte ouverte).
- [x] À gauche / à droite : pilule verticale au repos, carte horizontale lisible à l'ouverture. Preuve : labo, musique avec jardin à gauche (fermée, ouverte), appel détecté et session Claude à droite.
- [ ] Zones cliquables justes sur les 4 bords. **Tests** `hitRectsFor` par bord ; à confirmer dans l'app.
- [ ] Aperçu discret de la place pendant le glisser. **Vu dans le labo** (« Simuler le glisser ») ; fenêtre `island-ghost` à tester dans l'app.
- [ ] Place gardée au redémarrage ; « Replacer l'île en haut » ; deuxième écran. **Code et tests Rust faits** (JSON, recherche de l'écran, repli) ; à tester dans l'app.
- [ ] Mac : en haut, toujours autour de l'encoche ; ailleurs sans encoche. (à compiler et tester par Sacha)
- [x] Labo : choix du bord ; vérifiés à l'œil : musique + jardin (haut, bas, gauche), appel détecté (droite), session Claude (droite), aperçu.
- [x] Typecheck, lint, 929 tests Vitest, build, clippy (aucun nouvel avertissement), cargo test.

## Lots
| Lot | Objectif | Fichiers possédés | Dépend de | Modèle / effort | Statut |
|---|---|---|---|---|---|
| L1 | Rust : place (bord + écran) mémorisée, taille de fenêtre par bord, ancres sur tous les écrans, glisser piloté par la boucle du curseur, projection du lancer, ressort de la fenêtre, fenêtre `island-ghost`, commandes et événements du contrat, « Replacer l'île en haut », Mac (encoche seulement en haut de l'écran à encoche) | `src-tauri/src/island_window.rs` (ou module `island_window/`), `src-tauri/src/tray.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/state.rs`, `src-tauri/src/platform/**` (si besoin), `src-tauri/capabilities/**`, `src-tauri/tauri.conf.json` | contrat | opus / high | validé |
| L2 | Front, rendu sur 4 bords : géométrie par bord (taille de la boîte, forme SVG miroir / transposée, éléments partagés transposés pour les états compacts verticaux, zones cliquables), moteur (ancrage de la boîte dans la fenêtre), couches et CSS par `data-edge`, jardin tourné sur les côtés, sol au bord de l'écran, encoche seulement en haut ; prop `edge` + détection du glisser (`onDragStart`) + `dragging` dans `<Island>` | `src/features/island/geometry.ts` (+ tests), `src/features/island/view/**`, `src/features/island/garden/**`, `src/styles/tokens.css` (section Île) | contrat | opus / high | validé |
| L3 | Câblage : contrôleur (bord depuis l'URL et `island-placement`, `onDragStart` → `islandDragStart`, `island-drag` → `dragging`), fenêtre d'aperçu `/desktop/ile-apercu`, labo (choix du bord, scène à la taille de la fenêtre) | `src/features/island/controller/**`, `src/features/island/ghost/**` (nouveau), `src/features/island/lab/**`, `src/app/routes.tsx` | L2 | sonnet / medium | validé |

## Journal
- 23/11 Exploration (sous-agent Explore), questions posées, contrat écrit.
- 23/11 L1 (Rust) et L2 (rendu sur 4 bords) lancés en parallèle.
- 23/11 L2 validé : rendu sur 4 bords (`edgeShapeGeometry`, `edgeFrameSize`, `sharedPlacement`, `islandOutline` pour l'aperçu, `view/drag.ts`), 394 tests île, typecheck/lint OK. Corrigé par l'orchestrateur : la taille envoyée à `island_drag_start` est celle de l'île fermée (on la saisit souvent ouverte au survol).
- 23/11 L1 validé : module `island_window/` (geometry, placement, motion), place mémorisée `island-placement.json`, glisser + projection 0,3 s + ressort (raideur 320, amortissement 25), fenêtre `island-ghost`, « Replacer l'île en haut ». cargo test 186 OK, clippy sans nouvel avertissement. Capability de l'aperçu réduite à `core:event:default` par l'orchestrateur. Sur Mac, `CursorState` passe en points (à vérifier par Sacha).
- 23/11 L3 lancé.
- 23/11 L3 validé : contrôleur (bord depuis l'URL et `island-placement`, `dragging`, survol coupé pendant le glisser), aperçu `/desktop/ile-apercu` (`ghost/`), labo (sélecteur « Bord », « Simuler le glisser »), 2 tokens `--island-preview-*`.
- 23/11 Vérification dans le labo par l'orchestrateur. Corrigé : (1) les calques du jardin n'étaient pas isolés (`z-index` des `.crowd` sorti du calque), donc les Claude passaient devant la pochette, l'égaliseur et le titre de la musique, ce qui annulait le passage derrière livré en v0.2.7 (signalé par Maël) : `isolation: isolate` sur `.garden` ; (2) en bas, les éléments partagés d'une carte ouverte étaient en miroir : miroir réservé aux états compacts (`sharedPlacement`).

## Rapport
**Fait** : l'île se glisse et se lance vers le milieu d'un des 4 bords, sur tous les écrans, avec un ressort (Rust, boucle du curseur) ; version miroir en bas ; pilule verticale à gauche et à droite, carte horizontale à l'ouverture ; aperçu de la place pendant le glisser (fenêtre `island-ghost`) ; place mémorisée (`island-placement.json`) ; « Replacer l'île en haut » dans le menu du soleil ; labo avec choix du bord. En plus : correction des Claude qui ne passaient jamais derrière la musique.

**Fichiers** : Rust `src-tauri/src/island_window/` (mod, geometry, placement, motion), `commands.rs`, `lib.rs`, `state.rs`, `tray.rs`, `events.rs`, `platform/mod.rs`, `platform/macos/island.rs`, `capabilities/island-ghost.json` ; front `src/shared/desktop-contract.ts`, `src/lib/desktop.ts`, `src/features/island/` (geometry, view, controller, ghost, lab, types), `src/app/routes.tsx`, `src/styles/tokens.css`.

**Vérifications** : typecheck, lint, 929 tests Vitest, build, clippy, cargo test (Windows). Labo vérifié dans Chrome.

**Décisions prises sans demander** : glisser piloté par Rust ; taille envoyée à l'aperçu = île fermée ; projection 0,3 s, ressort raideur 320 / amortissement 25 ; sur les côtés, les Claude ont les pieds côté écran ; en vertical, onde de l'appel et textes compacts masqués ; capability de l'aperçu `core:event:default`.

**Reste** :
- Maël : tester dans l'app installée (glisser, lancer, clic simple, deuxième écran, redémarrage, « Replacer l'île en haut »).
- Sacha : compiler et tester sur Mac (repère du curseur passé en points dans `platform/macos/island.rs`, encoche en haut inchangée, Dock en bas et sur les côtés, aperçu au-dessus de la barre des menus) ; maquette Figma de la pilule verticale (règle 8 de CLAUDE.md).
- Petits défauts connus : bascule du jardin au survol de la musique sur un côté (petit saut) ; à droite, le passage agent vers jardin part du bas.

**Idées non retenues** : animations réduites (pose directe sans ressort).
