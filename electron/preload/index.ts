import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  // 窗口控制
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    onMaximizedChanged: (callback: (maximized: boolean) => void) => {
      ipcRenderer.on('window:maximized-changed', (_, value) => callback(value))
    }
  },

  // 下载控制
  download: {
    start: (options: any) => ipcRenderer.invoke('download:start', options),
    cancel: (taskId: string) => ipcRenderer.invoke('download:cancel', taskId),
    onProgress: (callback: (data: any) => void) => {
      ipcRenderer.on('download:progress', (_, data) => callback(data))
    },
    onLog: (callback: (data: any) => void) => {
      ipcRenderer.on('download:log', (_, data) => callback(data))
    },
    onComplete: (callback: (data: any) => void) => {
      ipcRenderer.on('download:complete', (_, data) => callback(data))
    },
    onStreamParsed: (callback: (data: any) => void) => {
      ipcRenderer.on('streams:parsed', (_, data) => callback(data))
    },
    removeAllListeners: () => {
      ipcRenderer.removeAllListeners('download:progress')
      ipcRenderer.removeAllListeners('download:log')
      ipcRenderer.removeAllListeners('download:complete')
      ipcRenderer.removeAllListeners('streams:parsed')
    }
  },

  // 设置
  settings: {
    get: (key?: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: any) => ipcRenderer.invoke('settings:set', key, value),
    getAll: () => ipcRenderer.invoke('settings:getAll')
  },

  // 历史
  history: {
    getAll: () => ipcRenderer.invoke('history:getAll'),
    add: (record: any) => ipcRenderer.invoke('history:add', record),
    remove: (id: string) => ipcRenderer.invoke('history:remove', id),
    clear: () => ipcRenderer.invoke('history:clear')
  },

  // 剪贴板
  clipboard: {
    start: () => ipcRenderer.send('clipboard:start'),
    stop: () => ipcRenderer.send('clipboard:stop'),
    onDetected: (callback: (url: string) => void) => {
      ipcRenderer.on('clipboard:detected', (_, url) => callback(url))
    }
  },

  // 定时任务
  scheduler: {
    add: (task: any) => ipcRenderer.invoke('scheduler:add', task),
    remove: (id: string) => ipcRenderer.invoke('scheduler:remove', id),
    getAll: () => ipcRenderer.invoke('scheduler:getAll')
  },

  // 对话框
  dialog: {
    openDir: () => ipcRenderer.invoke('dialog:openDir'),
    openFile: (filters?: any[]) => ipcRenderer.invoke('dialog:openFile', filters)
  },

  // 应用信息
  app: {
    getExePath: () => ipcRenderer.invoke('app:getExePath'),
    getVersion: () => ipcRenderer.invoke('app:getVersion')
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.electron = electronAPI
  // @ts-ignore
  window.api = api
}
