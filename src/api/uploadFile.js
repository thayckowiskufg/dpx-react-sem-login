// Upload de anexos (exames e vídeos) sem exigir login do usuário.
//
// O arquivo é convertido para base64 no navegador e enviado dentro do mesmo
// Google Apps Script que grava as respostas na planilha (ver submitAnswers.js).
// O Apps Script roda com a conta do professor (dona da planilha e da pasta do
// Drive), então nenhuma autenticação é pedida a quem responde o formulário.
//
// Contrapartida: o Apps Script tem um limite de tamanho de requisição (~50MB),
// e o base64 aumenta o tamanho do arquivo em ~33% — por isso os limites de
// tamanho de arquivo no schema (maxSizeMB) são mais conservadores aqui do que
// seriam com upload direto ao Drive.
const SHEET_ENDPOINT = 'https://script.google.com/macros/s/AKfycbyZCxtBFqk9Vy_kheU70Ubx5AFoWJTdJnF0gy3xifteOXUBPVqEzb482nWpzcsqwqr8NA/exec'

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      // O resultado vem como "data:<mime>;base64,<conteudo>" — só queremos a parte depois da vírgula.
      const base64 = reader.result.split(',')[1]
      resolve(base64)
    }
    reader.onerror = () => reject(new Error(`Falha ao ler o arquivo "${file.name}".`))
    reader.readAsDataURL(file)
  })
}

async function uploadOne(file, { submissionId, driveFolder }) {
  const conteudoBase64 = await fileToBase64(file)

  const response = await fetch(SHEET_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      tipo: 'upload_arquivo',
      idResposta: submissionId,
      pasta: driveFolder,
      nome: file.name,
      mimeType: file.type,
      conteudoBase64,
    }),
  })

  if (!response.ok) {
    throw new Error(`Falha ao enviar "${file.name}" (status ${response.status}).`)
  }

  const data = await response.json()
  if (!data.url) {
    throw new Error(data.erro || `Não foi possível enviar "${file.name}".`)
  }

  return { name: file.name, url: data.url }
}

// Envia um ou mais arquivos e retorna [{ name, url }]. Lança erro se algum upload falhar.
// "submissionId" nomeia o arquivo no Drive (associando ao id da resposta na
// planilha) e "driveFolder" ('exames' ou 'videos') escolhe a pasta de destino.
export async function uploadFiles(files, { submissionId, driveFolder }) {
  const uploaded = []
  for (const file of files) {
    uploaded.push(await uploadOne(file, { submissionId, driveFolder }))
  }
  return uploaded
}
