export interface ElectronAPI {
  window: {
    minimize: () => void
    maximize: () => void
    close: () => void
    isMaximized: () => Promise<boolean>
    onMaximizedChanged: (callback: (maximized: boolean) => void) => () => void
  }
  download: {
    /** options 为主进程解析后的生效参数（隔离 tmpDir 等），渲染端任务记录应以此为准 */
    start: (options: any) => Promise<{ success: boolean; taskId?: string; options?: any; error?: string }>
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
    /** 录制任务 TS 中间产物自动转封装完成（outputs 为产出的 MKV 列表） */
    onRemuxDone: (callback: (data: { taskId: string; outputs: string[]; attempted: number }) => void) => () => void
  }
  settings: {
    set: (key: string, value: any) => Promise<{ success: boolean; error?: string }>
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
  network: {
    /** 系统网络吞吐 B/s（下行/上行） */
    onStats: (callback: (data: { down: number; up: number }) => void) => () => void
  },
  app: {
    getVersion: () => Promise<string>
  }
  shell: {
    openPath: (target: string) => Promise<string>
  }
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}
