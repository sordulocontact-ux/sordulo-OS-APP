import { describe, expect, it } from "vitest";
import {
  createNotification,
  createSpotifyReconnectNotification,
  createVercelReconnectNotification,
  formatEuros,
  notificationCatalog,
  type NotificationParams,
} from "./catalog";
import type { NotificationKind } from "./types";

const claude = { projectName: "PDS OS", detail: "4 fichiers modifiés" };

/** Un exemple de paramètres par sorte : le type oblige à couvrir tout le catalogue. */
const samples: NotificationParams = {
  tickets: {
    count: 6,
    inputTitle: "Call Ibé",
    projectName: "PDS OS",
    route: "/projects/p/inputs/i/review",
  },
  analysisError: { message: "Transcription impossible", inputId: "i-1" },
  uploadError: {},
  pendingUpload: {},
  loginRequired: { appName: "Discord" },
  spotifyReconnect: {},
  vercelReconnect: {},
  callEnded: { appName: "Discord", projectName: "PDS OS" },
  recording: { appName: "Discord", projectName: "PDS OS" },
  recordError: { phase: "start", message: "Aucun micro" },
  assign: {
    assignerName: "Maël",
    assignerInitials: "MA",
    taskTitle: "Refaire l'écran de validation",
    route: "/t",
  },
  claudeDone: claude,
  claudeStop: {
    projectName: "PDS OS",
    detail: "Commande refusée : npm run build",
  },
  multiDone: claude,
  conflict: claude,
  pathCopied: { fileName: "brief.pdf" },
  digest: { title: "3 nouveautés", subtitle: "A, B et 1 autre" },
  devis: {
    clientName: "Ibé",
    projectName: "Airbnb des studios",
    amountEur: 4200,
    route: "/q",
  },
  paiement: {
    clientName: "Ibé",
    invoiceTitle: "Airbnb des studios",
    amountEur: 1200,
    route: "/f",
  },
  echeance: {
    projectName: "PDS OS",
    when: "demain",
    remainingTasks: 3,
    route: "/p",
  },
  rappel: {
    meetingTitle: "Call Ibé",
    minutes: 5,
    appName: "Google Meet",
    projectName: "PDS OS",
    url: "https://meet",
  },
  deployed: { projectName: "PDS OS", url: "https://pds" },
  deployFailed: {
    projectName: "PDS OS",
    logsUrl: "https://vercel.com/pds/dpl",
    commitMessage: "Corrige l'écran de validation",
    branch: "main",
  },
  relecture: {
    authorInitials: "MA",
    taskTitle: "Partage du ticket depuis l'iPhone",
    route: "/t",
  },
  fileAdded: { projectName: "PDS OS", fileName: "brief.pdf", route: "/p" },
  conflictOk: {
    projectName: "PDS OS",
    detail: "La session 2 attend que la 1 ait fini",
  },
};

const kinds = Object.keys(notificationCatalog) as NotificationKind[];

function build(kind: NotificationKind) {
  return createNotification(kind, samples[kind] as never);
}

describe("catalogue des notifications", () => {
  it("construit chaque sorte avec sa sorte, un titre et un ton", () => {
    expect(kinds).toHaveLength(26);
    for (const kind of kinds) {
      const notification = build(kind);
      expect(notification.kind).toBe(kind);
      expect(notification.title).not.toBe("");
      expect(notification.tone).toBeTruthy();
    }
  });

  it("donne un id unique à chaque notification émise", () => {
    const ids = new Set([...kinds, ...kinds].map((kind) => build(kind).id));
    expect(ids.size).toBe(kinds.length * 2);
  });

  it("applique les durées : 4,5 s par défaut, 7 s tickets et rappel, 5 s conflit, 6 s regroupement", () => {
    const special: Partial<Record<NotificationKind, number>> = {
      callEnded: 10_000,
      tickets: 7000,
      rappel: 7000,
      conflict: 5000,
      digest: 6000,
      spotifyReconnect: 7000,
      vercelReconnect: 7000,
    };
    for (const kind of kinds)
      expect(build(kind).durationMs, kind).toBe(special[kind] ?? 4500);
  });

  it("seuls le rappel et ce qui concerne l’appel en cours interrompent ; le rappel a Rejoindre et le lien", () => {
    const interrupting: NotificationKind[] = [
      "rappel",
      "callEnded",
      "recording",
    ];
    for (const kind of kinds)
      expect(build(kind).interrupt, kind).toBe(interrupting.includes(kind));
    expect(build("rappel")).toMatchObject({
      title: "Call Ibé dans 5 min",
      subtitle: "Google Meet, PDS OS",
      button: "Rejoindre",
      action: { type: "openUrl", url: "https://meet" },
      tone: "info",
    });
  });

  it("reprend les textes du prototype", () => {
    expect(build("tickets")).toMatchObject({
      title: "6 tickets à valider",
      subtitle: "Call Ibé, PDS OS",
      button: "Valider",
      action: { type: "openMain", route: "/projects/p/inputs/i/review" },
    });
    expect(build("assign")).toMatchObject({
      title: "Maël t'a assigné une tâche",
      visual: { type: "avatar", initials: "MA" },
      action: { type: "openMain", route: "/t" },
    });
    expect(build("claudeDone")).toMatchObject({
      subtitle: "PDS OS : 4 fichiers modifiés",
      visual: { type: "claude" },
    });
    expect(build("devis").title).toBe("Ibé a signé le devis");
    expect(build("devis").subtitle).toMatch(/^Airbnb des studios, 4\s200\s€$/u);
    expect(build("paiement").title).toMatch(/^Paiement reçu : 1\s200\s€$/u);
    expect(build("echeance")).toMatchObject({
      title: "Deadline PDS OS demain",
      subtitle: "3 tâches encore à faire",
    });
  });

  it("accorde le singulier", () => {
    expect(
      createNotification("tickets", { ...samples.tickets, count: 1 }).title,
    ).toBe("1 ticket à valider");
    expect(
      createNotification("tickets", {
        ...samples.tickets,
        count: 0,
        route: "/projects/p/inputs/i",
      }),
    ).toMatchObject({
      title: "Aucun ticket proposé",
      button: "Ouvrir",
      action: { type: "openMain", route: "/projects/p/inputs/i" },
    });
    expect(
      createNotification("echeance", { ...samples.echeance, remainingTasks: 1 })
        .subtitle,
    ).toBe("1 tâche encore à faire");
  });

  it("porte les actions des erreurs et du glisser-déposer", () => {
    expect(build("analysisError")).toMatchObject({
      title: "L'analyse a échoué",
      subtitle: "Transcription impossible",
      button: "Réessayer",
      action: { type: "retryAnalysis", inputId: "i-1" },
    });
    expect(build("uploadError")).toMatchObject({
      title: "L'envoi de l'audio a échoué",
      action: { type: "retryUpload" },
    });
    expect(build("pendingUpload")).toMatchObject({
      title: "Un appel n'a pas été envoyé",
      action: { type: "retryUpload" },
    });
    expect(build("loginRequired")).toMatchObject({
      title: "Connecte-toi dans Sordulo OS",
      button: "Ouvrir",
      action: { type: "openMain", route: "/login" },
    });
    expect(build("pathCopied")).toMatchObject({
      title: "Chemin copié",
      button: null,
      action: { type: "dismiss" },
    });
    expect(build("callEnded")).toMatchObject({
      button: "Arrêter",
      action: { type: "stopRecording" },
    });
    expect(build("recording")).toMatchObject({
      title: "Enregistrement en cours",
      subtitle: "Discord, PDS OS",
      button: "Arrêter",
      action: { type: "stopRecording" },
    });
    expect(build("recordError")).toMatchObject({
      title: "L'enregistrement n'a pas démarré",
      subtitle: "Aucun micro",
      button: null,
      action: { type: "dismiss" },
      tone: "danger",
    });
    expect(
      createNotification("recordError", { phase: "stop", message: "x" }).title,
    ).toBe("L'enregistrement ne s'est pas arrêté");
    expect(build("pathCopied").subtitle).toBe(
      "brief.pdf : colle-le dans Claude Code",
    );
  });

  it("formate les euros à la française", () => {
    expect(formatEuros(4200)).toMatch(/^4\s200\s€$/u);
    expect(formatEuros(12.5)).toMatch(/^12,50\s€$/u);
  });
});

describe("notification « Reconnecte Spotify »", () => {
  it("ouvre la page Connecteurs, en français et sans tiret cadratin", () => {
    const n = createSpotifyReconnectNotification();
    expect(n).toMatchObject({
      title: "Reconnecte Spotify",
      button: "Ouvrir",
      action: { type: "openMain", route: "/connectors" },
    });
    expect(`${n.title}${n.subtitle}`).not.toMatch(/—|–/);
  });
});

describe("notifications des déploiements Vercel", () => {
  it("en ligne : message du commit en sous-titre, repli sans commit, bouton Ouvrir", () => {
    expect(
      createNotification("deployed", {
        projectName: "PDS OS",
        url: "https://pds.vercel.app",
        commitMessage: "Ajoute la page Connecteurs",
      }),
    ).toMatchObject({
      title: "PDS OS est en ligne",
      subtitle: "Ajoute la page Connecteurs",
      button: "Ouvrir",
      action: { type: "openUrl", url: "https://pds.vercel.app" },
      tone: "success",
    });
    expect(build("deployed").subtitle).toBe("Déploiement Vercel réussi");
    expect(
      createNotification("deployed", {
        projectName: "PDS OS",
        url: "https://pds",
        commitMessage: null,
      }).subtitle,
    ).toBe("Déploiement Vercel réussi");
  });

  it("échec : ton danger, icône alerte, « Voir les logs », sous-titre commit puis branche", () => {
    expect(build("deployFailed")).toMatchObject({
      title: "PDS OS : échec",
      subtitle: "Corrige l'écran de validation",
      button: "Voir les logs",
      action: { type: "openUrl", url: "https://vercel.com/pds/dpl" },
      tone: "danger",
      visual: { type: "icon", icon: "alert" },
    });
    const noCommit = { ...samples.deployFailed, commitMessage: null };
    expect(createNotification("deployFailed", noCommit).subtitle).toBe(
      "Branche main",
    );
    expect(
      createNotification("deployFailed", { ...noCommit, branch: null })
        .subtitle,
    ).toBe("Déploiement Vercel de production");
  });

  it("« Reconnecte Vercel » ouvre la page Connecteurs, sans tiret cadratin", () => {
    const n = createVercelReconnectNotification();
    expect(n).toMatchObject({
      kind: "vercelReconnect",
      title: "Reconnecte Vercel",
      button: "Ouvrir",
      action: { type: "openMain", route: "/connectors" },
      tone: "alert",
    });
    expect(`${n.title}${n.subtitle}`).not.toMatch(/—|–/);
  });
});
