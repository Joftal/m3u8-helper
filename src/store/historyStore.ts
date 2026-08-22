import { create } from 'zustand'
import type { HistoryRecord } from '@/types/download'

interface HistoryStore {
  records: HistoryRecord[]
  loaded: boolean

  loadHistory: () => Promise<void>
  addRecord: (record: HistoryRecord) => Promise<void>
  removeRecord: (id: string) => Promise<void>
  clearHistory: () => Promise<void>
}

export const useHistoryStore = create<HistoryStore>((set) => ({
  records: [],
  loaded: false,

  loadHistory: async () => {
    try {
      const records = await window.api.history.getAll()
      set({ records: records || [], loaded: true })
    } catch {
      set({ loaded: true })
    }
  },

  addRecord: async (record) => {
    set((state) => ({
      records: [record, ...state.records]
    }))
    await window.api.history.add(record)
  },

  removeRecord: async (id) => {
    set((state) => ({
      records: state.records.filter((r) => r.id !== id)
    }))
    await window.api.history.remove(id)
  },

  clearHistory: async () => {
    set({ records: [] })
    await window.api.history.clear()
  }
}))
