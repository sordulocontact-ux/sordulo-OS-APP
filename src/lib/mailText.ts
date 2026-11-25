/**
 * Texte d'un mail pour l'analyse (source « gmail » de l'île) : HTML converti en texte, réponses citées et
 * signature retirées. Pur et testé (mailText.test.ts, sur de vrais exemples Gmail, Apple Mail et Outlook).
 *
 * Règle d'or : ne jamais couper le corps utile. Chaque coupe exige du texte avant elle, les signatures ne sont
 * retirées qu'en toute fin et quand elles sont courtes, et si le nettoyage ne laisse rien, on garde le texte
 * d'origine.
 *
 * - Réponses citées : coupées à la première ligne qui ouvre la citation (« Le … a écrit : », « On … wrote: »,
 *   « -----Original Message----- », bloc d'en-têtes « De : / Envoyé : / À : / Objet : » d'Outlook), puis le bloc
 *   final de lignes « > ». Les lignes « > » au milieu (réponse entre les lignes) sont gardées : elles donnent le
 *   contexte de la réponse.
 * - Transfert (« Forwarded message », « Message transféré », objet « Fwd: » / « TR: ») : le message transféré
 *   est gardé en entier ; seul ce qui précède est nettoyé.
 * - Signature : « -- », « Envoyé de mon iPhone », « Sent from my … », « Obtenir Outlook pour iOS », et une
 *   formule (« Cordialement ») suivie de quelques lignes courtes en toute fin.
 */

/** Lignes d'un transfert : tout ce qui suit est le message transféré, gardé tel quel. */
const FORWARD_MARKER =
  /^\s*-{3,}\s*(forwarded message|message transféré|message transfere|weitergeleitete nachricht|begin forwarded message)\s*-{0,}\s*:?\s*$|^\s*(début du message réexpédié|begin forwarded message)\s*:\s*$/i

/** Séparateurs de réponse d'Outlook et des anciens clients. */
const ORIGINAL_MARKER = /^\s*-{2,}\s*(original message|message d'origine|message d’origine|message original)\s*-{2,}\s*$/i

/** Trait de séparation d'Outlook avant les en-têtes du message cité. */
const UNDERSCORE_RULE = /^\s*_{10,}\s*$/

const HEADER_FROM = /^\s*\*?\s*(de|from|von)\s*\*?\s*:/i
const HEADER_OTHERS: readonly RegExp[] = [
  /^\s*\*?\s*(envoyé|envoye|sent|date|gesendet)\s*\*?\s*:/i,
  /^\s*\*?\s*(à|a|to|an)\s*\*?\s*:/i,
  /^\s*\*?\s*(objet|subject|betreff)\s*\*?\s*:/i,
  /^\s*\*?\s*(cc)\s*\*?\s*:/i,
]

/** « Le mar. 24 nov. 2026 à 18:02, Maël <mael@sordulo.fr> a écrit : » (une date, donc un chiffre). */
const WROTE_FR = /^\s*le\s.*\d.*\sa\s+écrit\s*:\s*$/i
const WROTE_EN = /^\s*on\s.*\d.*\swrote\s*:\s*$/i

/** Signatures des applications mobiles et d'Outlook. */
const MOBILE_SIGNATURE: readonly RegExp[] = [
  /^(envoyé|envoye)\s+(de|depuis)\s+(mon|ma|un|une)\s.{1,40}$/i,
  /^sent\s+from\s+(my\s.{1,40}|outlook.*|mail\s+for\s.{1,30}|yahoo\s+mail.*)$/i,
  /^(get|obtenir|télécharger|telecharger)\s+outlook\s+(for|pour)\s.{1,30}$/i,
]

/** Formules de fin : ce qui suit (si c'est court) est une signature. */
const CLOSER =
  /^(bien\s+|très\s+|tres\s+|trés\s+)?cordialement\b[\s,.!]*$|^bien\s+(à|a)\s+(vous|toi)\b[\s,.!]*$|^(sinc[eè]res\s+)?salutations\b[\s,.!]*$|^(best|kind|warm|warmest)\s+regards\b[\s,.!]*$|^regards\b[\s,.!]*$|^(best|cheers)[\s,.!]*$/i

/** Une signature après une formule de fin : au plus tant de lignes, chacune courte. */
const SIGNATURE_MAX_LINES = 6
const SIGNATURE_MAX_LINE_LENGTH = 60
/** Une formule de fin ne compte que dans les dernières lignes non vides. */
const CLOSER_WINDOW = 8
/** Après « -- », au plus tant de lignes (au-delà, ce n'est sans doute pas une signature). */
const DASH_SIGNATURE_MAX_LINES = 15

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  eacute: 'é',
  egrave: 'è',
  ecirc: 'ê',
  euml: 'ë',
  agrave: 'à',
  acirc: 'â',
  auml: 'ä',
  ccedil: 'ç',
  icirc: 'î',
  iuml: 'ï',
  ocirc: 'ô',
  ouml: 'ö',
  ugrave: 'ù',
  ucirc: 'û',
  uuml: 'ü',
  Eacute: 'É',
  Egrave: 'È',
  Ecirc: 'Ê',
  Agrave: 'À',
  Ccedil: 'Ç',
  oelig: 'œ',
  OElig: 'Œ',
  laquo: '«',
  raquo: '»',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  hellip: '…',
  ndash: '–',
  mdash: '—',
  euro: '€',
  copy: '©',
  reg: '®',
  middot: '·',
  bull: '•',
  deg: '°',
  shy: '',
  zwnj: '',
  zwj: '',
}

function codePoint(value: number): string {
  if (!Number.isFinite(value) || value <= 0 || value > 0x10ffff) return ''
  try {
    return String.fromCodePoint(value)
  } catch {
    return ''
  }
}

/** Entités HTML nommées courantes et numériques. Les inconnues restent telles quelles. */
export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const value = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)
      return codePoint(value)
    }
    return NAMED_ENTITIES[name] ?? whole
  })
}

/** Début des réponses citées dans le HTML des clients courants (Gmail, Outlook, Yahoo, Apple Mail). */
const HTML_QUOTE_MARKERS: readonly RegExp[] = [
  /<div[^>]*\bclass\s*=\s*["']?[^"'>]*\bgmail_quote\b/i,
  /<div[^>]*\bid\s*=\s*["']?divRplyFwdMsg\b/i,
  /<div[^>]*\bid\s*=\s*["']?appendonsend\b/i,
  /<div[^>]*\bclass\s*=\s*["']?[^"'>]*\byahoo_quoted\b/i,
  /<blockquote[^>]*\btype\s*=\s*["']?cite\b/i,
  /<hr[^>]*\bid\s*=\s*["']?stopSpelling\b/i,
]

const HTML_FORWARD = /forwarded message|message transféré|message transf&eacute;r&eacute;|début du message réexpédié/i

/**
 * Coupe le HTML au début de la réponse citée. Rien n'est coupé pour un transfert (le message transféré est dans
 * le même bloc chez Gmail) ni si rien d'utile ne précède la citation.
 */
export function cutHtmlQuote(html: string, forwarded = false): string {
  if (forwarded || HTML_FORWARD.test(html)) return html
  let cut = -1
  for (const marker of HTML_QUOTE_MARKERS) {
    const index = html.search(marker)
    if (index > 0 && (cut < 0 || index < cut)) cut = index
  }
  if (cut < 0) return html
  const before = html.slice(0, cut)
  return htmlToText(before).trim() ? before : html
}

/** HTML d'un mail → texte (paragraphes et retours à la ligne gardés). */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(head|style|script|title)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|tr|h[1-6]|blockquote|table|ul|ol|pre|section|article|header|footer)\s*>/gi, '\n')
    .replace(/<(p|div|tr|h[1-6]|blockquote|table|ul|ol|pre|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/(td|th)\s*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
  return tidy(decodeHtmlEntities(text))
}

// ---------------------------------------------------------------------------
// Texte
// ---------------------------------------------------------------------------

/** Espaces insécables (U+00A0, U+202F, U+2007) et caractères invisibles (U+200B à U+200D, U+FEFF). */
const SPACE_LIKE = new RegExp(`[${String.fromCharCode(0xa0, 0x202f, 0x2007)}]`, 'g')
const INVISIBLE = new RegExp([0x200b, 0x200c, 0x200d, 0xfeff].map((code) => String.fromCharCode(code)).join('|'), 'g')

/** Espaces insécables, fins de ligne, espaces en trop, lignes vides répétées. */
export function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(SPACE_LIKE, ' ')
    .replace(INVISIBLE, '')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Objet d'un transfert (« Fwd: », « TR : », « Fw: »). */
export function isForwardSubject(subject: string): boolean {
  return /^\s*(fwd?|tr|transf)\s*:/i.test(subject)
}

function isBlank(line: string | undefined): boolean {
  return line === undefined || line.trim() === ''
}

function hasContentBefore(lines: readonly string[], index: number): boolean {
  for (let i = 0; i < index; i++) {
    const line = lines[i]
    if (line !== undefined && line.trim() !== '' && !line.trimStart().startsWith('>')) return true
  }
  return false
}

/** Bloc d'en-têtes d'un message cité (« De : … » puis au moins deux de « Envoyé / À / Objet / Cc » juste après). */
function isHeaderBlock(lines: readonly string[], index: number): boolean {
  const first = lines[index]
  if (first === undefined || !HEADER_FROM.test(first)) return false
  let found = 0
  for (let i = index + 1; i <= index + 6 && i < lines.length; i++) {
    const line = lines[i]
    if (line !== undefined && HEADER_OTHERS.some((header) => header.test(line))) found += 1
  }
  return found >= 2
}

/** « Le … a écrit : » ou « On … wrote: », sur une à trois lignes (Gmail coupe les lignes longues). */
function isWroteLine(lines: readonly string[], index: number): boolean {
  let joined = ''
  for (let i = index; i < index + 3 && i < lines.length; i++) {
    const line = lines[i]
    if (line === undefined || line.trim() === '') return false
    joined = joined ? `${joined} ${line.trim()}` : line.trim()
    if (joined.length > 400) return false
    if (WROTE_FR.test(joined) || WROTE_EN.test(joined)) return true
  }
  return false
}

function isReplyStart(lines: readonly string[], index: number): boolean {
  const line = lines[index]
  if (line === undefined) return false
  if (ORIGINAL_MARKER.test(line)) return true
  if (UNDERSCORE_RULE.test(line)) {
    // Trait d'Outlook : la citation commence s'il est suivi des en-têtes.
    for (let i = index + 1; i <= index + 2 && i < lines.length; i++) if (isHeaderBlock(lines, i)) return true
    return false
  }
  return isHeaderBlock(lines, index) || isWroteLine(lines, index)
}

/**
 * Retire la réponse citée (et ce qui la suit). Un transfert est gardé en entier : on ne cherche la citation que
 * dans ce qui le précède.
 */
export function stripQuotedReply(text: string, forwarded = false): string {
  const lines = text.split('\n')
  let limit = lines.findIndex((line) => FORWARD_MARKER.test(line))
  if (limit < 0) limit = lines.length
  if (forwarded) {
    // Transfert d'Outlook (« TR: ») : pas de ligne de transfert, le message transféré commence aux en-têtes.
    const headers = lines.findIndex((_, i) => isHeaderBlock(lines, i))
    if (headers >= 0 && headers < limit) limit = headers
  }
  let cut = -1
  for (let i = 0; i < limit; i++) {
    if (isReplyStart(lines, i) && hasContentBefore(lines, i)) {
      cut = i
      break
    }
  }
  const kept = cut >= 0 ? lines.slice(0, cut) : lines
  if (cut >= 0 || limit === lines.length) {
    // Bloc final de lignes « > » (réponse au-dessus de la citation, sans ligne d'introduction reconnue).
    let end = kept.length
    while (end > 0 && (isBlank(kept[end - 1]) || (kept[end - 1] ?? '').trimStart().startsWith('>'))) end -= 1
    if (hasContentBefore(kept, end)) kept.length = end
  }
  return kept.join('\n')
}

function nonBlankIndexes(lines: readonly string[]): number[] {
  const indexes: number[] = []
  lines.forEach((line, i) => {
    if (line.trim() !== '') indexes.push(i)
  })
  return indexes
}

/** Retire la signature en fin de mail, seulement quand elle est sûre et courte. */
export function stripSignature(text: string): string {
  let lines = text.split('\n')
  while (lines.length > 0 && isBlank(lines[lines.length - 1])) lines.pop()

  // Signatures des applications : dans les trois dernières lignes non vides.
  const tail = nonBlankIndexes(lines).slice(-3)
  const mobile = tail.find((i) => MOBILE_SIGNATURE.some((re) => re.test((lines[i] ?? '').trim())))
  if (mobile !== undefined && hasContentBefore(lines, mobile)) lines = lines.slice(0, mobile)

  // Délimiteur standard « -- » : la dernière occurrence, suivie de peu de lignes.
  let dash = -1
  lines.forEach((line, i) => {
    if (line.trimEnd() === '--') dash = i
  })
  if (dash >= 0 && lines.length - dash - 1 <= DASH_SIGNATURE_MAX_LINES && hasContentBefore(lines, dash)) {
    lines = lines.slice(0, dash)
  }

  // Formule de fin suivie de quelques lignes courtes (nom, poste, téléphone).
  const indexes = nonBlankIndexes(lines)
  const window = indexes.slice(-CLOSER_WINDOW)
  for (let k = window.length - 1; k >= 0; k--) {
    const index = window[k]
    if (index === undefined || !CLOSER.test((lines[index] ?? '').trim())) continue
    const after = lines.slice(index + 1).filter((line) => line.trim() !== '')
    const short = after.length <= SIGNATURE_MAX_LINES && after.every((line) => line.trim().length <= SIGNATURE_MAX_LINE_LENGTH && !line.trim().endsWith('?'))
    if (short && hasContentBefore(lines, index)) lines = lines.slice(0, index)
    break
  }
  return lines.join('\n')
}

/** Corps d'un mail prêt pour l'analyse : texte (sinon HTML converti), citation et signature retirées. */
export function cleanMailBody(input: { text?: string | null; html?: string | null; subject?: string }): string {
  const subject = input.subject ?? ''
  const forwardedSubject = isForwardSubject(subject)
  const original = input.text?.trim()
    ? tidy(input.text)
    : input.html?.trim()
      ? htmlToText(cutHtmlQuote(input.html, forwardedSubject))
      : ''
  if (!original) return ''
  const withoutQuote = tidy(stripQuotedReply(original, forwardedSubject))
  if (!withoutQuote) return original
  const withoutSignature = tidy(stripSignature(withoutQuote))
  return withoutSignature || withoutQuote
}
