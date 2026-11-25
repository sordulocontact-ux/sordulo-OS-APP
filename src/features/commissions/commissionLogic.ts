import { formatMoney } from '../../shared/billing'
import { LABELS, type Commission, type CommissionPlan, type CommissionStatus, type MemberRole } from '../../shared/types'

/** Commission avec les noms nécessaires à l'affichage (jointures : l'apporteur ne lit ni clients ni factures). */
export interface CommissionRow extends Commission {
  /** Société du prospect (lisible par l'apporteur et l'agence). */
  prospect: { company: string } | null
  /** Client (lisible par admin et finance seulement : la finance ne lit pas les prospects). */
  client: { name: string } | null
}

/** Nom affiché : société du prospect, sinon client, sinon un tiret. */
export function commissionCompany(row: Pick<CommissionRow, 'prospect' | 'client'>): string {
  return row.prospect?.company ?? row.client?.name ?? 'Société inconnue'
}

export interface CommissionTotals {
  /** Montants en centimes, avoirs (négatifs) déduits ; les commissions annulées ne comptent pas. */
  due: number
  invoiced: number
  paid: number
}

export function commissionTotals(rows: readonly Pick<Commission, 'status' | 'amount_cents'>[]): CommissionTotals {
  const totals: CommissionTotals = { due: 0, invoiced: 0, paid: 0 }
  for (const row of rows) {
    if (row.status === 'due') totals.due += row.amount_cents
    else if (row.status === 'invoiced') totals.invoiced += row.amount_cents
    else if (row.status === 'paid') totals.paid += row.amount_cents
  }
  return totals
}

/** Admin et finance changent le statut ; l'apporteur lit seulement (la RLS l'impose). */
export function canChangeCommissionStatus(role: MemberRole | null | undefined): boolean {
  return role === 'admin' || role === 'finance'
}

export const COMMISSION_STATUS_TONES = {
  due: 'warning',
  invoiced: 'info',
  paid: 'success',
  cancelled: 'neutral',
} as const satisfies Record<CommissionStatus, string>

const STATUS_VERBS: Record<CommissionStatus, string> = {
  due: 'Remettre à « Due »',
  invoiced: 'Marquer comme facturée',
  paid: 'Marquer comme payée',
  cancelled: 'Annuler la commission',
}

/** Changements de statut proposés depuis un statut : tous sauf le statut actuel. */
export function statusActions(current: CommissionStatus): { status: CommissionStatus; label: string }[] {
  return (Object.keys(STATUS_VERBS) as CommissionStatus[])
    .filter((s) => s !== current)
    .map((status) => ({ status, label: STATUS_VERBS[status] }))
}

export interface CommissionFilters {
  query: string
  /** Vide = tous. */
  status: CommissionStatus | ''
  /** Id de l'apporteur, vide = tous. */
  member: string
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

export function filterCommissions(rows: readonly CommissionRow[], filters: CommissionFilters): CommissionRow[] {
  const q = normalize(filters.query)
  return rows.filter(
    (row) =>
      (filters.status === '' || row.status === filters.status) &&
      (filters.member === '' || row.member_id === filters.member) &&
      (q === '' || normalize(commissionCompany(row)).includes(q)),
  )
}

export function parseStatusParam(value: string | null): CommissionStatus | '' {
  return value !== null && value in LABELS.commissionStatus ? (value as CommissionStatus) : ''
}

/** Montant signé : « -120,00 € » pour un avoir déduit. */
export function formatAmount(cents: number): string {
  return formatMoney(cents)
}

/** Barème en une phrase par tranche : « 12 % jusqu'à 3 000 € », « 8 % au-delà ». */
export function describeTiers(tiers: CommissionPlan['tiers']): string[] {
  let previous: number | null = null
  return tiers.map((tier) => {
    const rate = `${formatRate(tier.rate)} %`
    const text: string =
      tier.up_to_cents === null
        ? previous === null
          ? `${rate} sur tout l’encaissé`
          : `${rate} au-delà de ${formatMoney(previous)}`
        : `${rate} ${previous === null ? 'jusqu’à' : `de ${formatMoney(previous)} à`} ${formatMoney(tier.up_to_cents)}`
    previous = tier.up_to_cents
    return text
  })
}

function formatRate(rate: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(rate)
}

/** Règles de l'apporteur, écrites à partir de son barème (rien n'est en dur : tout vient de commission_plans). */
export function planRules(
  plan: Pick<CommissionPlan, 'tiers' | 'followup_rate' | 'sign_window_months' | 'followup_window_months'>,
): string[] {
  return [
    `Premier devis signé : barème par tranches sur l’encaissé HT de ce devis, hors frais refacturés (${describeTiers(plan.tiers).join(', ')}).`,
    `Devis suivants : ${formatRate(plan.followup_rate)} % de l’encaissé HT, pour les devis signés dans les ${plan.followup_window_months} mois qui suivent le premier.`,
    `Client apporté : enregistré à ta date d’enregistrement, et il doit signer son premier devis dans les ${plan.sign_window_months} mois.`,
  ]
}

/** Règles communes à tous les barèmes. */
export const GENERAL_RULES: readonly string[] = [
  'La commission est due à l’encaissement de la facture, et payée par l’associé qui a encaissé.',
  'Un remboursement (avoir) déduit la commission correspondante : elle apparaît alors en négatif.',
]
