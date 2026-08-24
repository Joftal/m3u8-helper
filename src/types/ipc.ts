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
    waitForComplete: (taskId: string) => Promise<any>
    onProgress: (callback: (data: any) => void) => () => void
    onLog: (callback: (data: any) => void) => () => void
    onComplete: (callback: (data: any) => void) => () => void
    onStreamParsed: (callback: (data: any) => void) => () => void
    removeAllListeners: () => void
  }
  settings: {
    get: (key?: string) => Promise<any>
    set: (key: string, value: any) => Promise<{ success: boolean }>
    getAll: () => Promise<any>
  }
  history: {
    getAll: () => Promise<any[]>
    add: (record: any) => Promise<{ success: boolean }>
    remove: (id: string) => Promise<{ success: boolean }>
    clear: () => Promise<{ success: boolean }>
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
    getExePath: () => Promise<string>
    checkToolPaths: () => Promise<{
      exe: { configured: string; detected: string; exists: boolean; missing: boolean }
      ffmpeg: { configured: string; detected: string; exists: boolean; missing: boolean }
      mp4decrypt: { configured: string; detected: string; exists: boolean; missing: boolean }
    }>
    getVersion: () => Promise<string>
  }
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}
