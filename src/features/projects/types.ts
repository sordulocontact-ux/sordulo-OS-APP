import type { Client, Project } from '../../shared/types'

export type ProjectWithClient = Project & { client: Client | null }
