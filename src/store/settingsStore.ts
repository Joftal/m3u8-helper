import { create } from 'zustand'
import type { AppSettings } from '@/types/settings'

const defaultSettings: AppSettings = {
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

interface SettingsStore {
  settings: AppSettings
  loaded: boolean
  loadSettings: () => Promise<void>
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>
  updateSettings: (updates: Partial<AppSettings>) => void
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  settings: defaultSettings,
  loaded: false,
  loadSettings: async () => {
    try {
      const settings = await window.api.settings.getAll()
      if (settings) set({ settings: { ...defaultSettings, ...settings }, loaded: true })
      else set({ loaded: true })
    } catch { set({ loaded: true }) }
  },
  updateSetting: async (key, value) => {
    set((state) => ({ settings: { ...state.settings, [key]: value } }))
    await window.api.settings.set(key, value)
  },
  updateSettings: async (updates) => {
    set((state) => ({ settings: { ...state.settings, ...updates } }))
    for (const [key, value] of Object.entries(updates)) {
      await window.api.settings.set(key, value)
    }
  }
}))
