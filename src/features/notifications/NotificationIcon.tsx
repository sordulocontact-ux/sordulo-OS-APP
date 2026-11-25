import { Icon } from '../../components/ui'
import appsIcon from '../../assets/icons/apps.svg'
import downloadIcon from '../../assets/icons/download.svg'
import fileTextIcon from '../../assets/icons/file-text.svg'
import layersIcon from '../../assets/icons/layers.svg'
import receiptIcon from '../../assets/icons/receipt.svg'
import targetIcon from '../../assets/icons/target.svg'
import usersIcon from '../../assets/icons/users.svg'
import bellIcon from '../../assets/nav/bell.svg'
import { notificationKindInfo, type NotificationIconKey } from './notificationLogic'

const ICONS: Record<NotificationIconKey, string> = {
  prospect: targetIcon,
  task: usersIcon,
  input: fileTextIcon,
  file: downloadIcon,
  proposal: appsIcon,
  deliverable: layersIcon,
  commission: receiptIcon,
  billing: receiptIcon,
  default: bellIcon,
}

/** Icône du type d'une notification (décorative : le libellé du type est donné à côté). */
export function NotificationIcon({ kind, className }: { kind: string; className?: string }) {
  return <Icon src={ICONS[notificationKindInfo(kind).icon]} size="sm" className={className} />
}
