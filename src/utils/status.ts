import { Ban, CheckCircle, Clock, Loader2, XCircle, type LucideIcon } from 'lucide-react'

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

/** 任务状态元数据的唯一来源：标签文案 + 徽标配色（Home/History 共用） */
export const TASK_STATUS_META: Record<TaskStatus, { label: string; tone: string }> = {
  pending: { label: '等待', tone: 'bg-slate-100 text-slate-600' },
  running: { label: '进行中', tone: 'bg-blue-50 text-blue-700' },
  completed: { label: '已完成', tone: 'bg-emerald-50 text-emerald-700' },
  failed: { label: '失败', tone: 'bg-red-50 text-red-700' },
  cancelled: { label: '已取消', tone: 'bg-amber-50 text-amber-700' }
} as const

/** 状态图标徽标元数据：任务列表与任务记录共用同一套图标语言 */
export const STATUS_ICON_META: Record<TaskStatus, { Icon: LucideIcon; className: string; spin?: boolean }> = {
  pending: { Icon: Clock, className: 'text-slate-400 dark:text-neutral-500' },
  running: { Icon: Loader2, className: 'text-blue-500 dark:text-blue-400', spin: true },
  completed: { Icon: CheckCircle, className: 'text-emerald-500 dark:text-emerald-400' },
  failed: { Icon: XCircle, className: 'text-red-500 dark:text-red-400' },
  cancelled: { Icon: Ban, className: 'text-amber-500 dark:text-amber-400' }
}

export const HISTORY_STATUS_FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'completed', label: '已完成' },
  { key: 'failed', label: '失败' },
  { key: 'cancelled', label: '已取消' }
] as const

export type HistoryStatusFilter = (typeof HISTORY_STATUS_FILTERS)[number]['key']
