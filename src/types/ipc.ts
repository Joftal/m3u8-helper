export interface ElectronAPI {
  window: {
    minimize: () => void
    maximize: () => void
    close: () => void
    isMaximized: () => Promise<boolean>
    onMaximizedChanged: (callback: (maximized: boolean) => void) => () => void
  }
  download: {
    start: (options: any) => Promise<{ success: boolean; taskId?: string; error?: string }>
    cancel: (taskId: string) => Promise<{ success: boolean }>
    delete: (taskId: string, taskInfo?: any) => Promise<{
      success: boolean
      deleted?: string[]
      skipped?: Array<{ path: string; reason: string }>
      error?: string
    }>
    onProgress: (callback: (data: any) => void) => () => void
    onLog: (callback: (data: any) => void) => () => void
    onComplete: (callback: (data: any) => void) => () => void
  }
  settings: {
    set: (key: string, value: any) => Promise<{ success: boolean }>
    getAll: () => Promise<any>
    getDefaults: () => Promise<any>
    resetAll: (excludedKeys?: string[]) => Promise<{ success: boolean; settings?: any }>
  }
  history: {
    getAll: () => Promise<any[]>
    add: (record: any) => Promise<{ success: boolean }>
    remove: (id: string) => Promise<{ success: boolean }>
    clear: () => Promise<{ success: boolean }>
  }
  runtime: {
    getAll: () => Promise<any[]>
    remove: (taskId: string) => Promise<{ success: boolean }>
  }
  scheduler: {
    add: (task: any) => Promise<any>
    remove: (id: string) => Promise<boolean>
    getAll: () => Promise<any[]>
  }
  dialog: {
    openDir: () => Promise<string | null>
    openFile: (filters?: any[]) => Promise<string | null>
  }
  app: {
    getVersion: () => Promise<string>
  }
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}
