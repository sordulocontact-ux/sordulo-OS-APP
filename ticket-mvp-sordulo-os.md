# Ticket : Sordulo OS, MVP du 18 novembre (réunion → tickets → tâches)

## Contexte

Sordulo est une agence (branding, sites, apps) de deux associés : Maël (dev) et Sacha (design). Sordulo OS est notre outil interne de gestion. Il sera vendu plus tard à d'autres agences, donc la base doit déjà gérer plusieurs organisations, même si une seule existe pour l'instant.

Ce soir, nous avons une réunion de test de l'app de notre client Ibé. Nous voulons l'enregistrer, la faire transcrire, et que l'IA transforme les retours d'Ibé en tickets et en tâches réparties entre nous deux.

**Date limite : aujourd'hui 20h.** Le repo est vide, tout est à créer.

## Ce qui doit marcher à 20h

1. Connexion de Maël et Sacha.
2. Une liste des projets, avec le projet « App Ibé » du client Ibé.
3. Une page projet avec trois onglets : Tickets, Tâches (kanban), Entrées.
4. Ajouter une entrée au projet de deux façons :
   - **Réunion** : envoyer un fichier audio, qui est transcrit avec séparation des voix.
   - **Retour écrit** : coller un texte (mail, message, transcription faite ailleurs).
5. L'IA lit l'entrée et propose des tickets, chacun avec ses tâches.
6. Un écran de validation : pour chaque ticket proposé, on peut modifier le titre, le type, la priorité et les tâches, puis Valider ou Refuser. Il y a aussi un bouton « Tout valider ».
7. Les tâches validées arrivent dans le kanban, déjà attribuées : tâche design à Sacha, tâche dev à Maël.

## Ordre de priorité si le temps manque

1. Retour écrit collé → tickets proposés → validation → tâches.
2. Kanban des tâches.
3. Envoi de l'audio + transcription.

Le parcours « coller un texte » sert aussi de plan B ce soir : si la transcription ne marche pas, on colle la transcription faite par un autre outil.

## Décisions déjà prises (ne pas redemander)

| Sujet | Décision |
|---|---|
| Front | React + Vite + TypeScript strict |
| Back, base, auth | Supabase : Postgres, Auth par lien magique (email), Row Level Security |
| Hébergement | Vercel : le front + des fonctions serverless dans `/api` pour tout ce qui utilise une clé secrète |
| IA | API Claude, appelée uniquement côté serveur. Modèle défini par une variable d'environnement |
| Fichiers audio | Supabase Storage pour ce soir (Cloudflare R2 prévu plus tard, garder l'accès au stockage dans un seul module pour pouvoir changer) |
| Design | Pas de design system ce soir. Interface sobre et lisible. Toutes les valeurs (couleurs, tailles, espacements, rayons) dans un seul fichier de tokens en variables CSS, pour brancher le design system Figma de Sacha plus tard |
| Attribution | Faite par le code, pas par l'IA : la tâche va au membre qui a le meilleur niveau dans la compétence demandée |
| Factures, devis, prospection | Hors périmètre ce soir |

## À choisir pendant la phase de questions

- L'API de transcription : elle doit gérer le français et séparer les voix (par exemple Deepgram ou AssemblyAI).

## Données

Toutes les tables ont un `organization_id`, et la RLS limite l'accès aux membres de l'organisation.

| Table | Champs principaux |
|---|---|
| organizations | id, name |
| members | id, organization_id, user_id (auth), name, email, role (admin, membre, prospection), skills (jsonb, ex. `{"design": 5, "dev": 2}`), weekly_capacity_hours |
| clients | id, organization_id, name, contact_name, contact_email |
| projects | id, organization_id, client_id, name, status, tone_of_voice |
| inputs | id, organization_id, project_id, kind (meeting, written), audio_path, raw_text, transcript (jsonb avec les voix), status (uploaded, transcribing, analyzing, ready, error), error_message, created_by, created_at |
| tickets | id, organization_id, project_id, input_id, title, description, type (bug, modification, new_request), priority (low, medium, high), source_quote, status (proposed, validated, rejected, done), related_ticket_id, created_at |
| tasks | id, organization_id, project_id, ticket_id, title, skill (design, dev), estimate_hours, assignee_member_id, status (todo, in_progress, review, done), depends_on_task_id, position |

**Données de départ** (script de seed) : l'organisation Sordulo, Maël (admin, dev 5, design 2), Sacha (admin, design 5, dev 1), le client Ibé et le projet « App Ibé ». Les comptes auth de Maël et Sacha sont liés aux membres à leur première connexion par l'email.

## Traitement d'une entrée

1. **Audio** : l'audio ne passe pas par une fonction Vercel (taille des requêtes limitée). Le navigateur l'envoie directement dans le stockage avec une URL signée, puis une fonction `/api` lance la transcription à partir de cette URL.
2. Le traitement est asynchrone : le statut de l'entrée est mis à jour à chaque étape, et le front l'affiche (rafraîchissement régulier ou temps réel Supabase).
3. **Analyse IA** (fonction `/api`) : Claude reçoit la transcription ou le texte, le contexte du projet (client, tickets encore ouverts) et la liste des compétences possibles. Il renvoie du JSON validé par un schéma (zod) :

```json
{
  "tickets": [
    {
      "title": "string",
      "description": "string",
      "type": "bug | modification | new_request",
      "priority": "low | medium | high",
      "source_quote": "extrait exact de la transcription",
      "related_ticket_id": "uuid d'un ticket ouvert si c'est la suite d'une demande existante, sinon null",
      "tasks": [
        { "title": "string", "skill": "design | dev", "estimate_hours": 1.5, "depends_on_index": null }
      ]
    }
  ]
}
```

Règles pour le prompt :
- Un ticket par demande distincte. Ne rien inventer qui n'est pas dans l'entrée.
- `source_quote` reprend les mots exacts de la transcription.
- Une demande qui touche un écran donne en général une tâche design puis une tâche dev qui dépend d'elle.
- Une simple discussion sans demande ne donne pas de ticket.
- Si le JSON est invalide, une nouvelle tentative, puis le statut `error` avec le message.

4. Les tickets sont enregistrés avec le statut `proposed`, puis l'attribution des tâches se fait dans le code.

## Écrans

- Connexion (lien magique).
- Liste des projets.
- Page projet :
  - **Tickets** : liste filtrable par statut et type, avec le passage de la réunion d'où vient chaque ticket.
  - **Tâches** : kanban en 4 colonnes (À faire, En cours, En relecture, Fait), changement de statut par glisser-déposer ou menu, filtre par personne.
  - **Entrées** : liste des réunions et retours, avec leur statut, et un bouton « Nouvelle entrée » (audio ou texte).
- Validation des tickets proposés d'une entrée.

États vides, de chargement et d'erreur sur chaque écran.

## Variables d'environnement

`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (serveur seulement), `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `TRANSCRIPTION_API_KEY`. Fournir un `.env.example`. Aucune clé secrète dans le code du front ni dans git.

## Critères d'acceptation

- [ ] Maël et Sacha se connectent et voient seulement les données de Sordulo.
- [ ] Coller un retour écrit d'Ibé crée des tickets proposés en moins d'une minute.
- [ ] Sur l'écran de validation, on peut modifier, valider ou refuser chaque ticket, et tout valider d'un coup.
- [ ] Les tâches validées apparaissent dans le kanban, attribuées selon la compétence.
- [ ] Une tâche dev qui dépend d'une tâche design l'indique dans le kanban.
- [ ] Un fichier audio d'environ 5 minutes est transcrit avec les voix séparées, puis analysé.
- [ ] Une erreur de transcription ou d'analyse s'affiche clairement, et on peut relancer.
- [ ] Typecheck, lint et build passent. L'app est déployée sur Vercel.
- [ ] Toutes les valeurs de style viennent du fichier de tokens.

## Hors périmètre

Devis, factures, contrats, prospection, catalogue de prestations, tableau de bord, fichiers du projet (hors audio), réorganisation automatique des tâches, notifications, design final.

## Test prévu

Vers 17h30, Sacha fournit une fausse réunion de 5 minutes et quelques retours écrits types d'Ibé. Ils servent au test complet avant la vraie réunion de ce soir.
