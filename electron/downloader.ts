import { ChildProcess, spawn } from 'child_process'
import { accessSync, chmodSync, constants as fsConstants, existsSync, mkdirSync, readdirSync, rmSync, statSync, promises as fsPromises } from 'fs'
import { BrowserWindow, nativeImage, Notification } from 'electron'
import { basename, dirname, join } from 'path'
import { getStore } from './store'
import { isAllowedRecursiveDeleteTarget } from './path-safety'
import { randomUUID } from 'crypto'
import { isRecordTaskOptions } from '../src/utils/recording'
import { formatNetworkSpeed } from '../src/utils/speed'
import type { DownloadOptions } from '../src/types/download'
import type { AppSettings } from '../src/types/settings'
import { DEFAULT_LOCALE, normalizeLocale, type SupportedLocale } from '../src/constants/locales'
import { translatePathSafetyReason, translateRuntimeMessage, type RuntimeMessageKey } from '../src/i18n'

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
}

const activeTasks = new Map<string, DownloadTask>()

function currentLocale(): SupportedLocale {
  try {
    const settings = getStore().get('settings') as Partial<AppSettings> | undefined
    return normalizeLocale(settings?.language, DEFAULT_LOCALE)
  } catch {
    return DEFAULT_LOCALE
  }
}

function rt(key: RuntimeMessageKey, params: Record<string, string> = {}): string {
  return translateRuntimeMessage(currentLocale(), key, params)
}

function localizePathSafetyReason(reason?: string): string {
  return translatePathSafetyReason(currentLocale(), reason)
}

/** 最近一次启动下载时使用的窗口引用，用于取消等无法传入窗口的路径发送事件 */
let activeMainWindow: BrowserWindow | null = null

/** 窗口创建后由主入口注册：保证启动恢复阶段的转封装等后台动作也能通知到渲染端 */
export function setActiveMainWindow(window: BrowserWindow | null): void {
  activeMainWindow = window
}

/** runtime-tasks.json 落盘节流间隔：高频日志场景合并为每秒最多一次写入 */
const PERSIST_INTERVAL_MS = 1000
/** download:progress 事件最小发送间隔（最新值胜出），避免逐行日志触发渲染端重绘风暴 */
const PROGRESS_SEND_INTERVAL_MS = 200

let persistTimer: ReturnType<typeof setTimeout> | null = null

/**
 * 剥离 CLI 输出中的 ANSI 转义序列与残余控制字符。
 * --force-ansi-console 下除颜色码（SGR ...m）外还会出现光标控制（[2K/[1A 等），
 * 仅剥颜色码会在日志里残留 "[2K" 之类的可见乱码，这里按 OSC/CSI/单字符转义全量清除。
 */
const RE_OSC_SEQUENCE = /\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g
const RE_CSI_SEQUENCE = /\x1B\[[0-?]*[ -/]*[@-~]/g
const RE_ESC_SEQUENCE = /\x1B[@-Z\\-_]/g
/** 清除残余控制字符：保留 TAB(0x09)，LF/CR 已按行切分处理 */
const RE_CONTROL_CHARS = /[\x00-\x08\x0B-\x1F\x7F]/g

function sanitizeCliText(line: string): string {
  return line
    .replace(RE_OSC_SEQUENCE, '')
    .replace(RE_CSI_SEQUENCE, '')
    .replace(RE_ESC_SEQUENCE, '')
    .replace(RE_CONTROL_CHARS, '')
}

/** ANSI（系统代码页）解码器的候选实现，按常见中文区代码页优先尝试 */
const ANSI_DECODER_LABELS = ['gbk', 'gb18030', 'big5', 'windows-1252'] as const

function createAnsiDecoder(): TextDecoder {
  for (const label of ANSI_DECODER_LABELS) {
    try {
      return new TextDecoder(label)
    } catch {
      // 当前 ICU 不支持该代码页时继续尝试下一个
    }
  }
  return new TextDecoder('utf-8')
}

/**
 * CLI 输出按字节攒行并解码。
 *
 * N_m3u8DL-RE 在 stdout/stderr 被重定向时按系统 ANSI 代码页输出
 * （简中 Windows 为 GBK），直接 data.toString()（UTF-8）会把全部
 * 中文日志变成乱码。此外多字节字符可能被管道 chunk 从中间截断，
 * 必须以字节为单位攒出完整行后再解码。
 *
 * 按字节切行的安全性：GBK 双字节字符的尾字节取值不会落在
 * CR/LF（0x0D/0x0A），UTF-8 的续字节同样如此，因此在任意多字节
 * 字符中间不会出现换行字节，行边界判定不受编码影响。
 *
 * 字符集探测：首个含非 ASCII 的行用严格 UTF-8 尝试，成功则整流
 * 按 UTF-8 解码；失败则回落 ANSI 代码页。纯 ASCII 行两种编码等价，
 * 保持未定型即可。
 */
class CliLineReader {
  private buffer: Buffer = Buffer.alloc(0)
  private readonly ansiDecoder = createAnsiDecoder()
  private charset: 'utf8' | 'ansi' | null = null

  /** 追加原始输出，返回其中已完整的行 */
  push(chunk: Buffer): string[] {
    this.buffer = this.buffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([this.buffer, chunk])
    return this.drain(false)
  }

  /** 流结束时冲出残留的最后一行（可能无换行结尾） */
  end(): string[] {
    const lines = this.drain(true)
    this.buffer = Buffer.alloc(0)
    return lines
  }

  private drain(flush: boolean): string[] {
    const lines: string[] = []
    let start = 0
    let i = 0
    while (i < this.buffer.length) {
      const byte = this.buffer[i]
      if (byte !== 0x0d && byte !== 0x0a) {
        i += 1
        continue
      }
      lines.push(this.decode(this.buffer.subarray(start, i)))
      i += 1
      // CRLF 视为单个分隔符
      if (byte === 0x0d && this.buffer[i] === 0x0a) i += 1
      start = i
    }
    const rest = this.buffer.subarray(start)
    if (flush) {
      if (rest.length > 0) lines.push(this.decode(rest))
      this.buffer = Buffer.alloc(0)
    } else {
      this.buffer = rest.length > 0 ? Buffer.from(rest) : Buffer.alloc(0)
    }
    return lines
  }

  private decode(bytes: Buffer): string {
    if (bytes.length === 0) return ''
    if (this.charset === 'utf8') return bytes.toString('utf8')
    if (this.charset === 'ansi') return sanitizeCliWhitespace(this.ansiDecoder.decode(bytes))
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      if (/[^\x00-\x7F]/.test(text)) this.charset = 'utf8'
      return text
    } catch {
      this.charset = 'ansi'
      return sanitizeCliWhitespace(this.ansiDecoder.decode(bytes))
    }
  }
}

/** TextDecoder 对 GBK 中 U+FFFD 类不可映射字节的兜底替换符清理 */
function sanitizeCliWhitespace(text: string): string {
  return text.replace(RE_CONTROL_CHARS, '')
}

/** CLI 日志行自带时间戳与级别前缀（如 "08:32:22.466 WARN : "） */
const RE_CLI_LOG_PREFIX = /^\d{2}:\d{2}:\d{2}(?:\.\d+)?\s+(DEBUG|INFO|WARN|ERROR)\s*[:：]\s*/

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
 * 进行中的 TS 转封装任务表：taskId → 落盘上下文。
 * 除防重入外，还供 startDownload 做同名检测：转封装是异步后台动作，
 * 若新任务在其扫描/删除窗口内复用同名同目录，会写进正被处理的文件集，
 * 造成新任务产物被误转/误删，必须强制错开命名。
 */
const activeRemuxJobs = new Map<string, { saveDir: string; stemLower: string }>()

/**
 * 产物文件名匹配：仅接受 <stem>.<ext> 或 <stem>[._-]数字分片.<ext>。
 * 多任务并发时 saveDir 共享，宽松的前缀/includes 匹配会把「test2.ts」
 * 误判给「test」任务，造成跨任务转封装/误删/速度统计串扰，必须带边界。
 */
function artifactStemRegex(stem: string): RegExp {
  const escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // 允许：精确同名、数字分片后缀（_00/-1/.2），后接单个可选扩展名；
  // 「test2.mkv」这类紧跟字母数字的名字不会被「test」误匹配
  return new RegExp(`^${escaped}(?:[._-]\\d+)?\\.[^.]+$|^${escaped}$`, 'i')
}

/** 按任务派生独立日志文件路径：保留目录与前缀，追加 taskId 前 8 位（N_m3u8DL-RE_a1b2c3d4.log） */
function deriveTaskLogPath(baseLogPath: string, taskId: string): string {
  const shortId = taskId.slice(0, 8)
  const dirEnd = Math.max(baseLogPath.lastIndexOf('\\'), baseLogPath.lastIndexOf('/'))
  if (dirEnd < 0) return `${baseLogPath}_${shortId}.log`
  const dotIndex = baseLogPath.lastIndexOf('.')
  const dir = baseLogPath.slice(0, dirEnd)
  const sep = baseLogPath[dirEnd]
  const base = baseLogPath.slice(dirEnd + 1, dotIndex > dirEnd ? dotIndex : undefined)
  const ext = dotIndex > dirEnd ? baseLogPath.slice(dotIndex) : '.log'
  return `${dir}${sep}${base}_${shortId}${ext}`
}

function binaryNameCandidates(baseName: string): string[] {
  if (process.platform === 'win32') return [`${baseName}.exe`, baseName]
  return [baseName, `${baseName}.exe`]
}

function resolveBundledBinary(baseName: string): string {
  const executableRoot = dirname(process.execPath)
  const resourcesRoot = process.resourcesPath || ''
  const names = binaryNameCandidates(baseName)
  const candidates: string[] = []
  for (const name of names) {
    if (resourcesRoot) {
      candidates.push(join(resourcesRoot, 'bin', name))
      candidates.push(join(dirname(resourcesRoot), 'MacOS', 'resources', 'bin', name))
    }
    candidates.push(join(executableRoot, name))
    candidates.push(join(executableRoot, 'resources', 'bin', name))
    candidates.push(join(executableRoot, '../Resources/bin', name))
    candidates.push(join(__dirname, `../../${name}`))
    candidates.push(join(__dirname, `../../resources/bin/${name}`))
  }
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return ''
}

function ensureExecutablePermission(binaryPath: string): string {
  const target = binaryPath.trim()
  if (!target) return target
  if (process.platform === 'win32') return target

  try {
    accessSync(target, fsConstants.X_OK)
    return target
  } catch {}

  try {
    chmodSync(target, 0o755)
    accessSync(target, fsConstants.X_OK)
    return target
  } catch (error) {
    const message = (error as Error).message || 'unknown error'
    throw new Error(rt('executableNotRunnable', { path: target, reason: message }))
  }
}

/** 解析可用的 ffmpeg 可执行文件：设置路径 → 打包携带路径 → PATH */
function resolveFfmpegBinary(settings: AppSettings): string {
  const bundledOrConfigured = resolveOptionalToolBinary(settings.ffmpegPath, 'ffmpeg')
  if (bundledOrConfigured) return bundledOrConfigured
  return 'ffmpeg'
}

/** 解析可用的 N_m3u8DL-RE 可执行文件：设置路径 → 打包携带路径 */
function resolveDownloaderBinary(settings: AppSettings): string {
  const configured = (settings.exePath || '').trim()
  if (configured) {
    if (existsSync(configured)) return ensureExecutablePermission(configured)
    return configured
  }
  const bundled = resolveBundledBinary('N_m3u8DL-RE')
  return bundled ? ensureExecutablePermission(bundled) : ''
}

function resolveOptionalToolBinary(configuredPath: string | undefined, baseName: string): string {
  const configured = (configuredPath || '').trim()
  if (configured) return configured
  const bundled = resolveBundledBinary(baseName)
  return bundled ? ensureExecutablePermission(bundled) : ''
}

function terminateProcessTree(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 0) return

  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    } catch {}
    return
  }

  try {
    process.kill(-pid, 'SIGTERM')
  } catch {}
  try {
    process.kill(pid, 'SIGTERM')
  } catch {}

  // unref：兜底定时器不应阻止进程退出（应用退出场景下 1.5s 的等待没有意义）
  const killFallback = setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {}
    try {
      process.kill(pid, 'SIGKILL')
    } catch {}
  }, 1500)
  killFallback.unref()
}

export interface RemuxOutcome {
  taskId: string
  /** 转封装成功产出的 MKV 文件 */
  outputs: string[]
  /** 发现并尝试转换的 TS 文件数（含失败的） */
  attempted: number
}

/**
 * 扫描录制任务遗留的 TS 中间产物并无损转封装为 MKV。
 *
 * 背景：CLI 的收尾混流（TS → MKV）只在到达限额或直播自然结束时执行；
 * 手动停止会强杀进程树，留下的始终是实时合并的 .ts 中间产物。
 * 此处用 ffmpeg -c copy 补上这一步（零重编码、秒级），失败时保留源文件。
 */
async function remuxTsArtifacts(
  taskId: string,
  saveDir: string,
  saveName: string,
  settings: AppSettings
): Promise<RemuxOutcome> {
  const outcome: RemuxOutcome = { taskId, outputs: [], attempted: 0 }
  const stem = basename(saveName || '').trim()
  if (!taskId || !stem || !saveDir) return outcome

  let entries: Array<{ name: string; isFile: () => boolean }>
  try {
    entries = readdirSync(saveDir, { withFileTypes: true }) as any
  } catch {
    return outcome
  }

  const tsFiles = entries
    .filter((e) => e.isFile())
    .filter((e) => {
      const name = e.name.toLowerCase()
      if (!name.endsWith('.ts') || name.endsWith('.copy.ts')) return false
      // 单文件为 <名字>.ts，多分片为 <名字>_NN.ts；带边界的匹配防止误伤近似命名的并发任务
      return artifactStemRegex(stem).test(e.name)
    })
    .map((e) => join(saveDir, e.name))
  if (tsFiles.length === 0) return outcome

  const ffmpeg = resolveFfmpegBinary(settings)
  for (const ts of tsFiles) {
    outcome.attempted += 1
    const target = ts.slice(0, -3) + '.mkv'
    const ok = await new Promise<boolean>((resolve) => {
      const child = spawn(
        ffmpeg,
        ['-y', '-fflags', '+genpts', '-i', ts, '-map', '0', '-c', 'copy', target],
        { windowsHide: true, stdio: 'ignore' }
      )
      // 挂起保护：ffmpeg 卡死时强杀并收场，防止 Promise 永不 settle
      // 导致 activeRemuxJobs 条目残留（同名任务会被持续强制改名）
      let settled = false
      const settle = (value: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(hangGuard)
        resolve(value)
      }
      const hangGuard = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {}
        settle(false)
      }, REMUX_TIMEOUT_MS)
      hangGuard.unref?.()
      child.on('close', (code) => settle(code === 0))
      child.on('error', () => settle(false))
    })
    // 退出码 0 不代表产物完整（磁盘写满、网络盘中断都可能产出截断文件）：
    // 删源前校验目标存在且非空，不满足则保留源 TS 等待人工处理
    if (ok && isNonEmptyFile(target)) {
      try {
        rmSync(ts, { force: true })
      } catch {}
      outcome.outputs.push(target)
    }
  }
  return outcome
}

/** 单文件转封装超时：-c copy 为秒级操作，5 分钟未完成即视为挂起 */
const REMUX_TIMEOUT_MS = 5 * 60 * 1000

/** 校验产物文件存在且非空（转封装删源前的最低完整性门槛） */
function isNonEmptyFile(target: string): boolean {
  try {
    return existsSync(target) && statSync(target).size > 0
  } catch {
    return false
  }
}

/** 转封装完成后向渲染端发事件（toast 反馈）；窗口不可用时静默完成 */
function dispatchRemuxOutcome(outcome: RemuxOutcome): void {
  if (outcome.attempted === 0) return
  activeMainWindow?.webContents.send('record:artifacts-remuxed', outcome)
}

/** 对单个已终结的录制任务发起后台转封装（fire-and-forget） */
function scheduleRemux(taskId: string, saveDir: string | undefined, saveName: string | undefined): void {
  if (!taskId || activeRemuxJobs.has(taskId)) return
  const stem = basename(saveName || '').trim()
  activeRemuxJobs.set(taskId, {
    saveDir: (saveDir || '').trim().toLowerCase(),
    stemLower: stem.toLowerCase()
  })
  const settings = getStore().get('settings') as AppSettings
  remuxTsArtifacts(taskId, saveDir || '', saveName || '', settings)
    .then(dispatchRemuxOutcome)
    .catch(() => {})
    .finally(() => activeRemuxJobs.delete(taskId))
}
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
      ? rt('recordAborted', { name })
      : rt('recordCompleted', { name })
    new Notification({ title: rt('recordNotificationTitle'), body, icon: NOTIFICATION_ICON }).show()
  } catch {
    // 通知属尽力而为的增强能力，失败不影响主流程
  }
}

/**
 * 主进程侧为已取消的录制任务兜底写入历史。
 *
 * 通过退出拦截停止的录制发生在窗口销毁前后，渲染端的 addRecord 可能永远无法完成；
 * 且 finalizeTask 已把任务移出 runtime 快照，下次启动的孤儿恢复也无法补写——
 * 若不在此处落库，这类记录将彻底丢失。按 id 幂等：渲染端存活时其随后写入
 * 会覆盖同一条目（内容一致），不会产生重复。
 */
function upsertCancelledRecordHistory(taskId: string, task: DownloadTask & Record<string, any>): void {
  try {
    const store = getStore()
    const history: any[] = Array.isArray(store.get('history')) ? store.get('history') : []
    if (history.some((h) => h?.id === taskId)) return

    const startIso = task.startTime instanceof Date ? task.startTime.toISOString() : String(task.startTime ?? '')
    const startMs = Date.parse(startIso)
    history.unshift({
      id: taskId,
      url: String(task.url ?? ''),
      saveName: String((task as any).saveName ?? ''),
      status: 'cancelled',
      kind: 'record',
      startTime: startIso,
      endTime: new Date().toISOString(),
      fileSize: toNonNegativeNumber((task as any).totalBytes || task.downloadedBytes),
      outputPath: String((task as any).saveDir ?? ''),
      duration: Number.isFinite(startMs) ? Math.max(0, Math.floor((Date.now() - startMs) / 1000)) : 0
    })
    if (history.length > 500) history.length = 500
    store.set('history', history)
  } catch {
    // 历史兜底属尽力而为，失败不影响收尾主流程
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
    task.latestLog = task.latestLog || rt('taskCancelled')
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
    task.latestLog = task.latestLog || rt('processExitAbnormal', { code: String(exitCode ?? rt('unknown')) })
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

  // 非优雅收尾的录制任务：CLI 的收尾混流（TS→MKV）不会执行，由 GUI 补做转封装。
  // completed 状态 CLI 已产出正式 MKV；多分片场景逐个转换，失败保留源 TS。
  if (isRecordTask && (task.status === 'cancelled' || task.status === 'failed')) {
    if (task.status === 'cancelled') {
      upsertCancelledRecordHistory(taskId, task)
    }
    scheduleRemux(taskId, (task as any).saveDir, (task as any).saveName)
  }

  if (task._speedTimer) {
    clearInterval(task._speedTimer)
    task._speedTimer = null
  }
  task.process = null
  activeTasks.delete(taskId)
  flushRuntimeTasks()
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
 * 统计本任务可归属的磁盘体积（速度口径 = 网络流入近似）：
 * - 临时目录 tmp/task-<taskId> 整体递归：分片下载的写入即网络接收
 * - 录制任务额外统计 saveDir 中以保存名词干命名的实时合并产物
 *   （直播实时合并的 .ts 增长同样是网络流入）
 *
 * 下载任务刻意不计 saveDir：合并阶段 CLI「读 tmp 分片 + 写成品」属于
 * 本地磁盘操作，计入会把混流写盘冒充成网速；排除后合并期速率自然归零
 * （此时网络确已完成，0 才是正确语义）。
 *
 * 带边界文件名匹配：并发任务共享同一保存目录时互不串算。
 */
async function getTaskAttributableBytes(task: DownloadTask & Record<string, any>): Promise<number> {
  let total = 0

  const tmpDir: string = task.tmpDir || task.options?.tmpDir || ''
  if (tmpDir && tmpDir.trim()) {
    total += await getDirectorySizeAsync(tmpDir.trim())
  }

  // 下载任务到此为止：成品合并是本地磁盘操作，与网速无关
  if (!isRecordTaskOptions(task.options)) return total

  const saveDir: string = task.saveDir || task.options?.saveDir || ''
  const saveName: string = task.saveName || task.options?.saveName || ''
  if (saveDir && saveDir.trim() && saveName) {
    const stem = basename(saveName)
    // 带边界匹配：共享 saveDir 时只统计本任务的产物，防止并发任务速度互相串扰
    const artifactRegex = artifactStemRegex(stem)
    try {
      const entries = await fsPromises.readdir(saveDir.trim(), { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isFile() || !artifactRegex.test(entry.name)) continue
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

function sanitizeOptionsForRuntimePersistence(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {}
  const input = raw as Record<string, unknown>
  const out: Record<string, unknown> = {}

  // 恢复识别录制任务只需要该标记；避免 headers/proxy/customArgs 等敏感信息落盘
  if (input.kind === 'record' || input.kind === 'download') {
    out.kind = input.kind
  }

  return out
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
    saveName: (task as any).saveName ?? '',
    saveDir: (task as any).saveDir ?? '',
    tmpDir: (task as any).tmpDir ?? '',
    outputPath: (task as any).outputPath ?? '',
    // 仅持久化恢复链路必需字段，避免敏感配置写入本地 JSON
    options: sanitizeOptionsForRuntimePersistence((task as any).options)
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
  /** 崩溃任务残留的隔离临时目录：碎片不可续用（重试会派生全新目录），统一回收 */
  const staleTmpDirs: string[] = []
  const nowIso = new Date().toISOString()
  const history: any[] = Array.isArray(store.get('history')) ? store.get('history') : []

  for (const task of tasks) {
    if (!task || (task.status !== 'running' && task.status !== 'pending')) continue

    task.status = 'failed'
    task.latestLog = rt('interruptedByRestart')
    changed = true

    // 崩溃时 finalizeTask 未执行，隔离临时目录未被清理；校验命名归属后收集待删
    const orphanTmpDir: string = task?.tmpDir || task?.options?.tmpDir || ''
    if (orphanTmpDir && basename(orphanTmpDir) === `task-${task.id}`) {
      staleTmpDirs.push(orphanTmpDir)
    }

    // 中断的录制任务同样遗留 TS 中间产物，启动时补做转封装（窗口未就绪时事件静默）。
    // 放在历史补写之前：已被 continue 跳过历史写入的任务也需要转封装。
    if (isRecordTaskOptions(task.options)) {
      scheduleRemux(String(task.id ?? ''), task.saveDir, task.saveName)
    }

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
      kind: isRecordTaskOptions(task.options) ? 'record' : 'download',
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

  // 回收崩溃残留的临时目录：经 removeGuarded 校验（命名归属 + path-safety）后删除
  for (const dirPath of staleTmpDirs) {
    if (!existsSync(dirPath)) continue
    removeGuarded(dirPath, [], [])
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
        // 统一走 removeGuarded 入口（path-safety 校验 + deleted/skipped 记录），
        // 删除操作保持单一审计面
        removeGuarded(full, [], [])
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
    throw new Error(rt('downloadUrlRequired'))
  }
  // 仅接受 http(s)：与历史记录净化保持同一标准，阻断 file:、ftp: 等协议流入 CLI 参数
  if (!/^https?:\/\//i.test(requestUrl)) {
    throw new Error(rt('downloadUrlMustBeHttp'))
  }

  const exePath = resolveDownloaderBinary(settings)
  if (!exePath) {
    throw new Error(rt('downloaderNotConfigured'))
  }
  if (!existsSync(exePath)) {
    throw new Error(rt('downloaderPathNotFound', { path: exePath }))
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

  // 并发任务输出文件名唯一化：两个活动任务同名会让 CLI 输出互相覆盖。
  // 除检查活动任务（running/pending）外，还检查同名同目录的后台转封装是否仍在进行，
  // 避免新任务写入正被扫描/删除的文件集；重试链路在启动前已清理旧任务故不受影响
  let effectiveSaveName = typeof options.saveName === 'string' ? options.saveName.trim() : ''
  if (effectiveSaveName) {
    const lowerName = effectiveSaveName.toLowerCase()
    const nameTaken =
      // Windows 文件系统大小写不敏感：必须按小写比较，否则「Stream/stream」
      // 两个并发任务会写同一组物理文件互相覆盖
      Array.from(activeTasks.values()).some(
        (t) =>
          (t.status === 'running' || t.status === 'pending') &&
          String((t as any).saveName || '').toLowerCase() === lowerName
      ) ||
      Array.from(activeRemuxJobs.values()).some(
        (job) => job.stemLower === lowerName && (!job.saveDir || job.saveDir === effectiveSaveDir.toLowerCase())
      )
    if (nameTaken) effectiveSaveName = `${effectiveSaveName}_${taskId.slice(0, 4)}`
  }

  const baseTmpDir = options.tmpDir || settings.tmpDir || defaultTmpDir
  // 每个任务使用独立的临时子目录：并发任务互不干扰，且清理时只删除本任务目录
  const effectiveTmpDir = join(baseTmpDir, `task-${taskId}`)
  // 日志同样按任务隔离：共享同一文件时多进程并发写入会互相交错。
  // 显式传入的 options.logFilePath（单任务指定）保持原样；否则从配置/默认路径派生独立文件，
  // 保留用户配置的目录与文件名前缀（N_m3u8DL-RE → N_m3u8DL-RE_a1b2c3d4.log）
  const configuredLogFilePath = options.logFilePath || settings.logFilePath || defaultLogFilePath
  const effectiveLogFilePath = options.logFilePath || deriveTaskLogPath(configuredLogFilePath, taskId)
  // url 一并归一化为 trim 后的值；saveName 覆盖为唯一化后的值；tmpDir 覆盖为按任务派生的隔离目录
  options = { ...options, url: requestUrl, saveName: effectiveSaveName || undefined, saveDir: effectiveSaveDir, tmpDir: effectiveTmpDir, logFilePath: effectiveLogFilePath }

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
    options: options
  }

  activeTasks.set(taskId, task)
  flushRuntimeTasks()

  // 启动子进程
  const child = spawn(exePath, args, {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: process.platform !== 'win32'
  })

  task.process = child
  task.status = 'running'

  // 测速轮询 2s 一次：递归 stat 全目录的开销与分片数成正比，1s 频率在长录制/大 VOD
  // 场景（数千分片）会造成持续的系统调用压力；速率按实际时间差计算，降频不损精度
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

      latest.speed = formatNetworkSpeed(bytesPerSecond)
      latest.downloadedBytes = Math.max(latest.downloadedBytes, currentBytes)
      latest._lastSpeedBytes = currentBytes
      latest._lastSpeedAt = now

      sendProgressEvent(taskId, latest, mainWindow)
      persistRuntimeTasks()
    } finally {
      const ref = activeTasks.get(taskId) as (DownloadTask & Record<string, any>) | undefined
      if (ref) ref._measuring = false
    }
  }, 2000)
  ;(task as any)._speedTimer = speedTimer

  // 解析 stdout/stderr：按字节攒行 + 自适应字符集解码（GBK/UTF-8），
  // 修复重定向下中文日志乱码与多字节字符被 chunk 截断的问题
  const stdoutReader = new CliLineReader()
  const stderrReader = new CliLineReader()

  child.stdout?.on('data', (data: Buffer) => {
    for (const line of stdoutReader.push(data)) {
      if (line.trim()) {
        parseOutput(taskId, line, mainWindow)
      }
    }
  })

  child.stderr?.on('data', (data: Buffer) => {
    for (const line of stderrReader.push(data)) {
      if (line.trim()) {
        parseOutput(taskId, line, mainWindow)
      }
    }
  })

  // 任务结束（正常退出或被终止）：冲出残留缓冲后统一收尾
  child.on('close', (code) => {
    for (const line of [...stdoutReader.end(), ...stderrReader.end()]) {
      if (line.trim()) {
        parseOutput(taskId, line, mainWindow)
      }
    }
    finalizeTask(taskId, code)
  })

  child.on('error', (err) => {
    const task = activeTasks.get(taskId)
    if (task && task.status !== 'cancelled') {
      task.status = 'failed'
      task.latestLog = `[ERROR] ${err.message}`
    }
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
  // 对同一 pid 重复终止存在 PID 复用误杀风险，故取消路径只执行一次。
  if (task.status === 'cancelled') return true

  task.status = 'cancelled'
  task.latestLog = task.latestLog || rt('taskCancelled')

  if (task.process) {
    if (task.process.pid) {
      // Windows 用 taskkill 终止进程树；类 Unix 优先杀进程组，再兜底单进程。
      // 随后 close 事件触发 finalizeTask 统一收尾（发送事件、清理产物与定时器）。
      terminateProcessTree(task.process.pid)
    } else {
      try {
        task.process.kill('SIGTERM')
      } catch {}
    }
  } else {
    // 进程不存在（如尚未成功启动）：直接收尾
    finalizeTask(taskId, null)
  }

  return true
}

// 仅列 CLI 明确产物后缀；不含裸 .json —— 那会误删用户同名的普通 JSON 文件，
// CLI 产出的元数据是 <stem>.meta.json（--write-meta-json），已单独列出
const ARTIFACT_SUFFIXES = [
  '.part', '.tmp', '.download', '.m3u8', '.meta.json',
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
    skipped.push({ path: String(target ?? ''), reason: localizePathSafetyReason(verdict.reason) || rt('pathValidationFailed') })
    return
  }
  if (!existsSync(verdict.path)) return

  try {
    rmSync(verdict.path, { recursive: true, force: true })
    deleted.push(verdict.path)
  } catch (err) {
    skipped.push({ path: verdict.path, reason: rt('deleteFailedWithReason', { reason: (err as Error).message }) })
  }
}

/** 共享临时目录的保守清理：仅移除文件名包含任务名的条目，绝不整体删除目录本身 */
function cleanupSharedTmpDir(tmpDir: string, stem: string, deleted: string[], skipped: DeleteOutcome['skipped']): void {
  const verdict = isAllowedRecursiveDeleteTarget(tmpDir)
  if (!verdict.ok || !verdict.path) {
    skipped.push({ path: String(tmpDir ?? ''), reason: localizePathSafetyReason(verdict.reason) || rt('pathValidationFailed') })
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
    if (!stem || !artifactStemRegex(stem).test(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      removeGuarded(full, deleted, skipped)
    } else {
      try {
        rmSync(full, { force: true })
        deleted.push(full)
      } catch {
        skipped.push({ path: full, reason: rt('deleteFailed') })
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
        // fileName 来自上方白名单拼接（不含路径分隔符），join 结果必然落在 saveDir 内，
        // 路径穿越防护由 sanitizeTaskInfo + path-safety 承担，此处无需重复判断
        const candidate = join(saveDir, fileName)
        if (!existsSync(candidate)) continue
        try {
          rmSync(candidate, { force: true })
          deleted.push(candidate)
        } catch {
          skipped.push({ path: candidate, reason: rt('deleteFailed') })
        }
      }

      // 数字分片产物（<stem>_00.ts / <stem>_01.mkv 等）不在精确名单内，
      // 按带边界正则补充扫描已知媒体/元数据扩展名；非白名单扩展名不碰
      const candidateRegexes = [artifactStemRegex(stem)]
      if (baseName !== stem) candidateRegexes.push(artifactStemRegex(baseName))
      const knownExtensions = new Set(ARTIFACT_SUFFIXES.map((s) => s.toLowerCase()))
      try {
        for (const entry of readdirSync(saveDir, { withFileTypes: true })) {
          if (!entry.isFile()) continue
          const dotIndex = entry.name.lastIndexOf('.')
          const ext = dotIndex >= 0 ? entry.name.slice(dotIndex).toLowerCase() : ''
          if (!knownExtensions.has(ext)) continue
          if (!candidateRegexes.some((regex) => regex.test(entry.name))) continue
          const fullPath = join(saveDir, entry.name)
          try {
            rmSync(fullPath, { force: true })
            deleted.push(fullPath)
          } catch {
            skipped.push({ path: fullPath, reason: rt('deleteFailed') })
          }
        }
      } catch {}
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
  const mp4decryptPath = resolveOptionalToolBinary(options.mp4decryptPath || settings.mp4decryptPath, 'mp4decrypt')
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
  const ffmpegPath = resolveOptionalToolBinary(options.ffmpegPath || settings.ffmpegPath, 'ffmpeg')
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

  // 全量剥离 ANSI 转义（颜色/光标/OSC）与控制字符，避免残留 "[2K" 类乱码
  const clean = sanitizeCliText(line).trim()
  if (!clean) return

  // 归一化 CLI 自带日志前缀："08:32:22.466 WARN : xxx" → "[WARN] xxx"，
  // 避免与渲染端逐条记录的本地接收时间重复，单行预览也更干净
  const prefixMatch = clean.match(RE_CLI_LOG_PREFIX)
  const normalized = prefixMatch ? `[${prefixMatch[1]}] ${clean.slice(prefixMatch[0].length)}` : clean

  // 内存日志链路已移除：日志正文由 CLI 经 --log-file-path 落盘，
  // 主进程仅保留 latestLog 单行用于 UI 状态预览，不再逐行存储/转发
  task.latestLog = normalized

  // 总分片数：收紧为 CLI 的固定输出形态——流信息表格的管道单元格（"| 123 Segments"）
  // 或带 total/共/总计 关键词的汇总行；裸「数字 + segments」不再采信，避免把
  // 日志正文里的任意计数误当作总分片数
  const segmentSummaryMatch =
    clean.match(/\|\s*(\d+)\s+segments?\b/i) ||
    clean.match(/(?:total|共|总计)\D{0,8}(\d+)\s*(?:个)?\s*(?:segments?|分片|片段)/i)
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

  // 速度以 speedTimer 磁盘差分为唯一权威口径，不解析 CLI 速率行（网络口径 与
  // 本地 IO 口径交替写 task.speed 会致 UI 抖动，Mbps 按字节表解析还差 8 倍）；
  // 原始速率行仍完整展示在任务日志中，不丢失信息。

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
  // 终态由 download:complete 携带，speedTimer 每 2s 兜底一次
  const now = Date.now()
  if (now - ((task as any)._lastProgressSentAt ?? 0) >= PROGRESS_SEND_INTERVAL_MS) {
    ;(task as any)._lastProgressSentAt = now
    sendProgressEvent(taskId, task, mainWindow)
  }

  persistRuntimeTasks()
}
