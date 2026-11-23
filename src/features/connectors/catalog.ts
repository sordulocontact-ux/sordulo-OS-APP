// Logos exportés du Figma « SORDULO-OS » (écran « Connector », node 11:1106), réduits à 112 px.
import claudeLogo from '../../assets/connectors/claude.png'
import gmailLogo from '../../assets/connectors/gmail.png'
import notionLogo from '../../assets/connectors/notion.png'
import stripeLogo from '../../assets/connectors/stripe.png'
// Symbole officiel de Vercel (triangle, proportions de vercel.com/geist/brands), hors Figma.
import vercelLogo from '../../assets/connectors/vercel.svg'

export type ConnectorCategory = 'Communication' | 'Agenda' | 'Documents' | 'Design' | 'Paiement' | 'Comptabilité' | 'IA' | 'Infrastructure' | 'Musique'

/** `live` : l'état vient de l'app de bureau (voir spotify.ts), pas du catalogue. */
export type ConnectorStatus = 'connected' | 'soon' | 'live'

export interface Connector {
  id: string
  name: string
  category: ConnectorCategory
  /** Une ou deux lignes : ce que le connecteur fait DANS Sordulo OS. */
  description: string
  status: ConnectorStatus
  /** Phrase d'état, pour les connecteurs `connected` seulement. */
  state?: string
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
    description: 'Analyse les entrées et rédige les tickets.',
    status: 'connected',
    state: 'Actif : chaque entrée est analysée par Claude.',
  },
  {
    id: 'deepgram',
    name: 'Deepgram',
    category: 'IA',
    description: 'Transcrit les réunions avec séparation des voix.',
    status: 'connected',
    state: 'Actif : les audios sont transcrits à l’envoi.',
  },
  {
    id: 'mistral',
    name: 'Mistral',
    category: 'IA',
    description: 'Prend le relais de Claude si l’analyse échoue.',
    status: 'connected',
    state: 'Actif : sert de secours à l’analyse.',
  },
  {
    id: 'supabase',
    name: 'Supabase',
    category: 'Infrastructure',
    description: 'Base de données, connexion et stockage des audios.',
    status: 'connected',
    state: 'Actif : toutes les données de l’app y sont stockées.',
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
    name: 'Spotify',
    category: 'Musique',
    description: 'L’île de l’app de bureau affiche la musique Spotify jouée sur n’importe quel appareil du compte, avec la pochette.',
    details:
      'L’île de l’app de bureau affiche la musique Spotify jouée sur n’importe quel appareil du compte (téléphone, enceinte…), avec la pochette, la progression et le nom de l’appareil. Avec Spotify Premium, les commandes de l’île pilotent aussi la lecture ; les podcasts sont affichés. La connexion est propre à cet ordinateur.',
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
    name: 'Google Agenda',
    category: 'Agenda',
    description: 'Proposer la transcription des réunions client prévues.',
    status: 'soon',
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    category: 'Documents',
    description: 'Importer un document de Drive comme entrée d’un projet.',
    status: 'soon',
  },
  {
    id: 'slack',
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
    name: 'Qonto',
    category: 'Comptabilité',
    description: 'Rapprocher les virements reçus des factures.',
    status: 'soon',
  },
  {
    id: 'pennylane',
    name: 'Pennylane',
    category: 'Comptabilité',
    description: 'Envoyer les factures émises à la comptabilité.',
    status: 'soon',
  },
  {
    id: 'meet-zoom',
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
  const isConnected = (c: Connector) => (c.status === 'live' ? liveConnected.has(c.id) : c.status === 'connected')
  return list.filter((c) => (!onlyConnected || isConnected(c)) && matchesConnector(c, query))
}
