import { ChildProcess, spawn } from 'child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'fs'
import { BrowserWindow } from 'electron'
import { basename, dirname, join } from 'path'
import { getStore } from './store'
import { randomUUID } from 'crypto'

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

export function getActiveTasks(): Map<string, DownloadTask> {
  return activeTasks
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

function getDirectorySize(target: string): number {
  if (!target || !existsSync(target)) return 0

  try {
    const entries = readdirSync(target, { withFileTypes: true })
    let total = 0

    for (const entry of entries) {
      const fullPath = join(target, entry.name)
      if (entry.isDirectory()) {
        total += getDirectorySize(fullPath)
      } else if (entry.isFile()) {
        try {
          total += statSync(fullPath).size
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

function getTaskDiskUsage(task: DownloadTask): number {
  const settings = getStore().get('settings') || {}
  const candidates = [
    (task as any).saveDir,
    (task as any).tmpDir,
    (task as any).options?.saveDir,
    (task as any).options?.tmpDir,
    settings.saveDir,
    settings.tmpDir
  ].filter((value): value is string => Boolean(value && value.trim()))

  const uniqueDirs = Array.from(new Set(candidates.map((dir) => dir.trim())))
  const total = uniqueDirs.reduce((sum, dir) => sum + getDirectorySize(dir), 0)
  return total
}

function persistRuntimeTasks(): void {
  const tasks = Array.from(activeTasks.values()).map((task) => ({
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
  getStore().set('runtimeTasks', tasks)
}

function persistSettingsState(settings: any): void {
  getStore().set('settings', settings)
}

export function startDownload(options: any, mainWindow: BrowserWindow | null): string {
  const store = getStore()
  const settings = store.get('settings')
  const taskId = randomUUID()

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
  const effectiveSaveDir = options.saveDir || settings.saveDir || defaultSaveDir
  const effectiveTmpDir = options.tmpDir || settings.tmpDir || defaultTmpDir

  if (!settings.saveDir || !settings.saveDir.trim()) {
    settings.saveDir = effectiveSaveDir
  }
  if (!settings.tmpDir || !settings.tmpDir.trim()) {
    settings.tmpDir = effectiveTmpDir
  }
  if (!settings.logFilePath || !settings.logFilePath.trim()) {
    settings.logFilePath = join(executableRoot, 'logs', 'N_m3u8DL-RE.log')
  }
  persistSettingsState(settings)

  ensureDir(effectiveSaveDir)
  ensureDir(effectiveTmpDir)
  if (settings.logFilePath) {
    const parent = settings.logFilePath.split(/[/\\]/).slice(0, -1).join('/') || '.'
    ensureDir(parent)
  }

  // 构建命令行参数
  const args = buildArgs(options, settings)

  const task: DownloadTask & { saveName?: string; saveDir?: string; options?: any } = {
    id: taskId,
    url: options.url,
    saveName: options.saveName || '',
    saveDir: options.saveDir || settings.saveDir || effectiveSaveDir,
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
  persistRuntimeTasks()

  // 启动子进程
  const child = spawn(exePath, args, {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  })

  task.process = child
  task.status = 'running'
  ;(task as any)._lastSpeedBytes = getTaskDiskUsage(task)
  ;(task as any)._lastSpeedAt = Date.now()

  const speedTimer = setInterval(() => {
    const activeTask = activeTasks.get(taskId)
    if (!activeTask || activeTask.status !== 'running') return

    const currentBytes = getTaskDiskUsage(activeTask)
    const now = Date.now()
    const elapsedSeconds = Math.max((now - ((activeTask as any)._lastSpeedAt ?? now)) / 1000, 1)
    const deltaBytes = Math.max(currentBytes - ((activeTask as any)._lastSpeedBytes ?? currentBytes), 0)
    const bytesPerSecond = deltaBytes / elapsedSeconds

    activeTask.speed = formatBytesPerSecond(bytesPerSecond)
    activeTask.downloadedBytes = Math.max(activeTask.downloadedBytes, currentBytes)
    ;(activeTask as any)._lastSpeedBytes = currentBytes
    ;(activeTask as any)._lastSpeedAt = now

    mainWindow?.webContents.send('download:progress', {
      taskId,
      progress: activeTask.progress,
      speed: activeTask.speed,
      downloadedSegments: activeTask.downloadedSegments,
      totalSegments: activeTask.totalSegments,
      downloadedBytes: activeTask.downloadedBytes,
      totalBytes: activeTask.totalBytes,
      etaSeconds: activeTask.etaSeconds,
      currentFrameRate: activeTask.currentFrameRate,
      latestLog: activeTask.latestLog,
      status: activeTask.status
    })
    persistRuntimeTasks()
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

  // 任务完成
  child.on('close', (code) => {
    const task = activeTasks.get(taskId)
    if (!task) return

    if (task.status === 'cancelled') {
      task.progress = Math.min(100, Math.max(0, task.progress || 0))
      task.latestLog = task.latestLog || '任务已取消'
    } else if (code === 0) {
      task.status = 'completed'
      task.progress = 100
      if (task.totalSegments > 0 && task.downloadedSegments === 0) {
        task.downloadedSegments = task.totalSegments
      }
      if (task.totalBytes > 0 && task.downloadedBytes === 0) {
        task.downloadedBytes = task.totalBytes
      }
    } else {
      task.status = 'failed'
      const taskPayload = {
        saveDir: (task as any).saveDir || (task as any).options?.saveDir || '',
        saveName: (task as any).saveName || (task as any).options?.saveName || '',
        tmpDir: (task as any).tmpDir || (task as any).options?.tmpDir || '',
        outputPath: (task as any).outputPath || (task as any).options?.outputPath || '',
        options: (task as any).options || {}
      }
      deleteTaskArtifacts(taskId, taskPayload)
    }

    mainWindow?.webContents.send('download:complete', {
      taskId,
      status: task.status,
      code,
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

    // 清理
    if ((task as any)._speedTimer) {
      clearInterval((task as any)._speedTimer)
    }
    task.process = null
    activeTasks.delete(taskId)
    persistRuntimeTasks()
  })

  child.on('error', (err) => {
    const task = activeTasks.get(taskId)
    if (task) {
      task.status = 'failed'
      task.logs.push(`[ERROR] ${err.message}`)
      persistRuntimeTasks()
    }
    mainWindow?.webContents.send('download:log', {
      taskId,
      level: 'ERROR',
      message: err.message
    })
  })

  return taskId
}

export function cancelDownload(taskId: string): boolean {
  const task = activeTasks.get(taskId)
  if (!task) return false

  task.status = 'cancelled'
  task.latestLog = task.latestLog || '任务已取消'
  persistRuntimeTasks()

  if (task.process) {
    task.process.kill('SIGTERM')

    // Windows 上强制杀死
    if (task.process.pid) {
      try {
        spawn('taskkill', ['/pid', String(task.process.pid), '/T', '/F'])
      } catch {}
    }
  }

  const taskPayload = {
    saveDir: (task as any).saveDir || (task as any).options?.saveDir || '',
    saveName: (task as any).saveName || (task as any).options?.saveName || '',
    tmpDir: (task as any).tmpDir || (task as any).options?.tmpDir || '',
    outputPath: (task as any).outputPath || (task as any).options?.outputPath || '',
    options: (task as any).options || {}
  }

  deleteTaskArtifacts(taskId, taskPayload)

  return true
}

export function deleteTaskArtifacts(taskId: string, taskInfo: any = {}): { success: boolean; deleted: string[]; error?: string } {
  const task = activeTasks.get(taskId)
  const payload = task ? { ...task, ...(taskInfo || {}) } : (taskInfo || {})
  const deleted: string[] = []

  const deleteIfExists = (target?: string) => {
    if (!target || !target.trim()) return
    const normalized = target.trim()
    if (!existsSync(normalized)) return
    rmSync(normalized, { recursive: true, force: true })
    deleted.push(normalized)
  }

  const deleteExactCandidates = (directory: string, fileNames: string[]) => {
    if (!directory || !fileNames.length) return
    for (const fileName of fileNames) {
      const candidate = join(directory, fileName)
      deleteIfExists(candidate)
    }
  }

  const saveDir = (payload.saveDir || payload.options?.saveDir || '').trim()
  const saveName = (payload.saveName || payload.options?.saveName || '').trim()
  const tmpDir = (payload.tmpDir || payload.options?.tmpDir || '').trim()
  const outputPath = (payload.outputPath || payload.options?.outputPath || '').trim()

  if (outputPath) deleteIfExists(outputPath)
  if (tmpDir) deleteIfExists(tmpDir)

  if (saveDir && saveName) {
    const baseName = basename(saveName)
    if (baseName && baseName !== '.' && baseName !== '..') {
      const stem = baseName.includes('.') ? baseName.slice(0, baseName.lastIndexOf('.')) : baseName
      const suffixes = ['.part', '.tmp', '.download', '.m3u8', '.meta.json', '.json', '.ts', '.mp4', '.mkv', '.mp3', '.aac']
      const exactCandidates = new Set<string>([baseName])
      for (const suffix of suffixes) {
        exactCandidates.add(`${stem}${suffix}`)
        exactCandidates.add(`${baseName}${suffix}`)
      }
      deleteExactCandidates(saveDir, Array.from(exactCandidates))
    }
  }

  if (task) {
    activeTasks.delete(taskId)
    persistRuntimeTasks()
  }

  return { success: true, deleted }
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
function buildArgs(options: any, settings: any): string[] {
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

function formatSpeedFromBytesPerSecond(bytesPerSecond: number): string {
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

function parseOutput(taskId: string, line: string, mainWindow: BrowserWindow | null): void {
  const task = activeTasks.get(taskId)
  if (!task) return

  const clean = line.replace(/\x1b\[[0-9;]*m/g, '').replace(/\r/g, '').trim()
  if (!clean) return

  task.logs.push(clean)
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

  const segMatch = clean.match(/(?:download(?:ing)?|分片|片段|segments?)\D*(\d+)\D*(?:\/|of)\D*(\d+)/i) ||
    clean.match(/(\d+)\s*(?:\/|of)\s*(\d+)\s*(?:segments?|分片|片段)/i) ||
    clean.match(/(\d+)\s*\/\s*(\d+)\s*(?:\.|\s|\||$)/)
  if (segMatch) {
    task.downloadedSegments = Math.max(0, Number(segMatch[1]) || 0)
    task.totalSegments = Math.max(0, Number(segMatch[2]) || 0)
    if (task.totalSegments > 0) {
      task.progress = Math.min(100, Math.round((task.downloadedSegments / task.totalSegments) * 100))
    }
  }

  const pctMatch = clean.match(/(\d+(?:\.\d+)?)\s*%/)
  if (pctMatch) {
    task.progress = Math.min(100, Number(pctMatch[1]) || task.progress)
  }

  const bytesMatch = clean.match(/(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB|KiB|MiB|GiB|TiB|Bytes?)\s*(?:\/|of|总计|共)\s*(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB|KiB|MiB|GiB|TiB|Bytes?)/i) ||
    clean.match(/(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB|KiB|MiB|GiB|TiB|Bytes?)\s*(?:已下载|已完成|downloaded|download)/i)
  if (bytesMatch) {
    const current = parseSizeValue(`${bytesMatch[1]} ${bytesMatch[2]}`)
    task.downloadedBytes = Math.max(task.downloadedBytes, current)
    if (bytesMatch[3] && bytesMatch[4]) {
      task.totalBytes = Math.max(0, parseSizeValue(`${bytesMatch[3]} ${bytesMatch[4]}`))
    }
    if (task.totalBytes > 0) {
      task.progress = Math.min(100, Math.round((task.downloadedBytes / task.totalBytes) * 100))
    }
  }

  const speedMatch = clean.match(/(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB|KiB|MiB|GiB|TiB)ps/i)
  if (speedMatch) {
    const bytesPerSecond = parseSizeValue(`${speedMatch[1]} ${speedMatch[2]}`)
    task.speed = formatSpeedFromBytesPerSecond(bytesPerSecond)
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

  persistRuntimeTasks()
}
