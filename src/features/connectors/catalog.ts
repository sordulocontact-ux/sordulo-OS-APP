// Logos exportés du Figma « SORDULO-OS » (écran « Connector », node 11:1106), réduits à 112 px.
import claudeLogo from '../../assets/connectors/claude.png'
import gmailLogo from '../../assets/connectors/gmail.png'
import notionLogo from '../../assets/connectors/notion.png'
import stripeLogo from '../../assets/connectors/stripe.png'
// Symbole officiel de Vercel (triangle, proportions de vercel.com/geist/brands), hors Figma.
import vercelLogo from '../../assets/connectors/vercel.svg'
// Logos officiels hors Figma (23/11/2026) : svgl.app (Supabase, Spotify, Google Agenda, Drive, Slack, Figma,
// Google Meet) et icônes des sites de Pennylane et Qonto (réduite à 112 px).
import supabaseLogo from '../../assets/connectors/supabase.svg'
import spotifyLogo from '../../assets/connectors/spotify.svg'
import googleAgendaLogo from '../../assets/connectors/google-agenda.svg'
import googleDriveLogo from '../../assets/connectors/google-drive.svg'
import slackLogo from '../../assets/connectors/slack.svg'
import figmaLogo from '../../assets/connectors/figma.svg'
import qontoLogo from '../../assets/connectors/qonto.png'
import pennylaneLogo from '../../assets/connectors/pennylane.svg'
import meetZoomLogo from '../../assets/connectors/google-meet.svg'
// Marque GitHub (Invertocat, tracé de simple-icons), 25/11/2026.
import githubLogo from '../../assets/connectors/github.svg'

export type ConnectorCategory = 'Communication' | 'Agenda' | 'Documents' | 'Design' | 'Paiement' | 'Comptabilité' | 'IA' | 'Infrastructure' | 'Musique'

/**
 * `live` : l'état vient du compte ou de l'ordinateur de l'utilisateur (voir spotify.ts, claudeCode.ts), pas du catalogue.
 * Un connecteur est toujours un compte de l'utilisateur : aucun n'est « connecté » d'office.
 */
export type ConnectorStatus = 'soon' | 'live'

export interface Connector {
  id: string
  name: string
  category: ConnectorCategory
  /** Une ou deux lignes : ce que le connecteur fait DANS Sordulo OS. */
  description: string
  status: ConnectorStatus
  /** Détail affiché dans la fenêtre « Détails ». */
  details?: string
  /** URL d'un SVG de `src/assets/` : remplace l'initiale quand il est présent. */
  logo?: string
}

export const CONNECTORS: Connector[] = [
  {
    id: 'claude',
    logo: claudeLogo,
    name: 'Claude',
    category: 'IA',
    description: 'Claude Code de cet ordinateur dans l’île (sessions, demandes d’autorisation).',
    details:
      'Le relais Claude Code de cet ordinateur : les sessions Claude Code en cours et leurs demandes d’autorisation apparaissent dans l’île de l’app de bureau, où l’on peut les accepter ou les refuser. C’est le compte Claude Code de l’ordinateur, pas une clé API : la connexion est propre à cet ordinateur. Pour que Claude lise vos projets, tâches et devis, voir la carte « Serveur MCP Sordulo OS ».',
    status: 'live',
  },
  {
    id: 'mcp',
    name: 'Serveur MCP Sordulo OS',
    category: 'IA',
    description: 'Claude Code lit vos projets, tâches et devis, et crée ou modifie des tâches, avec vos droits.',
    details:
      'Le serveur MCP de Sordulo OS donne à Claude Code (ou à tout client MCP) l’accès à vos données, dans les deux sens : rechercher, lister les projets, voir un projet avec ses tickets et ses tâches, vos tâches, créer et modifier une tâche, les chiffres du mois (admin et finance), les prospects. Claude a exactement vos droits. L’accès passe par un jeton personnel, lié à votre compte Sordulo OS : il n’est montré qu’une fois et se révoque à tout moment.',
    status: 'live',
  },
  {
    id: 'supabase',
    logo: supabaseLogo,
    name: 'Supabase',
    category: 'Infrastructure',
    description: 'Brancher votre propre projet Supabase, avec votre compte, pour que l’IA puisse lui poser des questions.',
    status: 'soon',
  },
  {
    id: 'vercel',
    logo: vercelLogo,
    name: 'Vercel',
    category: 'Infrastructure',
    description: 'L’île de l’app de bureau montre les déploiements de production Vercel : chargement, en ligne, échec.',
    details:
      'L’île de l’app de bureau montre les déploiements de production Vercel : la construction en cours, puis « en ligne » ou l’échec avec un accès aux logs. La connexion est liée à votre compte Sordulo OS, pas à cet ordinateur : elle suit le compte sur tous vos appareils. Seuls les déploiements de production visibles par le jeton sont suivis (comptes personnel et équipes du jeton, tous projets).',
    status: 'live',
  },
  {
    id: 'spotify',
    logo: spotifyLogo,
    name: 'Spotify',
    category: 'Musique',
    description: 'L’île de l’app de bureau affiche la musique Spotify jouée sur n’importe quel appareil du compte, avec la pochette.',
    details:
      'L’île de l’app de bureau affiche la musique Spotify jouée sur n’importe quel appareil du compte (téléphone, enceinte…), avec la pochette, la progression et le nom de l’appareil. Avec Spotify Premium, les commandes de l’île pilotent aussi la lecture ; les podcasts sont affichés. La connexion est liée à votre compte Sordulo OS, pas à cet ordinateur : elle suit le compte sur tous vos appareils. Chacun utilise sa propre app Spotify (Client ID collé dans la carte).',
    status: 'live',
  },
  {
    id: 'gmail',
    logo: gmailLogo,
    name: 'Gmail',
    category: 'Communication',
    description: 'Transformer un email client en entrée, sans copier-coller.',
    details:
      'L’île de l’app de bureau repère les retours clients reçus par mail et propose d’en faire une entrée du projet, sans copier-coller. Accès en lecture seule : Sordulo OS ne peut ni écrire, ni envoyer, ni supprimer de mail. Le contenu d’un mail n’est envoyé à l’analyse qu’après avoir cliqué sur « Analyser ». La connexion est liée à votre compte Sordulo OS et se fait depuis l’app de bureau.',
    status: 'live',
  },
  {
    id: 'google-agenda',
    logo: googleAgendaLogo,
    name: 'Google Agenda',
    category: 'Agenda',
    description: 'Proposer la transcription des réunions client prévues.',
    details:
      'L’île de l’app de bureau lit votre agenda pour présélectionner le projet d’une réunion client au moment de transcrire l’appel, et pour rappeler les réunions à venir. Accès en lecture seule : Sordulo OS ne peut ni créer ni modifier d’événement. La connexion est liée à votre compte Sordulo OS et se fait depuis l’app de bureau.',
    status: 'live',
  },
  {
    id: 'google-drive',
    logo: googleDriveLogo,
    name: 'Google Drive',
    category: 'Documents',
    description: 'Importer un document de Drive comme entrée d’un projet.',
    status: 'soon',
  },
  {
    id: 'slack',
    logo: slackLogo,
    name: 'Slack',
    category: 'Communication',
    description: 'Recevoir les tickets validés et les relances dans un canal.',
    status: 'soon',
  },
  {
    id: 'notion',
    logo: notionLogo,
    name: 'Notion',
    category: 'Documents',
    description: 'Exporter les tickets d’un projet vers une page Notion.',
    status: 'soon',
  },
  {
    id: 'figma',
    logo: figmaLogo,
    name: 'Figma',
    category: 'Design',
    description: 'Relier une maquette Figma à un ticket.',
    status: 'soon',
  },
  {
    id: 'stripe',
    logo: stripeLogo,
    name: 'Stripe',
    category: 'Paiement',
    description: 'Encaisser acomptes et factures en ligne, avec le paiement noté tout seul.',
    status: 'soon',
  },
  {
    id: 'yousign',
    name: 'Yousign',
    category: 'Documents',
    description: 'Faire signer les contrats en ligne, avec la signature enregistrée sur le contrat.',
    details:
      'En attendant, un contrat se signe à la main (signature notée dans l’app) ou par le client sur le portail (nom tapé et case cochée).',
    status: 'soon',
  },
  {
    id: 'github',
    logo: githubLogo,
    name: 'GitHub',
    category: 'Infrastructure',
    description: 'Suivre les builds et les mises en ligne des projets clients depuis leur page.',
    status: 'soon',
  },
  {
    id: 'e-invoicing',
    name: 'Facture électronique',
    category: 'Comptabilité',
    description: 'Émettre et recevoir les factures par une plateforme agréée, obligatoire au 1er septembre 2027.',
    details:
      'Depuis le 1er septembre 2026, toute entreprise doit pouvoir recevoir des factures électroniques ; à partir du 1er septembre 2027, les micro-entreprises et les PME devront aussi les émettre par une plateforme agréée. Ce connecteur enverra les factures émises dans Sordulo OS à la plateforme choisie et récupérera les factures reçues.',
    status: 'soon',
  },
  {
    id: 'qonto',
    logo: qontoLogo,
    name: 'Qonto',
    category: 'Comptabilité',
    description: 'Rapprocher les virements reçus des factures.',
    status: 'soon',
  },
  {
    id: 'pennylane',
    logo: pennylaneLogo,
    name: 'Pennylane',
    category: 'Comptabilité',
    description: 'Envoyer les factures émises à la comptabilité.',
    status: 'soon',
  },
  {
    id: 'meet-zoom',
    logo: meetZoomLogo,
    name: 'Google Meet / Zoom',
    category: 'Agenda',
    description:
      'Enregistrer l’appel depuis l’app de bureau : c’est déjà possible aujourd’hui sans connecteur, le lien direct viendra plus tard.',
    status: 'soon',
  },
]

export function connectorInitials(name: string): string {
  const words = name.split(/[\s/]+/).filter(Boolean)
  const [first = '', second] = words
  return (second ? first.charAt(0) + second.charAt(0) : first.slice(0, 2)).toUpperCase()
}

function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

export function matchesConnector(connector: Connector, query: string): boolean {
  const q = normalize(query.trim())
  if (!q) return true
  return normalize(`${connector.name} ${connector.description} ${connector.category}`).includes(q)
}

/** `liveConnected` : ids des connecteurs `live` actuellement connectés. */
export function filterConnectors(
  list: Connector[],
  query: string,
  onlyConnected: boolean,
  liveConnected: ReadonlySet<string> = new Set(),
): Connector[] {
  const isConnected = (c: Connector) => c.status === 'live' && liveConnected.has(c.id)
  return list.filter((c) => (!onlyConnected || isConnected(c)) && matchesConnector(c, query))
}
