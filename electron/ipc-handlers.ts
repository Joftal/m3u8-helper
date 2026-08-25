import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { getDefaultSettings, getStore, resetSettings } from './store'
import { startDownload, cancelDownload, deleteTaskArtifacts, sanitizeTaskInfo } from './downloader'
import { addScheduledTask, removeScheduledTask, getScheduledTasks } from './scheduler'
import { validateSettingValue } from '../src/utils/validators'
import type { HistoryRecord, DownloadOptions } from '../src/types/download'

/** 渲染进程提交的历史记录白名单净化：字段类型收敛 + 字符串截断 */
function sanitizeHistoryRecord(raw: unknown): HistoryRecord | null {
  if (!raw || typeof raw !== 'object') return null

  const input = raw as Record<string, unknown>
  const id = typeof input.id === 'string' ? input.id.trim().slice(0, 64) : ''
  const url = typeof input.url === 'string' ? input.url.trim().slice(0, 4096) : ''
  if (!id || !/^https?:\/\//i.test(url)) return null

  const asString = (value: unknown, max: number): string =>
    typeof value === 'string' ? value.slice(0, max) : ''
  const asNumber = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0

  const status = ['completed', 'failed', 'cancelled'].includes(input.status as string)
    ? (input.status as HistoryRecord['status'])
    : 'failed'

  return {
    id,
    url,
    saveName: asString(input.saveName, 512),
    status,
    startTime: asString(input.startTime, 64),
    endTime: asString(input.endTime, 64),
    fileSize: asNumber(input.fileSize),
    outputPath: asString(input.outputPath, 1024),
    duration: asNumber(input.duration)
  }
}

export function registerIpcHandlers(mainWindow: BrowserWindow | null): void {
  // ========== 下载 ==========
  ipcMain.handle('download:start', async (_, options) => {
    try {
      const taskId = startDownload(options as DownloadOptions, mainWindow)
      return { success: true, taskId }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('download:cancel', async (_, taskId) => {
    const result = cancelDownload(taskId)
    return { success: result }
  })

  ipcMain.handle('download:delete', async (_, taskId, taskInfo) => {
    try {
      const result = deleteTaskArtifacts(String(taskId ?? ''), sanitizeTaskInfo(taskInfo))
      return result
    } catch (error: any) {
      return { success: false, deleted: [], skipped: [], error: error.message }
    }
  })

  // ========== 设置 ==========
  ipcMain.handle('settings:set', async (_, key, value) => {
    const normalizedKey = String(key ?? '')

    // 白名单校验：仅允许已知配置项，且不支持嵌套 key
    if (normalizedKey.includes('.')) {
      return { success: false, error: '不支持嵌套配置项' }
    }
    const knownKeys = getDefaultSettings() as Record<string, unknown>
    if (!Object.prototype.hasOwnProperty.call(knownKeys, normalizedKey)) {
      return { success: false, error: '未知配置项' }
    }

    const validation = validateSettingValue(normalizedKey, value)
    if (!validation.valid) {
      return { success: false, error: validation.message || '参数值非法' }
    }
    const store = getStore()
    store.set(`settings.${normalizedKey}` as any, validation.value)
    return { success: true }
  })

  ipcMain.handle('settings:getAll', async () => {
    const store = getStore()
    return store.get('settings')
  })

  ipcMain.handle('settings:getDefaults', async () => {
    return getDefaultSettings()
  })

  ipcMain.handle('settings:resetAll', async (_, excludedKeys: string[] = []) => {
    const settings = resetSettings(excludedKeys)
    return { success: true, settings }
  })

  // ========== 历史 ==========
  ipcMain.handle('history:getAll', async () => {
    const store = getStore()
    return store.get('history') || []
  })

  ipcMain.handle('history:add', async (_, record) => {
    const sanitized = sanitizeHistoryRecord(record)
    if (!sanitized) {
      return { success: false, error: '历史记录字段非法' }
    }
    const store = getStore()
    const history = store.get('history') || []
    // 幂等写入：同 id 覆盖旧条目，避免取消场景双路写入产生重复记录
    const deduped = history.filter((h: any) => h?.id !== sanitized.id)
    deduped.unshift(sanitized)
    // 保留最近 500 条
    if (deduped.length > 500) deduped.length = 500
    store.set('history', deduped)
    return { success: true }
  })

  ipcMain.handle('history:remove', async (_, id) => {
    const store = getStore()
    const history = store.get('history') || []
    store.set('history', history.filter((h: any) => h.id !== id))
    return { success: true }
  })

  ipcMain.handle('history:clear', async () => {
    const store = getStore()
    store.set('history', [])
    return { success: true }
  })

  // ========== 运行任务恢复 ==========
  ipcMain.handle('runtime:getAll', async () => {
    const store = getStore()
    return store.get('runtimeTasks') || []
  })

  ipcMain.handle('runtime:remove', async (_, taskId) => {
    const store = getStore()
    const tasks = Array.isArray(store.get('runtimeTasks')) ? store.get('runtimeTasks') : []
    store.set('runtimeTasks', tasks.filter((task: any) => task.id !== taskId))
    return { success: true }
  })

  // ========== 定时任务 ==========
  ipcMain.handle('scheduler:add', async (_, task) => {
    return addScheduledTask(task, mainWindow)
  })

  ipcMain.handle('scheduler:remove', async (_, id) => {
    return removeScheduledTask(id)
  })

  ipcMain.handle('scheduler:getAll', async () => {
    return getScheduledTasks()
  })

  // ========== 对话框 ==========
  ipcMain.handle('dialog:openDir', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory']
    })
    if (result.canceled) return null
    return result.filePaths[0]
  })

  ipcMain.handle('dialog:openFile', async (_, filters) => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile'],
      filters: Array.isArray(filters) && filters.length > 0
        ? filters
        : [{ name: 'All Files', extensions: ['*'] }]
    })
    if (result.canceled) return null
    return result.filePaths[0]
  })

  // ========== 应用信息 ==========
  ipcMain.handle('app:getVersion', async () => {
    return app.getVersion()
  })

  // ========== 外部打开 ==========
  ipcMain.handle('shell:openPath', async (_, target) => {
    const p = String(target ?? '').trim()
    // 仅允许绝对路径（历史记录中的保存目录），相对路径一律拒绝
    if (!/^[a-zA-Z]:[\\/]/.test(p) && !p.startsWith('/')) {
      return '不支持的路径'
    }
    return shell.openPath(p)
  })
}
