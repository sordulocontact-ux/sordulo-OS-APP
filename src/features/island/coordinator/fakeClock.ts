/**
 * Horloge simulée : le temps n'avance que par `advance` / `advanceTo`, et les minuteurs échus
 * partent dans l'ordre (heure, puis ordre de création). Pour les tests de la coordination.
 */
import type { IslandClock, TimerId } from './clock'

interface PendingTimer {
  at: number
  callback: () => void
}

export class FakeClock implements IslandClock {
  private time: number
  private nextTimer = 0
  private readonly timers = new Map<number, PendingTimer>()

  constructor(start = 0) {
    this.time = start
  }

  now(): number {
    return this.time
  }

  setTimeout(callback: () => void, ms: number): TimerId {
    this.nextTimer += 1
    this.timers.set(this.nextTimer, { at: this.time + Math.max(0, ms), callback })
    return this.nextTimer
  }

  clearTimeout(id: TimerId): void {
    if (typeof id === 'number') this.timers.delete(id)
  }

  /** Nombre de minuteurs en attente. */
  get pendingTimers(): number {
    return this.timers.size
  }

  /** Avance jusqu'à l'heure `time` (absolue) en déclenchant les minuteurs échus, y compris ceux créés en route. */
  advanceTo(time: number): void {
    for (;;) {
      let dueId: number | null = null
      let due: PendingTimer | null = null
      for (const [id, timer] of this.timers) {
        if (timer.at > time) continue
        if (due === null || timer.at < due.at) {
          dueId = id
          due = timer
        }
      }
      if (dueId === null || due === null) break
      this.timers.delete(dueId)
      this.time = due.at
      due.callback()
    }
    this.time = Math.max(this.time, time)
  }

  /** Avance de `ms` millisecondes. */
  advance(ms: number): void {
    this.advanceTo(this.time + ms)
  }
}
