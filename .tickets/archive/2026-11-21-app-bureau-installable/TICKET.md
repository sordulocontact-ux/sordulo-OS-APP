# App de bureau installable avec mises à jour automatiques

## Ticket d'origine
« je veux une version installable oui les mises à jour arrivent automatiquement » (Sacha, 21/11/2026), à la suite du
lancement à l'ouverture de session (`src-tauri/src/autostart.rs`, ajouté le même jour, actif seulement en version installée).

Reprend le point reporté le 20/11 dans le ticket MVP : version release (installeur, plus de console, API pointée vers
Vercel avec CORS, sans serveur local), mises à jour automatiques.

## Contexte
- L'app de bureau (Tauri 2) ne tourne qu'en `tauri dev` : `bundle.active: false`, front servi par Vite, `/api` servi par
  `vite-plugin-api.ts`. Windows (Maël) et macOS (Sacha) fonctionnent en dev.
- Déjà prêt : pas de console en release (`main.rs`), `VITE_API_BASE_URL` prévu dans `.env.example` (pas encore lu),
  lien de connexion `sordulo://auth` (Info.plist + `auth_link.rs`), icônes de bundle, lancement à l'ouverture de session.
- Production web : https://sordulo-os-app.vercel.app (Vercel, push sur `main`).
- Dépôt : github.com/sordulocontact-ux/sordulo-OS-APP (privé aujourd'hui).

## Décisions
- Hébergement des installeurs et des mises à jour : **GitHub Releases du dépôt de code, rendu public** (réponse de
  l'utilisateur). Avant de basculer : scan des secrets sur tout l'historique ; s'il est propre, bascule en fin de
  ticket, sinon on montre les trouvailles sans basculer (réponse de l'utilisateur). Maël à prévenir.
- Compilation : GitHub Actions (gratuit et illimité sur un dépôt public), Mac et Windows en parallèle, sur un tag `v*`
  poussé par `npm run release` (réponse de l'utilisateur : publication par une commande).
- Signature Mac : certificat « Apple Development » déjà présent sur le Mac de Sacha, exporté en .p12 dans les secrets
  GitHub ; identité passée par variable d'environnement (`APPLE_SIGNING_IDENTITY`), jamais écrite dans le dépôt public
  (elle contient une adresse email personnelle). Pas de notarisation : premier lancement par « Ouvrir quand même »
  (réponse de l'utilisateur). Runtime renforcé + entitlements micro et Apple Events (choix par défaut).
- Windows : installeur NSIS par utilisateur (sans droits admin), non signé, mise à jour en mode silencieux (choix par défaut).
- Mac : binaire universel (Apple silicon + Intel), l'app sera vendue à d'autres agences (choix par défaut).
- Mises à jour : `tauri-plugin-updater`, clé de signature générée le 21/11 (privée : `~/.tauri/sordulo-os-updater.key`,
  chmod 600, + Trousseau `sordulo-os-updater-key` ; mot de passe : Trousseau `sordulo-os-updater-key-password`, compte
  `sordulo-os`). Point d'accès : `releases/latest/download/latest.json`. Perdre la clé privée = plus aucune mise à jour.
- Installation : téléchargée en arrière-plan, installée seule quand l'app n'est pas utilisée (fenêtre principale
  cachée, aucun enregistrement), jamais pendant un enregistrement (réponse de l'utilisateur).
- Dev jamais concerné : ni mise à jour ni lancement au démarrage en build debug (choix par défaut, cohérent avec autostart).
- Front embarqué dans l'app (décision du 20/11), API Vercel appelée en CORS depuis `tauri://localhost` (Mac) et
  `http://tauri.localhost` (Windows).
- Configuration de release dans `src-tauri/tauri.release.conf.json` (fusionnée par `tauri build --config`). Le relais
  Claude Code `sordulo-hook` (un `[[bin]]` du paquet, empaqueté d'office) y est aussi en `externalBin`, seule façon
  qu'il soit signé (codesign). tauri-build vérifie alors sa présence en compilant : le script le compile d'abord, et
  `externalBin` reste hors de la config de base pour ne pas casser `tauri dev`. App universelle : le script pose aussi
  le relais assemblé (lipo) dans `target/universal-apple-darwin/release/` (constaté en deux builds, orchestrateur).
- Ajouts retenus : version et « Rechercher une mise à jour » dans le menu du soleil ; page de téléchargement depuis le
  menu du compte du site ; compatibilité front / API (`DESKTOP_MIN_VERSION` dans `src/shared/desktop-version.ts`,
  `GET /api/desktop/min-version`, mise à jour forcée si l'app est trop vieille) ; notification après mise à jour.
- Commit sur `main` à la fin, sans pousser (réponse de l'utilisateur).

## Hors périmètre
- Notarisation Apple, signature Windows (certificat payant), Microsoft Store / Mac App Store.
- Linux.
- Canal bêta.

## Critères d'acceptation
- [x] `npm run desktop:build` produit une app Mac qui démarre sans serveur local, affiche le front embarqué, appelle l'API Vercel. (lancée le 21/11 : île, relais Claude, détection d'appel, écran de connexion embarqué, connexion Supabase en cours ; l'appel `/api/desktop/min-version` n'aboutira qu'une fois l'API poussée sur Vercel)
- [ ] (à la première release) Le workflow GitHub Actions compile Mac (universel, signé) et Windows (NSIS), publie une release avec `latest.json` et des installeurs aux noms stables.
- [ ] (à la deuxième release, 0.2.0 vers 0.2.1) L'app installée vérifie, télécharge et installe les mises à jour seule, jamais pendant un enregistrement ni fenêtre ouverte.
- [x] Menu du soleil : version, état de la mise à jour, « Rechercher une mise à jour ».
- [ ] (à la deuxième release) Notification « à jour » après une installation.
- [x] L'API répond en CORS aux origines de l'app de bureau, le site web n'est pas touché. (tests `api/_lib/cors.test.ts` ; en réel après le push)
- [x] Page de téléchargement accessible depuis le menu du compte, OS détecté.
- [x] App trop vieille pour l'API : écran « Mise à jour nécessaire » et installation immédiate.
- [x] `tauri dev` marche toujours sur Mac (et à vérifier par Maël sur Windows).
- [ ] Historique git scanné (propre) ; bascule publique en attente de l'accord de Sacha (notes `.tickets/` qui citent Ibé).
- [x] typecheck, lint, tests, build OK.

## Lots
| Lot | Objectif | Fichiers possédés | Dépend de | Modèle / effort | Statut |
|---|---|---|---|---|---|
| L0 | Socle : clé de signature, contrat `UpdateStatus` / commandes, `desktop-version.ts` | src/shared/desktop-contract.ts, src/shared/desktop-version.ts, src/shared/api-contract.ts | - | orchestrateur | validé |
| L1 | Packaging, signature, CI, commande de release | src-tauri/tauri.conf.json, src-tauri/tauri.release.conf.json, src-tauri/Entitlements.plist, scripts/build-desktop.mjs, scripts/release.mjs, .github/workflows/**, package.json, .gitignore, README.md | L0 | opus / high | validé |
| L2 | Mises à jour côté Rust : vérification, téléchargement, installation au bon moment, menu, notification | src-tauri/Cargo.toml, Cargo.lock, src-tauri/src/updater.rs, lib.rs, tray.rs, commands.rs, state.rs, events.rs, capabilities/default.json | L0 | opus / high | validé |
| L3 | API : CORS, base URL, `GET /api/desktop/min-version` | api/**, vite-plugin-api.ts, src/lib/api.ts | L0 | sonnet / medium | validé |
| L4 | Front : page de téléchargement, écran « Mise à jour nécessaire » | src/features/download/**, src/features/desktop-update/**, src/app/routes.tsx, src/app/AppLayout.tsx (+ css), src/lib/desktop.ts | L3 | sonnet / medium | validé |
| L5 | Intégration : build local Mac, scan des secrets, secrets GitHub, export du certificat, bascule publique | - | L1-L4 | orchestrateur | validé (sauf bascule publique) |

## Journal
- 14:08 Clé de signature des mises à jour générée et rangée (fichier + Trousseau).
- 14:12 L0 validé (contrat, `compareVersions` + 2 tests, typecheck OK).
- 14:15 L1, L2, L3 lancés en parallèle.
- 14:20 Scan des secrets (gitleaks 8, 92 commits, toutes les branches) : aucun secret. Données : seulement des adresses et IBAN/SIRET de test, adresses pro sordulo.fr/.com. À signaler avant la bascule : les journaux de `.tickets/` (internes) deviennent publics et citent le client Ibé (nom, date et durée de réunion, budget de la clé Anthropic), sans contenu de réunion.
- 14:25 L3 validé : `api/_lib/cors.ts` (origines Tauri seulement, jamais `*`), `route()` ajoute CORS + répond aux OPTIONS, `export { OPTIONS }` dans chaque route (Vercel : 405 sinon), `GET /api/desktop/min-version`, base `VITE_API_BASE_URL` dans `src/lib/api.ts`. 163 tests api/shared OK. Import `.js` corrigé dans `desktop-version.test.ts` (orchestrateur). L4 lancé.
- 14:45 L1 validé : `tauri.release.conf.json` (bundle, externalBin, updater, runtime renforcé, NSIS par utilisateur, macOS 14.0 min), `Entitlements.plist` (micro, Apple Events), `scripts/build-desktop.mjs` (`npm run desktop:build`, relais compilé et lipo pour l'universel, VITE_API_BASE_URL par défaut), `scripts/release.mjs` (`npm run release`), workflow sans tauri-action (2 builds + job de publication avec `latest.json` et noms stables). Versions à 0.2.0. Configs validées par le schéma de la CLI, pas encore compilées.
- 14:50 L4 validé : `/download` (OS détecté, consignes de premier lancement), entrée du menu du compte (absente dans l'app), `DesktopUpdateGate` + `UpdateRequiredScreen` (fenêtre main seulement), wrappers IPC, 12 tests. Aucun token ajouté, aucune valeur en dur. À signaler à Sacha : page et écran non couverts par le Figma.
- 14:50 Une autre session travaille en parallèle sur `.tickets/2026-11-21-ile-musique` (île, `platform/`, `lib.rs`, `tray.rs`, `Cargo.toml`, `desktop-contract.ts`, `desktop.ts`) : les erreurs de typage restantes viennent de son chantier en cours. Commit à faire en isolant les hunks de ce ticket.
- 15:20 Intégration dans un worktree isolé (sans le chantier musique) : typecheck, lint, 718 tests, build web, 106 tests Rust OK. Premier build universel : échec à l'empaquetage (relais universel introuvable). `externalBin` retiré, relais universel posé par le script. Build relancé.
- 15:35 Deuxième build : relais non signé (Tauri ne signe que l'exécutable et les `externalBin`). `externalBin` remis + copie universelle dans `target/`. Build relancé.
- 15:50 Troisième build universel signé : OK (codesign strict, runtime renforcé, entitlements, relais universel signé, `latest.json` signé).
- 00:30 Certificat Apple Development exporté en .p12 (script Swift `SecItemExport`, mot de passe généré et rangé au Trousseau, service `sordulo-os-apple-p12-password`), fichier supprimé après usage. Sept secrets GitHub posés.
- 00:32 App release lancée : démarre sans serveur local, front embarqué. Défaut trouvé : île dans un rectangle blanc. Cause : `import './IslandWindow.module.css'` sans utilisation, retiré par Vite 8 au build de production (présent en dev). Corrigé en lisant `styles.islandWindow`. ESLint lisait les fichiers générés de `src-tauri/target` après un build de release : dossier exclu.
- 00:45 main a avancé (chantier musique commité). Commit reconstruit dans un worktree propre sur le nouveau main : seuls les hunks de ce ticket (musique Mac MediaRemote, `stop_media` laissés à l'autre session). typecheck, lint, 890 tests, build, 168 tests Rust OK. Version Rust alignée sur 0.2.0.

## Rapport

**Fait.** L'app de bureau a une version installable (Mac : `.app` universelle signée + `.dmg` ; Windows : installeur NSIS par utilisateur) et se met à jour seule depuis GitHub Releases :
- vérification 60 s après le lancement puis toutes les 4 h ;
- installation silencieuse quand la fenêtre principale est cachée et qu'aucun appel n'est enregistré ;
- notification « à jour » après la relance.

Le reste :
- menu du soleil : version, état et « Rechercher une mise à jour » ;
- `/download` et entrée « Installer l'app de bureau » dans le menu du compte ;
- écran « Mise à jour nécessaire » quand l'API exige une version plus récente (`DESKTOP_MIN_VERSION`) ;
- CORS de l'API pour les origines Tauri ;
- `npm run desktop:build` et `npm run release`, workflow `.github/workflows/release.yml`.

**Fichiers.** Voir le tableau des lots ; en plus `src/features/desktop/DesktopPromptRoute.tsx` et `IslandWindow.module.css` (fond transparent de l'île perdu au build de production) et `eslint.config.js` (exclusion de `src-tauri/target` et `release-assets`).

**Vérifications.** typecheck, lint, 890 tests front, build web, 168 tests Rust : OK. Build Mac universel signé vérifié (codesign strict). App release lancée sur Mac (Apple silicon).

**Décisions prises sans demander.**
- App Mac signée « Apple Development », non notarisée : au premier lancement, clic droit > Ouvrir (consigne sur `/download`).
- macOS 14.0 minimum, comme la détection d'appels.
- NSIS par utilisateur, sans droits administrateur, et mise à jour `quiet`.
- Pas de `tauri-action` : deux builds puis un job de publication, pour garder des noms de fichiers stables (`Sordulo-OS-macOS.dmg`, `Sordulo-OS-Windows-setup.exe`).

**Reste à faire.**
- Pousser main avec le tag puis lancer `npm run release -- patch` ; vérifier la première release (workflow, `latest.json`, installeurs) puis la mise à jour 0.2.0 vers 0.2.1.
- Vérifier l'île transparente dans la version installée (corrigée, pas encore revue à l'écran).
- Bascule du dépôt en public : en attente de l'accord de Sacha (Ibé cité dans les notes internes).
- **Maël, sous Windows** :
  - `npm run tauri dev` ;
  - `npm run desktop:build`, puis installer le `.exe` ;
  - case « Lancer au démarrage » et redémarrage de session (l'app démarre sans fenêtre) ;
  - menu du soleil (version, « Rechercher une mise à jour ») ;
  - mise à jour silencieuse pendant un appel enregistré : elle doit attendre la fin.
- **À signaler à Sacha** : `/download` et l'écran « Mise à jour nécessaire » ne sont pas couverts par le Figma (tokens et composants existants réutilisés).

**Idées non retenues.** Canal bêta, notarisation Apple (compte payant), mises à jour différentielles.

