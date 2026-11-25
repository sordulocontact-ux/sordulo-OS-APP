/**
 * TESTS SEULEMENT. Stockage Supabase simulé en mémoire (upload, download, move, copy, remove, exists), avec
 * des refus programmables par opération, et ajout d'identifiants aux insertions de fake-supabase (qui n'en
 * génère que pour les membres). Sans import : utilisable par les tests de l'API et du front.
 */
type Row = Record<string, unknown>
type StorageOperation = 'upload' | 'download' | 'move' | 'copy' | 'remove' | 'exists'

interface StorageError {
  message: string
  statusCode?: string
}

export class FakeStorage {
  readonly objects = new Map<string, Blob>()
  readonly calls: { operation: StorageOperation; args: string[] }[] = []
  private readonly refusals = new Map<StorageOperation, ((args: string[]) => boolean) | true>()

  /** Les prochains appels `operation` (tous, ou ceux dont les arguments vérifient `when`) échouent. */
  refuse(operation: StorageOperation, when?: (args: string[]) => boolean): void {
    this.refusals.set(operation, when ?? true)
  }

  allow(operation: StorageOperation): void {
    this.refusals.delete(operation)
  }

  private refused(operation: StorageOperation, args: string[]): StorageError | null {
    this.calls.push({ operation, args })
    const rule = this.refusals.get(operation)
    if (rule === true || (rule && rule(args))) return { message: `new row violates row-level security policy (${operation})`, statusCode: '403' }
    return null
  }

  from(_bucket: string) {
    return {
      upload: async (path: string, body: Blob | string, _options?: unknown) => {
        const error = this.refused('upload', [path])
        if (error) return { data: null, error }
        if (this.objects.has(path)) return { data: null, error: { message: 'The resource already exists', statusCode: '409' } }
        this.objects.set(path, typeof body === 'string' ? new Blob([body]) : body)
        return { data: { path, id: path, fullPath: `files/${path}` }, error: null }
      },
      download: async (path: string) => {
        const error = this.refused('download', [path])
        if (error) return { data: null, error }
        const blob = this.objects.get(path)
        return blob ? { data: blob, error: null } : { data: null, error: { message: 'Object not found', statusCode: '404' } }
      },
      move: async (from: string, to: string) => {
        const error = this.refused('move', [from, to])
        if (error) return { data: null, error }
        const blob = this.objects.get(from)
        if (!blob) return { data: null, error: { message: 'Object not found', statusCode: '404' } }
        if (this.objects.has(to)) return { data: null, error: { message: 'The resource already exists', statusCode: '409' } }
        this.objects.delete(from)
        this.objects.set(to, blob)
        return { data: { message: 'Successfully moved' }, error: null }
      },
      copy: async (from: string, to: string) => {
        const error = this.refused('copy', [from, to])
        if (error) return { data: null, error }
        const blob = this.objects.get(from)
        if (!blob) return { data: null, error: { message: 'Object not found', statusCode: '404' } }
        this.objects.set(to, blob)
        return { data: { path: to }, error: null }
      },
      remove: async (paths: string[]) => {
        const error = this.refused('remove', paths)
        if (error) return { data: null, error }
        const removed = paths.filter((p) => this.objects.delete(p))
        return { data: removed.map((name) => ({ name })), error: null }
      },
      exists: async (path: string) => {
        const error = this.refused('exists', [path])
        if (error) return { data: false, error }
        return { data: this.objects.has(path), error: null }
      },
    }
  }
}

interface InsertableQuery {
  insert: (rows: Row | Row[]) => unknown
}

/**
 * Ajoute `storage` au client simulé et des valeurs par défaut aux insertions (id, dates, et les défauts de
 * colonnes utiles au rangement) sur les tables données.
 */
export function attachFakeStorage(client: { from: (table: string) => unknown }, storage: FakeStorage, tables: readonly string[]): void {
  const originalFrom = client.from.bind(client)
  const defaults: Record<string, () => Row> = {
    project_files: () => ({ deleted_at: null, version: 1, change_summary: null }),
    file_intakes: () => ({ status: 'uploaded', proposal: null, confidence: null, error_message: null, filed_file_id: null, auto_filed: false, rule_id: null }),
    filing_rules: () => ({ revoked_at: null }),
  }
  client.from = (table: string) => {
    const query = originalFrom(table) as InsertableQuery
    if (tables.includes(table)) {
      const insert = query.insert.bind(query)
      query.insert = (rows: Row | Row[]) => {
        const list = (Array.isArray(rows) ? rows : [rows]).map((row) => {
          const now = new Date().toISOString()
          const id = (row.id as string | undefined) ?? crypto.randomUUID()
          const base: Row = { id, created_at: now, updated_at: now, ...(defaults[table]?.() ?? {}) }
          const filled = { ...base, ...row }
          if (table === 'project_files' && !filled.version_group_id) filled.version_group_id = id
          return filled
        })
        return insert(list)
      }
    }
    return query
  }
  Object.assign(client, { storage })
}
