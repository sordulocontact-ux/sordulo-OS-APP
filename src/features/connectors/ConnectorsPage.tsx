import { useMemo, useState } from 'react'
import { Badge, Button, EmptyState, Modal, SearchField } from '../../components/ui'
import { CONNECTORS, connectorInitials, filterConnectors, type Connector } from './catalog'
import { useSpotify, type SpotifyConnector } from './useSpotify'
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

function StatusBadge({ connector, spotify }: { connector: Connector; spotify: SpotifyConnector }) {
  if (connector.status === 'live') return <Badge tone={spotify.view.badge.tone}>{spotify.view.badge.label}</Badge>
  return connector.status === 'connected' ? <Badge tone="success">Connecté</Badge> : <Badge tone="neutral">Bientôt</Badge>
}

function SpotifyButton({ spotify, className }: { spotify: SpotifyConnector; className?: string }) {
  const { action } = spotify.view
  const { kind } = action
  return (
    <Button
      className={className}
      variant={kind === 'disconnect' ? 'secondary' : 'primary'}
      loading={action.loading}
      disabled={action.disabled}
      title={action.title}
      onClick={kind ? () => spotify.run(kind) : undefined}
    >
      {action.label}
    </Button>
  )
}

export function ConnectorsPage() {
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Connector | null>(null)

  const spotify = useSpotify()
  const spotifyConnected = spotify.view.connected

  const visible = useMemo(
    () => filterConnectors(CONNECTORS, query, filter === 'connected', new Set(spotifyConnected ? ['spotify'] : [])),
    [query, filter, spotifyConnected],
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
                <StatusBadge connector={c} spotify={spotify} />
              </div>
              <p className={styles.description}>{c.description}</p>
              {c.status === 'live' ? (
                <>
                  {spotify.view.connected ? (
                    <p className={styles.cardState}>{spotify.view.state}</p>
                  ) : spotify.view.notice ? (
                    <p className={styles.cardState}>{spotify.view.notice}</p>
                  ) : null}
                  {spotify.error ? (
                    <p className={styles.error} role="alert">
                      {spotify.error}
                    </p>
                  ) : null}
                </>
              ) : null}
              <div className={styles.actions}>
                <Button className={styles.action} onClick={() => setSelected(c)} aria-label={`Détails de ${c.name}`}>
                  Détails
                </Button>
                {c.status === 'live' ? (
                  <SpotifyButton spotify={spotify} className={styles.action} />
                ) : c.status === 'connected' ? (
                  <Button className={styles.action} aria-disabled="true" tabIndex={-1} onClick={(e) => e.preventDefault()}>
                    <span aria-hidden="true">✓</span> Connecté
                  </Button>
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
              <StatusBadge connector={selected} spotify={spotify} />
            </div>
            <section>
              <h3 className={styles.detailTitle}>Ce que le connecteur fera dans Sordulo OS</h3>
              <p>{selected.details ?? selected.description}</p>
            </section>
            {selected.status === 'live' ? (
              <section>
                <h3 className={styles.detailTitle}>État</h3>
                <p aria-live="polite">{spotify.view.state}</p>
                {spotify.view.hint ? <p>{spotify.view.hint}</p> : null}
                {spotify.view.notice ? <p className={styles.muted}>{spotify.view.notice}</p> : null}
                {spotify.error ? (
                  <p className={styles.error} role="alert">
                    {spotify.error}
                  </p>
                ) : null}
                <div className={styles.detailAction}>
                  <SpotifyButton spotify={spotify} />
                </div>
              </section>
            ) : selected.status === 'connected' ? (
              <section>
                <h3 className={styles.detailTitle}>État</h3>
                <p>{selected.state}</p>
                <p className={styles.muted}>Configuré côté serveur : rien à faire ici.</p>
              </section>
            ) : (
              <p className={styles.muted}>Pas encore disponible : il n’y a rien à installer pour l’instant.</p>
            )}
          </div>
        ) : null}
      </Modal>
    </section>
  )
}
