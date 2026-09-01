import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, Clipboard, Play, Settings2 } from 'lucide-react'
import { useDownloadStore } from '@/store/downloadStore'
import { useSettingsStore } from '@/store/settingsStore'
import { showToast } from '@/components/Toast'
import { useTranslation } from '@/i18n'
import { extractFileName, generateId } from '@/utils/format'
import { isValidUrl } from '@/utils/validators'
import { buildTaskOptions } from '@/utils/taskOptions'
import { isRecordTask } from '@/utils/recording'
import type { DownloadTask } from '@/types/download'

/** 下载 Tab 的单任务下载入口卡片（表单状态自包含） */
export default function DownloadPanel() {
  const { t } = useTranslation()
  const { addTask, setActiveTask } = useDownloadStore()
  const { settings } = useSettingsStore()

  const [downloadUrl, setDownloadUrl] = useState('')
  const [downloadName, setDownloadName] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [threadCount, setThreadCount] = useState(8)
  const [autoSelect, setAutoSelect] = useState(true)
  const [muxFormat, setMuxFormat] = useState('mp4')
  const [maxSpeed, setMaxSpeed] = useState('')
  const [subOnly, setSubOnly] = useState(false)
  const [customArgs, setCustomArgs] = useState('')

  // 设置加载/变更后同步表单默认值
  useEffect(() => {
    setThreadCount(settings.threadCount)
    setAutoSelect(settings.autoSelect)
    setMuxFormat(settings.muxFormat)
  }, [settings])

  // 进行中标记派生自任务列表（单一数据源），不再单独维护 isDownloading state
  const hasActiveDownload = useDownloadStore((state) =>
    state.tasks.some((task) => !isRecordTask(task) && (task.status === 'pending' || task.status === 'running')))
  // 发起请求进行中：防止双击重复创建（任务尚未入列时派生值还未变 true）
  const [starting, setStarting] = useState(false)
  const isDownloading = hasActiveDownload || starting

  const handleUrlChange = (value: string) => {
    setDownloadUrl(value)
    if (!downloadName && value) setDownloadName(extractFileName(value))
  }

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text && isValidUrl(text)) {
        setDownloadUrl(text)
        if (!downloadName) setDownloadName(extractFileName(text))
        showToast('info', t('home.clipboardPasteSuccess'))
      }
    } catch {
      showToast('error', t('home.clipboardReadFailed'))
    }
  }

  const handleStart = async () => {
    if (!downloadUrl.trim()) {
      showToast('error', t('home.downloadUrlRequired'))
      return
    }
    if (!isValidUrl(downloadUrl)) {
      showToast('error', t('home.invalidUrl'))
      return
    }

    const taskOptions = buildTaskOptions(settings, {
      url: downloadUrl.trim(),
      saveName: downloadName || extractFileName(downloadUrl),
      threadCount,
      autoSelect,
      muxFormat,
      maxSpeed: maxSpeed || undefined,
      subOnly,
      customArgs: customArgs || undefined,
    })

    setStarting(true)
    try {
      const result = await window.api.download.start(taskOptions)
      if (!result.success) {
        showToast('error', t('home.startFailed').replace('{error}', String(result.error)))
        return
      }

      const taskId = result.taskId || generateId()
      const task: DownloadTask = {
        id: taskId,
        url: downloadUrl.trim(),
        // 采纳主进程唯一化后的生效名：并发同名任务时主进程会追加短后缀，
        // 记录/历史/删除链路必须与磁盘上的真实产物名一致
        saveName: result.options?.saveName || downloadName || extractFileName(downloadUrl),
        saveDir: settings.saveDir,
        status: 'pending',
        progress: 0,
        speed: '0 KB/s',
        downloadedSegments: 0,
        totalSegments: 0,
        startTime: new Date().toISOString(),
        options: result.options || taskOptions
      }

      addTask(task)
      setActiveTask(taskId)
      showToast('success', t('home.downloadStarted'))
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-2xl leading-none">📥</span>
        <span className="text-sm font-semibold text-slate-800 dark:text-neutral-100">{t('home.downloadEntry')}</span>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={downloadUrl}
          onChange={(e) => handleUrlChange(e.target.value)}
          placeholder={t('home.pasteUrlPlaceholder')}
          className="input-field flex-1"
          onKeyDown={(e) => e.key === 'Enter' && !isDownloading && handleStart()}
        />
        <button onClick={handlePaste} className="btn-secondary flex items-center gap-1.5 whitespace-nowrap text-sm">
          <Clipboard size={14} /> {t('common.paste')}
        </button>
      </div>

      <input
        type="text"
        value={downloadName}
        onChange={(e) => setDownloadName(e.target.value)}
        placeholder={t('home.saveFileNameOptional')}
        className="input-field mt-3"
      />

      <div className="mt-4 flex items-center justify-between gap-2">
        <button onClick={() => setShowAdvanced(!showAdvanced)} className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-neutral-400 hover:text-slate-700 dark:hover:text-slate-200 text-slate-700 dark:text-neutral-200 transition-colors">
          <Settings2 size={13} /> {t('home.advancedOptions')} {showAdvanced ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
        <div className="flex gap-2">
          <button onClick={handleStart} disabled={isDownloading} className="btn-primary flex items-center gap-2 text-sm">
            <Play size={16} /> {isDownloading ? t('home.processing') : t('home.startDownload')}
          </button>
        </div>
      </div>

      {showAdvanced && (
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <div className="p-2">
            <label className="mb-1 block text-[11px] text-slate-500 dark:text-neutral-400">{t('home.threadCount')}</label>
            <input type="number" value={threadCount} onChange={(e) => setThreadCount(Number(e.target.value) || 8)} className="input-field text-sm" min={1} max={64} />
          </div>
          <div className="p-2">
            <label className="mb-1 block text-[11px] text-slate-500 dark:text-neutral-400">{t('home.speedLimit')}</label>
            <input type="text" value={maxSpeed} onChange={(e) => setMaxSpeed(e.target.value)} placeholder="10M" className="input-field text-sm" />
          </div>
          <div className="p-2">
            <label className="mb-1 block text-[11px] text-slate-500 dark:text-neutral-400">{t('home.outputFormat')}</label>
            <select value={muxFormat} onChange={(e) => setMuxFormat(e.target.value)} className="input-field text-sm">
              <option value="mp4">mp4</option>
              <option value="mkv">mkv</option>
            </select>
          </div>
          <div className="p-2">
            <label className="mb-1 block text-[11px] text-slate-500 dark:text-neutral-400">{t('home.customArgs')}</label>
            <input type="text" value={customArgs} onChange={(e) => setCustomArgs(e.target.value)} placeholder="--header ..." className="input-field text-sm" />
          </div>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-slate-50 dark:bg-neutral-800/60 p-2 text-xs text-slate-300 dark:text-neutral-600">
            <input type="checkbox" checked={autoSelect} onChange={(e) => setAutoSelect(e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300 dark:border-white/5 text-blue-500 dark:text-blue-400" /> {t('settings.feature.autoSelect')}
          </label>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-slate-50 dark:bg-neutral-800/60 p-2 text-xs text-slate-300 dark:text-neutral-600">
            <input type="checkbox" checked={subOnly} onChange={(e) => setSubOnly(e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300 dark:border-white/5 text-blue-500 dark:text-blue-400" /> {t('home.onlyDownloadSubtitles')}
          </label>
        </div>
      )}
    </div>
  )
}
