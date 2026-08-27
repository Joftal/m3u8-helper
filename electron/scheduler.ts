import { getStore } from './store'
import { randomUUID } from 'crypto'
import cron from 'node-cron'
import { BrowserWindow } from 'electron'
import { startDownload } from './downloader'
import type { DownloadOptions } from '../src/types/download'
import { DEFAULT_LOCALE, normalizeLocale, type SupportedLocale } from '../src/constants/locales'
import { translateRuntimeMessage } from '../src/i18n'

interface ScheduledTask {
  id: string
  url: string
  cron: string
  enabled: boolean
  options: any
  timer: any
}

const activeTimers = new Map<string, ScheduledTask>()

function currentLocale(): SupportedLocale {
  try {
    const language = getStore().get('settings.language')
    return normalizeLocale(language, DEFAULT_LOCALE)
  } catch {
    return DEFAULT_LOCALE
  }
}

function rt(key: Parameters<typeof translateRuntimeMessage>[1], params?: Record<string, string>): string {
  return translateRuntimeMessage(currentLocale(), key, params)
}

/** 校验并净化渲染进程传入的定时任务数据，阻断恶意字段进入下载/删除链路 */
function assertValidScheduledInput(input: any): { url: string; cron: string; enabled: boolean; options: Record<string, any> } {
  if (!input || typeof input !== 'object') {
    throw new Error(rt('schedulerInputMustBeObject'))
  }

  const url = typeof input.url === 'string' ? input.url.trim() : ''
  if (!/^https?:\/\/.+/i.test(url)) {
    throw new Error(rt('schedulerUrlMustBeHttp'))
  }

  const cron = typeof input.cron === 'string' ? input.cron.trim() : ''
  const enabled = input.enabled !== false

  const rawOptions = input.options && typeof input.options === 'object' ? input.options : {}
  const options: Record<string, any> = {}
  for (const [key, value] of Object.entries(rawOptions)) {
    if (value == null) continue
    if (typeof value === 'string') {
      options[key] = value.slice(0, 4096)
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      options[key] = value
    } else if (Array.isArray(value)) {
      options[key] = value.filter((item) => typeof item === 'string').map((item) => (item as string).slice(0, 4096)).slice(0, 50)
    } else if (typeof value === 'object') {
      options[key] = value
    }
  }

  return { url, cron, enabled, options }
}

/** 为任务注册 cron 定时器；表达式非法或任务被禁用时返回 null */
function scheduleCronTask(task: Pick<ScheduledTask, 'cron' | 'enabled' | 'url' | 'options'>, mainWindow?: BrowserWindow | null): any {
  if (!task.enabled || !task.cron) return null

  try {
    if (!cron.validate(task.cron)) return null

    return cron.schedule(task.cron, () => {
      if (!task.enabled) return
      const options: Record<string, any> = { ...(task.options || {}) }
      if (!options.url) options.url = task.url
      startDownload(options as DownloadOptions, mainWindow ?? null)
    }, { timezone: 'local' })
  } catch {
    return null
  }
}

export function addScheduledTask(taskData: any, mainWindow?: BrowserWindow | null): any {
  const store = getStore()
  const validated = assertValidScheduledInput(taskData)
  const id = typeof taskData.id === 'string' && taskData.id.trim() && taskData.id.length <= 64
    ? taskData.id.trim()
    : randomUUID()
  const task = {
    id,
    url: validated.url,
    cron: validated.cron,
    enabled: validated.enabled,
    options: validated.options
  }

  const tasks = store.get('scheduledTasks') || []
  const index = tasks.findIndex((t: any) => t.id === id)
  if (index >= 0) tasks.splice(index, 1)
  tasks.push(task)
  store.set('scheduledTasks', tasks)

  const existing = activeTimers.get(id)
  if (existing?.timer) {
    existing.timer.stop()
    activeTimers.delete(id)
  }

  const timer = scheduleCronTask(task, mainWindow)
  if (timer) activeTimers.set(id, { ...task, timer })

  return task
}

/**
 * 应用启动时调用：从持久化数据恢复所有启用中的定时任务。
 * cron 表达式无效或已禁用的任务保留数据但跳过调度。
 */
export function initScheduler(mainWindow?: BrowserWindow | null): void {
  const store = getStore()
  const tasks = Array.isArray(store.get('scheduledTasks')) ? store.get('scheduledTasks') : []

  for (const persisted of tasks) {
    if (!persisted?.id) continue

    const timer = scheduleCronTask(persisted, mainWindow)
    if (timer) {
      activeTimers.set(persisted.id, { ...persisted, timer })
    } else {
      console.warn(rt('schedulerTaskSkipped', { id: String(persisted.id) }))
    }
  }
}

export function removeScheduledTask(id: string): boolean {
  const store = getStore()
  const tasks = store.get('scheduledTasks') || []
  const filtered = tasks.filter((t: any) => t.id !== id)
  store.set('scheduledTasks', filtered)

  const timer = activeTimers.get(id)
  if (timer?.timer) {
    timer.timer.stop()
  }
  activeTimers.delete(id)

  return true
}

export function getScheduledTasks(): any[] {
  const store = getStore()
  return store.get('scheduledTasks') || []
}
