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
  theme: 'light',
  language: 'zh-CN',
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

export const useSettingsStore = create<SettingsStore>((set) => ({
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

    set((state) => ({ settings: { ...state.settings, [key]: result.value } }))
    await window.api.settings.set(key, result.value)
  },
  updateSettings: async (updates) => {
    const sanitized = validateSettings(updates as unknown as Record<string, unknown>).settings as unknown as Partial<AppSettings>
    set((state) => ({ settings: { ...state.settings, ...sanitized } }))
    for (const [key, value] of Object.entries(sanitized)) {
      await window.api.settings.set(key, value)
    }
  },
  resetSettings: async () => {
    const [current, defaultValues] = await Promise.all([
      window.api.settings.getAll(),
      window.api.settings.getDefaults()
    ])
    const mergedDefaults = { ...defaultSettings, ...defaultValues }
    const next: Record<string, any> = { ...mergedDefaults, ...(current ?? {}) }
    const keys = Object.keys(mergedDefaults) as string[]

    for (const key of keys) {
      if (!(resetExcludedKeys as readonly string[]).includes(key)) {
        next[key] = mergedDefaults[key]
      }
    }

    for (const key of resetExcludedKeys as readonly string[]) {
      next[key] = current?.[key] ?? mergedDefaults[key]
    }

    const sanitized = validateSettings(next as unknown as Record<string, unknown>).settings as unknown as AppSettings
    set({ settings: sanitized, loaded: true })
    await window.api.settings.resetAll([...resetExcludedKeys])
  }
}))
