export type ConnectorCategory = 'Communication' | 'Agenda' | 'Documents' | 'Design' | 'Paiement' | 'Comptabilité' | 'IA' | 'Infrastructure'

export type ConnectorStatus = 'connected' | 'soon'

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
    id: 'gmail',
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

export function filterConnectors(list: Connector[], query: string, onlyConnected: boolean): Connector[] {
  return list.filter((c) => (!onlyConnected || c.status === 'connected') && matchesConnector(c, query))
}
