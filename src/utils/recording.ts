import type { DownloadTask } from '../types/download'

/** 单文件分片数默认值（--live-take-count 的 CLI 默认），全站唯一来源 */
export const DEFAULT_LIVE_TAKE_COUNT = 16

/**
 * 录制任务的默认选项基座：历史页「再次执行」还原录制任务时使用，
 * 与首页录制入口的出厂默认保持一致（首页表单值仍由用户输入覆盖）。
 */
export const RECORD_TASK_DEFAULTS = {
  autoSelect: true,
  muxFormat: 'mkv',
  kind: 'record' as const,
  liveRealTimeMerge: true,
  livePipeMux: false,
  livePerformAsVod: false,
  liveFixVttByAudio: false,
  liveTakeCount: DEFAULT_LIVE_TAKE_COUNT
}

/** 录制时长限制上限：7 天，防止误输入超长时限导致任务永不停止 */
export const MAX_LIVE_RECORD_LIMIT_SECONDS = 7 * 24 * 3600

const LIVE_OPTION_KEYS = [
  'liveRecordLimit',
  'liveTakeCount',
  'liveRealTimeMerge',
  'livePipeMux',
  'livePerformAsVod',
  'liveFixVttByAudio'
] as const

/**
 * 判定选项是否属于录制任务。
 * 显式 kind 标记优先；旧版持久化快照无 kind，回退到 live 字段嗅探保持兼容。
 */
export function isRecordTaskOptions(options: unknown): boolean {
  if (!options || typeof options !== 'object') return false
  const opts = options as Record<string, unknown>
  if (opts.kind === 'record') return true
  if (opts.kind === 'download') return false
  return LIVE_OPTION_KEYS.some((key) => key in opts)
}

/** 判定任务是否为录制任务 */
export function isRecordTask(task: { options?: unknown } | null | undefined): boolean {
  return isRecordTaskOptions(task?.options)
}

/**
 * 解析 "HH:mm:ss" / "mm:ss" 为秒。
 * 返回值语义：>0 有效秒数；-1 格式非法或时长为零/负（零时长限额无意义）；-2 超出上限。
 */
export function parseLiveLimitRaw(raw: string): number {
  const trimmed = raw.trim()
  if (!trimmed) return -1
  const parts = trimmed.split(':').map(Number)
  if (parts.length < 2 || parts.length > 3) return -1
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return -1
  const seconds = parts.length === 3
    ? parts[0] * 3600 + parts[1] * 60 + parts[2]
    : parts[0] * 60 + parts[1]
  if (seconds <= 0) return -1
  if (seconds > MAX_LIVE_RECORD_LIMIT_SECONDS) return -2
  return seconds
}

/**
 * 将用户输入的录制时限规范化为明确的 "HH:mm:ss" 再传给 CLI。
 *
 * 必须这样做：CLI（.NET）对两段式输入按 TimeSpan 规则解释为 hh:mm
 * （如 "00:30" = 30 分钟），与 GUI 校验的 mm:ss 语义相悖，
 * 导致限额静默失效。先在本地解析成秒、再展开为三段式，杜绝双端歧义。
 * 未填写或非法返回 undefined（不限时）。
 */
export function formatLiveLimitForCli(raw: string): string | undefined {
  const seconds = parseLiveLimitRaw(raw)
  if (seconds <= 0) return undefined
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':')
}

/**
 * 录制实际开始时间（毫秒）：固定使用任务 startTime（IPC spawn 成功时刻）。
 * 内存日志链路移除后，startTime 是全场景（含重启恢复）唯一一致的计时基准。
 */
export function getRecordStartMs(task: Pick<DownloadTask, 'startTime'>): number {
  const start = Date.parse(task.startTime)
  return Number.isNaN(start) ? Date.now() : start
}

/** 已录时长（秒）；非活跃任务返回 null（无持续计时语义） */
export function getRecordElapsedSeconds(task: DownloadTask, nowTs: number): number | null {
  if (task.status !== 'running' && task.status !== 'pending') return null
  return Math.max(0, Math.floor((nowTs - getRecordStartMs(task)) / 1000))
}

/** 录制限额秒数；未配置或非法返回 0（隐藏限额条） */
export function getRecordLimitSeconds(task: DownloadTask): number {
  const raw = String((task.options as unknown as Record<string, unknown> | undefined)?.liveRecordLimit ?? '')
  const seconds = parseLiveLimitRaw(raw)
  return seconds > 0 ? seconds : 0
}

/** 录制总时长（秒）：基于 endTime 与实际开始时间；数据缺失返回 null */
export function getRecordDurationSeconds(task: DownloadTask): number | null {
  if (!task.endTime) return null
  const end = Date.parse(task.endTime)
  if (Number.isNaN(end)) return null
  return Math.max(0, Math.floor((end - getRecordStartMs(task)) / 1000))
}
