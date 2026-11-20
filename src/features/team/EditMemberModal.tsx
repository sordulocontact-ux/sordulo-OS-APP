import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button, Field, Modal, Select, TextInput, useToast } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { queryKeys } from '../../lib/queryKeys'
import { LABELS, MEMBER_ROLES, SKILL_LEVEL_MAX, SKILL_LEVEL_MIN, SKILLS, WEEKDAYS, type Member, type MemberRole, type Skill, type Weekday } from '../../shared/types'
import { buildSkills, levelToSelect, parseCapacity, ROLE_HELP, translateMemberError } from './teamLogic'
import styles from './TeamPage.module.css'

const LEVELS = Array.from({ length: SKILL_LEVEL_MAX - SKILL_LEVEL_MIN + 1 }, (_, i) => SKILL_LEVEL_MIN + i)

export interface EditMemberModalProps {
  member: Member
  /** Id du membre connecté : modifier son propre rôle demande un avertissement et un rafraîchissement. */
  currentMemberId: string | undefined
  currentUserId: string | undefined
  onClose: () => void
}

export function EditMemberModal({ member, currentMemberId, currentUserId, onClose }: EditMemberModalProps) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [role, setRole] = useState<MemberRole>(member.role)
  const [levels, setLevels] = useState<Record<Skill, string>>({
    design: levelToSelect(member.skills.design),
    dev: levelToSelect(member.skills.dev),
  })
  const [capacity, setCapacity] = useState(String(member.weekly_capacity_hours))
  const [days, setDays] = useState<Weekday[]>(member.unavailable_weekdays)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [capacityError, setCapacityError] = useState<string | null>(null)

  const isSelf = member.id === currentMemberId
  const losesAdmin = isSelf && member.role === 'admin' && role !== 'admin'

  function toggleDay(day: Weekday) {
    setDays((current) => (current.includes(day) ? current.filter((d) => d !== day) : [...current, day]))
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setError(null)
    const parsed = parseCapacity(capacity)
    if ('error' in parsed) {
      setCapacityError(parsed.error)
      return
    }
    setCapacityError(null)
    setBusy(true)
    try {
      const { data, error: dbError } = await supabase
        .from('members')
        .update({
          role,
          skills: buildSkills(levels),
          weekly_capacity_hours: parsed.value,
          unavailable_weekdays: WEEKDAYS.filter((d) => days.includes(d)),
        })
        .eq('id', member.id)
        .select('id')
      if (dbError) throw dbError
      // La RLS ne renvoie pas d'erreur quand elle refuse un update : zéro ligne modifiée.
      if (!data || data.length === 0) throw new Error('row-level security')
      void queryClient.invalidateQueries({ queryKey: queryKeys.members(member.organization_id) })
      if (isSelf && currentUserId) void queryClient.invalidateQueries({ queryKey: queryKeys.currentMember(currentUserId) })
      toast.success('Membre modifié.')
      onClose()
    } catch (e) {
      setError(translateMemberError(e, 'Impossible d’enregistrer les modifications. Réessaie.'))
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!busy}
      title={`Modifier ${member.name}`}
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button variant="primary" type="submit" form="edit-member-form" loading={busy}>
            Enregistrer
          </Button>
        </>
      }
    >
      <form id="edit-member-form" className={styles.form} onSubmit={(e) => void onSubmit(e)} noValidate>
        <Field label="Rôle" hint={ROLE_HELP[role]}>
          <Select value={role} onChange={(e) => setRole(e.target.value as MemberRole)} disabled={busy}>
            {MEMBER_ROLES.map((value) => (
              <option key={value} value={value}>
                {LABELS.memberRole[value]}
              </option>
            ))}
          </Select>
        </Field>
        {losesAdmin ? (
          <p className={styles.warning} role="alert">
            Tu perdras l’accès à l’Équipe et aux Paramètres.
          </p>
        ) : null}

        {role !== 'admin' && role !== 'membre' ? <p className={styles.help}>Pas d’attribution automatique pour ce rôle.</p> : null}

        <div className={styles.levels}>
          {SKILLS.map((skill) => (
            <Field key={skill} label={`Niveau ${LABELS.skill[skill].toLowerCase()}`}>
              <Select value={levels[skill]} onChange={(e) => setLevels((c) => ({ ...c, [skill]: e.target.value }))} disabled={busy}>
                <option value="0">Ne pratique pas</option>
                {LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {level} sur {SKILL_LEVEL_MAX}
                  </option>
                ))}
              </Select>
            </Field>
          ))}
        </div>

        <Field label="Capacité (heures par semaine)" error={capacityError}>
          <TextInput type="number" min={0} max={80} step={0.5} inputMode="decimal" value={capacity} onChange={(e) => setCapacity(e.target.value)} disabled={busy} />
        </Field>

        <fieldset className={styles.days} disabled={busy}>
          <legend>Jours indisponibles chaque semaine</legend>
          <div className={styles.dayList}>
            {WEEKDAYS.map((day) => (
              <label key={day} className={styles.day}>
                <input type="checkbox" checked={days.includes(day)} onChange={() => toggleDay(day)} />
                {LABELS.weekday[day]}
              </label>
            ))}
          </div>
          <p className={styles.help}>Par exemple les jours d’école ou d’alternance.</p>
        </fieldset>

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  )
}
