import { useTranslation } from '@/i18n'
import { useSettingsStore } from '@/store/settingsStore'
import { extractUrlHost, formatDuration, formatFileSize } from '@/utils/format'
import { getRecordDurationSeconds, getRecordElapsedSeconds, getRecordLimitSeconds, isRecordTask } from '@/utils/recording'
import { getTaskStatusMeta, STATUS_ICON_META } from '@/utils/status'
import type { DownloadTask } from '@/types/download'

interface TaskListProps {
  tasks: DownloadTask[]
  activeTab: 'download' | 'record'
  /** 录制计时基准：由 Home 的 ticker 驱动（仅录制 Tab 有活跃任务时每秒跳动） */
  nowTs: number
  cancellingIds: string[]
  onCancel: (task: DownloadTask) => void
  onRetry: (task: DownloadTask) => void
  onDelete: (task: DownloadTask) => void
  onStopRecord: (taskId: string) => void
  onOpenFolder: (task: DownloadTask) => void
}

/** 任务列表：下载行与录制卡片两种形态，按 Tab 过滤后渲染 */
export default function TaskList({ tasks, activeTab, nowTs, cancellingIds, onCancel, onRetry, onDelete, onStopRecord, onOpenFolder }: TaskListProps) {
  const { t, locale } = useTranslation()
  const statusMeta = getTaskStatusMeta(locale)
  const { settings } = useSettingsStore()

  const renderRecordCard = (task: DownloadTask) => {
    const live = task.status === 'running' || task.status === 'pending'
    const elapsed = getRecordElapsedSeconds(task, nowTs)
    const limitSeconds = getRecordLimitSeconds(task)
    const limitPct = live && limitSeconds > 0 && elapsed !== null
      ? Math.min(100, (elapsed / limitSeconds) * 100)
      : 0
    const captured = Number(task.downloadedBytes || 0)
    const isCancelling = cancellingIds.includes(task.id)
    const finishedDuration = getRecordDurationSeconds(task)
    const remaining = limitSeconds - (elapsed ?? 0)
    // 直播模式下 CLI 不输出可解析的逐分片进度，故不展示分片数
    // 仅展示主机名：完整链接含授权参数，既占位又不宜裸露（悬停可见）
    const host = extractUrlHost(task.url)

    return (
      <div key={task.id} className={`rounded-2xl border p-3 shadow-sm ${live ? 'border-red-200 dark:border-red-500/20 bg-red-50/40 dark:bg-red-500/10' : 'border-slate-200 dark:border-neutral-800 bg-slate-50/70 dark:bg-neutral-800/50'}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h3 className="truncate text-[14px] font-semibold text-slate-800 dark:text-neutral-100" title={task.url}>{task.saveName || host || task.url}</h3>
              {!live && (
                <span
                  title={statusMeta[task.status].label}
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center"
                >
                  {(() => {
                    const Meta = STATUS_ICON_META[task.status]
                    return <Meta.Icon size={14} className={`${Meta.className}${Meta.spin ? ' animate-spin' : ''}`} />
                  })()}
                </span>
              )}
            </div>
            {host && <p className="truncate text-[11px] text-slate-500 dark:text-neutral-400" title={task.url}>{host}</p>}
          </div>

          {live && (
            <div className="shrink-0 text-right">
              <div className="font-mono text-xl font-bold tabular-nums tracking-tight text-slate-900 dark:text-neutral-50">{formatDuration(elapsed ?? 0)}</div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-red-500 dark:text-red-400">{t('home.recordingInProgress')}</div>
            </div>
          )}
        </div>

        {live && limitSeconds > 0 && (
          <div className="mt-2">
            <div className="h-1 overflow-hidden rounded-full bg-slate-200 dark:bg-neutral-700">
              <div className="h-full rounded-full bg-red-500 transition-all" style={{ width: `${limitPct}%` }} />
            </div>
            <div className="mt-0.5 flex justify-between text-[10px] text-slate-500 dark:text-neutral-400">
              <span>{t('home.recordLimit')} {task.options?.liveRecordLimit}</span>
              <span>{remaining > 0 ? t('home.taskAction.timeRemaining').replace('{time}', formatDuration(remaining)) : t('home.taskAction.timeLimitReached')}</span>
            </div>
          </div>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-0.5 font-mono text-[11px] tabular-nums text-slate-500 dark:text-neutral-400">
          {captured > 0 && <span>{t('home.captured').replace('{size}', formatFileSize(captured))}</span>}
          {!live && finishedDuration !== null && (
            <span title={t('home.wallClockHint')}>{t('home.wallClockDuration').replace('{time}', formatDuration(finishedDuration))}</span>
          )}
        </div>

        <div className="mt-2.5 flex items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-900/60 bg-white dark:bg-neutral-900 px-3 py-1.5">
          <div className="min-w-0 truncate text-[11px] text-slate-500 dark:text-neutral-400" title={task.saveDir || settings.saveDir}>
            {t('home.saveTo')} {task.saveDir || settings.saveDir || t('home.saveToDefault')}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {(task.saveDir || settings.saveDir) && (
              <button onClick={() => onOpenFolder(task)}
                className="rounded-md border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-2 py-1 text-[10px] font-medium text-slate-300 dark:text-neutral-600 hover:bg-slate-100 dark:hover:bg-neutral-800">
                {t('home.open')}
              </button>
            )}
            {live ? (
              <button onClick={() => onStopRecord(task.id)} disabled={isCancelling}
                className="rounded-md border border-red-200 dark:border-red-500/20 bg-red-50/40 dark:bg-red-500/10 px-2.5 py-1 text-[10px] font-semibold text-red-500 dark:text-red-400 disabled:cursor-not-allowed disabled:opacity-60">
                {isCancelling ? t('home.stopInProgress') : t('home.stop')}
              </button>
            ) : (
              <>
                {task.status === 'failed' && (
                  <button onClick={() => onRetry(task)}
                    className="rounded-md border border-emerald-200 dark:border-emerald-500/20 bg-emerald-50 dark:bg-emerald-500/10 px-2 py-1 text-[10px] font-medium text-emerald-500 dark:text-emerald-400">
                    {t('home.retry')}
                  </button>
                )}
                <button onClick={() => onDelete(task)}
                  className="rounded-md border border-red-200 dark:border-red-500/20 bg-red-50/40 dark:bg-red-500/10 px-2 py-1 text-[10px] font-medium text-red-500 dark:text-red-400">
                  {t('home.delete')}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

  const renderTaskRow = (task: DownloadTask) => {
    if (isRecordTask(task)) return renderRecordCard(task)
    const progress = Math.min(100, Math.max(0, Number(task.progress) || 0))
    const canCancel = task.status === 'running' || task.status === 'pending'
    const canRetry = task.status === 'failed' || task.status === 'cancelled'
    const canDelete = task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled'
    const statusText = task.status === 'running' ? t('home.downloadInProgress') : statusMeta[task.status].label
    const StatusIcon = STATUS_ICON_META[task.status]

    return (
      <div key={task.id} className="rounded-2xl border border-slate-200 dark:border-neutral-800 bg-slate-50/70 dark:bg-neutral-800/50 p-2.5 shadow-sm">
        <div className="flex items-center gap-2.5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <h3 className="truncate text-[14px] font-semibold text-slate-800 dark:text-neutral-100">{task.saveName || task.url}</h3>
              <span title={statusText} className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
                <StatusIcon.Icon size={14} className={`${StatusIcon.className}${StatusIcon.spin ? ' animate-spin' : ''}`} />
              </span>
            </div>

            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-neutral-700">
                <div
                  className={`h-full rounded-full ${task.status === 'completed' ? 'bg-emerald-500' : task.status === 'failed' ? 'bg-red-500' : task.status === 'cancelled' ? 'bg-amber-500' : 'bg-blue-500'}`}
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="text-[10px] font-medium text-slate-500 dark:text-neutral-400">{Math.round(progress)}%</span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              onClick={() => canCancel && onCancel(task)}
              disabled={!canCancel}
              className={`rounded-md border px-2 py-1 text-[10px] font-medium ${canCancel ? 'border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-500/20' : 'cursor-not-allowed border-slate-200 dark:border-neutral-800 bg-slate-100 dark:bg-neutral-800 text-slate-400 dark:text-neutral-500'}`}
            >
              {t('home.taskAction.cancel')}
            </button>
            <button
              onClick={() => canRetry && onRetry(task)}
              disabled={!canRetry}
              className={`rounded-md border px-2 py-1 text-[10px] font-medium ${canRetry ? 'border-emerald-200 dark:border-emerald-500/20 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-500/20' : 'cursor-not-allowed border-slate-200 dark:border-neutral-800 bg-slate-100 dark:bg-neutral-800 text-slate-400 dark:text-neutral-500'}`}
            >
              {t('home.taskAction.retry')}
            </button>
            <button
              onClick={() => canDelete && onDelete(task)}
              disabled={!canDelete}
              className={`rounded-md border px-2 py-1 text-[10px] font-medium ${canDelete ? 'border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-500/20' : 'cursor-not-allowed border-slate-200 dark:border-neutral-800 bg-slate-100 dark:bg-neutral-800 text-slate-400 dark:text-neutral-500'}`}
            >
              {t('home.taskAction.delete')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-bold tracking-[0.18em] text-slate-500 dark:text-neutral-400 uppercase">{t('home.taskList')}</div>
        <span className="text-xs text-slate-500 dark:text-neutral-400">{tasks.length} {t('common.tasks')}</span>
      </div>
      <div className="card flex flex-1 flex-col p-3">
        <div className="flex flex-1 flex-col gap-2">
          {tasks.length > 0 ? tasks.map((task) => renderTaskRow(task)) : (
            <div className="flex min-h-[220px] flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 dark:border-white/5 bg-slate-50 dark:bg-neutral-800/60 px-4 py-10 text-center">
              {activeTab === 'record'
                ? <span className="text-3xl leading-none">📹</span>
                : <span className="text-3xl leading-none">📄</span>}
              <p className="text-sm text-slate-500 dark:text-neutral-400">{t('home.noTasks').replace('{type}', activeTab === 'download' ? t('home.downloadTask') : t('home.recordTask'))}</p>
              <p className="text-xs text-slate-500 dark:text-neutral-400">{t('home.noTasksHint').replace('{type}', activeTab === 'download' ? t('home.downloadTask') : t('home.recordTask'))}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
