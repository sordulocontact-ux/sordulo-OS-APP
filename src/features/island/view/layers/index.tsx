/**
 * Toutes les couches de l'île, dans l'ordre du prototype (les dernières passent au-dessus).
 */
import type {
  ChoiceDecision,
  ClaudeSession,
  IslandChoice,
  IslandMusic,
  IslandNotification,
  IslandSnapshot,
  MeetActivity,
  MusicCommand,
  PermissionAsk,
  PermissionDecision,
} from '../../types'
import type { BackgroundRow } from '../labels'
import type { ActivityOfKind, IslandCallPrompt, IslandDropInfo, IslandDropZone } from '../types'
import { MusicLayer, ProgressLayer } from './ActivityLayers'
import { AppelLayer, MeetLayer, type BaseLayerProps } from './CallLayers'
import { ChoiceLayer } from './ChoiceLayer'
import { AgentLayer, AskLayer, MultiLayer } from './ClaudeLayers'
import { DragOverLayer, DragWakeLayer } from './DragLayers'
import { NotifLayer } from './NotifLayer'

export interface ActivityLayersProps {
  base: BaseLayerProps
  /** Survol ou focus clavier : détails de meet, music, progress, agent, multi. */
  open: boolean
  snapshot: IslandSnapshot
  call: IslandCallPrompt | null
  meet: MeetActivity | null
  /** Lignes « aussi en cours » sous l'appel et sous la musique au survol (dépliées : toutes). */
  meetRows: readonly BackgroundRow[]
  progress: ActivityOfKind<'progress'> | null
  /** Lecture en cours (musicOpen) ; null : textes par défaut. */
  music: IslandMusic | null
  agentSession: ClaudeSession | null
  sessions: readonly ClaudeSession[]
  drop: IslandDropInfo | null
  hotZone: IslandDropZone | null
  refs: {
    musicElapsedRef: (el: HTMLElement | null) => void
    musicFillRef: (el: HTMLElement | null) => void
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
    onChoiceDecision: (decision: ChoiceDecision, choice: IslandChoice, always: boolean) => void
    onMusicCommand?: (command: MusicCommand) => void
    /** Clic sur une ligne « aussi en cours » (session, activité, « N autres activités »). */
    onSelectRow: (row: BackgroundRow) => void
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
  music,
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
        open={open && state === 'meet'}
        onStopRecording={handlers.onStopRecording}
        onSelectRow={handlers.onSelectRow}
      />
      <MusicLayer
        rows={meetRows}
        {...base}
        music={music}
        open={open && state === 'music'}
        onMusicCommand={handlers.onMusicCommand}
        onSelectRow={handlers.onSelectRow}
        elapsedRef={refs.musicElapsedRef}
        fillRef={refs.musicFillRef}
      />
      <ProgressLayer {...base} progress={progress} open={open && state === 'progress'} />
      <AgentLayer
        {...base}
        session={agentSession}
        open={open && state === 'agent'}
        onOpenSession={handlers.onOpenSession}
        onAnswerSession={handlers.onAnswerSession}
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
      <ChoiceLayer {...base} choice={snapshot.choice} onChoiceDecision={handlers.onChoiceDecision} />
      <NotifLayer {...base} notification={snapshot.notification} onNotificationAction={handlers.onNotificationAction} />
    </>
  )
}
