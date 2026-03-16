import JSZip from 'jszip'
import { Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from 'docx'
import { PDFDocument, StandardFonts, rgb, type PDFField, type PDFPage } from 'pdf-lib'
import { pdfExportAnchors } from './templateMaps'
import type { CaseRecord, MasterData, PreviewPage } from './types'

const a4 = { width: 595.28, height: 841.89 }
const objectsPdfLayout = {
  meta: {
    intNo: { x: 0.08, y: 0.925, size: 11 },
    shortDesc: { x: 0.2, y: 0.925, size: 11 },
    department: { x: 0.08, y: 0.885, size: 10 },
    auction: { x: 0.52, y: 0.885, size: 10 },
    details: { x: 0.08, y: 0.835, width: 0.84, lineHeight: 12, size: 10 },
    estimate: { x: 0.08, y: 0.69, size: 11 },
    limit: { x: 0.52, y: 0.69, size: 10 },
    remarks: { x: 0.08, y: 0.655, width: 0.84, lineHeight: 12, size: 9 },
  },
  photoGrid: {
    startX: 0.08,
    startY: 0.58,
    maxColumns: 4,
    boxWidth: 104,
    boxHeight: 86,
    gapX: 12,
    gapY: 28,
    captionOffset: 10,
  },
  summary: {
    name: { x: 0.08, y: 0.92, size: 12 },
    address: { x: 0.08, y: 0.885, size: 10 },
    city: { x: 0.08, y: 0.855, size: 10 },
    owner: { x: 0.08, y: 0.81, size: 10 },
    bank: { x: 0.08, y: 0.765, size: 10 },
    note: { x: 0.08, y: 0.72, width: 0.84, lineHeight: 13, size: 10 },
  },
} as const

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

const buildAddressLines = (
  lines: Array<string | undefined | null>,
  maxLineLength = 34,
) => {
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

const drawWrappedText = (
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  size: number,
) => {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let current = ''

  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word
    if (next.length * size * 0.48 > maxWidth && current) {
      lines.push(current)
      current = word
      return
    }
    current = next
  })
  if (current) {
    lines.push(current)
  }

  lines.forEach((line, index) => {
    page.drawText(line, {
      x,
      y: y - index * lineHeight,
      size,
      color: rgb(0.12, 0.12, 0.16),
    })
  })
}

const getFieldByName = (form: ReturnType<PDFDocument['getForm']>, name: string) =>
  form.getFields().find((field) => field.getName() === name) ?? null

const setTextFieldValue = (
  form: ReturnType<PDFDocument['getForm']>,
  name: string,
  value: string,
) => {
  const field = getFieldByName(form, name)
  if (!field || !('setText' in field)) {
    return
  }
  ;(field as PDFField & { setText: (next: string) => void }).setText(value)
}

export const buildElbPdf = async (record: CaseRecord, masterData: MasterData) => {
  const pdfBytes = await fetchAsset('/templates/template.pdf')
  const pdfDoc = await PDFDocument.load(pdfBytes)
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const form = pdfDoc.getForm()
  const pages = pdfDoc.getPages()
  const page = pages[0]
  const { width, height } = page.getSize()
  const firstObject = record.objects[0]

  const clerkName = masterData.clerks.find((clerk) => clerk.id === record.clerkId)?.name ?? ''
  const consignorName = `${record.consignor.title} ${record.consignor.firstName} ${record.consignor.lastName}`.trim()
  const consignorAddress = buildAddressLines([
    record.consignor.company,
    consignorName,
    record.consignor.addressAddon1,
    `${record.consignor.street} ${record.consignor.houseNo}`.trim(),
    `${record.consignor.zip} ${record.consignor.city}`.trim(),
    record.consignor.country,
  ]).join('\n')
  const ownerAddress = buildAddressLines([
    `${record.owner.firstName} ${record.owner.lastName}`.trim(),
    `${record.owner.street} ${record.owner.houseNo}`.trim(),
    `${record.owner.zip} ${record.owner.city}`.trim(),
    record.owner.country,
  ]).join('\n')

  setTextFieldValue(form, 'ELB Nr', record.meta.receiptNo)
  setTextFieldValue(form, 'Datum', record.meta.date)
  setTextFieldValue(form, 'Sachbearbeiter 2', clerkName)
  setTextFieldValue(form, 'Adresse EL', consignorAddress)
  setTextFieldValue(form, 'Adresse EG', ownerAddress)
  setTextFieldValue(form, 'IBAN/Kontonr', record.bank.iban)
  setTextFieldValue(form, 'BIC/SWIFT', record.bank.bic)
  setTextFieldValue(form, 'Bankangaben: Beg\u00fcnstigter', record.bank.beneficiary)
  setTextFieldValue(form, 'Kommission', record.costs.kommission)
  setTextFieldValue(form, 'Transport', record.costs.transport)
  setTextFieldValue(form, 'Abb', firstObject?.abbCost || record.costs.abbKosten)
  setTextFieldValue(form, 'Abb.-Kosten', record.costs.abbKosten)
  setTextFieldValue(form, 'Kosten ', record.costs.kostenExpertisen)
  setTextFieldValue(form, 'Versicherung ', record.costs.versicherung)
  setTextFieldValue(form, 'Diverses/Provenienz 2', [record.costs.provenance, record.internalInfo.note].filter(Boolean).join('\n\n'))
  setTextFieldValue(form, 'Sch\u00e4tzung 1', firstObject ? `${firstObject.estimateLow || '-'} / ${firstObject.estimateHigh || '-'}` : '')
  setTextFieldValue(form, 'Kurzbeschreibung 1', firstObject?.shortDesc || '')
  setTextFieldValue(form, 'Int-Nr 1', firstObject?.intNo || '')
  setTextFieldValue(form, 'Erhalten 1', firstObject?.received || '')
  setTextFieldValue(
    form,
    'Kapitel 1',
    firstObject ? masterData.departments.find((entry) => entry.id === firstObject.departmentId)?.name ?? '' : '',
  )
  setTextFieldValue(form, 'Internet  1', record.costs.internet)
  setTextFieldValue(form, 'EL ID/Passnr  1', record.consignor.passportNo)
  setTextFieldValue(form, 'EL Nationalit\u00e4t  1', record.consignor.nationality)
  setTextFieldValue(form, 'EL Geburtsdatum 1', record.consignor.birthdate)
  form.updateFieldAppearances(font)

  if (record.signatures.consignorPng) {
    const png = await pdfDoc.embedPng(await dataUrlToBytes(record.signatures.consignorPng))
    page.drawImage(png, {
      x: width * pdfExportAnchors.signature.x,
      y: height * pdfExportAnchors.signature.y,
      width: pdfExportAnchors.signature.width,
      height: pdfExportAnchors.signature.height,
    })
  }

  return pdfDoc.save()
}

export const buildObjectsPdf = async (record: CaseRecord, masterData: MasterData) => {
  const templateBytes = await fetchAsset('/templates/template_objekte.pdf')
  const templateDoc = await PDFDocument.load(templateBytes)
  const outputDoc = await PDFDocument.create()
  const font = await outputDoc.embedFont(StandardFonts.Helvetica)

  for (const item of record.objects) {
    const pagesForObject = Math.max(1, Math.ceil(Math.max(item.photos.length, 1) / 8))
    for (let pageIndex = 0; pageIndex < pagesForObject; pageIndex += 1) {
      const [copied] = await outputDoc.copyPages(templateDoc, [0])
      outputDoc.addPage(copied)
      const page = outputDoc.getPages().at(-1)!
      const { width, height } = page.getSize()
      const department = masterData.departments.find((entry) => entry.id === item.departmentId)?.name ?? ''
      const auction = masterData.auctions.find((entry) => entry.id === item.auctionId)

      page.drawText(item.intNo || '-', {
        x: width * objectsPdfLayout.meta.intNo.x,
        y: height * objectsPdfLayout.meta.intNo.y,
        size: objectsPdfLayout.meta.intNo.size,
        font,
      })
      page.drawText(item.shortDesc || '-', {
        x: width * objectsPdfLayout.meta.shortDesc.x,
        y: height * objectsPdfLayout.meta.shortDesc.y,
        size: objectsPdfLayout.meta.shortDesc.size,
        font,
      })
      page.drawText(department || '-', {
        x: width * objectsPdfLayout.meta.department.x,
        y: height * objectsPdfLayout.meta.department.y,
        size: objectsPdfLayout.meta.department.size,
        font,
      })
      page.drawText(auction ? `${auction.number} ${auction.month}/${auction.year}`.trim() : '-', {
        x: width * objectsPdfLayout.meta.auction.x,
        y: height * objectsPdfLayout.meta.auction.y,
        size: objectsPdfLayout.meta.auction.size,
        font,
      })
      drawWrappedText(
        page,
        item.desc || item.shortDesc || ' ',
        width * objectsPdfLayout.meta.details.x,
        height * objectsPdfLayout.meta.details.y,
        width * objectsPdfLayout.meta.details.width,
        objectsPdfLayout.meta.details.lineHeight,
        objectsPdfLayout.meta.details.size,
      )
      page.drawText(`${item.estimateLow || '-'} bis ${item.estimateHigh || '-'}`, {
        x: width * objectsPdfLayout.meta.estimate.x,
        y: height * objectsPdfLayout.meta.estimate.y,
        size: objectsPdfLayout.meta.estimate.size,
        font,
      })
      page.drawText(item.limit ? `Limite: ${item.limit}` : '-', {
        x: width * objectsPdfLayout.meta.limit.x,
        y: height * objectsPdfLayout.meta.limit.y,
        size: objectsPdfLayout.meta.limit.size,
        font,
      })
      drawWrappedText(
        page,
        item.remarks || ' ',
        width * objectsPdfLayout.meta.remarks.x,
        height * objectsPdfLayout.meta.remarks.y,
        width * objectsPdfLayout.meta.remarks.width,
        objectsPdfLayout.meta.remarks.lineHeight,
        objectsPdfLayout.meta.remarks.size,
      )

      const chunk = item.photos.slice(pageIndex * 8, pageIndex * 8 + 8)
      for (const [photoIndex, photo] of chunk.entries()) {
        const column = photoIndex % objectsPdfLayout.photoGrid.maxColumns
        const row = Math.floor(photoIndex / objectsPdfLayout.photoGrid.maxColumns)
        const x =
          width * objectsPdfLayout.photoGrid.startX +
          column * (objectsPdfLayout.photoGrid.boxWidth + objectsPdfLayout.photoGrid.gapX)
        const y =
          height * objectsPdfLayout.photoGrid.startY -
          row * (objectsPdfLayout.photoGrid.boxHeight + objectsPdfLayout.photoGrid.gapY)
        const bytes = await dataUrlToBytes(photo.dataUrl)
        const image = photo.dataUrl.startsWith('data:image/png')
          ? await outputDoc.embedPng(bytes)
          : await outputDoc.embedJpg(bytes)
        const fitted = fitIntoBox(
          image.width,
          image.height,
          objectsPdfLayout.photoGrid.boxWidth,
          objectsPdfLayout.photoGrid.boxHeight,
        )
        page.drawImage(image, {
          x: x + (objectsPdfLayout.photoGrid.boxWidth - fitted.width) / 2,
          y: y + (objectsPdfLayout.photoGrid.boxHeight - fitted.height) / 2,
          width: fitted.width,
          height: fitted.height,
        })
        page.drawText(photo.name, {
          x,
          y: y - objectsPdfLayout.photoGrid.captionOffset,
          size: 8,
          font,
        })
      }
    }
  }

  const [summaryPage] = await outputDoc.copyPages(templateDoc, [0])
  outputDoc.addPage(summaryPage)
  const finalPage = outputDoc.getPages().at(-1)!
  const { width, height } = finalPage.getSize()
  finalPage.drawText(`${record.consignor.firstName} ${record.consignor.lastName}`.trim(), {
    x: width * objectsPdfLayout.summary.name.x,
    y: height * objectsPdfLayout.summary.name.y,
    size: objectsPdfLayout.summary.name.size,
    font,
  })
  finalPage.drawText(`${record.consignor.street} ${record.consignor.houseNo}`.trim(), {
    x: width * objectsPdfLayout.summary.address.x,
    y: height * objectsPdfLayout.summary.address.y,
    size: objectsPdfLayout.summary.address.size,
    font,
  })
  finalPage.drawText(`${record.consignor.zip} ${record.consignor.city}`.trim(), {
    x: width * objectsPdfLayout.summary.city.x,
    y: height * objectsPdfLayout.summary.city.y,
    size: objectsPdfLayout.summary.city.size,
    font,
  })
  finalPage.drawText(
    `${record.owner.firstName} ${record.owner.lastName}`.trim() || '-',
    {
      x: width * objectsPdfLayout.summary.owner.x,
      y: height * objectsPdfLayout.summary.owner.y,
      size: objectsPdfLayout.summary.owner.size,
      font,
    },
  )
  finalPage.drawText(record.bank.iban || '-', {
    x: width * objectsPdfLayout.summary.bank.x,
    y: height * objectsPdfLayout.summary.bank.y,
    size: objectsPdfLayout.summary.bank.size,
    font,
  })
  drawWrappedText(
    finalPage,
    [record.costs.provenance, record.internalInfo.note].filter(Boolean).join('\n\n') || ' ',
    width * objectsPdfLayout.summary.note.x,
    height * objectsPdfLayout.summary.note.y,
    width * objectsPdfLayout.summary.note.width,
    objectsPdfLayout.summary.note.lineHeight,
    objectsPdfLayout.summary.note.size,
  )

  return outputDoc.save()
}

export const buildWordDocx = async (record: CaseRecord, masterData: MasterData) => {
  const header = new Paragraph({
    children: [new TextRun({ text: 'Koller Schätzliste', bold: true, size: 32 })],
    spacing: { after: 240 },
  })

  const summary = new Table({
    width: { size: 100, type: 'pct' },
    rows: [
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph('ELB-Nummer')] }),
          new TableCell({ children: [new Paragraph(record.meta.receiptNo)] }),
        ],
      }),
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph('Einlieferer')] }),
          new TableCell({
            children: [
              new Paragraph(
                `${record.consignor.title} ${record.consignor.firstName} ${record.consignor.lastName}`.trim(),
              ),
            ],
          }),
        ],
      }),
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph('Interessengebiete')] }),
          new TableCell({
            children: [
              new Paragraph(
                record.internalInfo.interestIds
                  .map((id) => masterData.departments.find((entry) => entry.id === id)?.name ?? id)
                  .join(', '),
              ),
            ],
          }),
        ],
      }),
    ],
  })

  const objectTable = new Table({
    width: { size: 100, type: 'pct' },
    rows: [
      new TableRow({
        children: ['Int.-Nr.', 'Abteilung', 'Kurzbeschreibung', 'Schätzung'].map(
          (label) =>
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: label, bold: true })] })],
            }),
        ),
      }),
      ...record.objects.map(
        (item) =>
          new TableRow({
            children: [
              new TableCell({ children: [new Paragraph(item.intNo || '-')] }),
              new TableCell({
                children: [
                  new Paragraph(
                    masterData.departments.find((entry) => entry.id === item.departmentId)?.name ?? '-',
                  ),
                ],
              }),
              new TableCell({ children: [new Paragraph(item.shortDesc || '-')] }),
              new TableCell({
                children: [new Paragraph(`${item.estimateLow || '-'} / ${item.estimateHigh || '-'}`)],
              }),
            ],
          }),
      ),
    ],
  })

  const doc = new Document({
    sections: [
      {
        children: [
          header,
          summary,
          new Paragraph({ text: '', spacing: { after: 200 } }),
          objectTable,
          new Paragraph({ text: '', spacing: { after: 200 } }),
          new Paragraph(record.internalInfo.note || ''),
        ],
      },
    ],
  })

  return Packer.toBlob(doc)
}

export const buildWordPdf = async (pages: PreviewPage[]) => {
  const pdf = await PDFDocument.create()
  const backgroundBytes = await fetchAsset('/templates/tmp_schaetzlist_objekte_page1.png')
  const background = await pdf.embedPng(backgroundBytes)

  pages.forEach((previewPage) => {
    const page = pdf.addPage([a4.width, a4.height])
    page.drawImage(background, { x: 0, y: 0, width: a4.width, height: a4.height })
    previewPage.fields.forEach((field) => {
      drawWrappedText(
        page,
        field.value || '-',
        a4.width * field.x,
        a4.height - a4.height * field.y - 10,
        a4.width * field.w,
        12,
        field.id.startsWith('word-object-') ? 10 : 11,
      )
    })
  })

  return pdf.save()
}

export const exportAllArtifacts = async (
  record: CaseRecord,
  masterData: MasterData,
  wordPreviewPages: PreviewPage[],
) => {
  const [elbPdf, objectsPdf, wordDocx, wordPdf] = await Promise.all([
    buildElbPdf(record, masterData),
    buildObjectsPdf(record, masterData),
    buildWordDocx(record, masterData),
    buildWordPdf(wordPreviewPages),
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

  const bundle = await zip.generateAsync({ type: 'blob' })
  downloadBlob(`${record.meta.receiptNo || 'elb'}-final.zip`, bundle)
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

export const downloadWordPdf = async (pages: PreviewPage[], receiptNo: string) => {
  const blob = new Blob([toArrayBuffer(await buildWordPdf(pages))], { type: 'application/pdf' })
  downloadBlob(`${receiptNo || 'elb'}-schaetzliste.pdf`, blob)
}
