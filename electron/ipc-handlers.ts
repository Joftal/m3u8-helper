import { BrowserWindow, dialog, ipcMain, app } from 'electron'
import { existsSync } from 'fs'
import { getStore } from './store'
import { startDownload, cancelDownload, getActiveTasks } from './downloader'
import { addScheduledTask, removeScheduledTask, getScheduledTasks } from './scheduler'
import { delimiter, join } from 'path'

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
      filters: [{ name: 'All Files', extensions: ['*'] }]
    })
    if (result.canceled) return null
    return result.filePaths[0]
  })

  // ========== 应用信息 ==========
  ipcMain.handle('app:getExePath', async () => {
    const store = getStore()
    const configured = (store.get('settings.exePath') as string) || ''
    if (configured && existsSync(configured)) return configured

    const possiblePaths = [
      join(process.cwd(), 'N_m3u8DL-RE.exe'),
      join(process.cwd(), 'bin', 'N_m3u8DL-RE.exe')
    ]

    for (const p of possiblePaths) {
      if (existsSync(p)) return p
    }

    const envPath = process.env.PATH || ''
    for (const candidate of envPath.split(delimiter)) {
      const fullPath = join(candidate, 'N_m3u8DL-RE.exe')
      if (existsSync(fullPath)) return fullPath
    }

    return ''
  })

  ipcMain.handle('app:checkToolPaths', async () => {
    const store = getStore()

    const check = (field: 'exePath' | 'ffmpegPath' | 'mp4decryptPath') => {
      const configured = ((store.get(`settings.${field}`) as string) || '').trim()
      const candidatePath = configured || ''

      if (!candidatePath) {
        return {
          configured: '',
          detected: '',
          exists: false,
          missing: true
        }
      }

      const exists = existsSync(candidatePath)
      return {
        configured: candidatePath,
        detected: exists ? candidatePath : '',
        exists,
        missing: !exists
      }
    }

    return {
      exe: check('exePath'),
      ffmpeg: check('ffmpegPath'),
      mp4decrypt: check('mp4decryptPath')
    }
  })

  ipcMain.handle('app:getVersion', async () => {
    return app.getVersion()
  })
}
