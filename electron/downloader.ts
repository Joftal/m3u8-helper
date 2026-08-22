import { ChildProcess, spawn } from 'child_process'
import { BrowserWindow } from 'electron'
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
  startTime: Date
  logs: string[]
}

const activeTasks = new Map<string, DownloadTask>()

export function getActiveTasks(): Map<string, DownloadTask> {
  return activeTasks
}

export function startDownload(options: any, mainWindow: BrowserWindow | null): string {
  const store = getStore()
  const settings = store.get('settings')
  const taskId = randomUUID()

  const exePath = settings.exePath
  if (!exePath) {
    throw new Error('未配置 N_m3u8DL-RE.exe 路径，请在设置中配置')
  }

  // 构建命令行参数
  const args = buildArgs(options, settings)

  const task: DownloadTask = {
    id: taskId,
    url: options.url,
    process: null,
    status: 'pending',
    progress: 0,
    speed: '0 KB/s',
    downloadedSegments: 0,
    totalSegments: 0,
    startTime: new Date(),
    logs: []
  }

  activeTasks.set(taskId, task)

  // 启动子进程
  const child = spawn(exePath, args, {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  })

  task.process = child
  task.status = 'running'

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
      // 已取消，不处理
    } else if (code === 0) {
      task.status = 'completed'
      task.progress = 100
    } else {
      task.status = 'failed'
    }

    mainWindow?.webContents.send('download:complete', {
      taskId,
      status: task.status,
      code
    })

    // 清理
    task.process = null
  })

  child.on('error', (err) => {
    const task = activeTasks.get(taskId)
    if (task) {
      task.status = 'failed'
      task.logs.push(`[ERROR] ${err.message}`)
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
  if (!task || !task.process) return false

  task.status = 'cancelled'
  task.process.kill('SIGTERM')

  // Windows 上强制杀死
  if (task.process.pid) {
    try {
      spawn('taskkill', ['/pid', String(task.process.pid), '/T', '/F'])
    } catch {}
  }

  return true
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
  if (options.muxAfterDone ?? settings.muxAfterDone ?? muxFormat) {
    const muxer = options.muxMuxer || settings.muxMuxer || 'ffmpeg'
    let muxArgs = `format=${muxFormat || 'mp4'}:muxer=${muxer}`
    if (options.muxSkipSub) muxArgs += ':skip_sub=true'
    if (options.muxKeepFiles) muxArgs += ':keep=true'
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
    const extra = customArgs.split(/\s+/).filter(Boolean)
    args.push(...extra)
  }

  return args
}

function parseOutput(taskId: string, line: string, mainWindow: BrowserWindow | null): void {
  const task = activeTasks.get(taskId)
  if (!task) return

  // 去除 ANSI 转义序列
  const clean = line.replace(/\x1b\[[0-9;]*m/g, '').replace(/\r/g, '').trim()
  if (!clean) return

  task.logs.push(clean)

  // 发送日志到渲染进程
  let level = 'INFO'
  if (clean.includes('[ERROR]') || clean.includes('Error')) level = 'ERROR'
  else if (clean.includes('[WARN]') || clean.includes('Warn')) level = 'WARN'
  else if (clean.includes('[DEBUG]')) level = 'DEBUG'

  mainWindow?.webContents.send('download:log', {
    taskId,
    level,
    message: clean
  })

  // 解析进度信息
  // 匹配模式: "Downloading 156/200" 或类似的分片进度
  const segMatch = clean.match(/[Dd]ownload\w*\s+(\d+)\/(\d+)/) ||
                   clean.match(/(\d+)\/(\d+)\s+segments/) ||
                   clean.match(/分片\s*(\d+)\/(\d+)/)
  if (segMatch) {
    task.downloadedSegments = parseInt(segMatch[1])
    task.totalSegments = parseInt(segMatch[2])
    if (task.totalSegments > 0) {
      task.progress = Math.round((task.downloadedSegments / task.totalSegments) * 100)
    }
  }

  // 匹配百分比
  const pctMatch = clean.match(/(\d+(?:\.\d+)?)\s*%/)
  if (pctMatch) {
    task.progress = Math.min(100, parseFloat(pctMatch[1]))
  }

  // 匹配速度
  const speedMatch = clean.match(/([\d.]+)\s*(B\/s|KB\/s|MB\/s|GB\/s|Kbps|Mbps)/i) ||
                     clean.match(/速度[:\s]*([\d.]+)\s*(B\/s|KB\/s|MB\/s|GB\/s)/i)
  if (speedMatch) {
    task.speed = `${speedMatch[1]} ${speedMatch[2]}`
  }

  // 匹配 Done/Failed
  if (clean.includes('Done') || clean.includes('完成')) {
    task.status = 'completed'
    task.progress = 100
  }
  if (clean.includes('Failed') || clean.includes('失败')) {
    task.status = 'failed'
  }

  // 发送进度更新
  mainWindow?.webContents.send('download:progress', {
    taskId,
    progress: task.progress,
    speed: task.speed,
    downloadedSegments: task.downloadedSegments,
    totalSegments: task.totalSegments,
    status: task.status
  })
}
