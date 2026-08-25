import { create } from 'zustand'
import type { HistoryRecord } from '@/types/download'

interface HistoryStore {
  records: HistoryRecord[]
  loaded: boolean

  loadHistory: () => Promise<void>
  /** 返回底层持久化是否成功；乐观更新失败时回滚 */
  addRecord: (record: HistoryRecord) => Promise<boolean>
  removeRecord: (id: string) => Promise<boolean>
  clearHistory: () => Promise<boolean>
}

export const useHistoryStore = create<HistoryStore>((set, get) => ({
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

  /** 幂等写入：同 id 覆盖旧条目并置顶；持久化失败时回滚到写入前状态 */
  addRecord: async (record) => {
    const existing = get().records.find((r) => r.id === record.id) ?? null
    set((state) => ({ records: [record, ...state.records.filter((r) => r.id !== record.id)] }))
    const result = await window.api.history.add(record).catch(() => null)
    if (!result?.success) {
      // 持久化未成功（传输异常或字段被拒）：定向回滚——恢复被覆盖的原条目，否则移除本次插入
      set((state) => ({
        records: existing
          ? [existing, ...state.records.filter((r) => r.id !== record.id)]
          : state.records.filter((r) => r.id !== record.id)
      }))
      return false
    }
    return true
  },

  removeRecord: async (id) => {
    const target = get().records.find((r) => r.id === id)
    set((state) => ({ records: state.records.filter((r) => r.id !== id) }))
    const result = await window.api.history.remove(id).catch(() => null)
    if (!result?.success) {
      // 定向回滚：仅恢复被删的那一条，避免整体还原快照时吞掉等待窗口内的并发写入
      set((state) => {
        if (!target || state.records.some((r) => r.id === id)) return state
        return { records: [target, ...state.records] }
      })
      return false
    }
    return true
  },

  clearHistory: async () => {
    const previous = get().records
    set({ records: [] })
    const result = await window.api.history.clear().catch(() => null)
    if (!result?.success) {
      // 定向回滚：恢复被清条目，同时保留等待窗口内的并发新增（新增保持在前）
      set((state) => ({
        records: [
          ...state.records.filter((r) => !previous.some((p) => p.id === r.id)),
          ...previous
        ]
      }))
      return false
    }
    return true
  }
}))
