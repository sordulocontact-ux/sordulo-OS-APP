import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button, EmptyState, ErrorState, Field, LoadingState, Modal, TextInput } from '../../components/ui'
import { MCP_TOKEN_NAME_MAX, lastUsedLabel, mcpAddCommand, mcpEndpoint, tokenNameError } from './mcpTokens'
import type { CreatedMcpToken, McpTokensApi } from './useMcpTokens'
import styles from './McpTokensModal.module.css'

const FORM_ID = 'mcp-token-form'
const TOKEN_PLACEHOLDER = '<jeton>'

function messageOf(e: unknown): string {
  return e instanceof Error && e.message ? e.message : 'L’opération a échoué. Réessayez.'
}

/** Bouton « Copier » : « Copié » pendant 2 s, message si le presse-papiers est refusé. */
function CopyButton({ text, label }: { text: string; label: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<number | null>(null)
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
  }, [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setStatus('copied')
    } catch {
      setStatus('failed')
    }
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setStatus('idle'), 2000)
  }

  return (
    <span className={styles.copy}>
      <Button size="sm" onClick={() => void copy()}>
        {status === 'copied' ? 'Copié' : label}
      </Button>
      <span className={styles.copyStatus} role="status" aria-live="polite">
        {status === 'failed' ? 'Copie refusée par le navigateur : sélectionnez le texte et copiez-le.' : ''}
      </span>
    </span>
  )
}

function CodeBlock({ code, label }: { code: string; label: string }) {
  return (
    <div className={styles.codeRow}>
      <code className={styles.code} translate="no">
        {code}
      </code>
      <CopyButton text={code} label={label} />
    </div>
  )
}

export function McpTokensModal({ open, onClose, mcp }: { open: boolean; onClose: () => void; mcp: McpTokensApi }) {
  const [name, setName] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [created, setCreated] = useState<CreatedMcpToken | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const endpoint = mcpEndpoint(import.meta.env.VITE_API_BASE_URL, window.location.origin)
  const { create, revoke } = mcp

  // Le jeton en clair ne reste pas en mémoire une fois la fenêtre fermée.
  function close() {
    setName('')
    setNameError(null)
    setCreated(null)
    setConfirming(null)
    create.reset()
    revoke.reset()
    onClose()
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const problem = tokenNameError(name)
    setNameError(problem)
    if (problem) return
    try {
      setCreated(await create.mutateAsync(name))
      setName('')
    } catch {
      // Message affiché sous le formulaire (create.error).
    }
  }

  async function confirmRevoke(id: string) {
    try {
      await revoke.mutateAsync(id)
      setConfirming(null)
    } catch {
      // Message affiché dans la liste (revoke.error).
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Serveur MCP Sordulo OS"
      dismissible={!create.isPending && !revoke.isPending}
      actions={
        <Button variant="ghost" onClick={close} disabled={create.isPending || revoke.isPending}>
          Fermer
        </Button>
      }
    >
      <div className={styles.body}>
        <p className={styles.muted}>
          Branchez Claude Code sur Sordulo OS : Claude peut chercher, lire vos projets, tâches et devis, créer et modifier des tâches,
          avec exactement vos droits. Chaque jeton est personnel : révoquez-le si un ordinateur est perdu.
        </p>

        {created ? (
          <section className={styles.created} aria-labelledby="mcp-created-title">
            <h3 id="mcp-created-title" className={styles.sectionTitle}>
              Jeton « {created.name} » créé
            </h3>
            <p className={styles.warning}>Copiez-le maintenant : il ne sera plus jamais affiché.</p>
            <CodeBlock code={created.token} label="Copier le jeton" />
            <p className={styles.muted}>Puis lancez cette commande dans un terminal :</p>
            <CodeBlock code={mcpAddCommand(endpoint, created.token)} label="Copier la commande" />
          </section>
        ) : null}

        <section aria-labelledby="mcp-new-title">
          <h3 id="mcp-new-title" className={styles.sectionTitle}>
            Nouveau jeton
          </h3>
          <form id={FORM_ID} className={styles.form} onSubmit={submit} noValidate>
            <Field label="Nom du jeton" hint="Pour le reconnaître dans la liste, par exemple « Claude Code du MacBook »." error={nameError}>
              <TextInput
                value={name}
                maxLength={MCP_TOKEN_NAME_MAX}
                onChange={(e) => {
                  setName(e.target.value)
                  if (nameError) setNameError(null)
                }}
                autoComplete="off"
                disabled={create.isPending}
              />
            </Field>
            <div>
              <Button type="submit" variant="primary" loading={create.isPending}>
                Créer le jeton
              </Button>
            </div>
            {create.isError ? (
              <p className={styles.error} role="alert">
                {messageOf(create.error)}
              </p>
            ) : null}
          </form>
        </section>

        <section aria-labelledby="mcp-howto-title">
          <h3 id="mcp-howto-title" className={styles.sectionTitle}>
            Mode d’emploi
          </h3>
          <ol className={styles.steps}>
            <li>Créez un jeton ci-dessus et copiez-le.</li>
            <li>Dans un terminal, lancez la commande en remplaçant {TOKEN_PLACEHOLDER} par le jeton.</li>
            <li>Dans Claude Code, demandez par exemple « Quelles sont mes tâches de la semaine sur Sordulo ? ».</li>
          </ol>
          <CodeBlock code={mcpAddCommand(endpoint, TOKEN_PLACEHOLDER)} label="Copier la commande" />
        </section>

        <section aria-labelledby="mcp-list-title">
          <h3 id="mcp-list-title" className={styles.sectionTitle}>
            Vos jetons
          </h3>
          {mcp.loading ? (
            <LoadingState label="Lecture des jetons…" />
          ) : mcp.loadFailed ? (
            <ErrorState message="Les jetons n’ont pas pu être lus." onRetry={mcp.retry} />
          ) : mcp.tokens.length === 0 ? (
            <EmptyState title="Aucun jeton actif" text="Créez-en un pour brancher Claude Code." />
          ) : (
            <ul className={styles.list}>
              {mcp.tokens.map((token) => (
                <li key={token.id} className={styles.row}>
                  <div className={styles.rowText}>
                    <span className={styles.rowName}>{token.name}</span>
                    <span className={styles.rowMeta}>
                      <code translate="no">{token.prefix}…</code> · {lastUsedLabel(token.last_used_at)}
                    </span>
                  </div>
                  {confirming === token.id ? (
                    <div className={styles.rowActions}>
                      <Button size="sm" variant="ghost" onClick={() => setConfirming(null)} disabled={revoke.isPending}>
                        Annuler
                      </Button>
                      <Button size="sm" variant="danger" loading={revoke.isPending} onClick={() => void confirmRevoke(token.id)}>
                        Révoquer définitivement
                      </Button>
                    </div>
                  ) : (
                    <Button size="sm" onClick={() => setConfirming(token.id)} aria-label={`Révoquer le jeton ${token.name}`} disabled={revoke.isPending}>
                      Révoquer
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {revoke.isError ? (
            <p className={styles.error} role="alert">
              {messageOf(revoke.error)}
            </p>
          ) : null}
        </section>
      </div>
    </Modal>
  )
}
