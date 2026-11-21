/** Systèmes pour lesquels l'app de bureau existe. */
export type DesktopPlatform = 'mac' | 'windows'

/** Liens STABLES vers la dernière release GitHub (noms de fichiers fixes). */
export const DOWNLOAD_URLS: Record<DesktopPlatform, string> = {
  mac: 'https://github.com/sordulocontact-ux/sordulo-OS-APP/releases/latest/download/Sordulo-OS-macOS.dmg',
  windows: 'https://github.com/sordulocontact-ux/sordulo-OS-APP/releases/latest/download/Sordulo-OS-Windows-setup.exe',
}

export const PLATFORM_LABELS: Record<DesktopPlatform, string> = {
  mac: 'macOS',
  windows: 'Windows',
}

export interface NavigatorLike {
  userAgent?: string
  platform?: string
  userAgentData?: { platform?: string }
}

/**
 * Détecte le système depuis le navigateur : `userAgentData.platform` d'abord, puis `userAgent`.
 * Renvoie null si ni Mac ni Windows (Linux, mobile…) : la page montre alors les deux sans préférence.
 * iPhone et iPad sont écartés : un iPad se déclare « Macintosh » mais ne peut pas installer l'app.
 */
export function detectPlatform(nav: NavigatorLike | undefined): DesktopPlatform | null {
  if (!nav) return null
  const hints = [nav.userAgentData?.platform, nav.userAgent]
  for (const hint of hints) {
    if (!hint) continue
    if (/iphone|ipad|ipod|android/i.test(hint)) return null
    if (/win/i.test(hint) && !/darwin/i.test(hint)) return 'windows'
    if (/mac/i.test(hint)) return 'mac'
  }
  return null
}

export function otherPlatform(platform: DesktopPlatform): DesktopPlatform {
  return platform === 'mac' ? 'windows' : 'mac'
}
