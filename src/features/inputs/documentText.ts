/**
 * Turns a dropped document (PDF, Word, text, email…) into the text of a written input.
 * Extraction runs in the browser: the heavy libraries load only when a file of that type is dropped.
 */

export type DocumentKind = 'pdf' | 'docx' | 'text'

/** Same limit as the server (api/inputs/create.ts, RAW_TEXT_MAX_LENGTH). */
export const DOCUMENT_TEXT_MAX_LENGTH = 100_000

/** For the file picker. */
export const DOCUMENT_ACCEPT = '.pdf,.docx,.txt,.md,.markdown,.eml,.csv,.json,.html,.htm,.rtf'

const TEXT_EXTENSIONS = ['txt', 'md', 'markdown', 'eml', 'csv', 'json', 'html', 'htm', 'rtf']

export class DocumentError extends Error {}

function extension(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : ''
}

export function documentKind(fileName: string, mimeType = ''): DocumentKind | null {
  const ext = extension(fileName)
  if (ext === 'pdf' || mimeType === 'application/pdf') return 'pdf'
  if (ext === 'docx') return 'docx'
  if (TEXT_EXTENSIONS.includes(ext) || mimeType.startsWith('text/')) return 'text'
  return null
}

/** Entry title: the file name without its extension (« Retours Ibé v2.pdf » → « Retours Ibé v2 »). */
export function titleFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim()
  return (base || fileName).slice(0, 200)
}

/** Removes markup and noise so the analysis reads clean text. */
export function normalizeText(raw: string, ext = ''): string {
  let text = raw.replace(/\r\n?/g, '\n')
  if (ext === 'html' || ext === 'htm') {
    text = text
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
  }
  if (ext === 'rtf') {
    text = text
      .replace(/\\par[d]?/g, '\n')
      .replace(/\{\\\*[^}]*\}|\\[a-z]+-?\d* ?|[{}]/gi, '')
  }
  return text
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function extractPdf(file: File): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf')
  const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()))
  const { text } = await extractText(pdf, { mergePages: true })
  return text
}

async function extractDocx(file: File): Promise<string> {
  const mammoth = await import('mammoth')
  const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
  return value
}

/** Extracted, cleaned text. Throws DocumentError (message in French) when nothing usable comes out. */
export async function extractDocumentText(file: File): Promise<string> {
  const kind = documentKind(file.name, file.type)
  if (!kind) {
    throw new DocumentError(`« ${file.name} » : format non pris en charge (PDF, Word .docx ou texte).`)
  }
  let raw: string
  try {
    raw = kind === 'pdf' ? await extractPdf(file) : kind === 'docx' ? await extractDocx(file) : await file.text()
  } catch {
    throw new DocumentError(`« ${file.name} » : impossible de lire ce fichier.`)
  }
  const text = normalizeText(raw, extension(file.name))
  if (!text) {
    throw new DocumentError(
      kind === 'pdf'
        ? `« ${file.name} » : aucun texte trouvé (PDF scanné ?). Copie le texte dans un retour écrit.`
        : `« ${file.name} » : le fichier est vide.`,
    )
  }
  if (text.length > DOCUMENT_TEXT_MAX_LENGTH) {
    throw new DocumentError(`« ${file.name} » : trop long (plus de ${DOCUMENT_TEXT_MAX_LENGTH.toLocaleString('fr-FR')} caractères).`)
  }
  return text
}

// ---------------------------------------------------------------------------
// Drag and drop: files and folders
// ---------------------------------------------------------------------------

function readEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject))
}

function entryFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject))
}

async function walk(entry: FileSystemEntry, out: File[]): Promise<void> {
  if (entry.name.startsWith('.')) return
  if (entry.isFile) {
    out.push(await entryFile(entry as FileSystemFileEntry))
  } else if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader()
    // readEntries returns batches until an empty one.
    for (let batch = await readEntries(reader); batch.length > 0; batch = await readEntries(reader)) {
      for (const child of batch) await walk(child, out)
    }
  }
}

/** All files of a drop, folders included (recursively), hidden files skipped. */
export async function filesFromDrop(data: DataTransfer): Promise<File[]> {
  const entries = Array.from(data.items)
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => Boolean(entry))
  if (entries.length === 0) return Array.from(data.files)
  const files: File[] = []
  for (const entry of entries) await walk(entry, files)
  return files
}

/** True when the drag carries files (not text or a link). */
export function dragHasFiles(data: DataTransfer | null): boolean {
  return Boolean(data && Array.from(data.types).includes('Files'))
}
