import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MEET_BACKGROUND } from '../../geometry'
import type { ClaudeSession } from '../../types'
import { backgroundRows } from '../labels'
import { BackgroundList } from './BackgroundList'

const session = (id: string, status: ClaudeSession['status']): ClaudeSession => ({
  id,
  projectName: `Projet ${id}`,
  projectId: null,
  cwd: `C:/${id}`,
  branch: null,
  task: null,
  step: `Étape ${id}`,
  status,
  startedAt: 0,
  conflict: false,
  error: false,
  subagents: 0,
})

const multi = { id: 'multi', kind: 'multi', order: 1 } as const
const deploy = {
  id: 'prog:deploy',
  kind: 'progress',
  stage: 'deploy',
  label: 'sordulo-OS-APP',
  fraction: null,
  startedAt: 0,
  estimatedMs: 1000,
  order: 2,
} as const

function render(rows: ReturnType<typeof backgroundRows>, platform: 'win' | 'mac' = 'win'): string {
  return renderToStaticMarkup(createElement(BackgroundList, { rows, platform, label: 'Aussi en cours', onSelectRow: () => {} }))
}

const count = (html: string, needle: string) => html.split(needle).length - 1

describe('BackgroundList', () => {
  const sessions = ['a', 'b', 'c', 'd', 'e'].map((id, i) => session(id, i === 2 ? 'waiting' : 'working'))

  it('chaque ligne est un bouton avec un nom accessible, « N autres activités » compris', () => {
    const html = render(backgroundRows([multi], sessions))
    expect(count(html, '<button')).toBe(MEET_BACKGROUND.maxRows)
    expect(html).toContain('aria-label="Ouvrir Projet a dans son éditeur (En cours)"')
    expect(html).toContain('aria-label="Afficher les 3 autres activités"')
    expect(html).toContain('aria-expanded="false"')
  })

  it('dépliée : toutes les lignes cliquables, la session en attente propose de répondre', () => {
    const html = render(backgroundRows([deploy, multi], sessions, null, { expanded: true }), 'mac')
    expect(count(html, '<li')).toBe(6)
    expect(count(html, '<button')).toBe(6)
    expect(html).toContain('aria-label="Répondre à la session Projet c (Attend ta réponse)"')
    expect(html).toContain('aria-label="Afficher sordulo-OS-APP dans l’île (En cours)"')
    expect(html).not.toContain('aria-expanded')
    // La liste défile au-delà du plafond : hauteur maximale de maxExpandedRows lignes.
    expect(html).toContain(`max-height:${MEET_BACKGROUND.maxExpandedRows * MEET_BACKGROUND.mac.rowH}px`)
  })

  it('pendant un appel, une progression reste une ligne d’information (pas de bouton)', () => {
    const html = render(backgroundRows([deploy], [], null, { duringCall: true }))
    expect(count(html, '<li')).toBe(1)
    expect(count(html, '<button')).toBe(0)
  })

  it('aucune ligne : rien', () => {
    expect(render([])).toBe('')
  })
})
