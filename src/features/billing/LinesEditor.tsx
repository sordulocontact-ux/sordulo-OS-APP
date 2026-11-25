import { useId, useState, type ReactNode } from 'react'
import { Badge, Button, Select, TextInput } from '../../components/ui'
import {
  computeTotals,
  defaultLine,
  formatMoney,
  formatQuantity,
  formatRate,
  hasLineErrors,
  lineHtCents,
  moneyInputValue,
  parseMoneyInput,
  parseQuantity,
  parseVatRate,
  validateLines,
  type ParseResult,
} from '../../shared/billing'
import { LABELS, LINE_UNITS, type DocumentLine, type LineUnit, type Organization } from '../../shared/types'
import { REBILLED_HELP } from './lineHelp'
import styles from './LinesEditor.module.css'

export interface LinesEditorProps {
  lines: DocumentLine[]
  onChange: (lines: DocumentLine[]) => void
  /** Valeurs par défaut des nouvelles lignes (taux journalier ou horaire, TVA). */
  org: Pick<Organization, 'default_daily_rate' | 'default_hourly_rate' | 'default_vat_rate'>
  readOnly?: boolean
  /** Avoir : prix négatifs permis. */
  allowNegative?: boolean
  /** Montre aussi les erreurs de champs vides ou hors règle (à activer après une tentative d'enregistrement). */
  showErrors?: boolean
  /** Boutons ajoutés à côté de « Ajouter une ligne » (ex. « Ajouter depuis le catalogue »). */
  extraActions?: ReactNode
}

interface NumberFieldProps {
  label: string
  value: number
  format: (value: number) => string
  parse: (raw: string) => ParseResult
  onValue: (value: number) => void
  error: string | undefined
  disabled: boolean
  inputMode?: 'decimal'
}

/**
 * Champ numérique saisi en texte français : on garde le brouillon tant qu'il n'a pas été corrigé ou quitté
 * (« 1, » reste affiché), la valeur de la ligne ne change que lorsque le texte est lisible.
 */
function NumberField({ label, value, format, parse, onValue, error, disabled, inputMode = 'decimal' }: NumberFieldProps) {
  const errorId = useId()
  const [draft, setDraft] = useState<string | null>(null)
  const parsed = draft === null ? null : parse(draft)
  const usable = draft !== null && parsed !== null && (!parsed.ok || parsed.value === value)
  const text = usable ? draft : format(value)
  const message = usable && parsed && !parsed.ok ? parsed.error : error
  return (
    <>
      <TextInput
        aria-label={label}
        inputMode={inputMode}
        className={styles.number}
        value={text}
        disabled={disabled}
        aria-invalid={message ? true : undefined}
        aria-describedby={message ? errorId : undefined}
        onChange={(event) => {
          const raw = event.target.value
          setDraft(raw)
          const result = parse(raw)
          if (result.ok) onValue(result.value)
        }}
        onBlur={() => setDraft(null)}
      />
      {message ? (
        <p id={errorId} className={styles.error}>
          {message}
        </p>
      ) : null}
    </>
  )
}

/** Édition des lignes d'un devis ou d'une facture, avec totaux HT, TVA par taux et TTC. */
export function LinesEditor({ lines, onChange, org, readOnly = false, allowNegative = false, showErrors = true, extraActions }: LinesEditorProps) {
  const labelErrorBase = useId()
  const errors = validateLines(lines, { allowNegative })
  const totals = computeTotals(lines)

  const update = (index: number, patch: Partial<DocumentLine>) =>
    onChange(lines.map((l, i) => (i === index ? { ...l, ...patch } : l)))

  const changeUnit = (index: number, unit: LineUnit, current: DocumentLine) => {
    // Le prix suit l'unité tant qu'il vaut le tarif par défaut de l'ancienne unité (ou 0).
    const oldDefault = defaultLine(org, current.unit).unit_price_cents
    const follows = current.unit_price_cents === 0 || current.unit_price_cents === oldDefault
    update(index, { unit, ...(follows ? { unit_price_cents: defaultLine(org, unit).unit_price_cents } : {}) })
  }

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta
    if (target < 0 || target >= lines.length) return
    const next = [...lines]
    const [item] = next.splice(index, 1)
    if (item) next.splice(target, 0, item)
    onChange(next)
  }

  return (
    <div className={styles.root}>
      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Désignation</th>
              <th scope="col" className={[styles.colQuantity, readOnly ? styles.right : ''].join(' ')}>
                Quantité
              </th>
              <th scope="col" className={styles.colUnit}>
                Unité
              </th>
              <th scope="col" className={[styles.colPrice, readOnly ? styles.right : ''].join(' ')}>
                PU HT
              </th>
              <th scope="col" className={[styles.colVat, readOnly ? styles.right : ''].join(' ')}>
                TVA
              </th>
              {readOnly ? null : (
                <th scope="col" className={styles.colRebilled} title={REBILLED_HELP}>
                  Refacturé
                </th>
              )}
              <th scope="col" className={styles.colTotal}>
                Total HT
              </th>
              {readOnly ? null : (
                <th scope="col" className={styles.colActions}>
                  <span className="visually-hidden">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={readOnly ? 6 : 8} className={styles.empty}>
                  Aucune ligne.
                </td>
              </tr>
            ) : null}
            {lines.map((line, index) => {
              const e = errors[index] ?? {}
              const labelError = showErrors ? e.label : undefined
              const labelErrorId = `${labelErrorBase}-${index}`
              const n = index + 1
              if (readOnly) {
                return (
                  <tr key={index}>
                    <td>
                      <span className={styles.readLabel}>{line.label}</span>
                      {line.description ? <span className={styles.readDescription}>{line.description}</span> : null}
                      {line.rebilled ? (
                        <span className={styles.readTag} title={REBILLED_HELP}>
                          <Badge tone="info">Frais refacturés</Badge>
                        </span>
                      ) : null}
                    </td>
                    <td className={styles.readNumber}>{formatQuantity(line.quantity)}</td>
                    <td>{LABELS.lineUnit[line.unit]}</td>
                    <td className={styles.readNumber}>{formatMoney(line.unit_price_cents)}</td>
                    <td className={styles.readNumber}>{formatRate(line.vat_rate)}</td>
                    <td className={styles.readNumber}>{formatMoney(lineHtCents(line))}</td>
                  </tr>
                )
              }
              return (
                <tr key={index}>
                  <td>
                    <div className={styles.designation}>
                      <TextInput
                        aria-label={`Désignation de la ligne ${n}`}
                        value={line.label}
                        disabled={readOnly}
                        aria-invalid={labelError ? true : undefined}
                        aria-describedby={labelError ? labelErrorId : undefined}
                        onChange={(event) => update(index, { label: event.target.value })}
                      />
                      {labelError ? (
                        <p id={labelErrorId} className={styles.error}>
                          {labelError}
                        </p>
                      ) : null}
                      <TextInput
                        aria-label={`Description de la ligne ${n} (facultative)`}
                        placeholder="Description (facultative)"
                        value={line.description ?? ''}
                        disabled={readOnly}
                        onChange={(event) => update(index, { description: event.target.value === '' ? null : event.target.value })}
                      />
                    </div>
                  </td>
                  <td>
                    <NumberField
                      label={`Quantité de la ligne ${n}`}
                      value={line.quantity}
                      format={formatQuantity}
                      parse={parseQuantity}
                      onValue={(quantity) => update(index, { quantity })}
                      error={showErrors ? e.quantity : undefined}
                      disabled={readOnly}
                    />
                  </td>
                  <td>
                    <Select
                      aria-label={`Unité de la ligne ${n}`}
                      value={line.unit}
                      disabled={readOnly}
                      onChange={(event) => changeUnit(index, event.target.value as LineUnit, line)}
                    >
                      {LINE_UNITS.map((unit) => (
                        <option key={unit} value={unit}>
                          {LABELS.lineUnit[unit]}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td>
                    <NumberField
                      label={`Prix unitaire HT de la ligne ${n}, en euros`}
                      value={line.unit_price_cents}
                      format={moneyInputValue}
                      parse={parseMoneyInput}
                      onValue={(unit_price_cents) => update(index, { unit_price_cents })}
                      error={e.unit_price && (showErrors || line.unit_price_cents < 0) ? e.unit_price : undefined}
                      disabled={readOnly}
                    />
                  </td>
                  <td>
                    <NumberField
                      label={`TVA de la ligne ${n}, en pourcentage`}
                      value={line.vat_rate}
                      format={(v) => formatQuantity(v)}
                      parse={parseVatRate}
                      onValue={(vat_rate) => update(index, { vat_rate })}
                      error={showErrors ? e.vat_rate : undefined}
                      disabled={readOnly}
                    />
                  </td>
                  <td className={styles.rebilledCell}>
                    <input
                      type="checkbox"
                      className={styles.rebilled}
                      checked={line.rebilled === true}
                      title={REBILLED_HELP}
                      aria-label={`Frais refacturés, ligne ${n} : exclus de la commission de l’apporteur`}
                      onChange={(event) => update(index, { rebilled: event.target.checked ? true : null })}
                    />
                  </td>
                  <td className={styles.total}>{formatMoney(lineHtCents(line))}</td>
                  {readOnly ? null : (
                    <td>
                      <div className={styles.rowActions}>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Monter la ligne ${n}`}
                          disabled={index === 0}
                          onClick={() => move(index, -1)}
                        >
                          ↑
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Descendre la ligne ${n}`}
                          disabled={index === lines.length - 1}
                          onClick={() => move(index, 1)}
                        >
                          ↓
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Supprimer la ligne ${n}`}
                          onClick={() => onChange(lines.filter((_, i) => i !== index))}
                        >
                          ×
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {readOnly ? null : (
        <div className={styles.add}>
          <Button size="sm" onClick={() => onChange([...lines, defaultLine(org, 'day')])}>
            Ajouter une ligne
          </Button>
          {extraActions}
        </div>
      )}
      {readOnly || lines.length === 0 ? null : <p className={styles.help}>{REBILLED_HELP}</p>}

      <dl className={styles.totals} aria-label="Totaux">
        <div className={styles.totalRow}>
          <dt>Total HT</dt>
          <dd>{formatMoney(totals.total_ht_cents)}</dd>
        </div>
        {totals.vatByRate.map((r) => (
          <div key={r.rate} className={styles.totalRow}>
            <dt>
              TVA {formatRate(r.rate)} <span className={styles.base}>sur {formatMoney(r.base_cents)}</span>
            </dt>
            <dd>{formatMoney(r.vat_cents)}</dd>
          </div>
        ))}
        <div className={[styles.totalRow, styles.grand].join(' ')}>
          <dt>Total TTC</dt>
          <dd>{formatMoney(totals.total_ttc_cents)}</dd>
        </div>
      </dl>
      {hasLineErrors(errors) && showErrors ? (
        <p className={styles.error} role="status">
          Corrige les lignes signalées avant d’enregistrer.
        </p>
      ) : null}
    </div>
  )
}
