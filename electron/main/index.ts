import { app, BrowserWindow, ipcMain, shell, nativeImage } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { registerIpcHandlers } from '../ipc-handlers'
import { getStore, initStore } from '../store'
import { interruptOrphanedRuntimeTasks } from '../downloader'
import { initScheduler } from '../scheduler'

let mainWindow: BrowserWindow | null = null

/** 窗口控制 IPC：仅注册一次（处理器通过模块级 mainWindow 引用当前窗口），避免重建窗口时重复注册 */
function registerWindowControls(): void {
  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })
  ipcMain.on('window:close', () => mainWindow?.close())
  ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false)
}

function createWindow(): void {
  const iconPath = join(__dirname, '../../resources/icon.png')
  const icon = nativeImage.createFromPath(iconPath)
  const persistedWindowState = getStore().get('windowState') || { width: 1280, height: 800, maximized: false }

  mainWindow = new BrowserWindow({
    width: persistedWindowState.width || 1280,
    height: persistedWindowState.height || 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#ffffff',
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (persistedWindowState.maximized) {
    mainWindow.maximize()
  }

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  const saveWindowState = () => {
    if (!mainWindow) return
    getStore().set('windowState', {
      width: mainWindow.getBounds().width,
      height: mainWindow.getBounds().height,
      maximized: mainWindow.isMaximized()
    })
  }

  // 窗口控制 IPC 已在 whenReady 中统一注册，此处仅维护窗口引用
  mainWindow.on('maximize', () => {
    saveWindowState()
    mainWindow?.webContents.send('window:maximized-changed', true)
  })
  mainWindow.on('unmaximize', () => {
    saveWindowState()
    mainWindow?.webContents.send('window:maximized-changed', false)
  })

  // 拖拽调整大小时防抖落盘，避免每个 resize 事件都同步写 JSON
  let saveStateTimer: ReturnType<typeof setTimeout> | null = null
  const scheduleSaveWindowState = () => {
    if (saveStateTimer) clearTimeout(saveStateTimer)
    saveStateTimer = setTimeout(() => {
      saveStateTimer = null
      saveWindowState()
    }, 400)
  }
  mainWindow.on('resize', scheduleSaveWindowState)
  mainWindow.on('close', () => {
    if (saveStateTimer) {
      clearTimeout(saveStateTimer)
      saveStateTimer = null
    }
    saveWindowState()
  })
}

// 单实例锁：防止双开并发读写同一组 JSON 存储文件
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    initStore()
    interruptOrphanedRuntimeTasks()
    registerWindowControls()
    createWindow()
    registerIpcHandlers(mainWindow)
    initScheduler(mainWindow)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}
