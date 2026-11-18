/**
 * Runs a promise after the response is sent.
 * On Vercel, waitUntil keeps the function alive until it settles (up to maxDuration).
 * Elsewhere (Vite dev server, tests), @vercel/functions finds no request context and does
 * nothing: the promise simply keeps running in the long-lived Node process.
 */
import { waitUntil } from '@vercel/functions'

export function runInBackground(task: Promise<unknown>): void {
  const guarded = task.catch((error: unknown) => {
    console.error('[background] tâche en échec', error)
  })
  try {
    waitUntil(guarded)
  } catch (error) {
    console.error('[background] waitUntil indisponible, la tâche continue sans lui', error)
  }
}
