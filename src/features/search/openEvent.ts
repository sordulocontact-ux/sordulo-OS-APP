/** Évènement de document qui ouvre la palette : `openCommandPalette()` ou `document.dispatchEvent(new Event(...))`. */
export const OPEN_PALETTE_EVENT = 'sordulo:open-command-palette'

/** Ouvre la palette de recherche (pour un bouton de l'en-tête, par exemple). */
export function openCommandPalette(): void {
  document.dispatchEvent(new Event(OPEN_PALETTE_EVENT))
}
