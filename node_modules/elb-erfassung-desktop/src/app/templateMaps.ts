import type { CaseRecord, MasterData, PreviewPage } from './types'

const getDepartmentLabel = (masterData: MasterData, departmentId: string) =>
  masterData.departments.find((entry) => entry.id === departmentId)?.name ?? ''

const rect = (x: number, y: number, w: number, h: number) => ({ x, y, w, h })

export const pdfExportAnchors = {
  receiptNo: { x: 0.71, y: 0.92, size: 12 },
  date: { x: 0.71, y: 0.89, size: 11 },
  clerk: { x: 0.11, y: 0.89, size: 11 },
  consignorName: { x: 0.11, y: 0.81, size: 12 },
  consignorCompany: { x: 0.11, y: 0.792, size: 11 },
  consignorStreet: { x: 0.11, y: 0.775, size: 11 },
  consignorCity: { x: 0.11, y: 0.745, size: 11 },
  iban: { x: 0.11, y: 0.39, size: 10 },
  bic: { x: 0.11, y: 0.365, size: 10 },
  beneficiary: { x: 0.11, y: 0.34, size: 10 },
  kommission: { x: 0.68, y: 0.39, size: 10 },
  versicherung: { x: 0.68, y: 0.365, size: 10 },
  transport: { x: 0.68, y: 0.34, size: 10 },
  notes: { x: 0.11, y: 0.27, width: 0.75, lineHeight: 13, size: 10 },
  objectRowStartY: 0.63,
  objectRowHeight: 22,
  objectDescX: 0.11,
  objectEstimateX: 0.66,
  signature: { x: 0.58, y: 0.11, width: 140, height: 55 },
} as const

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

export const buildPdfPreviewPages = (
  record: CaseRecord,
  masterData: MasterData,
): PreviewPage[] => [
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
        ...pdfFieldRects.receiptNo,
      },
      {
        id: 'clerk',
        label: 'Sachbearbeiter',
        value: masterData.clerks.find((entry) => entry.id === record.clerkId)?.name ?? '',
        editKey: 'consignor',
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
        value: [
          `${record.owner.firstName} ${record.owner.lastName}`.trim(),
          `${record.owner.street} ${record.owner.houseNo}`.trim(),
          `${record.owner.zip} ${record.owner.city}`.trim(),
          record.owner.country,
        ]
          .filter(Boolean)
          .join('\n'),
        editKey: 'owner',
        ...pdfFieldRects.ownerAddress,
      },
      {
        id: 'iban',
        label: 'IBAN',
        value: record.bank.iban,
        path: 'bank.iban',
        editKey: 'bank',
        ...pdfFieldRects.iban,
      },
      {
        id: 'bic',
        label: 'BIC',
        value: record.bank.bic,
        path: 'bank.bic',
        editKey: 'bank',
        ...pdfFieldRects.bic,
      },
      {
        id: 'beneficiary',
        label: 'Beguenstigter',
        value: record.bank.beneficiary,
        path: 'bank.beneficiary',
        editKey: 'bank',
        ...pdfFieldRects.beneficiary,
      },
      {
        id: 'birthdate',
        label: 'Geburtsdatum',
        value: record.consignor.birthdate,
        path: 'consignor.birthdate',
        editKey: 'consignor',
        ...pdfFieldRects.birthdate,
      },
      {
        id: 'nationality',
        label: 'Nationalitaet',
        value: record.consignor.nationality,
        path: 'consignor.nationality',
        editKey: 'consignor',
        ...pdfFieldRects.nationality,
      },
      {
        id: 'passport',
        label: 'ID / Pass',
        value: record.consignor.passportNo,
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
        id: 'internet',
        label: 'Internet',
        value: record.costs.internet,
        path: 'costs.internet',
        editKey: 'costs',
        ...pdfFieldRects.internet,
      },
      {
        id: 'notes',
        label: 'Interne Notizen',
        value: record.internalInfo.note,
        path: 'internalInfo.note',
        editKey: 'internal',
        ...pdfFieldRects.notes,
      },
      ...(record.objects[0]
        ? [
            {
              id: `obj-int-${record.objects[0].id}`,
              label: 'Int.-Nr. 1',
              value: record.objects[0].intNo,
              editKey: `object:${record.objects[0].id}`,
              ...pdfFieldRects.objectIntNo,
            },
            {
              id: `obj-rec-${record.objects[0].id}`,
              label: 'Erhalten 1',
              value: record.objects[0].received,
              editKey: `object:${record.objects[0].id}`,
              ...pdfFieldRects.objectReceived,
            },
            {
              id: `obj-dep-${record.objects[0].id}`,
              label: 'Kapitel 1',
              value: getDepartmentLabel(masterData, record.objects[0].departmentId),
              editKey: `object:${record.objects[0].id}`,
              ...pdfFieldRects.objectDepartment,
            },
            {
              id: `obj-desc-${record.objects[0].id}`,
              label: 'Kurzbeschreibung 1',
              value: record.objects[0].shortDesc,
              editKey: `object:${record.objects[0].id}`,
              ...pdfFieldRects.objectShortDesc,
            },
            {
              id: `obj-est-${record.objects[0].id}`,
              label: 'Schaetzung 1',
              value: `${record.objects[0].estimateLow || '-'} / ${record.objects[0].estimateHigh || '-'}`,
              editKey: `object:${record.objects[0].id}`,
              ...pdfFieldRects.objectEstimate,
            },
          ]
        : []),
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
