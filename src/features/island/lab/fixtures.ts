/**
 * Données simulées du labo : projets, sessions Claude Code, demandes d'autorisation, une notification d'exemple
 * par sorte du catalogue. Textes repris du prototype (design/prototypes/ile-sordulo-os.html).
 */
import { createNotification } from "../catalog";
import type { IslandDropInfo, IslandProjectOption } from "../view";
import type {
  ClaudeSession,
  IslandNotification,
  MusicPalette,
  NotificationKind,
  PermissionAsk,
} from "../types";

export const LAB_PROJECTS: readonly IslandProjectOption[] = [
  { id: "p-pds", name: "PDS OS" },
  { id: "p-airbnb", name: "Airbnb des studios" },
  { id: "p-site", name: "Site Sordulo" },
];

export const LAB_CALL_APP = "Google Meet";
/** Lecteur distant simulé (Spotify sur le téléphone, sans Premium). */
export const LAB_REMOTE_APP = "Spotify sur iPhone de Maël";

const SESSION_BASE: ReadonlyArray<
  Pick<ClaudeSession, "projectName" | "task" | "step" | "activity">
> = [
  {
    projectName: "PDS OS",
    task: "Écran de validation",
    step: "Modifie src/features/desktop/Island.tsx",
    activity: "write",
  },
  {
    projectName: "PDS OS",
    task: "Kanban glisser-déposer",
    step: "Lit CLAUDE.md",
    activity: "read",
  },
  {
    projectName: "Airbnb des studios",
    task: "Page d’accueil",
    step: "Cherche les tokens dans src/styles/tokens.css",
    activity: "search",
  },
  {
    projectName: "Site Sordulo",
    task: "Formulaire de contact",
    step: "Réfléchit",
    activity: "think",
  },
  {
    projectName: "Sordulo OS",
    task: "Hooks Claude Code",
    step: "Lance npm run typecheck",
    activity: "command",
  },
];

export const MAX_LAB_SESSIONS = SESSION_BASE.length;

/** `count` sessions simulées (1 à 5). `waiting` : la troisième (ou la dernière) attend une autorisation. */
export function makeSessions(
  count: number,
  now: number,
  waiting = false,
): ClaudeSession[] {
  const list = SESSION_BASE.slice(
    0,
    Math.max(1, Math.min(MAX_LAB_SESSIONS, count)),
  ).map((base, i): ClaudeSession => ({
    id: `lab-session-${i + 1}`,
    projectName: base.projectName,
    projectId: null,
    cwd: `C:/Projets/${base.projectName}`,
    branch: "main",
    task: base.task,
    step: base.step,
    activity: base.activity ?? null,
    status: "working",
    startedAt: now - (i * 97 + 40) * 1000,
    conflict: false,
    error: false,
    subagents: 0,
  }));
  if (waiting && list.length > 1) {
    const target = list[Math.min(2, list.length - 1)];
    if (target) target.status = "waiting";
  }
  return list;
}

let askSequence = 0;

/** Une demande sur deux est une question à choix de Claude (AskUserQuestion), pour voir les deux rendus. */
export function makeAsk(sessionId: string, now: number): PermissionAsk {
  askSequence += 1;
  const question = askSequence % 2 === 0;
  return {
    id: `lab-ask-${askSequence}`,
    sessionId,
    toolName: question ? "AskUserQuestion" : "Bash",
    summary: question ? "" : "npm run build",
    title: question
      ? "Question de Claude dans PDS OS"
      : "Lancer une commande dans PDS OS",
    receivedAt: now,
    expiresAt: now + 60_000,
    questions: question
      ? [
          {
            question: "Comment gérer les tickets déjà importés ?",
            header: "Import",
            multiSelect: false,
            options: [
              {
                label: "Les ignorer",
                description: "On ne touche pas aux pages existantes",
              },
              {
                label: "Les mettre à jour",
                description: "Réécrire le contenu depuis le Drive",
              },
              { label: "Demander à chaque fois", description: null },
            ],
          },
          {
            question: "Quelles parties de l’app sont concernées ?",
            header: "Parties",
            multiSelect: true,
            options: [
              { label: "Accueil", description: null },
              { label: "Projets", description: null },
              { label: "Tickets", description: null },
            ],
          },
        ]
      : null,
  };
}

export const NOTIFICATION_LABELS: Record<NotificationKind, string> = {
  tickets: "Tickets à valider",
  analysisError: "Erreur d’analyse",
  uploadError: "Erreur d’envoi",
  pendingUpload: "Envoi en attente",
  loginRequired: "Connexion requise",
  spotifyReconnect: "Reconnecte Spotify",
  vercelReconnect: "Reconnecte Vercel",
  callEnded: "Appel terminé ?",
  recording: "Enregistrement en cours",
  recordError: "Erreur d'enregistrement",
  assign: "Tâche assignée",
  claudeDone: "Claude a terminé",
  claudeStop: "Claude attend tes consignes",
  multiDone: "Une session a terminé",
  conflict: "Conflit entre sessions",
  pathCopied: "Chemin copié",
  digest: "Regroupement",
  devis: "Devis signé",
  paiement: "Paiement reçu",
  echeance: "Échéance",
  rappel: "Rappel de call (interruption)",
  deployed: "Déploiement en ligne",
  deployFailed: "Déploiement en échec",
  relecture: "À relire",
  fileAdded: "Fichier ajouté",
  conflictOk: "Conflit résolu",
};

export const NOTIFICATION_KINDS = Object.keys(
  NOTIFICATION_LABELS,
) as NotificationKind[];

const CLAUDE = { projectName: "PDS OS", detail: "4 fichiers modifiés" };

/** Une notification d'exemple par sorte du catalogue. */
export function sampleNotification(kind: NotificationKind): IslandNotification {
  switch (kind) {
    case "tickets":
      return createNotification("tickets", {
        count: 6,
        inputTitle: "Call Ibé",
        projectName: "PDS OS",
        route: "/review",
      });
    case "analysisError":
      return createNotification("analysisError", {
        message: "Le modèle n’a pas répondu",
        inputId: "input-1",
      });
    case "uploadError":
      return createNotification("uploadError", { message: "Connexion perdue" });
    case "pendingUpload":
      return createNotification("pendingUpload", {
        detail: "Call Ibé, 42 min",
      });
    case "loginRequired":
      return createNotification("loginRequired", { appName: LAB_CALL_APP });
    case "spotifyReconnect":
      return createNotification("spotifyReconnect", {});
    case "vercelReconnect":
      return createNotification("vercelReconnect", {});
    case "callEnded":
      return createNotification("callEnded", {
        appName: LAB_CALL_APP,
        projectName: "PDS OS",
      });
    case "recording":
      return createNotification("recording", {
        appName: LAB_CALL_APP,
        projectName: "PDS OS",
      });
    case "recordError":
      return createNotification("recordError", {
        phase: "start",
        message: "Aucun micro détecté",
      });
    case "assign":
      return createNotification("assign", {
        assignerName: "Maël",
        assignerInitials: "MA",
        taskTitle: "Refaire l’écran de validation",
        route: "/tasks",
      });
    case "claudeDone":
      return createNotification("claudeDone", CLAUDE);
    case "claudeStop":
      return createNotification("claudeStop", {
        projectName: "PDS OS",
        detail: "Commande refusée : npm run build",
      });
    case "multiDone":
      return createNotification("multiDone", {
        projectName: "Sordulo OS",
        detail: "Hooks Claude Code",
      });
    case "conflict":
      return createNotification("conflict", {
        projectName: "PDS OS",
        detail: "Island.tsx modifié par les sessions 1 et 2",
      });
    case "pathCopied":
      return createNotification("pathCopied", {
        fileName: "cahier-des-charges.pdf",
      });
    case "digest":
      return createNotification("digest", {
        title: "3 nouveautés",
        subtitle: "Paiement reçu, Tâche assignée et 1 autre",
      });
    case "devis":
      return createNotification("devis", {
        clientName: "Ibé",
        projectName: "Airbnb des studios",
        amountEur: 4200,
        route: "/p",
      });
    case "paiement":
      return createNotification("paiement", {
        clientName: "Ibé",
        invoiceTitle: "Airbnb des studios",
        amountEur: 1200,
        route: "/p",
      });
    case "echeance":
      return createNotification("echeance", {
        projectName: "PDS OS",
        when: "demain",
        remainingTasks: 3,
        route: "/p",
      });
    case "rappel":
      return createNotification("rappel", {
        meetingTitle: "Call Ibé",
        minutes: 5,
        appName: "Google Meet",
        projectName: "PDS OS",
        url: "https://meet.example/ibe",
      });
    case "deployed":
      return createNotification("deployed", {
        projectName: "PDS OS",
        url: "https://pds.example",
        commitMessage: "Ajoute la page Connecteurs",
      });
    case "deployFailed":
      return createNotification("deployFailed", {
        projectName: "PDS OS",
        logsUrl: "https://vercel.com/sordulo/pds-os",
        commitMessage: "Ajoute la page Connecteurs",
        branch: "main",
      });
    case "relecture":
      return createNotification("relecture", {
        authorInitials: "MA",
        taskTitle: "Partage du ticket depuis l’iPhone",
        route: "/t",
      });
    case "fileAdded":
      return createNotification("fileAdded", {
        projectName: "PDS OS",
        fileName: "maquette.fig",
        route: "/p",
      });
    case "conflictOk":
      return createNotification("conflictOk", {
        projectName: "PDS OS",
        detail: "La session 2 attend que la 1 ait fini",
      });
  }
}

export type DropFile = "audio" | "document";

export interface DropOptions {
  /** Zone « Fichiers » (masquée dans l'app tant que les fichiers de projet n'existent pas). */
  files: boolean;
  /** Zone « Claude Code » (seulement si une session est active). */
  claude: boolean;
}

export function makeDrop(file: DropFile, options: DropOptions): IslandDropInfo {
  return {
    fileName: file === "audio" ? "Appel Ibé.m4a" : "Cahier des charges.pdf",
    projectName: "PDS OS",
    zones: {
      transcribe: file === "audio",
      analyse: file === "document",
      files: options.files,
      claude: options.claude,
    },
  };
}

// --- Musique simulée ----------------------------------------------------------------------------------------

export interface LabTrack {
  title: string;
  artist: string;
  album: string;
  appName: string;
  durationMs: number;
  /** Couleurs de la pochette, comme celles que la source extrait d'une vraie pochette. */
  palette: MusicPalette;
  /** Motif de la pochette générée. */
  motif: "sun" | "waves" | "rings";
}

export const LAB_TRACKS: readonly LabTrack[] = [
  {
    title: "Lumière du soir sur la ville endormie",
    artist: "Les Ondes Claires",
    album: "Horizons",
    appName: "Spotify",
    durationMs: 204_000,
    palette: { start: "rgb(255, 122, 61)", end: "rgb(214, 46, 120)" },
    motif: "sun",
  },
  {
    // Plusieurs artistes : la ligne dépasse et défile dans la vue ouverte (après 5 s, comme sur iPhone).
    title: "Nuits blanches (version longue enregistrée en public à Lyon)",
    artist: "Lou, Ibé, Les Ondes Claires, Noé Lune feat. Atelier Vert",
    album: "Live",
    appName: "Spotify sur iPhone de Maël",
    durationMs: 251_000,
    palette: { start: "rgb(250, 200, 70)", end: "rgb(230, 90, 60)" },
    motif: "sun",
  },
  {
    title: "Marée basse",
    artist: "Noé Lune",
    album: "Littoral",
    appName: "Musique",
    durationMs: 167_000,
    palette: { start: "rgb(64, 200, 224)", end: "rgb(72, 92, 230)" },
    motif: "waves",
  },
  {
    title: "Jardin",
    artist: "Atelier Vert",
    album: "Saisons",
    appName: "Google Chrome",
    durationMs: 238_000,
    palette: { start: "rgb(170, 230, 90)", end: "rgb(30, 150, 110)" },
    motif: "rings",
  },
];

/** Pochette générée (SVG en data URL) : dégradé de la palette et un motif clair. */
export function labArtwork(track: LabTrack): string {
  const { start, end } = track.palette;
  const motif = {
    sun: '<circle cx="100" cy="112" r="46" fill="white" fill-opacity="0.85"/><rect y="132" width="200" height="68" fill="black" fill-opacity="0.25"/>',
    waves:
      '<path d="M0 120q25-18 50 0t50 0 50 0 50 0v80H0z" fill="white" fill-opacity="0.35"/><path d="M0 145q25-18 50 0t50 0 50 0 50 0v55H0z" fill="white" fill-opacity="0.55"/>',
    rings:
      '<circle cx="100" cy="100" r="62" fill="none" stroke="white" stroke-opacity="0.45" stroke-width="14"/><circle cx="100" cy="100" r="26" fill="white" fill-opacity="0.8"/>',
  }[track.motif];
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">' +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${start}"/><stop offset="1" stop-color="${end}"/></linearGradient></defs>` +
    `<rect width="200" height="200" fill="url(#g)"/>${motif}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
