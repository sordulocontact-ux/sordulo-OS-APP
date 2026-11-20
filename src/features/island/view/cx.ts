/** Assemble des classes CSS en ignorant les valeurs vides. */
export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(' ')
}
