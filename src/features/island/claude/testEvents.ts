/**
 * Fabrique d'événements du relais pour les tests (sessions, source du contrôleur, labo).
 */
import type { ClaudeHookEventName, ClaudeRelayEvent } from '../../../shared/desktop-contract'

export const TEST_CWD = 'C:\\Users\\mael\\GitHub\\sordulo-OS'

export function relayEvent(
  event: ClaudeHookEventName,
  fields: Partial<Omit<ClaudeRelayEvent, 'event'>> = {},
): ClaudeRelayEvent {
  return {
    event,
    sessionId: 's-1',
    cwd: TEST_CWD,
    branch: 'feature/ile',
    toolName: null,
    toolSummary: null,
    filePath: null,
    requestId: null,
    message: null,
    at: 1_000_000,
    ...fields,
  }
}
