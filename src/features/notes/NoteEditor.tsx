import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Badge, Button, Field, Modal, Select, Textarea, TextInput, useToast } from '../../components/ui'
import { LABELS, NOTE_TITLE_MAX_LENGTH, NOTE_VISIBILITIES, type NoteVisibility } from '../../shared/types'
import { MarkdownView } from '../contracts/MarkdownView'
import {
  canChangeVisibility,
  canEditNote,
  canUseTeamNotes,
  draftFromNote,
  formatModified,
  isEmptyPatch,
  noteDraftError,
  notePatch,
  noteTitle,
  saveStateLabel,
  type NoteDraft,
  type NoteViewer,
  type NoteWithLinks,
  type SaveState,
} from './noteLogic'
import { noteErrorText, useDeleteNote, useUpdateNote, type LinkOption } from './useNotes'
import styles from './notes.module.css'

/** Délai sans frappe avant l'enregistrement automatique. */
const AUTOSAVE_MS = 800

export interface NoteEditorProps {
  note: NoteWithLinks
  viewer: NoteViewer
  /** Projets et clients proposés (null : rôle sans accès, rattachement masqué). */
  linkOptions: { projects: LinkOption[]; clients: LinkOption[] } | null
  /** Met le focus sur le titre à l'ouverture (note tout juste créée). */
  autoFocus?: boolean
  onClose: () => void
  onDeleted: () => void
}

/** Éditeur d'une note : enregistrement automatique, aperçu Markdown, épinglage, suppression confirmée. */
export function NoteEditor({ note, viewer, linkOptions, autoFocus = false, onClose, onDeleted }: NoteEditorProps) {
  const toast = useToast()
  const update = useUpdateNote()
  const remove = useDeleteNote()
  const editable = canEditNote(note, viewer)
  const canTeam = canUseTeamNotes(viewer.role)

  const [draft, setDraft] = useState<NoteDraft>(() => draftFromNote(note))
  const [state, setState] = useState<SaveState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState(() => !editable || (note.body.trim() !== '' && !autoFocus))
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // Dernière version enregistrée et brouillon courant, lus par l'enregistrement différé et au démontage.
  const savedRef = useRef<NoteDraft>(draftFromNote(note))
  const draftRef = useRef(draft)
  const savingRef = useRef(false)
  const mutateRef = useRef(update.mutateAsync)
  useEffect(() => {
    draftRef.current = draft
    mutateRef.current = update.mutateAsync
  })

  const save = useCallback(async () => {
    if (savingRef.current) return
    const sent = draftRef.current
    const patch = notePatch(sent, savedRef.current)
    if (isEmptyPatch(patch)) return
    const invalid = noteDraftError(sent)
    if (invalid) {
      setError(invalid)
      setState('error')
      return
    }
    savingRef.current = true
    setState('saving')
    setError(null)
    try {
      await mutateRef.current({ id: note.id, patch })
      savedRef.current = sent
      setState(isEmptyPatch(notePatch(draftRef.current, sent)) ? 'saved' : 'dirty')
    } catch (e) {
      setError(noteErrorText(e))
      setState('error')
    } finally {
      savingRef.current = false
    }
  }, [note.id])

  // Enregistrement automatique après une pause de frappe ; relancé si on a tapé pendant l'envoi.
  useEffect(() => {
    if (!editable || isEmptyPatch(notePatch(draft, savedRef.current)) || state === 'saving') return
    const timer = window.setTimeout(() => void save(), AUTOSAVE_MS)
    return () => window.clearTimeout(timer)
  }, [draft, editable, save, state])

  // Changement de note ou départ de la page : ce qui reste est envoyé.
  useEffect(
    () => () => {
      if (!isEmptyPatch(notePatch(draftRef.current, savedRef.current)) && !noteDraftError(draftRef.current)) {
        void mutateRef.current({ id: note.id, patch: notePatch(draftRef.current, savedRef.current) }).catch(() => undefined)
      }
    },
    [note.id],
  )

  // Fermeture de l'onglet avec des modifications en attente : avertissement du navigateur.
  useEffect(() => {
    if (state !== 'dirty' && state !== 'saving' && state !== 'error') return
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [state])

  function set<K extends keyof NoteDraft>(key: K, value: NoteDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
    setState((s) => (s === 'saving' ? s : 'dirty'))
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      void save()
    }
  }

  async function togglePinned() {
    try {
      await update.mutateAsync({ id: note.id, patch: { pinned: !note.pinned } })
    } catch (e) {
      toast.error(noteErrorText(e))
    }
  }

  async function deleteNote() {
    setDeleteError(null)
    try {
      // Rien ne doit être renvoyé au démontage pour une note supprimée.
      savedRef.current = draftRef.current
      await remove.mutateAsync(note.id)
      toast.success('Note supprimée')
      setConfirmDelete(false)
      onDeleted()
    } catch (e) {
      setDeleteError(noteErrorText(e))
    }
  }

  const author = note.author_id === viewer.memberId ? 'toi' : (note.author?.name ?? 'un membre retiré')
  const meta = `Par ${author}, ${formatModified(note.updated_at)}`
  // Lecture seule : la version en cache (mise à jour par les autres) ; sinon le brouillon en cours.
  const shown = editable ? { title: draft.title, body: draft.body } : { title: note.title, body: note.body }
  const linkNames = [note.project?.name, note.client?.name].filter(Boolean).join(' · ')

  return (
    <article className={styles.editor} aria-label={`Note ${noteTitle(note)}`} onKeyDown={onKeyDown}>
      <header className={styles.editorHeader}>
        <div className={styles.editorMeta}>
          <Badge tone={note.visibility === 'team' ? 'info' : 'neutral'}>{LABELS.noteVisibility[note.visibility]}</Badge>
          {note.pinned ? <Badge tone="primary">Épinglée</Badge> : null}
          <span className={styles.muted}>{meta}</span>
        </div>
        <div className={styles.editorActions}>
          {editable ? (
            <span className={[styles.saveState, state === 'error' ? styles.saveError : ''].join(' ')} role="status" aria-live="polite">
              {saveStateLabel(state)}
            </span>
          ) : null}
          {editable ? (
            <>
              <Button size="sm" variant="ghost" aria-pressed={preview} onClick={() => setPreview((p) => !p)}>
                {preview ? 'Modifier' : 'Aperçu'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void togglePinned()}>
                {note.pinned ? 'Désépingler' : 'Épingler'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDeleteError(null)
                  setConfirmDelete(true)
                }}
              >
                Supprimer
              </Button>
            </>
          ) : null}
          <Button size="sm" variant="ghost" onClick={onClose}>
            Fermer
          </Button>
        </div>
      </header>

      {error ? (
        <div className={styles.error} role="alert">
          <span>{error}</span>
          <Button size="sm" variant="secondary" onClick={() => void save()}>
            Réessayer
          </Button>
        </div>
      ) : null}

      {editable && !preview ? (
        <div className={styles.form}>
          <Field label="Titre">
            <TextInput
              value={draft.title}
              maxLength={NOTE_TITLE_MAX_LENGTH}
              placeholder="Sans titre"
              onChange={(e) => set('title', e.target.value)}
              autoFocus={autoFocus}
              autoComplete="off"
            />
          </Field>
          {canTeam || linkOptions ? (
            <div className={styles.row}>
              {canChangeVisibility(note, viewer) ? (
                <Field label="Visibilité" hint={draft.visibility === 'team' ? 'Lue par l’équipe (admin, membre, finance).' : 'Visible par toi seul.'}>
                  <Select value={draft.visibility} onChange={(e) => set('visibility', e.target.value as NoteVisibility)}>
                    {NOTE_VISIBILITIES.map((v) => (
                      <option key={v} value={v}>
                        {LABELS.noteVisibility[v]}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
              {linkOptions ? (
                <>
                  <Field label="Projet">
                    <Select value={draft.projectId} onChange={(e) => set('projectId', e.target.value)}>
                      <option value="">Aucun</option>
                      {withCurrent(linkOptions.projects, note.project).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Client">
                    <Select value={draft.clientId} onChange={(e) => set('clientId', e.target.value)}>
                      <option value="">Aucun</option>
                      {withCurrent(linkOptions.clients, note.client).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </>
              ) : null}
            </div>
          ) : null}
          <Field label="Contenu" hint="Markdown léger : # titre, - liste, **gras**, *italique*. Enregistrement automatique (⌘ S pour forcer).">
            <Textarea className={styles.body} value={draft.body} onChange={(e) => set('body', e.target.value)} rows={14} />
          </Field>
        </div>
      ) : (
        <div className={styles.read}>
          <h2 className={styles.readTitle}>{noteTitle(shown)}</h2>
          {linkNames ? <p className={styles.muted}>{linkNames}</p> : null}
          <div className={styles.markdown}>
            <MarkdownView source={shown.body} empty="Cette note est vide." />
          </div>
        </div>
      )}

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        dismissible={!remove.isPending}
        title="Supprimer cette note ?"
        actions={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={remove.isPending}>
              Annuler
            </Button>
            <Button variant="danger" onClick={() => void deleteNote()} loading={remove.isPending}>
              Supprimer
            </Button>
          </>
        }
      >
        <p>
          « {noteTitle({ title: draft.title, body: draft.body })} » sera supprimée
          {note.visibility === 'team' ? ' pour toute l’équipe' : ''}. Cette action est définitive.
        </p>
        {deleteError ? (
          <p className={styles.error} role="alert">
            {deleteError}
          </p>
        ) : null}
      </Modal>
    </article>
  )
}

/** Options, plus l'élément actuellement rattaché s'il n'y figure pas (client archivé). */
function withCurrent(options: LinkOption[], current: LinkOption | null): LinkOption[] {
  return current && !options.some((o) => o.id === current.id) ? [...options, current] : options
}
