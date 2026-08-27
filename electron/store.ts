import { app } from 'electron'
import { join, dirname } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'fs'
import { DEFAULT_LOCALE, normalizeLocale, type SupportedLocale } from '../src/constants/locales'
import { sanitizeSettings } from '../src/utils/validators'
import { registerProtectedPath } from './path-safety'
import { translateRuntimeMessage } from '../src/i18n'

function runtimeLocale(): SupportedLocale {
  const locale = String(app.getLocale?.() || DEFAULT_LOCALE).toLowerCase()
  if (locale.startsWith('zh')) return 'zh'
  if (locale.startsWith('en')) return 'en'
  return normalizeLocale(locale, DEFAULT_LOCALE)
}

function rt(key: Parameters<typeof translateRuntimeMessage>[1], params?: Record<string, string>): string {
  return translateRuntimeMessage(runtimeLocale(), key, params)
}

function resolveAppStorageRoot(): string {
  const packagedRoot = app.isPackaged ? dirname(process.execPath) : ''
  const candidates: string[] = []

  if (packagedRoot) {
    candidates.push(packagedRoot)
  }

  candidates.push(app.getAppPath())

  if (process.cwd()) {
    candidates.push(process.cwd())
  }

  for (const candidate of candidates) {
    try {
      const testDir = join(candidate, '.m3u8-helper-test')
      mkdirSync(testDir, { recursive: true })
      const marker = join(testDir, 'write-test.txt')
      writeFileSync(marker, 'ok', 'utf-8')
      if (existsSync(marker)) {
        try {
          require('fs').rmSync(testDir, { recursive: true, force: true })
        } catch {}

        if (app.isPackaged && candidate === packagedRoot) {
          return candidate
        }

        if (app.isPackaged) {
          console.warn(`[m3u8-helper] Using packaged app directory: ${candidate}`)
        }
        return candidate
      }
    } catch {
      continue
    }
  }

  // 所有候选目录均不可写（如 Program Files 安装且未提权）时，
  // 降级到系统用户数据目录，保证配置仍可持久化而非静默丢失
  try {
    const userDataDir = app.getPath('userData')
    mkdirSync(userDataDir, { recursive: true })
    console.warn(rt('storageFallbackToUserData', { path: userDataDir }))
    return userDataDir
  } catch {
    return packagedRoot || app.getAppPath()
  }
}

const rootDir = resolveAppStorageRoot()
const appDataDir = join(rootDir, '.m3u8-helper')
const defaultDownloadDir = join(rootDir, 'downloads')
const defaultTmpDir = join(rootDir, 'tmp')
const defaultLogDir = join(rootDir, 'logs')
const defaultLogFilePath = join(defaultLogDir, 'N_m3u8DL-RE.log')

const defaults = {
  settings: {
    language: DEFAULT_LOCALE,
    exePath: '',
    ffmpegPath: '',
    mp4decryptPath: '',
    saveDir: defaultDownloadDir,
    tmpDir: defaultTmpDir,
    savePattern: '',
    logFilePath: defaultLogFilePath,
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
    adKeywords: [] as string[],
    allowHlsMultiExtMap: false,
    customArgs: ''
  },
  history: [] as any[],
  runtimeTasks: [] as any[],
  windowState: {
    width: 1280,
    height: 800,
    maximized: false
  }
}

export const defaultSettings = JSON.parse(JSON.stringify(defaults.settings)) as typeof defaults.settings

export function getDefaultSettings(): typeof defaultSettings {
  return sanitizeSettings(JSON.parse(JSON.stringify(defaultSettings)))
}

type StoreSchema = typeof defaults

type CategoryName = keyof StoreSchema

const categoryFiles: Record<CategoryName, string> = {
  settings: 'settings.json',
  history: 'history.json',
  runtimeTasks: 'runtime-tasks.json',
  windowState: 'window-state.json'
}

let data: StoreSchema

/** 禁止作为对象键写入的危险键名，阻断原型污染 */
const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function isSafeObjectKey(key: string): boolean {
  return !UNSAFE_OBJECT_KEYS.has(key)
}

function ensureAppDataDir(): void {
  if (!existsSync(appDataDir)) {
    mkdirSync(appDataDir, { recursive: true })
  }
}

function getCategoryFilePath(category: CategoryName): string {
  ensureAppDataDir()
  return join(appDataDir, categoryFiles[category])
}

function readCategoryJson<T>(category: CategoryName, fallback: T): T {
  const filePath = getCategoryFilePath(category)
  try {
    if (!existsSync(filePath)) {
      writeFileSync(filePath, JSON.stringify(fallback, null, 2), 'utf-8')
      return fallback
    }
    const raw = readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw)
    if (category === 'settings') {
      const merged: Record<string, unknown> = { ...(fallback as Record<string, unknown>) }
      if (parsed && typeof parsed === 'object') {
        for (const [key, value] of Object.entries(parsed)) {
          if (isSafeObjectKey(key)) merged[key] = value
        }
      }
      return merged as T
    }
    return parsed as T
  } catch {
    writeFileSync(filePath, JSON.stringify(fallback, null, 2), 'utf-8')
    return fallback
  }
}

function saveCategory(category: CategoryName): void {
  const filePath = getCategoryFilePath(category)
  try {
    writeFileSync(filePath, JSON.stringify(data[category], null, 2), 'utf-8')
  } catch (err) {
    console.error(`Failed to save ${category}:`, err)
  }
}

export function resetSettings(excludedKeys: string[] = []): typeof defaultSettings {
  const current: Record<string, any> = data.settings ?? JSON.parse(JSON.stringify(defaultSettings))
  const exclude = new Set(excludedKeys)
  const defaultMap: Record<string, any> = JSON.parse(JSON.stringify(defaultSettings))
  const next: Record<string, any> = { ...defaultMap }

  // 排除键保留当前值；其余回到默认
  for (const key of exclude) {
    if (current && Object.prototype.hasOwnProperty.call(current, key)) {
      next[key] = current[key]
    }
  }

  // 净化可能剔除非法的历史遗留值（如排除键携带旧版脏数据），
  // 缺失的键必须以默认值补齐，保证 settings 对象形状完整
  const sanitized = sanitizeSettings(next) as Record<string, any>
  data.settings = { ...defaultMap, ...sanitized } as typeof defaultSettings
  saveCategory('settings')
  return data.settings
}

export function initStore(): void {
  // 应用数据目录与存储根目录纳入删除保护
  registerProtectedPath(appDataDir)
  registerProtectedPath(rootDir)

  const loadedSettings = sanitizeSettings(readCategoryJson('settings', JSON.parse(JSON.stringify(defaultSettings))))

  // 语言设置是当前配置的一部分，不再视为历史遗留键；保留并持久化
  const legacyKeys: string[] = ['theme']
  let prunedLegacy = false
  for (const key of legacyKeys) {
    if (Object.prototype.hasOwnProperty.call(loadedSettings, key)) {
      delete (loadedSettings as Record<string, unknown>)[key]
      prunedLegacy = true
    }
  }

  data = {
    settings: loadedSettings,
    history: readCategoryJson('history', JSON.parse(JSON.stringify(defaults.history))),
    runtimeTasks: readCategoryJson('runtimeTasks', JSON.parse(JSON.stringify(defaults.runtimeTasks))),
    windowState: readCategoryJson('windowState', JSON.parse(JSON.stringify(defaults.windowState)))
  }

  const legacyScheduledTasksFile = join(appDataDir, 'scheduled-tasks.json')
  if (existsSync(legacyScheduledTasksFile)) {
    try {
      rmSync(legacyScheduledTasksFile, { force: true })
    } catch (error) {
      console.warn(rt('deleteFailedWithReason', { reason: (error as Error).message }))
    }
  }

  if (prunedLegacy) {
    saveCategory('settings')
  }

  if (!data.settings.saveDir || !data.settings.saveDir.trim()) {
    data.settings.saveDir = defaultDownloadDir
    saveCategory('settings')
  }
  if (!data.settings.tmpDir || !data.settings.tmpDir.trim()) {
    data.settings.tmpDir = defaultTmpDir
    saveCategory('settings')
  }
  if (!data.settings.logFilePath || !data.settings.logFilePath.trim()) {
    data.settings.logFilePath = defaultLogFilePath
    saveCategory('settings')
  }
  const logParent = dirname(data.settings.logFilePath || defaultLogFilePath)
  if (logParent && !existsSync(logParent)) {
    mkdirSync(logParent, { recursive: true })
  }
}

function getNestedValue(source: any, keys: string[]): any {
  let current = source
  for (const key of keys) {
    if (current == null) return undefined
    current = current[key]
  }
  return current
}

function setNestedValue(source: any, keys: string[], value: any): void {
  const lastKey = keys[keys.length - 1]
  if (!keys.every(isSafeObjectKey)) return

  let current = source
  for (let i = 0; i < keys.length - 1; i++) {
    const nextKey = keys[i]
    if (current[nextKey] == null || typeof current[nextKey] !== 'object') {
      current[nextKey] = {}
    }
    current = current[nextKey]
  }
  current[lastKey] = value
}

export function getStore() {
  return {
    get(key?: string): any {
      if (!key) return data
      const keys = key.split('.')
      const category = keys[0] as CategoryName
      if (!data[category]) return undefined
      if (keys.length === 1) return data[category]
      return getNestedValue(data[category], keys.slice(1))
    },
    set(key: string, value: any): void {
      const keys = key.split('.')
      const category = keys[0] as CategoryName
      if (!data[category]) {
        data[category] = {} as any
      }
      if (keys.length === 1) {
        data[category] = value
        saveCategory(category)
        return
      }
      const target = data[category]
      setNestedValue(target, keys.slice(1), value)
      saveCategory(category)
    }
  }
}
