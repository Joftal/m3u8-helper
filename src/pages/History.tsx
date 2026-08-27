import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { motion } from 'framer-motion'
import { Trash2, Search, RotateCcw, FolderOpen, FileOutput } from 'lucide-react'
import { DEFAULT_LOCALE, normalizeLocale } from '../constants/locales'
import { useHistoryStore } from '@/store/historyStore'
import { useSettingsStore } from '@/store/settingsStore'
import { useDownloadStore } from '@/store/downloadStore'
import Modal from '@/components/Modal'
import { showToast } from '@/components/Toast'
import { useTranslation } from '@/i18n'
import { formatDateTime, formatDuration, formatFileSize, extractFileName, generateId } from '@/utils/format'
import { STATUS_ICON_META, getTaskStatusMeta, type HistoryStatusFilter } from '@/utils/status'
import { buildTaskOptions, createTaskRecord } from '@/utils/taskOptions'
import { RECORD_TASK_DEFAULTS } from '@/utils/recording'
import type { HistoryRecord } from '@/types/download'

export default function History() {
  const { t } = useTranslation()
  const { records, loaded, loadHistory, removeRecord, clearHistory } = useHistoryStore()
  const { settings } = useSettingsStore()
  const navigate = useNavigate()
  const taskStatusMeta = getTaskStatusMeta(normalizeLocale(settings.language, DEFAULT_LOCALE))

  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<HistoryStatusFilter>('all')
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  // 正在发起"再次下载"的记录 id：防止双击重复创建任务
  const [redownloadId, setRedownloadId] = useState<string | null>(null)

  useEffect(() => { if (!loaded) loadHistory() }, [loaded])

  const statusCounts = useMemo(() => {
    let completed = 0, failed = 0, cancelled = 0
    for (const r of records) {
      if (r.status === 'completed') completed += 1
      else if (r.status === 'failed') failed += 1
      else cancelled += 1
    }
    return { total: records.length, completed, failed, cancelled }
  }, [records])

  const filteredRecords = useMemo(() => records.filter((r) => {
    if (statusFilter !== 'all' && r.status !== statusFilter) return false
    const q = searchTerm.trim().toLowerCase()
    if (!q) return true
    return r.saveName.toLowerCase().includes(q) ||
      r.url.toLowerCase().includes(q) ||
      r.outputPath.toLowerCase().includes(q)
  }), [records, statusFilter, searchTerm])

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      showToast('info', t('history.copied'))
    } catch {
      showToast('error', t('history.copyFailed'))
    }
  }

  const handleRedownload = async (record: HistoryRecord) => {
    if (redownloadId) return
    if (!/^https?:\/\//i.test(record.url)) {
      showToast('error', t('history.invalidUrl'))
      return
    }

    // 同 URL 已有在途任务时不再重复发起，避免并发写同一输出文件
    const busy = useDownloadStore.getState().tasks.some((t) =>
      t.url === record.url && (t.status === 'pending' || t.status === 'running'))
    if (busy) {
      showToast('info', t('history.busy'))
      return
    }

    // 录制来源的条目必须还原为录制任务：对直播源做普通 VOD 下载是错误语义
    const isRecordEntry = record.kind === 'record'
    const saveName = record.saveName || extractFileName(record.url)
    const options = isRecordEntry
      ? buildTaskOptions(settings, { url: record.url, saveName, ...RECORD_TASK_DEFAULTS })
      : buildTaskOptions(settings, { url: record.url, saveName })

    setRedownloadId(record.id)
    try {
      const result = await window.api.download.start(options)
      if (!result?.success) {
        showToast('error', t('history.startFailed').replace('{error}', String(result?.error || t('common.unknownError'))))
        return
      }

      const taskId = result.taskId || generateId()
      // 采纳主进程解析后的生效参数（隔离 tmpDir、唯一化 saveName），与新建链路保持一致
      const effectiveOptions = result.options ?? options
      const task = createTaskRecord({
        id: taskId,
        url: record.url,
        saveName: effectiveOptions.saveName || saveName,
        saveDir: settings.saveDir,
        options: effectiveOptions
      })
      useDownloadStore.getState().addTask(task)
      useDownloadStore.getState().setActiveTask(taskId)
      showToast('success', isRecordEntry ? t('history.redownloadRecord') : t('history.redownload'))
      // 携带目标 Tab：录制条目还原的任务在「录制任务」页签下
      navigate('/', { state: { tab: isRecordEntry ? 'record' : 'download' } })
    } finally {
      setRedownloadId(null)
    }
  }

  const handleOpenFolder = async (record: HistoryRecord) => {
    if (!record.outputPath) {
      showToast('info', t('history.noOutputPath'))
      return
    }
    const error = await window.api.shell.openPath(record.outputPath)
    if (error) {
      showToast('error', t('history.openFolderFailed').replace('{error}', String(error)))
    } else {
      showToast('success', t('history.folderOpened'))
    }
  }

  const exportRecords = () => {
    if (filteredRecords.length === 0) {
      showToast('info', t('history.noExport'))
      return
    }

    const rows = filteredRecords.map((r) => ({
      [t('home.taskName')]: r.saveName,
      [t('history.recordType')]: r.kind === 'record' ? t('history.typeRecord') : t('history.typeDownload'),
      [t('history.status')]: taskStatusMeta[r.status].label,
      [t('history.startedAt')]: formatDateTime(r.startTime),
      [t('history.durationSeconds')]: r.duration,
      [t('history.fileSizeBytes')]: r.fileSize,
      [t('history.outputPath')]: r.outputPath,
      [t('history.url')]: r.url
    }))
    const worksheet = XLSX.utils.json_to_sheet(rows)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, t('history.exportSheet'))
    // 文件名使用本地日期：toISOString 是 UTC，跨时区临近午夜时会偏移一天
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    XLSX.writeFile(workbook, `m3u8-helper-records-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.xlsx`)
    showToast('success', t('history.exportDone').replace('{count}', String(rows.length)))
  }

  const filterCount = (key: HistoryStatusFilter): number =>
    key === 'all' ? statusCounts.total : statusCounts[key]

  const statusFilters = [
    { key: 'all', label: t('history.filterAll') },
    { key: 'completed', label: t('history.filterCompleted') },
    { key: 'failed', label: t('history.filterFailed') },
    { key: 'cancelled', label: t('history.filterCancelled') }
  ] as const

  return (
    <div className="flex flex-1 flex-col gap-6">
      <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="page-header">
        <div>
          <div className="page-kicker">{t('history.pageKicker')}</div>
          <h1 className="page-title">{t('history.pageTitle')}</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportRecords} disabled={filteredRecords.length === 0}
            className="btn-secondary flex items-center gap-1.5 text-xs font-semibold" >
            <FileOutput size={14} /> {t('history.export')}
          </button>
          <button onClick={() => setShowClearConfirm(true)} disabled={records.length === 0}
            className="btn-secondary flex items-center gap-1.5 text-xs font-semibold">
            <Trash2 size={14} /> {t('history.clear')}
          </button>
        </div>
      </motion.div>

      <Modal open={showClearConfirm} onClose={() => setShowClearConfirm(false)} title={t('history.clearConfirmTitle')} width="max-w-md">
        <div className="space-y-4">
          <div className="rounded-xl border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/10 px-3 py-2.5 text-sm leading-6 text-amber-800 dark:text-amber-300">
            {t('history.clearConfirmText').replace('{count}', String(records.length))}
          </div>
          <div className="flex items-center justify-end gap-2 pt-1">
            <button onClick={() => setShowClearConfirm(false)}
              className="rounded-lg border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3.5 py-2 text-sm font-medium text-slate-300 dark:text-neutral-600 transition hover:bg-slate-100 dark:hover:bg-neutral-800 hover:bg-slate-50 dark:hover:bg-neutral-800/60">
              {t('common.cancel')}
            </button>
            <button onClick={async () => {
              const ok = await clearHistory()
              setShowClearConfirm(false)
              ok ? showToast('success', t('history.historyCleared')) : showToast('error', t('history.clearHistoryFailed'))
            }}
              className="rounded-lg border border-red-200 dark:border-red-500/20 bg-red-600 px-3.5 py-2 text-sm font-medium text-white transition">
              {t('history.clearConfirmTitle')}
            </button>
          </div>
        </div>
      </Modal>

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 }} className="card p-4">
        <div className="flex items-center gap-2.5">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-neutral-400" />
            <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
             placeholder={t('history.searchPlaceholder')} className="input-field pl-9" />
          </div>
        </div>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {statusFilters.map(({ key, label }) => {
            const active = statusFilter === key
            return (
              <button key={key} onClick={() => setStatusFilter(key)}
                className={`rounded-full border px-3 py-1 text-[11px] font-medium transition ${
 active
 ? 'border-blue-200 dark:border-blue-500/25 border-blue-200 dark:border-blue-500/25 bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300'
 : 'border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-slate-500 dark:text-neutral-400 hover:bg-slate-100 dark:hover:bg-neutral-800'
 }`}>
                {label}
                <span className="ml-1 text-[10px] text-slate-500 dark:text-neutral-400">{filterCount(key)}</span>
              </button>
            )
          })}
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }} className="flex flex-1 flex-col space-y-3">
        {filteredRecords.length === 0 ? (
          <div className="card flex flex-1 flex-col items-center justify-center p-12 text-center">
            <span className="text-5xl leading-none">🕘</span>
           <p className="text-sm text-slate-500 dark:text-neutral-400">{records.length === 0 ? t('history.noRecords') : t('history.noMatches')}</p>
          </div>
        ) : (
          filteredRecords.map((record, index) => (
            <motion.div key={record.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(index * 0.02, 0.3) }}
              className="card-hover p-3.5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center">
                  {record.kind === 'record'
                    ? <span className="text-2xl leading-none">📹</span>
                    : <span className="text-2xl leading-none">📥</span>}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-slate-800 dark:text-neutral-100">{record.saveName}</span>
                    <span title={taskStatusMeta[record.status].label} className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
                      {(() => {
                        const Meta = STATUS_ICON_META[record.status]
                        return <Meta.Icon size={14} className={Meta.className} />
                      })()}
                    </span>
                  </div>
                  <p className="mt-0.5 cursor-pointer truncate text-xs text-slate-500 dark:text-neutral-400 hover:text-blue-600 dark:hover:text-blue-400"
                    title={t('history.copyLink')}
                    onClick={() => copyText(record.url)}>
                    {record.url}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-slate-500 dark:text-neutral-400">
                    <span>{formatDateTime(record.startTime)}</span>
                    {record.duration > 0 && <span>{t('history.durationLabel')} {formatDuration(record.duration)}</span>}
                    {record.fileSize > 0 && <span>{formatFileSize(record.fileSize)}</span>}
                    {record.outputPath && (
                      <button onClick={() => handleOpenFolder(record)}
                        className="flex min-w-0 items-center gap-1 hover:text-blue-600 dark:hover:text-blue-400" title={record.outputPath}>
                        <FolderOpen size={11} className="shrink-0" />
                        <span className="truncate max-w-[220px]">{record.outputPath}</span>
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button onClick={() => handleRedownload(record)}
                    title={record.kind === 'record' ? t('history.redownloadRecordTooltip') : t('history.redownloadTooltip')}
                    disabled={redownloadId !== null}
                    className={`flex h-7 w-7 items-center justify-center rounded-md text-slate-400 dark:text-neutral-500 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${record.kind === 'record' ? 'hover:bg-red-50 dark:hover:bg-red-500/15 hover:text-red-500 dark:hover:text-red-400 dark:hover:bg-red-500/10 dark:hover:text-red-400' : 'hover:bg-emerald-50 dark:hover:bg-emerald-500/15 hover:text-emerald-600 dark:hover:text-emerald-400 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-400'}`}>
                    <RotateCcw size={13} />
                  </button>
                  <button onClick={() => handleOpenFolder(record)} title={t('history.openFolderTooltip')}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 dark:text-neutral-400 transition-colors bg-blue-50 dark:bg-blue-500/10 hover:text-blue-600 dark:hover:text-blue-400">
                    <FolderOpen size={13} />
                  </button>
                  <button onClick={async () => {
                    const ok = await removeRecord(record.id)
                    ok ? showToast('success', t('history.recordDeleted')) : showToast('error', t('history.deleteRecordFailed'))
                  }}
                    title={t('history.deleteRecordTooltip')}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 dark:text-neutral-400 transition-colors bg-red-50/40 dark:bg-red-500/10 bg-red-50 dark:bg-red-500/10 hover:text-red-500 dark:hover:text-red-400">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            </motion.div>
          ))
        )}
      </motion.div>
    </div>
  )
}
