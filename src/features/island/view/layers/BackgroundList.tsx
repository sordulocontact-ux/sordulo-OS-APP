/**
 * Lignes « aussi en cours » sous l'appel (meetOpen) et sous la musique (musicOpen) : un bouton par ligne, comme
 * les lignes de la vue « plusieurs sessions ». Session → sa fenêtre VS Code (ou sa demande si elle attend une
 * réponse) ; Musique, progression → affichée dans l'île ; « N autres activités » → la liste se déplie sur place.
 * Dépliée, l'île grandit jusqu'à MEET_BACKGROUND.maxExpandedRows lignes (islandSize), la liste défile au-delà.
 */
import { useLayoutEffect, useRef } from 'react'
import { MEET_BACKGROUND } from '../../geometry'
import type { IslandPlatform } from '../../types'
import { cx } from '../cx'
import styles from '../Island.module.css'
import { backgroundRowLabel, type BackgroundRow } from '../labels'
import { ROW_TONE_CLASS } from './rowTone'

export function BackgroundList({
  rows,
  platform,
  label,
  onSelectRow,
}: {
  rows: readonly BackgroundRow[]
  platform: IslandPlatform
  /** Nom accessible de la liste. */
  label: string
  onSelectRow: (row: BackgroundRow) => void
}) {
  const listRef = useRef<HTMLUListElement>(null)
  // Ligne « N autres activités » cliquée : le focus passe à la première ligne qu'elle cachait (le bouton cliqué
  // disparaît ; sans ça, le focus tomberait hors de l'île et la laisserait ouverte).
  const focusIndex = useRef<number | null>(null)
  useLayoutEffect(() => {
    const index = focusIndex.current
    if (index === null) return
    const row = rows[index]
    if (!row || row.target?.type === 'more') return
    focusIndex.current = null
    const button = listRef.current?.children[index]?.querySelector('button')
    button?.focus({ preventScroll: true })
  }, [rows])

  if (rows.length === 0) return null
  const maxHeight = MEET_BACKGROUND.maxExpandedRows * MEET_BACKGROUND[platform].rowH
  return (
    <div className={styles.meetBackground}>
      <ul ref={listRef} className={styles.backgroundList} aria-label={label} style={{ maxHeight }}>
        {rows.map((row, index) => {
          const content = (
            <>
              <b>{row.title}</b>
              <span className={styles.task}>{row.detail}</span>
              {row.status && <span className={cx(styles.st, ROW_TONE_CLASS[row.tone])}>{row.status}</span>}
            </>
          )
          const more = row.target?.type === 'more'
          return (
            <li key={row.id} className={cx(styles.row, styles.meetBackgroundRow)}>
              {row.target ? (
                <button
                  type="button"
                  className={styles.rowOpen}
                  aria-label={backgroundRowLabel(row) ?? undefined}
                  aria-expanded={more ? false : undefined}
                  onClick={() => {
                    if (more) focusIndex.current = index
                    onSelectRow(row)
                  }}
                >
                  {content}
                </button>
              ) : (
                content
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
