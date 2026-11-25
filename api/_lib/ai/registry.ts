/** Registre des actions IA : une entrée par nom de src/shared/ai-actions.ts (vérifié par le typage). */
import type { AiActionName } from '../../../src/shared/ai-actions.js'
import brief from './actions/brief.js'
import caseStudy from './actions/caseStudy.js'
import classify from './actions/classify.js'
import contractDraft from './actions/contractDraft.js'
import followupDraft from './actions/followupDraft.js'
import pitch from './actions/pitch.js'
import prospectAudit from './actions/prospectAudit.js'
import quoteDraft from './actions/quoteDraft.js'
import replan from './actions/replan.js'
import voiceCommand from './actions/voiceCommand.js'
import type { AiAction } from './types.js'

export const AI_ACTION_REGISTRY: Record<AiActionName, AiAction> = {
  classify,
  brief,
  quoteDraft,
  prospectAudit,
  pitch,
  replan,
  followupDraft,
  contractDraft,
  caseStudy,
  voiceCommand,
}
