import { getStore } from './store'
import { randomUUID } from 'crypto'
import cron from 'node-cron'
import { BrowserWindow } from 'electron'
import { startDownload } from './downloader'

interface ScheduledTask {
  id: string
  url: string
  cron: string
  enabled: boolean
  options: any
  timer: any
}

const activeTimers = new Map<string, ScheduledTask>()

export function addScheduledTask(taskData: any, mainWindow?: BrowserWindow | null): any {
  const store = getStore()
  const id = taskData.id || randomUUID()
  const task = {
    id,
    url: taskData.url,
    cron: taskData.cron,
    enabled: taskData.enabled ?? true,
    options: taskData.options || {}
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

  if (task.enabled && task.cron) {
    try {
      const timer = cron.schedule(task.cron, () => {
        if (!task.enabled) return
        if (task.options?.url || task.url) {
          startDownload(task.options || { url: task.url }, mainWindow ?? null)
        }
      }, { timezone: 'local' })
      activeTimers.set(id, { ...task, timer })
    } catch {
      // Ignore invalid cron strings; keep the task saved without scheduling.
    }
  }

  return task
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
