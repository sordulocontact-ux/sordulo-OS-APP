import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { todayIso } from '../../shared/billing'
import type { ThresholdStatus } from '../../shared/thresholds'
import { useIssuers } from '../settings/useIssuers'
import { issuerThresholds, type FinanceInvoice } from './financeLogic'

export interface FinanceData {
  invoices: FinanceInvoice[]
  members: { id: string; name: string }[]
  /** Membres déclarés par projet. */
  projectMembers: Record<string, string[]>
}

const COLUMNS =
  'id, number, kind, status, issuer_id, project_id, client_id, credited_invoice_id, title, issue_date, due_date, paid_at, total_ht_cents, total_ttc_cents, client:clients(name)'

/**
 * Factures utiles à la page Finance pour `year` : émises ou payées dans l'année, plus toutes les émises non
 * payées (impayés d'années passées compris). Les avoirs dont la facture créditée n'est pas dans la liste
 * portent `credited_paid_at`. Admin et finance (la RLS vide le reste).
 */
export function useFinanceData(organizationId: string | undefined, year: number, enabled = true) {
  return useQuery({
    queryKey: ['finance', organizationId ?? '', year] as const,
    enabled: enabled && Boolean(organizationId),
    queryFn: async (): Promise<FinanceData> => {
      const start = `${year}-01-01`
      const [invoicesRes, membersRes, projectMembersRes] = await Promise.all([
        supabase
          .from('invoices')
          .select(COLUMNS)
          .neq('status', 'draft')
          .or(`status.eq.issued,issue_date.gte.${start},paid_at.gte.${start}T00:00:00Z`)
          .overrideTypes<FinanceInvoice[], { merge: false }>(),
        supabase.from('members').select('id, name').eq('organization_id', organizationId ?? '').overrideTypes<FinanceData['members'], { merge: false }>(),
        supabase.from('project_members').select('project_id, member_id').overrideTypes<{ project_id: string; member_id: string }[], { merge: false }>(),
      ])
      if (invoicesRes.error) throw invoicesRes.error
      if (membersRes.error) throw membersRes.error
      if (projectMembersRes.error) throw projectMembersRes.error

      const invoices = invoicesRes.data
      const known = new Set(invoices.map((i) => i.id))
      const missing = [...new Set(invoices.flatMap((i) => (i.kind === 'credit_note' && i.credited_invoice_id && !known.has(i.credited_invoice_id) ? [i.credited_invoice_id] : [])))]
      if (missing.length > 0) {
        const credited = await supabase.from('invoices').select('id, paid_at').in('id', missing).overrideTypes<{ id: string; paid_at: string | null }[], { merge: false }>()
        if (credited.error) throw credited.error
        const paidAt = new Map(credited.data.map((c) => [c.id, c.paid_at]))
        for (const i of invoices) {
          if (i.kind === 'credit_note' && i.credited_invoice_id && paidAt.has(i.credited_invoice_id)) i.credited_paid_at = paidAt.get(i.credited_invoice_id) ?? null
        }
      }

      const projectMembers: Record<string, string[]> = {}
      for (const row of projectMembersRes.data) (projectMembers[row.project_id] ??= []).push(row.member_id)
      return { invoices, members: membersRes.data, projectMembers }
    },
  })
}

export interface ThresholdAlert {
  issuerName: string
  status: ThresholdStatus
}

/** Jauge de seuil la plus préoccupante de l'année en cours (80 % ou plus), pour l'Accueil. */
export function useThresholdAlert(organizationId: string | undefined, enabled = true) {
  const year = Number(todayIso().slice(0, 4))
  const finance = useFinanceData(organizationId, year, enabled)
  const issuers = useIssuers(enabled ? organizationId : undefined)
  const rows = finance.data && issuers.data ? issuerThresholds(finance.data.invoices, issuers.data, year) : []
  const worst = rows
    .flatMap((r) => (r.worst ? [{ issuerName: r.issuer.display_name, status: r.worst }] : []))
    .sort((a, b) => (a.status.level === b.status.level ? b.status.ratio - a.status.ratio : a.status.level === 'exceeded' ? -1 : 1))[0]
  return {
    alert: (worst ?? null) as ThresholdAlert | null,
    isLoading: finance.isLoading || issuers.isLoading,
    isError: finance.isError || issuers.isError,
  }
}
