// Ponto único de envio das respostas do questionário.
//
// As respostas são enviadas para um Google Apps Script publicado como Web
// App, que grava uma nova linha na planilha do Google Sheets. Os campos de
// upload (exames e vídeos) já chegam aqui como { name, url } — o arquivo em
// si já foi enviado ao Drive (via Apps Script, ver api/uploadFile.js) no
// momento em que foi selecionado, então aqui só serializamos o link.
//
// O "submissionId" é o mesmo id numérico gerado no início do preenchimento
// (App.jsx) e usado para nomear os arquivos anexados — por isso ele é
// recebido aqui, em vez de gerado de novo, garantindo que a linha da
// planilha e os arquivos no Drive fiquem associados pelo mesmo número.
//
// O fetch usa Content-Type "text/plain" (em vez de "application/json") de
// propósito: assim o navegador não dispara um preflight OPTIONS, que o
// Apps Script Web App não sabe responder. O Apps Script recebe o texto e
// faz JSON.parse normalmente.
const SHEET_ENDPOINT = 'https://script.google.com/macros/s/AKfycbyZCxtBFqk9Vy_kheU70Ubx5AFoWJTdJnF0gy3xifteOXUBPVqEzb482nWpzcsqwqr8NA/exec'

function formatAge(value) {
  const anos = value.anos ?? 0
  const meses = value.meses ?? 0
  const parts = []
  if (anos > 0) parts.push(`${anos} ano${anos === 1 ? '' : 's'}`)
  if (meses > 0 || anos === 0) parts.push(`${meses} ${meses === 1 ? 'mês' : 'meses'}`)
  return parts.join(' e ')
}

function formatDuration(value) {
  const dias = value.dias ?? 0
  const horas = value.horas ?? 0
  const minutos = value.minutos ?? 0
  const parts = []
  if (dias > 0) parts.push(`${dias} dia${dias === 1 ? '' : 's'}`)
  if (horas > 0) parts.push(`${horas}h`)
  if (minutos > 0 || (dias === 0 && horas === 0)) parts.push(`${minutos}min`)
  return parts.join(' ')
}

function isAgeValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && 'anos' in value && 'meses' in value
}

function isDurationValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && 'dias' in value && 'horas' in value && 'minutos' in value
}

function serializeAnswers(answers) {
  const result = {}
  Object.entries(answers).forEach(([key, value]) => {
    if (Array.isArray(value) && value[0]?.url) {
      result[key] = value.map((file) => `${file.name}: ${file.url}`)
    } else if (isAgeValue(value)) {
      result[key] = formatAge(value)
    } else if (isDurationValue(value)) {
      result[key] = formatDuration(value)
    } else {
      result[key] = value
    }
  })
  return result
}

// Pede ao Apps Script o próximo número sequencial (1, 2, 3...), guardado num
// contador no próprio script. Chamado uma vez, assim que o formulário abre,
// pra já existir um ID pequeno e em ordem antes de qualquer anexo ser
// enviado (o nome do arquivo no Drive usa esse mesmo número).
export async function getNextSubmissionId() {
  const response = await fetch(SHEET_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ tipo: 'gerar_id' }),
  })

  if (!response.ok) throw new Error(`Falha ao gerar ID (status ${response.status}).`)

  const data = await response.json()
  if (!data.id) throw new Error(data.erro || 'Não foi possível gerar o ID.')

  return String(data.id)
}

export async function submitAnswers(answers, submissionId) {
  const submission = {
    id: submissionId,
    timestamp: new Date().toISOString(),
    respostas: serializeAnswers(answers),
  }

  try {
    await fetch(SHEET_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(submission),
    })
  } catch (error) {
    // O Apps Script normalmente não envia cabeçalhos CORS na resposta, então
    // o navegador pode bloquear a leitura dela e o fetch rejeita mesmo
    // quando a linha já foi gravada com sucesso na planilha. Por isso o
    // erro é apenas registrado, sem interromper o fluxo do formulário.
    console.warn('Falha ao ler resposta do Apps Script (pode já ter sido gravado):', error)
  }

  return submission
}
