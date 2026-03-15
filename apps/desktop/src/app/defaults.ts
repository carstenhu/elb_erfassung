import type {
  AppData,
  Auction,
  CaseRecord,
  Clerk,
  DepartmentInterest,
  ObjectItem,
} from './types'

const today = () => new Date().toISOString().slice(0, 10)

export const seedClerks: Clerk[] = [
  {
    id: 'clerk-carsten',
    name: 'Carsten Muster',
    email: 'carsten@example.com',
    phone: '+41 44 555 00 11',
  },
  {
    id: 'clerk-anna',
    name: 'Anna Beispiel',
    email: 'anna@example.com',
    phone: '+41 44 555 00 12',
  },
]

export const seedAuctions: Auction[] = [
  { id: 'auction-1', number: '321', month: 'Mai', year: '2026' },
  { id: 'auction-2', number: '322', month: 'Juni', year: '2026' },
]

export const seedDepartments: DepartmentInterest[] = [
  { id: 'dep-art', code: 'ART', name: 'Kunst' },
  { id: 'dep-jew', code: 'JEW', name: 'Schmuck' },
  { id: 'dep-design', code: 'DES', name: 'Design' },
]

export const availableRequiredFields = [
  { key: 'meta.receiptNo', label: 'ELB-Nummer' },
  { key: 'meta.date', label: 'Erfassungsdatum' },
  { key: 'consignor.lastName', label: 'Einlieferer Nachname' },
  { key: 'consignor.firstName', label: 'Einlieferer Vorname' },
  { key: 'consignor.street', label: 'Einlieferer Strasse' },
  { key: 'consignor.zip', label: 'Einlieferer PLZ' },
  { key: 'consignor.city', label: 'Einlieferer Stadt' },
  { key: 'bank.iban', label: 'IBAN' },
  { key: 'objects[].shortDesc', label: 'Objekt Kurzbeschreibung' },
  { key: 'objects[].estimateLow', label: 'Objekt Schätzung von' },
  { key: 'objects[].estimateHigh', label: 'Objekt Schätzung bis' },
  { key: 'objects[].departmentId', label: 'Objekt Abteilung' },
]

const emptyObject = (): ObjectItem => ({
  id: crypto.randomUUID(),
  intNo: '',
  auctionId: '',
  departmentId: '',
  shortDesc: '',
  desc: '',
  estimateLow: '',
  estimateHigh: '',
  limit: '',
  netLimit: false,
  abbCost: '',
  received: '',
  remarks: '',
  photos: [],
})

const nextReceiptNumber = (clerkId: string, nextCounter: number) => {
  const short = clerkId.replace('clerk-', '').toUpperCase().slice(0, 4)
  return `${short}-${String(nextCounter).padStart(4, '0')}`
}

export const createEmptyCase = (clerkId: string, counter: number): CaseRecord => ({
  id: crypto.randomUUID(),
  clerkId,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  revision: 1,
  meta: {
    receiptNo: nextReceiptNumber(clerkId, counter),
    date: today(),
  },
  consignor: {
    captureCompanyAddress: false,
    customerNo: '',
    company: '',
    title: 'Herr',
    firstName: '',
    lastName: '',
    addressAddon1: '',
    street: '',
    houseNo: '',
    zip: '',
    city: '',
    country: 'Schweiz',
    email: '',
    phone: '',
    birthdate: '',
    nationality: '',
    passportNo: '',
  },
  owner: {
    sameAsConsignor: true,
    firstName: '',
    lastName: '',
    street: '',
    houseNo: '',
    zip: '',
    city: '',
    country: 'Schweiz',
  },
  bank: {
    beneficiary: '',
    iban: '',
    bic: '',
    diffBeneficiary: '',
    diffBeneficiaryName: '',
    diffReason: '',
  },
  costs: {
    kommission: '',
    versicherung: '',
    transport: '',
    abbKosten: '',
    kostenExpertisen: '',
    internet: '',
    onlyIfSuccess: false,
    provenance: '',
  },
  internalInfo: {
    interestIds: [],
    note: '',
  },
  objects: [emptyObject()],
  signatures: {
    consignorPng: '',
  },
})

export const createInitialData = (): AppData => ({
  masterData: {
    clerks: seedClerks,
    auctions: seedAuctions,
    departments: seedDepartments,
    titles: ['Herr', 'Frau', 'Dr.', 'Firma'],
  },
  pdfRequiredFields: [
    'meta.receiptNo',
    'meta.date',
    'consignor.firstName',
    'consignor.lastName',
    'consignor.street',
    'consignor.zip',
    'consignor.city',
  ],
  numberingByClerk: Object.fromEntries(seedClerks.map((clerk) => [clerk.id, 1])),
  cases: [],
  selectedClerkId: null,
  activeCaseId: null,
})

export const createNewObject = emptyObject
