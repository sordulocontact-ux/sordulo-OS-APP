# Ticket : Sordulo OS V0.2, clients, projets et équipe

## Contexte

Le MVP est en ligne (https://sordulo-os-app.vercel.app + app de bureau Windows) : entrées, tickets, validation, kanban. Toutes ses décisions sont dans `.tickets/archive/2026-11-18-mvp-sordulo-os/TICKET.md`.

Problème : l'organisation, les membres, le client Ibé et le projet « App Ibé » ont été créés par le script de seed. **Il n'existe aucun écran pour ajouter un client, un projet ou un membre.** Impossible d'utiliser l'app pour un deuxième client sans passer par la base.

Ce ticket rend l'app autonome. Il prépare aussi les données dont le prochain ticket (catalogue, devis et factures PDF) aura besoin : infos légales de l'organisation, adresse de facturation et SIRET des clients.

## Ce qui doit marcher

### 1. Clients
- Nouvelle page **Clients** dans la barre latérale : tableau avec recherche, même modèle que la page Projets.
- Créer, modifier, archiver un client. Champs : nom de l'entreprise, SIRET (facultatif, 14 chiffres vérifiés), adresse de facturation (rue, code postal, ville, pays), site web, notes.
- **Contacts** d'un client : nom, email, téléphone, rôle, case « contact principal » (un seul par client). Remplace `contact_name` / `contact_email` de la table `clients` (données existantes reprises dans la migration).
- Fiche client : ses infos, ses contacts, la liste de ses projets.

### 2. Projets
- Bouton « Nouveau projet » sur la page Projets et sur la fiche client.
- Créer et modifier : client, nom, statut, date de début, date d'échéance, membres du projet, tone of voice.
- **Statuts** : prospect, devis envoyé, en cours, livré, payé, archivé. La migration transforme le statut actuel `active` en « en cours ».
- **Tone of voice** : quelques modèles à choisir (formel, chaleureux, direct, créatif) que l'on peut modifier en texte libre. Il est déjà envoyé à l'IA pendant l'analyse s'il est rempli : vérifier que c'est bien le cas, sinon l'ajouter au contexte de l'analyse.
- Filtre par statut et par client sur la page Projets. Les projets archivés sont masqués par défaut.

### 3. Équipe
- Nouvelle page **Équipe** (réservée aux admins) : liste des membres avec rôle, compétences, capacité.
- **Inviter un membre** : nom, email, rôle. Crée le membre et génère un lien de connexion à usage unique (même mécanisme que celui utilisé pour Sacha), à copier et envoyer soi-même. Pas d'envoi d'email (limite de Supabase).
- Modifier un membre : rôle (admin, membre, prospection), niveau en design et en dev (1 à 5), capacité en heures par semaine, jours indisponibles réguliers (ex. jours d'école ou d'alternance).
- Retirer un membre : il ne peut plus se connecter, ses tâches restent mais passent en « non attribuée ».
- Un admin ne peut pas se retirer lui-même ni retirer le dernier admin.

### 4. Paramètres de l'organisation
- Nouvelle page **Paramètres** (réservée aux admins) : nom, raison sociale, forme juridique, SIRET, adresse, mention TVA (texte libre, ex. « TVA non applicable, art. 293 B du CGI »), taux journalier et taux horaire par défaut.
- Ces champs ne servent à rien d'autre pour l'instant : ils seront utilisés par les devis du prochain ticket.

## Décisions déjà prises (ne pas redemander)

| Sujet | Décision |
|---|---|
| Design | Reprendre le design actuel (tokens, kit UI, tableau de la page Projets, barre latérale d'icônes). Aucune nouvelle valeur en dur. Les nouvelles icônes de la barre latérale suivent le style des existantes (20 px, trait 2 px, extrémités carrées). Si le Figma « SORDULO-OS » n'a pas l'écran, reprendre le modèle de l'écran le plus proche |
| Droits | La RLS reste la protection principale. Équipe et Paramètres : écriture réservée aux admins (côté base, pas seulement en masquant les boutons). Le rôle prospection ne voit ni Clients, ni Projets, ni Équipe, ni Paramètres (son espace viendra plus tard) |
| Clés secrètes | Tout ce qui demande la clé service (création de compte, lien de connexion) passe par une fonction `/api`, jamais par le front |
| Compétences | Les tâches restent en `design` ou `dev`. Le niveau d'un membre est stocké dans `members.skills` comme aujourd'hui |
| Migration | Nouvelle migration `0003`, appliquée en production par l'éditeur SQL comme la `0002`. Ne jamais supprimer de données existantes |
| Hors périmètre | Devis, factures, catalogue, prospection, tableau de bord, notifications, app de bureau macOS et version release Windows |

## À trancher pendant la phase de questions

- L'attribution automatique doit-elle tenir compte de la capacité hebdomadaire et des jours indisponibles, ou on stocke juste l'info pour l'instant ?
- Un membre « membre » (non admin) peut-il créer et modifier des clients et des projets, ou seulement les admins ?

## Critères d'acceptation

- [ ] Créer un nouveau client avec deux contacts, puis un projet pour ce client, sans toucher à la base.
- [ ] Une entrée (texte ou réunion) fonctionne sur ce nouveau projet comme sur « App Ibé ».
- [ ] Ibé et « App Ibé » existent toujours, avec leur contact repris dans la nouvelle table et le statut « en cours ».
- [ ] Inviter un membre génère un lien qui le connecte directement, et il voit les données de Sordulo selon son rôle.
- [ ] Un non-admin ne peut pas modifier l'équipe ni les paramètres, même en appelant Supabase directement (test RLS).
- [ ] Retirer un membre laisse ses tâches en « non attribuée ».
- [ ] Le tone of voice d'un projet est bien pris en compte par l'analyse.
- [ ] Tests RLS de la migration 0003, typecheck, lint, tests et build passent. Déployé sur Vercel.
- [ ] Toutes les valeurs de style viennent des tokens. Vérifié dans le navigateur sur chaque nouvel écran, états vides et erreurs compris.
