import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useLocation } from 'react-router-dom'
import * as XLSX from 'xlsx'
import {
  ChevronDown,
  ChevronUp,
  Clipboard,


  Play,

  Settings2,
  Trash2,
  Upload,
} from 'lucide-react'
import { useDownloadStore } from '@/store/downloadStore'
import { useHistoryStore } from '@/store/historyStore'
import { useSettingsStore } from '@/store/settingsStore'
import Modal from '@/components/Modal'
import { showToast } from '@/components/Toast'
import { isImportHeaderAlias, useTranslation } from '@/i18n'
import { extractFileName, extractUrlHost, formatDuration, formatFileSize, generateId } from '@/utils/format'
import { isValidUrl } from '@/utils/validators'
import { getTaskStatusMeta, STATUS_ICON_META } from '@/utils/status'
import { buildTaskOptions } from '@/utils/taskOptions'
import {
  DEFAULT_LIVE_TAKE_COUNT,
  formatLiveLimitForCli,
  getRecordDurationSeconds,
  getRecordElapsedSeconds,
  getRecordLimitSeconds,
  isRecordTask,
  parseLiveLimitRaw
} from '@/utils/recording'
import type { DownloadTask } from '@/types/download'

interface BatchItem {
  id: string
  url: string
  saveName: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  progress: number
  taskId?: string
}

function getTaskRuntimeSeconds(startTime?: string): number {
  if (!startTime) return 0
  const start = Date.parse(startTime)
  if (Number.isNaN(start)) return 0
  return Math.max(0, Math.floor((Date.now() - start) / 1000))
}

export default function Home() {
  const location = useLocation()
  const { t, locale } = useTranslation()
  const statusMeta = getTaskStatusMeta(locale)
  // 支持跨页跳转直达指定页签（如历史页"再次执行"录制条目 → 录制 Tab）
  const [activeTab, setActiveTab] = useState<'download' | 'record'>(() =>
    (location.state as { tab?: 'download' | 'record' } | null)?.tab === 'record' ? 'record' : 'download'
  )

  const [downloadUrl, setDownloadUrl] = useState('')
  const [downloadName, setDownloadName] = useState('')
  const [showDownloadAdvanced, setShowDownloadAdvanced] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [downloadThreadCount, setDownloadThreadCount] = useState(8)
  const [downloadAutoSelect, setDownloadAutoSelect] = useState(true)
  const [downloadMuxFormat, setDownloadMuxFormat] = useState('mp4')
  const [downloadMaxSpeed, setDownloadMaxSpeed] = useState('')
  const [downloadSubOnly, setDownloadSubOnly] = useState(false)
  const [downloadCustomArgs, setDownloadCustomArgs] = useState('')

  const [recordUrl, setRecordUrl] = useState('')
  const [recordName, setRecordName] = useState('')
  // 录制发起请求进行中：防止双击重复创建
  const [recordStarting, setRecordStarting] = useState(false)
  // 正在执行停止操作的录制任务：按钮保持禁用直至 complete 事件确认终止，
  // 避免对同一进程重复下发终止信号（PID 复用误杀风险）
  const [cancellingIds, setCancellingIds] = useState<string[]>([])
  // 重试确认弹窗目标：录制任务重试会清理已录产物，必须显式确认
  const [retryConfirmTask, setRetryConfirmTask] = useState<DownloadTask | null>(null)
  const [showRecordAdvanced, setShowRecordAdvanced] = useState(false)
  const [liveRealTimeMerge, setLiveRealTimeMerge] = useState(true)
  const [livePipeMux, setLivePipeMux] = useState(false)
  const [livePerformAsVod, setLivePerformAsVod] = useState(false)
  const [liveFixVttByAudio, setLiveFixVttByAudio] = useState(false)
  const [liveRecordLimit, setLiveRecordLimit] = useState('')
  const [liveWaitTime, setLiveWaitTime] = useState('')
  const [liveTakeCount, setLiveTakeCount] = useState(() => String(DEFAULT_LIVE_TAKE_COUNT))
  // 录制计时基准：由任务 startTime 派生（单一数据源），仅在存在活跃录制时每秒跳动
  const [nowTs, setNowTs] = useState(() => Date.now())

  const [batchText, setBatchText] = useState('')
  const [batchItems, setBatchItems] = useState<BatchItem[]>([])
  const [isBatchRunning, setIsBatchRunning] = useState(false)
  const [deleteConfirmTask, setDeleteConfirmTask] = useState<DownloadTask | null>(null)
  const batchFileInputRef = useRef<HTMLInputElement | null>(null)
  const formatApproxSize = (bytes: number) => `(${t('common.approx')} ${formatFileSize(bytes)})`
  // 批量队列用：任务结束时通过 download:complete 事件释放并发槽位
  const completionResolvers = useRef(new Map<string, () => void>())
  // 批量队列整体停止标志
  const batchAbortRef = useRef(false)

  const { tasks, activeTaskId, addTask, updateTask, setActiveTask, removeTask } = useDownloadStore()
  const { settings } = useSettingsStore()
  const { addRecord, removeRecord } = useHistoryStore()

  useEffect(() => {
    setDownloadThreadCount(settings.threadCount)
    setDownloadAutoSelect(settings.autoSelect)
    setDownloadMuxFormat(settings.muxFormat)
  }, [settings])

  useEffect(() => {
    const handleProgress = (data: any) => {
      updateTask(data.taskId, {
        progress: data.progress,
        speed: data.speed,
        downloadedSegments: data.downloadedSegments,
        totalSegments: data.totalSegments,
        downloadedBytes: data.downloadedBytes,
        totalBytes: data.totalBytes,
        etaSeconds: data.etaSeconds,
        currentFrameRate: data.currentFrameRate,
        latestLog: data.latestLog,
        status: data.status
      })
      setBatchItems((prev) => prev.map((entry) => {
        if (entry.taskId !== data.taskId) return entry
        const nextStatus = data.status === 'completed' ? 'completed' : data.status === 'cancelled' ? 'cancelled' : data.status === 'failed' ? 'failed' : 'running'
        return {
          ...entry,
          status: nextStatus,
          progress: typeof data.progress === 'number' ? Number(data.progress) : entry.progress
        }
      }))
    }

    const handleLog = (data: any) => {
      useDownloadStore.getState().addLog(data.taskId, {
        timestamp: new Date().toISOString(),
        level: data.level,
        message: data.message
      })
    }

    const handleComplete = (data: any) => {
      // 释放批量队列中等待该任务的并发槽位
      const resolver = completionResolvers.current.get(data.taskId)
      if (resolver) {
        completionResolvers.current.delete(data.taskId)
        resolver()
      }

      // 停止流程已被 complete 事件确认：解除对应按钮的禁用态
      setCancellingIds((prev) => prev.filter((id) => id !== data.taskId))

      const task = useDownloadStore.getState().getTask(data.taskId)
      if (task) {
        updateTask(data.taskId, {
          status: data.status,
          progress: typeof data.progress === 'number' ? data.progress : task.progress,
          speed: data.speed || task.speed || '0 KB/s',
          downloadedSegments: typeof data.downloadedSegments === 'number' ? data.downloadedSegments : task.downloadedSegments,
          totalSegments: typeof data.totalSegments === 'number' ? data.totalSegments : task.totalSegments,
          downloadedBytes: typeof data.downloadedBytes === 'number' ? data.downloadedBytes : task.downloadedBytes,
          totalBytes: typeof data.totalBytes === 'number' ? data.totalBytes : task.totalBytes,
          etaSeconds: typeof data.etaSeconds === 'number' ? data.etaSeconds : task.etaSeconds,
          currentFrameRate: typeof data.currentFrameRate === 'number' ? data.currentFrameRate : task.currentFrameRate,
          latestLog: data.latestLog || task.latestLog || t('status.completed'),
          endTime: new Date().toISOString()
        })

        // 录制任务终态反馈：
        // - 失败必须显式提示（后台挂机录制的异常终止此前完全静默）；
        // - 取消即“停止并保存”，在此统一播报，替代停止按钮点击时的抢跑文案
        if (isRecordTask(task)) {
          if (data.status === 'failed') {
            showToast('error', t('home.recordAborted').replace('{name}', task.saveName || task.url))
          } else if (data.status === 'cancelled') {
            showToast('info', t('home.recordStoppedSaved'))
          }
        }

        addRecord({
          id: data.taskId,
          url: task.url,
          saveName: task.saveName,
          status: data.status === 'completed' ? 'completed' : data.status === 'cancelled' ? 'cancelled' : 'failed',
          kind: isRecordTask(task) ? 'record' : 'download',
          startTime: task.startTime,
          endTime: new Date().toISOString(),
          fileSize: Number(task.totalBytes || task.downloadedBytes || 0),
          outputPath: task.saveDir || task.options?.saveDir || useSettingsStore.getState().settings.saveDir || '',
          duration: getTaskRuntimeSeconds(task.startTime)
        })
      }

      setBatchItems((prev) => prev.map((entry) => {
        if (entry.taskId !== data.taskId) return entry
        const nextStatus = data.status === 'completed' ? 'completed' : data.status === 'cancelled' ? 'cancelled' : data.status === 'failed' ? 'failed' : 'running'
        return {
          ...entry,
          status: nextStatus,
          progress: typeof data.progress === 'number' ? Number(data.progress) : entry.progress
        }
      }))

      const hasActiveDownload = useDownloadStore.getState().tasks.some((candidate) => {
        if (isRecordTask(candidate)) return false
        return candidate.status === 'pending' || candidate.status === 'running'
      })
      if (!hasActiveDownload) {
        setIsDownloading(false)
      }
    }

    const offProgress = window.api.download.onProgress(handleProgress)
    const offLog = window.api.download.onLog(handleLog)
    const offComplete = window.api.download.onComplete(handleComplete)
    // 录制停止/中断后主进程自动把 TS 中间产物转封装为 MKV，这里反馈结果
    const offRemux = window.api.download.onRemuxDone((data) => {
      if (!data || data.attempted <= 0) return
      if (data.outputs.length > 0) {
        showToast('success', t('home.remuxSuccess').replace('{count}', String(data.outputs.length)))
      } else {
        showToast('error', t('home.remuxFailed'))
      }
    })

    return () => {
      offProgress()
      offLog()
      offComplete()
      offRemux()
    }
    // 订阅仅挂载时注册一次：handler 内通过 getState()/ref 取最新值，避免随进度更新反复重挂
  }, [])

  const downloadTasks = tasks.filter((task) => !isRecordTask(task))
  const recordTasks = tasks.filter((task) => isRecordTask(task))
  const visibleTasks = activeTab === 'download' ? downloadTasks : recordTasks
  const emptyTaskType = activeTab === 'download' ? t('home.downloadTask') : t('home.recordTask')
  const emptyStateText = t('home.noTasks').replace('{type}', emptyTaskType)
  const emptyStateHint = t('home.noTasksHint').replace('{type}', emptyTaskType)

  // 录制计时 ticker：仅在录制 Tab 可见且存在活跃录制任务时运行，
  // 驱动基于 startTime 的已录时长刷新（下载 Tab 期间录制 UI 不可见，无需空转重渲染）
  const activeRecordCount = recordTasks.filter((task) => task.status === 'running' || task.status === 'pending').length
  const hasLiveRecord = activeRecordCount > 0
  const recordTickerActive = hasLiveRecord && activeTab === 'record'
  useEffect(() => {
    if (!recordTickerActive) return
    setNowTs(Date.now())
    const timer = setInterval(() => setNowTs(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [recordTickerActive])

  /** 录制任务已录时长（秒）；非活跃任务返回 null（无持续计时语义） */
  const getRecordElapsed = (task: DownloadTask): number | null => getRecordElapsedSeconds(task, nowTs)

  /** 解析录制时长限制为秒；未配置或非法返回 0（隐藏限额条） */
  const parseLiveLimitSeconds = (task: DownloadTask): number => getRecordLimitSeconds(task)

  const getTaskActionMessage = (
    action: 'cancel' | 'retry' | 'delete',
    outcome: 'success' | 'error' | 'info',
    detail: string
  ) => {
    const actionText = t(`home.taskAction.${action}`)
    const resultText = outcome === 'error' ? t('home.taskAction.failed') : t('home.taskAction.success')
    return t('home.taskAction.messageTemplate')
      .replace('{action}', actionText)
      .replace('{result}', resultText)
      .replace('{detail}', detail)
  }

  const handleDownloadUrlChange = (value: string) => {
    setDownloadUrl(value)
    if (!downloadName && value) setDownloadName(extractFileName(value))
  }

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text && isValidUrl(text)) {
        if (activeTab === 'download') {
          setDownloadUrl(text)
          if (!downloadName) setDownloadName(extractFileName(text))
        } else {
          setRecordUrl(text)
          if (!recordName) setRecordName(extractFileName(text))
        }
        showToast('info', t('home.clipboardPasteSuccess'))
      }
    } catch {
      showToast('error', t('home.clipboardReadFailed'))
    }
  }

  const handleDownloadStart = async () => {
    if (!downloadUrl.trim()) {
      showToast('error', t('home.downloadUrlRequired'))
      return
    }
    if (!isValidUrl(downloadUrl)) {
      showToast('error', t('home.invalidUrl'))
      return
    }

    setIsDownloading(true)

    const taskOptions = buildTaskOptions(settings, {
      url: downloadUrl.trim(),
      saveName: downloadName || extractFileName(downloadUrl),
      threadCount: downloadThreadCount,
      autoSelect: downloadAutoSelect,
      muxFormat: downloadMuxFormat,
      maxSpeed: downloadMaxSpeed || undefined,
      subOnly: downloadSubOnly,
      customArgs: downloadCustomArgs || undefined,
    })

    const result = await window.api.download.start(taskOptions)
    if (!result.success) {
      showToast('error', t('home.startFailed').replace('{error}', String(result.error)))
      setIsDownloading(false)
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
      logs: [],
      options: result.options || taskOptions
    }

    addTask(task)
    setActiveTask(taskId)
    showToast('success', t('home.downloadStarted'))
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
        logs: [],
        options: result.options || taskOptions
      }

      addTask(task)
      showToast('success', t('home.recordingStarted'))
    } finally {
      setRecordStarting(false)
    }
  }

  const parseBatchUrls = () => {
    const lines = batchText.split('\n').map((line) => line.trim()).filter(Boolean)
    const validUrls = lines.filter(isValidUrl)
    if (validUrls.length === 0) {
      showToast('error', t('home.noValidUrls'))
      return
    }
    const next = validUrls.map((url) => ({
      id: generateId(),
      url,
      saveName: extractFileName(url),
      status: 'pending' as const,
      progress: 0
    }))
    setBatchItems(next)
    showToast('success', t('home.parseUrlSuccess').replace('{count}', String(next.length)))
  }

  const appendImportedBatchItems = (rows: Array<{ name: string; url: string }>) => {
    const parsedRows: BatchItem[] = []

    rows.forEach(({ name, url }) => {
      const trimmedUrl = url.trim()
      const trimmedName = name.trim()
      if (!trimmedUrl || !isValidUrl(trimmedUrl)) return
      parsedRows.push({
        id: generateId(),
        url: trimmedUrl,
        saveName: trimmedName || extractFileName(trimmedUrl),
        status: 'pending',
        progress: 0
      })
    })

    if (parsedRows.length === 0) {
      showToast('error', t('home.importTemplateError'))
      return
    }

    setBatchItems((prev) => [...prev, ...parsedRows])
    showToast('success', t('home.importSuccess').replace('{count}', String(parsedRows.length)))
  }

  const normalizeImportCell = (value: string) => value
    .replace(/^[\uFEFF\s"'“”‘’]+|[\uFEFF\s"'“”‘’]+$/g, '')
    .replace(/[\r\n]+/g, ' ')
    .trim()

  const parseDelimitedRow = (line: string): string[] => {
    const result: string[] = []
    let current = ''
    let inQuotes = false

    for (let i = 0; i < line.length; i += 1) {
      const char = line[i]
      const next = line[i + 1]

      if ((char === '"' || char === "'" || char === '“' || char === '”' || char === '‘' || char === '’') && (i === 0 || line[i - 1] !== '\\')) {
        if (inQuotes) {
          if (next === '"' || next === "'" || next === '“' || next === '”' || next === '‘' || next === '’') {
            current += char
            i += 1
          } else {
            inQuotes = false
          }
        } else {
          inQuotes = true
        }
        continue
      }

      if (!inQuotes && (char === ',' || char === '\t' || char === '|' || char === ';')) {
        result.push(normalizeImportCell(current))
        current = ''
        continue
      }

      if (!inQuotes && /\s{2,}/.test(char) && !/[\dA-Za-z]/.test(next ?? '')) {
        if (current.trim()) {
          result.push(normalizeImportCell(current))
          current = ''
        }
        continue
      }

      current += char
    }

    result.push(normalizeImportCell(current))
    return result.filter((cell) => cell.length > 0)
  }

  const extractUrlCandidate = (value: string) => {
    const trimmed = normalizeImportCell(value)
    const match = trimmed.match(/https?:\/\/[^\s,;|)\]]+/i)
    if (!match) return null
    return match[0].replace(/[),.;]+$/, '')
  }

  const parseFixedColumnImport = (rawText: string) => {
    const rows: Array<{ name: string; url: string }> = []
    const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)

    const parseLine = (line: string) => {
      const trimmed = normalizeImportCell(line)
      if (!trimmed) return null

      if (isValidUrl(trimmed)) {
        return { name: extractFileName(trimmed), url: trimmed }
      }

      const urlRegex = /https?:\/\/[^\s,;|)\]]+/i
      const urlMatch = trimmed.match(urlRegex)
      if (urlMatch) {
        const url = normalizeImportCell(urlMatch[0].replace(/[),.;]+$/, ''))
        const urlIndex = trimmed.indexOf(url)
        const before = normalizeImportCell(trimmed.slice(0, urlIndex))
        const after = normalizeImportCell(trimmed.slice(urlIndex + url.length))
        const name = before || after
        if (name && isValidUrl(url)) {
          return {
            name: normalizeImportCell(name.replace(/^[\s\-：:|,;]+|[\s\-：:|,;]+$/g, '')),
            url
          }
        }
      }

      const cells = parseDelimitedRow(trimmed)
      if (cells.length >= 2) {
        const urlIndex = cells.findIndex((cell) => isValidUrl(normalizeImportCell(cell)))
        if (urlIndex >= 0) {
          const url = normalizeImportCell(cells[urlIndex])
          const name = cells.filter((_, index) => index !== urlIndex).join(' ').trim()
          if (name) {
            return { name: normalizeImportCell(name), url }
          }
          return { name: extractFileName(url), url }
        }
      }

      return null
    }

    for (const line of lines) {
      const parsed = parseLine(line)
      if (!parsed) continue
      const name = normalizeImportCell(parsed.name)
      const url = normalizeImportCell(parsed.url)
      if (!url || !isValidUrl(url)) continue
      if (isImportHeaderAlias(name)) {
        continue
      }
      rows.push({ name: name || extractFileName(url), url })
    }

    return rows
  }

  const handleBatchImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const fileName = file.name.toLowerCase()

      if (/\.(txt|csv|tsv)$/i.test(fileName)) {
        const text = await file.text()
        const parsedRows = parseFixedColumnImport(text)
        appendImportedBatchItems(parsedRows)
      } else if (/\.(xlsx|xls)$/i.test(fileName)) {
        const arrayBuffer = await file.arrayBuffer()
        const workbook = XLSX.read(arrayBuffer, { type: 'array' })
        const sheet = workbook.Sheets[workbook.SheetNames[0]]
        const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' })
        const parsedRows: Array<{ name: string; url: string }> = []

        rows.forEach((row) => {
          if (!Array.isArray(row) || row.length < 2) return
          const firstCell = normalizeImportCell(String(row[0] ?? ''))
          const secondCell = normalizeImportCell(String(row[1] ?? ''))
          if (!firstCell || !secondCell) return
          if (isImportHeaderAlias(firstCell) || isImportHeaderAlias(secondCell)) return
          const urlCell = secondCell.includes('http') ? secondCell : extractUrlCandidate(secondCell)
          if (!urlCell || !isValidUrl(urlCell)) return
          parsedRows.push({ name: firstCell, url: urlCell })
        })

        appendImportedBatchItems(parsedRows)
      } else {
        showToast('error', t('home.importFormatError'))
      }
    } catch {
      showToast('error', t('home.importParseError'))
    } finally {
      event.target.value = ''
    }
  }

  const waitForTaskCompletion = (taskId: string) =>
    new Promise<void>((resolve) => {
      completionResolvers.current.set(taskId, resolve)
    })

  const runWithConcurrency = async (items: BatchItem[], limit: number, worker: (item: BatchItem) => Promise<void>) => {
    let cursor = 0
    const size = Math.min(Math.max(1, Math.floor(limit)), items.length)
    const runners = Array.from({ length: size }, async () => {
      while (cursor < items.length) {
        if (batchAbortRef.current) return
        const item = items[cursor]
        cursor += 1
        await worker(item)
      }
    })
    await Promise.all(runners)
  }

  const startBatch = async () => {
    if (batchItems.length === 0) {
      showToast('error', t('home.noBatchUrls'))
      return
    }

    setIsBatchRunning(true)
    batchAbortRef.current = false

    await runWithConcurrency(batchItems, settings.batchConcurrency || 2, async (item) => {
      setBatchItems((prev) => prev.map((entry) => entry.id === item.id ? { ...entry, status: 'running', taskId: undefined } : entry))

      const options = buildTaskOptions(settings, {
        url: item.url,
        saveName: item.saveName,
      })

      const result = await window.api.download.start(options)
      if (!result.success) {
        setBatchItems((prev) => prev.map((entry) => entry.id === item.id ? { ...entry, status: 'failed', taskId: undefined } : entry))
        return
      }

      const taskId = result.taskId || item.id
      const task: DownloadTask = {
        id: taskId,
        url: item.url,
        // 批量场景同名概率最高，必须采纳主进程唯一化后的生效名
        saveName: result.options?.saveName || item.saveName,
        saveDir: settings.saveDir,
        status: 'pending',
        progress: 0,
        speed: '0 KB/s',
        downloadedSegments: 0,
        totalSegments: 0,
        startTime: new Date().toISOString(),
        logs: [],
        options: result.options || options
      }
      addTask(task)
      setActiveTask(taskId)
      setBatchItems((prev) => prev.map((entry) => entry.id === item.id ? { ...entry, status: 'running', taskId } : entry))

      // 等待该任务真正结束（完成/取消/失败都会发出 download:complete）再释放并发槽位
      if (result.taskId) {
        await waitForTaskCompletion(taskId)
      }
    })

    const aborted = batchAbortRef.current
    batchAbortRef.current = false
    setIsBatchRunning(false)
    showToast(aborted ? 'info' : 'success', aborted ? t('home.batchStopped') : t('home.batchFinished'))
  }

  const stopBatch = () => {
    batchAbortRef.current = true
    showToast('info', t('home.stoppingBatch'))
  }

  /**
   * 停止一个录制任务：立即置为“停止中”禁用相关按钮，
   * 直到 download:complete 到达再解除，避免对同一进程重复下发终止信号
   */
  const stopRecording = async (taskId: string) => {
    if (cancellingIds.includes(taskId)) return
    setCancellingIds((prev) => prev.includes(taskId) ? prev : [...prev, taskId])
    try {
      const result = await window.api.download.cancel(taskId)
      if (!result?.success) {
        // 任务可能已自行结束并被移除：立即解除禁用
        setCancellingIds((prev) => prev.filter((id) => id !== taskId))
      }
    } catch {
      setCancellingIds((prev) => prev.filter((id) => id !== taskId))
    }
  }

  /** 重试入口：录制任务的旧产物会被清理，先经确认弹窗；普通下载维持直接重试 */
  const requestRetry = (task: DownloadTask) => {
    if (isRecordTask(task)) {
      setRetryConfirmTask(task)
      return
    }
    performRetry(task)
  }

  const syncTaskRuntimeFlags = () => {
    const liveTasks = useDownloadStore.getState().tasks
    const hasActiveDownload = liveTasks.some((candidate) => !isRecordTask(candidate) && (candidate.status === 'pending' || candidate.status === 'running'))
    setIsDownloading(hasActiveDownload)
  }

  const deleteTaskArtifactsAndCleanup = async (task: DownloadTask, options: { keepHistory?: boolean } = {}) => {
    try {
      const result = await window.api.download.delete(task.id, {
        saveDir: task.saveDir || settings.saveDir,
        saveName: task.saveName,
        tmpDir: task.options?.tmpDir || settings.tmpDir,
        outputPath: (task.options as any)?.outputPath,
        options: task.options || {}
      })
      if (!result?.success) {
        return { success: false, message: result?.error || t('home.taskAction.cleanupFailed') }
      }
      removeTask(task.id)
      await window.api.runtime.remove(task.id)
      if (task.id === activeTaskId) setActiveTask(null)
      // 历史语义：仅"删除任务"移除历史记录；"取消任务"保留痕迹，
      // 由 handleTaskCancel 显式写入一条已取消记录（keepHistory: true）
      if (!options.keepHistory) {
        await removeRecord(task.id)
      }
      syncTaskRuntimeFlags()
      return { success: true, message: t('home.taskAction.cleaned') }
    } catch {
      return { success: false, message: t('home.taskAction.cleanupFailed') }
    }
  }

  const handleTaskCancel = async (task: DownloadTask) => {
    const actionText = 'cancel' as const
    try {
      const cancelResult = await window.api.download.cancel(task.id)
      if (!cancelResult?.success) {
        showToast('error', getTaskActionMessage(actionText, 'error', t('home.taskAction.alreadyFinished')))
        return
      }

      // 取消保留历史痕迹：清理文件与任务列表，但不移除记录
      const cleanupResult = await deleteTaskArtifactsAndCleanup(task, { keepHistory: true })

      // 显式落一条"已取消"记录：complete 事件与任务清理存在竞速，
      // 事件侧可能因任务已被移除而跳过写入，这里统一兜底；
      // store 与主进程的 history:add 均按 id 幂等覆盖，不会产生重复
      await addRecord({
        id: task.id,
        url: task.url,
        saveName: task.saveName,
        status: 'cancelled',
        kind: 'download',
        startTime: task.startTime,
        endTime: new Date().toISOString(),
        fileSize: Number(task.totalBytes || task.downloadedBytes || 0),
        outputPath: task.saveDir || task.options?.saveDir || settings.saveDir || '',
        duration: getTaskRuntimeSeconds(task.startTime)
      })

      if (activeTaskId === task.id) {
        setActiveTask(null)
      }
      syncTaskRuntimeFlags()
      showToast('info', cleanupResult.success
        ? getTaskActionMessage(actionText, 'success', t('home.taskAction.cancelledAndSaved'))
        : getTaskActionMessage(actionText, 'success', t('home.taskAction.cancelledPartial')))
    } catch {
      showToast('error', getTaskActionMessage(actionText, 'error', t('home.taskAction.notStopped')))
    }
  }

  /** 执行重试（录制任务须经 requestRetry 确认后才会进入这里） */
  const performRetry = async (task: DownloadTask) => {
    const actionText = 'retry' as const
    const options = {
      ...(task.options || {}),
      url: task.url,
      saveName: task.saveName,
      saveDir: task.saveDir || settings.saveDir,
      // 重试一律从全局基目录重新派生隔离临时目录；
      // 旧任务的 task-<id> 目录已由上方 cleanup 删除，若复用会产生 task-old/task-new 嵌套路径
      tmpDir: settings.tmpDir,
      customArgs: task.options?.customArgs || settings.customArgs || undefined,
      maxSpeed: task.options?.maxSpeed || settings.maxSpeed || undefined,
      proxy: task.options?.proxy || settings.proxy || undefined,
      headers: Object.keys(task.options?.headers || {}).length > 0 ? task.options.headers : (Object.keys(settings.headers).length > 0 ? settings.headers : undefined),
      logLevel: task.options?.logLevel || settings.logLevel
    }

    try {
      const cleanupResult = await deleteTaskArtifactsAndCleanup(task)
      if (!cleanupResult.success) {
        showToast('error', getTaskActionMessage(actionText, 'error', cleanupResult.message))
        return
      }

      const result = await window.api.download.start(options)
      if (!result?.success) {
        showToast('error', getTaskActionMessage(actionText, 'error', result?.error || t('common.unknownError')))
        return
      }
      const newTaskId = result.taskId || generateId()
      const recreated: DownloadTask = {
        ...task,
        id: newTaskId,
        status: 'pending',
        progress: 0,
        speed: '0 KB/s',
        downloadedSegments: 0,
        totalSegments: task.totalSegments || 0,
        downloadedBytes: 0,
        totalBytes: task.totalBytes || 0,
        etaSeconds: 0,
        endTime: undefined,
        latestLog: t('home.taskAction.retry'),
        startTime: new Date().toISOString(),
        logs: [{ timestamp: new Date().toISOString(), level: 'INFO', message: t('home.taskAction.retry') }],
        options: result.options || options
      }
      addTask(recreated)
      setActiveTask(newTaskId)
      showToast('success', getTaskActionMessage(actionText, 'success', t('home.taskAction.oldResidual')))
    } catch {
      showToast('error', getTaskActionMessage(actionText, 'error', t('home.taskAction.cannotRestart')))
    }
  }

  const handleTaskDelete = async (task: DownloadTask) => {
    const actionText = 'delete' as const
    try {
      const cleanupResult = await deleteTaskArtifactsAndCleanup(task)
      if (!cleanupResult.success) {
        showToast('error', getTaskActionMessage(actionText, 'error', cleanupResult.message))
        return
      }
      showToast('success', getTaskActionMessage(actionText, 'success', t('home.taskAction.cleaned')))
    } catch {
      showToast('error', getTaskActionMessage(actionText, 'error', t('home.taskAction.taskFileMayExist')))
    } finally {
      setDeleteConfirmTask(null)
    }
  }

  const openDeleteConfirm = (task: DownloadTask) => {
    setDeleteConfirmTask(task)
  }

  /** 打开任务输出目录 */
  const openTaskFolder = async (task: DownloadTask) => {
    const dir = task.saveDir || settings.saveDir
    if (!dir) {
      showToast('info', t('home.noOutputPath'))
      return
    }
    const error = await window.api.shell.openPath(dir)
    error ? showToast('error', t('home.openFolderFailed').replace('{error}', String(error))) : showToast('success', t('home.folderOpened'))
  }

  /** 录制卡片：原「监控面板 + 列表行」合并后的单一卡片，活跃录制自带计时与指标 */
  const renderRecordCard = (task: DownloadTask) => {
    const live = task.status === 'running' || task.status === 'pending'
    const elapsed = getRecordElapsed(task)
    const limitSeconds = parseLiveLimitSeconds(task)
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
              <button onClick={() => openTaskFolder(task)}
                className="rounded-md border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-2 py-1 text-[10px] font-medium text-slate-300 dark:text-neutral-600 hover:bg-slate-100 dark:hover:bg-neutral-800">
                {t('home.open')}
              </button>
            )}
            {live ? (
              <button onClick={() => stopRecording(task.id)} disabled={isCancelling}
                className="rounded-md border border-red-200 dark:border-red-500/20 bg-red-50/40 dark:bg-red-500/10 px-2.5 py-1 text-[10px] font-semibold text-red-500 dark:text-red-400 disabled:cursor-not-allowed disabled:opacity-60">
                {isCancelling ? t('home.stopInProgress') : t('home.stop')}
              </button>
            ) : (
              <>
                {task.status === 'failed' && (
                  <button onClick={() => requestRetry(task)}
                    className="rounded-md border border-emerald-200 dark:border-emerald-500/20 bg-emerald-50 dark:bg-emerald-500/10 px-2 py-1 text-[10px] font-medium text-emerald-500 dark:text-emerald-400">
                    {t('home.retry')}
                  </button>
                )}
                <button onClick={() => openDeleteConfirm(task)}
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
              onClick={() => canCancel && handleTaskCancel(task)}
              disabled={!canCancel}
              className={`rounded-md border px-2 py-1 text-[10px] font-medium ${canCancel ? 'border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-500/20' : 'cursor-not-allowed border-slate-200 dark:border-neutral-800 bg-slate-100 dark:bg-neutral-800 text-slate-400 dark:text-neutral-500'}`}
            >
              {t('home.taskAction.cancel')}
            </button>
            <button
              onClick={() => canRetry && requestRetry(task)}
              disabled={!canRetry}
              className={`rounded-md border px-2 py-1 text-[10px] font-medium ${canRetry ? 'border-emerald-200 dark:border-emerald-500/20 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-500/20' : 'cursor-not-allowed border-slate-200 dark:border-neutral-800 bg-slate-100 dark:bg-neutral-800 text-slate-400 dark:text-neutral-500'}`}
            >
              {t('home.taskAction.retry')}
            </button>
            <button
              onClick={() => canDelete && openDeleteConfirm(task)}
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
    <div className="flex flex-1 flex-col gap-6">
      <Modal open={Boolean(deleteConfirmTask)} onClose={() => setDeleteConfirmTask(null)} title={t('home.deleteTask')} width="max-w-md">
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 dark:border-neutral-800 bg-slate-50 dark:bg-neutral-800/60 px-3 py-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-neutral-400">{t('home.taskName')}</div>
            <div className="mt-1 truncate text-sm font-semibold text-slate-700 dark:text-neutral-200">{deleteConfirmTask?.saveName || deleteConfirmTask?.url || ''}</div>
          </div>

          <p className="text-sm leading-6 text-slate-300 dark:text-neutral-600">
            {t('home.deleteWarning')
              .replace('{target}', isRecordTask(deleteConfirmTask) ? t('home.recordTask') : t('home.downloadTask'))
             .replace('{size}', deleteConfirmTask && Number(deleteConfirmTask.downloadedBytes || 0) > 0 ? formatApproxSize(Number(deleteConfirmTask.downloadedBytes)) : '')}
          </p>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              onClick={() => setDeleteConfirmTask(null)}
              className="rounded-lg border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3.5 py-2 text-sm font-medium text-slate-300 dark:text-neutral-600 transition hover:bg-slate-100 dark:hover:bg-neutral-800 hover:bg-slate-50 dark:hover:bg-neutral-800/60"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={() => deleteConfirmTask && handleTaskDelete(deleteConfirmTask)}
              className="rounded-lg border border-red-200 dark:border-red-500/20 bg-red-600 px-3.5 py-2 text-sm font-medium text-white transition"
            >
              {t('home.confirmDelete')}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={Boolean(retryConfirmTask)} onClose={() => setRetryConfirmTask(null)} title={t('home.retryRecordTask')} width="max-w-md">
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 dark:border-neutral-800 bg-slate-50 dark:bg-neutral-800/60 px-3 py-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-neutral-400">{t('home.taskName')}</div>
            <div className="mt-1 truncate text-sm font-semibold text-slate-700 dark:text-neutral-200">{retryConfirmTask?.saveName || retryConfirmTask?.url || ''}</div>
          </div>

          <p className="text-sm leading-6 text-slate-300 dark:text-neutral-600">
            {t('home.retryWarning').replace('{size}', retryConfirmTask && Number(retryConfirmTask.downloadedBytes || 0) > 0 ? formatApproxSize(Number(retryConfirmTask.downloadedBytes)) : '')}
          </p>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              onClick={() => setRetryConfirmTask(null)}
              className="rounded-lg border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3.5 py-2 text-sm font-medium text-slate-300 dark:text-neutral-600 transition hover:bg-slate-100 dark:hover:bg-neutral-800 hover:bg-slate-50 dark:hover:bg-neutral-800/60"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={() => {
                const target = retryConfirmTask
                setRetryConfirmTask(null)
                if (target) performRetry(target)
              }}
              className="rounded-lg border border-emerald-200 dark:border-emerald-500/20 bg-emerald-600 px-3.5 py-2 text-sm font-medium text-white transition"
            >
              {t('home.deleteAndRerun')}
            </button>
          </div>
        </div>
      </Modal>

      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold tracking-[0.18em] text-slate-500 dark:text-neutral-400 uppercase">{t('home.pageKicker')}</div>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-neutral-50">{t('home.overview')}</h1>
        </div>
        <div className="flex items-center gap-2" />
      </div>

      <div className="flex justify-center">
        <div className="w-full max-w-[340px] rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-1.5 shadow-sm">
          <div className="inline-flex w-full rounded-xl bg-slate-100 dark:bg-neutral-800 p-1">
            <button
              className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition ${activeTab === 'download' ? 'bg-white dark:bg-neutral-900 text-blue-700 dark:text-blue-300 shadow-sm' : 'text-slate-500 dark:text-neutral-400'}`}
              onClick={() => setActiveTab('download')}
            >
              {t('home.downloadTask')}
            </button>
            <button
              className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition ${activeTab === 'record' ? 'bg-white dark:bg-neutral-900 text-red-600 dark:text-red-400 shadow-sm' : 'text-slate-500 dark:text-neutral-400'}`}
              onClick={() => setActiveTab('record')}
            >
              {t('home.recordTask')}
            </button>
          </div>
        </div>
      </div>

      {activeTab === 'download' ? (
        <div className="space-y-6">
            <div className="card p-5">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-2xl leading-none">📥</span>
                <span className="text-sm font-semibold text-slate-800 dark:text-neutral-100">{t('home.downloadEntry')}</span>
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={downloadUrl}
                  onChange={(e) => handleDownloadUrlChange(e.target.value)}
                  placeholder={t('home.pasteUrlPlaceholder')}
                  className="input-field flex-1"
                  onKeyDown={(e) => e.key === 'Enter' && !isDownloading && handleDownloadStart()}
                />
                <button onClick={handlePasteFromClipboard} className="btn-secondary flex items-center gap-1.5 whitespace-nowrap text-sm">
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
                <button onClick={() => setShowDownloadAdvanced(!showDownloadAdvanced)} className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-neutral-400 hover:text-slate-700 dark:hover:text-slate-200 text-slate-700 dark:text-neutral-200 transition-colors">
                  <Settings2 size={13} /> {t('home.advancedOptions')} {showDownloadAdvanced ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </button>
                <div className="flex gap-2">
                  <button onClick={handleDownloadStart} disabled={isDownloading} className="btn-primary flex items-center gap-2 text-sm">
                    <Play size={16} /> {isDownloading ? t('home.processing') : t('home.startDownload')}
                  </button>
                </div>
              </div>

              {showDownloadAdvanced && (
                <div className="mt-4 grid grid-cols-2 gap-2.5">
                  <div className="p-2">
                    <label className="mb-1 block text-[11px] text-slate-500 dark:text-neutral-400">{t('home.threadCount')}</label>
                    <input type="number" value={downloadThreadCount} onChange={(e) => setDownloadThreadCount(Number(e.target.value) || 8)} className="input-field text-sm" min={1} max={64} />
                  </div>
                  <div className="p-2">
                    <label className="mb-1 block text-[11px] text-slate-500 dark:text-neutral-400">{t('home.speedLimit')}</label>
                    <input type="text" value={downloadMaxSpeed} onChange={(e) => setDownloadMaxSpeed(e.target.value)} placeholder="10M" className="input-field text-sm" />
                  </div>
                  <div className="p-2">
                    <label className="mb-1 block text-[11px] text-slate-500 dark:text-neutral-400">{t('home.outputFormat')}</label>
                    <select value={downloadMuxFormat} onChange={(e) => setDownloadMuxFormat(e.target.value)} className="input-field text-sm">
                      <option value="mp4">mp4</option>
                      <option value="mkv">mkv</option>
                    </select>
                  </div>
                  <div className="p-2">
                    <label className="mb-1 block text-[11px] text-slate-500 dark:text-neutral-400">{t('home.customArgs')}</label>
                    <input type="text" value={downloadCustomArgs} onChange={(e) => setDownloadCustomArgs(e.target.value)} placeholder="--header ..." className="input-field text-sm" />
                  </div>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-slate-50 dark:bg-neutral-800/60 p-2 text-xs text-slate-300 dark:text-neutral-600">
                    <input type="checkbox" checked={downloadAutoSelect} onChange={(e) => setDownloadAutoSelect(e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300 dark:border-white/5 text-blue-500 dark:text-blue-400" /> {t('settings.feature.autoSelect')}
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-slate-50 dark:bg-neutral-800/60 p-2 text-xs text-slate-300 dark:text-neutral-600">
                    <input type="checkbox" checked={downloadSubOnly} onChange={(e) => setDownloadSubOnly(e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300 dark:border-white/5 text-blue-500 dark:text-blue-400" /> {t('home.onlyDownloadSubtitles')}
                  </label>
                </div>
              )}
            </div>

            <div className="card p-5">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-2xl leading-none">🗂️</span>
                <span className="text-sm font-semibold text-slate-800 dark:text-neutral-100">{t('home.batchDownload')}</span>
              </div>

              <textarea
                value={batchText}
                onChange={(e) => setBatchText(e.target.value)}
                placeholder={t('home.batchPlaceholder')}
                className="input-field h-28 resize-none font-mono text-sm"
              />

              <div className="mt-4 flex flex-wrap gap-2">
                <button onClick={parseBatchUrls} className="btn-primary flex items-center gap-1.5 text-sm"><Play size={15} /> {t('home.parseLinks')}</button>
                <button
                  onClick={() => batchFileInputRef.current?.click()}
                  className="btn-secondary flex items-center gap-1.5 text-sm"
                >
                  <Upload size={15} /> {t('home.importTable')}
                </button>
                <button onClick={() => { setBatchText(''); setBatchItems([]) }} className="btn-secondary flex items-center gap-1.5 text-sm"><Trash2 size={15} /> {t('home.clear')}</button>
                <button onClick={startBatch} disabled={isBatchRunning || batchItems.length === 0} className="btn-secondary flex items-center gap-1.5 text-sm">
                  {isBatchRunning ? t('home.processing') : t('home.startAll')}
                </button>
                {isBatchRunning && (
                  <button onClick={stopBatch} className="btn-secondary flex items-center gap-1.5 text-sm">
                    {t('home.stopBatch')}
                  </button>
                )}
              </div>

              <input
                ref={batchFileInputRef}
                type="file"
                accept=".txt,.csv,.tsv,.xls,.xlsx"
                className="hidden"
                onChange={handleBatchImport}
              />

              {batchItems.length > 0 && (
                <div className="mt-4 space-y-2">
                  {batchItems.map((item) => {
                    const BatchIcon = STATUS_ICON_META[item.status]
                    const batchStatusText = item.status === 'running' ? t('home.downloadInProgress') : statusMeta[item.status].label
                    return (
                      <div key={item.id} className="flex items-center justify-between rounded-xl border border-slate-200 dark:border-neutral-800 bg-slate-50/60 dark:bg-neutral-800/45 px-3 py-2 text-sm">
                        <div className="min-w-0 flex-1 pr-3">
                          <div className="truncate font-medium text-slate-700 dark:text-neutral-200">{item.saveName}</div>
                          <div className="truncate text-[11px] text-slate-500 dark:text-neutral-400">{item.url}</div>
                        </div>
                        <span title={batchStatusText} className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
                          <BatchIcon.Icon size={14} className={`${BatchIcon.className}${BatchIcon.spin ? ' animate-spin' : ''}`} />
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
       </div>
      ) : (
       <div className="space-y-6">
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
                <button onClick={handlePasteFromClipboard} className="btn-secondary flex items-center gap-1.5 text-sm"><Clipboard size={14} /> {t('common.paste')}</button>
                <button onClick={() => setShowRecordAdvanced(!showRecordAdvanced)} className="btn-secondary flex items-center gap-1.5 text-sm">
                  <Settings2 size={14} /> {t('home.options')} {showRecordAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
              </div>
 
              {showRecordAdvanced && (
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
        </div>
      )}

      <div className="flex flex-1 flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-bold tracking-[0.18em] text-slate-500 dark:text-neutral-400 uppercase">{t('home.taskList')}</div>
          <span className="text-xs text-slate-500 dark:text-neutral-400">{visibleTasks.length} {t('common.tasks')}</span>
        </div>
        <div className="card flex flex-1 flex-col p-3">
          <div className="flex flex-1 flex-col gap-2">
            {visibleTasks.length > 0 ? visibleTasks.map((task) => renderTaskRow(task)) : (
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
    </div>
  )
}
