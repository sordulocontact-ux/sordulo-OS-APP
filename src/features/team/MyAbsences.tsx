import { useCurrentMember } from '../auth'
import { AbsencesEditor } from './AbsencesEditor'

/** Mes absences : chacun gère les siennes (école, congé, autre). À monter dans le menu du compte ou la page Mes tâches. */
export function MyAbsences() {
  const { member } = useCurrentMember()
  if (!member) return null
  return <AbsencesEditor memberId={member.id} title="Mes absences" />
}
