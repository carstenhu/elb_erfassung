import type { CaseRecord, MasterData, PreviewPage } from './types'
import { getEffectiveBeneficiary } from './format'

const PDF_OBJECT_MAX_UNITS_PER_PAGE = 28
const PDF_OBJECT_GAP_UNITS = 2

const normalizeVisibleContent = (value: string) =>
  value
    .replaceAll('Erhalten fÃ¼r', 'Erhalten für')
    .replaceAll('Beguenstigter', 'Begünstigter')
    .replaceAll('Nationalitaet', 'Nationalität')

const getDepartmentLabel = (masterData: MasterData, departmentId: string) =>
  masterData.departments.find((entry) => entry.id === departmentId)?.name ?? ''

const getDepartmentCode = (masterData: MasterData, departmentId: string) =>
  masterData.departments.find((entry) => entry.id === departmentId)?.code ?? ''

const isIbidObject = (masterData: MasterData, auctionId: string) =>
  (masterData.auctions.find((entry) => entry.id === auctionId)?.number ?? '').toLowerCase().startsWith('ibid')

const buildPdfObjectPreviewEntries = (record: CaseRecord, masterData: MasterData) =>
  record.objects.map((item, index) => {
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
    const previewLines = [
      `Int.-Nr.: ${item.intNo || '-'}`,
      `Erhalten für: ${getAuctionWithDate(masterData, item.auctionId) || '-'}`,
      `Abteilung: ${getDepartmentCode(masterData, item.departmentId) || '-'}`,
      ...detailLines,
      ...estimateLines,
    ]

    return {
      id: `object-row-${item.id}`,
      label: `Objekt ${index + 1}`,
      value: normalizeVisibleContent(previewLines.join('\n')),
      editKey: `object:${item.id}`,
      lineUnits: detailLines.length + estimateLines.length + PDF_OBJECT_GAP_UNITS,
    }
  })

const paginatePdfObjectPreviewEntries = (entries: ReturnType<typeof buildPdfObjectPreviewEntries>, maxUnitsPerPage: number) => {
  const pages: typeof entries[] = []
  let current: typeof entries = []
  let used = 0

  entries.forEach((entry) => {
    if (current.length && used + entry.lineUnits > maxUnitsPerPage) {
      pages.push(current)
      current = []
      used = 0
    }
    current.push(entry)
    used += entry.lineUnits
  })

  if (current.length) {
    pages.push(current)
  }

  return pages
}

const getAuctionWithDate = (masterData: MasterData, auctionId: string) => {
  const auction = masterData.auctions.find((entry) => entry.id === auctionId)
  if (!auction) {
    return ''
  }
  const month = auction.month ? auction.month.padStart(2, '0') : '--'
  const year = auction.year ? auction.year.slice(-2) : '--'
  return `${auction.number}\n${month}/${year}`
}

const rect = (x: number, y: number, w: number, h: number) => ({ x, y, w, h })

const pdfFieldRects = {
  clerk: rect(0.2647, 0.1071, 0.6633, 0.0137),
  receiptNo: rect(0.34, 0.0868, 0.5886, 0.0141),
  date: rect(0.1004, 0.9505, 0.2519, 0.0173),
  consignorAddress: rect(0.0993, 0.1482, 0.4049, 0.1016),
  ownerAddress: rect(0.5244, 0.1477, 0.4049, 0.1016),
  beneficiary: rect(0.0997, 0.2717, 0.2682, 0.011),
  bic: rect(0.3807, 0.2717, 0.2682, 0.011),
  iban: rect(0.6617, 0.2717, 0.2682, 0.011),
  birthdate: rect(0.0997, 0.2582, 0.2682, 0.011),
  nationality: rect(0.3807, 0.2582, 0.2682, 0.011),
  passportNo: rect(0.6617, 0.2582, 0.2682, 0.011),
  kommission: rect(0.1052, 0.6513, 0.0738, 0.0135),
  versicherung: rect(0.1943, 0.6513, 0.0681, 0.0135),
  transport: rect(0.2903, 0.6521, 0.0868, 0.0135),
  abbKosten: rect(0.3889, 0.6521, 0.0967, 0.0135),
  kosten: rect(0.5064, 0.6513, 0.1088, 0.0135),
  internet: rect(0.6323, 0.651, 0.0687, 0.0139),
  objectEstimate: rect(0.7252, 0.3151, 0.1938, 0.3107),
  objectShortDesc: rect(0.2874, 0.3151, 0.4302, 0.3107),
  objectIntNo: rect(0.1038, 0.3151, 0.0398, 0.3107),
  objectReceived: rect(0.1537, 0.3151, 0.0683, 0.3107),
  objectDepartment: rect(0.2298, 0.3151, 0.0474, 0.3107),
  notes: rect(0.1071, 0.6946, 0.8077, 0.0803),
} as const

const pdfOverflowFieldRects = {
  objectEstimate: rect(0.7252, 0.1853, 0.1938, 0.4428),
  objectShortDesc: rect(0.2868, 0.1853, 0.4302, 0.4428),
  objectIntNo: rect(0.1038, 0.1853, 0.0398, 0.4428),
  objectReceived: rect(0.1565, 0.1853, 0.0672, 0.4428),
  objectDepartment: rect(0.2326, 0.1853, 0.0474, 0.4428),
} as const

export const buildPdfPreviewPages = (
  record: CaseRecord,
  masterData: MasterData,
): PreviewPage[] => {
  const clerk = masterData.clerks.find((entry) => entry.id === record.clerkId)
  const clerkLabel = [clerk?.name ?? '', clerk?.phone ?? '', clerk?.email ?? ''].filter(Boolean).join(' | ')
  const ownerAddress = record.owner.sameAsConsignor
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
      ]

  const objectFields = (() => {
    const objectEntries = paginatePdfObjectPreviewEntries(buildPdfObjectPreviewEntries(record, masterData), PDF_OBJECT_MAX_UNITS_PER_PAGE)[0] ?? []
    if (!objectEntries.length) {
      return []
    }
    const top = pdfFieldRects.objectIntNo.y
    const totalHeight = pdfFieldRects.objectIntNo.h
    const unitHeight = totalHeight / PDF_OBJECT_MAX_UNITS_PER_PAGE
    let currentY = top

    return objectEntries.map((entry) => {
      const height = entry.lineUnits * unitHeight
      const field = {
        id: entry.id,
        label: entry.label,
        value: entry.value,
        editKey: entry.editKey,
        x: pdfFieldRects.objectIntNo.x,
        y: currentY,
        w: pdfFieldRects.objectEstimate.x + pdfFieldRects.objectEstimate.w - pdfFieldRects.objectIntNo.x,
        h: Math.max(height - unitHeight * 0.1, unitHeight),
      }
      currentY += height
      return field
    })
  })()

  return [{
    id: 'pdf-1',
    title: 'ELB-PDF Seite 1',
    subtitle: 'Vorschau mit Einlieferer- und Objektangaben',
    kind: 'pdf',
    fields: [
      {
        id: 'receipt',
        label: 'ELB-Nummer',
        value: record.meta.receiptNo,
        path: 'meta.receiptNo',
        editKey: 'consignor',
        ...pdfFieldRects.receiptNo,
      },
      {
        id: 'clerk',
        label: 'Sachbearbeiter',
        value: clerkLabel,
        editKey: 'clerk',
        ...pdfFieldRects.clerk,
      },
      {
        id: 'date',
        label: 'Datum',
        value: record.meta.date,
        path: 'meta.date',
        editKey: 'consignor',
        ...pdfFieldRects.date,
      },
      {
        id: 'consignor-address',
        label: 'Briefadresse EL',
        value: [
          record.consignor.company,
          `${record.consignor.title} ${record.consignor.firstName} ${record.consignor.lastName}`.trim(),
          record.consignor.addressAddon1,
          `${record.consignor.street} ${record.consignor.houseNo}`.trim(),
          `${record.consignor.zip} ${record.consignor.city}`.trim(),
          record.consignor.country,
        ]
          .filter(Boolean)
          .join('\n'),
        editKey: 'consignor',
        ...pdfFieldRects.consignorAddress,
      },
      {
        id: 'owner-address',
        label: 'Briefadresse EG',
        value: ownerAddress
          .filter(Boolean)
          .join('\n'),
        editKey: 'owner',
        ...pdfFieldRects.ownerAddress,
      },
      {
        id: 'iban',
        label: 'IBAN',
        value: `IBAN/Kontonr: ${record.bank.iban || '-'}`,
        path: 'bank.iban',
        editKey: 'bank',
        ...pdfFieldRects.iban,
      },
      {
        id: 'bic',
        label: 'BIC',
        value: `BIC/SWIFT: ${record.bank.bic || '-'}`,
        path: 'bank.bic',
        editKey: 'bank',
        ...pdfFieldRects.bic,
      },
      {
        id: 'beneficiary',
        label: 'Begünstigter',
        value: `Begünstigter: ${getEffectiveBeneficiary(record) || '-'}`,
        editKey: 'bank',
        ...pdfFieldRects.beneficiary,
      },
      {
        id: 'birthdate',
        label: 'Geburtsdatum',
        value: `Geburtsdatum: ${record.consignor.birthdate || '-'}`,
        path: 'consignor.birthdate',
        editKey: 'consignor',
        ...pdfFieldRects.birthdate,
      },
      {
        id: 'nationality',
        label: 'Nationalität',
        value: `Nationalität: ${record.consignor.nationality || '-'}`,
        path: 'consignor.nationality',
        editKey: 'consignor',
        ...pdfFieldRects.nationality,
      },
      {
        id: 'passport',
        label: 'ID / Pass',
        value: `ID/Passnummer: ${record.consignor.passportNo || '-'}`,
        path: 'consignor.passportNo',
        editKey: 'consignor',
        ...pdfFieldRects.passportNo,
      },
      {
        id: 'kommission',
        label: 'Kommission',
        value: record.costs.kommission,
        path: 'costs.kommission',
        editKey: 'costs',
        ...pdfFieldRects.kommission,
      },
      {
        id: 'versicherung',
        label: 'Versicherung',
        value: record.costs.versicherung,
        path: 'costs.versicherung',
        editKey: 'costs',
        ...pdfFieldRects.versicherung,
      },
      {
        id: 'transport',
        label: 'Transport',
        value: record.costs.transport,
        path: 'costs.transport',
        editKey: 'costs',
        ...pdfFieldRects.transport,
      },
      {
        id: 'abb-kosten',
        label: 'Abb.-Kosten',
        value: record.costs.abbKosten,
        path: 'costs.abbKosten',
        editKey: 'costs',
        ...pdfFieldRects.abbKosten,
      },
      {
        id: 'kosten',
        label: 'Kosten',
        value: record.costs.kostenExpertisen,
        path: 'costs.kostenExpertisen',
        editKey: 'costs',
        ...pdfFieldRects.kosten,
      },
      {
        id: 'provenienz',
        label: 'Provenienz / Diverses',
        value: record.costs.provenance,
        path: 'costs.provenance',
        editKey: 'costs',
        ...pdfFieldRects.notes,
      },
      {
        id: 'internet',
        label: 'Internet',
        value: record.costs.internet,
        path: 'costs.internet',
        editKey: 'costs',
        ...pdfFieldRects.internet,
      },
      ...objectFields,
    ],
  },
  ...paginatePdfObjectPreviewEntries(buildPdfObjectPreviewEntries(record, masterData), PDF_OBJECT_MAX_UNITS_PER_PAGE)
    .slice(1)
    .map((entries, pageIndex) => {
      const top = pdfOverflowFieldRects.objectIntNo.y
      const totalHeight = pdfOverflowFieldRects.objectIntNo.h
      const unitHeight = totalHeight / PDF_OBJECT_MAX_UNITS_PER_PAGE
      let currentY = top

      return {
        id: `pdf-overflow-${pageIndex + 2}`,
        title: `ELB-PDF Seite ${pageIndex + 2}`,
        subtitle: 'Zusatzseite Objekte',
        kind: 'pdf' as const,
        fields: entries.map((entry) => {
          const height = entry.lineUnits * unitHeight
          const field = {
            id: entry.id,
            label: entry.label,
            value: entry.value,
            editKey: entry.editKey,
            x: pdfOverflowFieldRects.objectIntNo.x,
            y: currentY,
            w: pdfOverflowFieldRects.objectEstimate.x + pdfOverflowFieldRects.objectEstimate.w - pdfOverflowFieldRects.objectIntNo.x,
            h: Math.max(height - unitHeight * 0.1, unitHeight),
          }
          currentY += height
          return field
        }),
      }
    }),
]}

export const buildWordPreviewPages = (
  record: CaseRecord,
  masterData: MasterData,
): PreviewPage[] => {
  const pages: PreviewPage[] = []
  const chunkSize = 8
  const objectChunks = Array.from({
    length: Math.max(1, Math.ceil(record.objects.length / chunkSize)),
  }).map((_, chunkIndex) =>
    record.objects.slice(chunkIndex * chunkSize, chunkIndex * chunkSize + chunkSize),
  )

  objectChunks.forEach((chunk, chunkIndex) => {
    pages.push({
      id: `word-${chunkIndex + 1}`,
      title: `Word Vorschau Seite ${chunkIndex + 1}`,
      subtitle:
        chunkIndex === 0
          ? 'Schaetzliste mit Stammdaten und Objektuebersicht'
          : 'Fortsetzung Objektuebersicht',
      kind: 'word',
      fields: [
        {
          id: `receipt-${chunkIndex}`,
          label: 'ELB-Nummer',
          value: record.meta.receiptNo,
          path: 'meta.receiptNo',
          editKey: 'consignor',
          x: 0.09,
          y: 0.11,
          w: 0.32,
          h: 0.05,
        },
        {
          id: `consignor-${chunkIndex}`,
          label: 'Einlieferer',
          value: `${record.consignor.firstName} ${record.consignor.lastName}`.trim(),
          editKey: 'consignor',
          x: 0.44,
          y: 0.11,
          w: 0.42,
          h: 0.05,
        },
        ...(chunkIndex === 0
          ? [
              {
                id: 'interests',
                label: 'Interessengebiete',
                value: record.internalInfo.interestIds
                  .map((id) => masterData.departments.find((entry) => entry.id === id)?.name ?? id)
                  .join(', '),
                editKey: 'internal',
                x: 0.09,
                y: 0.18,
                w: 0.77,
                h: 0.06,
              },
            ]
          : []),
        ...chunk.map((item, index) => ({
          id: `word-object-${item.id}`,
          label: `${index + 1 + chunkIndex * chunkSize}. ${getDepartmentLabel(
            masterData,
            item.departmentId,
          ) || 'Abteilung'}`,
          value: `${item.shortDesc || '-'} | ${item.estimateLow || '-'} / ${item.estimateHigh || '-'}`,
          editKey: `object:${item.id}`,
          x: 0.09,
          y: 0.28 + index * 0.075,
          w: 0.77,
          h: 0.06,
        })),
        ...(chunkIndex === objectChunks.length - 1
          ? [
              {
                id: 'note',
                label: 'Interne Notiz',
                value: record.internalInfo.note,
                path: 'internalInfo.note',
                editKey: 'internal',
                x: 0.09,
                y: 0.83,
                w: 0.77,
                h: 0.09,
              },
            ]
          : []),
      ],
    })
  })

  return pages
}
