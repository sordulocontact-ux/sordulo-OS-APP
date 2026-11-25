import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { ActionsMenu, Button, Card, Modal, TextInput, useToast } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { queryKeys } from '../../lib/queryKeys'
import type { Project } from '../../shared/types'
import { generatePortalToken, portalUrl, publicAppOrigin } from './portalLogic'
import styles from './PortalShareCard.module.css'

export interface PortalShareCardProps {
  project: Pick<Project, 'id' | 'name' | 'portal_token'>
}

type Confirm = 'regenerate' | 'disable' | null

function errorText(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
  if (code === '42501') return 'Tu n’as pas le droit de modifier ce projet.'
  const message =
    typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string' ? error.message : ''
  return message ? `Une erreur est survenue : ${message}` : 'Une erreur est survenue. Réessaie.'
}

/**
 * Carte « Portail client » de la page projet (admin, membre) : activer le lien secret, le copier,
 * le régénérer (l'ancien cesse de marcher) ou le désactiver.
 */
export function PortalShareCard({ project }: PortalShareCardProps) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const linkRef = useRef<HTMLDivElement>(null)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [feedback, setFeedback] = useState<string | null>(null)

  const setToken = useMutation({
    mutationFn: async (token: string | null) => {
      const { error } = await supabase.from('projects').update({ portal_token: token }).eq('id', project.id)
      if (error) throw error
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.project(project.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projects() }),
      ])
    },
  })

  const origin = publicAppOrigin(window.location.origin, import.meta.env.VITE_API_BASE_URL as string | undefined)
  const link = project.portal_token ? portalUrl(origin, project.portal_token) : null

  function change(token: string | null, message: string) {
    setFeedback(null)
    setToken.mutate(token, {
      onSuccess: () => {
        setConfirm(null)
        toast.success(message)
      },
      onError: (error) => toast.error(errorText(error)),
    })
  }

  async function copy() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setFeedback('Lien copié.')
      toast.success('Lien copié')
    } catch {
      const input = linkRef.current?.querySelector('input')
      input?.focus()
      input?.select()
      setFeedback('Copie impossible ici : le lien est sélectionné, copie-le avec Ctrl+C (ou Cmd+C).')
    }
  }

  return (
    <Card className={styles.card}>
      <div className={styles.header}>
        <h2 className={styles.title}>Portail client</h2>
        {link ? (
          <ActionsMenu
            label="Actions du portail client"
            items={[
              { label: 'Régénérer le lien', onSelect: () => setConfirm('regenerate') },
              { label: 'Désactiver le portail', tone: 'danger', onSelect: () => setConfirm('disable') },
            ]}
          />
        ) : null}
      </div>

      {link ? (
        <>
          <p className={styles.text}>
            Toute personne qui a ce lien voit l’avancement, les livrables, les devis, les contrats et les factures du projet, et
            peut commenter, valider, accepter et signer.
          </p>
          <div className={styles.linkRow} ref={linkRef}>
            <TextInput readOnly value={link} aria-label="Lien du portail client" onFocus={(e) => e.currentTarget.select()} />
            <Button variant="primary" onClick={() => void copy()}>
              Copier le lien
            </Button>
            <a className={styles.open} href={link} target="_blank" rel="noreferrer">
              Ouvrir
            </a>
          </div>
          <p className={styles.feedback} role="status">
            {feedback}
          </p>
        </>
      ) : (
        <>
          <p className={styles.text}>
            Un lien à envoyer au client : il suit l’avancement, commente et valide les maquettes, accepte les devis, signe les
            contrats et voit ses factures, sans compte et sans aller-retour par mail.
          </p>
          <div>
            <Button
              variant="primary"
              loading={setToken.isPending}
              onClick={() => change(generatePortalToken(), 'Portail activé : copie le lien et envoie-le au client')}
            >
              Activer le portail
            </Button>
          </div>
        </>
      )}

      <Modal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm === 'disable' ? 'Désactiver le portail ?' : 'Régénérer le lien ?'}
        actions={
          <>
            <Button onClick={() => setConfirm(null)}>Annuler</Button>
            <Button
              variant={confirm === 'disable' ? 'danger' : 'primary'}
              loading={setToken.isPending}
              onClick={() =>
                confirm === 'disable'
                  ? change(null, 'Portail désactivé : le lien ne marche plus')
                  : change(generatePortalToken(), 'Nouveau lien créé : l’ancien ne marche plus')
              }
            >
              {confirm === 'disable' ? 'Désactiver' : 'Régénérer'}
            </Button>
          </>
        }
      >
        <p className={styles.text}>
          {confirm === 'disable'
            ? `Le lien actuel de « ${project.name} » cessera de marcher. Tu pourras réactiver le portail plus tard, avec un nouveau lien.`
            : `Le lien actuel de « ${project.name} » cessera de marcher tout de suite. Envoie le nouveau lien au client.`}
        </p>
      </Modal>
    </Card>
  )
}
