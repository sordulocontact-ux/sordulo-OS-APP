/**
 * Validation des tickets dans l'île (état `review`, « Valider ici » de la notification tickets) : un ticket à la
 * fois, comme l'écran de validation. En-tête (entrée, projet, « 2 sur 5 » et flèches), type, étoile d'un moment
 * marqué, titre, description raccourcie, extrait de la réunion, personne attribuée, puis Modifier dans l'app,
 * Tout valider, Refuser, Valider. États : chargement, erreur, tout traité, refus annulable.
 *
 * Le clavier (flèches, Entrée, Retour arrière, Échap) est lu par Island.tsx (reviewKeyAction). Les boutons
 * occupés restent focalisables (aria-disabled, pas disabled) : un bouton désactivé perdrait le focus, et le
 * clavier de l'île avec lui.
 */
import { useLayoutEffect, useRef, type CSSProperties, type ReactNode, type Ref } from 'react'
import { ART } from '../../art/pixelArt'
import { PixelArtSvg } from '../../art/PixelArtSvg'
import type { TicketType } from '../../../../shared/types'
import { cx } from '../cx'
import { useLastNonNull } from '../hooks'
import { IslandIcon } from '../icons'
import islandStyles from '../Island.module.css'
import { Layer } from '../Layer'
import {
  REVIEW_DESCRIPTION_MAX,
  REVIEW_QUOTE_MAX,
  currentTicket,
  reviewIndex,
  reviewPosition,
  reviewView,
  shortenText,
  ticketTypeLabel,
} from '../review'
import { toneStyle } from '../tone'
import type { IslandReview, IslandReviewAction, IslandReviewTicket } from '../types'
import type { BaseLayerProps } from './CallLayers'
import styles from './ReviewLayer.module.css'

const TYPE_CLASS: Record<TicketType, string | undefined> = {
  bug: styles.typeBug,
  modification: styles.typeModification,
  new_request: styles.typeNew,
}

function Chevron({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg className={islandStyles.ico} viewBox="0 0 24 24" aria-hidden="true">
      <path d={direction === 'left' ? 'M14.5 6.5L9 12l5.5 5.5' : 'M9.5 6.5L15 12l-5.5 5.5'} />
    </svg>
  )
}

/** Bouton de l'île ; `inactive` : visible et focalisable, mais sans effet (aria-disabled). */
function ActionButton({
  className,
  inactive,
  onPress,
  children,
  label,
  buttonRef,
}: {
  className?: string
  inactive: boolean
  onPress: () => void
  children: ReactNode
  label?: string
  buttonRef?: Ref<HTMLButtonElement>
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className={cx(islandStyles.btn, islandStyles.btnSm, className, inactive && styles.inactive)}
      aria-disabled={inactive || undefined}
      aria-label={label}
      onClick={() => {
        if (!inactive) onPress()
      }}
    >
      {children}
    </button>
  )
}

function Assignee({ ticket }: { ticket: IslandReviewTicket }) {
  if (!ticket.assignee) {
    return (
      <span className={styles.assignee}>
        <span className={cx(styles.avatar, styles.avatarEmpty)} aria-hidden="true" />
        <span className={styles.assigneeName}>Non attribué</span>
      </span>
    )
  }
  return (
    <span className={styles.assignee}>
      <span className={styles.avatar} aria-hidden="true">
        {ticket.assignee.initials}
      </span>
      <span className={styles.assigneeName}>
        <span className={islandStyles.srOnly}>Attribué à </span>
        {ticket.assignee.name}
      </span>
    </span>
  )
}

/** Bandeau du dernier refus, annulable (« Ticket refusé : titre », Annuler). */
function UndoBanner({
  undo,
  busy,
  onUndo,
}: {
  undo: NonNullable<IslandReview['undo']>
  busy: boolean
  onUndo: () => void
}) {
  return (
    <span className={styles.undo} role="status">
      <span className={styles.undoText}>Ticket refusé : {undo.ticketTitle}</span>
      <ActionButton className={cx(islandStyles.btnGhost, styles.undoBtn)} inactive={busy} onPress={onUndo}>
        Annuler
      </ActionButton>
    </span>
  )
}

export function ReviewLayer({
  review,
  onReviewAction,
  ...base
}: BaseLayerProps & {
  review: IslandReview | null
  onReviewAction?: (action: IslandReviewAction) => void
}) {
  const shown = useLastNonNull(review)
  const on = base.current === 'review'
  const view = shown ? reviewView(shown) : 'loading'
  const ticket = shown ? currentTicket(shown) : null
  const busy = shown?.busy ?? false
  const index = shown ? reviewIndex(shown) : 0
  const count = shown?.tickets.length ?? 0
  const canPrevious = !busy && view === 'ticket' && index > 0
  const canNext = !busy && view === 'ticket' && index < count - 1

  const cardRef = useRef<HTMLDivElement>(null)
  const validateRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const wasOn = useRef(false)

  // En entrant dans l'état (on vient de cliquer « Valider ici ») : focus sur « Valider », sinon sur « Fermer »
  // (tout traité, erreur), sinon sur la carte (chargement), pour que le clavier de l'île réponde. Ensuite, le
  // focus n'est repris que s'il s'est perdu (bouton retiré : dernier ticket traité, fin du chargement).
  useLayoutEffect(() => {
    const entering = on && !wasOn.current
    wasOn.current = on
    if (!on) return
    const card = cardRef.current
    const active = document.activeElement
    const lost = !active || active === document.body || active === card
    if (!entering && !lost) return
    const target = validateRef.current ?? closeRef.current ?? card
    target?.focus({ preventScroll: true })
  })

  const act = (action: IslandReviewAction) => {
    if (busy && action.type !== 'close') return
    onReviewAction?.(action)
  }
  const notice = shown?.error ? (
    <span className={styles.error} role="alert" title={shown.error}>
      {shown.error}
    </span>
  ) : shown?.undo ? (
    <UndoBanner undo={shown.undo} busy={busy} onUndo={() => act({ type: 'undo' })} />
  ) : null

  return (
    <Layer {...base} state="review" className={styles.layer} role="dialog" label="Validation des tickets">
      <div ref={cardRef} className={styles.card} tabIndex={-1} aria-busy={busy || view === 'loading' || undefined}>
        <div className={styles.head}>
          <div className={styles.headText}>
            <strong>{shown?.inputTitle ?? 'Tickets à valider'}</strong>
            <small>{shown?.projectName ?? ''}</small>
          </div>
          {view === 'ticket' && shown && (
            <div className={styles.nav}>
              <button
                type="button"
                className={cx(styles.navBtn, !canPrevious && styles.inactive)}
                aria-label="Ticket précédent"
                aria-disabled={!canPrevious || undefined}
                onClick={() => canPrevious && act({ type: 'previous' })}
              >
                <Chevron direction="left" />
              </button>
              <span className={styles.position}>{reviewPosition(shown)}</span>
              <button
                type="button"
                className={cx(styles.navBtn, !canNext && styles.inactive)}
                aria-label="Ticket suivant"
                aria-disabled={!canNext || undefined}
                onClick={() => canNext && act({ type: 'next' })}
              >
                <Chevron direction="right" />
              </button>
            </div>
          )}
        </div>

        {view === 'ticket' && ticket ? (
          <>
            <div className={styles.titleRow}>
              <span className={cx(styles.type, TYPE_CLASS[ticket.type])}>{ticketTypeLabel(ticket)}</span>
              {ticket.fromMarker && (
                <span className={styles.star} title="Moment marqué pendant l’appel">
                  <PixelArtSvg art={ART.star} className={styles.starArt ?? ''} />
                  <span className={islandStyles.srOnly}>Moment marqué pendant l’appel</span>
                </span>
              )}
              <strong className={styles.title} title={ticket.title}>
                {ticket.title}
              </strong>
            </div>
            {ticket.description.trim() !== '' && (
              <p className={styles.description}>{shortenText(ticket.description, REVIEW_DESCRIPTION_MAX)}</p>
            )}
            {ticket.quote && ticket.quote.trim() !== '' && (
              <blockquote className={styles.quote} aria-label="Extrait de la réunion">
                « {shortenText(ticket.quote, REVIEW_QUOTE_MAX)} »
              </blockquote>
            )}
            <div className={styles.metaRow}>
              <Assignee ticket={ticket} />
              {notice}
            </div>
            <div className={styles.actions}>
              <ActionButton
                className={islandStyles.btnQuiet}
                inactive={busy}
                onPress={() => act({ type: 'openInApp' })}
              >
                Modifier dans l’app
              </ActionButton>
              <ActionButton
                className={islandStyles.btnGhost}
                inactive={busy}
                onPress={() => act({ type: 'validateAll' })}
                label={`Tout valider (${count} ${count > 1 ? 'tickets' : 'ticket'})`}
              >
                Tout valider
              </ActionButton>
              <span className={styles.spacer} />
              <ActionButton className={islandStyles.btnGhost} inactive={busy} onPress={() => act({ type: 'reject' })}>
                Refuser
              </ActionButton>
              <ActionButton
                buttonRef={validateRef}
                className={islandStyles.btnMain}
                inactive={busy}
                onPress={() => act({ type: 'validate' })}
              >
                Valider
              </ActionButton>
            </div>
          </>
        ) : (
          <ReviewState review={shown} view={view} closeRef={closeRef} act={act} />
        )}
      </div>
    </Layer>
  )
}

/** Chargement, erreur sans ticket, tout traité : message au centre et bouton Fermer. */
function ReviewState({
  review,
  view,
  closeRef,
  act,
}: {
  review: IslandReview | null
  view: 'loading' | 'error' | 'done' | 'ticket'
  closeRef: Ref<HTMLButtonElement>
  act: (action: IslandReviewAction) => void
}) {
  const busy = review?.busy ?? false
  let icon: ReactNode
  let title: string
  let tone: CSSProperties | undefined
  if (view === 'loading') {
    icon = <span className={cx(islandStyles.spin, styles.stateSpin)} aria-hidden="true" />
    title = 'Chargement des tickets…'
  } else if (view === 'error') {
    icon = <IslandIcon name="alert" />
    tone = toneStyle('danger')
    title = review?.error ?? 'Les tickets n’ont pas pu être chargés'
  } else {
    icon = <IslandIcon name="check" />
    tone = toneStyle('success')
    title = 'Tous les tickets sont traités'
  }
  return (
    <div className={styles.state}>
      <span className={cx(styles.stateIcon, view === 'loading' && styles.stateIconPlain)} style={tone} aria-hidden="true">
        {icon}
      </span>
      <strong className={styles.stateTitle} role={view === 'error' ? 'alert' : undefined}>
        {title}
      </strong>
      {view === 'done' && review?.undo && (
        <UndoBanner undo={review.undo} busy={busy} onUndo={() => act({ type: 'undo' })} />
      )}
      <div className={styles.stateActions}>
        {view === 'error' && (
          <ActionButton className={islandStyles.btnGhost} inactive={busy} onPress={() => act({ type: 'openInApp' })}>
            Ouvrir dans l’app
          </ActionButton>
        )}
        <ActionButton
          buttonRef={view === 'loading' ? undefined : closeRef}
          className={view === 'loading' ? islandStyles.btnGhost : islandStyles.btnMain}
          inactive={false}
          onPress={() => act({ type: 'close' })}
        >
          Fermer
        </ActionButton>
      </div>
    </div>
  )
}
