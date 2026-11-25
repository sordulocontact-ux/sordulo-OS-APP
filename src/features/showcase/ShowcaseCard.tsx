import { useState } from 'react'
import { Button, Card, Field, Select, Textarea, TextInput, useToast } from '../../components/ui'
import { caseStudyToMarkdown, type CaseStudyContent } from '../../shared/ai/caseStudy'
import { PROJECT_SHOWCASES, type Project, type ProjectShowcase } from '../../shared/types'
import { PROJECT_ROLES, useHasRole } from '../auth/roles'
import {
  caseStudyAvailability,
  caseStudyFromForm,
  formFromCaseStudy,
  hasCaseStudyChanges,
  SHOWCASE_LABEL,
  showcaseErrorText,
  type CaseStudyForm,
} from './showcaseLogic'
import { useProposeCaseStudy, useSaveCaseStudy, useSetShowcase } from './useShowcase'
import styles from './showcase.module.css'

export interface ShowcaseCardProps {
  project: Pick<Project, 'id' | 'status' | 'showcase' | 'case_study'>
}

/** Diffusion du projet (À définir / Montrable / Sous NDA) et étude de cas pour sordulo.com. */
export function ShowcaseCard({ project }: ShowcaseCardProps) {
  const toast = useToast()
  const canEdit = useHasRole(PROJECT_ROLES)
  const setShowcase = useSetShowcase(project.id)
  const propose = useProposeCaseStudy(project.id)
  const [error, setError] = useState<string | null>(null)
  const availability = caseStudyAvailability(project)
  const stored = project.case_study as CaseStudyContent | null

  async function run(action: () => Promise<void>) {
    setError(null)
    try {
      await action()
    } catch (e) {
      setError(showcaseErrorText(e))
    }
  }

  function choose(value: ProjectShowcase) {
    if (value === project.showcase) return
    void run(async () => {
      await setShowcase.mutateAsync(value)
      toast.success(`Diffusion : ${SHOWCASE_LABEL[value]}`)
    })
  }

  function proposeStudy() {
    if (stored && !window.confirm('Une étude de cas existe déjà. La remplacer par une nouvelle proposition ?')) return
    void run(async () => {
      await propose.mutateAsync()
      toast.success('Étude de cas proposée, à relire')
    })
  }

  return (
    <Card>
      <div className={styles.body}>
        <h2 className={styles.title}>Diffusion</h2>
        <Field label="Ce projet peut-il être montré ?">
          <Select value={project.showcase} disabled={!canEdit || setShowcase.isPending} onChange={(e) => choose(e.target.value as ProjectShowcase)}>
            {PROJECT_SHOWCASES.map((s) => (
              <option key={s} value={s}>
                {SHOWCASE_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>
        {project.showcase === 'nda' ? <p className={styles.notice}>Sous NDA : ce projet ne doit pas être montré et aucune étude de cas n’est proposée.</p> : null}
        {project.showcase === 'showable' && availability.kind === 'blocked' ? <p className={styles.hint}>{availability.reason}</p> : null}
        {project.showcase === 'showable' && availability.kind === 'ready' && canEdit ? (
          <div>
            <Button variant={stored ? 'secondary' : 'primary'} onClick={proposeStudy} loading={propose.isPending}>
              {stored ? 'Proposer une nouvelle étude de cas' : 'Proposer une étude de cas'}
            </Button>
            {propose.isPending ? <p className={styles.hint}>L’IA rédige à partir des données du projet, compte une dizaine de secondes.</p> : null}
          </div>
        ) : null}
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        {stored && project.showcase !== 'nda' ? (
          // key : une nouvelle proposition repart d'un formulaire neuf.
          <CaseStudyEditor key={JSON.stringify(stored)} projectId={project.id} stored={stored} canEdit={canEdit} />
        ) : null}
      </div>
    </Card>
  )
}

function CaseStudyEditor({ projectId, stored, canEdit }: { projectId: string; stored: CaseStudyContent; canEdit: boolean }) {
  const toast = useToast()
  const save = useSaveCaseStudy(projectId)
  const saved = formFromCaseStudy(stored)
  const [form, setForm] = useState<CaseStudyForm>(saved)
  const [error, setError] = useState<string | null>(null)
  const dirty = hasCaseStudyChanges(saved, form)
  const set = <K extends keyof CaseStudyForm>(key: K, value: CaseStudyForm[K]) => setForm((f) => ({ ...f, [key]: value }))

  async function submit() {
    setError(null)
    try {
      await save.mutateAsync(caseStudyFromForm(form, stored))
      toast.success('Étude de cas enregistrée')
    } catch (e) {
      setError(showcaseErrorText(e))
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(caseStudyToMarkdown(caseStudyFromForm(form, stored)))
      toast.success('Markdown copié')
    } catch {
      toast.error('Impossible de copier : autorise l’accès au presse-papiers.')
    }
  }

  const disabled = !canEdit
  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <h3 className={styles.subtitle}>Étude de cas</h3>
      <p className={styles.hint}>Brouillon de l’IA : relis chaque chiffre et chaque citation avant de publier.</p>
      <Field label="Titre">
        <TextInput value={form.title} disabled={disabled} onChange={(e) => set('title', e.target.value)} />
      </Field>
      <Field label="Accroche">
        <Textarea rows={2} value={form.summary} disabled={disabled} onChange={(e) => set('summary', e.target.value)} />
      </Field>
      <Field label="Contexte">
        <Textarea rows={3} value={form.context} disabled={disabled} onChange={(e) => set('context', e.target.value)} />
      </Field>
      <Field label="Défi">
        <Textarea rows={3} value={form.challenge} disabled={disabled} onChange={(e) => set('challenge', e.target.value)} />
      </Field>
      <Field label="Solution">
        <Textarea rows={4} value={form.solution} disabled={disabled} onChange={(e) => set('solution', e.target.value)} />
      </Field>
      <Field label="Résultats" hint="Seulement ce que les données établissent. Une liste avec « - » par ligne.">
        <Textarea rows={3} value={form.results} disabled={disabled} onChange={(e) => set('results', e.target.value)} />
      </Field>
      {stored.deliverables && stored.deliverables.length > 0 ? (
        <div>
          <p className={styles.hint}>Livrables (repris du projet)</p>
          <ul className={styles.list}>
            {stored.deliverables.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <Field label="Citation du client" hint="Laisse vide s’il n’y en a pas.">
        <Textarea rows={2} value={form.quoteText} disabled={disabled} onChange={(e) => set('quoteText', e.target.value)} />
      </Field>
      <Field label="Auteur de la citation">
        <TextInput value={form.quoteAuthor} disabled={disabled} onChange={(e) => set('quoteAuthor', e.target.value)} />
      </Field>
      <label className={styles.check}>
        <input type="checkbox" checked={form.ready} disabled={disabled} onChange={(e) => set('ready', e.target.checked)} /> Relue, prête à publier
      </label>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles.actions}>
        {canEdit ? (
          <Button variant="primary" type="submit" loading={save.isPending} disabled={!dirty}>
            Enregistrer
          </Button>
        ) : null}
        <Button onClick={() => void copy()}>Copier en Markdown</Button>
      </div>
    </form>
  )
}
