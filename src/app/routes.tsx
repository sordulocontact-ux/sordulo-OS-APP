import { Navigate, Route, Routes } from 'react-router-dom'
import { LoginPage } from '../features/auth/LoginPage'
import { MemberGate } from '../features/auth/MemberGate'
import { RequireAuth } from '../features/auth/RequireAuth'
import { DesktopPromptRoute } from '../features/desktop/DesktopPromptRoute'
import { InputDetailPage } from '../features/inputs/InputDetailPage'
import { InputsTab } from '../features/inputs/InputsTab'
import { ProjectPage } from '../features/projects/ProjectPage'
import { ProjectsPage } from '../features/projects/ProjectsPage'
import { ReviewPage } from '../features/review/ReviewPage'
import { TasksTab } from '../features/tasks/TasksTab'
import { TicketsTab } from '../features/tickets/TicketsTab'
import { AppLayout } from './AppLayout'
import { NotFoundPage } from './NotFoundPage'

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/desktop/prompt" element={<DesktopPromptRoute />} />
      <Route
        element={
          <RequireAuth>
            <MemberGate>
              <AppLayout />
            </MemberGate>
          </RequireAuth>
        }
      >
        <Route path="/" element={<ProjectsPage />} />
        <Route path="/projects/:projectId" element={<ProjectPage />}>
          <Route index element={<Navigate to="tickets" replace />} />
          <Route path="tickets" element={<TicketsTab />} />
          <Route path="tasks" element={<TasksTab />} />
          <Route path="inputs" element={<InputsTab />} />
        </Route>
        <Route path="/projects/:projectId/inputs/:inputId" element={<InputDetailPage />} />
        <Route path="/projects/:projectId/inputs/:inputId/review" element={<ReviewPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
