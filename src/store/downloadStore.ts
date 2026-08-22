import { create } from 'zustand'
import type { DownloadTask, LogEntry } from '@/types/download'

interface DownloadStore {
  tasks: DownloadTask[]
  activeTaskId: string | null

  addTask: (task: DownloadTask) => void
  updateTask: (id: string, updates: Partial<DownloadTask>) => void
  removeTask: (id: string) => void
  setActiveTask: (id: string | null) => void
  addLog: (taskId: string, log: LogEntry) => void
  getTask: (id: string) => DownloadTask | undefined
}

export const useDownloadStore = create<DownloadStore>((set, get) => ({
  tasks: [],
  activeTaskId: null,

  addTask: (task) => set((state) => ({
    tasks: [task, ...state.tasks],
    activeTaskId: task.id
  })),

  updateTask: (id, updates) => set((state) => ({
    tasks: state.tasks.map((t) => t.id === id ? { ...t, ...updates } : t)
  })),

  removeTask: (id) => set((state) => ({
    tasks: state.tasks.filter((t) => t.id !== id),
    activeTaskId: state.activeTaskId === id ? null : state.activeTaskId
  })),

  setActiveTask: (id) => set({ activeTaskId: id }),

  addLog: (taskId, log) => set((state) => ({
    tasks: state.tasks.map((t) => {
      if (t.id !== taskId) return t
      const logs = [...t.logs, log]
      // 保留最近 1000 条日志
      if (logs.length > 1000) logs.splice(0, logs.length - 1000)
      return { ...t, logs }
    })
  })),

  getTask: (id) => get().tasks.find((t) => t.id === id)
}))
