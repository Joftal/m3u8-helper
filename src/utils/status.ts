import { Ban, CheckCircle, Clock, Loader2, XCircle, type LucideIcon } from 'lucide-react'
import { DEFAULT_LOCALE, normalizeLocale } from '../constants/locales'
import { messages, type Locale } from '../i18n'

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export const TASK_STATUS_META_BASE: Record<TaskStatus, { label: string; tone: string }> = {
  pending: { label: messages.zh.status.pending, tone: 'bg-slate-100 text-slate-600' },
  running: { label: messages.zh.status.running, tone: 'bg-blue-50 text-blue-700' },
  completed: { label: messages.zh.status.completed, tone: 'bg-emerald-50 text-emerald-700' },
  failed: { label: messages.zh.status.failed, tone: 'bg-red-50 text-red-700' },
  cancelled: { label: messages.zh.status.cancelled, tone: 'bg-amber-50 text-amber-700' }
} as const

export const getTaskStatusMeta = (locale: Locale = DEFAULT_LOCALE) => {
  const safeLocale = normalizeLocale(locale, DEFAULT_LOCALE)
  return {
    pending: { label: messages[safeLocale].status.pending, tone: TASK_STATUS_META_BASE.pending.tone },
    running: { label: messages[safeLocale].status.running, tone: TASK_STATUS_META_BASE.running.tone },
    completed: { label: messages[safeLocale].status.completed, tone: TASK_STATUS_META_BASE.completed.tone },
    failed: { label: messages[safeLocale].status.failed, tone: TASK_STATUS_META_BASE.failed.tone },
    cancelled: { label: messages[safeLocale].status.cancelled, tone: TASK_STATUS_META_BASE.cancelled.tone }
  }
}

export const TASK_STATUS_META = TASK_STATUS_META_BASE

/** 状态图标徽标元数据：任务列表与任务记录共用同一套图标语言 */
export const STATUS_ICON_META: Record<TaskStatus, { Icon: LucideIcon; className: string; spin?: boolean }> = {
  pending: { Icon: Clock, className: 'text-slate-400 dark:text-neutral-500' },
  running: { Icon: Loader2, className: 'text-blue-500 dark:text-blue-400', spin: true },
  completed: { Icon: CheckCircle, className: 'text-emerald-500 dark:text-emerald-400' },
  failed: { Icon: XCircle, className: 'text-red-500 dark:text-red-400' },
  cancelled: { Icon: Ban, className: 'text-amber-500 dark:text-amber-400' }
}

export const HISTORY_STATUS_FILTERS_BASE = [
  { key: 'all', label: messages.zh.history.filterAll },
  { key: 'completed', label: messages.zh.history.filterCompleted },
  { key: 'failed', label: messages.zh.history.filterFailed },
  { key: 'cancelled', label: messages.zh.history.filterCancelled }
] as const

export const getHistoryStatusFilters = (locale: Locale = DEFAULT_LOCALE) => {
  const safeLocale = normalizeLocale(locale, DEFAULT_LOCALE)
  return [
    { key: 'all', label: messages[safeLocale].history.filterAll },
    { key: 'completed', label: messages[safeLocale].history.filterCompleted },
    { key: 'failed', label: messages[safeLocale].history.filterFailed },
    { key: 'cancelled', label: messages[safeLocale].history.filterCancelled }
  ] as const
}

export const HISTORY_STATUS_FILTERS = HISTORY_STATUS_FILTERS_BASE

export type HistoryStatusFilter = (typeof HISTORY_STATUS_FILTERS)[number]['key']
