import JSZip from 'jszip'
import { PDFDocument, StandardFonts, rgb, type PDFField, type PDFPage } from 'pdf-lib'
import { getEffectiveBeneficiary } from './format'
import type { CaseRecord, MasterData } from './types'

const a4 = { width: 595.28, height: 841.89 }
const PDF_OBJECT_MAX_UNITS_PER_PAGE = 28
const PDF_OBJECT_GAP_UNITS = 2
const WORD_PAGE_UNIT_BUDGET = 28
const WORD_MIN_OBJECT_UNITS = 7
const WORD_PHOTO_OBJECT_UNITS = 13
const WORD_UNIT_HEIGHT = 11.5

const fetchAsset = async (url: string) => {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Asset konnte nicht geladen werden: ${url}`)
  }
  return response.arrayBuffer()
}

const dataUrlToBytes = async (dataUrl: string) => {
  const response = await fetch(dataUrl)
  return new Uint8Array(await response.arrayBuffer())
}

const downloadBlob = (filename: string, blob: Blob) => {
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(href)
}

const toArrayBuffer = (bytes: Uint8Array) => {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

const fitIntoBox = (sourceWidth: number, sourceHeight: number, maxWidth: number, maxHeight: number) => {
  const scale = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight)
  return {
    width: sourceWidth * scale,
    height: sourceHeight * scale,
  }
}

const buildAddressLines = (lines: Array<string | undefined | null>, maxLineLength = 34) => {
  const result: string[] = []
  lines.filter(Boolean).forEach((line) => {
    const chunks = String(line).split(/\s+/)
    let current = ''
    chunks.forEach((chunk) => {
      const next = current ? `${current} ${chunk}` : chunk
      if (next.length > maxLineLength && current) {
        result.push(current)
        current = chunk
        return
      }
      current = next
    })
    if (current) {
      result.push(current)
    }
  })
  return result
}

const withDisplayUmlauts = (value: string) =>
  value
    .replaceAll('Beguenstigter', 'Begünstigter')
    .replaceAll('Beguenstigten', 'Begünstigten')
    .replaceAll('Nationalitaet', 'Nationalität')
    .replaceAll('SchÃ¤tzung', 'Schätzung')
    .replaceAll('Erhalten fuer', 'Erhalten für')

const normalizeVisibleContent = (value: string) =>
  value
    .replaceAll('BegÃ¼nstigter', 'Begünstigter')
    .replaceAll('BegÃ¼nstigten', 'Begünstigten')
    .replaceAll('Beguenstigter', 'Begünstigter')
    .replaceAll('Beguenstigten', 'Begünstigten')
    .replaceAll('NationalitÃ¤t', 'Nationalität')
    .replaceAll('Nationalitaet', 'Nationalität')
    .replaceAll('SchÃ¤tzung', 'Schätzung')
    .replaceAll('SchÃƒÂ¤tzung', 'Schätzung')
    .replaceAll('Erhalten fÃ¼r', 'Erhalten für')
    .replaceAll('Erhalten fuer', 'Erhalten für')

const drawWrappedText = (
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  size: number,
  font?: Awaited<ReturnType<PDFDocument['embedFont']>>,
) => {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    if (!words.length) {
      lines.push('')
      continue
    }
    let current = ''
    words.forEach((word) => {
      const next = current ? `${current} ${word}` : word
      const nextWidth = font ? font.widthOfTextAtSize(next, size) : next.length * size * 0.48
      if (nextWidth > maxWidth && current) {
        lines.push(current)
        current = word
        return
      }
      current = next
    })
    if (current) {
      lines.push(current)
    }
  }

  lines.forEach((line, index) => {
    page.drawText(line, {
      x,
      y: y - index * lineHeight,
      size,
      font,
      color: rgb(0.12, 0.12, 0.16),
    })
  })
}

const getFieldByName = (form: ReturnType<PDFDocument['getForm']>, name: string) =>
  form.getFields().find((field) => field.getName() === name) ?? null

const getWidgetRect = (form: ReturnType<PDFDocument['getForm']>, name: string) => {
  const field = getFieldByName(form, name)
  if (!field || !('acroField' in field)) {
    return null
  }
  const widget = (field as PDFField & { acroField?: { getWidgets: () => Array<{ getRectangle: () => { x: number; y: number; width: number; height: number } }> } }).acroField?.getWidgets?.()[0]
  const rect = widget?.getRectangle()
  if (!rect) {
    return null
  }
  return {
    x: rect.width >= 0 ? rect.x : rect.x + rect.width,
    y: rect.height >= 0 ? rect.y : rect.y + rect.height,
    width: Math.abs(rect.width),
    height: Math.abs(rect.height),
  }
}

const getFirstWidgetRect = (form: ReturnType<PDFDocument['getForm']>, names: string[]) => {
  for (const name of names) {
    const rect = getWidgetRect(form, name)
    if (rect) {
      return rect
    }
  }
  return null
}

const prepareSignatureAsset = async (dataUrl: string) => {
  const image = new Image()
  image.src = dataUrl
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('Signaturbild konnte nicht geladen werden.'))
  })

  const sourceCanvas = document.createElement('canvas')
  sourceCanvas.width = image.width
  sourceCanvas.height = image.height
  const context = sourceCanvas.getContext('2d')
  if (!context) {
    throw new Error('Canvas fuer Signatur konnte nicht erzeugt werden.')
  }
  context.drawImage(image, 0, 0)
  const { data, width, height } = context.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height)

  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      const alpha = data[offset + 3]
      const red = data[offset]
      const green = data[offset + 1]
      const blue = data[offset + 2]
      const isInk = alpha > 8 && !(red > 235 && green > 228 && blue > 210)
      if (!isInk) continue
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }

  if (maxX < minX || maxY < minY) {
    return { bytes: await dataUrlToBytes(dataUrl), width: image.width, height: image.height }
  }

  const padding = 10
  const cropX = Math.max(0, minX - padding)
  const cropY = Math.max(0, minY - padding)
  const cropWidth = Math.min(width - cropX, maxX - minX + 1 + padding * 2)
  const cropHeight = Math.min(height - cropY, maxY - minY + 1 + padding * 2)

  const trimmedCanvas = document.createElement('canvas')
  trimmedCanvas.width = cropWidth
  trimmedCanvas.height = cropHeight
  const trimmedContext = trimmedCanvas.getContext('2d')
  if (!trimmedContext) {
    throw new Error('Canvas fuer den Signaturzuschnitt konnte nicht erzeugt werden.')
  }
  trimmedContext.clearRect(0, 0, cropWidth, cropHeight)
  trimmedContext.drawImage(sourceCanvas, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight)
  return {
    bytes: await dataUrlToBytes(trimmedCanvas.toDataURL('image/png')),
    width: cropWidth,
    height: cropHeight,
  }
}

const setTextFieldValue = (form: ReturnType<PDFDocument['getForm']>, name: string, value: string) => {
  const field = getFieldByName(form, name)
  if (!field || !('setText' in field)) {
    return
  }
  if ('enableMultiline' in field && typeof (field as PDFField & { enableMultiline?: () => void }).enableMultiline === 'function' && value.includes('\n')) {
    ;(field as PDFField & { enableMultiline: () => void }).enableMultiline()
  }
  ;(field as PDFField & { setText: (next: string) => void }).setText(value)
}

const setFirstAvailableTextFieldValue = (
  form: ReturnType<PDFDocument['getForm']>,
  names: string[],
  value: string,
) => {
  for (const name of names) {
    const field = getFieldByName(form, name)
    if (field && 'setText' in field) {
      setTextFieldValue(form, name, value)
      return
    }
  }
}

const drawPreparedSignature = async (
  pdfDoc: PDFDocument,
  page: PDFPage,
  form: ReturnType<PDFDocument['getForm']>,
  fieldNames: string[],
  dataUrl: string,
) => {
  const prepared = await prepareSignatureAsset(dataUrl)
  const png = await pdfDoc.embedPng(prepared.bytes)
  fieldNames.forEach((fieldName) => {
    const rect = getWidgetRect(form, fieldName)
    if (!rect) return
    const drawWidth = rect.width
    const drawHeight = (prepared.height / prepared.width) * drawWidth
    page.drawImage(png, {
      x: rect.x,
      y: rect.y + (rect.height - drawHeight) / 2,
      width: drawWidth,
      height: drawHeight,
    })
  })
}

const getConsignorAddress = (record: CaseRecord) =>
  buildAddressLines([
    record.consignor.company,
    `${record.consignor.title} ${record.consignor.firstName} ${record.consignor.lastName}`.trim(),
    record.consignor.addressAddon1,
    `${record.consignor.street} ${record.consignor.houseNo}`.trim(),
    `${record.consignor.zip} ${record.consignor.city}`.trim(),
    record.consignor.country,
  ]).join('\n')

const getOwnerAddress = (record: CaseRecord) =>
  buildAddressLines(record.owner.sameAsConsignor
    ? [
        record.consignor.company,
        `${record.consignor.title} ${record.consignor.firstName} ${record.consignor.lastName}`.trim(),
        record.consignor.addressAddon1,
        `${record.consignor.street} ${record.consignor.houseNo}`.trim(),
        `${record.consignor.zip} ${record.consignor.city}`.trim(),
        record.consignor.country,
      ]
    : [
        `${record.owner.firstName} ${record.owner.lastName}`.trim(),
        `${record.owner.street} ${record.owner.houseNo}`.trim(),
        `${record.owner.zip} ${record.owner.city}`.trim(),
        record.owner.country,
      ]).join('\n')

const getClerkPdfValue = (masterData: MasterData, clerkId: string) => {
  const clerk = masterData.clerks.find((entry) => entry.id === clerkId)
  return {
    clerk,
    value: [clerk?.name ?? '', clerk?.phone ?? '', clerk?.email ?? ''].filter(Boolean).join(' | '),
  }
}

const drawObjectTableOverlay = (
  page: PDFPage,
  font: Awaited<ReturnType<PDFDocument['embedFont']>>,
  record: CaseRecord,
  masterData: MasterData,
  form: ReturnType<PDFDocument['getForm']>,
) => {
  const intRect = getWidgetRect(form, 'Int-Nr 1')
  const receivedRect = getWidgetRect(form, 'Erhalten 1')
  const chapterRect = getWidgetRect(form, 'Kapitel 1')
  const shortRect = getWidgetRect(form, 'Kurzbeschreibung 1')
  const estimateRect = getWidgetRect(form, 'Sch\u00e4tzung 1')
  if (!intRect || !receivedRect || !chapterRect || !shortRect || !estimateRect) {
    return
  }

  const totalHeight = intRect.height
  const blocks = record.objects.map((item) => ({
    item,
    text: [
      `Int.-Nr.: ${item.intNo || '-'}`,
      `Erhalten für: ${getAuctionWithDate(masterData, item.auctionId) || item.received || '-'}`,
      `Abteilung: ${getDepartmentCode(masterData, item.departmentId)}`,
      `Kurzbeschreibung: ${item.shortDesc || '-'}`,
      `Schätzung: ${item.estimateLow || '-'} / ${item.estimateHigh || '-'}`,
      `${isIbidObject(masterData, item.auctionId) ? 'Startpreis' : item.netLimit ? 'Nettolimite' : 'Limite'}: ${item.limit || '-'}`,
    ],
  }))
  const totalUnits = blocks.reduce((sum, block) => sum + block.text.length + 1, 0)
  const unitHeight = totalHeight / Math.max(totalUnits, 1)
  let consumedUnits = 0

  blocks.forEach(({ item, text }) => {
    const topY = intRect.y + intRect.height - 10 - consumedUnits * unitHeight
    page.drawText(item.intNo || '-', { x: intRect.x + 2, y: topY, size: 8.5, font, color: rgb(0.12, 0.12, 0.16) })
    drawWrappedText(page, getAuctionWithDate(masterData, item.auctionId) || item.received || '-', receivedRect.x + 2, topY, receivedRect.width - 4, unitHeight, 8.5, font)
    page.drawText(getDepartmentCode(masterData, item.departmentId), { x: chapterRect.x + 2, y: topY, size: 8.5, font, color: rgb(0.12, 0.12, 0.16) })
    drawWrappedText(page, item.shortDesc || '-', shortRect.x + 2, topY, shortRect.width - 4, unitHeight, 8.5, font)
    drawWrappedText(page, `Schätzung: ${item.estimateLow || '-'} / ${item.estimateHigh || '-'}\n${isIbidObject(masterData, item.auctionId) ? 'Startpreis' : item.netLimit ? 'Nettolimite' : 'Limite'}: ${item.limit || '-'}`, estimateRect.x + 2, topY, estimateRect.width - 4, unitHeight, 8.5, font)
    consumedUnits += text.length + 1
  })
}

void drawObjectTableOverlay

const drawClerkOverlay = (
  page: PDFPage,
  font: Awaited<ReturnType<PDFDocument['embedFont']>>,
  clerkValue: string,
  form: ReturnType<PDFDocument['getForm']>,
  fieldName = 'Sachbearbeiter 2',
) => {
  const rect = getWidgetRect(form, fieldName)
  if (!rect || !clerkValue.trim()) {
    return
  }
  page.drawText(clerkValue, {
    x: rect.x + 2,
    y: rect.y + 1,
    size: 8.6,
    font,
    color: rgb(0.12, 0.12, 0.16),
    maxWidth: rect.width - 4,
  })
}

const drawObjectTableOverlayV2 = (
  page: PDFPage,
  font: Awaited<ReturnType<PDFDocument['embedFont']>>,
  items: CaseRecord['objects'],
  masterData: MasterData,
  form: ReturnType<PDFDocument['getForm']>,
  suffix = '1',
) => {
  const intRect = getWidgetRect(form, `Int-Nr ${suffix}`)
  const receivedRect = getWidgetRect(form, `Erhalten ${suffix}`)
  const chapterRect = getWidgetRect(form, `Kapitel ${suffix}`)
  const shortRect = getWidgetRect(form, `Kurzbeschreibung ${suffix}`)
  const estimateRect = getFirstWidgetRect(form, [`Schätzung ${suffix}`, `Sch?tzung ${suffix}`])
  if (!intRect || !receivedRect || !chapterRect || !shortRect || !estimateRect) {
    return
  }

  const blocks = items.map((item) => {
    const detailLines = [
      item.shortDesc || '-',
      ...(item.desc.trim() ? [item.desc.trim()] : []),
      ...(item.received.trim() ? [`Referenznr.: ${item.received.trim()}`] : []),
      ...(item.remarks.trim() ? [`Bemerkungen: ${item.remarks.trim()}`] : []),
    ]
    const estimateLines = [
      ...(item.estimateLow.trim() || item.estimateHigh.trim() ? [`${item.estimateLow || '-'} / ${item.estimateHigh || '-'}`] : []),
      ...(item.limit.trim() ? [`${isIbidObject(masterData, item.auctionId) ? 'Startpreis' : item.netLimit ? 'Nettolimite' : 'Limite'}: ${item.limit.trim()}`] : []),
    ]

    return {
      item,
      lines: estimateLines,
      detailText: detailLines.join('\n'),
      unitCount: detailLines.length + estimateLines.length + PDF_OBJECT_GAP_UNITS,
    }
  })
  const unitHeight = intRect.height / PDF_OBJECT_MAX_UNITS_PER_PAGE
  let consumedUnits = 0

  blocks.forEach(({ item, lines, detailText, unitCount }) => {
    const topY = intRect.y + intRect.height - 10 - consumedUnits * unitHeight
    page.drawText(item.intNo || '-', { x: intRect.x + 2, y: topY, size: 8.5, font, color: rgb(0.12, 0.12, 0.16) })
    drawWrappedText(page, getAuctionWithDate(masterData, item.auctionId) || item.received || '-', receivedRect.x + 2, topY, receivedRect.width - 4, unitHeight, 8.5, font)
    page.drawText(getDepartmentCode(masterData, item.departmentId), { x: chapterRect.x + 2, y: topY, size: 8.5, font, color: rgb(0.12, 0.12, 0.16) })
    drawWrappedText(page, detailText, shortRect.x + 2, topY, shortRect.width - 4, unitHeight, 8.5, font)
    drawWrappedText(page, lines.join('\n'), estimateRect.x + 2, topY, estimateRect.width - 4, unitHeight, 8.5, font)
    consumedUnits += unitCount
  })
}

const getElbObjectBlocks = (items: CaseRecord['objects'], masterData: MasterData) =>
  items.map((item) => {
    const detailLines = [
      item.shortDesc || '-',
      ...(item.desc.trim() ? [item.desc.trim()] : []),
      ...(item.received.trim() ? [`Referenznr.: ${item.received.trim()}`] : []),
      ...(item.remarks.trim() ? [`Bemerkungen: ${item.remarks.trim()}`] : []),
    ]
    const estimateLines = [
      ...(item.estimateLow.trim() || item.estimateHigh.trim() ? [`${item.estimateLow || '-'} / ${item.estimateHigh || '-'}`] : []),
      ...(item.limit.trim() ? [`${isIbidObject(masterData, item.auctionId) ? 'Startpreis' : item.netLimit ? 'Nettolimite' : 'Limite'}: ${item.limit.trim()}`] : []),
    ]

    return {
      item,
      detailText: detailLines.join('\n'),
      estimateText: estimateLines.join('\n'),
      unitCount: detailLines.length + estimateLines.length + PDF_OBJECT_GAP_UNITS,
    }
  })

const paginateElbObjectBlocks = (
  items: CaseRecord['objects'],
  masterData: MasterData,
  maxUnitsPerPage: number,
) => {
  const blocks = getElbObjectBlocks(items, masterData)
  const pages: typeof blocks[] = []
  let current: typeof blocks = []
  let used = 0

  blocks.forEach((block) => {
    if (current.length && used + block.unitCount > maxUnitsPerPage) {
      pages.push(current)
      current = []
      used = 0
    }
    current.push(block)
    used += block.unitCount
  })

  if (current.length) {
    pages.push(current)
  }

  return pages
}

const drawOverflowObjectPage = async (
  pdfDoc: PDFDocument,
  font: Awaited<ReturnType<PDFDocument['embedFont']>>,
  blocks: ReturnType<typeof getElbObjectBlocks>,
  masterData: MasterData,
  clerkValue: string,
  record: CaseRecord,
  pageIndex: number,
  totalPages: number,
) => {
  const templateBytes = await fetchAsset('/templates/template_objekte.pdf')
  const overflowTemplate = await PDFDocument.load(templateBytes)
  const overflowForm = overflowTemplate.getForm()
  const overflowPage = overflowTemplate.getPages()[0]
  const consignorHeader = record.consignor.company.trim() || `${record.consignor.firstName} ${record.consignor.lastName}`.trim()
  const { clerk } = getClerkPdfValue(masterData, record.clerkId)

  setTextFieldValue(overflowForm, 'ELB Nr 2', record.meta.receiptNo)
  setTextFieldValue(overflowForm, 'Datum', record.meta.date)
  setTextFieldValue(overflowForm, 'Adresse EL', consignorHeader)
  setTextFieldValue(overflowForm, 'Seite N/N', `${pageIndex}/${totalPages}`)
  setTextFieldValue(overflowForm, 'Kommission', record.costs.kommission)
  setTextFieldValue(overflowForm, 'Transport', record.costs.transport)
  setTextFieldValue(overflowForm, 'Abb.-Kosten', record.costs.abbKosten)
  setTextFieldValue(overflowForm, 'Kosten ', record.costs.kostenExpertisen)
  setTextFieldValue(overflowForm, 'Versicherung ', record.costs.versicherung)
  setTextFieldValue(overflowForm, 'Diverses/Provenienz 2', record.costs.provenance)
  setTextFieldValue(overflowForm, 'Internet  1', record.costs.internet)
  setTextFieldValue(overflowForm, 'Int-Nr 2', '')
  setTextFieldValue(overflowForm, 'Erhalten 2', '')
  setTextFieldValue(overflowForm, 'Kapitel 2', '')
  setTextFieldValue(overflowForm, 'Kurzbeschreibung 2', '')
  setFirstAvailableTextFieldValue(overflowForm, ['Schätzung 2', 'Sch?tzung 2'], '')
  overflowForm.updateFieldAppearances(font)
  drawClerkOverlay(overflowPage, font, clerkValue, overflowForm, 'Sachbearbeiter 2')
  drawObjectTableOverlayV2(overflowPage, font, blocks.map((block) => block.item), masterData, overflowForm, '2')
  if (record.signatures.consignorPng) {
    await drawPreparedSignature(overflowTemplate, overflowPage, overflowForm, ['der Einlieferer Sig', 'der Einlieferer Sig 2'], record.signatures.consignorPng)
  }
  if (clerk?.signaturePng) {
    await drawPreparedSignature(overflowTemplate, overflowPage, overflowForm, ['Koller Auktionen Sig 1'], clerk.signaturePng)
  }
  overflowForm.flatten()

  const [copiedPage] = await pdfDoc.copyPages(overflowTemplate, [0])
  pdfDoc.addPage(copiedPage)
}

const getDepartmentCode = (masterData: MasterData, departmentId: string) =>
  masterData.departments.find((entry) => entry.id === departmentId)?.code ?? '-'

const isIbidObject = (masterData: MasterData, auctionId: string) =>
  (masterData.auctions.find((entry) => entry.id === auctionId)?.number ?? '').toLowerCase().startsWith('ibid')

const getAuctionWithDate = (masterData: MasterData, auctionId: string) => {
  const auction = masterData.auctions.find((entry) => entry.id === auctionId)
  if (!auction) {
    return ''
  }
  const month = auction.month ? auction.month.padStart(2, '0') : '--'
  const year = auction.year ? auction.year.slice(-2) : '--'
  return `${auction.number}\n${month}/${year}`
}

const getWordAddress = (record: CaseRecord) =>
  [
    record.consignor.title && record.consignor.title !== 'Keine Anrede' ? record.consignor.title : '',
    `${record.consignor.firstName} ${record.consignor.lastName}`.trim(),
    record.consignor.addressAddon1,
    `${record.consignor.zip} ${record.consignor.city}`.trim(),
    record.consignor.country,
    record.consignor.phone,
    record.consignor.email,
  ]
    .filter(Boolean)
    .join('\n')

const getWordObjectLines = (item: CaseRecord['objects'][number], masterData: MasterData) => [
  item.shortDesc || '-',
  ...(item.desc.trim() ? [item.desc.trim()] : []),
  ...(item.remarks.trim() ? [item.remarks.trim()] : []),
  ...(item.estimateLow.trim() || item.estimateHigh.trim() ? [`Schätzung: CHF ${item.estimateLow || '-'} - ${item.estimateHigh || '-'}`] : []),
  ...(item.limit.trim()
    ? [`${isIbidObject(masterData, item.auctionId) ? 'Startpreis' : item.netLimit ? 'Nettolimite' : 'Limite'}: CHF ${item.limit.trim()}`]
    : []),
]

const paginateWordObjectEntries = (items: CaseRecord['objects'], masterData: MasterData) => {
  const entries = items.map((item, index) => {
    const lines = getWordObjectLines(item, masterData).map((line) => normalizeVisibleContent(withDisplayUmlauts(line)))
    return {
      item,
      lines,
      displayIndex: index + 1,
      unitCount: Math.max(lines.length, item.photos[0]?.dataUrl ? WORD_PHOTO_OBJECT_UNITS : WORD_MIN_OBJECT_UNITS),
    }
  })

  const pages: typeof entries[] = []
  let current: typeof entries = []
  let used = 0

  entries.forEach((entry) => {
    if (current.length && used + entry.unitCount > WORD_PAGE_UNIT_BUDGET) {
      pages.push(current)
      current = []
      used = 0
    }
    current.push(entry)
    used += entry.unitCount
  })

  if (current.length || !pages.length) {
    pages.push(current)
  }

  return pages
}

export const buildElbPdf = async (record: CaseRecord, masterData: MasterData) => {
  const pdfBytes = await fetchAsset('/templates/template.pdf')
  const pdfDoc = await PDFDocument.load(pdfBytes)
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const form = pdfDoc.getForm()
  const page = pdfDoc.getPages()[0]
  const { clerk, value: clerkValue } = getClerkPdfValue(masterData, record.clerkId)
  const provenanceText = record.costs.provenance
  const objectPages = paginateElbObjectBlocks(record.objects, masterData, PDF_OBJECT_MAX_UNITS_PER_PAGE)
  const firstPageObjects = objectPages[0]?.map((block) => block.item) ?? []

  setTextFieldValue(form, 'ELB Nr', record.meta.receiptNo)
  setTextFieldValue(form, 'Datum', record.meta.date)
  setTextFieldValue(form, 'Sachbearbeiter 2', '')
  setTextFieldValue(form, 'Adresse EL', getConsignorAddress(record))
  setTextFieldValue(form, 'Adresse EG', getOwnerAddress(record))
  setTextFieldValue(form, 'IBAN/Kontonr', `IBAN/Kontonr: ${record.bank.iban || '-'}`)
  setTextFieldValue(form, 'BIC/SWIFT', `BIC/SWIFT: ${record.bank.bic || '-'}`)
  setTextFieldValue(form, 'Bankangaben: Beg?nstigter', `Beguenstigter: ${getEffectiveBeneficiary(record) || '-'}`)
  setTextFieldValue(form, 'Bankangaben: Begünstigter', `Beguenstigter: ${getEffectiveBeneficiary(record) || '-'}`)
  setTextFieldValue(form, 'Bankangaben: Beg?nstigter', `Begünstigter: ${getEffectiveBeneficiary(record) || '-'}`)
  setTextFieldValue(form, 'Bankangaben: BegÃ¼nstigter', `Begünstigter: ${getEffectiveBeneficiary(record) || '-'}`)
  setTextFieldValue(form, 'Kommission', record.costs.kommission)
  setTextFieldValue(form, 'Transport', record.costs.transport)
  setTextFieldValue(form, 'Abb.-Kosten', record.costs.abbKosten)
  setTextFieldValue(form, 'Kosten ', record.costs.kostenExpertisen)
  setTextFieldValue(form, 'Versicherung ', record.costs.versicherung)
  setTextFieldValue(form, 'Diverses/Provenienz 2', provenanceText)
  setFirstAvailableTextFieldValue(form, ['Schätzung 1', 'Sch?tzung 1'], '')
  setTextFieldValue(form, 'Kurzbeschreibung 1', '')
  setTextFieldValue(form, 'Int-Nr 1', '')
  setTextFieldValue(form, 'Erhalten 1', '')
  setTextFieldValue(form, 'Kapitel 1', '')
  setTextFieldValue(form, 'Internet  1', record.costs.internet)
  setTextFieldValue(form, 'EL ID/Passnr  1', `ID/Passnummer: ${record.consignor.passportNo || '-'}`)
  setTextFieldValue(form, 'EL Nationalit?t  1', `Nationalitaet: ${record.consignor.nationality || '-'}`)
  setTextFieldValue(form, 'EL Nationalität  1', `Nationalitaet: ${record.consignor.nationality || '-'}`)
  setTextFieldValue(form, 'EL Nationalit?t  1', `Nationalität: ${record.consignor.nationality || '-'}`)
  setTextFieldValue(form, 'EL NationalitÃ¤t  1', `Nationalität: ${record.consignor.nationality || '-'}`)
  setTextFieldValue(form, 'EL Geburtsdatum 1', `Geburtsdatum: ${record.consignor.birthdate || '-'}`)
  form.updateFieldAppearances(font)
  drawClerkOverlay(page, font, clerkValue, form)
  drawObjectTableOverlayV2(page, font, firstPageObjects, masterData, form, '1')

  if (record.signatures.consignorPng) {
    await drawPreparedSignature(pdfDoc, page, form, ['der Einlieferer Sig', 'der Einlieferer Sig 2'], record.signatures.consignorPng)
  }
  if (clerk?.signaturePng) {
    await drawPreparedSignature(pdfDoc, page, form, ['Koller Auktionen Sig 1'], clerk.signaturePng)
  }
  form.flatten()

  for (const [overflowIndex, overflowBlocks] of objectPages.slice(1).entries()) {
    await drawOverflowObjectPage(
      pdfDoc,
      font,
      overflowBlocks,
      masterData,
      clerkValue,
      record,
      overflowIndex + 2,
      objectPages.length,
    )
  }

  return pdfDoc.save()
}

export const buildObjectsPdf = async (record: CaseRecord, masterData: MasterData) => {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const { value: clerkValue } = getClerkPdfValue(masterData, record.clerkId)
  const consignorName = `${record.consignor.title} ${record.consignor.firstName} ${record.consignor.lastName}`.trim()
  const consignorAddress = getConsignorAddress(record)
  const marginX = 28
  const pageTop = a4.height - 30
  const pageBottom = 40
  const pageWidth = a4.width - marginX * 2

  const drawPageMeta = (page: PDFPage, pageIndex: number, totalPages: number) => {
    page.drawText(`ELB: ${record.meta.receiptNo}   Datum: ${record.meta.date}`, { x: marginX, y: pageTop, size: 8.5, font })
    page.drawText(clerkValue.replace(/\n/g, ' | '), { x: 220, y: pageTop, size: 8.5, font })
    page.drawText(`${pageIndex}/${totalPages}`, { x: a4.width - 54, y: pageTop, size: 8.5, font })
  }

  const buildObjectLines = (item: CaseRecord['objects'][number]) => [
    `Int.-Nr.: ${item.intNo || '-'}`,
    `Auktion: ${getAuctionWithDate(masterData, item.auctionId).replace('\n', ' ') || '-'}`,
    `Abteilung: ${getDepartmentCode(masterData, item.departmentId) || '-'}`,
    item.shortDesc || '-',
    ...(item.desc.trim() ? [item.desc.trim()] : []),
    ...(item.received.trim() ? [`Referenznr.: ${item.received.trim()}`] : []),
    ...(item.remarks.trim() ? [`Bemerkungen: ${item.remarks.trim()}`] : []),
    ...(item.estimateLow.trim() || item.estimateHigh.trim() ? [`${item.estimateLow || '-'} / ${item.estimateHigh || '-'}`] : []),
    ...(item.limit.trim() ? [`${isIbidObject(masterData, item.auctionId) ? 'Startpreis' : item.netLimit ? 'Nettolimite' : 'Limite'}: ${item.limit.trim()}`] : []),
  ]

  const measureObjectHeight = (item: CaseRecord['objects'][number]) => {
    const lines = buildObjectLines(item)
    const textHeight = lines.length * 11
    const photoRows = Math.max(1, Math.ceil(Math.min(item.photos.length, 12) / 4))
    const photosHeight = item.photos.length ? photoRows * 70 + (photoRows - 1) * 6 + 12 : 0
    return { lines, height: 16 + textHeight + photosHeight + 18 }
  }

  const layouts = record.objects.map((item) => ({ item, ...measureObjectHeight(item) }))
  const pages: typeof layouts[] = []
  let current: typeof layouts = []
  let used = 0
  const usableHeight = pageTop - pageBottom - 18

  layouts.forEach((layout) => {
    if (current.length && used + layout.height > usableHeight) {
      pages.push(current)
      current = []
      used = 0
    }
    current.push(layout)
    used += layout.height + 10
  })
  if (current.length) {
    pages.push(current)
  }

    for (const [pageIndex, pageLayouts] of pages.entries()) {
    const page = pdf.addPage([a4.width, a4.height])
    drawPageMeta(page, pageIndex + 1, pages.length + 1)
    let cursorY = pageTop - 18

    for (const { item, lines, height } of pageLayouts) {
      const boxTop = cursorY
      const boxBottom = cursorY - height
      page.drawRectangle({
        x: marginX,
        y: boxBottom,
        width: pageWidth,
        height,
        borderWidth: 0.8,
        borderColor: rgb(0.78, 0.78, 0.78),
      })

      drawWrappedText(page, lines.join('\n'), marginX + 10, boxTop - 16, pageWidth - 20, 11, 9.4, font)

      if (item.photos.length) {
        const cols = 4
        const gap = 6
        const cellWidth = (pageWidth - 20 - gap * (cols - 1)) / cols
        const cellHeight = 70
        const textHeight = lines.length * 11
        const photoTop = boxTop - 16 - textHeight - 10
        for (const [photoIndex, photo] of item.photos.slice(0, 12).entries()) {
          const row = Math.floor(photoIndex / cols)
          const col = photoIndex % cols
          const image = await (photo.dataUrl.startsWith('data:image/png')
            ? pdf.embedPng(await dataUrlToBytes(photo.dataUrl))
            : pdf.embedJpg(await dataUrlToBytes(photo.dataUrl)))
          const fitted = fitIntoBox(image.width, image.height, cellWidth, cellHeight)
          const x = marginX + 10 + col * (cellWidth + gap) + (cellWidth - fitted.width) / 2
          const y = photoTop - row * (cellHeight + gap) - fitted.height
          page.drawImage(image, { x, y, width: fitted.width, height: fitted.height })
        }
      }

      cursorY = boxBottom - 10
    }
  }

  const summaryPage = pdf.addPage([a4.width, a4.height])
  drawPageMeta(summaryPage, pages.length + 1, pages.length + 1)
  summaryPage.drawText('Einlieferer', { x: marginX, y: pageTop - 24, size: 11, font: bold })
  drawWrappedText(summaryPage, [consignorName, consignorAddress].join('\n'), marginX, pageTop - 44, 230, 13, 10, font)
  summaryPage.drawText('Bank', { x: 310, y: pageTop - 24, size: 11, font: bold })
  drawWrappedText(summaryPage, [`Begünstigter: ${getEffectiveBeneficiary(record) || '-'}`, `IBAN/Kontonr: ${record.bank.iban || '-'}`, `BIC/SWIFT: ${record.bank.bic || '-'}`].join('\n'), 310, pageTop - 44, 240, 13, 10, font)
  summaryPage.drawText('Konditionen / Notizen', { x: marginX, y: pageTop - 180, size: 11, font: bold })
  drawWrappedText(summaryPage, [
    `Kommission: ${record.costs.kommission || '-'}`,
    `Versicherung: ${record.costs.versicherung || '-'}`,
    `Transport: ${record.costs.transport || '-'}`,
    `Abb.-Kosten: ${record.costs.abbKosten || '-'}`,
    `Kosten Expertisen: ${record.costs.kostenExpertisen || '-'}`,
    `Internet: ${record.costs.internet || '-'}`,
    record.costs.provenance || '',
    record.internalInfo.note || '',
  ].filter(Boolean).join('\n'), marginX, pageTop - 200, pageWidth, 13, 10, font)

  return pdf.save()
}

export const buildWordDocx = async (record: CaseRecord, masterData: MasterData) => {
  const templateBytes = await fetchAsset('/templates/Koller_sl_de.docx')
  const zip = await JSZip.loadAsync(templateBytes)
  let documentXml = await zip.file('word/document.xml')!.async('string')

  documentXml = documentXml
    .replace('{{ADDRESS}}', 'ADDRESS_PLACEHOLDER')
    .replace('{{DATE}}', 'DATE_PLACEHOLDER')

  const parser = new DOMParser()
  const serializer = new XMLSerializer()
  const doc = parser.parseFromString(documentXml, 'application/xml')
  const relsXml = await zip.file('word/_rels/document.xml.rels')!.async('string')
  const relsDoc = parser.parseFromString(relsXml, 'application/xml')
  const contentTypesXml = await zip.file('[Content_Types].xml')!.async('string')
  const contentTypesDoc = parser.parseFromString(contentTypesXml, 'application/xml')
  const wNs = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
  const aNs = 'http://schemas.openxmlformats.org/drawingml/2006/main'
  const relNs = 'http://schemas.openxmlformats.org/package/2006/relationships'
  const imageRelationshipType = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'

  const tables = Array.from(doc.getElementsByTagNameNS(wNs, 'tbl'))
  const addressTable = tables[0]
  const metaTable = tables[1]
  const objectTable = tables[2]
  const templateRow = objectTable?.getElementsByTagNameNS(wNs, 'tr')[0]
  if (!addressTable || !metaTable || !objectTable || !templateRow) {
    throw new Error('Die Objektzeile in Koller_sl_de.docx konnte nicht gefunden werden.')
  }
  const addressTableTemplate = addressTable.cloneNode(true) as Element
  const metaTableTemplate = metaTable.cloneNode(true) as Element
  const objectTableTemplate = objectTable.cloneNode(true) as Element

  const templateCells = Array.from(templateRow.getElementsByTagNameNS(wNs, 'tc'))
  const firstCellParagraph = templateCells[0].getElementsByTagNameNS(wNs, 'p')[0]
  const secondCellParagraphTemplate = templateCells[1].getElementsByTagNameNS(wNs, 'p')[0]
  const thirdCellParagraphs = Array.from(templateCells[2].getElementsByTagNameNS(wNs, 'p'))
  const normalParagraphTemplate = thirdCellParagraphs[0]
  const limitParagraphTemplate = thirdCellParagraphs.at(-1) ?? thirdCellParagraphs[0]
  const createParagraph = (sourceParagraph: Element, paragraphText: string) => {
    const paragraph = sourceParagraph.cloneNode(true) as Element
    Array.from(paragraph.getElementsByTagNameNS(wNs, 'r')).forEach((run) => run.parentNode?.removeChild(run))
    const run = doc.createElementNS(wNs, 'w:r')
    const runPr = sourceParagraph.getElementsByTagNameNS(wNs, 'rPr')[0]
    if (runPr) {
      run.appendChild(runPr.cloneNode(true))
    }
    const textNode = doc.createElementNS(wNs, 'w:t')
    textNode.textContent = paragraphText
    run.appendChild(textNode)
    paragraph.appendChild(run)
    return paragraph
  }

  const createEmptyParagraph = (sourceParagraph: Element) => {
    const paragraph = sourceParagraph.cloneNode(true) as Element
    Array.from(paragraph.getElementsByTagNameNS(wNs, 'r')).forEach((run) => run.parentNode?.removeChild(run))
    return paragraph
  }

  const replaceTextPlaceholderInRoot = (root: Document | Element, placeholder: string, value: string) => {
    const textNode = Array.from(root.getElementsByTagNameNS(wNs, 't')).find((node) => node.textContent === placeholder)
    if (textNode) {
      textNode.textContent = value
    }
  }

  const replaceAddressPlaceholderInRoot = (root: Document | Element, placeholder: string, lines: string[]) => {
    const textNode = Array.from(root.getElementsByTagNameNS(wNs, 't')).find((node) => node.textContent === placeholder)
    const run = textNode?.parentNode as Element | null
    if (!textNode || !run) {
      return
    }
    Array.from(run.childNodes).forEach((child) => run.removeChild(child))
    lines.forEach((line, index) => {
      if (index > 0) {
        run.appendChild(doc.createElementNS(wNs, 'w:br'))
      }
      const nextText = doc.createElementNS(wNs, 'w:t')
      nextText.textContent = line
      run.appendChild(nextText)
    })
  }

  const ensureContentType = (extension: string, contentType: string) => {
    const existing = Array.from(contentTypesDoc.getElementsByTagName('Default')).find((entry) => entry.getAttribute('Extension') === extension)
    if (existing) {
      return
    }
    const node = contentTypesDoc.createElement('Default')
    node.setAttribute('Extension', extension)
    node.setAttribute('ContentType', contentType)
    contentTypesDoc.documentElement.appendChild(node)
  }

  let nextImageIndex = 2
  let nextRelationIndex =
    Array.from(relsDoc.getElementsByTagNameNS(relNs, 'Relationship'))
      .map((entry) => Number((entry.getAttribute('Id') || '').replace(/\D+/g, '')))
      .filter((value) => Number.isFinite(value))
      .reduce((max, value) => Math.max(max, value), 0) + 1

  const registerWordImage = async (dataUrl: string) => {
    const isPng = dataUrl.startsWith('data:image/png')
    const extension = isPng ? 'png' : 'jpg'
    ensureContentType(extension, isPng ? 'image/png' : 'image/jpeg')
    const filename = `image_generated_${nextImageIndex}.${extension}`
    nextImageIndex += 1
    zip.file(`word/media/${filename}`, await dataUrlToBytes(dataUrl))
    const relationId = `rId${nextRelationIndex}`
    nextRelationIndex += 1
    const relationship = relsDoc.createElementNS(relNs, 'Relationship')
    relationship.setAttribute('Id', relationId)
    relationship.setAttribute('Type', imageRelationshipType)
    relationship.setAttribute('Target', `media/${filename}`)
    relsDoc.documentElement.appendChild(relationship)
    return relationId
  }

  const createObjectRow = async (item: CaseRecord['objects'][number], index: number) => {
    const row = templateRow.cloneNode(true) as Element
    const cells = Array.from(row.getElementsByTagNameNS(wNs, 'tc'))

    const firstCell = cells[0]
    Array.from(firstCell.getElementsByTagNameNS(wNs, 'p')).forEach((paragraph) => paragraph.parentNode?.removeChild(paragraph))
    firstCell.appendChild(createParagraph(firstCellParagraph, String(index + 1)))

    const secondCell = cells[1]
    Array.from(secondCell.getElementsByTagNameNS(wNs, 'p')).forEach((paragraph) => paragraph.parentNode?.removeChild(paragraph))
    if (item.photos[0]?.dataUrl) {
      const imageParagraph = secondCellParagraphTemplate.cloneNode(true) as Element
      const blip = imageParagraph.getElementsByTagNameNS(aNs, 'blip')[0]
      if (blip) {
        blip.setAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'r:embed', await registerWordImage(item.photos[0].dataUrl))
      }
      secondCell.appendChild(imageParagraph)
    } else {
      secondCell.appendChild(createEmptyParagraph(secondCellParagraphTemplate))
    }

    const thirdCell = cells[2]
    Array.from(thirdCell.getElementsByTagNameNS(wNs, 'p')).forEach((paragraph) => paragraph.parentNode?.removeChild(paragraph))
    getWordObjectLines(item, masterData).forEach((line) => {
      const paragraphTemplate =
        line.startsWith('Limite:') || line.startsWith('Nettolimite:') || line.startsWith('Startpreis:')
          ? limitParagraphTemplate
          : normalParagraphTemplate
      thirdCell.appendChild(createParagraph(paragraphTemplate, line))
    })

    return row
  }

  const createBlankObjectRow = () => {
    const row = templateRow.cloneNode(true) as Element
    const cells = Array.from(row.getElementsByTagNameNS(wNs, 'tc'))
    cells.forEach((cell, cellIndex) => {
      Array.from(cell.getElementsByTagNameNS(wNs, 'p')).forEach((paragraph) => paragraph.parentNode?.removeChild(paragraph))
      if (cellIndex === 0) {
        cell.appendChild(createEmptyParagraph(firstCellParagraph))
        return
      }
      if (cellIndex === 1) {
        cell.appendChild(createEmptyParagraph(secondCellParagraphTemplate))
        return
      }
      cell.appendChild(createEmptyParagraph(normalParagraphTemplate))
    })
    return row
  }

  const objectChunks = paginateWordObjectEntries(record.objects, masterData)

  replaceAddressPlaceholderInRoot(addressTable, 'ADDRESS_PLACEHOLDER', getWordAddress(record).split('\n').filter(Boolean))
  replaceTextPlaceholderInRoot(doc, 'DATE_PLACEHOLDER', record.meta.date)

  Array.from(objectTable.getElementsByTagNameNS(wNs, 'tr')).forEach((row) => row.parentNode?.removeChild(row))
  for (const entry of objectChunks[0] ?? []) {
    objectTable.appendChild(await createObjectRow(entry.item, entry.displayIndex - 1))
  }
  let firstPageUnits = (objectChunks[0] ?? []).reduce((sum, entry) => sum + entry.unitCount, 0)
  while (firstPageUnits + WORD_MIN_OBJECT_UNITS <= WORD_PAGE_UNIT_BUDGET) {
    objectTable.appendChild(createBlankObjectRow())
    firstPageUnits += WORD_MIN_OBJECT_UNITS
  }

  const body = doc.getElementsByTagNameNS(wNs, 'body')[0]
  const sectionProperties = body.getElementsByTagNameNS(wNs, 'sectPr')[0]

  const createPageBreak = () => {
    const paragraph = doc.createElementNS(wNs, 'w:p')
    const run = doc.createElementNS(wNs, 'w:r')
    const pageBreak = doc.createElementNS(wNs, 'w:br')
    pageBreak.setAttribute('w:type', 'page')
    run.appendChild(pageBreak)
    paragraph.appendChild(run)
    return paragraph
  }

  for (const [chunkIndex, chunk] of objectChunks.slice(1).entries()) {
    const pageNo = chunkIndex + 2
    body.insertBefore(createPageBreak(), sectionProperties)

    const emptyAddressTable = addressTableTemplate.cloneNode(true) as Element
    replaceAddressPlaceholderInRoot(emptyAddressTable, 'ADDRESS_PLACEHOLDER', [])
    body.insertBefore(emptyAddressTable, sectionProperties)

    const pageMetaTable = metaTableTemplate.cloneNode(true) as Element
    replaceTextPlaceholderInRoot(pageMetaTable, 'DATE_PLACEHOLDER', `Seite ${pageNo}/${objectChunks.length}`)
    body.insertBefore(pageMetaTable, sectionProperties)

    const pageObjectTable = objectTableTemplate.cloneNode(true) as Element
    Array.from(pageObjectTable.getElementsByTagNameNS(wNs, 'tr')).forEach((row) => row.parentNode?.removeChild(row))
    for (const entry of chunk) {
      pageObjectTable.appendChild(await createObjectRow(entry.item, entry.displayIndex - 1))
    }
    let pageUnits = chunk.reduce((sum, entry) => sum + entry.unitCount, 0)
    while (pageUnits + WORD_MIN_OBJECT_UNITS <= WORD_PAGE_UNIT_BUDGET) {
      pageObjectTable.appendChild(createBlankObjectRow())
      pageUnits += WORD_MIN_OBJECT_UNITS
    }
    body.insertBefore(pageObjectTable, sectionProperties)
  }

  zip.file('word/document.xml', serializer.serializeToString(doc))
  zip.file('word/_rels/document.xml.rels', serializer.serializeToString(relsDoc))
  zip.file('[Content_Types].xml', serializer.serializeToString(contentTypesDoc))

  return zip.generateAsync({ type: 'blob' })
}

export const buildWordPdf = async (record: CaseRecord, masterData: MasterData) => {
  const pdf = await PDFDocument.create()
  const backgroundBytes = await fetchAsset('/templates/tmp_schaetzlist_objekte_page1.png')
  const background = await pdf.embedPng(backgroundBytes)
  const font = await pdf.embedFont(StandardFonts.Helvetica)

  const objectChunks = paginateWordObjectEntries(record.objects, masterData)

  for (const [chunkIndex, chunk] of objectChunks.entries()) {
    const page = pdf.addPage([a4.width, a4.height])
    page.drawImage(background, { x: 0, y: 0, width: a4.width, height: a4.height })

    if (chunkIndex === 0) {
      drawWrappedText(page, getWordAddress(record), 82, 590, 170, 12, 10.5, font)
      page.drawText(record.meta.date, { x: 435, y: 332, size: 10.5, font, color: rgb(0.12, 0.12, 0.16) })
    } else {
      page.drawText(`Seite ${chunkIndex + 1}/${objectChunks.length}`, { x: 410, y: 332, size: 10.5, font, color: rgb(0.12, 0.12, 0.16) })
    }

    let consumedUnits = 0
    for (const entry of chunk) {
      const rowHeight = entry.unitCount * WORD_UNIT_HEIGHT
      const topY = 280 - consumedUnits * WORD_UNIT_HEIGHT
      page.drawText(String(entry.displayIndex), {
        x: 77,
        y: topY,
        size: 10,
        font,
        color: rgb(0.12, 0.12, 0.16),
      })
      if (entry.item.photos[0]?.dataUrl) {
        const image = await (entry.item.photos[0].dataUrl.startsWith('data:image/png')
          ? pdf.embedPng(await dataUrlToBytes(entry.item.photos[0].dataUrl))
          : pdf.embedJpg(await dataUrlToBytes(entry.item.photos[0].dataUrl)))
        const fitted = fitIntoBox(image.width, image.height, 124, Math.max(rowHeight - 8, 60))
        page.drawImage(image, {
          x: 108 + (124 - fitted.width) / 2,
          y: topY - rowHeight + (rowHeight - fitted.height) / 2,
          width: fitted.width,
          height: fitted.height,
        })
      }
      drawWrappedText(page, entry.lines.join('\n'), 255, topY + 10, 245, WORD_UNIT_HEIGHT, 10.4, font)
      consumedUnits += entry.unitCount
    }
  }

  return pdf.save()
}

export const exportAllArtifacts = async (record: CaseRecord, masterData: MasterData) => {
  const [elbPdf, objectsPdf, wordDocx, wordPdf] = await Promise.all([
    buildElbPdf(record, masterData),
    buildObjectsPdf(record, masterData),
    buildWordDocx(record, masterData),
    buildWordPdf(record, masterData),
  ])

  const zip = new JSZip()
  zip.file('payload.json', JSON.stringify(record, null, 2))
  zip.file('elb.pdf', elbPdf)
  zip.file('objekte.pdf', objectsPdf)
  zip.file('schaetzliste.docx', wordDocx)
  zip.file('schaetzliste.pdf', wordPdf)

  record.objects.forEach((item) => {
    item.photos.forEach((photo) => {
      const base64 = photo.dataUrl.split(',')[1]
      zip.file(`bilder/${item.id}/${photo.name}`, base64, { base64: true })
    })
  })

  const blob = await zip.generateAsync({ type: 'blob' })
  downloadBlob(`${record.meta.receiptNo || 'elb'}-export.zip`, blob)
}

export const downloadElbPdf = async (record: CaseRecord, masterData: MasterData) => {
  const blob = new Blob([toArrayBuffer(await buildElbPdf(record, masterData))], { type: 'application/pdf' })
  downloadBlob(`${record.meta.receiptNo || 'elb'}.pdf`, blob)
}

export const downloadObjectsPdf = async (record: CaseRecord, masterData: MasterData) => {
  const blob = new Blob([toArrayBuffer(await buildObjectsPdf(record, masterData))], { type: 'application/pdf' })
  downloadBlob(`${record.meta.receiptNo || 'elb'}-objekte.pdf`, blob)
}

export const downloadWordDocx = async (record: CaseRecord, masterData: MasterData) => {
  downloadBlob(`${record.meta.receiptNo || 'elb'}-schaetzliste.docx`, await buildWordDocx(record, masterData))
}

export const downloadWordPdf = async (record: CaseRecord, masterData: MasterData, receiptNo: string) => {
  const blob = new Blob([toArrayBuffer(await buildWordPdf(record, masterData))], { type: 'application/pdf' })
  downloadBlob(`${receiptNo || 'elb'}-schaetzliste.pdf`, blob)
}
