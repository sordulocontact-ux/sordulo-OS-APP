/**
 * TESTS SEULEMENT. Client Supabase admin simulé en mémoire : tables (sous-ensemble de PostgREST
 * utilisé par l'API : select / insert / update / delete, eq / is / in / not is null, order, limit,
 * single / maybeSingle, count) et Auth admin (getUser, createUser, generateLink, listUsers,
 * getUserById, deleteUser). Reproduit le trigger « nouveau compte → membre relié par email » et l'unicité
 * des membres par organisation (email, compte).
 */
type Row = Record<string, unknown>
type Filter = (row: Row) => boolean
type Operation = 'select' | 'insert' | 'update' | 'delete'

export interface FakeError {
  message: string
  code?: string
  status?: number
}

interface QueryResult {
  data: unknown
  error: FakeError | null
  count: number | null
}

export interface FakeAuthUser {
  id: string
  email: string
  last_sign_in_at: string | null
}

const lower = (value: unknown): string => String(value ?? '').trim().toLowerCase()

function memberDefaults(): Row {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    user_id: null,
    role: 'membre',
    skills: {},
    weekly_capacity_hours: 35,
    unavailable_weekdays: [],
    invited_at: null,
    removed_at: null,
    created_at: now,
    updated_at: now,
  }
}

const DEFAULTS: Record<string, () => Row> = {
  members: memberDefaults,
}

/** Unicité des membres : (organisation, email insensible à la casse) et (organisation, compte). */
function violatesUnique(table: string, row: Row, rows: Row[]): boolean {
  if (table !== 'members') return false
  return rows.some(
    (other) =>
      other !== row &&
      other.organization_id === row.organization_id &&
      (lower(other.email) === lower(row.email) || (row.user_id != null && other.user_id === row.user_id)),
  )
}

class FakeQuery implements PromiseLike<QueryResult> {
  private operation: Operation = 'select'
  private payload: Row[] = []
  private changes: Row = {}
  private readonly filters: Filter[] = []
  private returning = false
  private countMode = false
  private head = false
  private mode: 'many' | 'single' | 'maybe' = 'many'
  private sort: { column: string; ascending: boolean } | null = null
  private max: number | null = null

  constructor(
    private readonly db: FakeSupabase,
    private readonly table: string,
  ) {}

  select(_columns = '*', options: { count?: 'exact'; head?: boolean } = {}): this {
    if (this.operation === 'select') {
      this.countMode = options.count === 'exact'
      this.head = options.head === true
    } else {
      this.returning = true
    }
    return this
  }

  insert(rows: Row | Row[]): this {
    this.operation = 'insert'
    this.payload = Array.isArray(rows) ? rows : [rows]
    return this
  }

  update(changes: Row): this {
    this.operation = 'update'
    this.changes = changes
    return this
  }

  delete(options: { count?: 'exact' } = {}): this {
    this.operation = 'delete'
    this.countMode = options.count === 'exact'
    return this
  }

  eq(column: string, value: unknown): this {
    this.filters.push((row) => row[column] === value)
    return this
  }

  is(column: string, value: null): this {
    this.filters.push((row) => (row[column] ?? null) === value)
    return this
  }

  in(column: string, values: readonly unknown[]): this {
    this.filters.push((row) => values.includes(row[column]))
    return this
  }

  not(column: string, operator: 'is', value: null): this {
    if (operator !== 'is') throw new Error(`fake-supabase : opérateur not.${operator} non simulé`)
    this.filters.push((row) => (row[column] ?? null) !== value)
    return this
  }

  order(column: string, options: { ascending?: boolean } = {}): this {
    this.sort = { column, ascending: options.ascending !== false }
    return this
  }

  limit(count: number): this {
    this.max = count
    return this
  }

  single(): this {
    this.mode = 'single'
    return this
  }

  maybeSingle(): this {
    this.mode = 'maybe'
    return this
  }

  then<R1 = QueryResult, R2 = never>(
    onfulfilled?: ((value: QueryResult) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve()
      .then(() => this.execute())
      .then(onfulfilled, onrejected)
  }

  private matching(): Row[] {
    return this.db.rows(this.table).filter((row) => this.filters.every((f) => f(row)))
  }

  private execute(): QueryResult {
    const injected = this.db.takeError(this.table, this.operation)
    if (injected) return { data: null, error: injected, count: null }
    let rows: Row[]
    switch (this.operation) {
      case 'select':
        rows = this.matching()
        break
      case 'insert': {
        const table = this.db.rows(this.table)
        rows = this.payload.map((row) => ({ ...(DEFAULTS[this.table]?.() ?? {}), ...row }))
        for (const row of rows) {
          if (violatesUnique(this.table, row, [...table, ...rows])) {
            return { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' }, count: null }
          }
        }
        table.push(...rows)
        break
      }
      case 'update':
        rows = this.matching()
        for (const row of rows) Object.assign(row, this.changes)
        break
      case 'delete': {
        rows = this.matching()
        const table = this.db.rows(this.table)
        for (const row of rows) table.splice(table.indexOf(row), 1)
        break
      }
    }
    return this.shape(rows)
  }

  private shape(all: Row[]): QueryResult {
    let rows = [...all]
    if (this.sort) {
      const { column, ascending } = this.sort
      rows.sort((a, b) => {
        const x = String(a[column] ?? '')
        const y = String(b[column] ?? '')
        return (x < y ? -1 : x > y ? 1 : 0) * (ascending ? 1 : -1)
      })
    }
    if (this.max !== null) rows = rows.slice(0, this.max)
    const count = this.countMode ? all.length : null
    const copies = rows.map((row) => structuredClone(row))
    if (this.operation !== 'select' && !this.returning) return { data: null, error: null, count }
    if (this.head) return { data: null, error: null, count }
    if (this.mode === 'many') return { data: copies, error: null, count }
    if (copies.length > 1) return { data: null, error: { message: 'plusieurs lignes', code: 'PGRST116' }, count }
    if (copies.length === 0 && this.mode === 'single') {
      return { data: null, error: { message: 'aucune ligne', code: 'PGRST116' }, count }
    }
    return { data: copies[0] ?? null, error: null, count }
  }
}

export class FakeSupabase {
  readonly tables: Record<string, Row[]> = {}
  readonly users: FakeAuthUser[] = []
  private readonly tokens = new Map<string, string>()
  private readonly errors = new Map<string, FakeError>()
  /** Nombre de liens de connexion générés (pour vérifier qu'aucun ne l'est). */
  generatedLinks = 0
  /** Échecs simulés de l'Auth admin, un appel chacun. */
  readonly authFailures: { createUser?: FakeError; generateLink?: FakeError } = {}

  rows(table: string): Row[] {
    this.tables[table] ??= []
    return this.tables[table]
  }

  seed(table: string, rows: Row[]): void {
    this.rows(table).push(...rows.map((row) => ({ ...(DEFAULTS[table]?.() ?? {}), ...row })))
  }

  /** La prochaine opération `operation` sur `table` échoue avec cette erreur. */
  failNext(table: string, operation: Operation, error: FakeError): void {
    this.errors.set(`${table}.${operation}`, error)
  }

  takeError(table: string, operation: Operation): FakeError | null {
    const key = `${table}.${operation}`
    const error = this.errors.get(key) ?? null
    this.errors.delete(key)
    return error
  }

  /** Crée un compte et renvoie un jeton de session valide pour lui. */
  addUser(email: string, options: { lastSignInAt?: string | null; token?: string } = {}): FakeAuthUser {
    const user: FakeAuthUser = { id: crypto.randomUUID(), email: lower(email), last_sign_in_at: options.lastSignInAt ?? null }
    this.users.push(user)
    if (options.token) this.tokens.set(options.token, user.id)
    return user
  }

  private findUserByEmail(email: string): FakeAuthUser | undefined {
    return this.users.find((u) => u.email === lower(email))
  }

  /** Trigger on_auth_user_created_link_member : relie les membres actifs non reliés portant cet email. */
  private linkMembers(user: FakeAuthUser): void {
    for (const member of this.rows('members')) {
      if (lower(member.email) === user.email && member.user_id == null && member.removed_at == null) member.user_id = user.id
    }
  }

  readonly client = {
    from: (table: string) => new FakeQuery(this, table),
    auth: {
      getUser: async (token: string) => {
        const user = this.users.find((u) => u.id === this.tokens.get(token))
        return user
          ? { data: { user }, error: null }
          : { data: { user: null }, error: { message: 'invalid JWT', status: 401 } satisfies FakeError }
      },
      admin: {
        createUser: async ({ email }: { email: string; email_confirm?: boolean }) => {
          const failure = this.authFailures.createUser
          if (failure) {
            delete this.authFailures.createUser
            return { data: { user: null }, error: failure }
          }
          if (this.findUserByEmail(email)) {
            return { data: { user: null }, error: { message: 'already registered', code: 'email_exists', status: 422 } satisfies FakeError }
          }
          const user = this.addUser(email)
          this.linkMembers(user)
          return { data: { user }, error: null }
        },
        generateLink: async ({ email, options }: { type: 'magiclink'; email: string; options?: { redirectTo?: string } }) => {
          const failure = this.authFailures.generateLink
          if (failure) {
            delete this.authFailures.generateLink
            return { data: { properties: null, user: null }, error: failure }
          }
          const user = this.findUserByEmail(email)
          if (!user) {
            return { data: { properties: null, user: null }, error: { message: 'User not found', code: 'user_not_found', status: 404 } satisfies FakeError }
          }
          this.generatedLinks++
          const redirect = encodeURIComponent(options?.redirectTo ?? '')
          return {
            data: { properties: { action_link: `https://supabase.test/auth/v1/verify?type=magiclink&token=t-${user.id}&redirect_to=${redirect}` }, user },
            error: null,
          }
        },
        listUsers: async ({ page = 1, perPage = 50 }: { page?: number; perPage?: number } = {}) => ({
          data: { users: this.users.slice((page - 1) * perPage, page * perPage) },
          error: null,
        }),
        getUserById: async (id: string) => {
          const user = this.users.find((u) => u.id === id)
          return user
            ? { data: { user }, error: null }
            : { data: { user: null }, error: { message: 'User not found', code: 'user_not_found', status: 404 } satisfies FakeError }
        },
        deleteUser: async (id: string) => {
          const index = this.users.findIndex((u) => u.id === id)
          if (index >= 0) this.users.splice(index, 1)
          for (const member of this.rows('members')) if (member.user_id === id) member.user_id = null
          return { data: {}, error: null }
        },
      },
    },
  }
}
