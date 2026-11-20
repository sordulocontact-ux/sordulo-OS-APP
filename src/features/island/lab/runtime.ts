/**
 * Pilote du labo : un vrai IslandCoordinator (horloge système) plus ce que fera le contrôleur de l'app, simulé :
 * sessions, appel détecté, glisser-déposer, fin des progressions, décisions des boutons. Pas de React ici :
 * le composant lit `getSnapshot()` avec useSyncExternalStore.
 */
import { IslandCoordinator, systemClock, type TimerId } from '../coordinator'
import type { ClaudeSession, IslandNotification, IslandSnapshot, PermissionDecision, ProgressStage } from '../types'
import type { IslandCallPrompt, IslandDropInfo, IslandDropZone } from '../view'
import {
  LAB_CALL_APP,
  LAB_PROJECTS,
  MAX_LAB_SESSIONS,
  makeAsk,
  makeDrop,
  makeSessions,
  sampleNotification,
  type DropFile,
  type DropOptions,
} from './fixtures'
import type { NotificationKind } from '../types'

export interface LabView {
  snapshot: IslandSnapshot
  sessions: readonly ClaudeSession[]
  call: IslandCallPrompt | null
  drop: IslandDropInfo | null
  hotZone: IslandDropZone | null
  /** Survol forcé ou réel : ce que reçoit l'île. */
  hover: boolean
  focusMode: boolean
  /** Dernières réactions aux boutons de l'île, la plus récente en premier. */
  log: readonly string[]
}

type ProgressChainStage = Extract<ProgressStage, 'upload' | 'analyse' | 'deploy'>

/** Durées simulées (prototype : PROGS, et 9 s pour l'analyse en coordination). */
const PROGRESS: Record<ProgressChainStage, { label: string; durationMs: number }> = {
  upload: { label: 'Import de l’audio', durationMs: 3200 },
  analyse: { label: 'Analyse de l’appel', durationMs: 9000 },
  deploy: { label: 'Déploiement en cours', durationMs: 5200 },
}

/** Délai entre la fin d'une progression et ce qui la suit (prototype : 350 ms). */
const PROGRESS_END_DELAY_MS = 350
/** Un clic automatique du prototype part 180 ms après (animation d'appui). */
const AUTO_PRESS_DELAY_MS = 180
const LOG_LIMIT = 6
/** Passage agent → multi du prototype (scnMulti : 1,3 s). */
const GARDEN_FROM_ICON_MS = 1300
/** Durée d'un conflit simulé (la dispute dure 6,2 s). */
const GARDEN_CONFLICT_MS = 8000

export class LabRuntime {
  private coordinator: IslandCoordinator
  private unsubscribe: (() => void) | null = null
  private readonly timers = new Set<TimerId>()
  private readonly listeners = new Set<() => void>()
  private sessions: ClaudeSession[] = []
  private call: IslandCallPrompt | null = null
  private drop: IslandDropInfo | null = null
  private dropFile: DropFile | null = null
  private dropOptions: DropOptions = { files: false, claude: true }
  private hotZone: IslandDropZone | null = null
  private focusMode = false
  private forcedHover = false
  private realHover = false
  private log: string[] = []
  private view: LabView

  constructor() {
    this.coordinator = new IslandCoordinator({ clock: systemClock, focusMode: this.focusMode })
    this.view = this.buildView()
  }

  // --- Cycle de vie et lecture -------------------------------------------------------------------------------

  /** À appeler au montage (relancé après un démontage, StrictMode compris). */
  start = (): void => {
    if (this.unsubscribe) return
    this.unsubscribe = this.coordinator.subscribe(this.emit)
    this.emit()
  }

  stop = (): void => {
    this.clearTimers()
    this.unsubscribe?.()
    this.unsubscribe = null
    this.coordinator.dispose()
    // Un coordinateur neuf attend le prochain `start`.
    this.coordinator = new IslandCoordinator({ clock: systemClock, focusMode: this.focusMode })
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): LabView => this.view

  private buildView(): LabView {
    return {
      snapshot: this.coordinator.getSnapshot(),
      sessions: this.sessions,
      call: this.call,
      drop: this.drop,
      hotZone: this.hotZone,
      hover: this.forcedHover || this.realHover,
      focusMode: this.focusMode,
      log: this.log,
    }
  }

  private emit = (): void => {
    this.view = this.buildView()
    this.listeners.forEach((l) => l())
  }

  private remember(text: string): void {
    this.log = [text, ...this.log].slice(0, LOG_LIMIT)
  }

  // --- Minuteurs du labo -------------------------------------------------------------------------------------

  private later(ms: number, fn: () => void): void {
    const id = systemClock.setTimeout(() => {
      this.timers.delete(id)
      fn()
    }, ms)
    this.timers.add(id)
  }

  private clearTimers(): void {
    this.timers.forEach((id) => systemClock.clearTimeout(id))
    this.timers.clear()
  }

  // --- Réglages ----------------------------------------------------------------------------------------------

  setFocusMode(on: boolean): void {
    this.focusMode = on
    this.coordinator.setFocusMode(on)
    this.emit()
  }

  setForcedHover(on: boolean): void {
    this.forcedHover = on
    this.coordinator.setHover(on || this.realHover)
    this.emit()
  }

  setRealHover = (on: boolean): void => {
    this.realHover = on
    this.coordinator.setHover(on || this.forcedHover)
    this.emit()
  }

  setHotZone(zone: IslandDropZone | null): void {
    this.hotZone = zone
    this.emit()
  }

  setDropOptions(options: DropOptions): void {
    this.dropOptions = options
    if (this.dropFile) this.drop = makeDrop(this.dropFile, options)
    this.emit()
  }

  // --- États -------------------------------------------------------------------------------------------------

  /** Efface tout : activités, notifications, sessions, files d'attente (le mode concentration et le survol restent). */
  reset(): void {
    this.clearTimers()
    this.unsubscribe?.()
    this.coordinator.dispose()
    this.coordinator = new IslandCoordinator({ clock: systemClock, focusMode: this.focusMode })
    this.coordinator.setHover(this.forcedHover || this.realHover)
    this.unsubscribe = this.coordinator.subscribe(this.emit)
    this.sessions = []
    this.call = null
    this.drop = null
    this.dropFile = null
    this.hotZone = null
    this.emit()
  }

  detectCall(): void {
    this.call = { appName: LAB_CALL_APP, projects: LAB_PROJECTS, selectedProjectId: LAB_PROJECTS[0]?.id ?? null }
    this.coordinator.showOverlay('appel')
    this.emit()
  }

  startMeet(): void {
    const project = LAB_PROJECTS[0]
    this.coordinator.addActivity({
      id: 'meet',
      kind: 'meet',
      appName: LAB_CALL_APP,
      projectId: project?.id ?? null,
      projectName: project?.name ?? null,
      startedAt: systemClock.now(),
    })
  }

  addMusic(): void {
    this.coordinator.addActivity({ id: 'music', kind: 'music' })
  }

  setSessions(count: number, waiting = false): void {
    this.sessions = makeSessions(count, systemClock.now(), waiting)
    this.emit()
  }

  addAgent(): void {
    if (this.sessions.length === 0) this.setSessions(1)
    this.coordinator.addActivity({ id: 'agent', kind: 'agent', sessionId: this.sessions[0]?.id ?? 'lab-session-1' })
  }

  addMulti(count: number, waiting = false): void {
    this.setSessions(count, waiting)
    this.coordinator.addActivity({ id: 'multi', kind: 'multi' })
  }

  requestAsk(): void {
    if (this.sessions.length === 0) this.setSessions(1)
    const ask = makeAsk(this.sessions[0]?.id ?? 'lab-session-1', systemClock.now())
    this.coordinator.requestAsk(ask)
    // Le relais rend la main au terminal au bout de 60 s.
    this.later(ask.expiresAt - ask.receivedAt, () => {
      this.coordinator.resolveAsk(ask.id)
    })
  }

  notify(kind: NotificationKind): void {
    this.coordinator.notify(sampleNotification(kind))
  }

  showDragWake(file: DropFile): void {
    this.dropFile = file
    this.drop = makeDrop(file, this.dropOptions)
    this.coordinator.showOverlay('dragWake')
    this.emit()
  }

  showDragOver(file: DropFile): void {
    this.dropFile = file
    this.drop = makeDrop(file, this.dropOptions)
    this.coordinator.showOverlay('dragOver')
    this.emit()
  }

  /** Progression qui se termine seule (le contrôleur de l'app fera de même) puis enchaîne. */
  runProgress(stage: ProgressChainStage, chain = true): void {
    const { label, durationMs } = PROGRESS[stage]
    const id = `prog:${stage}`
    this.coordinator.addActivity({
      id,
      kind: 'progress',
      stage,
      label,
      fraction: null,
      startedAt: systemClock.now(),
      estimatedMs: durationMs,
    })
    if (!chain) return
    this.later(durationMs + PROGRESS_END_DELAY_MS, () => {
      this.coordinator.removeActivity(id)
      if (stage === 'upload') this.runProgress('analyse')
      else if (stage === 'analyse') this.coordinator.notify(sampleNotification('tickets'))
      else this.coordinator.notify(sampleNotification('deployed'))
    })
  }

  /** Fin d'appel : le contrôleur ajoute ensuite l'import (ou, comme le prototype, directement l'analyse). */
  endCall(first: 'upload' | 'analyse' = 'upload'): void {
    this.coordinator.endMeet()
    this.runProgress(first)
  }

  // --- Jardin des Claude : événements simulés sur les sessions ------------------------------------------------

  private patchSession(index: number, patch: Partial<ClaudeSession>): void {
    this.sessions = this.sessions.map((s, i) => (i === index ? { ...s, ...patch } : s))
  }

  private firstIndex(accept: (s: ClaudeSession) => boolean): number {
    return this.sessions.findIndex(accept)
  }

  /** Claude part de son icône puis l'île devient un jardin (prototype : scnMulti). */
  gardenFromIcon(count: number): void {
    this.reset()
    this.addAgent()
    this.later(GARDEN_FROM_ICON_MS, () => {
      this.sessions = makeSessions(Math.max(2, count), systemClock.now(), false)
      this.coordinator.removeActivity('agent')
      this.coordinator.addActivity({ id: 'multi', kind: 'multi' })
      this.emit()
    })
  }

  /** Deux sessions modifient le même fichier : leurs Claude se disputent (prototype : scnConflict). */
  gardenConflict(): void {
    const pair = this.sessions
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.status === 'working' && !s.conflict)
      .slice(0, 2)
    const [a, b] = pair
    if (!a || !b) return
    this.patchSession(a.i, { conflict: true })
    this.patchSession(b.i, { conflict: true })
    this.remember('Jardin : conflit entre deux sessions')
    this.emit()
    // Le conflit se résout (fin du tour) : il pourra se rejouer.
    this.later(GARDEN_CONFLICT_MS, () => {
      const ids = new Set([a.s.id, b.s.id])
      this.sessions = this.sessions.map((s) => (ids.has(s.id) ? { ...s, conflict: false } : s))
      this.emit()
    })
  }

  /** Une session demande une autorisation ; si aucune ne travaille, celle qui attendait reprend. */
  gardenWait(): void {
    const i = this.firstIndex((s) => s.status === 'working')
    if (i >= 0) this.patchSession(i, { status: 'waiting' })
    else {
      const w = this.firstIndex((s) => s.status === 'waiting')
      if (w >= 0) this.patchSession(w, { status: 'working' })
    }
    this.emit()
  }

  /** Une session termine : les autres la fêtent. */
  gardenFinish(): void {
    const i = this.firstIndex((s) => s.status === 'working')
    if (i >= 0) this.patchSession(i, { status: 'done', subagents: 0, step: null })
    this.emit()
  }

  /** Sieste (session inactive) ou réveil. */
  gardenSleep(): void {
    const sleeping = this.firstIndex((s) => s.status === 'sleep')
    if (sleeping >= 0) this.patchSession(sleeping, { status: 'working' })
    else {
      const i = this.firstIndex((s) => s.status === 'working')
      if (i >= 0) this.patchSession(i, { status: 'sleep', subagents: 0 })
    }
    this.emit()
  }

  /** En pause (refus) ou reprise. */
  gardenPause(): void {
    const idle = this.firstIndex((s) => s.status === 'idle' && !s.error)
    if (idle >= 0) this.patchSession(idle, { status: 'working' })
    else {
      const i = this.firstIndex((s) => s.status === 'working')
      if (i >= 0) this.patchSession(i, { status: 'idle' })
    }
    this.emit()
  }

  /** Bloquée (outil en erreur) : un autre Claude vient la consoler ; un second appui la débloque. */
  gardenBlock(): void {
    const blocked = this.firstIndex((s) => s.error)
    if (blocked >= 0) this.patchSession(blocked, { error: false, status: 'working' })
    else {
      const i = this.firstIndex((s) => s.status === 'working')
      if (i >= 0) this.patchSession(i, { error: true, status: 'idle' })
    }
    this.emit()
  }

  /** Un sous-agent de plus (tour à tour sur les sessions qui travaillent), ou un qui rentre. */
  gardenSubagent(delta: 1 | -1): void {
    if (delta > 0) {
      const working = this.sessions.map((s, i) => ({ s, i })).filter(({ s }) => s.status === 'working')
      const target = working.sort((x, y) => x.s.subagents - y.s.subagents)[0]
      if (target) this.patchSession(target.i, { subagents: target.s.subagents + 1 })
    } else {
      const i = this.firstIndex((s) => s.subagents > 0)
      const s = this.sessions[i]
      if (s) this.patchSession(i, { subagents: s.subagents - 1 })
    }
    this.emit()
  }

  /** Nouvelle session (jusqu'à 5) ou départ de la dernière. */
  gardenSessionCount(delta: 1 | -1): void {
    const n = this.sessions.length + delta
    if (n < 1 || n > MAX_LAB_SESSIONS) return
    if (delta > 0) {
      const added = makeSessions(n, systemClock.now(), false)[n - 1]
      if (added) this.sessions = [...this.sessions, { ...added, startedAt: systemClock.now() }]
    } else {
      this.sessions = this.sessions.slice(0, n)
    }
    this.emit()
  }

  // --- Ce que font les boutons de l'île ----------------------------------------------------------------------

  /** Autoriser / Refuser / Plus tard : ferme la demande affichée. */
  decideAsk = (decision: PermissionDecision, askId: string): void => {
    this.coordinator.resolveAsk(askId)
    this.remember(`Demande d’autorisation : ${{ allow: 'Autoriser', deny: 'Refuser', later: 'Plus tard' }[decision]}`)
    if (decision === 'deny') {
      this.coordinator.notify(sampleNotification('claudeStop'))
    }
    this.emit()
  }

  pressNotification = (notification: IslandNotification): void => {
    this.coordinator.endNotification(notification.id)
    this.remember(`Bouton « ${notification.button ?? 'Fermer'} » : ${notification.title}`)
    if (notification.action.type === 'stopRecording') this.stopRecording()
    else if (notification.action.type === 'showSessions' && this.sessions.length === 0) this.setSessions(3)
    this.emit()
  }

  dismissNotification = (notification: IslandNotification): void => {
    this.coordinator.endNotification(notification.id)
    this.remember(`Échap : ${notification.title}`)
    this.emit()
  }

  /** « Transcrire » : l'appel détecté devient un enregistrement simulé. */
  acceptCall = (projectId: string | null): void => {
    const project = LAB_PROJECTS.find((p) => p.id === projectId) ?? null
    this.coordinator.hideOverlay('appel')
    this.call = null
    this.coordinator.addActivity({
      id: 'meet',
      kind: 'meet',
      appName: LAB_CALL_APP,
      projectId: project?.id ?? null,
      projectName: project?.name ?? null,
      startedAt: systemClock.now(),
    })
    this.remember(`Transcrire : ${project?.name ?? 'sans projet'}`)
    this.emit()
  }

  ignoreCall = (): void => {
    this.coordinator.hideOverlay('appel')
    this.call = null
    this.remember('Ignorer l’appel détecté')
    this.emit()
  }

  changeCallProject = (projectId: string): void => {
    if (this.call) this.call = { ...this.call, selectedProjectId: projectId }
    this.emit()
  }

  /** « Arrêter » : fin d'appel, import, analyse, puis « 6 tickets à valider ». */
  stopRecording = (): void => {
    this.remember('Arrêter l’enregistrement : import, analyse, tickets')
    this.endCall('upload')
    this.emit()
  }

  answerSession = (sessionId: string): void => {
    this.remember(`Répondre à ${sessionId}`)
    this.sessions = this.sessions.map((s) => (s.id === sessionId ? { ...s, status: 'working' } : s))
    this.emit()
  }

  pinBubble = (): void => {
    const pinned = this.coordinator.pinSecondary()
    this.remember(`Bulle : ${pinned ?? 'rien à épingler'} passe devant`)
    this.emit()
  }

  // --- Scénarios de priorité (prototype : PRIO ; chronologie de coordinator/scenarios.test.ts) ----------------

  private pressAsk(at: number): void {
    this.later(at, () => {
      const { state, ask } = this.coordinator.getSnapshot()
      if (state === 'agentAsk' && ask) this.later(AUTO_PRESS_DELAY_MS, () => this.decideAsk('allow', ask.id))
    })
  }

  private pressNotificationAt(at: number): void {
    this.later(at, () => {
      const { state, notification } = this.coordinator.getSnapshot()
      if (state === 'notif' && notification) this.later(AUTO_PRESS_DELAY_MS, () => this.pressNotification(notification))
    })
  }

  runScenario(id: ScenarioId): void {
    if (id === 'C') this.setFocusMode(true)
    this.reset()
    this.remember(`Scénario ${id} : ${SCENARIOS[id]}`)
    switch (id) {
      case 'A':
        this.startMeet()
        this.later(1500, () => this.addAgent())
        this.later(4000, () => this.runProgress('deploy'))
        this.later(7000, () => this.requestAsk())
        this.pressAsk(10_500)
        this.later(17_500, () => this.endCall('analyse'))
        break
      case 'B':
        this.addMusic()
        this.later(1200, () => this.notify('devis'))
        this.later(1500, () => this.notify('paiement'))
        this.later(1800, () => this.notify('assign'))
        this.later(2100, () => this.notify('relecture'))
        break
      case 'C':
        this.startMeet()
        this.later(2000, () => this.notify('paiement'))
        this.later(3500, () => this.notify('assign'))
        this.later(5000, () => this.notify('devis'))
        this.later(9000, () => this.endCall('upload'))
        break
      case 'D':
        this.startMeet()
        this.later(800, () => this.addMulti(5))
        this.later(3000, () => this.pinBubble())
        this.later(11_000, () => this.pinBubble())
        break
      case 'E':
        this.addMusic()
        this.later(1500, () => this.addMulti(5))
        break
      case 'F':
        this.addAgent()
        this.later(1000, () => this.addMusic())
        this.later(3000, () => {
          this.requestAsk()
          this.notify('rappel')
        })
        this.pressAsk(6500)
        this.pressNotificationAt(8600)
        break
    }
    this.emit()
  }
}

export type ScenarioId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F'

export const SCENARIOS: Record<ScenarioId, string> = {
  A: 'Appel, Claude et déploiement',
  B: 'Notifications en rafale',
  C: 'Appel en mode concentration',
  D: 'Épingler Claude pendant un appel',
  E: 'Musique et sessions Claude',
  F: 'Deux interruptions à la suite',
}

