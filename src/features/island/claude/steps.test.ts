import { describe, expect, it } from 'vitest'
import {
  askSummary,
  askTitle,
  describeStep,
  displayPath,
  filesModifiedLabel,
  isWaitingForInput,
  refusalLabel,
  shortenPath,
  toolActivity,
  truncate,
  ACTIVITY_HOLD_MS,
  liveActivity,
  webDomain,
} from './steps'

const CWD = 'C:\\Users\\mael\\sordulo-OS'

describe('activité à montrer (liveActivity)', () => {
  it('outil en cours : tenue tant qu’il tourne, même longtemps', () => {
    expect(liveActivity('command', null, 10 * ACTIVITY_HOLD_MS)).toBe('command')
  })
  it('outil fini : tenu ACTIVITY_HOLD_MS, puis « réfléchit »', () => {
    expect(liveActivity('read', 1000, 1000 + ACTIVITY_HOLD_MS)).toBe('read')
    expect(liveActivity('read', 1000, 1001 + ACTIVITY_HOLD_MS)).toBe('think')
  })
  it('réfléchit ou rien : inchangé', () => {
    expect(liveActivity('think', 0, 1e9)).toBe('think')
    expect(liveActivity(null, 0, 1e9)).toBeNull()
    expect(liveActivity(undefined, undefined, 0)).toBeNull()
  })
})

describe('étape tirée de l’outil', () => {
  it('lecture, modification, écriture : chemin relatif au dossier de la session', () => {
    expect(describeStep('Read', 'CLAUDE.md', CWD)).toBe('Lit CLAUDE.md')
    expect(describeStep('Edit', 'C:\\Users\\mael\\sordulo-OS\\src\\app\\App.tsx', CWD)).toBe('Modifie src/app/App.tsx')
    expect(describeStep('MultiEdit', 'src/lib/desktop.ts', CWD)).toBe('Modifie src/lib/desktop.ts')
    expect(describeStep('Write', 'src/a.ts', CWD)).toBe('Écrit src/a.ts')
    expect(describeStep('Read', null, CWD)).toBe('Lit un fichier')
  })

  it('raccourcit les longs chemins au milieu', () => {
    expect(describeStep('Edit', 'src/features/island/view/layers/ClaudeLayers.tsx', CWD)).toBe(
      'Modifie src/…/layers/ClaudeLayers.tsx',
    )
    expect(shortenPath('a/b.ts')).toBe('a/b.ts')
  })

  it('commande, recherche, web, sous-agent', () => {
    expect(describeStep('Bash', 'npm run typecheck', CWD)).toBe('Lance npm run typecheck')
    expect(describeStep('PowerShell', null, CWD)).toBe('Lance une commande')
    expect(describeStep('Grep', 'IslandSource', CWD)).toBe('Cherche "IslandSource"')
    expect(describeStep('Grep', 'TODO dans src', CWD)).toBe('Cherche "TODO" dans src')
    expect(describeStep('Glob', '**/*.rs', CWD)).toBe('Cherche les fichiers **/*.rs')
    expect(describeStep('WebFetch', 'https://www.example.com/docs?a=1', CWD)).toBe('Consulte example.com')
    expect(describeStep('WebSearch', 'tauri tray', CWD)).toBe('Cherche sur le web "tauri tray"')
    expect(describeStep('Task', 'Explorer le code', CWD)).toBe('Lance un sous-agent : Explorer le code')
    expect(describeStep('Agent', null, CWD)).toBe('Lance un sous-agent')
    expect(describeStep('TodoWrite', '2 tâches', CWD)).toBe('Met à jour ses tâches')
  })

  it('outils MCP et inconnus', () => {
    expect(describeStep('mcp__claude_ai_Figma__get_screenshot', 'x', CWD)).toBe('Utilise Figma')
    expect(describeStep('Bidule', null, CWD)).toBe('Utilise Bidule')
    expect(describeStep(null, null, CWD)).toBeNull()
  })

  it('coupe les commandes trop longues', () => {
    const step = describeStep('Bash', 'x'.repeat(200), CWD) ?? ''
    expect(step.endsWith('…')).toBe(true)
    expect(step.length).toBeLessThan(80)
    expect(truncate('abc', 5)).toBe('abc')
  })
})

describe('activité tirée de l’outil', () => {
  it('lit, fouille, écrit, commande, web, sous-agent ; sinon réfléchit', () => {
    expect(toolActivity('Read')).toBe('read')
    expect(toolActivity('Grep')).toBe('search')
    expect(toolActivity('Glob')).toBe('search')
    expect(toolActivity('Edit')).toBe('write')
    expect(toolActivity('Write')).toBe('write')
    expect(toolActivity('Bash')).toBe('command')
    expect(toolActivity('PowerShell')).toBe('command')
    expect(toolActivity('WebSearch')).toBe('web')
    expect(toolActivity('WebFetch')).toBe('web')
    expect(toolActivity('Task')).toBe('subagent')
    expect(toolActivity('TodoWrite')).toBe('think')
    expect(toolActivity('mcp__claude_ai_Figma__get_screenshot')).toBe('think')
    expect(toolActivity(null)).toBe('think')
  })
})

describe('demande d’autorisation', () => {
  it('sous-titre selon l’outil', () => {
    expect(askTitle('Bash', 'PDS OS')).toBe('Lancer une commande dans PDS OS')
    expect(askTitle('Edit', 'PDS OS')).toBe('Modifier un fichier dans PDS OS')
    expect(askTitle('Write', 'PDS OS')).toBe('Écrire un fichier dans PDS OS')
    expect(askTitle('WebFetch', 'PDS OS')).toBe('Consulter une page web dans PDS OS')
    expect(askTitle('mcp__supabase__query', 'PDS OS')).toBe('Utiliser supabase dans PDS OS')
  })

  it('ce qui est demandé', () => {
    expect(askSummary('Bash', 'npm run build', CWD)).toBe('npm run build')
    expect(askSummary('Edit', `${CWD}\\src\\a.ts`, CWD)).toBe('src/a.ts')
    expect(askSummary('Bash', null, CWD)).toBe('Bash')
  })

  it('refus', () => {
    expect(refusalLabel('Bash')).toBe('Commande refusée')
    expect(refusalLabel('Write')).toBe('Modification refusée')
    expect(refusalLabel('WebFetch')).toBe('Action refusée')
  })
})

describe('petits textes', () => {
  it('fichiers modifiés', () => {
    expect(filesModifiedLabel(1)).toBe('1 fichier modifié')
    expect(filesModifiedLabel(4)).toBe('4 fichiers modifiés')
  })

  it('chemins et domaines', () => {
    expect(displayPath('D:\\autre\\a.txt', CWD)).toBe('D:/autre/a.txt')
    expect(displayPath('c:\\users\\mael\\sordulo-os\\src\\a.ts', CWD)).toBe('src/a.ts')
    expect(webDomain('pas une url')).toBe('pas une url')
  })

  it('Claude Code attend une consigne, pas une autorisation', () => {
    expect(isWaitingForInput('Claude is waiting for your input')).toBe(true)
    expect(isWaitingForInput('Claude attend ta réponse')).toBe(true)
    expect(isWaitingForInput('Claude needs your permission to use Bash')).toBe(false)
    expect(isWaitingForInput(null)).toBe(false)
  })
})
