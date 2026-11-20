/**
 * Scénarios de priorité A à F du prototype (design/prototypes/ile-sordulo-os.html, objet PRIO),
 * rejoués avec la même chronologie sur une horloge simulée. Ce que le prototype simule (fin des
 * progressions, clics « Autoriser ») est fait ici par le test, comme le fera le contrôleur.
 * Un clic auto du prototype (autoPress à t) part à t + 180 ms.
 */
import { describe, expect, it } from 'vitest'
import { createNotification } from '../catalog'
import type { ActivityInput } from './coordinator'
import { IslandCoordinator } from './coordinator'
import { FakeClock } from './fakeClock'
import type { PermissionAsk } from '../types'

function setup(focusMode = false) {
  const clock = new FakeClock(0)
  const island = new IslandCoordinator({ clock, focusMode })
  return { clock, island, snap: () => island.getSnapshot() }
}

const meet: ActivityInput = {
  id: 'meet',
  kind: 'meet',
  appName: 'Google Meet',
  projectId: 'p-1',
  projectName: 'PDS OS',
  startedAt: 0,
}
const agent: ActivityInput = { id: 'agent', kind: 'agent', sessionId: 's-1' }
const multi: ActivityInput = { id: 'multi', kind: 'multi' }
const music: ActivityInput = { id: 'music', kind: 'music' }

function progress(stage: 'upload' | 'analyse' | 'deploy', label: string, startedAt: number): ActivityInput {
  return { id: `prog:${stage}`, kind: 'progress', stage, label, fraction: null, startedAt, estimatedMs: 5000 }
}

function ask(id: string, at: number): PermissionAsk {
  return {
    id,
    sessionId: 's-1',
    toolName: 'Bash',
    summary: 'npm run build',
    title: 'Lancer une commande dans PDS OS',
    receivedAt: at,
    expiresAt: at + 60_000,
  }
}

const devis = () =>
  createNotification('devis', { clientName: 'Ibé', projectName: 'Airbnb des studios', amountEur: 4200, route: '/p' })
const paiement = () =>
  createNotification('paiement', {
    clientName: 'Ibé',
    invoiceTitle: 'Airbnb des studios',
    amountEur: 1200,
    route: '/p',
  })
const assign = () =>
  createNotification('assign', {
    assignerName: 'Maël',
    assignerInitials: 'MA',
    taskTitle: "Refaire l'écran de validation",
    route: '/t',
  })
const relecture = () =>
  createNotification('relecture', {
    authorInitials: 'MA',
    taskTitle: "Partage du ticket depuis l'iPhone",
    route: '/t',
  })

describe('scénarios de priorité', () => {
  it('A : appel en cours, Claude travaille, Vercel déploie, puis analyse après l’appel', () => {
    const { clock, island, snap } = setup()
    island.addActivity(meet)
    expect(snap()).toMatchObject({ state: 'meet', secondary: null, activityCount: 1 })

    clock.advanceTo(1500)
    island.addActivity(agent)
    expect(snap().primary?.id).toBe('meet')
    expect(snap().secondary?.id).toBe('agent')

    clock.advanceTo(4000)
    island.addActivity(progress('deploy', 'Déploiement en cours', 4000))
    expect(snap()).toMatchObject({ state: 'meet', activityCount: 3 })
    expect(snap().primary?.id).toBe('meet')
    expect(snap().secondary?.id).toBe('prog:deploy')

    clock.advanceTo(7000)
    const request = ask('ask-1', 7000)
    island.requestAsk(request)
    expect(snap()).toMatchObject({ state: 'agentAsk', withCall: true, askPosition: null })
    expect(snap().ask?.id).toBe('ask-1')

    // Fin du déploiement (prototype : 5,2 s + 350 ms) : la notification attend derrière la demande.
    clock.advanceTo(9550)
    island.removeActivity('prog:deploy')
    const deployed = createNotification('deployed', { projectName: 'PDS OS', url: 'https://pds.example' })
    island.notify(deployed)
    expect(snap()).toMatchObject({ state: 'agentAsk', notification: null, askPosition: null })
    expect(snap().secondary?.id).toBe('agent')

    // « Autoriser »
    clock.advanceTo(10_680)
    expect(island.resolveAsk('ask-1')).toBe(true)
    expect(snap()).toMatchObject({ state: 'meet', ask: null, withCall: false })

    clock.advanceTo(11_129)
    expect(snap().state).toBe('meet')
    clock.advanceTo(11_130)
    expect(snap()).toMatchObject({ state: 'notif', withCall: true })
    expect(snap().notification?.id).toBe(deployed.id)

    clock.advanceTo(15_629)
    expect(snap().state).toBe('notif')
    clock.advanceTo(15_630)
    expect(snap()).toMatchObject({ state: 'meet', notification: null })

    // Fin de l'appel : le contrôleur ajoute l'analyse, qui passe devant Claude.
    clock.advanceTo(17_500)
    island.endMeet()
    island.addActivity(progress('analyse', "Analyse de l'appel", 17_500))
    expect(snap()).toMatchObject({ state: 'progress', activityCount: 2, notification: null })
    expect(snap().primary?.id).toBe('prog:analyse')
    expect(snap().secondary?.id).toBe('agent')

    // Analyse terminée : « 6 tickets à valider » pendant 7 s, puis Claude.
    clock.advanceTo(26_850)
    island.removeActivity('prog:analyse')
    island.notify(
      createNotification('tickets', { count: 6, inputTitle: 'Call Ibé', projectName: 'PDS OS', route: '/review' }),
    )
    expect(snap()).toMatchObject({ state: 'notif', withCall: false, secondary: null })
    expect(snap().notification?.title).toBe('6 tickets à valider')
    clock.advanceTo(33_849)
    expect(snap().state).toBe('notif')
    clock.advanceTo(33_850)
    expect(snap()).toMatchObject({ state: 'agent', notification: null })
    expect(snap().primary?.id).toBe('agent')
  })

  it('B : quatre notifications d’affilée pendant une musique', () => {
    const { clock, island, snap } = setup()
    island.addActivity(music)
    expect(snap().state).toBe('music')

    const first = devis()
    const [second, third, fourth] = [paiement(), assign(), relecture()]
    clock.advanceTo(1200)
    island.notify(first)
    clock.advanceTo(1500)
    island.notify(second)
    clock.advanceTo(1800)
    island.notify(third)
    clock.advanceTo(2100)
    island.notify(fourth)
    expect(snap()).toMatchObject({ state: 'notif', withCall: false })
    expect(snap().notification?.id).toBe(first.id)

    clock.advanceTo(5700)
    expect(snap()).toMatchObject({ state: 'music', notification: null })

    clock.advanceTo(6150)
    const digest = snap().notification
    expect(snap().state).toBe('notif')
    expect(digest?.kind).toBe('digest')
    expect(digest?.title).toBe('3 nouveautés')
    expect(digest?.subtitle).toBe(`${second.title}, ${third.title} et 1 autre`)
    expect(digest?.durationMs).toBe(6000)

    clock.advanceTo(12_149)
    expect(snap().state).toBe('notif')
    clock.advanceTo(12_150)
    expect(snap()).toMatchObject({ state: 'music', notification: null })
    clock.advanceTo(20_000)
    expect(snap()).toMatchObject({ state: 'music', notification: null })
  })

  it('C : mode concentration, les notifications attendent la fin de l’appel', () => {
    const { clock, island, snap } = setup(true)
    island.addActivity(meet)
    expect(snap()).toMatchObject({ state: 'meet', focusMode: true })

    const held = [paiement(), assign(), devis()]
    clock.advanceTo(2000)
    island.notify(held[0]!)
    clock.advanceTo(3500)
    island.notify(held[1]!)
    clock.advanceTo(5000)
    island.notify(held[2]!)
    expect(snap()).toMatchObject({ state: 'meet', notification: null })

    clock.advanceTo(9000)
    island.endMeet()
    // Le contrôleur ajoute l'import de l'audio avec les vrais statuts.
    island.addActivity(progress('upload', "Import de l'audio", 9000))
    const digest = snap().notification
    expect(snap()).toMatchObject({ state: 'notif', withCall: false })
    expect(snap().primary?.id).toBe('prog:upload')
    expect(digest?.kind).toBe('digest')
    expect(digest?.title).toBe("Pendant l'appel : 3 notifications")
    expect(digest?.subtitle).toBe(`${held[0]!.title}, ${held[1]!.title} et 1 autre`)

    clock.advanceTo(15_000)
    expect(snap()).toMatchObject({ state: 'progress', notification: null })
    clock.advanceTo(16_000)
    expect(snap()).toMatchObject({ state: 'progress', notification: null })
  })

  it('D : on épingle les sessions Claude, l’appel passe dans la bulle, puis on revient', () => {
    const { clock, island, snap } = setup()
    island.addActivity(meet)

    clock.advanceTo(800)
    island.addActivity(multi)
    expect(snap()).toMatchObject({ state: 'meet', pinnedId: null, activityCount: 2 })
    expect(snap().secondary?.id).toBe('multi')

    clock.advanceTo(3000)
    expect(island.pinSecondary()).toBe('multi')
    expect(snap()).toMatchObject({ state: 'multi', pinnedId: 'multi' })
    expect(snap().secondary?.id).toBe('meet')

    clock.advanceTo(11_000)
    expect(island.pinSecondary()).toBe('meet')
    expect(snap()).toMatchObject({ state: 'meet', pinnedId: 'meet' })
    expect(snap().secondary?.id).toBe('multi')
  })

  it('E : la musique cède la place au jardin', () => {
    const { clock, island, snap } = setup()
    island.addActivity(music)
    expect(snap()).toMatchObject({ state: 'music', secondary: null })

    clock.advanceTo(1500)
    island.addActivity(multi)
    expect(snap()).toMatchObject({ state: 'multi', activityCount: 2 })
    expect(snap().primary?.id).toBe('multi')
    expect(snap().secondary?.id).toBe('music')
  })

  it('F : Claude demande une autorisation pendant qu’un rappel de call arrive', () => {
    const { clock, island, snap } = setup()
    island.addActivity(agent)
    clock.advanceTo(1000)
    island.addActivity(music)
    expect(snap()).toMatchObject({ state: 'agent' })
    expect(snap().secondary?.id).toBe('music')

    clock.advanceTo(3000)
    const rappel = createNotification('rappel', {
      meetingTitle: 'Call Ibé',
      minutes: 5,
      appName: 'Google Meet',
      projectName: 'PDS OS',
      url: 'https://meet.example/ibe',
    })
    island.requestAsk(ask('ask-1', 3000))
    island.notify(rappel)
    expect(snap()).toMatchObject({ state: 'agentAsk', withCall: false, askPosition: { index: 1, total: 2 } })

    // « Autoriser »
    clock.advanceTo(6680)
    island.resolveAsk('ask-1')
    expect(snap()).toMatchObject({ state: 'agent', ask: null, askPosition: null })

    clock.advanceTo(7130)
    expect(snap().state).toBe('notif')
    expect(snap().notification).toMatchObject({
      id: rappel.id,
      interrupt: true,
      durationMs: 7000,
      button: 'Rejoindre',
      action: { type: 'openUrl', url: 'https://meet.example/ibe' },
    })

    // « Rejoindre » : le contrôleur ouvre le lien ; l'île revient à Claude.
    clock.advanceTo(8780)
    island.endNotification(rappel.id)
    expect(snap()).toMatchObject({ state: 'agent', notification: null })
  })

  it('F, sans clic : le rappel reste 7 s', () => {
    const { clock, island, snap } = setup()
    island.addActivity(agent)
    island.addActivity(music)
    clock.advanceTo(3000)
    island.requestAsk(ask('ask-1', 3000))
    island.notify(
      createNotification('rappel', { meetingTitle: 'Call Ibé', minutes: 5, appName: 'Google Meet', url: 'https://x' }),
    )
    clock.advanceTo(6680)
    island.resolveAsk('ask-1')
    clock.advanceTo(14_129)
    expect(snap().state).toBe('notif')
    clock.advanceTo(14_130)
    expect(snap().state).toBe('agent')
  })
})
