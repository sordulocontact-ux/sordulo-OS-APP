import { describe, expect, it } from 'vitest'
import { createNotification } from '../catalog'
import type { IslandChoice, PermissionAsk } from '../types'
import { ASK_IDLE_MS, CHOICE_IDLE_MS, IslandCoordinator, NEXT_IN_QUEUE_DELAY_MS, type ActivityInput } from './coordinator'
import { digestTexts } from './digest'
import { FakeClock } from './fakeClock'
import { sortActivities } from './ranking'

function setup(focusMode = false) {
  const clock = new FakeClock(0)
  const island = new IslandCoordinator({ clock, focusMode })
  return { clock, island, snap: () => island.getSnapshot() }
}

const meet: ActivityInput = { id: 'meet', kind: 'meet', appName: 'Discord', service: null, projectId: null, projectName: null, startedAt: 0 }
const agent: ActivityInput = { id: 'agent', kind: 'agent', sessionId: 's-1' }
const multi: ActivityInput = { id: 'multi', kind: 'multi' }
const music: ActivityInput = { id: 'music', kind: 'music' }
const upload: ActivityInput = {
  id: 'prog:upload',
  kind: 'progress',
  stage: 'upload',
  label: "Import de l'audio",
  fraction: null,
  startedAt: 0,
  estimatedMs: 3000,
}
/** Progression prévue (déploiement) : n'est pas exclusive, la bulle reste possible. */
const deploy: ActivityInput = { ...upload, id: 'prog:deploy', stage: 'deploy', label: 'Déploiement en cours' }

let n = 0
function note(title = `Note ${++n}`) {
  return createNotification('digest', { title, subtitle: '' })
}
function plain(projectName = 'PDS OS') {
  return createNotification('claudeDone', { projectName, detail: '4 fichiers modifiés' })
}
function rappel() {
  return createNotification('rappel', { meetingTitle: 'Call Ibé', minutes: 5, appName: 'Meet', url: 'https://x' })
}
function ask(id: string): PermissionAsk {
  return { id, sessionId: 's', toolName: 'Bash', summary: 'ls', title: 'Lancer une commande', receivedAt: 0, expiresAt: 60_000, questions: null }
}

describe('activités', () => {
  it('trie appel, progression, Claude, musique, puis la plus récente à rang égal', () => {
    const { island, snap } = setup()
    island.addActivity(music)
    island.addActivity(agent)
    island.addActivity(upload)
    island.addActivity(meet)
    expect(snap()).toMatchObject({ state: 'meet', activityCount: 4, secondary: null })
    // Pendant l'appel, pas de bulle : le reste passe sous l'appel, dans l'ordre.
    expect(snap().background.map((a) => a.id)).toEqual(['prog:upload', 'agent', 'music'])
    island.removeActivity('meet')
    island.removeActivity('prog:upload')
    island.addActivity(multi)
    // Une musique existe et rien n'est épinglé : elle prend l'île devant Claude, qui passe dans background.
    expect(snap().primary?.id).toBe('music')
    expect(snap().secondary).toBeNull()
    expect(snap().background.map((a) => a.id)).toEqual(['multi', 'agent'])
    island.removeActivity('music')
    expect(snap().primary?.id).toBe('multi')
    expect(snap().background.map((a) => a.id)).toEqual(['agent'])
  })

  it('jamais de bulle : toutes les autres activités vont dans background, dans l’ordre', () => {
    const { island, snap } = setup()
    island.addActivity(music)
    island.addActivity(deploy)
    island.addActivity(agent)
    expect(snap()).toMatchObject({ state: 'progress', secondary: null, activityCount: 3 })
    expect(snap().background.map((a) => a.id)).toEqual(['agent', 'music'])
  })

  it('musique + session Claude : la musique est la principale, Claude dans background, pas de bulle', () => {
    const { island, snap } = setup()
    island.addActivity(agent)
    island.addActivity(music)
    expect(snap()).toMatchObject({ state: 'music', secondary: null, pinnedId: null })
    expect(snap().primary?.id).toBe('music')
    expect(snap().background.map((a) => a.id)).toEqual(['agent'])
    island.addActivity(multi)
    expect(snap().primary?.id).toBe('music')
    expect(snap().secondary).toBeNull()
    expect(snap().background.map((a) => a.id)).toEqual(['multi', 'agent'])
  })

  it('Claude épinglé : Claude reste la principale devant la musique', () => {
    const { island, snap } = setup()
    island.addActivity(agent)
    island.addActivity(music)
    expect(island.pin('agent')).toBe(true)
    expect(snap()).toMatchObject({ state: 'agent', pinnedId: 'agent', secondary: null })
    expect(snap().background.map((a) => a.id)).toEqual(['music'])
  })

  it('pin : refuse un id inconnu et pendant une activité exclusive', () => {
    const { island, snap } = setup()
    island.addActivity(agent)
    expect(island.pin('inconnue')).toBe(false)
    island.addActivity(upload)
    expect(island.pin('agent')).toBe(false)
    expect(snap().pinnedId).toBeNull()
    island.removeActivity('prog:upload')
    island.addActivity(meet)
    expect(island.pin('agent')).toBe(false)
  })

  it('remplace une activité de même id, qui devient la plus récente', () => {
    const { island, snap } = setup()
    island.addActivity(agent)
    island.addActivity(multi)
    expect(snap().primary?.id).toBe('multi')
    island.addActivity({ ...agent, sessionId: 's-2' })
    expect(snap().activityCount).toBe(2)
    expect(snap().primary).toMatchObject({ id: 'agent', sessionId: 's-2' })
  })

  it('met à jour partiellement sans changer l’ordre', () => {
    const { island, snap } = setup()
    const added = island.addActivity(upload)
    const updated = island.updateActivity('prog:upload', { fraction: 0.5, label: 'Import' })
    expect(updated).toMatchObject({ id: 'prog:upload', kind: 'progress', fraction: 0.5, label: 'Import', order: added.order })
    expect(snap().primary).toBe(updated)
    expect(island.updateActivity('inconnue', { fraction: 1 })).toBeNull()
    expect(island.removeActivity('inconnue')).toBe(false)
  })

  it('épingle la suivante, qui passe devant, puis la désépingle quand elle est retirée', () => {
    const { island, snap } = setup()
    island.addActivity(agent)
    island.addActivity(music)
    expect(island.pinSecondary()).toBe('music')
    expect(snap()).toMatchObject({ state: 'music', pinnedId: 'music', secondary: null })
    expect(snap().background.map((a) => a.id)).toEqual(['agent'])
    island.addActivity(deploy)
    expect(snap().primary?.id).toBe('music')
    expect(snap().background.map((a) => a.id)).toEqual(['prog:deploy', 'agent'])
    island.removeActivity('music')
    expect(snap()).toMatchObject({ state: 'progress', pinnedId: null, secondary: null })
    expect(snap().background.map((a) => a.id)).toEqual(['agent'])
  })

  it('import ou analyse : seule dans l’île, devant l’épinglée, sans bulle', () => {
    const { island, snap } = setup()
    island.addActivity(agent)
    island.addActivity(music)
    expect(island.pinSecondary()).toBe('music')
    island.addActivity(upload)
    expect(snap()).toMatchObject({ state: 'progress', secondary: null, pinnedId: 'music' })
    expect(snap().background.map((a) => a.id)).toEqual(['music', 'agent'])
    expect(island.pinSecondary()).toBeNull()
    island.removeActivity('prog:upload')
    expect(snap()).toMatchObject({ state: 'music', secondary: null })
    expect(snap().background.map((a) => a.id)).toEqual(['agent'])
  })

  it('pendant un appel : l’appel passe devant l’épinglée, sans bulle, et l’épingle revient après', () => {
    const { island, snap } = setup()
    island.addActivity(agent)
    island.addActivity(music)
    expect(island.pinSecondary()).toBe('music')
    island.addActivity(meet)
    expect(snap()).toMatchObject({ state: 'meet', secondary: null, pinnedId: 'music' })
    expect(snap().background.map((a) => a.id)).toEqual(['music', 'agent'])
    expect(island.pinSecondary()).toBeNull()
    island.endMeet()
    expect(snap()).toMatchObject({ state: 'music', secondary: null })
    expect(snap().background.map((a) => a.id)).toEqual(['agent'])
  })

  it('n’épingle rien sans bulle', () => {
    const { island, snap } = setup()
    island.addActivity(meet)
    expect(island.pinSecondary()).toBeNull()
    expect(snap().pinnedId).toBeNull()
  })

  it('trie aussi hors de la coordination', () => {
    const list = [
      { ...music, order: 1 },
      { ...agent, order: 2 },
      { ...multi, order: 3 },
    ]
    expect(sortActivities(list, null).map((a) => a.id)).toEqual(['multi', 'agent', 'music'])
    expect(sortActivities(list, 'music').map((a) => a.id)).toEqual(['music', 'multi', 'agent'])
  })
})

describe('notifications', () => {
  it('affiche une notification le temps de sa durée, puis la suivante 450 ms après', () => {
    const { clock, island, snap } = setup()
    island.addActivity(agent)
    const a = plain()
    const b = plain()
    island.notify(a)
    island.notify(b)
    expect(snap().notification?.id).toBe(a.id)
    clock.advanceTo(4500)
    expect(snap()).toMatchObject({ state: 'agent', notification: null })
    clock.advanceTo(4949)
    expect(snap().state).toBe('agent')
    clock.advanceTo(4950)
    expect(snap().notification?.id).toBe(b.id)
  })

  it('met en pause le temps restant au survol et le reprend à la sortie', () => {
    const { clock, island, snap } = setup()
    island.notify(plain())
    clock.advanceTo(1000)
    island.setHover(true)
    clock.advanceTo(20_000)
    expect(snap().state).toBe('notif')
    island.setHover(false)
    clock.advance(3499)
    expect(snap().state).toBe('notif')
    clock.advance(1)
    expect(snap().state).toBe('repos')
  })

  it('laisse au moins 300 ms à la sortie du survol', () => {
    const { clock, island, snap } = setup()
    island.notify(plain())
    clock.advanceTo(4400)
    island.setHover(true)
    clock.advanceTo(9000)
    island.setHover(false)
    clock.advance(299)
    expect(snap().state).toBe('notif')
    clock.advance(1)
    expect(snap().state).toBe('repos')
  })

  it('ne lance pas le minuteur d’une notification apparue sous le curseur', () => {
    const { clock, island, snap } = setup()
    island.setHover(true)
    island.notify(plain())
    clock.advanceTo(30_000)
    expect(snap().state).toBe('notif')
    island.setHover(false)
    clock.advance(4499)
    expect(snap().state).toBe('notif')
    clock.advance(1)
    expect(snap().state).toBe('repos')
  })

  it('fait passer les interruptions devant', () => {
    const { clock, island, snap } = setup()
    const first = plain()
    const second = plain()
    const urgent = rappel()
    island.notify(first)
    island.notify(second)
    island.notify(urgent)
    clock.advanceTo(4950)
    expect(snap().notification?.id).toBe(urgent.id)
    clock.advanceTo(4950 + 7000 + 450)
    expect(snap().notification?.id).toBe(second.id)
  })

  it('regroupe au-delà de deux notifications en attente', () => {
    const { clock, island, snap } = setup()
    island.showOverlay('appel')
    const notes = [note('Un'), note('Deux'), note('Trois'), note('Quatre')]
    notes.forEach((x) => island.notify(x))
    island.hideOverlay()
    clock.advance(450)
    expect(snap().notification).toMatchObject({ kind: 'digest', title: '4 nouveautés', subtitle: 'Un, Deux et 2 autres' })
    clock.advance(6000 + 450)
    expect(snap()).toMatchObject({ state: 'repos', notification: null })
  })

  it('ne regroupe pas deux notifications', () => {
    const { clock, island, snap } = setup()
    island.showOverlay('dragWake')
    const a = plain()
    const b = plain()
    island.notify(a)
    island.notify(b)
    island.hideOverlay()
    clock.advance(450)
    expect(snap().notification?.id).toBe(a.id)
  })

  it('reprend les titres d’un regroupement déjà en file', () => {
    const { clock, island, snap } = setup(true)
    island.addActivity(meet)
    island.notify(note('A'))
    island.notify(note('B'))
    island.showOverlay('appel')
    island.endMeet()
    island.notify(note('C'))
    island.notify(note('D'))
    island.hideOverlay()
    clock.advance(450)
    expect(snap().notification).toMatchObject({ title: '4 nouveautés', subtitle: 'A, B et 2 autres' })
  })

  it('termine la notification affichée, ou la retire de la file', () => {
    const { clock, island, snap } = setup()
    const a = plain()
    const b = plain()
    const c = plain()
    island.notify(a)
    island.notify(b)
    island.notify(c)
    island.endNotification(b.id)
    island.endNotification('autre')
    expect(snap().notification?.id).toBe(a.id)
    island.endNotification()
    expect(snap().state).toBe('repos')
    clock.advance(450)
    expect(snap().notification?.id).toBe(c.id)
  })

  it('ignore une notification déjà en file', () => {
    const { clock, island, snap } = setup()
    const a = plain()
    island.notify(a)
    island.notify(a)
    clock.advanceTo(4950)
    expect(snap().state).toBe('repos')
  })

  it('signale l’appel en cours sous une notification (withCall)', () => {
    const { island, snap } = setup()
    island.addActivity(meet)
    expect(snap().withCall).toBe(false)
    island.notify(plain())
    expect(snap()).toMatchObject({ state: 'notif', withCall: true, focusMode: false })
  })

  it('en mode concentration, laisse passer les interruptions pendant l’appel', () => {
    const { island, snap } = setup(true)
    island.addActivity(meet)
    island.notify(plain())
    expect(snap().state).toBe('meet')
    const urgent = rappel()
    island.notify(urgent)
    expect(snap().notification?.id).toBe(urgent.id)
  })

  it('libère les notifications mises de côté si l’appel est retiré directement', () => {
    const { island, snap } = setup(true)
    island.addActivity(meet)
    island.notify(plain())
    island.removeActivity('meet')
    expect(snap().notification).toMatchObject({ kind: 'digest', title: "Pendant l'appel : 1 notification" })
  })

  it('sans rien de côté, la fin d’appel ne montre rien', () => {
    const { island, snap } = setup(true)
    island.addActivity(meet)
    island.endMeet()
    expect(snap()).toMatchObject({ state: 'repos', notification: null })
  })
})

describe('demandes d’autorisation', () => {
  it('met de côté la demande affichée après 10 s sans le curseur sur l’île', () => {
    const { clock, island, snap } = setup()
    island.addActivity(multi)
    island.requestAsk(ask('a1'))
    expect(snap().state).toBe('agentAsk')
    clock.advance(ASK_IDLE_MS - 1)
    expect(snap().state).toBe('agentAsk')
    clock.advance(1)
    expect(snap()).toMatchObject({ state: 'multi', ask: null })
    // La source la garde ouverte : « Répondre » la remontre.
    island.requestAsk(ask('a1'))
    clock.advance(NEXT_IN_QUEUE_DELAY_MS)
    expect(snap().ask?.id).toBe('a1')
  })

  it('garde la demande tant que le curseur est sur l’île, puis relance les 10 s à sa sortie', () => {
    const { clock, island, snap } = setup()
    island.addActivity(agent)
    island.requestAsk(ask('a1'))
    clock.advance(5000)
    island.setHover(true)
    clock.advance(60_000)
    expect(snap().state).toBe('agentAsk')
    island.setHover(false)
    clock.advance(ASK_IDLE_MS - 1)
    expect(snap().state).toBe('agentAsk')
    clock.advance(1)
    expect(snap()).toMatchObject({ state: 'agent', ask: null })
  })

  it('retire de la file une demande résolue avant son affichage', () => {
    const { clock, island, snap } = setup()
    island.addActivity(agent)
    island.requestAsk(ask('a1'))
    island.requestAsk(ask('a2'))
    expect(snap()).toMatchObject({ state: 'agentAsk', askPosition: { index: 1, total: 2 } })
    expect(island.resolveAsk('a2')).toBe(true)
    expect(snap()).toMatchObject({ state: 'agentAsk', askPosition: null })
    expect(snap().ask?.id).toBe('a1')
    expect(island.resolveAsk('a1')).toBe(true)
    expect(snap()).toMatchObject({ state: 'agent', ask: null })
    clock.advance(1000)
    expect(snap().state).toBe('agent')
    expect(island.resolveAsk('a1')).toBe(false)
  })

  it('enchaîne les demandes 450 ms après la décision', () => {
    const { clock, island, snap } = setup()
    island.requestAsk(ask('a1'))
    island.requestAsk(ask('a1'))
    island.requestAsk(ask('a2'))
    expect(snap().askPosition).toEqual({ index: 1, total: 2 })
    island.resolveAsk('a1')
    clock.advance(449)
    expect(snap().state).toBe('repos')
    clock.advance(1)
    expect(snap()).toMatchObject({ state: 'agentAsk', askPosition: null })
    expect(snap().ask?.id).toBe('a2')
  })

  it('passe devant les notifications en file et signale l’appel', () => {
    const { island, snap } = setup()
    island.addActivity(meet)
    island.notify(plain())
    island.requestAsk(ask('a1'))
    expect(snap().state).toBe('notif')
    island.endNotification()
    island.notify(plain())
    expect(snap()).toMatchObject({ state: 'agentAsk', withCall: true })
  })
})

function choice(id: string): IslandChoice {
  return { id, icon: 'folder', tone: 'info', eyebrow: 'Classé par l’IA', title: 'Devis D-1', always: null, secondary: 'Modifier', primary: 'Ranger' }
}

describe('décisions', () => {
  it('passe avant les notifications en file, n’est jamais regroupée, se ferme à la décision', () => {
    const { clock, island, snap } = setup()
    island.addActivity(music)
    island.showOverlay('dragOver')
    island.notify(note())
    island.notify(note())
    island.notify(note())
    island.requestChoice(choice('c1'))
    island.hideOverlay()
    clock.advance(NEXT_IN_QUEUE_DELAY_MS)
    expect(snap()).toMatchObject({ state: 'choice', notification: null })
    expect(snap().choice?.id).toBe('c1')
    // Même id : ignorée.
    island.requestChoice(choice('c1'))
    expect(island.hasChoice('c1')).toBe(true)
    expect(island.resolveChoice('c1')).toBe(true)
    expect(snap()).toMatchObject({ state: 'music', choice: null })
    expect(island.hasChoice('c1')).toBe(false)
    clock.advance(NEXT_IN_QUEUE_DELAY_MS)
    expect(snap().notification?.kind).toBe('digest')
  })

  it('mise de côté sans le curseur sur l’île : retour à la principale et onSetAside', () => {
    const { clock, island, snap } = setup()
    island.addActivity(agent)
    let setAside = 0
    island.requestChoice(choice('c1'), { onSetAside: () => setAside++ })
    clock.advance(5000)
    island.setHover(true)
    clock.advance(60_000)
    expect(snap().state).toBe('choice')
    island.setHover(false)
    clock.advance(CHOICE_IDLE_MS - 1)
    expect(setAside).toBe(0)
    clock.advance(1)
    expect(snap()).toMatchObject({ state: 'agent', choice: null })
    expect(setAside).toBe(1)
    expect(island.resolveChoice('c1')).toBe(false)
  })

  it('retire de la file une décision résolue avant son affichage ; un overlay la remet en tête', () => {
    const { clock, island, snap } = setup()
    island.requestChoice(choice('c1'))
    island.requestChoice(choice('c2'))
    expect(island.resolveChoice('c2')).toBe(true)
    island.showOverlay('dragWake')
    expect(snap()).toMatchObject({ state: 'dragWake', choice: null })
    island.hideOverlay()
    clock.advance(NEXT_IN_QUEUE_DELAY_MS)
    expect(snap().choice?.id).toBe('c1')
    island.resolveChoice('c1')
    clock.advance(NEXT_IN_QUEUE_DELAY_MS)
    expect(snap().state).toBe('repos')
  })
})

describe('overlays du contrôleur', () => {
  it('retient la file tant que l’overlay est affiché', () => {
    const { clock, island, snap } = setup()
    island.addActivity(music)
    island.showOverlay('dragWake')
    const a = plain()
    island.notify(a)
    clock.advance(10_000)
    expect(snap()).toMatchObject({ state: 'dragWake', notification: null })
    island.showOverlay('dragOver')
    island.hideOverlay('dragWake')
    expect(snap().state).toBe('dragOver')
    island.hideOverlay()
    expect(snap().state).toBe('music')
    clock.advance(449)
    expect(snap().state).toBe('music')
    clock.advance(1)
    expect(snap().notification?.id).toBe(a.id)
  })

  it('remet en tête de file la notification ou la demande qu’il recouvre', () => {
    const { clock, island, snap } = setup()
    const a = plain()
    island.notify(a)
    clock.advance(4000)
    island.showOverlay('appel')
    clock.advance(10_000)
    expect(snap().state).toBe('appel')
    island.addActivity(meet)
    island.hideOverlay('appel')
    expect(snap().state).toBe('meet')
    clock.advance(450)
    expect(snap().notification?.id).toBe(a.id)
    clock.advance(4499)
    expect(snap().state).toBe('notif')

    island.endNotification()
    island.requestAsk(ask('a1'))
    island.showOverlay('dragWake')
    island.hideOverlay()
    clock.advance(450)
    expect(snap().ask?.id).toBe('a1')
  })
})

describe('overlay review (validation dans l’île)', () => {
  it('fait attendre les notifications ordinaires jusqu’à sa fermeture', () => {
    const { clock, island, snap } = setup()
    island.showOverlay('review')
    const a = plain()
    island.notify(a)
    clock.advance(20_000)
    expect(snap()).toMatchObject({ state: 'review', notification: null })
    island.hideOverlay('review')
    clock.advance(450)
    expect(snap().notification?.id).toBe(a.id)
  })

  it('laisse passer une interruption puis revient à review', () => {
    const { clock, island, snap } = setup()
    island.showOverlay('review')
    island.notify(plain())
    const urgent = rappel()
    island.notify(urgent)
    expect(snap().notification?.id).toBe(urgent.id)
    island.endNotification(urgent.id)
    expect(snap()).toMatchObject({ state: 'review', notification: null })
    clock.advance(10_000)
    // La notification ordinaire attend toujours la fin de review.
    expect(snap().state).toBe('review')
  })

  it('revient à review après une demande d’autorisation mise de côté', () => {
    const { clock, island, snap } = setup()
    island.showOverlay('review')
    island.requestAsk(ask('r1'))
    expect(snap().state).toBe('agentAsk')
    clock.advance(ASK_IDLE_MS)
    expect(snap().state).toBe('review')
  })

  it('revient à review après un autre overlay', () => {
    const { island, snap } = setup()
    island.showOverlay('review')
    island.showOverlay('dragWake')
    island.showOverlay('dragOver')
    expect(snap().state).toBe('dragOver')
    island.hideOverlay()
    expect(snap().state).toBe('review')
    island.showOverlay('appel')
    island.hideOverlay('appel')
    expect(snap().state).toBe('review')
  })

  it('hideOverlay(review) la retire même mise de côté', () => {
    const { clock, island, snap } = setup()
    island.addActivity(music)
    island.showOverlay('review')
    const urgent = rappel()
    island.notify(urgent)
    island.hideOverlay('review')
    expect(snap().notification?.id).toBe(urgent.id)
    island.endNotification(urgent.id)
    expect(snap().state).toBe('music')
    clock.advance(1000)
    expect(snap().state).toBe('music')
  })
})

describe('instantané', () => {
  it('garde son identité sans changement et en change à chaque changement', () => {
    const { island } = setup()
    let calls = 0
    const unsubscribe = island.subscribe(() => {
      calls += 1
    })
    const first = island.getSnapshot()
    expect(Object.isFrozen(first)).toBe(true)
    island.setHover(true)
    island.setFocusMode(false)
    expect(island.getSnapshot()).toBe(first)
    expect(calls).toBe(0)

    island.addActivity(agent)
    const second = island.getSnapshot()
    expect(second).not.toBe(first)
    expect(calls).toBe(1)
    expect(first.primary).toBeNull()

    unsubscribe()
    island.addActivity(music)
    expect(calls).toBe(1)
    expect(island.getSnapshot()).not.toBe(second)
  })

  it('getSnapshot et subscribe s’utilisent détachés (useSyncExternalStore)', () => {
    const { island } = setup()
    const { getSnapshot, subscribe } = island
    let calls = 0
    subscribe(() => (calls += 1))
    island.addActivity(meet)
    expect(getSnapshot().state).toBe('meet')
    expect(calls).toBe(1)
  })

  it('dispose arrête les minuteurs et les abonnés', () => {
    const { clock, island } = setup()
    let calls = 0
    island.subscribe(() => (calls += 1))
    island.notify(plain())
    island.notify(plain())
    expect(clock.pendingTimers).toBe(1)
    island.dispose()
    expect(clock.pendingTimers).toBe(0)
    island.addActivity(meet)
    expect(calls).toBe(1)
  })
})

describe('digestTexts', () => {
  it('écrit les regroupements comme le prototype', () => {
    expect(digestTexts(['A', 'B', 'C'])).toEqual({ title: '3 nouveautés', subtitle: 'A, B et 1 autre' })
    expect(digestTexts(['A'], true)).toEqual({ title: "Pendant l'appel : 1 notification", subtitle: 'A' })
    expect(digestTexts(['A', 'B'], true)).toEqual({ title: "Pendant l'appel : 2 notifications", subtitle: 'A, B' })
  })
})
