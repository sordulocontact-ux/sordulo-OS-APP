import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import chartIcon from '../assets/icons/chart.svg'
import layersIcon from '../assets/icons/layers.svg'
import packageIcon from '../assets/icons/package.svg'
import percentIcon from '../assets/icons/percent.svg'
import penFileIcon from '../assets/icons/pen-file.svg'
import searchIcon from '../assets/icons/search.svg'
import uploadIcon from '../assets/icons/upload.svg'
import calendarIcon from '../assets/nav/calendar.svg'
import chevronIcon from '../assets/nav/chevron.svg'
import clientIcon from '../assets/nav/client.svg'
import collapseIcon from '../assets/nav/collapse.svg'
import connectorIcon from '../assets/nav/connector.svg'
import filesIcon from '../assets/nav/files.svg'
import folderIcon from '../assets/nav/folder.svg'
import homeIcon from '../assets/nav/home.svg'
import inboxIcon from '../assets/nav/inbox.svg'
import mailIcon from '../assets/nav/mail.svg'
import invoiceIcon from '../assets/nav/invoice.svg'
import networkIcon from '../assets/nav/network.svg'
import notesIcon from '../assets/nav/notes.svg'
import prospectIcon from '../assets/nav/prospect.svg'
import quoteIcon from '../assets/nav/quote.svg'
import settingsIcon from '../assets/nav/settings.svg'
import tasksIcon from '../assets/nav/tasks.svg'
import teamIcon from '../assets/nav/team.svg'
import whiteboardIcon from '../assets/nav/whiteboard.svg'
import { Avatar, Button, Modal } from '../components/ui'
import {
  ADMIN_ROLES,
  ALL_ROLES,
  CLIENT_READ_ROLES,
  COMMISSION_ROLES,
  FINANCE_ROLES,
  PROJECT_ROLES,
  PROSPECT_ROLES,
} from '../features/auth/roles'
import { catalogSearchSource } from '../features/catalog'
import { contractsSearchSource } from '../features/contracts'
import { FileDropDialog, filesSearchSource, openFileDrop } from '../features/files'
import { notesSearchSource } from '../features/notes'
import { NotificationBell } from '../features/notifications'
import { partnersSearchSource } from '../features/partners'
import { useWeeklyRecapNotification } from '../features/recap'
import { CommandPalette, openCommandPalette, registerSearchSource } from '../features/search'
import { MyAbsences } from '../features/team'
import { RunningTimer } from '../features/time'
import { VoiceCommandButton } from '../features/voice'
import type { MemberRole } from '../shared/types'
import { SetPasswordButton } from '../features/auth/SetPasswordButton'
import { useAuth } from '../features/auth/useAuth'
import { useCurrentMember } from '../features/auth/useCurrentMember'
import { currentWindowLabel, isDesktop, onNavigate } from '../lib/desktop'
import { DESKTOP_WINDOWS } from '../shared/desktop-contract'
import styles from './AppLayout.module.css'

interface NavItem {
  to: string
  label: string
  icon: string
  roles: readonly MemberRole[]
}

interface NavGroup {
  /** null : groupe du haut, sans titre (Figma : Dashboard, Inbox). */
  id: string
  title: string | null
  items: readonly NavItem[]
}

/**
 * Barre latérale (Figma « SORDULO-OS » 88:3236) : un groupe du haut sans titre, puis des sections repliables.
 * Les noms de pages du Figma ne sont pas repris (consigne de Sacha) : ce sont les pages de l'app, rangées par usage.
 */
const NAV: readonly NavGroup[] = [
  {
    id: 'top',
    title: null,
    items: [{ to: '/', label: 'Accueil', icon: homeIcon, roles: ALL_ROLES }],
  },
  {
    id: 'espace',
    title: 'Ton espace',
    items: [
      { to: '/my-tasks', label: 'Mes tâches', icon: tasksIcon, roles: PROJECT_ROLES },
      { to: '/notes', label: 'Notes', icon: notesIcon, roles: ALL_ROLES },
      { to: '/email', label: 'Email', icon: mailIcon, roles: CLIENT_READ_ROLES },
      { to: '/calls', label: 'Appels', icon: calendarIcon, roles: PROJECT_ROLES },
      { to: '/files/inbox', label: 'Boîte de dépôt', icon: inboxIcon, roles: CLIENT_READ_ROLES },
      { to: '/proposals', label: 'Propositions de l’IA', icon: layersIcon, roles: PROJECT_ROLES },
      { to: '/recap', label: 'Récap de la semaine', icon: whiteboardIcon, roles: CLIENT_READ_ROLES },
    ],
  },
  {
    id: 'entreprise',
    title: 'Entreprise',
    items: [
      { to: '/projects', label: 'Projets', icon: folderIcon, roles: CLIENT_READ_ROLES },
      { to: '/prospects', label: 'Prospection', icon: prospectIcon, roles: PROSPECT_ROLES },
      { to: '/clients', label: 'Clients', icon: clientIcon, roles: CLIENT_READ_ROLES },
      { to: '/files', label: 'Fichiers', icon: filesIcon, roles: CLIENT_READ_ROLES },
      { to: '/partners', label: 'Réseau', icon: networkIcon, roles: CLIENT_READ_ROLES },
      { to: '/catalog', label: 'Catalogue', icon: packageIcon, roles: CLIENT_READ_ROLES },
      { to: '/commissions', label: 'Commissions', icon: percentIcon, roles: COMMISSION_ROLES },
    ],
  },
  {
    id: 'finance',
    title: 'Finance',
    items: [
      { to: '/invoices', label: 'Factures', icon: invoiceIcon, roles: FINANCE_ROLES },
      { to: '/quotes', label: 'Devis', icon: quoteIcon, roles: FINANCE_ROLES },
      { to: '/contracts', label: 'Contrats', icon: penFileIcon, roles: FINANCE_ROLES },
      { to: '/finance', label: 'Finance', icon: chartIcon, roles: FINANCE_ROLES },
    ],
  },
  {
    id: 'agence',
    title: 'Agence',
    items: [
      { to: '/team', label: 'Équipe', icon: teamIcon, roles: ADMIN_ROLES },
      { to: '/settings', label: 'Paramètres', icon: settingsIcon, roles: ADMIN_ROLES },
      { to: '/connectors', label: 'Connecteurs', icon: connectorIcon, roles: ALL_ROLES },
    ],
  },
]

/** L'apporteur (rôle prospection) voit « Mes sites » et « Mes commissions ». */
function navLabel(item: NavItem, role: MemberRole): string {
  if (role !== 'prospection') return item.label
  if (item.to === '/prospects') return 'Mes sites'
  if (item.to === '/commissions') return 'Mes commissions'
  return item.label
}

/** Préférences d'affichage gardées sur l'ordinateur (barre repliée, sections fermées). Navigation privée : ignoré. */
const PREFS_KEY = 'sordulo.sidebar'
interface SidebarPrefs {
  collapsed: boolean
  closed: string[]
}
function readPrefs(): SidebarPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<SidebarPrefs> | null
    return { collapsed: raw?.collapsed === true, closed: Array.isArray(raw?.closed) ? raw.closed.filter((v) => typeof v === 'string') : [] }
  } catch {
    return { collapsed: false, closed: [] }
  }
}
function writePrefs(prefs: SidebarPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Stockage indisponible : la préférence vaut pour la session seulement.
  }
}

/** Sources de la recherche Cmd+K apportées par les autres fonctionnalités (une seule fois). */
let searchSourcesRegistered = false
function registerExtraSearchSources(): void {
  if (searchSourcesRegistered) return
  searchSourcesRegistered = true
  registerSearchSource(catalogSearchSource)
  registerSearchSource(contractsSearchSource)
  registerSearchSource(filesSearchSource)
  registerSearchSource(partnersSearchSource)
  registerSearchSource(notesSearchSource)
}

/** App de bureau, fenêtre principale : suit les routes envoyées par l'île (openMainAt → desktop://navigate). */
function useDesktopNavigation(): void {
  const navigate = useNavigate()
  useEffect(() => {
    if (!isDesktop() || currentWindowLabel() !== DESKTOP_WINDOWS.main) return
    let active = true
    let off: (() => void) | null = null
    onNavigate(({ route }) => {
      if (active && route.startsWith('/')) void navigate(route)
    })
      .then((unlisten) => {
        if (active) off = unlisten
        else unlisten()
      })
      .catch(() => undefined)
    return () => {
      active = false
      off?.()
    }
  }, [navigate])
}

/** Barre latérale (Figma « Sidebar », dépliée ou repliée en icônes) + contenu de la page. */
export function AppLayout() {
  const { signOut } = useAuth()
  const { member, organization } = useCurrentMember()
  const [menuOpen, setMenuOpen] = useState(false)
  const [absencesOpen, setAbsencesOpen] = useState(false)
  const [prefs, setPrefs] = useState<SidebarPrefs>(readPrefs)
  const menuRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  useDesktopNavigation()
  useWeeklyRecapNotification()
  registerExtraSearchSources()

  function updatePrefs(next: SidebarPrefs) {
    setPrefs(next)
    writePrefs(next)
  }
  const toggleGroup = (id: string) =>
    updatePrefs({ ...prefs, closed: prefs.closed.includes(id) ? prefs.closed.filter((g) => g !== id) : [...prefs.closed, id] })

  // Ferme le menu du compte au clic à l'extérieur ou avec Échap.
  useEffect(() => {
    if (!menuOpen) return
    function onPointer(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const role = member?.role ?? null
  const canFile = role !== null && CLIENT_READ_ROLES.includes(role)
  const groups = NAV.map((group) => ({ ...group, items: group.items.filter((item) => role !== null && item.roles.includes(role)) })).filter(
    (group) => group.items.length > 0,
  )
  const collapsed = prefs.collapsed
  const orgName = organization?.name ?? 'Sordulo'

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar} data-collapsed={collapsed ? 'true' : undefined}>
        <div className={styles.top}>
          <div className={styles.brandRow}>
            <span className={styles.brand} title={orgName}>
              <span className={styles.brandMark} aria-hidden="true">
                {orgName.slice(0, 1).toUpperCase()}
              </span>
              <span className={styles.brandName}>{orgName}</span>
            </span>
            <button
              type="button"
              className={styles.iconButton}
              aria-label={collapsed ? 'Déplier la barre latérale' : 'Replier la barre latérale'}
              aria-expanded={!collapsed}
              title={collapsed ? 'Déplier' : 'Replier'}
              onClick={() => updatePrefs({ ...prefs, collapsed: !collapsed })}
            >
              <img src={collapseIcon} alt="" width={16.6667} height={13.3333} />
            </button>
          </div>

          <nav aria-label="Navigation principale" className={styles.nav}>
            <div className={styles.group}>
              <button
                type="button"
                className={styles.navItem}
                aria-keyshortcuts="Control+K Meta+K"
                title={collapsed ? 'Rechercher (Ctrl K)' : undefined}
                onClick={() => openCommandPalette()}
              >
                <img src={searchIcon} alt="" width={20} height={20} />
                <span className={styles.label}>Rechercher</span>
                <kbd className={styles.shortcut} aria-hidden="true">
                  ⌘K
                </kbd>
              </button>
              {canFile ? (
                <button type="button" className={styles.navItem} title={collapsed ? 'Déposer un fichier' : undefined} onClick={() => openFileDrop()}>
                  <img src={uploadIcon} alt="" width={20} height={20} />
                  <span className={styles.label}>Déposer un fichier</span>
                </button>
              ) : null}
            </div>
            {groups.map((group) => {
              const open = collapsed || group.title === null || !prefs.closed.includes(group.id)
              const listId = `nav-${group.id}`
              return (
                <div key={group.id} className={styles.group}>
                  {group.title ? (
                    <button
                      type="button"
                      className={styles.groupTitle}
                      aria-expanded={open}
                      aria-controls={listId}
                      onClick={() => toggleGroup(group.id)}
                    >
                      {group.title}
                      <img src={chevronIcon} alt="" width={12} height={12} className={styles.chevron} />
                    </button>
                  ) : null}
                  {open ? (
                    <ul id={listId} className={styles.items}>
                      {group.items.map((item) => {
                        const label = role ? navLabel(item, role) : item.label
                        return (
                          <li key={item.to}>
                            <NavLink
                              to={item.to}
                              title={collapsed ? label : undefined}
                              aria-label={collapsed ? label : undefined}
                              end={item.to === '/'}
                              className={({ isActive }) => [styles.navItem, isActive ? styles.navActive : ''].filter(Boolean).join(' ')}
                            >
                              <img src={item.icon} alt="" width={20} height={20} />
                              <span className={styles.label}>{label}</span>
                            </NavLink>
                          </li>
                        )
                      })}
                    </ul>
                  ) : null}
                </div>
              )
            })}
          </nav>
        </div>

        <div className={styles.footer} ref={menuRef}>
          <button
            type="button"
            className={styles.accountButton}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={member ? `Compte de ${member.name}` : 'Compte'}
            onClick={() => setMenuOpen((value) => !value)}
          >
            <Avatar name={member?.name ?? '?'} />
            <span className={styles.accountName}>{member?.name ?? 'Compte'}</span>
          </button>
          <NotificationBell />
          {menuOpen ? (
            <div className={styles.menu} role="menu">
              {member ? <p className={styles.menuName}>{member.name}</p> : null}
              {organization ? <p className={styles.menuOrg}>{organization.name}</p> : null}
              <SetPasswordButton />
              <Button
                variant="secondary"
                size="sm"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false)
                  setAbsencesOpen(true)
                }}
              >
                Mes absences
              </Button>
              {isDesktop() ? null : (
                <Button
                  variant="secondary"
                  size="sm"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false)
                    void navigate('/download')
                  }}
                >
                  Installer l’app de bureau
                </Button>
              )}
              <Button variant="secondary" size="sm" role="menuitem" onClick={() => void signOut()}>
                Déconnexion
              </Button>
            </div>
          ) : null}
        </div>
      </aside>
      <main className={styles.content}>
        <Outlet />
      </main>
      <div className={styles.floating}>
        <RunningTimer />
      </div>
      <CommandPalette trailing={<VoiceCommandButton />} />
      {canFile ? <FileDropDialog /> : null}
      <Modal open={absencesOpen} onClose={() => setAbsencesOpen(false)} title="Mes absences">
        <MyAbsences />
      </Modal>
    </div>
  )
}
