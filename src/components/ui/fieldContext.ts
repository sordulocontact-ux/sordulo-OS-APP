import { createContext, useContext } from 'react'

export interface FieldContextValue {
  id: string
  describedBy: string | undefined
  invalid: boolean
}

export const FieldContext = createContext<FieldContextValue | null>(null)

/** Props to spread on the control rendered inside a <Field>. Empty outside a Field. */
export function useFieldControlProps(): {
  id?: string
  'aria-describedby'?: string
  'aria-invalid'?: true
} {
  const ctx = useContext(FieldContext)
  if (!ctx) return {}
  return {
    id: ctx.id,
    'aria-describedby': ctx.describedBy,
    'aria-invalid': ctx.invalid || undefined,
  }
}
