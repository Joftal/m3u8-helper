import { create } from 'zustand'
import type { DownloadTask } from '@/types/download'

interface DownloadStore {
  tasks: DownloadTask[]
  activeTaskId: string | null
  loaded: boolean

  addTask: (task: DownloadTask) => void
  updateTask: (id: string, updates: Partial<DownloadTask>) => void
  removeTask: (id: string) => void
  setActiveTask: (id: string | null) => void
  getTask: (id: string) => DownloadTask | undefined
  loadRuntimeTasks: () => Promise<void>
}

const normalizeRuntimeTask = (task: any): DownloadTask => ({
  id: task.id,
  url: task.url || '',
  saveName: task.saveName || task.url || 'untitled',
  saveDir: task.saveDir || task.options?.saveDir || '',
  status: task.status || 'pending',
  progress: Number(task.progress) || 0,
  speed: task.speed || '0 KB/s',
  downloadedSegments: Number(task.downloadedSegments) || 0,
  totalSegments: Number(task.totalSegments) || 0,
  downloadedBytes: Number(task.downloadedBytes) || 0,
  totalBytes: Number(task.totalBytes) || 0,
  etaSeconds: Number(task.etaSeconds) || 0,
  currentFrameRate: Number(task.currentFrameRate) || 0,
  latestLog: task.latestLog || '',
  startTime: task.startTime || new Date().toISOString(),
  endTime: task.endTime,
  options: {
    ...(task.options || {}),
    // 兼容收敛后的 runtime 快照：tmpDir/outputPath 提升为顶层后，恢复到 options 以复用既有清理链路
    tmpDir: task.tmpDir || task.options?.tmpDir,
    outputPath: task.outputPath || task.options?.outputPath
  }
})

export const useDownloadStore = create<DownloadStore>((set, get) => ({
  tasks: [],
  activeTaskId: null,
  loaded: false,

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

  getTask: (id) => get().tasks.find((t) => t.id === id),

  loadRuntimeTasks: async () => {
    try {
      const tasks = await window.api.runtime.getAll()
      const normalized = (Array.isArray(tasks) ? tasks : []).map(normalizeRuntimeTask)
      const activeTaskId = normalized.find((task) => task.status === 'running' || task.status === 'pending')?.id || normalized[0]?.id || null
      set({ tasks: normalized, activeTaskId, loaded: true })
    } catch {
      set({ loaded: true })
    }
  }
}))
