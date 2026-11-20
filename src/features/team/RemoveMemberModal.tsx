import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button, Modal, useToast } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { queryKeys } from '../../lib/queryKeys'
import type { Member } from '../../shared/types'
import { translateMemberError } from './teamLogic'
import styles from './TeamPage.module.css'

export interface RemoveMemberModalProps {
  member: Member
  onClose: () => void
}

export function RemoveMemberModal({ member, onClose }: RemoveMemberModalProps) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const { error: rpcError } = await supabase.rpc('remove_member', { p_member_id: member.id })
      if (rpcError) throw rpcError
      void queryClient.invalidateQueries({ queryKey: queryKeys.members(member.organization_id) })
      void queryClient.invalidateQueries({ queryKey: ['tasks'] })
      toast.success(`${member.name} a été retiré.`)
      onClose()
    } catch (e) {
      setError(translateMemberError(e, 'Impossible de retirer ce membre. Réessaie.'))
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!busy}
      title={`Retirer ${member.name} ?`}
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button variant="danger" onClick={() => void confirm()} loading={busy}>
            Retirer
          </Button>
        </>
      }
    >
      <ul className={styles.help}>
        <li>{member.name} ne pourra plus se connecter.</li>
        <li>Ses tâches non terminées passent en « non attribuée ».</li>
        <li>Son historique reste (entrées, tâches terminées).</li>
        <li>Tu pourras le réintégrer quand tu veux.</li>
      </ul>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </Modal>
  )
}
