import { lazy, Suspense } from 'react'
import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { LoginPage } from '../features/auth/LoginPage'
import { MemberGate } from '../features/auth/MemberGate'
import { RequireAuth } from '../features/auth/RequireAuth'
import { RequireRole } from '../features/auth/RequireRole'
import { ADMIN_ROLES, CLIENT_READ_ROLES, FINANCE_ROLES, PROJECT_ROLES, PROSPECT_ROLES } from '../features/auth/roles'
import { ConnectorsPage } from '../features/connectors/ConnectorsPage'
import { HomePage } from '../features/home/HomePage'
import { InvoicePage } from '../features/invoices/InvoicePage'
import { InvoicePrintPage } from '../features/invoices/InvoicePrintPage'
import { InvoicesPage } from '../features/invoices/InvoicesPage'
import { ProspectPage } from '../features/prospects/ProspectPage'
import { ProspectsPage } from '../features/prospects/ProspectsPage'
import { QuotePage } from '../features/quotes/QuotePage'
import { QuotePrintPage } from '../features/quotes/QuotePrintPage'
import { QuotesPage } from '../features/quotes/QuotesPage'
import { CallsPage } from '../features/calls/CallsPage'
import { ClientPage } from '../features/clients/ClientPage'
import { ClientsPage } from '../features/clients/ClientsPage'
import { SettingsPage } from '../features/settings/SettingsPage'
import { TeamPage } from '../features/team/TeamPage'
import { DesktopPromptRoute } from '../features/desktop/DesktopPromptRoute'
import { InputDetailPage } from '../features/inputs/InputDetailPage'
import { InputsTab } from '../features/inputs/InputsTab'
import { ProjectPage } from '../features/projects/ProjectPage'
import { ProjectsPage } from '../features/projects/ProjectsPage'
import { ReviewPage } from '../features/review/ReviewPage'
import { TasksTab } from '../features/tasks/TasksTab'
import { TicketsTab } from '../features/tickets/TicketsTab'
import type { MemberRole } from '../shared/types'
import { AppLayout } from './AppLayout'
import { NotFoundPage } from './NotFoundPage'

/** Pages réservées à certains rôles (la RLS reste la vraie protection). */
function Guard({ roles }: { roles: readonly MemberRole[] }) {
  return (
    <RequireRole roles={roles}>
      <Outlet />
    </RequireRole>
  )
}

/** Labo de l'île : développement seulement (la condition est remplacée à la compilation, le code n'entre pas dans le build). */
const IslandLab = import.meta.env.DEV ? lazy(() => import('../features/island/lab/IslandLab')) : null

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/desktop/prompt" element={<DesktopPromptRoute />} />
      {/* Aperçus A4 imprimables : hors de la barre latérale. */}
      <Route
        element={
          <RequireAuth>
            <MemberGate>
              <Guard roles={FINANCE_ROLES} />
            </MemberGate>
          </RequireAuth>
        }
      >
        <Route path="/quotes/:quoteId/print" element={<QuotePrintPage />} />
        <Route path="/invoices/:invoiceId/print" element={<InvoicePrintPage />} />
      </Route>
      {IslandLab && (
        <Route
          path="/desktop/ile-labo"
          element={
            <Suspense fallback={null}>
              <IslandLab />
            </Suspense>
          }
        />
      )}
      <Route
        element={
          <RequireAuth>
            <MemberGate>
              <AppLayout />
            </MemberGate>
          </RequireAuth>
        }
      >
        <Route path="/" element={<HomePage />} />
        <Route element={<Guard roles={CLIENT_READ_ROLES} />}>
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/clients" element={<ClientsPage />} />
          <Route path="/clients/:clientId" element={<ClientPage />} />
        </Route>
        <Route element={<Guard roles={PROJECT_ROLES} />}>
          <Route path="/projects/:projectId" element={<ProjectPage />}>
            <Route index element={<Navigate to="tickets" replace />} />
            <Route path="tickets" element={<TicketsTab />} />
            <Route path="tasks" element={<TasksTab />} />
            <Route path="inputs" element={<InputsTab />} />
          </Route>
          <Route path="/projects/:projectId/inputs/:inputId" element={<InputDetailPage />} />
          <Route path="/projects/:projectId/inputs/:inputId/review" element={<ReviewPage />} />
          <Route path="/calls" element={<CallsPage />} />
        </Route>
        <Route element={<Guard roles={FINANCE_ROLES} />}>
          <Route path="/quotes" element={<QuotesPage />} />
          <Route path="/quotes/:quoteId" element={<QuotePage />} />
          <Route path="/invoices" element={<InvoicesPage />} />
          <Route path="/invoices/:invoiceId" element={<InvoicePage />} />
        </Route>
        <Route element={<Guard roles={PROSPECT_ROLES} />}>
          <Route path="/prospects" element={<ProspectsPage />} />
          <Route path="/prospects/:prospectId" element={<ProspectPage />} />
        </Route>
        <Route element={<Guard roles={ADMIN_ROLES} />}>
          <Route path="/team" element={<TeamPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/connectors" element={<ConnectorsPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
