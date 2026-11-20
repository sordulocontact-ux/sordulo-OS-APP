import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Avatar, Badge, Button, EmptyState, ErrorState, LoadingState, useToast } from '../../components/ui'
import table from '../../components/ui/dataTable.module.css'
import { useAuth, useCurrentMember } from '../auth'
import { api, ApiRequestError } from '../../lib/api'
import { supabase } from '../../lib/supabase'
import { queryKeys } from '../../lib/queryKeys'
import { LABELS, type Member } from '../../shared/types'
import { EditMemberModal } from './EditMemberModal'
import { InviteMemberModal } from './InviteMemberModal'
import { LoginLinkModal } from './LoginLinkModal'
import { RemoveMemberModal } from './RemoveMemberModal'
import { formatCapacity, memberStatus, REMOVAL_BLOCK_TEXT, removalBlock, skillsSummary, STATUS_LABELS, translateMemberError, unavailableText } from './teamLogic'
import { useTeamMembers } from './useTeamMembers'
import styles from './TeamPage.module.css'

const STATUS_TONE: Record<ReturnType<typeof memberStatus>, 'success' | 'warning' | 'neutral'> = {
  active: 'success',
  invited: 'warning',
  removed: 'neutral',
}

export function TeamPage() {
  const { user } = useAuth()
  const { member: me, organization } = useCurrentMember()
  const orgId = organization?.id
  const { data, isLoading, isError, refetch } = useTeamMembers(orgId)
  const queryClient = useQueryClient()
  const toast = useToast()

  const [showRemoved, setShowRemoved] = useState(false)
  const [inviting, setInviting] = useState(false)
  const [editing, setEditing] = useState<Member | null>(null)
  const [removing, setRemoving] = useState<Member | null>(null)
  const [link, setLink] = useState<{ name: string; link: string } | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)

  const members = useMemo(() => data ?? [], [data])
  const visible = useMemo(() => (showRemoved ? members : members.filter((m) => !m.removed_at)), [members, showRemoved])

  async function newLink(target: Member) {
    if (pendingId) return
    setPendingId(target.id)
    try {
      const response = await api.memberLink({ memberId: target.id })
      setLink({ name: target.name, link: response.link })
    } catch (e) {
      toast.error(e instanceof ApiRequestError ? e.message : 'Impossible de créer un nouveau lien. Réessaie.')
    } finally {
      setPendingId(null)
    }
  }

  async function restore(target: Member) {
    if (pendingId) return
    setPendingId(target.id)
    try {
      const { error } = await supabase.rpc('restore_member', { p_member_id: target.id })
      if (error) throw error
      void queryClient.invalidateQueries({ queryKey: queryKeys.members(target.organization_id) })
      toast.success(`${target.name} a été réintégré.`)
    } catch (e) {
      toast.error(translateMemberError(e, 'Impossible de réintégrer ce membre. Réessaie.'))
    } finally {
      setPendingId(null)
    }
  }

  return (
    <section className={table.page} aria-labelledby="team-title">
      <h1 id="team-title">Équipe</h1>
      <div className={table.toolbar}>
        <label className={styles.checkbox}>
          <input type="checkbox" checked={showRemoved} onChange={(e) => setShowRemoved(e.target.checked)} />
          Afficher les membres retirés
        </label>
        <Button variant="primary" onClick={() => setInviting(true)} disabled={!orgId}>
          Inviter un membre
        </Button>
      </div>

      {isLoading || !orgId ? (
        <LoadingState label="Chargement de l’équipe…" />
      ) : isError ? (
        <ErrorState message="Impossible de charger l’équipe." onRetry={() => void refetch()} />
      ) : visible.length === 0 ? (
        <EmptyState title="Aucun membre" text="Invite le premier membre de l’équipe." />
      ) : (
        <table className={table.table}>
          <thead>
            <tr>
              <th scope="col">Membre</th>
              <th scope="col">Rôle</th>
              <th scope="col">Compétences</th>
              <th scope="col">Capacité</th>
              <th scope="col">Statut</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((member) => {
              const status = memberStatus(member)
              const skills = skillsSummary(member.skills)
              const unavailable = unavailableText(member.unavailable_weekdays)
              const block = removalBlock(member, me?.id, members)
              const busy = pendingId === member.id
              const reasonId = `remove-reason-${member.id}`
              return (
                <tr key={member.id} className={[table.row, status === 'removed' ? table.inactive : ''].filter(Boolean).join(' ')}>
                  <td>
                    <span className={[styles.member, status === 'removed' ? styles.removed : ''].filter(Boolean).join(' ')}>
                      <Avatar name={member.name} />
                      <span className={styles.identity}>
                        <span>
                          {member.name}
                          {member.id === me?.id ? <span className={styles.self}> (toi)</span> : null}
                        </span>
                        <span className={table.muted}>{member.email}</span>
                      </span>
                    </span>
                  </td>
                  <td>{LABELS.memberRole[member.role]}</td>
                  <td>
                    {skills.length === 0 ? (
                      <span className={table.muted}>Non renseigné</span>
                    ) : (
                      <span className={styles.badges}>
                        {skills.map((s) => (
                          <Badge key={s.skill} tone={s.skill}>
                            {s.text}
                          </Badge>
                        ))}
                      </span>
                    )}
                  </td>
                  <td>
                    <span className={styles.stack}>
                      <span>{formatCapacity(member.weekly_capacity_hours)}</span>
                      {unavailable ? <span className={[table.muted, styles.small].join(' ')}>{unavailable}</span> : null}
                    </span>
                  </td>
                  <td>
                    <Badge tone={STATUS_TONE[status]}>{STATUS_LABELS[status]}</Badge>
                  </td>
                  <td>
                    <span className={styles.actions}>
                      {status === 'removed' ? (
                        <Button variant="ghost" size="sm" loading={busy} onClick={() => void restore(member)}>
                          Réintégrer
                        </Button>
                      ) : (
                        <>
                          <Button variant="ghost" size="sm" onClick={() => setEditing(member)}>
                            Modifier
                          </Button>
                          {status === 'invited' ? (
                            <Button variant="ghost" size="sm" loading={busy} onClick={() => void newLink(member)}>
                              Nouveau lien
                            </Button>
                          ) : null}
                          <Button
                            variant="ghost"
                            size="sm"
                            className={styles.danger}
                            disabled={block !== null}
                            title={block ? REMOVAL_BLOCK_TEXT[block] : undefined}
                            aria-describedby={block ? reasonId : undefined}
                            onClick={() => setRemoving(member)}
                          >
                            Retirer
                          </Button>
                          {block ? (
                            <span id={reasonId} className="visually-hidden">
                              {REMOVAL_BLOCK_TEXT[block]}
                            </span>
                          ) : null}
                        </>
                      )}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {inviting && orgId ? <InviteMemberModal organizationId={orgId} onClose={() => setInviting(false)} /> : null}
      {editing ? (
        <EditMemberModal member={editing} currentMemberId={me?.id} currentUserId={user?.id} onClose={() => setEditing(null)} />
      ) : null}
      {removing ? <RemoveMemberModal member={removing} onClose={() => setRemoving(null)} /> : null}
      {link ? <LoginLinkModal name={link.name} link={link.link} onClose={() => setLink(null)} /> : null}
    </section>
  )
}
