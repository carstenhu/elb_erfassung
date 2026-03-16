import { create } from 'zustand'
import {
  createEmptyCase,
  createInitialData,
  createNewObject,
  seedAuctions,
  seedClerks,
  seedDepartments,
  seedTitles,
} from './defaults'
import { loadSnapshot, saveSnapshot } from './db'
import type { AppData, Auction, CaseRecord, Clerk, DepartmentInterest, ObjectItem } from './types'

type AdminSection = 'clerks' | 'auctions' | 'departments' | 'required-fields'

type AppStore = {
  data: AppData
  isHydrated: boolean
  adminOpen: boolean
  activeAdminSection: AdminSection
  initialize: () => Promise<void>
  selectClerk: (clerkId: string | null) => void
  createCase: () => void
  setActiveCase: (caseId: string) => void
  updateField: (path: string, value: unknown) => void
  addObject: (seed?: Partial<ObjectItem>) => string | null
  removeObject: (objectId: string) => void
  replaceObjectPhotos: (objectId: string, photos: { id: string; name: string; dataUrl: string }[]) => void
  removePhoto: (objectId: string, photoId: string) => void
  upsertClerk: (clerk: Clerk) => void
  removeClerk: (clerkId: string) => void
  upsertAuction: (auction: Auction) => void
  removeAuction: (auctionId: string) => void
  upsertDepartment: (department: DepartmentInterest) => void
  removeDepartment: (departmentId: string) => void
  setRequiredFields: (keys: string[]) => void
  importCase: (record: CaseRecord) => void
  setAdminOpen: (open: boolean) => void
  setActiveAdminSection: (section: AdminSection) => void
}

const touchCase = (record: CaseRecord) => {
  record.updatedAt = new Date().toISOString()
  record.revision += 1
}

const setByPath = (target: Record<string, unknown>, path: string, value: unknown) => {
  const normalized = path.replace(/\[(\d+)\]/g, '.$1')
  const parts = normalized.split('.')
  let cursor: Record<string, unknown> | unknown[] = target
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index]
    if (Array.isArray(cursor)) {
      cursor = cursor[Number(key)] as Record<string, unknown>
      continue
    }
    cursor = cursor[key] as Record<string, unknown>
  }
  const lastKey = parts.at(-1)!
  if (Array.isArray(cursor)) {
    cursor[Number(lastKey)] = value
    return
  }
  cursor[lastKey] = value
}

const ensureCaseSelection = (data: AppData) => {
  if (!data.selectedClerkId) {
    data.activeCaseId = null
    return data
  }
  const clerkCases = data.cases.filter((record) => record.clerkId === data.selectedClerkId)
  if (clerkCases.length === 0) {
    const nextCounter = data.numberingByClerk[data.selectedClerkId] ?? 1
    const record = createEmptyCase(data.selectedClerkId, nextCounter)
    data.cases.unshift(record)
    data.numberingByClerk[data.selectedClerkId] = nextCounter + 1
    data.activeCaseId = record.id
    return data
  }
  if (!data.activeCaseId || !clerkCases.some((record) => record.id === data.activeCaseId)) {
    data.activeCaseId = clerkCases[0].id
  }
  return data
}

const ensureSeedMasterData = (data: AppData) => {
  const legacyClerkIds = new Set(['clerk-carsten', 'clerk-anna'])
  const legacyAuctionIds = new Set(['auction-1', 'auction-2'])
  const legacyDepartmentIds = new Set(['dep-art', 'dep-jew', 'dep-design'])

  data.masterData.clerks = data.masterData.clerks.filter((clerk) => !legacyClerkIds.has(clerk.id))
  data.masterData.auctions = data.masterData.auctions.filter(
    (auction) => !legacyAuctionIds.has(auction.id),
  )
  data.masterData.departments = data.masterData.departments.filter(
    (department) => !legacyDepartmentIds.has(department.id),
  )

  if (data.selectedClerkId && legacyClerkIds.has(data.selectedClerkId)) {
    data.selectedClerkId = null
  }

  const clerkKeys = new Set(
    data.masterData.clerks.map((clerk) => `${clerk.name}::${clerk.email}`.toLowerCase()),
  )
  seedClerks.forEach((clerk) => {
    const key = `${clerk.name}::${clerk.email}`.toLowerCase()
    if (!clerkKeys.has(key)) {
      data.masterData.clerks.push(clerk)
      clerkKeys.add(key)
    }
    data.numberingByClerk[clerk.id] = data.numberingByClerk[clerk.id] ?? 1
  })

  const auctionKeys = new Set(
    data.masterData.auctions.map(
      (auction) => `${auction.number}::${auction.month}::${auction.year}`.toLowerCase(),
    ),
  )
  seedAuctions.forEach((auction) => {
    const key = `${auction.number}::${auction.month}::${auction.year}`.toLowerCase()
    if (!auctionKeys.has(key)) {
      data.masterData.auctions.push(auction)
      auctionKeys.add(key)
    }
  })

  const departmentCodes = new Set(data.masterData.departments.map((department) => department.code))
  seedDepartments.forEach((department) => {
    if (!departmentCodes.has(department.code)) {
      data.masterData.departments.push(department)
      departmentCodes.add(department.code)
    }
  })

  data.masterData.titles = Array.from(new Set([...data.masterData.titles, ...seedTitles]))

  data.cases.forEach((record) => {
    if (typeof record.bank.diffBeneficiary !== 'boolean') {
      record.bank.diffBeneficiary = Boolean(record.bank.diffBeneficiary)
    }
  })

  return data
}

const persist = (data: AppData) => {
  void saveSnapshot(data)
}

const updateData = (data: AppData, recipe: (draft: AppData) => void) => {
  const draft = structuredClone(data)
  recipe(draft)
  ensureCaseSelection(draft)
  persist(draft)
  return draft
}

const getActiveCase = (data: AppData) => data.cases.find((record) => record.id === data.activeCaseId) ?? null

export const useAppStore = create<AppStore>((set) => ({
  data: createInitialData(),
  isHydrated: false,
  adminOpen: false,
  activeAdminSection: 'clerks',
  initialize: async () => {
    const snapshot = await loadSnapshot()
    const base = snapshot ?? createInitialData()
    ensureSeedMasterData(base)
    ensureCaseSelection(base)
    set({ data: base, isHydrated: true })
    persist(base)
  },
  selectClerk: (clerkId) => {
    set((state) => ({
      data: updateData(state.data, (draft) => {
        draft.selectedClerkId = clerkId
      }),
    }))
  },
  createCase: () => {
    set((state) => ({
      data: updateData(state.data, (draft) => {
        if (!draft.selectedClerkId) {
          return
        }
        const nextCounter = draft.numberingByClerk[draft.selectedClerkId] ?? 1
        const record = createEmptyCase(draft.selectedClerkId, nextCounter)
        draft.cases.unshift(record)
        draft.numberingByClerk[draft.selectedClerkId] = nextCounter + 1
        draft.activeCaseId = record.id
      }),
    }))
  },
  setActiveCase: (caseId) => {
    set((state) => ({
      data: updateData(state.data, (draft) => {
        draft.activeCaseId = caseId
      }),
    }))
  },
  updateField: (path, value) => {
    set((state) => ({
      data: updateData(state.data, (draft) => {
        const record = getActiveCase(draft)
        if (!record) {
          return
        }
        setByPath(record as unknown as Record<string, unknown>, path, value)
        touchCase(record)
      }),
    }))
  },
  addObject: (seed) => {
    let createdId: string | null = null
    set((state) => ({
      data: updateData(state.data, (draft) => {
        const record = getActiveCase(draft)
        if (!record) {
          return
        }
        const nextObject = createNewObject(seed)
        createdId = nextObject.id
        record.objects.push(nextObject)
        touchCase(record)
      }),
    }))
    return createdId
  },
  removeObject: (objectId) => {
    set((state) => ({
      data: updateData(state.data, (draft) => {
        const record = getActiveCase(draft)
        if (!record || record.objects.length === 1) {
          return
        }
        record.objects = record.objects.filter((item) => item.id !== objectId)
        touchCase(record)
      }),
    }))
  },
  replaceObjectPhotos: (objectId, photos) => {
    set((state) => ({
      data: updateData(state.data, (draft) => {
        const record = getActiveCase(draft)
        const target = record?.objects.find((item) => item.id === objectId)
        if (!target || !record) {
          return
        }
        target.photos = photos
        touchCase(record)
      }),
    }))
  },
  removePhoto: (objectId, photoId) => {
    set((state) => ({
      data: updateData(state.data, (draft) => {
        const record = getActiveCase(draft)
        const target = record?.objects.find((item) => item.id === objectId)
        if (!target || !record) {
          return
        }
        target.photos = target.photos.filter((photo) => photo.id !== photoId)
        touchCase(record)
      }),
    }))
  },
  upsertClerk: (clerk) => {
    set((state) => ({
      data: updateData(state.data, (draft) => {
        const index = draft.masterData.clerks.findIndex((item) => item.id === clerk.id)
        if (index >= 0) {
          draft.masterData.clerks[index] = clerk
          return
        }
        draft.masterData.clerks.push(clerk)
        draft.numberingByClerk[clerk.id] = draft.numberingByClerk[clerk.id] ?? 1
      }),
    }))
  },
  removeClerk: (clerkId) => {
    set((state) => ({
      data: updateData(state.data, (draft) => {
        draft.masterData.clerks = draft.masterData.clerks.filter((item) => item.id !== clerkId)
        if (draft.selectedClerkId === clerkId) {
          draft.selectedClerkId = draft.masterData.clerks[0]?.id ?? null
        }
      }),
    }))
  },
  upsertAuction: (auction) => {
    set((state) => ({
      data: updateData(state.data, (draft) => {
        const index = draft.masterData.auctions.findIndex((item) => item.id === auction.id)
        if (index >= 0) {
          draft.masterData.auctions[index] = auction
          return
        }
        draft.masterData.auctions.push(auction)
      }),
    }))
  },
  removeAuction: (auctionId) => {
    set((state) => ({
      data: updateData(state.data, (draft) => {
        draft.masterData.auctions = draft.masterData.auctions.filter((item) => item.id !== auctionId)
      }),
    }))
  },
  upsertDepartment: (department) => {
    set((state) => ({
      data: updateData(state.data, (draft) => {
        const index = draft.masterData.departments.findIndex((item) => item.id === department.id)
        if (index >= 0) {
          draft.masterData.departments[index] = department
          return
        }
        draft.masterData.departments.push(department)
      }),
    }))
  },
  removeDepartment: (departmentId) => {
    set((state) => ({
      data: updateData(state.data, (draft) => {
        draft.masterData.departments = draft.masterData.departments.filter((item) => item.id !== departmentId)
      }),
    }))
  },
  setRequiredFields: (keys) => {
    set((state) => ({
      data: updateData(state.data, (draft) => {
        draft.pdfRequiredFields = keys
      }),
    }))
  },
  importCase: (record) => {
    set((state) => ({
      data: updateData(state.data, (draft) => {
        const index = draft.cases.findIndex((entry) => entry.id === record.id)
        if (index >= 0) {
          draft.cases[index] = record
        } else {
          draft.cases.unshift(record)
        }
        draft.selectedClerkId = record.clerkId
        draft.activeCaseId = record.id
        draft.numberingByClerk[record.clerkId] = draft.numberingByClerk[record.clerkId] ?? 1
      }),
    }))
  },
  setAdminOpen: (open) => set({ adminOpen: open }),
  setActiveAdminSection: (section) => set({ activeAdminSection: section }),
}))
