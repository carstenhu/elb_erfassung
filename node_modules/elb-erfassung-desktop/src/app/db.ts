import Dexie, { type Table } from 'dexie'
import type { AppData } from './types'

type Snapshot = {
  id: string
  value: AppData
}

class ElbDatabase extends Dexie {
  snapshots!: Table<Snapshot, string>

  constructor() {
    super('elb-erfassung-desktop')
    this.version(1).stores({
      snapshots: '&id',
    })
  }
}

export const appDb = new ElbDatabase()

export const loadSnapshot = async () => {
  const snapshot = await appDb.snapshots.get('app-state')
  return snapshot?.value ?? null
}

export const saveSnapshot = async (value: AppData) => {
  await appDb.snapshots.put({ id: 'app-state', value })
}
