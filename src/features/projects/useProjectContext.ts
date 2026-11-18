import { useOutletContext } from 'react-router-dom'
import type { ProjectWithClient } from './types'

export interface ProjectOutletContext {
  project: ProjectWithClient
}

/** For tab components rendered inside <ProjectPage>'s <Outlet />. */
export function useProjectContext(): ProjectOutletContext {
  return useOutletContext<ProjectOutletContext>()
}
