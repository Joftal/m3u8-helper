import { getStore } from './store'
import { randomUUID } from 'crypto'

interface ScheduledTask {
  id: string
  url: string
  cron: string
  enabled: boolean
  options: any
  timer: ReturnType<typeof setInterval> | null
}

const activeTimers = new Map<string, ScheduledTask>()

export function addScheduledTask(taskData: any): any {
  const store = getStore()
  const id = taskData.id || randomUUID()
  const task = {
    id,
    url: taskData.url,
    cron: taskData.cron,
    enabled: taskData.enabled ?? true,
    options: taskData.options || {}
  }

  // 保存到 store
  const tasks = store.get('scheduledTasks') || []
  tasks.push(task)
  store.set('scheduledTasks', tasks)

  return task
}

export function removeScheduledTask(id: string): boolean {
  const store = getStore()
  const tasks = store.get('scheduledTasks') || []
  const filtered = tasks.filter((t: any) => t.id !== id)
  store.set('scheduledTasks', filtered)

  // 停止定时器
  const timer = activeTimers.get(id)
  if (timer?.timer) {
    clearInterval(timer.timer)
  }
  activeTimers.delete(id)

  return true
}

export function getScheduledTasks(): any[] {
  const store = getStore()
  return store.get('scheduledTasks') || []
}
