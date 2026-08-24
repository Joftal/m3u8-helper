import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'

const defaults = {
  settings: {
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
    headers: {} as Record<string, string>,
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
    adKeywords: [] as string[],
    allowHlsMultiExtMap: false,
    theme: 'light' as 'dark' | 'light',
    language: 'zh-CN',
    customArgs: ''
  },
  history: [] as any[],
  scheduledTasks: [] as any[]
}

type StoreSchema = typeof defaults

let data: StoreSchema
let configPath: string

function getConfigPath(): string {
  return join(app.getPath('userData'), 'm3u8-box-config.json')
}

export function initStore(): void {
  configPath = getConfigPath()
  try {
    if (existsSync(configPath)) {
      const raw = readFileSync(configPath, 'utf-8')
      const parsed = JSON.parse(raw)
      data = {
        ...defaults,
        ...parsed,
        settings: { ...defaults.settings, ...parsed.settings }
      }
    } else {
      data = JSON.parse(JSON.stringify(defaults))
      saveToFile()
    }
  } catch {
    data = JSON.parse(JSON.stringify(defaults))
    saveToFile()
  }
}

function saveToFile(): void {
  try {
    const dir = join(configPath, '..')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(configPath, JSON.stringify(data, null, 2), 'utf-8')
  } catch (err) {
    console.error('Failed to save config:', err)
  }
}

export function getStore() {
  return {
    get(key?: string): any {
      if (!key) return data
      const keys = key.split('.')
      let current: any = data
      for (const k of keys) {
        if (current == null) return undefined
        current = current[k]
      }
      return current
    },
    set(key: string, value: any): void {
      const keys = key.split('.')
      let current: any = data
      for (let i = 0; i < keys.length - 1; i++) {
        if (current[keys[i]] == null) current[keys[i]] = {}
        current = current[keys[i]]
      }
      current[keys[keys.length - 1]] = value
      saveToFile()
    }
  }
}
