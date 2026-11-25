/** Clés TanStack Query de l'espace Fichiers (les dépôts utilisent `filingKeys` de src/lib/filing.ts). */
export const filesKeys = {
  all: ['files'] as const,
  project: (projectId: string) => ['files', 'project', projectId] as const,
  directory: (organizationId: string) => ['files', 'directory', organizationId] as const,
  signed: (path: string) => ['files', 'signed', path] as const,
  projectDocuments: (projectId: string) => ['files', 'documents', projectId] as const,
}
