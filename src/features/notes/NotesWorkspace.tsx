import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Badge, Button, EmptyState, ErrorState, Field, Icon, ListToolbar, LoadingState, Select, useToast } from '../../components/ui'
import plusIcon from '../../assets/icons/plus.svg'
import { LABELS } from '../../shared/types'
import { useCurrentMember } from '../auth/useCurrentMember'
import { NoteEditor } from './NoteEditor'
import {
  activeNoteFilterCount,
  canUseTeamNotes,
  EMPTY_NOTE_FILTERS,
  filterNotes,
  formatNoteDate,
  noteExcerpt,
  noteTitle,
  VISIBILITY_FILTER_LABELS,
  type NoteFilters,
  type NoteVisibilityFilter,
} from './noteLogic'
import { noteErrorText, useCreateNote, useNoteLinkOptions, useNotes } from './useNotes'
import styles from './notes.module.css'

export interface NotesWorkspaceProps {
  /** Onglet d'un projet : notes de ce projet seulement, nouvelles notes rattachées à lui. */
  fixedProjectId?: string
  /** Client du projet, repris sur les nouvelles notes de l'onglet. */
  fixedClientId?: string | null
}

/** Paramètre d'URL de la note ouverte (lien Cmd+K, retour arrière). */
const NOTE_PARAM = 'note'

/** Liste des notes et éditeur côte à côte (empilés sur écran étroit). */
export function NotesWorkspace({ fixedProjectId, fixedClientId = null }: NotesWorkspaceProps) {
  const toast = useToast()
  const { member, organization } = useCurrentMember()
  const canTeam = member ? canUseTeamNotes(member.role) : false
  const notesQuery = useNotes(fixedProjectId)
  const linkQuery = useNoteLinkOptions(canTeam)
  const create = useCreateNote()
  const [params, setParams] = useSearchParams()
  const [filters, setFilters] = useState<NoteFilters>(EMPTY_NOTE_FILTERS)
  const [createdId, setCreatedId] = useState<string | null>(null)

  const notes = useMemo(() => notesQuery.data ?? [], [notesQuery.data])
  const visible = useMemo(() => filterNotes(notes, filters), [notes, filters])
  const selectedId = params.get(NOTE_PARAM)
  const selected = selectedId ? (notes.find((n) => n.id === selectedId) ?? null) : null
  const linkOptions = canTeam && linkQuery.data ? linkQuery.data : null

  function setFilter<K extends keyof NoteFilters>(key: K, value: NoteFilters[K]) {
    setFilters((f) => ({ ...f, [key]: value }))
  }

  function select(id: string | null) {
    const next = new URLSearchParams(params)
    if (id) next.set(NOTE_PARAM, id)
    else next.delete(NOTE_PARAM)
    setParams(next, { replace: selectedId !== null && id !== null })
  }

  async function createNote() {
    if (!organization || create.isPending) return
    try {
      const note = await create.mutateAsync({
        organizationId: organization.id,
        // Onglet projet : la note est pour l'équipe ; ailleurs, perso par défaut (sauf filtre Équipe).
        visibility: canTeam && (fixedProjectId || filters.visibility === 'team') ? 'team' : 'personal',
        projectId: canTeam ? (fixedProjectId ?? (filters.projectId || null)) : null,
        clientId: canTeam ? (fixedProjectId ? fixedClientId : filters.clientId || null) : null,
      })
      setCreatedId(note.id)
      select(note.id)
    } catch (e) {
      toast.error(noteErrorText(e))
    }
  }

  const newButton = (
    <Button variant="primary" onClick={() => void createNote()} loading={create.isPending} disabled={!organization}>
      <Icon src={plusIcon} />
      Nouvelle note
    </Button>
  )

  const filterFields = (
    <>
      {canTeam ? (
        <Field label="Visibilité">
          <Select value={filters.visibility} onChange={(e) => setFilter('visibility', e.target.value as NoteVisibilityFilter)}>
            {(Object.keys(VISIBILITY_FILTER_LABELS) as NoteVisibilityFilter[]).map((v) => (
              <option key={v} value={v}>
                {VISIBILITY_FILTER_LABELS[v]}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      {linkOptions && !fixedProjectId ? (
        <>
          <Field label="Projet">
            <Select value={filters.projectId} onChange={(e) => setFilter('projectId', e.target.value)}>
              <option value="">Tous</option>
              {linkOptions.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Client">
            <Select value={filters.clientId} onChange={(e) => setFilter('clientId', e.target.value)}>
              <option value="">Tous</option>
              {linkOptions.clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </>
      ) : null}
    </>
  )

  return (
    <div className={styles.workspace}>
      <div className={styles.listColumn}>
        <ListToolbar
          search={{
            value: filters.query,
            onChange: (value) => setFilter('query', value),
            label: 'Rechercher une note',
            placeholder: 'Titre, contenu, projet, client',
          }}
          filters={canTeam ? filterFields : undefined}
          activeFilterCount={activeNoteFilterCount(filters)}
          onResetFilters={() => setFilters((f) => ({ ...EMPTY_NOTE_FILTERS, query: f.query }))}
          onAdd={organization ? () => void createNote() : undefined}
          addLabel="Nouvelle note"
          addDisabled={create.isPending}
        />
        {notesQuery.isLoading ? (
          <LoadingState label="Chargement des notes…" />
        ) : notesQuery.isError ? (
          <ErrorState message="Impossible de charger les notes." onRetry={() => void notesQuery.refetch()} />
        ) : notes.length === 0 ? (
          <EmptyState
            title={fixedProjectId ? 'Aucune note pour ce projet' : 'Aucune note'}
            text={
              fixedProjectId
                ? 'Garde ici les décisions, accès et idées du projet. Les notes de l’onglet sont partagées avec l’équipe.'
                : canTeam
                  ? 'Une note est perso par défaut : passe-la en Équipe pour la partager, et rattache-la à un projet ou un client.'
                  : 'Tes notes sont visibles par toi seul.'
            }
            action={newButton}
          />
        ) : visible.length === 0 ? (
          <EmptyState title="Aucune note ne correspond à la recherche ni aux filtres." />
        ) : (
          <ul className={styles.list} aria-label="Notes">
            {visible.map((note) => {
              const excerpt = noteExcerpt(note)
              const links = fixedProjectId ? note.client?.name : [note.project?.name, note.client?.name].filter(Boolean).join(' · ')
              return (
                <li key={note.id}>
                  <button
                    type="button"
                    className={[styles.item, note.id === selectedId ? styles.itemActive : ''].join(' ')}
                    aria-current={note.id === selectedId ? 'true' : undefined}
                    onClick={() => select(note.id)}
                  >
                    <span className={styles.itemTop}>
                      <span className={styles.itemTitle}>{noteTitle(note)}</span>
                      <span className={styles.itemDate}>{formatNoteDate(note.updated_at)}</span>
                    </span>
                    {excerpt ? <span className={styles.itemExcerpt}>{excerpt}</span> : null}
                    <span className={styles.itemMeta}>
                      {note.pinned ? <Badge tone="primary">Épinglée</Badge> : null}
                      {canTeam ? <Badge tone={note.visibility === 'team' ? 'info' : 'neutral'}>{LABELS.noteVisibility[note.visibility]}</Badge> : null}
                      {links ? <span className={styles.itemLinks}>{links}</span> : null}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className={styles.editorColumn}>
        {selected && member ? (
          <NoteEditor
            key={selected.id}
            note={selected}
            viewer={{ memberId: member.id, role: member.role }}
            linkOptions={linkOptions}
            autoFocus={selected.id === createdId}
            onClose={() => select(null)}
            onDeleted={() => select(null)}
          />
        ) : selectedId && !notesQuery.isLoading && !notesQuery.isError ? (
          <EmptyState title="Note introuvable" text="Elle a été supprimée, ou elle n’est pas partagée avec toi." />
        ) : notes.length > 0 ? (
          <div className={styles.placeholder}>
            <EmptyState title="Choisis une note" text="Ou crée-en une : elle s’enregistre toute seule pendant que tu écris." />
          </div>
        ) : null}
      </div>
    </div>
  )
}
