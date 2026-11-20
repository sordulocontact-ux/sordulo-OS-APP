import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ActionsMenu, Avatar, Badge, EmptyState, ErrorState, Field, ListToolbar, LoadingState, Select, StatCard, useToast, type ActionsMenuItem } from '../../components/ui'
import table from '../../components/ui/dataTable.module.css'
import { useAuth, useCurrentMember } from '../auth'
import { api, ApiRequestError } from '../../lib/api'
import { supabase } from '../../lib/supabase'
import { queryKeys } from '../../lib/queryKeys'
import { LABELS, MEMBER_ROLES, type Member } from '../../shared/types'
import { EditMemberModal } from './EditMemberModal'
import { InviteMemberModal } from './InviteMemberModal'
import { LoginLinkModal } from './LoginLinkModal'
import { RemoveMemberModal } from './RemoveMemberModal'
import { useMemberSignIn } from './useMemberSignIn'
import { formatCapacity, formatHours, memberStatus, REMOVAL_BLOCK_TEXT, removalBlock, skillsSummary, STATUS_LABELS, teamStats, translateMemberError, unavailableText, withSignIn } from './teamLogic'
import { activeTeamFilterCount, filterMembers, type RoleFilter, type TeamStatusFilter } from './teamFilters'
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

  const [query, setQuery] = useState('')
  const [role, setRole] = useState<RoleFilter>('')
  const [statusFilter, setStatusFilter] = useState<TeamStatusFilter>('')
  const [inviting, setInviting] = useState(false)
  const [editing, setEditing] = useState<Member | null>(null)
  const [removing, setRemoving] = useState<Member | null>(null)
  const [link, setLink] = useState<{ name: string; link: string } | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)

  const signIn = useMemberSignIn(organization?.id)
  const members = useMemo(() => withSignIn(data ?? [], signIn.data), [data, signIn.data])
  const stats = useMemo(() => teamStats(members), [members])
  const visible = useMemo(() => filterMembers(members, { query, role, status: statusFilter }), [members, query, role, statusFilter])

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
      {members.length > 0 ? (
        <div className={table.stats}>
          <StatCard value={stats.active} label="Membres actifs" />
          <StatCard value={stats.invited} label="Invités en attente" />
          <StatCard value={formatHours(stats.weeklyHours)} label="Capacité de l’équipe" hint="par semaine" />
        </div>
      ) : null}
      <ListToolbar
        search={{ value: query, onChange: setQuery, label: 'Rechercher un membre', placeholder: 'Nom ou email' }}
        activeFilterCount={activeTeamFilterCount({ role, status: statusFilter })}
        onResetFilters={() => {
          setRole('')
          setStatusFilter('')
        }}
        onAdd={orgId ? () => setInviting(true) : undefined}
        addLabel="Inviter un membre"
        filters={
          <>
            <Field label="Rôle">
              <Select value={role} onChange={(e) => setRole(e.target.value as RoleFilter)}>
                <option value="">Tous les rôles</option>
                {MEMBER_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {LABELS.memberRole[r]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Statut">
              <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as TeamStatusFilter)}>
                <option value="">Actifs et invités</option>
                <option value="active">Actifs</option>
                <option value="invited">Invités</option>
                <option value="removed">Retirés</option>
              </Select>
            </Field>
          </>
        }
      />

      {isLoading || !orgId ? (
        <LoadingState label="Chargement de l’équipe…" />
      ) : isError ? (
        <ErrorState message="Impossible de charger l’équipe." onRetry={() => void refetch()} />
      ) : visible.length === 0 ? (
        <EmptyState
          title={members.length === 0 ? 'Aucun membre' : 'Aucun membre ne correspond.'}
          text={members.length === 0 ? 'Invite le premier membre de l’équipe.' : 'Change la recherche ou les filtres.'}
        />
      ) : (
        <table className={table.table}>
          <thead>
            <tr>
              <th scope="col">Membre</th>
              <th scope="col">Rôle</th>
              <th scope="col">Compétences</th>
              <th scope="col">Capacité</th>
              <th scope="col">Statut</th>
              <th scope="col" className={table.actionsCell}>
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((member) => {
              const status = memberStatus(member)
              const skills = skillsSummary(member.skills)
              const unavailable = unavailableText(member.unavailable_weekdays)
              const block = removalBlock(member, me?.id, members)
              const items: ActionsMenuItem[] =
                status === 'removed'
                  ? [{ label: 'Réintégrer', onSelect: () => void restore(member), disabled: pendingId !== null }]
                  : [
                      { label: 'Modifier', onSelect: () => setEditing(member) },
                      ...(status === 'invited'
                        ? [{ label: 'Nouveau lien', onSelect: () => void newLink(member), disabled: pendingId !== null }]
                        : []),
                      {
                        label: 'Retirer',
                        tone: 'danger' as const,
                        disabled: block !== null,
                        hint: block ? REMOVAL_BLOCK_TEXT[block] : undefined,
                        onSelect: () => setRemoving(member),
                      },
                    ]
              return (
                <tr key={member.id} className={[table.row, status === 'removed' ? table.inactive : ''].filter(Boolean).join(' ')}>
                  <td>
                    <span className={[styles.member, status === 'removed' ? styles.removed : ''].filter(Boolean).join(' ')}>
                      <Avatar name={member.name} />
                      <span className={styles.identity}>
                        <span className={table.primary}>
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
                  <td className={table.actionsCell}>
                    <ActionsMenu label={`Actions pour ${member.name}`} items={items} />
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
