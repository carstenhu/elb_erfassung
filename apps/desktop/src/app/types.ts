export type Clerk = {
  id: string
  name: string
  email: string
  phone: string
}

export type Auction = {
  id: string
  number: string
  month: string
  year: string
}

export type DepartmentInterest = {
  id: string
  code: string
  name: string
}

export type ObjectPhoto = {
  id: string
  name: string
  dataUrl: string
}

export type ObjectItem = {
  id: string
  intNo: string
  auctionId: string
  departmentId: string
  shortDesc: string
  desc: string
  estimateLow: string
  estimateHigh: string
  limit: string
  netLimit: boolean
  abbCost: string
  received: string
  remarks: string
  photos: ObjectPhoto[]
}

export type CaseMeta = {
  receiptNo: string
  date: string
}

export type Consignor = {
  captureCompanyAddress: boolean
  customerNo: string
  company: string
  title: string
  firstName: string
  lastName: string
  addressAddon1: string
  street: string
  houseNo: string
  zip: string
  city: string
  country: string
  email: string
  phone: string
  birthdate: string
  nationality: string
  passportNo: string
}

export type Owner = {
  sameAsConsignor: boolean
  firstName: string
  lastName: string
  street: string
  houseNo: string
  zip: string
  city: string
  country: string
}

export type BankDetails = {
  beneficiary: string
  iban: string
  bic: string
  diffBeneficiary: string
  diffBeneficiaryName: string
  diffReason: string
}

export type GlobalCosts = {
  kommission: string
  versicherung: string
  transport: string
  abbKosten: string
  kostenExpertisen: string
  internet: string
  onlyIfSuccess: boolean
  provenance: string
}

export type InternalInfo = {
  interestIds: string[]
  note: string
}

export type SignatureData = {
  consignorPng: string
}

export type CaseRecord = {
  id: string
  clerkId: string
  createdAt: string
  updatedAt: string
  revision: number
  meta: CaseMeta
  consignor: Consignor
  owner: Owner
  bank: BankDetails
  costs: GlobalCosts
  internalInfo: InternalInfo
  objects: ObjectItem[]
  signatures: SignatureData
}

export type MasterData = {
  clerks: Clerk[]
  auctions: Auction[]
  departments: DepartmentInterest[]
  titles: string[]
}

export type AppData = {
  masterData: MasterData
  pdfRequiredFields: string[]
  numberingByClerk: Record<string, number>
  cases: CaseRecord[]
  selectedClerkId: string | null
  activeCaseId: string | null
}

export type PreviewField = {
  id: string
  label: string
  value: string
  path?: string
  editKey?: string
  x: number
  y: number
  w: number
  h: number
}

export type PreviewPage = {
  id: string
  title: string
  subtitle: string
  kind: 'pdf' | 'word'
  fields: PreviewField[]
}
