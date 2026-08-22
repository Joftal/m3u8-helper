import { BrowserWindow, dialog, ipcMain, app } from 'electron'
import { getStore } from './store'
import { startDownload, cancelDownload, getActiveTasks } from './downloader'
import { startClipboardWatch, stopClipboardWatch } from './clipboard'
import { addScheduledTask, removeScheduledTask, getScheduledTasks } from './scheduler'
import { join } from 'path'

export function registerIpcHandlers(mainWindow: BrowserWindow | null): void {
  // ========== 下载 ==========
  ipcMain.handle('download:start', async (_, options) => {
    try {
      const taskId = startDownload(options, mainWindow)
      return { success: true, taskId }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('download:cancel', async (_, taskId) => {
    const result = cancelDownload(taskId)
    return { success: result }
  })

  // ========== 设置 ==========
  ipcMain.handle('settings:get', async (_, key) => {
    const store = getStore()
    if (key) {
      return store.get(`settings.${key}` as any)
    }
    return store.get('settings')
  })

  ipcMain.handle('settings:set', async (_, key, value) => {
    const store = getStore()
    store.set(`settings.${key}` as any, value)
    return { success: true }
  })

  ipcMain.handle('settings:getAll', async () => {
    const store = getStore()
    return store.get('settings')
  })

  // ========== 历史 ==========
  ipcMain.handle('history:getAll', async () => {
    const store = getStore()
    return store.get('history') || []
  })

  ipcMain.handle('history:add', async (_, record) => {
    const store = getStore()
    const history = store.get('history') || []
    history.unshift(record)
    // 保留最近 500 条
    if (history.length > 500) history.length = 500
    store.set('history', history)
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

  // ========== 剪贴板 ==========
  ipcMain.on('clipboard:start', () => {
    startClipboardWatch(mainWindow)
  })

  ipcMain.on('clipboard:stop', () => {
    stopClipboardWatch()
  })

  // ========== 定时任务 ==========
  ipcMain.handle('scheduler:add', async (_, task) => {
    return addScheduledTask(task)
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
      filters: filters || [
        { name: 'All Files', extensions: ['*'] },
        { name: 'M3U8 Files', extensions: ['m3u8'] },
        { name: 'MPD Files', extensions: ['mpd'] }
      ]
    })
    if (result.canceled) return null
    return result.filePaths[0]
  })

  // ========== 应用信息 ==========
  ipcMain.handle('app:getExePath', async () => {
    const store = getStore()
    let exePath = store.get('settings.exePath')

    // 自动检测
    if (!exePath) {
      const possiblePaths = [
        join(process.cwd(), 'N_m3u8DL-RE.exe'),
        join(process.cwd(), 'bin', 'N_m3u8DL-RE.exe'),
        'H:\\m3u8down\\N_m3u8DL-RE\\src\\N_m3u8DL-RE\\bin\\Release\\net10.0\\N_m3u8DL-RE.exe',
        'H:\\m3u8down\\N_m3u8DL-RE\\src\\N_m3u8DL-RE\\bin\\Debug\\net10.0\\N_m3u8DL-RE.exe'
      ]

      const { existsSync } = require('fs')
      for (const p of possiblePaths) {
        if (existsSync(p)) {
          exePath = p
          store.set('settings.exePath', p)
          break
        }
      }
    }

    return exePath || ''
  })

  ipcMain.handle('app:getVersion', async () => {
    return app.getVersion()
  })
}
