/**
 * Heuristiques sur le HTML d'un site (en code, sans IA) : mobile, https, référencement, images, âge apparent.
 * Le HTML est une donnée non fiable : on n'en tire que des faits (booléens, comptes, courts extraits).
 */

export interface HtmlFindings {
  https: boolean
  lang: string | null
  hasViewport: boolean
  /** Le viewport contient width=device-width. */
  viewportResponsive: boolean
  title: string | null
  titleLength: number
  metaDescription: string | null
  metaDescriptionLength: number
  h1Count: number
  hasOpenGraph: boolean
  hasCanonical: boolean
  imageCount: number
  imagesMissingAlt: number
  /** Année la plus récente trouvée près d'un « © » ou « copyright ». */
  copyrightYear: number | null
  copyrightOutdated: boolean
  /** Bibliothèques datées détectées (« jQuery 1.x », « Bootstrap 3 »…). */
  datedLibraries: string[]
  /** Balises obsolètes (font, center, marquee, frameset, blink). */
  datedMarkup: string[]
  tableCount: number
  /** Tables imbriquées : mise en page en tableaux. */
  tableLayout: boolean
  scriptCount: number
  generator: string | null
  sizeKb: number
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  nbsp: ' ',
  quot: '"',
  apos: "'",
  copy: '©',
  ndash: '-',
  mdash: '-',
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d{1,6});/g, (_, n: string) => {
      const code = Number(n)
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ' '
    })
    .replace(/&([a-z]{2,6});/gi, (whole, name: string) => ENTITIES[name.toLowerCase()] ?? whole)
}

function attr(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)
  const value = match?.[1] ?? match?.[2] ?? match?.[3]
  return value === undefined ? null : decodeEntities(value).trim()
}

function metaContent(html: string, key: 'name' | 'property', value: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (attr(tag, key)?.toLowerCase() === value) return attr(tag, 'content')
  }
  return null
}

/** Texte visible approximatif : sans scripts, styles, balises ni commentaires, espaces réduits. */
export function visibleText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<[^>]*>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim()
}

function maxTableDepth(html: string): number {
  let depth = 0
  let max = 0
  for (const match of html.matchAll(/<(\/?)table\b/gi)) {
    depth += match[1] === '/' ? -1 : 1
    if (depth < 0) depth = 0
    if (depth > max) max = depth
  }
  return max
}

function datedLibraries(html: string): string[] {
  const found = new Set<string>()
  for (const tag of html.match(/<script\b[^>]*>/gi) ?? []) {
    const src = attr(tag, 'src')?.toLowerCase()
    if (!src) continue
    const jquery = /jquery[-./@]?v?(\d+)\.\d+/.exec(src)
    if (jquery && Number(jquery[1]) < 3) found.add(`jQuery ${jquery[1]}.x`)
    const bootstrap = /bootstrap[-./@]?v?(\d+)\.\d+/.exec(src)
    if (bootstrap && Number(bootstrap[1]) < 4) found.add(`Bootstrap ${bootstrap[1]}`)
    if (/angular(?:\.min)?\.js|angularjs/.test(src)) found.add('AngularJS')
    if (/prototype(?:\.min)?\.js|mootools/.test(src)) found.add('Prototype / MooTools')
  }
  if (/\.swf\b|application\/x-shockwave-flash/i.test(html)) found.add('Flash')
  return [...found]
}

function datedMarkup(html: string): string[] {
  return ['font', 'center', 'marquee', 'frameset', 'blink'].filter((tag) => new RegExp(`<${tag}\\b`, 'i').test(html))
}

function copyrightYear(text: string): number | null {
  let latest: number | null = null
  const pattern = /(?:©|copyright)\s*(?:\(c\)\s*)?(?:\d{4}\s*[-–—]\s*)?((?:19|20)\d{2})/gi
  for (const match of text.matchAll(pattern)) {
    const year = Number(match[1])
    if (latest === null || year > latest) latest = year
  }
  return latest
}

/** Analyse le HTML d'une page. `finalUrl` sert au https, `now` à l'âge du copyright (testable). */
export function analyzeHtml(html: string, finalUrl: string, now: Date = new Date()): HtmlFindings {
  const titleRaw = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)?.[1]
  const title = titleRaw === undefined ? null : decodeEntities(titleRaw).replace(/\s+/g, ' ').trim() || null
  const description = metaContent(html, 'name', 'description')?.trim() || null
  const viewport = metaContent(html, 'name', 'viewport')
  const images = html.match(/<img\b[^>]*>/gi) ?? []
  const year = copyrightYear(visibleText(html))
  const tableDepth = maxTableDepth(html)
  const tableCount = (html.match(/<table\b/gi) ?? []).length
  const htmlTag = /<html\b[^>]*>/i.exec(html)?.[0]
  return {
    https: finalUrl.toLowerCase().startsWith('https://'),
    lang: htmlTag ? attr(htmlTag, 'lang') : null,
    hasViewport: viewport !== null,
    viewportResponsive: viewport !== null && /width\s*=\s*device-width/i.test(viewport),
    title,
    titleLength: title?.length ?? 0,
    metaDescription: description,
    metaDescriptionLength: description?.length ?? 0,
    h1Count: (html.match(/<h1\b/gi) ?? []).length,
    hasOpenGraph: metaContent(html, 'property', 'og:title') !== null || metaContent(html, 'property', 'og:image') !== null,
    hasCanonical: (html.match(/<link\b[^>]*>/gi) ?? []).some((tag) => attr(tag, 'rel')?.toLowerCase() === 'canonical'),
    imageCount: images.length,
    imagesMissingAlt: images.filter((tag) => attr(tag, 'alt') === null).length,
    copyrightYear: year,
    copyrightOutdated: year !== null && year <= now.getFullYear() - 3,
    datedLibraries: datedLibraries(html),
    datedMarkup: datedMarkup(html),
    tableCount,
    tableLayout: tableDepth >= 2 || tableCount >= 5,
    scriptCount: (html.match(/<script\b/gi) ?? []).length,
    generator: metaContent(html, 'name', 'generator')?.slice(0, 80) ?? null,
    sizeKb: Math.round(Buffer.byteLength(html, 'utf8') / 1024),
  }
}
