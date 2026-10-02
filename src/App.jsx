import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import ProgressBar from './components/ProgressBar'
import Field from './components/Field'
import { sections } from './data/schema'
import { submitAnswers, getNextSubmissionId } from './api/submitAnswers'
import './App.css'

const ALL_FIELDS = sections.flatMap((section) => section.fields)

const STEPS = [...sections.map((section) => ({ kind: 'section', section })), { kind: 'review' }]

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// ID numérico sequencial (1, 2, 3...), pedido ao Apps Script assim que o
// formulário abre — usado na planilha e para nomear os arquivos anexados,
// associando cada arquivo à resposta que o enviou. Se o pedido falhar (sem
// internet no instante do carregamento, por exemplo), cai num ID de reserva
// baseado no horário, só pra não travar o preenchimento.
function generateFallbackId() {
  const random = Math.floor(Math.random() * 900) + 100
  return `${Date.now()}${random}`
}

function isVisible(field, answers) {
  if (!field.condition) return true
  const currentValue = answers[field.condition.field]
  if (field.condition.in) return field.condition.in.includes(currentValue)
  return currentValue === field.condition.equals
}

// Campos com "dynamicLabel"/"dynamicOptions" recalculam o texto/as opções a
// cada resposta (ex.: pergunta de periodicidade, que muda com a frequência
// escolhida antes). Isso resolve essas funções num field "normal" antes de
// passar pro componente de exibição.
function resolveDynamicField(field, answers) {
  if (!field.dynamicLabel && !field.dynamicOptions) return field
  return {
    ...field,
    label: field.dynamicLabel ? field.dynamicLabel(answers) : field.label,
    options: field.dynamicOptions ? field.dynamicOptions(answers) : field.options,
  }
}

function hasValue(value) {
  if (value === undefined || value === null) return false
  if (typeof value === 'string') return value.trim() !== ''
  if (Array.isArray(value)) return value.length > 0
  return true
}

function fieldLabel(fieldId) {
  return ALL_FIELDS.find((field) => field.id === fieldId)?.label ?? fieldId
}

function parseNumber(value) {
  if (!hasValue(value)) return null
  const parsed = Number(String(value).replace(',', '.'))
  return Number.isNaN(parsed) ? null : parsed
}

function toTotalMonths(value) {
  if (!value || typeof value !== 'object') return null
  const anos = Number(value.anos) || 0
  const meses = Number(value.meses) || 0
  return anos * 12 + meses
}

function formatAge(value) {
  if (!value || typeof value !== 'object') return ''
  const anos = value.anos ?? 0
  const meses = value.meses ?? 0
  const parts = []
  if (anos > 0) parts.push(`${anos} ano${anos === 1 ? '' : 's'}`)
  if (meses > 0 || anos === 0) parts.push(`${meses} ${meses === 1 ? 'mês' : 'meses'}`)
  return parts.join(' e ')
}

function formatDuration(value) {
  if (!value || typeof value !== 'object') return ''
  const dias = value.dias ?? 0
  const horas = value.horas ?? 0
  const minutos = value.minutos ?? 0
  const parts = []
  if (dias > 0) parts.push(`${dias} dia${dias === 1 ? '' : 's'}`)
  if (horas > 0) parts.push(`${horas}h`)
  if (minutos > 0 || (dias === 0 && horas === 0)) parts.push(`${minutos}min`)
  return parts.join(' ')
}

function fieldError(field, answers) {
  if (!isVisible(field, answers)) return null
  const value = answers[field.id]

  if (field.required && !hasValue(value)) return 'Esse campo é obrigatório.'

  if (field.type === 'email' && hasValue(value) && !EMAIL_PATTERN.test(value)) {
    return 'Informe um e-mail em um formato válido.'
  }

  if (field.type === 'number' && hasValue(value)) {
    const parsed = parseNumber(value)
    if (parsed === null) return 'Informe um número válido.'

    if (field.min !== undefined && parsed < field.min) {
      return `O valor não pode ser menor que ${field.min}.`
    }
    if (field.max !== undefined && parsed > field.max) {
      return `O valor não pode ser maior que ${field.max}.`
    }
    if (field.minField) {
      const minValue = parseNumber(answers[field.minField])
      if (minValue !== null && parsed < minValue) {
        return `Não pode ser menor que "${fieldLabel(field.minField)}".`
      }
    }
    if (field.maxField) {
      const maxValue = parseNumber(answers[field.maxField])
      if (maxValue !== null && parsed > maxValue) {
        return `Não pode ser maior que "${fieldLabel(field.maxField)}".`
      }
    }
  }

  if (field.type === 'age' && hasValue(value)) {
    const totalMonths = toTotalMonths(value)
    if (field.maxYears !== undefined && totalMonths > field.maxYears * 12) {
      return `O valor não pode ser maior que ${field.maxYears} anos.`
    }
    if (field.maxField) {
      const maxMonths = toTotalMonths(answers[field.maxField])
      if (maxMonths !== null && totalMonths > maxMonths) {
        return `Não pode ser maior que "${fieldLabel(field.maxField)}".`
      }
    }
  }

  return null
}

export default function App() {
  const [stepIndex, setStepIndex] = useState(0)
  const [answers, setAnswers] = useState({})
  const [errors, setErrors] = useState({})
  const [done, setDone] = useState(false)
  const [submissionId, setSubmissionId] = useState(null)

  useEffect(() => {
    getNextSubmissionId()
      .then(setSubmissionId)
      .catch(() => setSubmissionId(generateFallbackId()))
  }, [])
  const [theme, setTheme] = useState(() => localStorage.getItem('dpx-theme') || 'light')
  const [fontScale, setFontScale] = useState(() => Number(localStorage.getItem('dpx-font-scale')) || 1)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('dpx-theme', theme)
  }, [theme])

  useEffect(() => {
    document.documentElement.style.fontSize = `${fontScale * 100}%`
    localStorage.setItem('dpx-font-scale', String(fontScale))
  }, [fontScale])

  function toggleTheme() {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'))
  }

  function cycleFontScale() {
    setFontScale((current) => {
      const steps = [1, 1.15, 1.3]
      const nextIndex = (steps.indexOf(current) + 1) % steps.length
      return steps[nextIndex]
    })
  }

  const step = STEPS[stepIndex]

  const visibleFields = useMemo(() => {
    if (step.kind !== 'section') return []
    return step.section.fields.filter((field) => isVisible(field, answers))
  }, [step, answers])

  function updateAnswer(fieldId, value) {
    setAnswers((prev) => {
      const next = { ...prev, [fieldId]: value }
      // Limpa campos condicionais órfãos quando a condição deixa de ser satisfeita.
      ALL_FIELDS.forEach((field) => {
        if (field.condition?.field === fieldId && !isVisible(field, next)) {
          delete next[field.id]
        }
      })
      // Limpa campos em cascata (ex.: estado, cidade) quando o campo do qual dependem muda,
      // propagando em cadeia (mudar o país limpa o estado, que por sua vez limpa a cidade).
      // ALL_FIELDS segue a ordem do schema, então um passe único já resolve a cadeia.
      ALL_FIELDS.forEach((field) => {
        if (field.dependsOn && next[field.dependsOn] === undefined && next[field.id] !== undefined) {
          delete next[field.id]
        }
      })
      // Limpa a resposta de campos com opções dinâmicas quando o campo do qual
      // elas dependem muda — a resposta antiga pode não existir mais no novo
      // conjunto de opções (ex.: "2 vezes ao dia" depois de trocar pra "Semanalmente").
      ALL_FIELDS.forEach((field) => {
        if (field.dynamicOptions && field.condition?.field === fieldId) {
          delete next[field.id]
        }
      })
      return next
    })
    setErrors((prev) => ({ ...prev, [fieldId]: undefined }))
  }

  function validateCurrentScreen() {
    const nextErrors = {}
    visibleFields.forEach((field) => {
      const message = fieldError(field, answers)
      if (message) nextErrors[field.id] = message
    })
    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  function goNext() {
    if (!validateCurrentScreen()) return
    setStepIndex((index) => Math.min(index + 1, STEPS.length - 1))
  }

  function goBack() {
    setStepIndex((index) => Math.max(index - 1, 0))
  }

  function goToStep(index) {
    setStepIndex(index)
  }

  async function handleConfirm() {
    await submitAnswers(answers, submissionId ?? generateFallbackId())
    setDone(true)
  }

  if (done) {
    return (
      <div className="app-shell">
        <div className="a11y-controls">
          <FontSizeToggle scale={fontScale} onCycle={cycleFontScale} />
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
        <motion.div
          className="card"
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 220, damping: 24 }}
        >
          <h1>Respostas registradas</h1>
          <p>Suas respostas foram enviadas com sucesso. Muito obrigado pela contribuição!</p>
        </motion.div>
      </div>
    )
  }

  const stepKey = step.kind === 'section' ? step.section.id : 'review'

  return (
    <div className="app-shell">
      <div className="a11y-controls">
        <FontSizeToggle scale={fontScale} onCycle={cycleFontScale} />
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
      </div>
      <div className="card">
        <div className="app-title">
          <h1>Questionário DPx</h1>
          <p className="app-subtitle">Discinesia Paroxística Canina — levantamento clínico</p>
        </div>
        <ProgressBar current={stepIndex + 1} total={STEPS.length} />

        <AnimatePresence mode="wait">
          <motion.div
            key={stepKey}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
          >
            {step.kind === 'section' && (
              <Screen
                section={step.section}
                fields={visibleFields}
                answers={answers}
                errors={errors}
                onChange={updateAnswer}
                onNext={goNext}
                onBack={stepIndex > 0 ? goBack : null}
                submissionId={submissionId}
              />
            )}

            {step.kind === 'review' && (
              <ReviewScreen answers={answers} onBack={goBack} onEdit={goToStep} onConfirm={handleConfirm} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

function FontSizeToggle({ scale, onCycle }) {
  const label = scale === 1 ? 'A' : scale === 1.15 ? 'A+' : 'A++'
  return (
    <motion.button
      type="button"
      className="font-size-toggle"
      onClick={onCycle}
      whileTap={{ scale: 0.9 }}
      aria-label="Aumentar tamanho da fonte"
    >
      {label}
    </motion.button>
  )
}

function ThemeToggle({ theme, onToggle }) {
  return (
    <motion.button
      type="button"
      className="theme-toggle"
      onClick={onToggle}
      whileTap={{ scale: 0.9 }}
      aria-label={theme === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro'}
    >
      {theme === 'dark' ? '☀️' : '🌙'}
    </motion.button>
  )
}

function ScreenHeader({ title, subtitle }) {
  return (
    <div className="screen-header">
      <h2>{title}</h2>
      {subtitle && <p className="screen-subtitle">{subtitle}</p>}
    </div>
  )
}

function NavButtons({ onBack, onNext, nextLabel = 'Próximo' }) {
  return (
    <div className="nav-buttons">
      {onBack ? (
        <motion.button type="button" className="nav-button secondary" onClick={onBack} whileTap={{ scale: 0.97 }}>
          Anterior
        </motion.button>
      ) : (
        <span />
      )}
      <motion.button type="button" className="nav-button primary" onClick={onNext} whileTap={{ scale: 0.97 }}>
        {nextLabel}
      </motion.button>
    </div>
  )
}

function Screen({ section, fields, answers, errors, onChange, onNext, onBack, submissionId }) {
  return (
    <div>
      <ScreenHeader title={section.title} />
      {fields.map((field) => (
        <Field
          key={field.id}
          field={resolveDynamicField(field, answers)}
          value={answers[field.id]}
          answers={answers}
          error={errors[field.id]}
          onChange={(value) => onChange(field.id, value)}
          submissionId={submissionId}
        />
      ))}
      <NavButtons onBack={onBack} onNext={onNext} />
    </div>
  )
}

function ReviewScreen({ answers, onBack, onEdit, onConfirm }) {
  return (
    <div>
      <ScreenHeader title="Revisão das respostas" subtitle="Confira tudo antes de confirmar o envio." />

      {sections.map((section, index) => (
        <ReviewSection key={section.id} title={section.title} fields={section.fields} answers={answers} onEdit={() => onEdit(index)} />
      ))}

      <NavButtons onBack={onBack} onNext={onConfirm} nextLabel="Confirmar envio" />
    </div>
  )
}

function formatAnswer(field, value) {
  if (field.type === 'file') {
    const files = Array.isArray(value) ? value : []
    return files.map((file) => file.name).join(', ')
  }
  if (field.type === 'age') return formatAge(value)
  if (field.type === 'duration') return formatDuration(value)
  if (Array.isArray(value)) return value.join(', ')
  return String(value)
}

function ReviewSection({ title, fields, answers, onEdit }) {
  const respondidos = fields.filter((field) => isVisible(field, answers) && hasValue(answers[field.id]))

  if (respondidos.length === 0) return null

  return (
    <div className="review-section">
      <div className="review-section-header">
        <h3>{title}</h3>
        <button type="button" className="edit-link" onClick={onEdit}>
          Editar
        </button>
      </div>
      {respondidos.map((field) => {
        const resolved = resolveDynamicField(field, answers)
        return (
          <p key={field.id} className="review-item">
            <strong>{resolved.label}:</strong> {formatAnswer(resolved, answers[field.id])}
          </p>
        )
      })}
    </div>
  )
}
