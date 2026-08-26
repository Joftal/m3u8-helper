import { app, BrowserWindow, dialog, ipcMain, shell, nativeImage } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { registerIpcHandlers } from '../ipc-handlers'
import { getStore, initStore } from '../store'
import { interruptOrphanedRuntimeTasks, countActiveRecordTasks, cancelAllRecordTasks, sweepOrphanedEmptyTmpDirs, setActiveMainWindow } from '../downloader'
import { initScheduler } from '../scheduler'

let mainWindow: BrowserWindow | null = null

/**
 * 录制在途时的退出放行标记：close 对话框与 before-quit 守卫共用。
 * 首次确认后放行后续所有退出路径，避免二次弹窗；
 * 同时保证"停止录制并退出"触发的 app.quit() 不会再被守卫拦回。
 */
let recordQuitConfirmed = false

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

  // 有活跃录制时的退出拦截：录制不可暂停，静默关窗会截断长时间录制。
  // 默认转入后台继续录制（second-instance 可重新唤起），确认后走取消路径保留产物。
  mainWindow.on('close', (event) => {
    if (!recordQuitConfirmed && mainWindow && countActiveRecordTasks() > 0) {
      event.preventDefault()
      const choice = dialog.showMessageBoxSync(mainWindow, {
        type: 'warning',
        title: '录制进行中',
        message: `还有 ${countActiveRecordTasks()} 个录制任务正在进行`,
        detail: '关闭应用会立即中断录制。已录内容（MKV 封装）通常仍可播放，但未写入的部分会丢失。',
        buttons: ['最小化到后台继续录制', '停止录制并退出', '取消'],
        defaultId: 0,
        cancelId: 2,
        noLink: true
      })
      if (choice === 0) {
        mainWindow.hide()
        return
      }
      if (choice === 1) {
        recordQuitConfirmed = true
        cancelAllRecordTasks()
        mainWindow.close()
      }
      return
    }

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
      if (!mainWindow.isVisible()) mainWindow.show()
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  // 程序化退出路径（系统关机、会话注销、autoUpdater 等）同样受录制守卫保护，
  // 与 close 拦截共享 recordQuitConfirmed 放行标记，避免重复弹窗
  app.on('before-quit', (event) => {
    if (recordQuitConfirmed || countActiveRecordTasks() === 0) return
    event.preventDefault()
    const choice = dialog.showMessageBoxSync({
      type: 'warning',
      title: '录制进行中',
      message: `还有 ${countActiveRecordTasks()} 个录制任务正在进行`,
      detail: '退出会立即中断录制。已录内容（MKV 封装）通常仍可播放，但未写入的部分会丢失。',
      buttons: ['停止录制并退出', '取消'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    })
    if (choice === 0) {
      recordQuitConfirmed = true
      cancelAllRecordTasks()
      app.quit()
    }
  })

  app.whenReady().then(() => {
    initStore()
    interruptOrphanedRuntimeTasks()
    sweepOrphanedEmptyTmpDirs()
    registerWindowControls()
    createWindow()
    // 启动恢复触发的后台动作（转封装等）需要窗口引用才能反馈到渲染端
    setActiveMainWindow(mainWindow)
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
