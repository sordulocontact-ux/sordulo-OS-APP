import briefcaseIcon from '../../assets/icons/briefcase.svg'
import fileTextIcon from '../../assets/icons/file-text.svg'
import homeIcon from '../../assets/icons/home.svg'
import layersIcon from '../../assets/icons/layers.svg'
import plusIcon from '../../assets/icons/plus.svg'
import receiptIcon from '../../assets/icons/receipt.svg'
import targetIcon from '../../assets/icons/target.svg'
import usersIcon from '../../assets/icons/users.svg'
import { ALL_ROLES, CLIENT_READ_ROLES, FINANCE_ROLES, PROJECT_ROLES, PROSPECT_ROLES } from '../auth/roles'
import type { QuickAction } from './types'

/** Actions proposées quand la saisie est vide. Une ligne par action : ajouter ici pour compléter. */
export const QUICK_ACTIONS: readonly QuickAction[] = [
  { id: 'home', title: 'Accueil', to: '/', icon: homeIcon, roles: ALL_ROLES },
  { id: 'new-project', title: 'Nouveau projet', subtitle: 'Créer un projet', to: '/projects?nouveau=1', icon: plusIcon, roles: PROJECT_ROLES },
  { id: 'my-tasks', title: 'Mes tâches', to: '/my-tasks', icon: layersIcon, roles: PROJECT_ROLES },
  { id: 'projects', title: 'Projets', to: '/projects', icon: briefcaseIcon, roles: CLIENT_READ_ROLES },
  { id: 'clients', title: 'Clients', to: '/clients', icon: usersIcon, roles: CLIENT_READ_ROLES },
  { id: 'quotes', title: 'Devis', to: '/quotes', icon: fileTextIcon, roles: FINANCE_ROLES },
  { id: 'invoices', title: 'Factures', to: '/invoices', icon: receiptIcon, roles: FINANCE_ROLES },
  { id: 'prospects', title: 'Prospection', to: '/prospects', icon: targetIcon, roles: PROSPECT_ROLES },
]
