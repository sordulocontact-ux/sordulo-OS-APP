import { describe, expect, it } from 'vitest'
import { analyzeHtml, visibleText } from './htmlAudit.js'

const NOW = new Date('2026-11-25T10:00:00Z')

const MODERN = `<!doctype html><html lang="fr"><head>
<title>Boulangerie Dupont – pain au levain à Lyon</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Boulangerie artisanale au cœur de Lyon, pain au levain et viennoiseries.">
<meta property="og:title" content="Boulangerie Dupont"><meta property="og:image" content="/og.jpg">
<link rel="canonical" href="https://dupont.fr/">
<meta name="generator" content="Astro 5">
<script src="/app.js"></script></head>
<body><h1>Le pain, autrement</h1><img src="a.jpg" alt="Un pain"><img src="b.jpg" alt="">
<footer>© 2026 Boulangerie Dupont</footer></body></html>`

const DATED = `<html><head><title>Accueil</title>
<script src="https://code.jquery.com/jquery-1.11.3.min.js"></script>
<script src="/js/bootstrap-3.3.7.min.js"></script>
<script src="/lib/angular.min.js"></script>
</head><body bgcolor="#ccc"><center><font face="Arial">Bienvenue</font></center>
<marquee>Promo</marquee>
<table><tr><td><table><tr><td><img src="logo.gif"><img src="x.gif" alt="x"></td></tr></table></td></tr></table>
<object data="intro.swf"></object>
<p>Copyright 2014 - Tous droits réservés &copy; 2015 Dupont</p></body></html>`

describe('analyzeHtml', () => {
  it('relève un site récent et soigné', () => {
    const f = analyzeHtml(MODERN, 'https://dupont.fr/', NOW)
    expect(f).toMatchObject({
      https: true,
      lang: 'fr',
      hasViewport: true,
      viewportResponsive: true,
      title: 'Boulangerie Dupont – pain au levain à Lyon',
      h1Count: 1,
      hasOpenGraph: true,
      hasCanonical: true,
      imageCount: 2,
      imagesMissingAlt: 0,
      copyrightYear: 2026,
      copyrightOutdated: false,
      datedLibraries: [],
      datedMarkup: [],
      tableLayout: false,
      generator: 'Astro 5',
    })
    expect(f.metaDescription).toContain('Boulangerie artisanale')
    expect(f.metaDescriptionLength).toBeGreaterThan(40)
  })

  it('relève les signes d’un site daté', () => {
    const f = analyzeHtml(DATED, 'http://dupont.fr/', NOW)
    expect(f.https).toBe(false)
    expect(f.hasViewport).toBe(false)
    expect(f.viewportResponsive).toBe(false)
    expect(f.metaDescription).toBeNull()
    expect(f.h1Count).toBe(0)
    expect(f.hasOpenGraph).toBe(false)
    expect(f.imageCount).toBe(2)
    expect(f.imagesMissingAlt).toBe(1)
    expect(f.copyrightYear).toBe(2015)
    expect(f.copyrightOutdated).toBe(true)
    expect(f.datedLibraries).toEqual(['jQuery 1.x', 'Bootstrap 3', 'AngularJS', 'Flash'])
    expect(f.datedMarkup).toEqual(['font', 'center', 'marquee'])
    expect(f.tableLayout).toBe(true)
  })

  it('ne juge pas jQuery 3 ni Bootstrap 5 datés', () => {
    const f = analyzeHtml(
      '<script src="/jquery-3.7.1.min.js"></script><script src="https://cdn/bootstrap@5.3.0/x.js"></script>',
      'https://a.fr',
      NOW,
    )
    expect(f.datedLibraries).toEqual([])
  })

  it('un viewport sans width=device-width n’est pas adaptatif', () => {
    const f = analyzeHtml('<meta name="viewport" content="width=1024">', 'https://a.fr', NOW)
    expect(f.hasViewport).toBe(true)
    expect(f.viewportResponsive).toBe(false)
  })

  it('supporte le HTML vide ou cassé sans lever', () => {
    expect(() => analyzeHtml('', 'https://a.fr', NOW)).not.toThrow()
    const f = analyzeHtml('<title>pas fermé <h1', 'https://a.fr', NOW)
    expect(f.title).toBeNull()
    expect(f.sizeKb).toBe(0)
  })
})

describe('visibleText', () => {
  it('enlève scripts, styles, balises et commentaires', () => {
    const text = visibleText('<style>.a{color:red}</style><script>alert(1)</script><!-- ignore --><p>Bonjour &amp; bienvenue&nbsp;!</p>')
    expect(text).toBe('Bonjour & bienvenue !')
  })
})
