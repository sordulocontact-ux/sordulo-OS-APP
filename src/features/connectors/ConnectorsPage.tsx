import { useMemo, useState } from 'react'
import { Badge, Button, EmptyState, Modal, SearchField } from '../../components/ui'
import { CONNECTORS, connectorInitials, filterConnectors, type Connector } from './catalog'
import { useClaudeCode } from './useClaudeCode'
import { useSpotify } from './useSpotify'
import { useVercel } from './useVercel'
import { SpotifyConnectModal } from './SpotifyConnectModal'
import { VercelConnectModal } from './VercelConnectModal'
import type { BadgeTone } from '../../components/ui/Badge'
import styles from './connectors.module.css'

type Filter = 'all' | 'connected'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Tous' },
  { id: 'connected', label: 'Connectés' },
]

function Logo({ connector }: { connector: Connector }) {
  if (connector.logo) return <img src={connector.logo} alt="" className={styles.logo} />
  return (
    <span className={styles.logo} aria-hidden="true">
      {connectorInitials(connector.name)}
    </span>
  )
}

/** Carte à état vivant (Claude Code, Spotify, Vercel) : tout ce que la page affiche, quelle que soit la source. */
interface LiveCard {
  badge: { tone: BadgeTone; label: string }
  state: string
  hint?: string
  notice?: string
  error: string | null
  connected: boolean
  action: { label: string; variant: 'primary' | 'secondary'; loading: boolean; disabled: boolean; title?: string; run?: () => void }
}

function StatusBadge({ connector, live }: { connector: Connector; live: Record<string, LiveCard> }) {
  const card = live[connector.id]
  if (connector.status === 'live' && card) return <Badge tone={card.badge.tone}>{card.badge.label}</Badge>
  return <Badge tone="neutral">Bientôt</Badge>
}

function LiveButton({ card, className }: { card: LiveCard; className?: string }) {
  const { action } = card
  return (
    <Button
      className={className}
      variant={action.variant}
      loading={action.loading}
      disabled={action.disabled}
      title={action.title}
      onClick={action.run}
    >
      {action.label}
    </Button>
  )
}

export function ConnectorsPage() {
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Connector | null>(null)

  const [vercelOpen, setVercelOpen] = useState(false)

  const claudeCode = useClaudeCode()
  const spotify = useSpotify()
  const vercel = useVercel()

  const live: Record<string, LiveCard> = {
    claude: {
      ...claudeCode.view,
      error: claudeCode.error,
      action: {
        label: claudeCode.view.action.label,
        variant: claudeCode.view.action.kind === 'disconnect' ? 'secondary' : 'primary',
        loading: claudeCode.view.action.loading,
        disabled: claudeCode.view.action.disabled,
        title: claudeCode.view.action.title,
        run: claudeCode.view.action.kind ? () => claudeCode.run(claudeCode.view.action.kind!) : undefined,
      },
    },
    spotify: {
      ...spotify.view,
      error: spotify.error,
      action: {
        label: spotify.view.action.label,
        variant: spotify.view.action.kind === 'disconnect' ? 'secondary' : 'primary',
        loading: spotify.view.action.loading,
        disabled: spotify.view.action.disabled,
        title: spotify.view.action.title,
        run: spotify.view.action.kind
          ? () => {
              const kind = spotify.view.action.kind!
              // La fenêtre du Client ID remplace la fenêtre Détails, comme pour Vercel.
              if (kind === 'connect' || kind === 'reconnect') setSelected(null)
              spotify.run(kind)
            }
          : undefined,
      },
    },
    vercel: {
      badge: vercel.view.badge,
      state: vercel.view.state,
      error: vercel.error,
      connected: vercel.view.connected,
      action: {
        label: vercel.view.action.label,
        variant: vercel.view.action.kind === 'connect' ? 'primary' : 'secondary',
        loading: vercel.view.action.loading,
        disabled: vercel.view.action.disabled,
        run: () => {
          const { kind } = vercel.view.action
          if (kind === 'connect') {
            setSelected(null)
            setVercelOpen(true)
          }
          else if (kind === 'disconnect') vercel.disconnect()
          else vercel.retry()
        },
      },
    },
  }
  const liveKey = Object.entries(live)
    .filter(([, card]) => card.connected)
    .map(([id]) => id)
    .join(',')

  const visible = useMemo(
    () => filterConnectors(CONNECTORS, query, filter === 'connected', new Set(liveKey ? liveKey.split(',') : [])),
    [query, filter, liveKey],
  )

  return (
    <section className={styles.page} aria-labelledby="connectors-title">
      <header className={styles.header}>
        <h1 id="connectors-title">Connecteurs</h1>
        <p className={styles.subtitle}>Les services qui travaillent avec Sordulo OS, et ceux qui arrivent.</p>
      </header>

      <div className={styles.toolbar}>
        <div className={styles.segmented} role="group" aria-label="Afficher">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              className={[styles.segment, filter === f.id ? styles.active : ''].filter(Boolean).join(' ')}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <SearchField
          className={styles.search}
          label="Rechercher un connecteur"
          placeholder={`Rechercher parmi ${CONNECTORS.length} connecteurs`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title={query.trim() ? `Aucun connecteur ne correspond à « ${query.trim()} »` : 'Aucun connecteur'}
          text={query.trim() ? 'Essayez un autre nom ou une autre catégorie.' : undefined}
          action={
            query.trim() ? (
              <Button onClick={() => setQuery('')}>Effacer la recherche</Button>
            ) : undefined
          }
        />
      ) : (
        <ul className={styles.grid}>
          {visible.map((c) => (
            <li key={c.id} className={styles.card}>
              <Logo connector={c} />
              <div className={styles.titleRow}>
                <h2 className={styles.name}>{c.name}</h2>
                <StatusBadge connector={c} live={live} />
              </div>
              <p className={styles.description}>{c.description}</p>
              {c.status === 'live' && live[c.id] ? (
                <>
                  {live[c.id]!.connected || c.id === 'vercel' ? (
                    <p className={styles.cardState}>{live[c.id]!.state}</p>
                  ) : live[c.id]!.notice ? (
                    <p className={styles.cardState}>{live[c.id]!.notice}</p>
                  ) : null}
                  {live[c.id]!.error ? (
                    <p className={styles.error} role="alert">
                      {live[c.id]!.error}
                    </p>
                  ) : null}
                </>
              ) : null}
              <div className={styles.actions}>
                <Button className={styles.action} onClick={() => setSelected(c)} aria-label={`Détails de ${c.name}`}>
                  Détails
                </Button>
                {c.status === 'live' && live[c.id] ? (
                  <LiveButton card={live[c.id]!} className={styles.action} />
                ) : (
                  <Button
                    className={styles.action}
                    aria-disabled="true"
                    title="Ce connecteur n’est pas encore disponible."
                    onClick={(e) => e.preventDefault()}
                  >
                    À venir
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal open={selected !== null} onClose={() => setSelected(null)} title={selected?.name ?? ''}>
        {selected ? (
          <div className={styles.detail}>
            <div className={styles.titleRow}>
              <Badge tone="neutral">{selected.category}</Badge>
              <StatusBadge connector={selected} live={live} />
            </div>
            <section>
              <h3 className={styles.detailTitle}>Ce que le connecteur fera dans Sordulo OS</h3>
              <p>{selected.details ?? selected.description}</p>
            </section>
            {selected.status === 'live' && live[selected.id] ? (
              <section>
                <h3 className={styles.detailTitle}>État</h3>
                <p aria-live="polite">{live[selected.id]!.state}</p>
                {live[selected.id]!.hint ? <p>{live[selected.id]!.hint}</p> : null}
                {live[selected.id]!.notice ? <p className={styles.muted}>{live[selected.id]!.notice}</p> : null}
                {live[selected.id]!.error ? (
                  <p className={styles.error} role="alert">
                    {live[selected.id]!.error}
                  </p>
                ) : null}
                <div className={styles.detailAction}>
                  <LiveButton card={live[selected.id]!} />
                </div>
              </section>
            ) : (
              <p className={styles.muted}>Pas encore disponible : il n’y a rien à installer pour l’instant.</p>
            )}
          </div>
        ) : null}
      </Modal>

      <VercelConnectModal open={vercelOpen} onClose={() => setVercelOpen(false)} vercel={vercel} />
      <SpotifyConnectModal spotify={spotify} />
    </section>
  )
}
