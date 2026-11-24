/**
 * Catalogue des notifications de l'île : un constructeur typé par sorte (NotificationKind).
 *
 * Textes repris du prototype (design/prototypes/ile-sordulo-os.html, objet NOTIFS) quand ils existent,
 * écrits dans le même ton sinon. Aucune couleur ici : chaque notification porte un ton (IslandTone)
 * que le rendu traduit en token `--island-*`. Les sortes prévues (devis, paiement, echeance, rappel,
 * relecture, fileAdded, conflictOk) sont prêtes : un prochain ticket n'a qu'à appeler
 * `createNotification(kind, params)` puis `coordinator.notify(...)`.
 * Pur : ni React ni Tauri.
 */
import type {
  IslandIconName,
  IslandNotification,
  IslandTone,
  NotificationAction,
  NotificationKind,
  NotificationVisual,
} from "./types";

/** Durée par défaut d'une notification. */
export const DEFAULT_NOTIFICATION_MS = 4500;
/** Rappels de call et tickets à valider : on laisse le temps de lire et de cliquer. */
export const LONG_NOTIFICATION_MS = 7000;
/** Conflit entre deux sessions Claude Code (prototype : 5 s). */
export const CONFLICT_NOTIFICATION_MS = 5000;
/** Regroupement « N nouveautés » / « Pendant l'appel : N notifications » (prototype : 6 s). */
export const DIGEST_NOTIFICATION_MS = 6000;

/** Paramètres communs aux notifications Claude Code : sous-titre « projet : détail ». */
export interface ClaudeNotificationParams {
  projectName: string;
  /** « 4 fichiers modifiés », « Commande refusée : npm run build »… Vide : le projet seul. */
  detail: string;
  /** Session concernée : un clic sur la notification ouvre sa fenêtre VS Code. */
  sessionId?: string;
}

/** Paramètres de chaque sorte de notification. */
export interface NotificationParams {
  /** Analyse terminée : tickets proposés à valider (0 : « Aucun ticket proposé », bouton Ouvrir). */
  tickets: {
    count: number;
    inputTitle: string;
    projectName: string;
    route: string;
  };
  /** Analyse d'une entrée en erreur. */
  analysisError: { message: string; inputId: string };
  /** Envoi de l'audio en erreur (l'enregistrement reste en attente). */
  /** `title` remplace « L'envoi de l'audio a échoué » (document, copie de chemin). */
  uploadError: { message?: string; title?: string };
  /** Au démarrage : un enregistrement n'a pas été envoyé. */
  pendingUpload: { detail?: string };
  /** Appel détecté sans session Supabase. */
  loginRequired: { appName?: string | null; route?: string };
  /** Accès au compte Spotify perdu. */
  spotifyReconnect: Record<string, never>;
  /** Jeton Vercel refusé (invalide, expiré ou révoqué). */
  vercelReconnect: Record<string, never>;
  /** Le micro est redevenu inactif pendant l'enregistrement. Interrompt : concerne l'appel en cours. */
  callEnded: { appName?: string | null; projectName?: string | null };
  /** « Enregistrer un appel » pendant un enregistrement. Interrompt : concerne l'appel en cours. */
  recording: { appName?: string | null; projectName?: string | null };
  /** Démarrage (`start`) ou arrêt (`stop`) de l'enregistrement en échec ; `message` : erreur Rust. */
  recordError: { phase: "start" | "stop"; message: string };
  /** Quelqu'un d'autre t'a attribué une tâche. */
  assign: {
    assignerName: string;
    assignerInitials: string;
    taskTitle: string;
    route: string;
  };
  claudeDone: ClaudeNotificationParams;
  claudeStop: ClaudeNotificationParams;
  multiDone: ClaudeNotificationParams;
  conflict: ClaudeNotificationParams;
  /** Fichier déposé sur la zone « Claude Code » : son chemin est dans le presse-papiers. */
  pathCopied: { fileName: string };
  /** Regroupement, construit par la coordination. Bouton « Voir » ; action : fermer, sauf si précisée. */
  digest: { title: string; subtitle: string; action?: NotificationAction };
  /**
   * Déploiement de production en ligne. `projectName` : nom affiché dans le titre (« X est en ligne »), le
   * dépôt Git, sinon le projet Vercel. `url` : adresse ouverte par le bouton. `commitMessage` : sous-titre
   * (sans commit : « Déploiement Vercel réussi »).
   */
  deployed: { projectName: string; url: string; commitMessage?: string | null };
  /**
   * Déploiement de production en échec. `projectName` : nom affiché dans le titre (« X : échec »), le dépôt
   * Git, sinon le projet Vercel. Sous-titre : message du commit, sinon la branche. `logsUrl` : page du
   * déploiement dans Vercel (logs), ouverte par « Voir les logs ».
   */
  deployFailed: {
    projectName: string;
    logsUrl: string;
    commitMessage?: string | null;
    branch?: string | null;
  };
  // Prévues, non branchées
  devis: {
    clientName: string;
    projectName: string;
    amountEur: number;
    route: string;
  };
  paiement: {
    clientName: string;
    invoiceTitle: string;
    amountEur: number;
    route: string;
  };
  /** `when` : « demain », « vendredi »… */
  echeance: {
    projectName: string;
    when: string;
    remainingTasks: number;
    route: string;
  };
  /** Passe devant tout le reste (interruption), bouton « Rejoindre ». */
  rappel: {
    meetingTitle: string;
    minutes: number;
    appName: string;
    projectName?: string | null;
    url: string;
  };
  /** Déclarée sans rôle relecteur en base (décision du ticket). */
  relecture: { authorInitials: string; taskTitle: string; route: string };
  fileAdded: { projectName: string; fileName: string; route: string };
  conflictOk: ClaudeNotificationParams;
}

let sequence = 0;

/** Id unique par notification émise (dans ce processus, et d'un lancement à l'autre grâce à l'heure). */
function nextId(kind: NotificationKind): string {
  sequence += 1;
  return `${kind}-${Date.now().toString(36)}-${sequence}`;
}

interface Fields {
  visual: NotificationVisual;
  tone: IslandTone;
  title: string;
  subtitle: string;
  button: string | null;
  action: NotificationAction;
  durationMs?: number;
  interrupt?: boolean;
}

function make(kind: NotificationKind, fields: Fields): IslandNotification {
  return {
    id: nextId(kind),
    kind,
    visual: fields.visual,
    tone: fields.tone,
    title: fields.title,
    subtitle: fields.subtitle,
    button: fields.button,
    action: fields.action,
    durationMs: fields.durationMs ?? DEFAULT_NOTIFICATION_MS,
    interrupt: fields.interrupt ?? false,
  };
}

const icon = (name: IslandIconName): NotificationVisual => ({
  type: "icon",
  icon: name,
});
const avatar = (initials: string): NotificationVisual => ({
  type: "avatar",
  initials,
});
const claude: NotificationVisual = { type: "claude" };
const dismiss: NotificationAction = { type: "dismiss" };
const showSessions: NotificationAction = { type: "showSessions" };

function plural(count: number, one: string, many: string): string {
  return `${count} ${count > 1 ? many : one}`;
}

/** Montant en euros à la française : « 4 200 € », « 12,50 € ». */
export function formatEuros(amount: number): string {
  const digits = Number.isInteger(amount) ? 0 : 2;
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount);
}

/** Clic sur une notification Claude : la fenêtre de la session si on la connaît, sinon la liste. */
function openSessionOr(p: ClaudeNotificationParams): NotificationAction {
  return p.sessionId
    ? { type: "openSession", sessionId: p.sessionId }
    : showSessions;
}

function projectDetail({
  projectName,
  detail,
}: ClaudeNotificationParams): string {
  return detail ? `${projectName} : ${detail}` : projectName;
}

/** Un constructeur par sorte. */
export const notificationCatalog: {
  [K in NotificationKind]: (
    params: NotificationParams[K],
  ) => IslandNotification;
} = {
  tickets: (p) =>
    make("tickets", {
      visual: icon("tickets"),
      tone: "neutral",
      // Sans ticket proposé, la route mène à la fiche de l'entrée (transcription) plutôt qu'à la validation.
      title:
        p.count > 0
          ? `${plural(p.count, "ticket", "tickets")} à valider`
          : "Aucun ticket proposé",
      subtitle: `${p.inputTitle}, ${p.projectName}`,
      button: p.count > 0 ? "Valider" : "Ouvrir",
      action: { type: "openMain", route: p.route },
      durationMs: LONG_NOTIFICATION_MS,
    }),
  analysisError: (p) =>
    make("analysisError", {
      visual: icon("alert"),
      tone: "danger",
      title: "L'analyse a échoué",
      subtitle: p.message,
      button: "Réessayer",
      action: { type: "retryAnalysis", inputId: p.inputId },
    }),
  uploadError: (p) =>
    make("uploadError", {
      visual: icon("upload"),
      tone: "danger",
      title: p.title ?? "L'envoi de l'audio a échoué",
      subtitle: p.message || "L'enregistrement est gardé sur cet ordinateur",
      button: "Réessayer",
      action: { type: "retryUpload" },
    }),
  pendingUpload: (p) =>
    make("pendingUpload", {
      visual: icon("upload"),
      tone: "alert",
      title: "Un appel n'a pas été envoyé",
      subtitle: p.detail || "L'enregistrement est gardé sur cet ordinateur",
      button: "Réessayer",
      action: { type: "retryUpload" },
    }),
  spotifyReconnect: () => createSpotifyReconnectNotification(),
  vercelReconnect: () => createVercelReconnectNotification(),
  loginRequired: (p) =>
    make("loginRequired", {
      visual: icon("sun"),
      tone: "neutral",
      title: "Connecte-toi dans Sordulo OS",
      subtitle: p.appName
        ? `Pour transcrire l'appel ${p.appName}`
        : "Pour transcrire tes appels",
      button: "Ouvrir",
      action: { type: "openMain", route: p.route ?? "/login" },
    }),
  callEnded: (p) =>
    make("callEnded", {
      visual: icon("clock"),
      tone: "call",
      title: "L'appel semble terminé",
      subtitle:
        [p.appName, p.projectName].filter(Boolean).join(", ") ||
        "Le micro n'est plus utilisé",
      button: "Arrêter",
      action: { type: "stopRecording" },
      durationMs: 10_000,
      // Sinon, en mode concentration, elle attendrait… la fin de l'appel.
      interrupt: true,
    }),
  recording: (p) =>
    make("recording", {
      visual: icon("clock"),
      tone: "call",
      title: "Enregistrement en cours",
      subtitle:
        [p.appName, p.projectName].filter(Boolean).join(", ") ||
        "L'appel est en cours d'enregistrement",
      button: "Arrêter",
      action: { type: "stopRecording" },
      interrupt: true,
    }),
  recordError: (p) =>
    make("recordError", {
      visual: icon("alert"),
      tone: "danger",
      title:
        p.phase === "start"
          ? "L'enregistrement n'a pas démarré"
          : "L'enregistrement ne s'est pas arrêté",
      subtitle: p.message,
      button: null,
      action: dismiss,
    }),
  assign: (p) =>
    make("assign", {
      visual: avatar(p.assignerInitials),
      tone: "neutral",
      title: `${p.assignerName} t'a assigné une tâche`,
      subtitle: p.taskTitle,
      button: "Ouvrir",
      action: { type: "openMain", route: p.route },
    }),
  claudeDone: (p) =>
    make("claudeDone", {
      visual: claude,
      tone: "claude",
      title: "Claude a terminé",
      subtitle: projectDetail(p),
      // Pas de bouton : un clic sur la notification ouvre la fenêtre VS Code de la session.
      button: null,
      action: openSessionOr(p),
    }),
  claudeStop: (p) =>
    make("claudeStop", {
      visual: claude,
      tone: "claude",
      title: "Claude attend tes consignes",
      subtitle: projectDetail(p),
      // Pas de bouton : un clic sur la notification ouvre la fenêtre VS Code de la session.
      button: null,
      action: openSessionOr(p),
    }),
  multiDone: (p) =>
    make("multiDone", {
      visual: claude,
      tone: "claude",
      title: "Une session a terminé",
      subtitle: projectDetail(p),
      // Pas de bouton : un clic sur la notification ouvre la fenêtre VS Code de la session.
      button: null,
      action: openSessionOr(p),
    }),
  conflict: (p) =>
    make("conflict", {
      visual: icon("alert"),
      tone: "alert",
      title: "Conflit entre deux sessions",
      subtitle: projectDetail(p),
      button: "Voir",
      action: showSessions,
      durationMs: CONFLICT_NOTIFICATION_MS,
    }),
  pathCopied: (p) =>
    make("pathCopied", {
      visual: claude,
      tone: "claude",
      title: "Chemin copié",
      subtitle: `${p.fileName} : colle-le dans Claude Code`,
      button: null,
      action: dismiss,
    }),
  digest: (p) =>
    make("digest", {
      visual: icon("bell"),
      tone: "neutral",
      title: p.title,
      subtitle: p.subtitle,
      button: "Voir",
      action: p.action ?? dismiss,
      durationMs: DIGEST_NOTIFICATION_MS,
    }),
  devis: (p) =>
    make("devis", {
      visual: icon("check"),
      tone: "success",
      title: `${p.clientName} a signé le devis`,
      subtitle: `${p.projectName}, ${formatEuros(p.amountEur)}`,
      button: "Voir",
      action: { type: "openMain", route: p.route },
    }),
  paiement: (p) =>
    make("paiement", {
      visual: icon("euro"),
      tone: "success",
      title: `Paiement reçu : ${formatEuros(p.amountEur)}`,
      subtitle: `${p.clientName} a réglé la facture ${p.invoiceTitle}`,
      button: "Voir",
      action: { type: "openMain", route: p.route },
    }),
  echeance: (p) =>
    make("echeance", {
      visual: icon("clock"),
      tone: "alert",
      title: `Deadline ${p.projectName} ${p.when}`,
      subtitle: `${plural(p.remainingTasks, "tâche", "tâches")} encore à faire`,
      button: "Voir",
      action: { type: "openMain", route: p.route },
    }),
  rappel: (p) =>
    make("rappel", {
      visual: icon("cal"),
      tone: "info",
      title: `${p.meetingTitle} dans ${p.minutes} min`,
      subtitle: p.projectName ? `${p.appName}, ${p.projectName}` : p.appName,
      button: "Rejoindre",
      action: { type: "openUrl", url: p.url },
      durationMs: LONG_NOTIFICATION_MS,
      interrupt: true,
    }),
  deployed: (p) =>
    make("deployed", {
      visual: icon("check"),
      tone: "success",
      title: `${p.projectName} est en ligne`,
      subtitle: p.commitMessage || "Déploiement Vercel réussi",
      button: "Ouvrir",
      action: { type: "openUrl", url: p.url },
    }),
  deployFailed: (p) =>
    make("deployFailed", {
      visual: icon("alert"),
      tone: "danger",
      title: `${p.projectName} : échec`,
      subtitle:
        p.commitMessage ||
        (p.branch ? `Branche ${p.branch}` : "Déploiement Vercel de production"),
      button: "Voir les logs",
      action: { type: "openUrl", url: p.logsUrl },
    }),
  relecture: (p) =>
    make("relecture", {
      visual: avatar(p.authorInitials),
      tone: "neutral",
      title: "Une tâche attend ta relecture",
      subtitle: p.taskTitle,
      button: "Relire",
      action: { type: "openMain", route: p.route },
    }),
  fileAdded: (p) =>
    make("fileAdded", {
      visual: icon("check"),
      tone: "success",
      title: `Ajouté à ${p.projectName}`,
      subtitle: p.fileName,
      button: "Voir",
      action: { type: "openMain", route: p.route },
    }),
  conflictOk: (p) =>
    make("conflictOk", {
      visual: icon("check"),
      tone: "success",
      title: "Conflit résolu",
      subtitle: projectDetail(p),
      button: "Voir",
      action: showSessions,
    }),
};

/** Route de la page Connecteurs (cartes Spotify et Vercel) de la fenêtre principale. */
export const CONNECTORS_ROUTE = "/connectors";

/**
 * « Reconnecte Spotify » : l'accès au compte est perdu, la musique des autres appareils n'apparaît plus.
 * Le bouton ouvre la page Connecteurs.
 */
export function createSpotifyReconnectNotification(): IslandNotification {
  return make("spotifyReconnect", {
    visual: icon("alert"),
    tone: "alert",
    title: "Reconnecte Spotify",
    subtitle: "L'accès au compte a expiré",
    button: "Ouvrir",
    action: { type: "openMain", route: CONNECTORS_ROUTE },
    durationMs: LONG_NOTIFICATION_MS,
  });
}

/**
 * « Reconnecte Vercel » : Vercel refuse le jeton du compte, les déploiements n'apparaissent plus.
 * Le bouton ouvre la page Connecteurs.
 */
export function createVercelReconnectNotification(): IslandNotification {
  return make("vercelReconnect", {
    visual: icon("alert"),
    tone: "alert",
    title: "Reconnecte Vercel",
    subtitle: "Le jeton a expiré ou a été révoqué",
    button: "Ouvrir",
    action: { type: "openMain", route: CONNECTORS_ROUTE },
    durationMs: LONG_NOTIFICATION_MS,
  });
}

/** Construit une notification prête à passer à `coordinator.notify`. */
export function createNotification<K extends NotificationKind>(
  kind: K,
  params: NotificationParams[K],
): IslandNotification {
  const build: (params: NotificationParams[K]) => IslandNotification =
    notificationCatalog[kind];
  return build(params);
}
