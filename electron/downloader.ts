import { ChildProcess, spawn } from 'child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, promises as fsPromises } from 'fs'
import { BrowserWindow, nativeImage, Notification } from 'electron'
import { basename, dirname, join } from 'path'
import { getStore } from './store'
import { isAllowedRecursiveDeleteTarget } from './path-safety'
import { randomUUID } from 'crypto'
import { isRecordTaskOptions } from '../src/utils/recording'
import type { DownloadOptions } from '../src/types/download'
import type { AppSettings } from '../src/types/settings'

export interface DownloadTask {
  id: string
  url: string
  process: ChildProcess | null
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  progress: number
  speed: string
  downloadedSegments: number
  totalSegments: number
  downloadedBytes: number
  totalBytes: number
  etaSeconds: number
  currentFrameRate: number
  latestLog: string
  startTime: Date
  logs: string[]
}

const activeTasks = new Map<string, DownloadTask>()

/** 最近一次启动下载时使用的窗口引用，用于取消等无法传入窗口的路径发送事件 */
let activeMainWindow: BrowserWindow | null = null

/** runtime-tasks.json 落盘节流间隔：高频日志场景合并为每秒最多一次写入 */
const PERSIST_INTERVAL_MS = 1000
/** download:progress 事件最小发送间隔（最新值胜出），避免逐行日志触发渲染端重绘风暴 */
const PROGRESS_SEND_INTERVAL_MS = 200
/** 主进程单任务内存日志上限：与时长/日志量脱钩，持久化快照仍取最后 200 条 */
const MAX_TASK_LOG_LINES = 500

let persistTimer: ReturnType<typeof setTimeout> | null = null

function appendTaskLog(task: DownloadTask & Record<string, any>, line: string): void {
  task.logs.push(line)
  if (task.logs.length > MAX_TASK_LOG_LINES) {
    task.logs.splice(0, task.logs.length - MAX_TASK_LOG_LINES)
  }
}

function splitCustomArgs(raw: string): string[] {
  if (!raw) return []

  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaped = false

  for (const char of raw) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }

    if (char === '\\' && quote === '"') {
      escaped = true
      continue
    }

    if (char === quote) {
      quote = null
      continue
    }

    if ((char === '"' || char === "'") && !quote) {
      quote = char
      continue
    }

    if (/\s/.test(char) && !quote) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }

    current += char
  }

  if (current) {
    tokens.push(current)
  }

  return tokens
}

/** 系统通知图标：与窗口图标同源；文件缺失时 createFromPath 返回空图，自动回退系统默认 */
const NOTIFICATION_ICON = nativeImage.createFromPath(join(__dirname, '../../resources/icon.png'))

/**
 * 录制任务终态系统通知：
 * - 失败必须提示 —— 后台挂机录制的异常终止对用户不可见，且已录内容已按策略保留；
 * - 取消由用户主动触发（界面已有反馈），不重复打扰；
 * - 主窗口聚焦时跳过（渲染端 toast 已覆盖），仅托盘/后台场景弹系统通知。
 */
function notifyRecordFinished(task: DownloadTask & Record<string, any>): void {
  if (!isRecordTaskOptions(task.options) || task.status === 'cancelled') return
  try {
    if (!Notification.isSupported()) return
    if (activeMainWindow?.isFocused()) return
    const name = task.saveName || task.url
    const body = task.status === 'failed'
      ? `「${name}」录制异常终止，已录内容已保留`
      : `「${name}」录制完成`
    new Notification({ title: 'm3u8-helper · 录制任务', body, icon: NOTIFICATION_ICON }).show()
  } catch {
    // 通知属尽力而为的增强能力，失败不影响主流程
  }
}

/**
 * 任务统一收尾：状态判定 → 通知渲染进程 → 清理产物与定时器 → 移除条目。
 *
 * 所有退出路径（正常 close / 进程错误 / 无进程取消）都收敛到这里，
 * 保证取消和异常场景同样会发出 download:complete，且不残留 speedTimer。
 */
function finalizeTask(taskId: string, exitCode: number | null): void {
  const task = activeTasks.get(taskId) as (DownloadTask & Record<string, any>) | undefined
  if (!task) return

  if (task.status === 'cancelled') {
    task.progress = Math.min(100, Math.max(0, task.progress || 0))
    task.latestLog = task.latestLog || '任务已取消'
  } else if (exitCode === 0) {
    task.status = 'completed'
    task.progress = 100
    if (task.totalSegments > 0 && task.downloadedSegments === 0) {
      task.downloadedSegments = task.totalSegments
    }
    if ((task.totalBytes || 0) > 0 && (task.downloadedBytes || 0) === 0) {
      task.downloadedBytes = task.totalBytes
    }
  } else {
    task.status = 'failed'
    task.latestLog = task.latestLog || `进程异常退出（代码 ${exitCode ?? 'unknown'}）`
  }

  activeMainWindow?.webContents.send('download:complete', {
    taskId,
    status: task.status,
    code: exitCode,
    progress: task.progress,
    speed: task.speed,
    downloadedSegments: task.downloadedSegments,
    totalSegments: task.totalSegments,
    downloadedBytes: task.downloadedBytes,
    totalBytes: task.totalBytes,
    etaSeconds: task.etaSeconds,
    currentFrameRate: task.currentFrameRate,
    latestLog: task.latestLog
  })

  // 产物清理策略（集中规则表，避免各终态行为漂移）：
  // - completed：仅移除 GUI 创建的隔离临时目录壳（CLI 的 --del-after-done 只清文件不清目录）
  // - cancelled：用户主动停止，内容视为有效 → 保留全部产物，仅补删临时目录壳
  // - failed + 录制任务：保留 saveDir 中已录制的成品 —— 实时合并的 MKV 异常中断仍可播放，
  //   这正是录制固定 MKV 封装的核心承诺；只清理分片碎片所在的临时目录
  // - failed + 普通下载：维持原状，清理全部产物
  const tmpDir: string = (task as any).tmpDir || ''
  const isRecordTask = isRecordTaskOptions((task as any).options)
  const removeTmpShell = () => {
    if (tmpDir && basename(tmpDir) === `task-${taskId}`) {
      removeGuarded(tmpDir, [], [])
    }
  }
  if (task.status === 'completed' || task.status === 'cancelled' || isRecordTask) {
    removeTmpShell()
  } else {
    deleteTaskArtifacts(taskId)
  }

  notifyRecordFinished(task)

  if (task._speedTimer) {
    clearInterval(task._speedTimer)
    task._speedTimer = null
  }
  task.process = null
  activeTasks.delete(taskId)
  flushRuntimeTasks()
}

function formatBytesPerSecond(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '0 KB/s'

  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  let value = bytesPerSecond
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  const precision = value >= 10 ? 1 : 2
  return `${value.toFixed(precision)} ${units[unitIndex]}`
}

/** 异步递归统计目录体积：磁盘扫描在 libuv 线程池执行，不阻塞主进程事件循环 */
async function getDirectorySizeAsync(target: string): Promise<number> {
  if (!target || !existsSync(target)) return 0

  try {
    const entries = await fsPromises.readdir(target, { withFileTypes: true })
    let total = 0

    for (const entry of entries) {
      const fullPath = join(target, entry.name)
      if (entry.isDirectory()) {
        total += await getDirectorySizeAsync(fullPath)
      } else if (entry.isFile()) {
        try {
          total += (await fsPromises.stat(fullPath)).size
        } catch {
          // ignore transient stat failures
        }
      }
    }

    return total
  } catch {
    return 0
  }
}

/**
 * 统计本任务可归属的磁盘体积：
 * - 自有临时目录 tmp/task-<taskId> 整体递归（P0 隔离改造后天然按任务划分）
 * - saveDir 顶层中文件名包含保存名词干的合并产物文件
 * 并发任务共享同一保存目录时不再互相计入对方增长，速度不再虚高。
 */
async function getTaskAttributableBytes(task: DownloadTask & Record<string, any>): Promise<number> {
  let total = 0

  const tmpDir: string = task.tmpDir || task.options?.tmpDir || ''
  if (tmpDir && tmpDir.trim()) {
    total += await getDirectorySizeAsync(tmpDir.trim())
  }

  const saveDir: string = task.saveDir || task.options?.saveDir || ''
  const saveName: string = task.saveName || task.options?.saveName || ''
  if (saveDir && saveDir.trim() && saveName) {
    const stem = basename(saveName)
    try {
      const entries = await fsPromises.readdir(saveDir.trim(), { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.includes(stem)) continue
        try {
          total += (await fsPromises.stat(join(saveDir.trim(), entry.name))).size
        } catch {
          // ignore transient stat failures
        }
      }
    } catch {
      // ignore transient readdir failures
    }
  }

  return total
}

function buildRuntimeSnapshot() {
  return Array.from(activeTasks.values()).map((task) => ({
    id: task.id,
    url: task.url,
    status: task.status,
    progress: task.progress,
    speed: task.speed,
    downloadedSegments: task.downloadedSegments,
    totalSegments: task.totalSegments,
    downloadedBytes: task.downloadedBytes,
    totalBytes: task.totalBytes,
    etaSeconds: task.etaSeconds,
    currentFrameRate: task.currentFrameRate,
    latestLog: task.latestLog,
    startTime: task.startTime instanceof Date ? task.startTime.toISOString() : task.startTime,
    logs: task.logs.slice(-200),
    saveName: (task as any).saveName ?? '',
    saveDir: (task as any).saveDir ?? '',
    options: (task as any).options ?? {}
  }))
}

/** 立即落盘并撤销挂起的节流定时器。用于任务启动/终结等生命周期边界，保证崩溃安全 */
function flushRuntimeTasks(): void {
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  getStore().set('runtimeTasks', buildRuntimeSnapshot())
}

/** 常规持久化入口（日志行、测速 tick）：尾沿节流为每秒最多一次写入 */
function persistRuntimeTasks(): void {
  if (persistTimer) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    flushRuntimeTasks()
  }, PERSIST_INTERVAL_MS)
}

/** 向渲染进程发送任务进度快照 */
function sendProgressEvent(taskId: string, task: DownloadTask, mainWindow: BrowserWindow | null): void {
  mainWindow?.webContents.send('download:progress', {
    taskId,
    progress: task.progress,
    speed: task.speed,
    downloadedSegments: task.downloadedSegments,
    totalSegments: task.totalSegments,
    downloadedBytes: task.downloadedBytes,
    totalBytes: task.totalBytes,
    etaSeconds: task.etaSeconds,
    currentFrameRate: task.currentFrameRate,
    latestLog: task.latestLog,
    status: task.status
  })
}

/** 非负有限数值收敛，非法值回退 0（对齐 IPC 层历史记录净化标准） */
function toNonNegativeNumber(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

/**
 * 应用启动时调用：
 * 1. 上次退出时仍处于运行中的任务进程已随应用结束，将其标记为失败并注明原因，
 *    避免前端出现永远"进行中"的僵尸任务；
 * 2. 同步为这些中断任务补写失败历史——它们不会经过 complete 事件，
 *    若不在此处落库，历史页将永远缺失中断痕迹。
 */
export function interruptOrphanedRuntimeTasks(): void {
  const store = getStore()
  const tasks = store.get('runtimeTasks')
  if (!Array.isArray(tasks)) return

  let changed = false
  let historyChanged = false
  const nowIso = new Date().toISOString()
  const history: any[] = Array.isArray(store.get('history')) ? store.get('history') : []

  for (const task of tasks) {
    if (!task || (task.status !== 'running' && task.status !== 'pending')) continue

    task.status = 'failed'
    task.latestLog = '应用重启导致下载中断，可重试继续'
    changed = true

    // 补写失败历史（按 id 去重，避免重复中断产生多条）
    // 字段截断与 ipc-handlers.sanitizeHistoryRecord 保持同一标准
    const url = typeof task.url === 'string' ? task.url.trim().slice(0, 4096) : ''
    if (!url || !/^https?:\/\//i.test(url)) continue
    if (history.some((h) => h?.id === task.id)) continue

    const startIso = typeof task.startTime === 'string' && !Number.isNaN(Date.parse(task.startTime))
      ? task.startTime
      : nowIso
    history.unshift({
      id: String(task.id ?? '').trim().slice(0, 64),
      url,
      saveName: String(task.saveName ?? '').slice(0, 512),
      status: 'failed',
      startTime: startIso,
      endTime: nowIso,
      fileSize: toNonNegativeNumber(task.downloadedBytes),
      outputPath: String(task.saveDir ?? '').slice(0, 1024),
      duration: Math.max(0, Math.floor((Date.now() - Date.parse(startIso)) / 1000))
    })
    if (history.length > 500) history.length = 500
    historyChanged = true
  }

  if (changed) {
    store.set('runtimeTasks', tasks)
  }
  if (historyChanged) {
    store.set('history', history)
  }
}

/**
 * 应用启动时清扫遗留的空隔离临时目录：
 * - 仅处理基 tmp 目录下名为 task-<uuid> 的一级子目录（与 startDownload 的派生命名严格匹配）
 * - 只删除完全为空的目录壳；读取失败或仍有任何内容（含隐藏文件）一律保留
 * 兼容旧版本 cancelled 任务跳过清理产生的空壳残留，防止长期累积。
 */
export function sweepOrphanedEmptyTmpDirs(): void {
  try {
    const store = getStore()
    const settings = store.get('settings') as AppSettings
    const baseTmpDir = (settings.tmpDir || '').trim() || join(dirname(process.execPath), 'tmp')
    if (!existsSync(baseTmpDir)) return

    // 基目录本身先过安全校验，杜绝异常配置下的误操作面
    const verdict = isAllowedRecursiveDeleteTarget(baseTmpDir)
    if (!verdict.ok || !verdict.path) return

    for (const entry of readdirSync(verdict.path, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^task-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entry.name)) continue
      const full = join(verdict.path, entry.name)
      try {
        if (readdirSync(full).length > 0) continue
        rmSync(full, { force: true })
      } catch {
        // 单个目录清扫失败不影响其余条目
      }
    }
  } catch {
    // 清扫属尽力而为的维护能力，失败不影响启动流程
  }
}

export function startDownload(options: DownloadOptions, mainWindow: BrowserWindow | null): { taskId: string; options: DownloadOptions } {
  activeMainWindow = mainWindow
  const store = getStore()
  const settings = store.get('settings') as AppSettings
  const taskId = randomUUID()

  const requestUrl = typeof options.url === 'string' ? options.url.trim() : ''
  if (!requestUrl) {
    throw new Error('下载地址不能为空')
  }
  // 仅接受 http(s)：与 scheduler / 历史记录净化保持同一标准，阻断 file:、ftp: 等协议流入 CLI 参数
  if (!/^https?:\/\//i.test(requestUrl)) {
    throw new Error('下载地址必须是 http(s) 链接')
  }

  const exePath = settings.exePath
  if (!exePath) {
    throw new Error('未配置 N_m3u8DL-RE.exe 路径，请在设置中配置')
  }
  if (!existsSync(exePath)) {
    throw new Error(`N_m3u8DL-RE.exe 路径不存在: ${exePath}`)
  }

  const ensureDir = (value?: string) => {
    if (!value) return
    const normalized = value.trim()
    if (!normalized || existsSync(normalized)) return
    mkdirSync(normalized, { recursive: true })
  }

  const executableRoot = dirname(process.execPath)
  const defaultSaveDir = join(executableRoot, 'downloads')
  const defaultTmpDir = join(executableRoot, 'tmp')
  const defaultLogFilePath = join(executableRoot, 'logs', 'N_m3u8DL-RE.log')

  // 目录解析仅在本任务内生效，不回写全局设置，避免单次任务参数污染全局配置
  const effectiveSaveDir = options.saveDir || settings.saveDir || defaultSaveDir
  const baseTmpDir = options.tmpDir || settings.tmpDir || defaultTmpDir
  // 每个任务使用独立的临时子目录：并发任务互不干扰，且清理时只删除本任务目录
  const effectiveTmpDir = join(baseTmpDir, `task-${taskId}`)
  const effectiveLogFilePath = options.logFilePath || settings.logFilePath || defaultLogFilePath
  // url 一并归一化为 trim 后的值；tmpDir 覆盖为按任务派生的隔离目录
  options = { ...options, url: requestUrl, saveDir: effectiveSaveDir, tmpDir: effectiveTmpDir, logFilePath: effectiveLogFilePath }

  ensureDir(effectiveSaveDir)
  ensureDir(baseTmpDir)
  ensureDir(effectiveTmpDir)
  if (effectiveLogFilePath) {
    const parent = effectiveLogFilePath.split(/[/\\]/).slice(0, -1).join('/') || '.'
    ensureDir(parent)
  }

  // 构建命令行参数
  const args = buildArgs(options, settings)

  const task: DownloadTask & { saveName?: string; saveDir?: string; tmpDir?: string; options?: any } = {
    id: taskId,
    url: options.url,
    saveName: options.saveName || '',
    saveDir: effectiveSaveDir,
    tmpDir: effectiveTmpDir,
    process: null,
    status: 'pending',
    progress: 0,
    speed: '0 KB/s',
    downloadedSegments: 0,
    totalSegments: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    etaSeconds: 0,
    currentFrameRate: 0,
    latestLog: '',
    startTime: new Date(),
    logs: [],
    options: options
  }

  activeTasks.set(taskId, task)
  flushRuntimeTasks()

  // 启动子进程
  const child = spawn(exePath, args, {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  })

  task.process = child
  task.status = 'running'

  const speedTimer = setInterval(async () => {
    const activeTask = activeTasks.get(taskId) as (DownloadTask & Record<string, any>) | undefined
    if (!activeTask || activeTask.status !== 'running') return
    if (activeTask._measuring) return
    activeTask._measuring = true

    try {
      const currentBytes = await getTaskAttributableBytes(activeTask)
      // 测量期间任务可能已结束
      const latest = activeTasks.get(taskId) as (DownloadTask & Record<string, any>) | undefined
      if (!latest || latest.status !== 'running') return

      const now = Date.now()
      const elapsedSeconds = Math.max((now - ((latest as any)._lastSpeedAt ?? now)) / 1000, 1)
      const deltaBytes = Math.max(currentBytes - ((latest as any)._lastSpeedBytes ?? currentBytes), 0)
      const bytesPerSecond = deltaBytes / elapsedSeconds

      latest.speed = formatBytesPerSecond(bytesPerSecond)
      latest.downloadedBytes = Math.max(latest.downloadedBytes, currentBytes)
      latest._lastSpeedBytes = currentBytes
      latest._lastSpeedAt = now

      sendProgressEvent(taskId, latest, mainWindow)
      persistRuntimeTasks()
    } finally {
      const ref = activeTasks.get(taskId) as (DownloadTask & Record<string, any>) | undefined
      if (ref) ref._measuring = false
    }
  }, 1000)
  ;(task as any)._speedTimer = speedTimer

  // 解析 stdout
  let stdoutBuffer = ''
  child.stdout?.on('data', (data: Buffer) => {
    stdoutBuffer += data.toString()
    const lines = stdoutBuffer.split(/\r?\n/)
    stdoutBuffer = lines.pop() || ''

    for (const line of lines) {
      if (line.trim()) {
        parseOutput(taskId, line, mainWindow)
      }
    }
  })

  // 解析 stderr
  let stderrBuffer = ''
  child.stderr?.on('data', (data: Buffer) => {
    stderrBuffer += data.toString()
    const lines = stderrBuffer.split(/\r?\n/)
    stderrBuffer = lines.pop() || ''

    for (const line of lines) {
      if (line.trim()) {
        parseOutput(taskId, line, mainWindow)
      }
    }
  })

  // 任务结束（正常退出或被终止）：统一收尾
  child.on('close', (code) => {
    finalizeTask(taskId, code)
  })

  child.on('error', (err) => {
    const task = activeTasks.get(taskId)
    if (task && task.status !== 'cancelled') {
      task.status = 'failed'
      task.latestLog = `[ERROR] ${err.message}`
    }
    if (task) {
      appendTaskLog(task, `[ERROR] ${err.message}`)
    }
    activeMainWindow?.webContents.send('download:log', {
      taskId,
      level: 'ERROR',
      message: err.message
    })
    // 进程未能启动时不会触发 close，这里直接统一收尾，避免 speedTimer 泄漏
    finalizeTask(taskId, null)
  })

  // 回传主进程解析后的生效参数（含按任务派生的隔离 tmpDir），
  // 渲染端据此建立任务记录，保证后续删除/重试链路拿到权威路径而非基目录
  return { taskId, options }
}

/** 当前处于运行中/等待中的录制任务数（供关闭拦截等使用） */
export function countActiveRecordTasks(): number {
  let count = 0
  for (const task of activeTasks.values()) {
    if ((task.status === 'running' || task.status === 'pending') && isRecordTaskOptions((task as any).options)) {
      count += 1
    }
  }
  return count
}

/**
 * 取消全部活跃录制任务（应用退出前的收尾路径）。
 * 先置 cancelled 再杀进程树，保证 close 收尾走"保留产物"路径。
 */
export function cancelAllRecordTasks(): void {
  for (const [id, task] of Array.from(activeTasks.entries())) {
    if ((task.status === 'running' || task.status === 'pending') && isRecordTaskOptions((task as any).options)) {
      cancelDownload(id)
    }
  }
}

export function cancelDownload(taskId: string): boolean {
  const task = activeTasks.get(taskId)
  if (!task) return false

  // 幂等保护：已进入取消流程的任务直接返回成功。
  // 对同一 pid 重复 taskkill 在 Windows 上有 PID 复用误杀无关进程树的风险。
  if (task.status === 'cancelled') return true

  task.status = 'cancelled'
  task.latestLog = task.latestLog || '任务已取消'

  if (task.process) {
    task.process.kill('SIGTERM')

    // Windows 上强制杀死；随后 close 事件触发 finalizeTask 统一收尾
    // （发送 cancelled 完成事件、清理产物与定时器）
    if (task.process.pid) {
      try {
        spawn('taskkill', ['/pid', String(task.process.pid), '/T', '/F'])
      } catch {}
    }
  } else {
    // 进程不存在（如尚未成功启动）：直接收尾
    finalizeTask(taskId, null)
  }

  return true
}

const ARTIFACT_SUFFIXES = [
  '.part', '.tmp', '.download', '.m3u8', '.meta.json', '.json',
  '.ts', '.mp4', '.mkv', '.mp3', '.aac'
]

interface DeleteOutcome {
  success: boolean
  deleted: string[]
  skipped: Array<{ path: string; reason: string }>
}

/** 受安全校验约束的递归删除：任何未通过校验的路径都会被记入 skipped 而不是删除 */
function removeGuarded(target: unknown, deleted: string[], skipped: DeleteOutcome['skipped']): void {
  const verdict = isAllowedRecursiveDeleteTarget(target)
  if (!verdict.ok || !verdict.path) {
    skipped.push({ path: String(target ?? ''), reason: verdict.reason || '路径校验未通过' })
    return
  }
  if (!existsSync(verdict.path)) return

  try {
    rmSync(verdict.path, { recursive: true, force: true })
    deleted.push(verdict.path)
  } catch (err) {
    skipped.push({ path: verdict.path, reason: `删除失败: ${(err as Error).message}` })
  }
}

/** 共享临时目录的保守清理：仅移除文件名包含任务名的条目，绝不整体删除目录本身 */
function cleanupSharedTmpDir(tmpDir: string, stem: string, deleted: string[], skipped: DeleteOutcome['skipped']): void {
  const verdict = isAllowedRecursiveDeleteTarget(tmpDir)
  if (!verdict.ok || !verdict.path) {
    skipped.push({ path: String(tmpDir ?? ''), reason: verdict.reason || '路径校验未通过' })
    return
  }

  const dir = verdict.path
  if (!existsSync(dir)) return

  let entries: Array<{ name: string; isDirectory: () => boolean }>
  try {
    entries = readdirSync(dir, { withFileTypes: true }) as any
  } catch {
    return
  }

  for (const entry of entries) {
    if (!stem || !entry.name.includes(stem)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      removeGuarded(full, deleted, skipped)
    } else {
      try {
        rmSync(full, { force: true })
        deleted.push(full)
      } catch {
        skipped.push({ path: full, reason: '删除失败' })
      }
    }
  }
}

/**
 * 删除任务产物。
 *
 * 安全策略：
 * - 活跃任务记录中的 saveDir/saveName/tmpDir/outputPath 为权威数据，
 *   渲染进程传入的 taskInfo 仅在缺失时兜底，且只接受白名单字段
 * - 所有整目录递归删除必须通过 path-safety 校验
 * - 新任务的 tmpDir 是 <base>/task-<taskId> 隔离目录，可整体删除；
 *   历史共享 tmpDir 只做按名称匹配的保守清理，绝不整体删除
 */
export function deleteTaskArtifacts(taskId: string, taskInfo: any = {}): DeleteOutcome {
  const task = activeTasks.get(taskId) as (DownloadTask & Record<string, any>) | undefined
  const info = sanitizeTaskInfo(taskInfo)
  const opts: Record<string, any> = (task?.options ?? info.options ?? {}) as Record<string, any>

  const firstString = (...values: unknown[]): string => {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
    return ''
  }

  const saveDir = firstString(task?.saveDir, info.saveDir as string, opts.saveDir)
  const saveName = firstString(task?.saveName, info.saveName as string, opts.saveName)
  const tmpDir = firstString(task?.tmpDir, info.tmpDir as string, opts.tmpDir)
  const outputPath = firstString(task?.outputPath, info.outputPath as string, opts.outputPath)

  const deleted: string[] = []
  const skipped: DeleteOutcome['skipped'] = []

  if (outputPath) {
    removeGuarded(outputPath, deleted, skipped)
  }

  if (tmpDir) {
    if (basename(tmpDir) === `task-${taskId}`) {
      removeGuarded(tmpDir, deleted, skipped)
    } else {
      cleanupSharedTmpDir(tmpDir, basename(saveName), deleted, skipped)
    }
  }

  if (saveDir && saveName) {
    const baseName = basename(saveName)
    if (baseName && baseName !== '.' && baseName !== '..') {
      const stem = baseName.includes('.') ? baseName.slice(0, baseName.lastIndexOf('.')) : baseName
      const exactCandidates = new Set<string>([baseName])
      for (const suffix of ARTIFACT_SUFFIXES) {
        exactCandidates.add(`${stem}${suffix}`)
        exactCandidates.add(`${baseName}${suffix}`)
      }
      for (const fileName of exactCandidates) {
        const candidate = join(saveDir, fileName)
        if (!candidate.startsWith(saveDir)) continue
        if (!existsSync(candidate)) continue
        try {
          rmSync(candidate, { force: true })
          deleted.push(candidate)
        } catch {
          skipped.push({ path: candidate, reason: '删除失败' })
        }
      }
    }
  }

  if (task) {
    activeTasks.delete(taskId)
    flushRuntimeTasks()
  }

  return { success: true, deleted, skipped }
}

/** 渲染进程传入的任务信息只允许携带白名单字段 */
export function sanitizeTaskInfo(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {}

  const out: Record<string, unknown> = {}
  const stringKeys = ['saveDir', 'saveName', 'tmpDir', 'outputPath'] as const
  for (const key of stringKeys) {
    const value = (raw as Record<string, unknown>)[key]
    if (typeof value === 'string' && value.trim()) {
      out[key] = value.trim()
    }
  }
  const options = (raw as Record<string, unknown>).options
  if (options && typeof options === 'object') {
    out.options = options
  }
  return out
}

/**
 * 构建 N_m3u8DL-RE 命令行参数
 *
 * CLI 参数分类（来自 CommandInvoker.cs）：
 * - Flag 类（无值）：--auto-select, --sub-only, --binary-merge, -mt, --skip-merge,
 *   --skip-download, --no-log, --no-date-info, --append-url-params, --mp4-real-time-decryption,
 *   --allow-hls-multi-ext-map, --live-perform-as-vod, --live-real-time-merge,
 *   --live-keep-segments, --live-pipe-mux, --live-fix-vtt-by-audio, --use-ffmpeg-concat-demuxer
 * - Bool with default true（需要显式 false）：--del-after-done, --auto-subtitle-fix,
 *   --check-segments-count, --write-meta-json, --use-system-proxy
 * - Bool with default false（flag 即 true）：--force-ansi-console, --no-ansi-color, --disable-update-check
 * - 值参数：--thread-count N, --download-retry-count N, --http-request-timeout N,
 *   --save-dir PATH, --save-name NAME, --save-pattern PATTERN, --tmp-dir PATH,
 *   --log-file-path PATH, --log-level LEVEL, --base-url URL, -H HEADER, --key KEY,
 *   --custom-hls-method METHOD, --custom-hls-key KEY, --custom-hls-iv IV,
 *   --decryption-engine ENGINE, --ffmpeg-binary-path PATH, --decryption-binary-path PATH,
 *   -R SPEED, --custom-proxy URL, --custom-range RANGE, --ad-keyword REG,
 *   --live-record-limit HH:mm:ss, --live-wait-time SEC, --live-take-count NUM,
 *   -sv OPTIONS, -sa OPTIONS, -ss OPTIONS, -dv OPTIONS, -da OPTIONS, -ds OPTIONS,
 *   -M OPTIONS, --mux-import OPTIONS
 */
function buildArgs(options: DownloadOptions, settings: AppSettings): string[] {
  const args: string[] = []

  // ========== 输入 URL（必须是第一个参数） ==========
  args.push(options.url)

  // ========== 文件管理 ==========
  // --save-dir
  if (options.saveDir || settings.saveDir) {
    args.push('--save-dir', options.saveDir || settings.saveDir)
  }
  // --save-name
  if (options.saveName) {
    args.push('--save-name', options.saveName)
  }
  // --save-pattern
  if (options.savePattern || settings.savePattern) {
    args.push('--save-pattern', options.savePattern || settings.savePattern)
  }
  // --tmp-dir
  if (options.tmpDir || settings.tmpDir) {
    args.push('--tmp-dir', options.tmpDir || settings.tmpDir)
  }
  // --log-file-path
  if (options.logFilePath || settings.logFilePath) {
    args.push('--log-file-path', options.logFilePath || settings.logFilePath)
  }
  // --base-url
  if (options.baseUrl || settings.baseUrl) {
    args.push('--base-url', options.baseUrl || settings.baseUrl)
  }

  // ========== 下载控制 ==========
  // --thread-count (默认: CPU线程数)
  const threads = options.threadCount ?? settings.threadCount
  if (threads) {
    args.push('--thread-count', String(threads))
  }
  // --download-retry-count (默认: 3)
  const retryCount = options.downloadRetryCount ?? settings.downloadRetryCount
  if (retryCount !== undefined && retryCount !== null) {
    args.push('--download-retry-count', String(retryCount))
  }
  // --http-request-timeout (默认: 100)
  const timeout = options.httpRequestTimeout ?? settings.httpRequestTimeout
  if (timeout !== undefined && timeout !== null) {
    args.push('--http-request-timeout', String(timeout))
  }

  // ========== 流选择 ==========
  // --auto-select (flag, 默认 false)
  if (options.autoSelect ?? settings.autoSelect) {
    args.push('--auto-select')
  }
  // --sub-only (flag, 默认 false)
  if (options.subOnly) {
    args.push('--sub-only')
  }
  // -sv / -sa / -ss (流选择过滤器)
  if (options.videoFilter) {
    args.push('-sv', options.videoFilter)
  }
  if (options.audioFilter) {
    args.push('-sa', options.audioFilter)
  }
  if (options.subtitleFilter) {
    args.push('-ss', options.subtitleFilter)
  }
  // -dv / -da / -ds (流排除过滤器)
  if (options.dropVideoFilter) {
    args.push('-dv', options.dropVideoFilter)
  }
  if (options.dropAudioFilter) {
    args.push('-da', options.dropAudioFilter)
  }
  if (options.dropSubtitleFilter) {
    args.push('-ds', options.dropSubtitleFilter)
  }

  // ========== 合并控制 ==========
  // --skip-merge (flag, 默认 false)
  if (options.skipMerge ?? settings.skipMerge) {
    args.push('--skip-merge')
  }
  // --binary-merge (flag, 默认 false)
  if (options.binaryMerge ?? settings.binaryMerge) {
    args.push('--binary-merge')
  }
  // --use-ffmpeg-concat-demuxer (flag, 默认 false)
  if (options.useFFmpegConcatDemuxer) {
    args.push('--use-ffmpeg-concat-demuxer')
  }
  // --check-segments-count (bool, 默认 true, 需显式 false)
  const checkSegs = options.checkSegmentsCount ?? settings.checkSegmentsCount
  if (checkSegs === false) {
    args.push('--check-segments-count', 'false')
  }

  // ========== 混流 ==========
  // -M / --mux-after-done
  const muxFormat = options.muxFormat || settings.muxFormat
  const muxAfterDone = options.muxAfterDone ?? settings.muxAfterDone ?? Boolean(muxFormat)
  if (muxAfterDone) {
    const muxer = options.muxMuxer || settings.muxMuxer || 'ffmpeg'
    const muxSkipSub = options.muxSkipSub ?? settings.muxSkipSub
    const muxKeepFiles = options.muxKeepFiles ?? settings.muxKeepFiles
    let muxArgs = `format=${muxFormat || 'mp4'}:muxer=${muxer}`
    if (muxSkipSub) muxArgs += ':skip_sub=true'
    if (muxKeepFiles) muxArgs += ':keep=true'
    args.push('-M', muxArgs)
  }
  // --mux-import
  if (options.muxImports && options.muxImports.length > 0) {
    for (const imp of options.muxImports) {
      args.push('--mux-import', imp)
    }
  }

  // ========== 清理 ==========
  // --del-after-done (bool, 默认 true, 需显式 false)
  const delAfterDone = options.delAfterDone ?? settings.delAfterDone
  if (delAfterDone === false) {
    args.push('--del-after-done', 'false')
  }
  // --no-date-info (flag, 默认 false)
  if (options.noDateInfo) {
    args.push('--no-date-info')
  }

  // ========== 日志 ==========
  // --no-log (flag, 默认 false)
  if (options.noLog) {
    args.push('--no-log')
  }
  // --log-level (默认 INFO)
  const logLevel = options.logLevel || settings.logLevel || 'INFO'
  args.push('--log-level', logLevel)

  // ========== 元数据 ==========
  // --write-meta-json (bool, 默认 true, 需显式 false)
  const writeMeta = options.writeMetaJson ?? settings.writeMetaJson
  if (writeMeta === false) {
    args.push('--write-meta-json', 'false')
  }
  // --append-url-params (flag, 默认 false)
  if (options.appendUrlParams) {
    args.push('--append-url-params')
  }

  // ========== 并发 ==========
  // -mt / --concurrent-download (flag, 默认 false)
  if (options.concurrentDownload ?? settings.concurrentDownload) {
    args.push('-mt')
  }

  // ========== 字幕 ==========
  // --sub-format (默认 SRT)
  if (options.subFormat || settings.subFormat) {
    args.push('--sub-format', options.subFormat || settings.subFormat)
  }
  // --auto-subtitle-fix (bool, 默认 true, 需显式 false)
  const subFix = options.autoSubtitleFix ?? settings.autoSubtitleFix
  if (subFix === false) {
    args.push('--auto-subtitle-fix', 'false')
  }

  // ========== 限速 ==========
  // -R / --max-speed
  const maxSpeed = options.maxSpeed || settings.maxSpeed
  if (maxSpeed) {
    args.push('-R', maxSpeed)
  }

  // ========== 网络 ==========
  // --header / -H
  const headers = options.headers || settings.headers
  if (headers && typeof headers === 'object') {
    for (const [key, value] of Object.entries(headers)) {
      if (value) args.push('-H', `${key}: ${value}`)
    }
  }
  // --use-system-proxy (bool, 默认 true, 需显式 false)
  if (options.proxy || settings.proxy) {
    args.push('--custom-proxy', options.proxy || settings.proxy)
    args.push('--use-system-proxy', 'false')
  } else if (!(options.useSystemProxy ?? settings.useSystemProxy)) {
    args.push('--use-system-proxy', 'false')
  }

  // ========== 解密 ==========
  // --key
  if (options.keys && options.keys.length > 0) {
    for (const key of options.keys) {
      args.push('--key', key)
    }
  }
  // --key-text-file
  if (options.keyTextFile || settings.keyTextFile) {
    args.push('--key-text-file', options.keyTextFile || settings.keyTextFile)
  }
  // --decryption-engine (默认 MP4DECRYPT)
  if (options.decryptionEngine || settings.decryptionEngine) {
    args.push('--decryption-engine', options.decryptionEngine || settings.decryptionEngine)
  }
  // --decryption-binary-path
  const mp4decryptPath = options.mp4decryptPath || settings.mp4decryptPath
  if (mp4decryptPath) {
    args.push('--decryption-binary-path', mp4decryptPath)
  }
  // --mp4-real-time-decryption (flag, 默认 false)
  if (options.mp4RealTimeDecryption) {
    args.push('--mp4-real-time-decryption')
  }
  // --custom-hls-method / --custom-hls-key / --custom-hls-iv
  const hlsMethod = options.customHlsMethod || settings.customHlsMethod
  if (hlsMethod) {
    args.push('--custom-hls-method', hlsMethod)
  }
  const hlsKey = options.customHlsKey || settings.customHlsKey
  if (hlsKey) {
    args.push('--custom-hls-key', hlsKey)
  }
  const hlsIv = options.customHlsIv || settings.customHlsIv
  if (hlsIv) {
    args.push('--custom-hls-iv', hlsIv)
  }

  // ========== 工具路径 ==========
  // --ffmpeg-binary-path
  const ffmpegPath = options.ffmpegPath || settings.ffmpegPath
  if (ffmpegPath) {
    args.push('--ffmpeg-binary-path', ffmpegPath)
  }

  // ========== 范围和广告 ==========
  // --custom-range
  const customRange = options.customRange || settings.customRange
  if (customRange) {
    args.push('--custom-range', customRange)
  }
  // --ad-keyword
  const adKw = options.adKeywords || settings.adKeywords
  if (adKw && adKw.length > 0) {
    for (const kw of adKw) {
      args.push('--ad-keyword', kw)
    }
  }

  // ========== 任务调度 ==========
  // --task-start-at
  if (options.taskStartAt) {
    args.push('--task-start-at', options.taskStartAt)
  }
  // --allow-hls-multi-ext-map (flag, 默认 false)
  if (options.allowHlsMultiExtMap ?? settings.allowHlsMultiExtMap) {
    args.push('--allow-hls-multi-ext-map')
  }

  // ========== 直播录制 ==========
  // --live-perform-as-vod (flag, 默认 false)
  if (options.livePerformAsVod) {
    args.push('--live-perform-as-vod')
  }
  // --live-real-time-merge (flag, 默认 false)
  if (options.liveRealTimeMerge) {
    args.push('--live-real-time-merge')
  }
  // --live-keep-segments (flag, 默认 true)
  // CLI flag 类型：传了就是 true，不传也是默认 true，无法设为 false
  // 此选项始终生效，无需显式传递
  // --live-pipe-mux (flag, 默认 false)
  if (options.livePipeMux) {
    args.push('--live-pipe-mux')
  }
  // --live-fix-vtt-by-audio (flag, 默认 false)
  if (options.liveFixVttByAudio) {
    args.push('--live-fix-vtt-by-audio')
  }
  // --live-record-limit
  if (options.liveRecordLimit) {
    args.push('--live-record-limit', options.liveRecordLimit)
  }
  // --live-wait-time
  if (options.liveWaitTime) {
    args.push('--live-wait-time', String(options.liveWaitTime))
  }
  // --live-take-count (默认 16)
  if (options.liveTakeCount) {
    args.push('--live-take-count', String(options.liveTakeCount))
  }

  // ========== 输出控制（始终添加） ==========
  // --force-ansi-console (便于解析输出)
  args.push('--force-ansi-console')
  // --no-ansi-color (去除颜色便于解析)
  args.push('--no-ansi-color')
  // --disable-update-check
  args.push('--disable-update-check')

  // ========== 自定义参数（追加到末尾） ==========
  const customArgs = options.customArgs || settings.customArgs
  if (customArgs) {
    args.push(...splitCustomArgs(customArgs))
  }

  return args
}

function parseSizeValue(raw: string): number {
  const match = raw.match(/([\d.]+)\s*(B|KB|MB|GB|TB|KiB|MiB|GiB|TiB|Bytes?)/i)
  if (!match) return 0

  const value = Number(match[1])
  const unit = match[2].toUpperCase()
  const sizes: Record<string, number> = {
    B: 1,
    BYTES: 1,
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024,
    TB: 1024 * 1024 * 1024 * 1024,
    KIB: 1024,
    MIB: 1024 * 1024,
    GIB: 1024 * 1024 * 1024,
    TIB: 1024 * 1024 * 1024 * 1024
  }

  return Math.round(value * (sizes[unit] || 1))
}

/** 进度单调推进：数值只增不减，避免日志噪声导致进度回退 */
function advanceProgress(current: number, next: unknown): number {
  const value = Number(next)
  if (!Number.isFinite(value)) return current
  return Math.min(100, Math.max(current, value))
}

function parseOutput(taskId: string, line: string, mainWindow: BrowserWindow | null): void {
  const task = activeTasks.get(taskId)
  if (!task) return

  const clean = line.replace(/\x1b\[[0-9;]*m/g, '').replace(/\r/g, '').trim()
  if (!clean) return

  appendTaskLog(task, clean)
  task.latestLog = clean

  let level = 'INFO'
  if (clean.includes('[ERROR]') || /\bError\b/i.test(clean)) level = 'ERROR'
  else if (clean.includes('[WARN]') || /\bWarn\b/i.test(clean)) level = 'WARN'
  else if (clean.includes('[DEBUG]')) level = 'DEBUG'

  mainWindow?.webContents.send('download:log', {
    taskId,
    level,
    message: clean
  })

  const segmentSummaryMatch = clean.match(/(?:^|\||\s)(\d+)\s+segments?\b/i)
  if (segmentSummaryMatch) {
    task.totalSegments = Math.max(task.totalSegments, Number(segmentSummaryMatch[1]) || 0)
  }

  // 分片进度：必须携带明确关键词上下文，避免把日期、IP 等误判为进度
  const segMatch =
    clean.match(/(?:download(?:ing)?|分片|片段|segments?)\D*(\d+)\D*(?:\/|of)\D*(\d+)/i) ||
    clean.match(/(\d+)\s*(?:\/|of)\s*(\d+)\s*(?:segments?|分片|片段)/i)
  if (segMatch) {
    const done = Number(segMatch[1]) || 0
    const total = Number(segMatch[2]) || 0
    task.totalSegments = Math.max(task.totalSegments, total)
    if (done >= 0 && done <= task.totalSegments) {
      task.downloadedSegments = Math.max(task.downloadedSegments, done)
      if (task.totalSegments > 0) {
        task.progress = advanceProgress(task.progress, (done / task.totalSegments) * 100)
      }
    }
  }

  const pctMatch = clean.match(/(\d+(?:\.\d+)?)\s*%/)
  if (pctMatch) {
    task.progress = advanceProgress(task.progress, pctMatch[1])
  }

  // 字节估算仅在分片信息未知时参与计算，且不回退已有进度
  const bytesMatch = clean.match(/(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB|KiB|MiB|GiB|TiB|Bytes?)\s*(?:\/|of|总计|共)\s*(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB|KiB|MiB|GiB|TiB|Bytes?)/i) ||
    clean.match(/(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB|KiB|MiB|GiB|TiB|Bytes?)\s*(?:已下载|已完成|downloaded|download)/i)
  if (bytesMatch) {
    const current = parseSizeValue(`${bytesMatch[1]} ${bytesMatch[2]}`)
    task.downloadedBytes = Math.max(task.downloadedBytes, current)
    if (bytesMatch[3] && bytesMatch[4]) {
      task.totalBytes = Math.max(task.totalBytes, parseSizeValue(`${bytesMatch[3]} ${bytesMatch[4]}`))
    }
    if (task.totalSegments === 0 && task.totalBytes > 0) {
      task.progress = advanceProgress(task.progress, (task.downloadedBytes / task.totalBytes) * 100)
    }
  }

  const speedMatch = clean.match(/(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB|KiB|MiB|GiB|TiB)ps/i)
  if (speedMatch) {
    const bytesPerSecond = parseSizeValue(`${speedMatch[1]} ${speedMatch[2]}`)
    task.speed = formatBytesPerSecond(bytesPerSecond)
  }

  const etaMatch = clean.match(/(?:ETA|剩余时间|预计剩余|剩余)\s*[:=]?\s*(\d{1,2}:\d{2}:\d{2}|\d{1,2}:\d{2})/i)
  if (etaMatch) {
    const raw = etaMatch[1]
    const parts = raw.split(':').map(Number)
    if (parts.length === 3) task.etaSeconds = parts[0] * 3600 + parts[1] * 60 + parts[2]
    else if (parts.length === 2) task.etaSeconds = parts[0] * 60 + parts[1]
  }

  const fpsMatch = clean.match(/([\d.]+)\s*fps/i)
  if (fpsMatch) {
    task.currentFrameRate = Number(fpsMatch[1]) || task.currentFrameRate
  }

  if (task.progress >= 100 && task.totalSegments > 0 && task.downloadedSegments === 0) {
    task.downloadedSegments = task.totalSegments
  }
  if (task.progress >= 100 && task.totalBytes > 0 && task.downloadedBytes === 0) {
    task.downloadedBytes = task.totalBytes
  }

  // 进度事件按最小间隔合并发送（最新值胜出），避免逐行日志触发渲染端重绘风暴；
  // 终态由 download:complete 携带，speedTimer 每秒兜底一次
  const now = Date.now()
  if (now - ((task as any)._lastProgressSentAt ?? 0) >= PROGRESS_SEND_INTERVAL_MS) {
    ;(task as any)._lastProgressSentAt = now
    sendProgressEvent(taskId, task, mainWindow)
  }

  persistRuntimeTasks()
}
