import JSZip from 'jszip'
import { Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from 'docx'
import { PDFDocument, StandardFonts, rgb, type PDFPage } from 'pdf-lib'
import { pdfExportAnchors } from './templateMaps'
import type { CaseRecord, MasterData, PreviewPage } from './types'

const a4 = { width: 595.28, height: 841.89 }

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

export const buildElbPdf = async (record: CaseRecord, masterData: MasterData) => {
  const pdfBytes = await fetchAsset('/templates/template.pdf')
  const pdfDoc = await PDFDocument.load(pdfBytes)
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const pages = pdfDoc.getPages()
  const page = pages[0]
  const { width, height } = page.getSize()

  const clerkName = masterData.clerks.find((clerk) => clerk.id === record.clerkId)?.name ?? ''

  page.drawText(record.meta.receiptNo, {
    x: width * pdfExportAnchors.receiptNo.x,
    y: height * pdfExportAnchors.receiptNo.y,
    size: pdfExportAnchors.receiptNo.size,
    font,
  })
  page.drawText(record.meta.date, {
    x: width * pdfExportAnchors.date.x,
    y: height * pdfExportAnchors.date.y,
    size: pdfExportAnchors.date.size,
    font,
  })
  page.drawText(clerkName, {
    x: width * pdfExportAnchors.clerk.x,
    y: height * pdfExportAnchors.clerk.y,
    size: pdfExportAnchors.clerk.size,
    font,
  })
  page.drawText(
    `${record.consignor.title} ${record.consignor.firstName} ${record.consignor.lastName}`.trim(),
    {
      x: width * pdfExportAnchors.consignorName.x,
      y: height * pdfExportAnchors.consignorName.y,
      size: pdfExportAnchors.consignorName.size,
      font,
    },
  )
  page.drawText(
    `${record.consignor.street} ${record.consignor.houseNo}`.trim(),
    {
      x: width * pdfExportAnchors.consignorStreet.x,
      y: height * pdfExportAnchors.consignorStreet.y,
      size: pdfExportAnchors.consignorStreet.size,
      font,
    },
  )
  page.drawText(
    `${record.consignor.zip} ${record.consignor.city}`.trim(),
    {
      x: width * pdfExportAnchors.consignorCity.x,
      y: height * pdfExportAnchors.consignorCity.y,
      size: pdfExportAnchors.consignorCity.size,
      font,
    },
  )
  page.drawText(record.bank.iban, {
    x: width * pdfExportAnchors.iban.x,
    y: height * pdfExportAnchors.iban.y,
    size: pdfExportAnchors.iban.size,
    font,
  })
  drawWrappedText(
    page,
    record.internalInfo.note || ' ',
    width * pdfExportAnchors.notes.x,
    height * pdfExportAnchors.notes.y,
    width * pdfExportAnchors.notes.width,
    pdfExportAnchors.notes.lineHeight,
    pdfExportAnchors.notes.size,
  )

  record.objects.slice(0, 8).forEach((item, index) => {
    const y = height * pdfExportAnchors.objectRowStartY - index * pdfExportAnchors.objectRowHeight
    page.drawText(item.shortDesc || '-', {
      x: width * pdfExportAnchors.objectDescX,
      y,
      size: 10,
      font,
    })
    page.drawText(`${item.estimateLow || '-'} / ${item.estimateHigh || '-'}`, {
      x: width * pdfExportAnchors.objectEstimateX,
      y,
      size: 10,
      font,
    })
  })

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

      page.drawText(item.intNo || '-', { x: width * 0.1, y: height * 0.9, size: 12, font })
      page.drawText(item.shortDesc || '-', { x: width * 0.18, y: height * 0.9, size: 12, font })
      page.drawText(department, { x: width * 0.1, y: height * 0.85, size: 11, font })
      drawWrappedText(page, item.desc || item.remarks || ' ', width * 0.1, height * 0.8, width * 0.78, 14, 10)
      page.drawText(`${item.estimateLow || '-'} bis ${item.estimateHigh || '-'}`, {
        x: width * 0.1,
        y: height * 0.66,
        size: 11,
        font,
      })

      const chunk = item.photos.slice(pageIndex * 8, pageIndex * 8 + 8)
      for (const [photoIndex, photo] of chunk.entries()) {
        const column = photoIndex % 4
        const row = Math.floor(photoIndex / 4)
        const targetWidth = 105
        const targetHeight = 85
        const x = width * 0.1 + column * 115
        const y = height * 0.44 - row * 110
        const bytes = await dataUrlToBytes(photo.dataUrl)
        const image = photo.dataUrl.startsWith('data:image/png')
          ? await outputDoc.embedPng(bytes)
          : await outputDoc.embedJpg(bytes)
        page.drawImage(image, {
          x,
          y,
          width: targetWidth,
          height: targetHeight,
        })
        page.drawText(photo.name, { x, y: y - 12, size: 8, font })
      }
    }
  }

  const [summaryPage] = await outputDoc.copyPages(templateDoc, [0])
  outputDoc.addPage(summaryPage)
  const finalPage = outputDoc.getPages().at(-1)!
  const { width, height } = finalPage.getSize()
  finalPage.drawText(`${record.consignor.firstName} ${record.consignor.lastName}`.trim(), {
    x: width * 0.1,
    y: height * 0.9,
    size: 13,
    font,
  })
  finalPage.drawText(`${record.consignor.street} ${record.consignor.houseNo}`.trim(), {
    x: width * 0.1,
    y: height * 0.865,
    size: 11,
    font,
  })
  finalPage.drawText(`${record.consignor.zip} ${record.consignor.city}`.trim(), {
    x: width * 0.1,
    y: height * 0.835,
    size: 11,
    font,
  })
  finalPage.drawText(record.bank.iban, { x: width * 0.1, y: height * 0.76, size: 11, font })
  drawWrappedText(finalPage, record.costs.provenance || ' ', width * 0.1, height * 0.68, width * 0.75, 14, 10)

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
  const font = await pdf.embedFont(StandardFonts.Helvetica)

  pages.forEach((previewPage) => {
    const page = pdf.addPage([a4.width, a4.height])
    page.drawText(previewPage.title, { x: 40, y: 800, size: 18, font })
    page.drawText(previewPage.subtitle, { x: 40, y: 782, size: 10, font, color: rgb(0.4, 0.4, 0.45) })
    previewPage.fields.forEach((field) => {
      page.drawRectangle({
        x: a4.width * field.x,
        y: a4.height - a4.height * field.y - a4.height * field.h,
        width: a4.width * field.w,
        height: a4.height * field.h,
        borderColor: rgb(0.83, 0.83, 0.85),
        borderWidth: 0.6,
      })
      drawWrappedText(
        page,
        `${field.label}: ${field.value || '-'}`,
        a4.width * field.x + 8,
        a4.height - a4.height * field.y - 16,
        a4.width * field.w - 16,
        12,
        9,
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
