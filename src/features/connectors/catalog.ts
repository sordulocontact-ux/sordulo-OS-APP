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
      'Le relais Claude Code de cet ordinateur : les sessions Claude Code en cours et leurs demandes d’autorisation apparaissent dans l’île de l’app de bureau, où l’on peut les accepter ou les refuser. C’est le compte Claude Code de l’ordinateur, pas une clé API : la connexion est propre à cet ordinateur. Le branchement MCP viendra plus tard.',
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
    status: 'soon',
  },
  {
    id: 'google-agenda',
    logo: googleAgendaLogo,
    name: 'Google Agenda',
    category: 'Agenda',
    description: 'Proposer la transcription des réunions client prévues.',
    status: 'soon',
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
    description: 'Ajouter un lien de paiement sur les factures.',
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
