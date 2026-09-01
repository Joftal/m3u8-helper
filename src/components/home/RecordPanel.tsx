import { useState } from 'react'
import { ChevronDown, ChevronUp, Clipboard, Play, Settings2 } from 'lucide-react'
import { useDownloadStore } from '@/store/downloadStore'
import { useSettingsStore } from '@/store/settingsStore'
import { showToast } from '@/components/Toast'
import { useTranslation } from '@/i18n'
import { extractFileName, generateId } from '@/utils/format'
import { isValidUrl } from '@/utils/validators'
import { buildTaskOptions } from '@/utils/taskOptions'
import { DEFAULT_LIVE_TAKE_COUNT, formatLiveLimitForCli, parseLiveLimitRaw } from '@/utils/recording'
import type { DownloadTask } from '@/types/download'

/** 录制 Tab 的直播录制入口卡片（表单状态自包含） */
export default function RecordPanel() {
  const { t } = useTranslation()
  const { addTask } = useDownloadStore()
  const { settings } = useSettingsStore()

  const [recordUrl, setRecordUrl] = useState('')
  const [recordName, setRecordName] = useState('')
  // 录制发起请求进行中：防止双击重复创建
  const [recordStarting, setRecordStarting] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [liveRealTimeMerge, setLiveRealTimeMerge] = useState(true)
  const [livePipeMux, setLivePipeMux] = useState(false)
  const [livePerformAsVod, setLivePerformAsVod] = useState(false)
  const [liveFixVttByAudio, setLiveFixVttByAudio] = useState(false)
  const [liveRecordLimit, setLiveRecordLimit] = useState('')
  const [liveWaitTime, setLiveWaitTime] = useState('')
  const [liveTakeCount, setLiveTakeCount] = useState(() => String(DEFAULT_LIVE_TAKE_COUNT))

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text && isValidUrl(text)) {
        setRecordUrl(text)
        if (!recordName) setRecordName(extractFileName(text))
        showToast('info', t('home.clipboardPasteSuccess'))
      }
    } catch {
      showToast('error', t('home.clipboardReadFailed'))
    }
  }

  const handleRecordStart = async () => {
    const trimmedUrl = recordUrl.trim()
    if (!trimmedUrl) {
      showToast('error', t('home.liveUrlRequired'))
      return
    }
    if (!isValidUrl(trimmedUrl)) {
      showToast('error', t('home.invalidLiveUrl'))
      return
    }

    // 同链接去重：与历史页“再次下载”的并发保护保持一致，避免两个任务写同一输出文件
    const busy = useDownloadStore.getState().tasks.some((candidate) =>
      candidate.url === trimmedUrl && (candidate.status === 'pending' || candidate.status === 'running'))
    if (busy) {
      showToast('info', t('home.taskExists'))
      return
    }

    // parseLiveLimitRaw 语义：-1 格式非法（含零时长）；-2 超出上限（7 天）
    const limitResult = parseLiveLimitRaw(liveRecordLimit)
    if (limitResult === -2) {
      showToast('error', t('home.maxLiveLimit'))
      return
    }
    if (limitResult < 0 && liveRecordLimit.trim()) {
      showToast('error', t('home.invalidLiveLimit'))
      return
    }
    const waitRaw = liveWaitTime.trim()
    if (waitRaw) {
      const wait = Number(waitRaw)
      if (!Number.isFinite(wait) || wait < 0) {
        showToast('error', t('home.invalidWait'))
        return
      }
    }
    const takeRaw = liveTakeCount.trim()
    const takeCount = Number(takeRaw)
    if (takeRaw && (!Number.isInteger(takeCount) || takeCount < 1 || takeCount > 100)) {
      showToast('error', t('home.invalidTakeCount'))
      return
    }

    // 录制固定使用 MKV 封装：未完成的 MKV 仍可播放，
    // 规避硬杀进程导致 MP4 缺失 moov atom 而无法播放的问题；
    // kind: 'record' 为显式分类标记，供 Tab 归类与主进程清理/通知策略使用
    const taskOptions = buildTaskOptions(settings, {
      url: trimmedUrl,
      saveName: recordName || extractFileName(trimmedUrl),
      autoSelect: true,
      muxFormat: 'mkv',
      kind: 'record',
      liveRealTimeMerge,
      livePipeMux,
      livePerformAsVod,
      liveFixVttByAudio,
      // 规范化为 HH:mm:ss 三段式：CLI 对两段式输入按 hh:mm 解释，
      // 直接透传原始字符串会导致限额语义静默偏移（00:30 → 30 分钟）
      liveRecordLimit: formatLiveLimitForCli(liveRecordLimit),
      liveWaitTime: waitRaw ? Number(waitRaw) : undefined,
      liveTakeCount: takeRaw ? takeCount : DEFAULT_LIVE_TAKE_COUNT,
    })

    setRecordStarting(true)
    try {
      const result = await window.api.download.start(taskOptions)
      if (!result.success) {
        showToast('error', t('home.startFailed').replace('{error}', String(result.error)))
        return
      }

      const taskId = result.taskId || generateId()
      const task: DownloadTask = {
        id: taskId,
        url: trimmedUrl,
        // 采纳主进程唯一化后的生效名（并发同名录制时追加短后缀），保证产物清理/历史一致
        saveName: result.options?.saveName || recordName || extractFileName(trimmedUrl),
        saveDir: settings.saveDir,
        status: 'running',
        progress: 0,
        speed: '0 KB/s',
        downloadedSegments: 0,
        totalSegments: 0,
        startTime: new Date().toISOString(),
        options: result.options || taskOptions
      }

      addTask(task)
      showToast('success', t('home.recordingStarted'))
    } finally {
      setRecordStarting(false)
    }
  }

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-2xl leading-none">📹</span>
        <span className="text-sm font-semibold text-slate-800 dark:text-neutral-100">{t('home.recordEntry')}</span>
      </div>

      <div className="space-y-2.5">
        <input type="text" value={recordUrl} onChange={(e) => setRecordUrl(e.target.value)} placeholder={t('home.pasteLiveUrlPlaceholder')} className="input-field" />
        <input type="text" value={recordName} onChange={(e) => setRecordName(e.target.value)} placeholder={t('home.saveFileNameOptional')} className="input-field" />
      </div>

      <div className="mt-4 flex gap-2">
        <button onClick={handlePaste} className="btn-secondary flex items-center gap-1.5 text-sm"><Clipboard size={14} /> {t('common.paste')}</button>
        <button onClick={() => setShowAdvanced(!showAdvanced)} className="btn-secondary flex items-center gap-1.5 text-sm">
          <Settings2 size={14} /> {t('home.options')} {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {showAdvanced && (
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          {[
            { v: liveRealTimeMerge, s: setLiveRealTimeMerge, l: t('home.liveRealTimeMerge') },
            { v: livePipeMux, s: setLivePipeMux, l: t('home.livePipeMux') },
            { v: livePerformAsVod, s: setLivePerformAsVod, l: t('home.livePerformAsVod') },
            { v: liveFixVttByAudio, s: setLiveFixVttByAudio, l: t('home.liveFixVttByAudio') },
          ].map(({ v, s, l }) => (
            <label key={l} className="flex cursor-pointer items-center gap-2 rounded-lg bg-slate-50 dark:bg-neutral-800/60 p-2 text-xs text-slate-300 dark:text-neutral-600">
              <input type="checkbox" checked={v} onChange={(e) => s(e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300 dark:border-white/5 text-red-500 dark:text-red-400" />
              {l}
            </label>
          ))}
          <div className="p-2">
            <label className="mb-1 block text-[11px] text-slate-500 dark:text-neutral-400" title={t('home.recordLimitHint')}>{t('home.recordLimit')}</label>
            <input type="text" value={liveRecordLimit} onChange={(e) => setLiveRecordLimit(e.target.value)} placeholder={t('home.recordLimitPlaceholder')} className="input-field text-sm" />
          </div>
          <div className="p-2">
            <label className="mb-1 block text-[11px] text-slate-500 dark:text-neutral-400">{t('home.refreshIntervalSeconds')}</label>
            <input type="number" value={liveWaitTime} onChange={(e) => setLiveWaitTime(e.target.value)} placeholder={t('common.auto')} className="input-field text-sm" />
          </div>
          <div className="p-2">
            <label className="mb-1 block text-[11px] text-slate-500 dark:text-neutral-400" title={t('home.liveTakeCountHint')}>{t('home.liveTakeCount')}</label>
            <input type="number" value={liveTakeCount} onChange={(e) => setLiveTakeCount(e.target.value)} min={1} max={100} className="input-field text-sm" />
          </div>
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <button onClick={handleRecordStart} disabled={recordStarting} className="btn-primary flex items-center gap-2 text-sm"><Play size={16} /> {recordStarting ? t('home.starting') : t('home.startRecording')}</button>
      </div>
      <p className="mt-2 text-[11px] text-slate-500 dark:text-neutral-400">{t('home.fixedMkvNotice')}</p>
    </div>
  )
}
