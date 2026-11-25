/** Évènement de document qui ouvre la fenêtre de dépôt (`openFileDrop()`), comme la palette de recherche. */
export const OPEN_FILE_DROP_EVENT = 'sordulo:open-file-drop'

/** Ouvre la fenêtre « Déposer un fichier » (bouton de la barre latérale, page vide…). Des fichiers peuvent être passés. */
export function openFileDrop(files: File[] = []): void {
  document.dispatchEvent(new CustomEvent<File[]>(OPEN_FILE_DROP_EVENT, { detail: files }))
}
