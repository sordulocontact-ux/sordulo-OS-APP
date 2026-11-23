/**
 * Couches de l'appel : proposition « Transcrire cet appel ? » (appel) et enregistrement (meet, meetOpen).
 * L'icône, l'onde et le minuteur de l'enregistrement sont des éléments partagés (SharedElements).
 */
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { islandSize } from '../../geometry'
import type { IslandEdge, IslandPlatform, IslandState, MeetActivity } from '../../types'
import { useLastNonNull } from '../hooks'
import { CallIcon } from '../icons'
import styles from '../Island.module.css'
import { Layer } from '../Layer'
import { cx } from '../cx'
import type { BackgroundRow } from '../labels'
import { ROW_TONE_CLASS } from './rowTone'
import type { IslandCallPrompt, IslandProjectOption } from '../types'

export interface BaseLayerProps {
  current: IslandState
  platform: IslandPlatform
  /** Bord de l'écran ('top' par défaut). */
  edge?: IslandEdge
  withCall: boolean
}

/**
 * Choix du projet, dessiné dans la forme noire : la liste native d'un <select> s'ouvrirait dans une fenêtre
 * à part, hors des zones cliquables de l'île. Ouverte, la liste recouvre la couche (même marges) et défile.
 * Clavier : Entrée, Espace ou flèches ouvrent ; flèches, Début, Fin parcourent ; Entrée ou Espace choisit ;
 * Échap ou Tab referme sans choisir (Échap ne ferme pas la proposition).
 */
function ProjectPicker({
  projects,
  selectedId,
  active,
  onChange,
}: {
  projects: readonly IslandProjectOption[]
  selectedId: string
  /** La couche est affichée : sinon la liste se referme. */
  active: boolean
  onChange: (projectId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const baseId = useId()
  const shownOpen = open && active && projects.length > 0
  const selected = projects.find((p) => p.id === selectedId) ?? null
  const optionId = (index: number) => `${baseId}-option-${index}`

  // Liste ouverte : focus sur la liste et option en vue. Refermée par un geste : focus rendu au bouton.
  const wasOpen = useRef(false)
  useLayoutEffect(() => {
    const list = listRef.current
    if (shownOpen && list) {
      if (!wasOpen.current) list.focus({ preventScroll: true })
      // Défilement de la liste seule (scrollIntoView ferait aussi défiler la forme, qui masque son contenu).
      const item = list.children[highlight]
      if (item instanceof HTMLElement) {
        if (item.offsetTop < list.scrollTop) list.scrollTop = item.offsetTop
        else if (item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight) {
          list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight
        }
      }
    } else if (wasOpen.current && active) {
      triggerRef.current?.focus({ preventScroll: true })
    }
    wasOpen.current = shownOpen
  })

  function openList() {
    if (projects.length === 0) return
    setHighlight(Math.max(0, projects.findIndex((p) => p.id === selectedId)))
    setOpen(true)
  }

  function choose(index: number) {
    const project = projects[index]
    if (project) onChange(project.id)
    setOpen(false)
  }

  function onTriggerKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      openList()
    }
  }

  function onListKeyDown(e: KeyboardEvent<HTMLUListElement>) {
    const last = projects.length - 1
    switch (e.key) {
      case 'ArrowDown':
        setHighlight((h) => Math.min(last, h + 1))
        break
      case 'ArrowUp':
        setHighlight((h) => Math.max(0, h - 1))
        break
      case 'Home':
        setHighlight(0)
        break
      case 'End':
        setHighlight(last)
        break
      case 'Enter':
      case ' ':
        choose(highlight)
        break
      case 'Escape':
        // La liste se referme ; la proposition d'appel reste (Échap sur l'île = Ignorer).
        e.stopPropagation()
        setOpen(false)
        break
      case 'Tab':
        setOpen(false)
        return
      default:
        return
    }
    e.preventDefault()
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={styles.pickerTrigger}
        aria-haspopup="listbox"
        aria-expanded={shownOpen}
        aria-label={selected ? `Projet : ${selected.name}` : 'Projet'}
        disabled={projects.length === 0}
        onClick={() => (shownOpen ? setOpen(false) : openList())}
        onKeyDown={onTriggerKeyDown}
      >
        <span className={styles.pickerValue}>{selected?.name ?? 'Aucun projet'}</span>
        <svg className={cx(styles.ico, styles.pickerChevron)} viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 10l5 5 5-5" />
        </svg>
      </button>
      <div className={cx(styles.pickerPanel, shownOpen && styles.on)} inert={!shownOpen}>
        <ul
          ref={listRef}
          className={styles.pickerList}
          role="listbox"
          aria-label="Projet de l’appel"
          tabIndex={-1}
          aria-activedescendant={shownOpen ? optionId(highlight) : undefined}
          onKeyDown={onListKeyDown}
        >
          {projects.map((p, index) => (
            <li
              key={p.id}
              id={optionId(index)}
              role="option"
              aria-selected={p.id === selectedId}
              className={cx(
                styles.pickerOption,
                index === highlight && styles.pickerOptionActive,
                p.id === selectedId && styles.pickerOptionSelected,
              )}
              onPointerEnter={() => setHighlight(index)}
              onClick={() => choose(index)}
            >
              <span className={styles.pickerValue}>{p.name}</span>
              {p.id === selectedId && (
                <svg className={cx(styles.ico, styles.pickerCheck)} viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 12.5l4 4 8-9" />
                </svg>
              )}
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}

/**
 * Proposition d'enregistrement. `call.appName` vide : enregistrement lancé à la main (menu du soleil, bouton
 * du header) → « Enregistrer un appel », sans nom d'app, et « Annuler » au lieu de « Ignorer ».
 */
export function AppelLayer({
  call,
  onCallAccept,
  onCallIgnore,
  onProjectChange,
  ...base
}: BaseLayerProps & {
  call: IslandCallPrompt | null
  onCallAccept: (projectId: string | null) => void
  onCallIgnore: () => void
  onProjectChange: (projectId: string) => void
}) {
  const shown = useLastNonNull(call)
  const projects = shown?.projects ?? []
  const selected = shown?.selectedProjectId ?? projects[0]?.id ?? ''
  const manual = shown?.appName === ''
  return (
    <Layer
      {...base}
      state="appel"
      className={styles.layerAppel}
      role="dialog"
      label={manual ? 'Enregistrer un appel' : 'Appel détecté'}
    >
      <div className={styles.head}>
        <CallIcon className={styles.appelIcon} service={manual ? null : (shown?.service ?? null)} />
        <div>
          {manual ? (
            <>
              <small>Choisis le projet de l’appel</small>
              <strong>Enregistrer un appel</strong>
            </>
          ) : (
            <>
              <small>Appel détecté dans {shown?.appName ?? 'une app d’appel'}</small>
              <strong>Transcrire cet appel&nbsp;?</strong>
            </>
          )}
        </div>
      </div>
      <div className={styles.appelRow}>
        <ProjectPicker
          projects={projects}
          selectedId={selected}
          active={base.current === 'appel'}
          onChange={onProjectChange}
        />
        <button type="button" className={cx(styles.btn, styles.btnGhost)} onClick={onCallIgnore}>
          {manual ? 'Annuler' : 'Ignorer'}
        </button>
        <button
          type="button"
          className={cx(styles.btn, styles.btnMain)}
          onClick={() => onCallAccept(selected || null)}
          disabled={!selected}
        >
          Transcrire
        </button>
      </div>
    </Layer>
  )
}

/**
 * Enregistrement. Au repos : icône + onde à gauche, minuteur à droite (éléments partagés). Pas de bulle
 * pendant l'enregistrement.
 * Au survol (meetOpen, absent du prototype, composé comme agentOpen) : app, projet, bouton « Arrêter », puis
 * ce qui tourne aussi (sessions Claude, progressions), une ligne chacun comme dans multiOpen.
 */
export function MeetLayer({
  meet,
  rows,
  open,
  onStopRecording,
  ...base
}: BaseLayerProps & {
  meet: MeetActivity | null
  rows: readonly BackgroundRow[]
  open: boolean
  onStopRecording: () => void
}) {
  const shown = useLastNonNull(meet)
  const app = shown?.appName ?? 'l’app d’appel'
  const height = islandSize(base.platform, 'meetOpen', rows.length).h
  return (
    <Layer {...base} state="meet" open={open} label={`Appel ${app} en cours de transcription`} style={{ height }}>
      <div className={styles.detail}>
        <div className={cx(styles.headText, styles.headTextPlain)}>
          <strong>Enregistrement en cours</strong>
          <small>
            {app}, {shown?.projectName ?? 'sans projet'}
          </small>
        </div>
        <div className={styles.meetRow}>
          <button
            type="button"
            className={cx(styles.btn, styles.btnMain, styles.btnSm)}
            onClick={onStopRecording}
            aria-label="Arrêter l’enregistrement"
          >
            Arrêter
          </button>
        </div>
        {rows.length > 0 && (
          <ul className={styles.meetBackground} aria-label="Aussi en cours">
            {rows.map((row) => (
              <li key={row.id} className={cx(styles.row, styles.meetBackgroundRow)}>
                <b>{row.title}</b>
                <span className={styles.task}>{row.detail}</span>
                {row.status && <span className={cx(styles.st, ROW_TONE_CLASS[row.tone])}>{row.status}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Layer>
  )
}
