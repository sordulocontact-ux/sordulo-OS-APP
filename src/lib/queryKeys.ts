/** TanStack Query keys, shared by every feature so invalidations line up. */
export const queryKeys = {
  currentMember: (userId: string) => ['current-member', userId] as const,
  members: (organizationId: string) => ['members', organizationId] as const,
  projects: () => ['projects'] as const,
  project: (projectId: string) => ['project', projectId] as const,
  inputs: (projectId: string) => ['inputs', projectId] as const,
  input: (inputId: string) => ['input', inputId] as const,
  tickets: (projectId: string) => ['tickets', projectId] as const,
  inputTickets: (inputId: string) => ['input-tickets', inputId] as const,
  tasks: (projectId: string) => ['tasks', projectId] as const,
}
