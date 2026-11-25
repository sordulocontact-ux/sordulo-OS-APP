import { useId, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { Badge, Button, Spinner, Textarea } from '../../components/ui'
import {
  formatDateTime,
  isPinned,
  pinNumbers,
  pointFromClick,
  previewKind,
  sortComments,
  type PinPoint,
  type ViewerComment,
} from './deliverableLogic'
import styles from './DeliverableViewer.module.css'

export interface NewCommentInput {
  x: number | null
  y: number | null
  body: string
}

export interface DeliverableViewerProps {
  fileName: string
  mimeType: string | null
  /** URL de lecture (signée) ; null pendant le chargement ou si le fichier n'est plus disponible. */
  url: string | null
  urlLoading?: boolean
  comments: readonly ViewerComment[]
  commentsLoading?: boolean
  /** Absent : lecture seule. Renvoie true si le commentaire est enregistré (le brouillon est alors vidé). */
  onAddComment?: (input: NewCommentInput) => Promise<boolean>
  /** Absent : pas de bouton Résoudre (portail). */
  onToggleResolved?: (comment: ViewerComment) => void
  /** Libellé de l'auteur « client » dans la liste (« Client » côté équipe, « Vous » sur le portail). */
  clientLabel?: string
  teamLabel?: string
}

const MAX_COMMENT = 2000

/**
 * Visionneuse d'une version : image avec ses épingles (clic sur l'image → commentaire à cet endroit)
 * ou PDF en aperçu (commentaires sans position), et la liste des commentaires. Au clavier, les
 * épingles sont des boutons et la liste donne accès à chacune ; le commentaire général se tape
 * sans pointer. Le brouillon et la sélection appartiennent à une version : monter la visionneuse
 * avec `key={version.id}` pour les oublier au changement de version.
 */
export function DeliverableViewer({
  fileName,
  mimeType,
  url,
  urlLoading = false,
  comments,
  commentsLoading = false,
  onAddComment,
  onToggleResolved,
  clientLabel = 'Client',
  teamLabel = 'Équipe',
}: DeliverableViewerProps) {
  const kind = previewKind(mimeType, fileName)
  const canComment = Boolean(onAddComment)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [draftPin, setDraftPin] = useState<PinPoint | null>(null)
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [showResolved, setShowResolved] = useState(false)
  const imageRef = useRef<HTMLImageElement>(null)
  const composerRef = useRef<HTMLFormElement>(null)
  const itemRefs = useRef(new Map<string, HTMLLIElement>())
  const pinRefs = useRef(new Map<string, HTMLButtonElement>())
  const composerId = useId()

  const numbers = useMemo(() => pinNumbers(comments), [comments])
  const resolvedCount = comments.filter((c) => c.resolved).length
  const visible = useMemo(
    () => sortComments(comments.filter((c) => showResolved || !c.resolved)),
    [comments, showResolved],
  )
  const visiblePins = kind === 'image' ? visible.filter(isPinned) : []
  const draftNumber = numbers.size + 1

  function select(id: string, from: 'pin' | 'list') {
    setActiveId(id)
    if (from === 'pin') itemRefs.current.get(id)?.scrollIntoView({ block: 'nearest' })
    else pinRefs.current.get(id)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  function onImageClick(event: MouseEvent<HTMLDivElement>) {
    if (!canComment || !imageRef.current) return
    const point = pointFromClick(imageRef.current.getBoundingClientRect(), event.clientX, event.clientY)
    if (!point) return
    setDraftPin(point)
    setActiveId(null)
    composerRef.current?.querySelector('textarea')?.focus({ preventScroll: true })
  }

  async function submit(event: { preventDefault: () => void }) {
    event.preventDefault()
    const text = body.trim()
    if (!text || !onAddComment || sending) return
    setSending(true)
    try {
      const ok = await onAddComment({ x: draftPin?.x ?? null, y: draftPin?.y ?? null, body: text })
      if (ok) {
        setBody('')
        setDraftPin(null)
      }
    } finally {
      setSending(false)
    }
  }

  return (
    <div className={styles.viewer}>
      <div className={styles.preview}>
        {urlLoading ? (
          <div className={styles.placeholder}>
            <Spinner label="Chargement du fichier…" />
          </div>
        ) : !url ? (
          <div className={styles.placeholder}>
            <p className={styles.muted}>Ce fichier n’est plus disponible.</p>
          </div>
        ) : kind === 'image' ? (
          <>
            {canComment ? <p className={styles.hint}>Clique sur l’image pour placer un commentaire à cet endroit.</p> : null}
            <div className={styles.stageScroll}>
              <div
                className={`${styles.stage} ${canComment ? styles.stageCommentable : ''}`}
                onClick={onImageClick}
                role="presentation"
              >
                <img
                  ref={imageRef}
                  className={styles.image}
                  src={url}
                  alt={fileName}
                  referrerPolicy="no-referrer"
                  draggable={false}
                />
                {visiblePins.map((comment) => {
                  const n = numbers.get(comment.id)
                  return (
                    <button
                      key={comment.id}
                      ref={(node) => {
                        if (node) pinRefs.current.set(comment.id, node)
                        else pinRefs.current.delete(comment.id)
                      }}
                      type="button"
                      className={[
                        styles.pin,
                        comment.fromClient ? styles.pinClient : '',
                        comment.resolved ? styles.pinResolved : '',
                        activeId === comment.id ? styles.pinActive : '',
                      ].join(' ')}
                      style={{ '--pin-x': comment.x, '--pin-y': comment.y } as CSSProperties}
                      aria-label={`Épingle ${n ?? ''} : ${comment.body.slice(0, 80)}`}
                      aria-pressed={activeId === comment.id}
                      onClick={(event) => {
                        event.stopPropagation()
                        select(comment.id, 'pin')
                      }}
                    >
                      {n}
                    </button>
                  )
                })}
                {draftPin ? (
                  <span
                    className={`${styles.pin} ${styles.pinDraft}`}
                    style={{ '--pin-x': draftPin.x, '--pin-y': draftPin.y } as CSSProperties}
                    aria-hidden="true"
                  >
                    {draftNumber}
                  </span>
                ) : null}
              </div>
            </div>
          </>
        ) : kind === 'pdf' ? (
          <>
            <iframe className={styles.pdf} src={url} title={`Aperçu de ${fileName}`} referrerPolicy="no-referrer" />
            <a className={styles.openLink} href={url} target="_blank" rel="noreferrer">
              Ouvrir le PDF dans un nouvel onglet
            </a>
          </>
        ) : (
          <div className={styles.placeholder}>
            <a className={styles.openLink} href={url} target="_blank" rel="noreferrer">
              Télécharger {fileName}
            </a>
          </div>
        )}
      </div>

      <section className={styles.side} aria-label="Commentaires">
        <div className={styles.sideHeader}>
          <h3 className={styles.sideTitle}>Commentaires</h3>
          {resolvedCount > 0 ? (
            <Button size="sm" variant="ghost" onClick={() => setShowResolved((v) => !v)} aria-pressed={showResolved}>
              {showResolved ? 'Masquer les résolus' : `Afficher les résolus (${resolvedCount})`}
            </Button>
          ) : null}
        </div>

        {commentsLoading ? (
          <Spinner label="Chargement des commentaires…" />
        ) : visible.length === 0 ? (
          <p className={styles.muted}>
            {comments.length > 0
              ? 'Tous les commentaires sont résolus.'
              : canComment
                ? kind === 'image'
                  ? 'Aucun commentaire. Clique sur l’image ou écris ci-dessous.'
                  : 'Aucun commentaire pour l’instant.'
                : 'Aucun commentaire.'}
          </p>
        ) : (
          <ol className={styles.list}>
            {visible.map((comment) => {
              const n = numbers.get(comment.id)
              const active = activeId === comment.id
              return (
                <li
                  key={comment.id}
                  ref={(node) => {
                    if (node) itemRefs.current.set(comment.id, node)
                    else itemRefs.current.delete(comment.id)
                  }}
                  className={`${styles.item} ${active ? styles.itemActive : ''} ${comment.resolved ? styles.itemResolved : ''}`}
                >
                  <div className={styles.itemHead}>
                    {n !== undefined && kind === 'image' ? (
                      <button
                        type="button"
                        className={`${styles.pinRef} ${comment.fromClient ? styles.pinClient : ''}`}
                        onClick={() => select(comment.id, 'list')}
                        aria-label={`Montrer l’épingle ${n} sur l’image`}
                        aria-pressed={active}
                      >
                        {n}
                      </button>
                    ) : null}
                    <span className={styles.author}>{comment.authorName}</span>
                    <Badge tone={comment.fromClient ? 'info' : 'neutral'}>{comment.fromClient ? clientLabel : teamLabel}</Badge>
                    {comment.resolved ? <Badge tone="success">Résolu</Badge> : null}
                  </div>
                  <p className={styles.body}>{comment.body}</p>
                  <div className={styles.itemFoot}>
                    <time className={styles.date} dateTime={comment.createdAt}>
                      {formatDateTime(comment.createdAt)}
                    </time>
                    {onToggleResolved ? (
                      <Button size="sm" variant="ghost" onClick={() => onToggleResolved(comment)}>
                        {comment.resolved ? 'Rouvrir' : 'Résoudre'}
                      </Button>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ol>
        )}

        {canComment && url ? (
          <form ref={composerRef} className={styles.composer} onSubmit={(event) => void submit(event)}>
            <label htmlFor={composerId} className={styles.composerLabel}>
              {draftPin ? `Commentaire sur l’épingle ${draftNumber}` : 'Commentaire général'}
            </label>
            <Textarea
              id={composerId}
              rows={3}
              value={body}
              maxLength={MAX_COMMENT}
              onChange={(event) => setBody(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void submit(event)
                if (event.key === 'Escape' && draftPin) setDraftPin(null)
              }}
              placeholder={kind === 'image' ? 'Ce qui doit changer, à cet endroit ou en général' : 'Ce qui doit changer'}
            />
            <div className={styles.composerActions}>
              {draftPin ? (
                <Button size="sm" variant="ghost" onClick={() => setDraftPin(null)}>
                  Retirer l’épingle
                </Button>
              ) : null}
              <Button size="sm" variant="primary" type="submit" loading={sending} disabled={!body.trim()}>
                Envoyer
              </Button>
            </div>
          </form>
        ) : null}
      </section>
    </div>
  )
}
