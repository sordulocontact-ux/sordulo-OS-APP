# Ticket : l'île Sordulo OS (interface permanente de l'app de bureau)

## Contexte

L'app de bureau Tauri (Windows) affiche aujourd'hui une barre d'appel de 620 × 64 en haut de l'écran (`src/features/desktop/DesktopPromptPage.tsx`). Sacha a fait le prototype de ce qui la remplace : **l'île**, une forme noire collée au bord haut de l'écran, au centre, toujours présente. Elle change de forme selon ce qui se passe (appel, analyse, sessions Claude Code, notifications, fichier glissé) avec une animation à ressort.

**Source de vérité : `design/prototypes/ile-sordulo-os.html`.** Ouvre-le dans le navigateur et lis son code : tailles par état (objet `S`), forme (fonction `render`), ressort (raideur 380, amortissement 26), éléments partagés qui glissent d'un état à l'autre (objet `SH`), textes, couleurs, règles de priorité (`RANK`, `INTERRUPT`, file et regroupement des notifications, mode concentration, bulle secondaire). Reproduis-le fidèlement. Quand le prototype et ce ticket divergent, ce ticket gagne. Quand le prototype ne couvre pas un cas, reprends l'état le plus proche du prototype et note-le dans le rapport pour Sacha.

Répartition : Maël s'occupe de l'île et de la page projet, Sacha des pages annexes. Ce ticket ne touche pas aux pages annexes.

## Les états (voir le prototype pour chacun)

| État | Quand | Contenu |
|---|---|---|
| repos / survol | Rien en cours | Fine ligne (120 × 8) qui s'élargit un peu au survol |
| appel | Le micro s'active dans une app d'appel | « Appel détecté dans <app> », « Transcrire cet appel ? », choix du projet, Ignorer, Transcrire |
| meet | Enregistrement en cours | Icône de l'app, onde qui défile, minuteur |
| progress | Envoi de l'audio, puis analyse | Icône, libellé, anneau de progression |
| notif | Événement ponctuel | Icône ou avatar, titre, sous-titre, bouton, barre de temps (pause au survol). Variante avec la ligne d'appel au-dessus pendant un appel |
| agent | Une session Claude Code travaille | Icône Claude, points animés ; au survol : projet, branche, étape en cours, temps écoulé |
| agentAsk | Claude Code demande une autorisation | Commande, Refuser, Autoriser (et Plus tard s'il y a plusieurs sessions) |
| multi | Plusieurs sessions Claude Code | Compte + pastilles de statut ; au survol : une ligne par session avec tâche, statut, temps, « Répondre » ; au repos : le jardin des Claude |
| dragWake / dragOver | Un fichier est glissé vers l'île | « Dépose ici », puis les zones de dépôt |

## Ce qui doit marcher

### Phase 1 : coque et animation
- La fenêtre `prompt` actuelle devient l'île : fenêtre Tauri transparente, sans bordure, toujours au premier plan, absente de la barre des tâches, centrée en haut de l'écran principal.
- Les clics passent à travers tout ce qui n'est pas la forme noire. Approche conseillée : une fenêtre de la taille du plus grand état, transparente aux clics, et une surveillance de la position de la souris côté Rust qui réactive les clics quand la souris entre dans la forme.
- Forme, ressort, fondu des contenus et éléments partagés identiques au prototype, version Windows. Respect de `prefers-reduced-motion`.
- La barre actuelle (620 × 64) disparaît. Le menu de la zone de notification (soleil) reste.
- Prévoir dans le code les tailles Mac du prototype (variante autour de l'encoche), sans les activer : elles serviront au lot macOS.

### Phase 2 : le parcours d'appel (priorité la plus haute)
- La détection actuelle (apps d'appel, navigateurs qui jouent du son, titres de fenêtre) ne change pas. Elle déclenche l'état `appel` avec le nom de l'app détectée.
- `meet` : l'onde suit le vrai niveau sonore (micro + son de l'ordinateur), le minuteur part du début de l'enregistrement.
- **Arrêter l'enregistrement** : absent du prototype. Au survol, l'île s'ouvre (taille `agentOpen`) avec l'app, le projet et un bouton « Arrêter ». La proposition d'arrêter quand le micro redevient inactif reste.
- À l'arrêt : `progress` « Import de l'audio » puis « Analyse de l'appel », branchés sur les vrais statuts de l'entrée, puis la notification « N tickets à valider » dont le bouton ouvre la fenêtre principale sur l'écran de validation.
- Erreur d'envoi ou d'analyse : notification avec « Réessayer » (le mécanisme de relance existe déjà).

### Phase 3 : notifications et priorités
- Système de notifications générique : type, icône ou avatar, couleur, titre, sous-titre, bouton et action, durée (4,5 s par défaut, 7 s pour les rappels et les tickets à valider).
- Branchées dès maintenant : tickets à valider, analyse en erreur, « une tâche t'a été assignée » (Supabase Realtime, quand quelqu'un d'autre t'attribue une tâche), Claude a terminé, Claude attend tes consignes, conflit entre deux sessions.
- Prévues mais non branchées (les modules n'existent pas encore) : devis signé, paiement reçu, échéance, rappel de call, déploiement en ligne. Les déclarer dans le catalogue des notifications, typées, pour que les prochains tickets n'aient qu'à émettre l'événement.
- Coordination identique au prototype : une activité principale dans l'île, la suivante dans la bulle à droite avec « +N », clic sur la bulle pour l'épingler. Ordre : appel, progression, Claude, musique. Les autorisations Claude et les rappels passent devant. Plus de deux notifications en attente : regroupement. Mode concentration (activable dans le menu du soleil) : les notifications attendent la fin de l'appel, puis un résumé « Pendant l'appel : N notifications ».
- Cette logique vit dans un module sans interface, testé : les scénarios de priorité A à F du prototype deviennent des tests.

### Phase 4 : Claude Code
- Un petit relais en Rust que Claude Code appelle par ses hooks (SessionStart, PreToolUse, PostToolUse, PermissionRequest, Notification, Stop, SubagentStop, SessionEnd) et qui transmet à l'île en local (127.0.0.1 avec un jeton, ou un canal nommé).
- S'inspirer du relais de Coucou (https://github.com/Louis-CFM/coucou, dossier `windows/hook`, licence MIT), qui gère déjà ces événements dont PermissionRequest. Garder la mention de copyright MIT dans les fichiers repris, ne pas utiliser les noms Coucou ni Mochi.
- **Ne jamais bloquer Claude Code** : si l'île n'est pas lancée ou ne répond pas à temps, le relais rend la main sans décision et Claude Code demande dans le terminal comme d'habitude.
- Installation depuis l'app : « Connecter Claude Code » ajoute les hooks dans `~/.claude/settings.json` en gardant les hooks existants (fusion + sauvegarde du fichier), « Déconnecter » les retire.
- `agent` : le nom du projet vient du dossier de la session (relié au projet Sordulo OS si un nom correspond), la branche git, l'étape en cours tirée des outils utilisés (« Lit CLAUDE.md », « Modifie src/… », « Lance npm run typecheck »).
- `agentAsk` : la demande d'autorisation s'affiche, la réponse repart vers Claude Code.
- `multi` : à partir de deux sessions. Conflit : deux sessions qui modifient le même fichier déclenchent la notification de conflit.
- Le jardin des Claude (personnages qui se promènent, sous-agents, interactions, événements) : porter l'animation du prototype. C'est le dernier lot, il passe après tout le reste.

### Phase 5 : glisser-déposer
- L'île se réveille quand un fichier glissé arrive près d'elle (zone de 24 px autour), puis montre ses zones quand il est dessus. Détecter un glissement partout sur l'écran dès son début, comme dans le prototype, n'est pas fiable sous Windows.
- Zone « Transcrire » : seulement pour l'audio, crée une entrée « réunion » sur le projet choisi.
- Zone « Claude Code » : seulement si une session est active.
- Zone « Fichiers » : masquée tant que les fichiers de projet n'existent pas.

## Décisions déjà prises (ne pas redemander)

| Sujet | Décision |
|---|---|
| Plateforme | Windows. macOS reste le lot L13, mais le code de l'île prévoit déjà sa variante |
| Valeurs de style | Les couleurs et polices de l'île vont dans `src/styles/tokens.css`, dans une section « Île » (`--island-bg`, `--island-text`, `--island-muted`, `--island-field`, `--island-line`, `--island-ghost`, couleurs appel, Claude, succès, alerte, info). Les tailles par état et les réglages du ressort sont des cibles d'animation : elles vivent dans un fichier TypeScript dédié, commenté, et nulle part ailleurs |
| Icône Claude | L'icône pixel fournie par Sacha (dans le prototype), et sa silhouette en masque pour colorer les personnages du jardin |
| Hors périmètre | Musique (lecture en cours), progression des déploiements Vercel, branchement des devis, paiements, échéances et rappels de call, fichiers de projet, version macOS, pages annexes |

## À trancher pendant la phase de questions

- Police de l'île : Geist comme dans le prototype, ou la police de l'app ?
- Zone « Claude Code » : que fait concrètement un fichier déposé dessus (chemin copié pour le coller dans la session, ou autre) ?
- « Une tâche attend ta relecture » : qui est prévenu quand une tâche passe en relecture ?

## Critères d'acceptation

- [ ] Au repos, l'île est une fine ligne en haut au centre ; on clique à travers partout ailleurs, y compris sur les fenêtres juste en dessous.
- [ ] Les transitions entre états suivent le prototype (forme, ressort, éléments qui glissent), vérifiées à l'œil à côté du prototype ouvert dans le navigateur.
- [ ] Un vrai appel Discord ou Meet : proposition, enregistrement avec onde et minuteur, arrêt au survol, import, analyse, notification « N tickets à valider » qui ouvre l'écran de validation.
- [ ] Les scénarios de priorité A à F du prototype passent en tests.
- [ ] Deux sessions Claude Code en même temps apparaissent dans l'île ; une demande d'autorisation se valide depuis l'île ; l'île fermée, Claude Code demande dans le terminal sans attendre.
- [ ] Les hooks Claude Code existants sont conservés après « Connecter » et « Déconnecter ».
- [ ] Un fichier audio déposé sur la zone « Transcrire » crée une entrée sur le projet choisi.
- [ ] Typecheck, lint, tests (front et Rust) et build passent.
- [ ] Toutes les couleurs et polices viennent des tokens.
