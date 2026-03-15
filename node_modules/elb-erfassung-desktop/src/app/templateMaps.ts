import type { CaseRecord, MasterData, PreviewPage } from './types'

const getDepartmentLabel = (masterData: MasterData, departmentId: string) =>
  masterData.departments.find((entry) => entry.id === departmentId)?.name ?? ''

export const pdfExportAnchors = {
  receiptNo: { x: 0.71, y: 0.92, size: 12 },
  date: { x: 0.71, y: 0.89, size: 11 },
  clerk: { x: 0.11, y: 0.89, size: 11 },
  consignorName: { x: 0.11, y: 0.81, size: 12 },
  consignorStreet: { x: 0.11, y: 0.775, size: 11 },
  consignorCity: { x: 0.11, y: 0.745, size: 11 },
  iban: { x: 0.11, y: 0.39, size: 10 },
  notes: { x: 0.11, y: 0.27, width: 0.75, lineHeight: 13, size: 10 },
  objectRowStartY: 0.63,
  objectRowHeight: 22,
  objectDescX: 0.11,
  objectEstimateX: 0.66,
  signature: { x: 0.58, y: 0.11, width: 140, height: 55 },
} as const

export const buildPdfPreviewPages = (record: CaseRecord): PreviewPage[] => [
  {
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
        x: 0.71,
        y: 0.08,
        w: 0.2,
        h: 0.04,
      },
      {
        id: 'date',
        label: 'Datum',
        value: record.meta.date,
        path: 'meta.date',
        editKey: 'consignor',
        x: 0.71,
        y: 0.12,
        w: 0.2,
        h: 0.04,
      },
      {
        id: 'consignor',
        label: 'Einlieferer',
        value: `${record.consignor.title} ${record.consignor.firstName} ${record.consignor.lastName}`.trim(),
        editKey: 'consignor',
        x: 0.11,
        y: 0.18,
        w: 0.5,
        h: 0.05,
      },
      {
        id: 'address',
        label: 'Adresse',
        value: `${record.consignor.street} ${record.consignor.houseNo}, ${record.consignor.zip} ${record.consignor.city}`.trim(),
        editKey: 'consignor',
        x: 0.11,
        y: 0.24,
        w: 0.5,
        h: 0.06,
      },
      {
        id: 'iban',
        label: 'IBAN',
        value: record.bank.iban,
        path: 'bank.iban',
        editKey: 'bank',
        x: 0.11,
        y: 0.55,
        w: 0.55,
        h: 0.05,
      },
      {
        id: 'notes',
        label: 'Interne Notizen',
        value: record.internalInfo.note,
        path: 'internalInfo.note',
        editKey: 'internal',
        x: 0.11,
        y: 0.66,
        w: 0.76,
        h: 0.14,
      },
      ...record.objects.slice(0, 8).map((item, index) => ({
        id: `obj-${item.id}`,
        label: `Objekt ${index + 1}`,
        value: `${item.shortDesc || '-'} | ${item.estimateLow || '-'} / ${item.estimateHigh || '-'}`,
        editKey: `object:${item.id}`,
        x: 0.11,
        y: 0.34 + index * 0.036,
        w: 0.76,
        h: 0.03,
      })),
    ],
  },
]

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
