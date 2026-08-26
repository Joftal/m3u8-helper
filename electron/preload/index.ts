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
      const listener = (_: unknown, value: boolean) => callback(value)
      ipcRenderer.on('window:maximized-changed', listener)
      return () => ipcRenderer.removeListener('window:maximized-changed', listener)
    }
  },

  // 下载控制
  download: {
    start: (options: any) => ipcRenderer.invoke('download:start', options),
    cancel: (taskId: string) => ipcRenderer.invoke('download:cancel', taskId),
    delete: (taskId: string, taskInfo?: any) => ipcRenderer.invoke('download:delete', taskId, taskInfo),
    onProgress: (callback: (data: any) => void) => {
      const listener = (_: unknown, data: any) => callback(data)
      ipcRenderer.on('download:progress', listener)
      return () => ipcRenderer.removeListener('download:progress', listener)
    },
    onLog: (callback: (data: any) => void) => {
      const listener = (_: unknown, data: any) => callback(data)
      ipcRenderer.on('download:log', listener)
      return () => ipcRenderer.removeListener('download:log', listener)
    },
    onComplete: (callback: (data: any) => void) => {
      const listener = (_: unknown, data: any) => callback(data)
      ipcRenderer.on('download:complete', listener)
      return () => ipcRenderer.removeListener('download:complete', listener)
    },
    onRemuxDone: (callback: (data: { taskId: string; outputs: string[]; attempted: number }) => void) => {
      const listener = (_: unknown, data: any) => callback(data)
      ipcRenderer.on('record:artifacts-remuxed', listener)
      return () => ipcRenderer.removeListener('record:artifacts-remuxed', listener)
    }
  },

  // 设置
  settings: {
    set: (key: string, value: any) => ipcRenderer.invoke('settings:set', key, value),
    getAll: () => ipcRenderer.invoke('settings:getAll'),
    getDefaults: () => ipcRenderer.invoke('settings:getDefaults'),
    resetAll: (excludedKeys?: string[]) => ipcRenderer.invoke('settings:resetAll', excludedKeys)
  },

  // 历史
  history: {
    getAll: () => ipcRenderer.invoke('history:getAll'),
    add: (record: any) => ipcRenderer.invoke('history:add', record),
    remove: (id: string) => ipcRenderer.invoke('history:remove', id),
    clear: () => ipcRenderer.invoke('history:clear')
  },

  // 运行任务恢复
  runtime: {
    getAll: () => ipcRenderer.invoke('runtime:getAll'),
    remove: (taskId: string) => ipcRenderer.invoke('runtime:remove', taskId)
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
    getVersion: () => ipcRenderer.invoke('app:getVersion')
  },

  // 外部打开
  shell: {
    openPath: (target: string) => ipcRenderer.invoke('shell:openPath', target)
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
