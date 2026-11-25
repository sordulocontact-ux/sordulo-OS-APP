/*
 * Onglet « Partage » de la page projet : portail client (lien public) et droits de diffusion (montrable / sous NDA,
 * étude de cas). Les deux cartes viennent de leurs fonctionnalités (portal, showcase) ; l'onglet ne fait que les
 * réunir pour ne pas charger l'en-tête du projet.
 */
import { PortalShareCard } from '../portal'
import { ShowcaseCard } from '../showcase'
import { useProjectContext } from './useProjectContext'
import styles from './ProjectShareTab.module.css'

export function ProjectShareTab() {
  const { project } = useProjectContext()
  return (
    <div className={styles.grid}>
      <PortalShareCard project={project} />
      <ShowcaseCard project={project} />
    </div>
  )
}
