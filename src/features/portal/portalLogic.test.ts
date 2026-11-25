import { describe, expect, it } from 'vitest'
import { PORTAL_TOKEN_PATTERN } from './portalContract'
import {
  CLIENT_NAME_KEY,
  contractClientStatus,
  generatePortalToken,
  invoiceClientStatus,
  isPortalToken,
  pendingActions,
  portalUrl,
  progressPercent,
  publicAppOrigin,
  quoteClientStatus,
  readClientName,
  saveClientName,
  toBase64Url,
} from './portalLogic'
import { markdownBlocks } from './portalMarkdown'

describe('jeton du portail', () => {
  it('32 octets aléatoires en base64url : 43 caractères au format de la base', () => {
    const a = generatePortalToken()
    const b = generatePortalToken()
    expect(a).toHaveLength(43)
    expect(PORTAL_TOKEN_PATTERN.test(a)).toBe(true)
    expect(isPortalToken(a)).toBe(true)
    expect(a).not.toBe(b)
  })

  it('base64url sans remplissage ni + ou /', () => {
    expect(toBase64Url(new Uint8Array([251, 255, 191]))).toBe('-_-_')
    expect(toBase64Url(new Uint8Array([1]))).toBe('AQ')
  })

  it('rejette les jetons mal formés', () => {
    expect(isPortalToken('court')).toBe(false)
    expect(isPortalToken(`${'a'.repeat(40)}/`)).toBe(false)
    expect(isPortalToken(null)).toBe(false)
  })
})

describe('lien public', () => {
  it('origine du navigateur sur le web, URL de production dans l’app de bureau', () => {
    expect(publicAppOrigin('https://os.sordulo.fr', undefined)).toBe('https://os.sordulo.fr')
    expect(publicAppOrigin('tauri://localhost', 'https://os.sordulo.fr/')).toBe('https://os.sordulo.fr')
    expect(publicAppOrigin('http://tauri.localhost', 'https://os.sordulo.fr')).toBe('https://os.sordulo.fr')
    expect(publicAppOrigin('tauri://localhost', '')).toBe('tauri://localhost')
    expect(portalUrl('https://os.sordulo.fr', 'abc')).toBe('https://os.sordulo.fr/p/abc')
  })
})

describe('affichage client', () => {
  it('pourcentage d’avancement', () => {
    expect(progressPercent(1, 3)).toBe(33)
    expect(progressPercent(5, 3)).toBe(100)
    expect(progressPercent(0, 0)).toBeNull()
  })

  it('statuts vus par le client', () => {
    expect(quoteClientStatus({ status: 'sent', expired: false }).label).toBe('En attente de votre accord')
    expect(quoteClientStatus({ status: 'sent', expired: true }).label).toBe('Expiré')
    expect(quoteClientStatus({ status: 'accepted', expired: false }).tone).toBe('success')
    expect(contractClientStatus({ status: 'sent' }).label).toBe('À signer')
    expect(invoiceClientStatus({ status: 'issued', overdue: true }).label).toBe('En retard')
    expect(invoiceClientStatus({ status: 'paid', overdue: false }).label).toBe('Payée')
  })

  it('compte ce qui attend une réponse du client', () => {
    expect(
      pendingActions({
        deliverables: [
          { versions: [{ version: 1, status: 'approved' }, { version: 2, status: 'pending' }] },
          { versions: [{ version: 2, status: 'approved' }, { version: 1, status: 'pending' }] },
          { versions: [] },
        ],
        quotes: [
          { status: 'sent', expired: false },
          { status: 'sent', expired: true },
          { status: 'accepted', expired: false },
        ],
        contracts: [{ status: 'sent' }, { status: 'signed' }],
      }),
    ).toBe(3)
  })
})

describe('nom mémorisé', () => {
  it('lit et écrit le nom, borné et trimé', () => {
    const map = new Map<string, string>()
    const store = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) }
    saveClientName('  Claire Dupont  ', store)
    expect(map.get(CLIENT_NAME_KEY)).toBe('Claire Dupont')
    expect(readClientName(store)).toBe('Claire Dupont')
  })

  it('stockage indisponible : aucune erreur', () => {
    const broken = {
      getItem: () => {
        throw new Error('bloqué')
      },
      setItem: () => {
        throw new Error('bloqué')
      },
    }
    expect(readClientName(broken)).toBe('')
    expect(() => saveClientName('Claire', broken)).not.toThrow()
    expect(readClientName(null)).toBe('')
  })
})

describe('texte des contrats', () => {
  it('titres, listes et paragraphes ; marques de gras retirées', () => {
    expect(markdownBlocks('# Contrat\n\nEntre **Sordulo** et Ibé.\nSuite.\n\n## Article 1\n- un\n* deux\nFin')).toEqual([
      { type: 'heading', level: 1, text: 'Contrat' },
      { type: 'paragraph', text: 'Entre Sordulo et Ibé.\nSuite.' },
      { type: 'heading', level: 2, text: 'Article 1' },
      { type: 'list', items: ['un', 'deux'] },
      { type: 'paragraph', text: 'Fin' },
    ])
    expect(markdownBlocks('  \n\n')).toEqual([])
  })
})
