/**
 * Notifications de l'équipe après une action du client sur le portail (validation, demande de
 * modifications, devis accepté, contrat signé). Même destinataires que le déclencheur des
 * commentaires (tg_notify_deliverable_comment, migration 0015) : membres actifs admin / membre du
 * projet, sinon les admins actifs si le projet n'a pas de membres.
 * Best effort : l'action du client est déjà enregistrée, un échec est seulement journalisé.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Member } from '../../../src/shared/types.js'
import type { PortalProjectRow } from './view.js'

export interface PortalNotification {
  kind: string
  title: string
  body: string | null
  link: string
  payload: Record<string, unknown>
  /** Une seule notification par membre et clé (double clic, nouvel essai). */
  dedupeKey: string
}

const TEAM_ROLES = ['admin', 'membre'] as const

export async function projectRecipients(admin: SupabaseClient, project: PortalProjectRow): Promise<string[]> {
  const links = await admin.from('project_members').select('member_id').eq('project_id', project.id)
  if (links.error) throw new Error(links.error.message)
  const memberIds = (links.data as { member_id: string }[]).map((l) => l.member_id)

  const query =
    memberIds.length > 0
      ? admin.from('members').select('id, role, organization_id, removed_at').in('id', memberIds)
      : admin.from('members').select('id, role, organization_id, removed_at').eq('organization_id', project.organization_id).eq('role', 'admin')
  const members = await query.is('removed_at', null)
  if (members.error) throw new Error(members.error.message)
  return (members.data as Pick<Member, 'id' | 'role' | 'organization_id' | 'removed_at'>[])
    .filter(
      (m) =>
        m.organization_id === project.organization_id &&
        m.removed_at === null &&
        (memberIds.length > 0 ? (TEAM_ROLES as readonly string[]).includes(m.role) : m.role === 'admin'),
    )
    .map((m) => m.id)
}

export async function notifyProjectTeam(
  admin: SupabaseClient,
  project: PortalProjectRow,
  notification: PortalNotification,
): Promise<void> {
  try {
    const recipients = await projectRecipients(admin, project)
    for (const memberId of recipients) {
      const { error } = await admin.from('notifications').insert({
        organization_id: project.organization_id,
        member_id: memberId,
        kind: notification.kind,
        title: notification.title.slice(0, 200),
        body: notification.body ? notification.body.slice(0, 2000) : null,
        link: notification.link,
        payload: notification.payload,
        dedupe_key: notification.dedupeKey.slice(0, 200),
      })
      // 23505 : déjà notifié pour cette clé.
      if (error && error.code !== '23505') console.error('[portal] notification impossible', error.message)
    }
  } catch (error) {
    console.error('[portal] notifications impossibles', error instanceof Error ? error.message : error)
  }
}
