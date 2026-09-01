import { create } from 'zustand'
import type { ChangeEvent } from 'react'
import * as XLSX from 'xlsx'
import { useDownloadStore } from './downloadStore'
import { useSettingsStore } from './settingsStore'
import { showToast } from '@/components/Toast'
import { translateMessagePath, isImportHeaderAlias } from '@/i18n'
import { normalizeLocale, DEFAULT_LOCALE } from '@/constants/locales'
import { buildTaskOptions } from '@/utils/taskOptions'
import { extractFileName, generateId } from '@/utils/format'
import { isValidUrl } from '@/utils/validators'
import { parseFixedColumnImport, parseUrlLines, normalizeImportCell, extractUrlCandidate, type ImportedRow } from '@/utils/batchImport'
import type { DownloadTask } from '@/types/download'

export interface BatchItem {
  id: string
  url: string
  saveName: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  progress: number
  taskId?: string
}

/** 非 React 上下文取词：直接读 settingsStore 当前语言（store 内无 hook 可用） */
function bt(path: string): string {
  const locale = normalizeLocale(useSettingsStore.getState().settings?.language, DEFAULT_LOCALE)
  return translateMessagePath(locale, path, path)
}

/** 任务结束 → 释放并发槽位（complete 事件驱动；模块级 Map 与组件解耦） */
const completionResolvers = new Map<string, () => void>()
/** 批量队列整体停止标志 */
let batchAbort = false

function waitForTaskCompletion(taskId: string): Promise<void> {
  return new Promise<void>((resolve) => {
    // 兜底看门狗：complete 事件因主进程异常等原因永不到达时，
    // 轮询任务终态释放并发槽位，避免 Promise 永久挂起导致批量按钮永久禁用
    const watchdog = setInterval(() => {
      const task = useDownloadStore.getState().getTask(taskId)
      if (!task || (task.status !== 'running' && task.status !== 'pending')) {
        completionResolvers.delete(taskId)
        clearInterval(watchdog)
        resolve()
      }
    }, 5000)
    completionResolvers.set(taskId, () => {
      clearInterval(watchdog)
      resolve()
    })
  })
}

interface BatchStore {
  batchText: string
  batchItems: BatchItem[]
  isBatchRunning: boolean

  setBatchText: (text: string) => void
  clearBatch: () => void
  parseBatchUrls: () => void
  importFromFile: (event: ChangeEvent<HTMLInputElement>) => Promise<void>
  startBatch: () => Promise<void>
  stopBatch: () => void
  /** 由 Home 的 download:progress / download:complete 订阅转发 */
  notifyProgress: (data: { taskId: string; status?: string; progress?: number }) => void
  notifyComplete: (data: { taskId: string; status?: string; progress?: number }) => void
}

// 与原 Home 内联逻辑一致：非终态（pending/running/undefined）一律映射为 running
function toBatchStatus(status: string | undefined): BatchItem['status'] {
  if (status === 'completed') return 'completed'
  if (status === 'cancelled') return 'cancelled'
  if (status === 'failed') return 'failed'
  return 'running'
}

export const useBatchStore = create<BatchStore>((set, get) => ({
  batchText: '',
  batchItems: [],
  isBatchRunning: false,

  setBatchText: (text) => set({ batchText: text }),

  clearBatch: () => set({ batchText: '', batchItems: [] }),

  parseBatchUrls: () => {
    const validUrls = parseUrlLines(get().batchText)
    if (validUrls.length === 0) {
      showToast('error', bt('home.noValidUrls'))
      return
    }
    const next: BatchItem[] = validUrls.map((url) => ({
      id: generateId(),
      url,
      saveName: extractFileName(url),
      status: 'pending',
      progress: 0
    }))
    set({ batchItems: next })
    showToast('success', bt('home.parseUrlSuccess').replace('{count}', String(next.length)))
  },

  importFromFile: async (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    const appendImported = (rows: ImportedRow[]) => {
      const parsedRows: BatchItem[] = []
      rows.forEach(({ name, url }) => {
        const trimmedUrl = url.trim()
        const trimmedName = name.trim()
        if (!trimmedUrl || !isValidUrl(trimmedUrl)) return
        parsedRows.push({
          id: generateId(),
          url: trimmedUrl,
          saveName: trimmedName || extractFileName(trimmedUrl),
          status: 'pending',
          progress: 0
        })
      })
      if (parsedRows.length === 0) {
        showToast('error', bt('home.importTemplateError'))
        return
      }
      set((state) => ({ batchItems: [...state.batchItems, ...parsedRows] }))
      showToast('success', bt('home.importSuccess').replace('{count}', String(parsedRows.length)))
    }

    try {
      const fileName = file.name.toLowerCase()

      if (/\.(txt|csv|tsv)$/i.test(fileName)) {
        const text = await file.text()
        appendImported(parseFixedColumnImport(text))
      } else if (/\.(xlsx|xls)$/i.test(fileName)) {
        const arrayBuffer = await file.arrayBuffer()
        const workbook = XLSX.read(arrayBuffer, { type: 'array' })
        const sheet = workbook.Sheets[workbook.SheetNames[0]]
        const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' })
        const parsedRows: ImportedRow[] = []

        rows.forEach((row) => {
          if (!Array.isArray(row) || row.length < 2) return
          const firstCell = normalizeImportCell(String(row[0] ?? ''))
          const secondCell = normalizeImportCell(String(row[1] ?? ''))
          if (!firstCell || !secondCell) return
          if (isImportHeaderAlias(firstCell) || isImportHeaderAlias(secondCell)) return
          const urlCell = secondCell.includes('http') ? secondCell : extractUrlCandidate(secondCell)
          if (!urlCell || !isValidUrl(urlCell)) return
          parsedRows.push({ name: firstCell, url: urlCell })
        })

        appendImported(parsedRows)
      } else {
        showToast('error', bt('home.importFormatError'))
      }
    } catch {
      showToast('error', bt('home.importParseError'))
    } finally {
      event.target.value = ''
    }
  },

  startBatch: async () => {
    const { batchItems } = get()
    if (batchItems.length === 0) {
      showToast('error', bt('home.noBatchUrls'))
      return
    }

    set({ isBatchRunning: true })
    batchAbort = false

    const settings = useSettingsStore.getState().settings
    const { addTask, setActiveTask } = useDownloadStore.getState()

    // 并发队列：每个任务结束（complete 事件 → notifyComplete）后才释放槽位
    let cursor = 0
    const size = Math.min(Math.max(1, Math.floor(settings.batchConcurrency || 2)), batchItems.length)
    const updateItem = (id: string, updates: Partial<BatchItem>) =>
      set((state) => ({ batchItems: state.batchItems.map((entry) => entry.id === id ? { ...entry, ...updates } : entry) }))

    const runners = Array.from({ length: size }, async () => {
      while (cursor < batchItems.length) {
        if (batchAbort) return
        const item = batchItems[cursor]
        cursor += 1

        updateItem(item.id, { status: 'running', taskId: undefined })

        const options = buildTaskOptions(useSettingsStore.getState().settings, {
          url: item.url,
          saveName: item.saveName,
        })

        const result = await window.api.download.start(options)
        if (!result.success) {
          updateItem(item.id, { status: 'failed', taskId: undefined })
          continue
        }

        const taskId = result.taskId || item.id
        const task: DownloadTask = {
          id: taskId,
          url: item.url,
          // 批量场景同名概率最高，必须采纳主进程唯一化后的生效名
          saveName: result.options?.saveName || item.saveName,
          saveDir: useSettingsStore.getState().settings.saveDir,
          status: 'pending',
          progress: 0,
          speed: '0 KB/s',
          downloadedSegments: 0,
          totalSegments: 0,
          startTime: new Date().toISOString(),
          options: result.options || options
        }
        addTask(task)
        setActiveTask(taskId)
        updateItem(item.id, { status: 'running', taskId })

        // 等待该任务真正结束（完成/取消/失败都会发出 download:complete）再释放并发槽位
        if (result.taskId) {
          await waitForTaskCompletion(taskId)
        }
      }
    })
    await Promise.all(runners)

    const aborted = batchAbort
    batchAbort = false
    set({ isBatchRunning: false })
    showToast(aborted ? 'info' : 'success', aborted ? bt('home.batchStopped') : bt('home.batchFinished'))
  },

  stopBatch: () => {
    batchAbort = true
    // 同时取消已在途的批量任务：仅置标志会让在途任务继续跑完，与「停止」语义不符；
    // 取消会触发 download:complete → 释放并发槽位 → 队列正常收尾
    for (const item of get().batchItems) {
      if (item.status === 'running' && item.taskId) {
        window.api.download.cancel(item.taskId).catch(() => {})
      }
    }
    showToast('info', bt('home.stoppingBatch'))
  },

  notifyProgress: (data) => {
    set((state) => ({
      batchItems: state.batchItems.map((entry) => {
        if (entry.taskId !== data.taskId) return entry
        return {
          ...entry,
          status: toBatchStatus(data.status),
          progress: typeof data.progress === 'number' ? Number(data.progress) : entry.progress
        }
      })
    }))
  },

  notifyComplete: (data) => {
    // 释放等待该任务的并发槽位
    const resolver = completionResolvers.get(data.taskId)
    if (resolver) {
      completionResolvers.delete(data.taskId)
      resolver()
    }
    get().notifyProgress(data)
  }
}))
