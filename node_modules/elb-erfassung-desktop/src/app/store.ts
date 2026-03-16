import { create } from 'zustand'
import {
  createEmptyCase,
  createInitialData,
  createNewObject,
  seedDepartments,
} from './defaults'
import { loadSnapshot, saveSnapshot } from './db'
import type { AppData, Auction, CaseRecord, Clerk, DepartmentInterest } from './types'

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
  addObject: () => void
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
  const existingDepartmentCodes = new Set(
    data.masterData.departments.map((department) => department.code),
  )
  seedDepartments.forEach((department) => {
    if (!existingDepartmentCodes.has(department.code)) {
      data.masterData.departments.push(department)
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
  addObject: () => {
    set((state) => ({
      data: updateData(state.data, (draft) => {
        const record = getActiveCase(draft)
        if (!record) {
          return
        }
        record.objects.push(createNewObject())
        touchCase(record)
      }),
    }))
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
  setAdminOpen: (open) => set({ adminOpen: open }),
  setActiveAdminSection: (section) => set({ activeAdminSection: section }),
}))
