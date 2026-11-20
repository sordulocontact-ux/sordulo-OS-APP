/**
 * Toutes les couches de l'île, dans l'ordre du prototype (les dernières passent au-dessus).
 */
import type {
  ClaudeSession,
  IslandNotification,
  IslandSnapshot,
  MeetActivity,
  PermissionAsk,
  PermissionDecision,
} from '../../types'
import type { BackgroundRow } from '../labels'
import type { ActivityOfKind, IslandCallPrompt, IslandDropInfo, IslandDropZone } from '../types'
import { MusicLayer, ProgressLayer } from './ActivityLayers'
import { AppelLayer, MeetLayer, type BaseLayerProps } from './CallLayers'
import { AgentLayer, AskLayer, MultiLayer } from './ClaudeLayers'
import { DragOverLayer, DragWakeLayer } from './DragLayers'
import { NotifLayer } from './NotifLayer'

export interface ActivityLayersProps {
  base: BaseLayerProps
  /** Survol ou focus clavier : détails de meet, agent, multi. */
  open: boolean
  snapshot: IslandSnapshot
  call: IslandCallPrompt | null
  meet: MeetActivity | null
  /** Lignes « aussi en cours » sous l'appel au survol. */
  meetRows: readonly BackgroundRow[]
  progress: ActivityOfKind<'progress'> | null
  agentSession: ClaudeSession | null
  sessions: readonly ClaudeSession[]
  drop: IslandDropInfo | null
  hotZone: IslandDropZone | null
  refs: {
    eqBarRef: (index: number, el: HTMLElement | null) => void
    ringRef: (el: SVGCircleElement | null) => void
    rowElapsedRef: (sessionId: string, el: HTMLElement | null) => void
  }
  handlers: {
    onCallAccept: (projectId: string | null) => void
    onCallIgnore: () => void
    onProjectChange: (projectId: string) => void
    onStopRecording: () => void
    onAskDecision: (decision: PermissionDecision, ask: PermissionAsk) => void
    onAnswerSession: (sessionId: string) => void
    onOpenSession: (sessionId: string) => void
    onNotificationAction: (notification: IslandNotification) => void
  }
}

export function ActivityLayers({
  base,
  open,
  snapshot,
  call,
  meet,
  meetRows,
  progress,
  agentSession,
  sessions,
  drop,
  hotZone,
  refs,
  handlers,
}: ActivityLayersProps) {
  const { state } = snapshot
  return (
    <>
      <AppelLayer
        {...base}
        call={call}
        onCallAccept={handlers.onCallAccept}
        onCallIgnore={handlers.onCallIgnore}
        onProjectChange={handlers.onProjectChange}
      />
      <MeetLayer
        {...base}
        meet={meet}
        rows={meetRows}
        open={open && state === 'meet'} onStopRecording={handlers.onStopRecording} />
      <MusicLayer {...base} eqBarRef={refs.eqBarRef} />
      <ProgressLayer {...base} progress={progress} ringRef={refs.ringRef} />
      <AgentLayer
        {...base}
        session={agentSession}
        open={open && state === 'agent'}
        onOpenSession={handlers.onOpenSession}
      />
      <DragWakeLayer {...base} />
      <DragOverLayer {...base} drop={drop} hotZone={hotZone} />
      <MultiLayer
        {...base}
        sessions={sessions}
        open={open && state === 'multi'}
        onAnswerSession={handlers.onAnswerSession}
        onOpenSession={handlers.onOpenSession}
        elapsedRef={refs.rowElapsedRef}
      />
      <AskLayer
        {...base}
        ask={snapshot.ask}
        sessions={sessions}
        askPosition={snapshot.askPosition}
        onAskDecision={handlers.onAskDecision}
      />
      <NotifLayer {...base} notification={snapshot.notification} onNotificationAction={handlers.onNotificationAction} />
    </>
  )
}
