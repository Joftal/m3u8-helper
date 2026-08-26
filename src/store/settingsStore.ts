import { create } from 'zustand'
import type { AppSettings } from '@/types/settings'
import { validateSettingValue, validateSettings } from '@/utils/validators'

export const defaultSettings: AppSettings = {
  exePath: '',
  ffmpegPath: '',
  mp4decryptPath: '',
  saveDir: '',
  tmpDir: '',
  savePattern: '',
  logFilePath: '',
  baseUrl: '',
  proxy: '',
  useSystemProxy: true,
  headers: {},
  threadCount: 8,
  downloadRetryCount: 3,
  httpRequestTimeout: 100,
  maxSpeed: '',
  autoSelect: true,
  subOnly: false,
  batchConcurrency: 2,
  binaryMerge: false,
  checkSegmentsCount: true,
  useFFmpegConcatDemuxer: false,
  skipMerge: false,
  muxAfterDone: true,
  muxFormat: 'mp4',
  muxMuxer: 'ffmpeg',
  muxKeepFiles: false,
  muxSkipSub: false,
  delAfterDone: true,
  noDateInfo: false,
  logLevel: 'INFO',
  noLog: false,
  writeMetaJson: true,
  appendUrlParams: false,
  concurrentDownload: false,
  subFormat: 'SRT',
  autoSubtitleFix: true,
  decryptionEngine: 'MP4DECRYPT',
  mp4RealTimeDecryption: false,
  keyTextFile: '',
  customHlsMethod: '',
  customHlsKey: '',
  customHlsIv: '',
  customRange: '',
  adKeywords: [],
  allowHlsMultiExtMap: false,
  customArgs: ''
}

export const resetExcludedKeys = [
  'exePath',
  'ffmpegPath',
  'mp4decryptPath',
  'baseUrl',
  'proxy',
  'useSystemProxy',
  'headers'
] as const satisfies readonly (keyof AppSettings)[]

interface SettingsStore {
  settings: AppSettings
  loaded: boolean
  loadSettings: () => Promise<void>
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>
  updateSettings: (updates: Partial<AppSettings>) => void
  resetSettings: () => Promise<void>
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: defaultSettings,
  loaded: false,
  loadSettings: async () => {
    try {
      const [settings, defaultValues] = await Promise.all([
        window.api.settings.getAll(),
        window.api.settings.getDefaults()
      ])
      const mergedDefaults = { ...defaultSettings, ...defaultValues }
      const sanitized = settings ? (validateSettings(settings as unknown as Record<string, unknown>).settings as unknown as AppSettings) : mergedDefaults
      set({ settings: { ...mergedDefaults, ...sanitized }, loaded: true })
    } catch { set({ loaded: true }) }
  },
  updateSetting: async (key, value) => {
    const result = validateSettingValue(key, value)
    if (!result.valid) return

    const previous = get().settings[key]
    set((state) => ({ settings: { ...state.settings, [key]: result.value } }))
    try {
      const res = await window.api.settings.set(key, result.value)
      if (!res?.success) throw new Error(res?.error || 'persist failed')
    } catch {
      // 持久化失败：回滚乐观值，避免界面与磁盘长期分叉
      set((state) => ({ settings: { ...state.settings, [key]: previous } }))
    }
  },
  updateSettings: async (updates) => {
    const sanitized = validateSettings(updates as unknown as Record<string, unknown>).settings as unknown as Partial<AppSettings>
    const entries = Object.entries(sanitized)
    if (entries.length === 0) return

    const previous = get().settings
    set((state) => ({ settings: { ...state.settings, ...sanitized } }))
    for (const [key, value] of entries) {
      try {
        const res = await window.api.settings.set(key, value)
        if (!res?.success) throw new Error(res?.error || 'persist failed')
      } catch {
        // 批量写入中失败的键定向回滚到批前值，成功的键保留
        set((state) => ({ settings: { ...state.settings, [key]: (previous as unknown as Record<string, unknown>)[key] } }))
      }
    }
  },
  resetSettings: async () => {
    // 重置逻辑以主进程 store.resetSettings 为唯一实现，渲染端仅采纳其返回的权威配置
    const result = await window.api.settings.resetAll([...resetExcludedKeys])
    if (result?.success && result.settings) {
      const sanitized = validateSettings(result.settings as unknown as Record<string, unknown>).settings as unknown as AppSettings
      // 剔除式净化可能缺少个别键，合并默认值保证形状完整
      set({ settings: { ...defaultSettings, ...sanitized }, loaded: true })
    }
  }
}))
