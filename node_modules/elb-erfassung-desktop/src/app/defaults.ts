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
    id: 'clerk-carsten-huebler',
    name: 'Carsten H\u00fcbler',
    email: 'huebler@kollerauktionen.ch',
    phone: '+41 44 445 63 77',
    signaturePng: '',
  },
  {
    id: 'clerk-cyril-koller',
    name: 'Cyril Koller',
    email: 'Koller@kollerauktionen.ch',
    phone: '+41 44 445 63 30',
    signaturePng: '',
  },
  {
    id: 'clerk-flavio-de-corso',
    name: 'Flavio De Corso',
    email: 'decorso@kollerauktionen.ch',
    phone: '',
    signaturePng: '',
  },
  {
    id: 'clerk-sandro-wehrle',
    name: 'Sandro Wehrle',
    email: 'wehrle@kollerauktionen.ch',
    phone: '+41 44 445 63 14',
    signaturePng: '',
  },
]

export const seedAuctions: Auction[] = [
  { id: 'auction-nfu', number: 'NFU', month: '', year: '' },
  { id: 'auction-unklar', number: 'Unklar', month: '', year: '' },
  { id: 'auction-a216', number: 'A216', month: '03', year: '2026' },
  { id: 'auction-ibid157', number: 'ibid157', month: '03', year: '2026' },
  { id: 'auction-a217', number: 'A217', month: '06', year: '2026' },
  { id: 'auction-ibid158', number: 'ibid158', month: '06', year: '2026' },
  { id: 'auction-ibid159', number: 'ibid159', month: '07', year: '2026' },
  { id: 'auction-a218', number: 'A218', month: '09', year: '2026' },
  { id: 'auction-ibid160', number: 'ibid160', month: '09', year: '2026' },
  { id: 'auction-a219', number: 'A219', month: '12', year: '2026' },
  { id: 'auction-ibid162', number: 'ibid162', month: '12', year: '2026' },
  { id: 'auction-a220', number: 'A220', month: '03', year: '2027' },
]

export const seedDepartments: DepartmentInterest[] = [
  { id: 'dep-agra', code: 'AGRA', name: 'Alte Grafik' },
  { id: 'dep-anku', code: 'ANKU', name: 'Angewandte Kunst' },
  { id: 'dep-asia', code: 'ASIA', name: 'Asiatica' },
  { id: 'dep-auhr', code: 'AUHR', name: 'Armbanduhren' },
  { id: 'dep-auto', code: 'AUTO', name: 'Autographen' },
  { id: 'dep-bi19', code: 'BI19', name: 'Gem\u00e4lde des 19. Jahrhunderts' },
  { id: 'dep-biam', code: 'BIAM', name: 'Gem\u00e4lde Alter Meister' },
  { id: 'dep-bimo', code: 'BIMO', name: 'Moderne Kunst' },
  { id: 'dep-desi', code: 'DESI', name: 'Design' },
  { id: 'dep-bisw', code: 'BISW', name: 'Schweizer Kunst' },
  { id: 'dep-bizg', code: 'BIZG', name: 'Zeitgen\u00f6ssische Kunst' },
  { id: 'dep-buca', code: 'BUCA', name: 'B\u00fccher Aufgeld' },
  { id: 'dep-buma', code: 'BUMA', name: 'Buchmalerei' },
  { id: 'dep-dose', code: 'DOSE', name: 'Dosen' },
  { id: 'dep-guhr', code: 'GUHR', name: 'Grossuhren' },
  { id: 'dep-mgra', code: 'MGRA', name: 'Moderne Grafik' },
  { id: 'dep-mini', code: 'MINI', name: 'Miniaturen' },
  { id: 'dep-moeb', code: 'MOEB', name: 'M\u00f6bel' },
  { id: 'dep-vint', code: 'VINT', name: 'Handbags & Accessories' },
  { id: 'dep-phot', code: 'PHOT', name: 'Photographien' },
  { id: 'dep-porz', code: 'PORZ', name: 'Porzellan & Keramik' },
  { id: 'dep-schm', code: 'SCHM', name: 'Schmuck' },
  { id: 'dep-silb', code: 'SILB', name: 'Silber' },
  { id: 'dep-tafa', code: 'TAFA', name: 'Tafelsilber' },
  { id: 'dep-waff', code: 'WAFF', name: 'Waffen & Militaria' },
]

export const seedTitles = ['Dr.', 'Firma', 'Frau', 'Herr', 'Keine Anrede', 'Prof.']

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
  { key: 'objects[].estimateLow', label: 'Objekt Sch\u00e4tzung von' },
  { key: 'objects[].estimateHigh', label: 'Objekt Sch\u00e4tzung bis' },
  { key: 'objects[].departmentId', label: 'Objekt Abteilung' },
]

const emptyObject = (seed: Partial<ObjectItem> = {}): ObjectItem => ({
  id: seed.id ?? crypto.randomUUID(),
  intNo: seed.intNo ?? '',
  auctionId: seed.auctionId ?? '',
  departmentId: seed.departmentId ?? '',
  shortDesc: seed.shortDesc ?? '',
  desc: seed.desc ?? '',
  estimateLow: seed.estimateLow ?? '',
  estimateHigh: seed.estimateHigh ?? '',
  limit: seed.limit ?? '',
  netLimit: seed.netLimit ?? false,
  abbCost: seed.abbCost ?? '',
  received: seed.received ?? '',
  remarks: seed.remarks ?? '',
  photos: seed.photos ?? [],
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
    passportPhoto: '',
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
    diffBeneficiary: false,
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
    titles: seedTitles,
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

export const createNewObject = (seed?: Partial<ObjectItem>) => emptyObject(seed)
