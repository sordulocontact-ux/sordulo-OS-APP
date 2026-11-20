import { useMemo } from 'react'
import { LoadingState } from '../../components/ui'
import briefcaseIcon from '../../assets/icons/briefcase.svg'
import fileTextIcon from '../../assets/icons/file-text.svg'
import receiptIcon from '../../assets/icons/receipt.svg'
import targetIcon from '../../assets/icons/target.svg'
import usersIcon from '../../assets/icons/users.svg'
import { todayIso } from '../../shared/billing'
import { ADMIN_ROLES, FINANCE_ROLES, PROJECT_ROLES, PROSPECT_ROLES, useHasRole } from '../auth/roles'
import { useCurrentMember } from '../auth/useCurrentMember'
import { HomeCard, SentenceText } from './HomeCard'
import { RevenueChart } from './RevenueChart'
import {
  acceptedQuoteSentence,
  activitySentence,
  busiestProjectSentence,
  financeSentence,
  firstName,
  followUpSentence,
  lastAcceptedQuote,
  lastMonths,
  monthlyRevenue,
  outstandingInvoices,
  outstandingSentence,
  pendingQuotes,
  pendingQuotesSentence,
  prospectActivity,
  prospectsToFollowUp,
  teamActivitySentence,
  teamSentence,
  workSentence,
  workSummary,
} from './homeLogic'
import { useHomeInvoices, useHomeProspects, useHomeQuotes, useHomeTeam, useHomeWork, useWeekStart } from './useHome'
import styles from './home.module.css'

interface CardProps {
  organizationId: string
}

function QuotesCard({ organizationId }: CardProps) {
  const query = useHomeQuotes(organizationId, true)
  const quotes = query.data ?? []
  const accepted = lastAcceptedQuote(quotes)
  return (
    <HomeCard icon={fileTextIcon} label="Devis" to="/quotes" linkLabel="Voir les devis" isLoading={query.isLoading} isError={query.isError} onRetry={() => void query.refetch()}>
      <SentenceText sentence={pendingQuotesSentence(pendingQuotes(quotes, todayIso()))} />
      {accepted ? <SentenceText sentence={acceptedQuoteSentence(accepted)} /> : null}
    </HomeCard>
  )
}

function InvoicesCard({ organizationId }: CardProps) {
  const query = useHomeInvoices(organizationId, true)
  return (
    <HomeCard icon={receiptIcon} label="Factures" to="/invoices" linkLabel="Voir les factures" isLoading={query.isLoading} isError={query.isError} onRetry={() => void query.refetch()}>
      <SentenceText sentence={outstandingSentence(outstandingInvoices(query.data ?? [], todayIso()))} />
    </HomeCard>
  )
}

function FinanceCard({ organizationId }: CardProps) {
  const query = useHomeInvoices(organizationId, true)
  const bars = useMemo(() => monthlyRevenue(query.data ?? [], lastMonths(new Date())), [query.data])
  const empty = bars.every((bar) => bar.collectedCents === 0 && bar.invoicedCents === 0)
  return (
    <HomeCard icon={briefcaseIcon} label="Finance" to="/invoices" linkLabel="Voir les factures" isLoading={query.isLoading} isError={query.isError} onRetry={() => void query.refetch()}>
      <SentenceText sentence={financeSentence(bars)} />
      {empty ? null : <RevenueChart bars={bars} />}
    </HomeCard>
  )
}

function ProspectsCard({ organizationId }: CardProps) {
  const query = useHomeProspects(organizationId, true)
  const weekStart = useWeekStart()
  const prospects = query.data ?? []
  const activity = prospectActivity(prospects, weekStart).slice(0, 2)
  return (
    <HomeCard icon={targetIcon} label="Prospection" to="/prospects" linkLabel="Voir la prospection" isLoading={query.isLoading} isError={query.isError} onRetry={() => void query.refetch()}>
      <SentenceText sentence={followUpSentence(prospectsToFollowUp(prospects, todayIso()))} />
      {activity.map((entry) => (
        <SentenceText key={entry.owner} sentence={activitySentence(entry)} />
      ))}
    </HomeCard>
  )
}

function WorkCard({ organizationId, memberId }: CardProps & { memberId: string }) {
  const query = useHomeWork(organizationId, memberId, true)
  const summary = workSummary(query.data ?? [])
  const busiest = busiestProjectSentence(summary)
  return (
    <HomeCard icon={briefcaseIcon} label="Mon travail" to="/projects" linkLabel="Voir les projets" isLoading={query.isLoading} isError={query.isError} onRetry={() => void query.refetch()}>
      <SentenceText sentence={workSentence(summary)} />
      {busiest ? <SentenceText sentence={busiest} /> : null}
    </HomeCard>
  )
}

function TeamCard({ organizationId }: CardProps) {
  const query = useHomeTeam(organizationId, true)
  return (
    <HomeCard icon={usersIcon} label="Équipe" to="/team" linkLabel="Voir l’équipe" isLoading={query.isLoading} isError={query.isError} onRetry={() => void query.refetch()}>
      <SentenceText sentence={teamSentence(query.data?.members ?? [])} />
      <SentenceText sentence={teamActivitySentence(query.data?.inProgress ?? 0)} />
    </HomeCard>
  )
}

export function HomePage() {
  const { member, isLoading } = useCurrentMember()
  const showFinance = useHasRole(FINANCE_ROLES)
  const showProspects = useHasRole(PROSPECT_ROLES)
  const showWork = useHasRole(PROJECT_ROLES)
  const showTeam = useHasRole(ADMIN_ROLES)

  if (isLoading || !member) return <LoadingState />
  const organizationId = member.organization_id

  return (
    <section className={styles.page} aria-labelledby="home-title">
      <div>
        <h1 id="home-title" className={styles.title}>
          Bonjour <span className={styles.name}>{firstName(member.name)}</span>
        </h1>
        <p className={styles.subtitle}>Voici un aperçu rapide :</p>
      </div>
      <div className={styles.grid}>
        {showFinance ? <QuotesCard organizationId={organizationId} /> : null}
        {showFinance ? <InvoicesCard organizationId={organizationId} /> : null}
        {showFinance ? <FinanceCard organizationId={organizationId} /> : null}
        {showProspects ? <ProspectsCard organizationId={organizationId} /> : null}
        {showWork ? <WorkCard organizationId={organizationId} memberId={member.id} /> : null}
        {showTeam ? <TeamCard organizationId={organizationId} /> : null}
      </div>
    </section>
  )
}
