import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import * as XLSX from 'xlsx'
import {
  ChevronDown,
  ChevronUp,
  Clipboard,
  FileText,
  Link,
  Play,
  Radio,
  Settings2,
  Square,
  Trash2,
  Upload,
} from 'lucide-react'
import { useDownloadStore } from '@/store/downloadStore'
import { useHistoryStore } from '@/store/historyStore'
import { useSettingsStore } from '@/store/settingsStore'
import Modal from '@/components/Modal'
import { showToast } from '@/components/Toast'
import { extractFileName, formatDuration, formatFileSize, generateId } from '@/utils/format'
import { isValidUrl } from '@/utils/validators'
import { TASK_STATUS_META } from '@/utils/status'
import { buildTaskOptions } from '@/utils/taskOptions'
import type { DownloadTask } from '@/types/download'

interface BatchItem {
  id: string
  url: string
  saveName: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  progress: number
  taskId?: string
}

function isRecordTask(task: DownloadTask): boolean {
  return Boolean(
    task.options && (
      'liveRecordLimit' in task.options ||
      'liveTakeCount' in task.options ||
      'liveRealTimeMerge' in task.options ||
      'livePipeMux' in task.options ||
      'livePerformAsVod' in task.options ||
      'liveFixVttByAudio' in task.options
    )
  )
}

function getTaskRuntimeSeconds(startTime?: string): number {
  if (!startTime) return 0
  const start = Date.parse(startTime)
  if (Number.isNaN(start)) return 0
  return Math.max(0, Math.floor((Date.now() - start) / 1000))
}

/** 解析 "HH:mm:ss" / "mm:ss" 为秒；格式非法返回 -1 */
function parseLiveLimitRaw(raw: string): number {
  const trimmed = raw.trim()
  if (!trimmed) return -1
  const parts = trimmed.split(':').map(Number)
  if (parts.length < 2 || parts.length > 3) return -1
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return -1
  return parts.length === 3
    ? parts[0] * 3600 + parts[1] * 60 + parts[2]
    : parts[0] * 60 + parts[1]
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<'download' | 'record'>('download')

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
  const [recordTaskId, setRecordTaskId] = useState<string | null>(null)
  // IPC 订阅固化后 handler 无法捕获 state，改用 ref 读取最新录制任务 ID
  const recordTaskIdRef = useRef<string | null>(null)
  // 录制发起请求进行中：防止双击重复创建
  const [recordStarting, setRecordStarting] = useState(false)
  const [showRecordAdvanced, setShowRecordAdvanced] = useState(false)
  const [liveRealTimeMerge, setLiveRealTimeMerge] = useState(true)
  const [livePipeMux, setLivePipeMux] = useState(false)
  const [livePerformAsVod, setLivePerformAsVod] = useState(false)
  const [liveFixVttByAudio, setLiveFixVttByAudio] = useState(false)
  const [liveRecordLimit, setLiveRecordLimit] = useState('')
  const [liveWaitTime, setLiveWaitTime] = useState('')
  const [liveTakeCount, setLiveTakeCount] = useState('16')
  // 录制计时基准：由任务 startTime 派生（单一数据源），仅在存在活跃录制时每秒跳动
  const [nowTs, setNowTs] = useState(() => Date.now())

  const [batchText, setBatchText] = useState('')
  const [batchItems, setBatchItems] = useState<BatchItem[]>([])
  const [isBatchRunning, setIsBatchRunning] = useState(false)
  const [deleteConfirmTask, setDeleteConfirmTask] = useState<DownloadTask | null>(null)
  const batchFileInputRef = useRef<HTMLInputElement | null>(null)
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
          latestLog: data.latestLog || task.latestLog || '任务已完成'
        })
        addRecord({
          id: data.taskId,
          url: task.url,
          saveName: task.saveName,
          status: data.status === 'completed' ? 'completed' : data.status === 'cancelled' ? 'cancelled' : 'failed',
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

      if (data.taskId === recordTaskIdRef.current) {
        setRecordTaskId(null)
        recordTaskIdRef.current = null
      }

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

    return () => {
      offProgress()
      offLog()
      offComplete()
    }
    // 订阅仅挂载时注册一次：handler 内通过 getState()/ref 取最新值，避免随进度更新反复重挂
  }, [])

  const downloadTasks = tasks.filter((task) => !isRecordTask(task))
  const recordTasks = tasks.filter((task) => isRecordTask(task))
  const visibleTasks = activeTab === 'download' ? downloadTasks : recordTasks
  const activeDownloadTask = downloadTasks.find((task) => task.id === activeTaskId) ?? downloadTasks[0] ?? null
  const activeRecordTask = recordTasks.find((task) => task.id === activeTaskId) ?? recordTasks[0] ?? null

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
  const getRecordElapsed = (task: DownloadTask): number | null => {
    if (task.status !== 'running' && task.status !== 'pending') return null
    const start = Date.parse(task.startTime)
    if (Number.isNaN(start)) return 0
    return Math.max(0, Math.floor((nowTs - start) / 1000))
  }

  /** 解析录制时长限制为秒；未配置或非法返回 0（隐藏限额条） */
  const parseLiveLimitSeconds = (task: DownloadTask): number => {
    const seconds = parseLiveLimitRaw(String(task.options?.liveRecordLimit || ''))
    return seconds > 0 ? seconds : 0
  }

  // 录制监控面板数据（选中/首个录制任务）
  const monitorTask = activeRecordTask
  const monitorIsLive = !!monitorTask && (monitorTask.status === 'running' || monitorTask.status === 'pending')
  const monitorElapsed = monitorTask ? getRecordElapsed(monitorTask) ?? 0 : 0
  const monitorLimitSeconds = monitorTask ? parseLiveLimitSeconds(monitorTask) : 0
  const monitorLimitPct = monitorIsLive && monitorLimitSeconds > 0
    ? Math.min(100, (monitorElapsed / monitorLimitSeconds) * 100)
    : 0
  // 直播模式下 CLI 通常不输出分片汇总：分片为 0 且有帧率数据时改显帧率
  const monitorSegs = monitorTask ? Number(monitorTask.downloadedSegments || 0) : 0
  const monitorFps = monitorTask ? Number(monitorTask.currentFrameRate || 0) : 0
  const monitorThirdLabel = monitorSegs > 0 ? '分片' : monitorFps > 0 ? '帧率' : '分片'
  const monitorThirdValue = monitorSegs > 0
    ? String(monitorSegs)
    : monitorFps > 0 ? `${monitorFps} fps` : '0'

  const getTaskActionMessage = (
    action: '取消' | '重试' | '删除',
    outcome: 'success' | 'error' | 'info',
    detail: string
  ) => {
    const label = outcome === 'error' ? '失败' : '成功'
    return `${action}${label}：${detail}`
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
        showToast('info', '已从剪贴板粘贴 URL')
      }
    } catch {
      showToast('error', '无法读取剪贴板内容')
    }
  }

  const handleDownloadStart = async () => {
    if (!downloadUrl.trim()) {
      showToast('error', '请输入下载链接')
      return
    }
    if (!isValidUrl(downloadUrl)) {
      showToast('error', '请输入有效的 URL')
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
      showToast('error', `启动失败: ${result.error}`)
      setIsDownloading(false)
      return
    }

    const taskId = result.taskId || generateId()
    const task: DownloadTask = {
      id: taskId,
      url: downloadUrl.trim(),
      saveName: downloadName || extractFileName(downloadUrl),
      saveDir: settings.saveDir,
      status: 'pending',
      progress: 0,
      speed: '0 KB/s',
      downloadedSegments: 0,
      totalSegments: 0,
      startTime: new Date().toISOString(),
      logs: [],
      options: taskOptions
    }

    addTask(task)
    setActiveTask(taskId)
    showToast('success', '下载任务已启动')
  }

  const handleRecordStart = async () => {
    if (!recordUrl.trim()) {
      showToast('error', '请输入直播链接')
      return
    }
    if (!isValidUrl(recordUrl)) {
      showToast('error', '请输入有效的 URL')
      return
    }

    if (liveRecordLimit.trim() && parseLiveLimitRaw(liveRecordLimit) < 0) {
      showToast('error', '录制时长限制格式应为 HH:mm:ss 或 mm:ss')
      return
    }
    const waitRaw = liveWaitTime.trim()
    if (waitRaw) {
      const wait = Number(waitRaw)
      if (!Number.isFinite(wait) || wait < 0) {
        showToast('error', '刷新间隔必须为非负数字（秒）')
        return
      }
    }
    const takeRaw = liveTakeCount.trim()
    const takeCount = Number(takeRaw)
    if (takeRaw && (!Number.isInteger(takeCount) || takeCount < 1 || takeCount > 100)) {
      showToast('error', '片段数必须为 1-100 的整数')
      return
    }

    // 录制固定使用 MKV 封装：未完成的 MKV 仍可播放，
    // 规避硬杀进程导致 MP4 缺失 moov atom 而无法播放的问题
    const taskOptions = buildTaskOptions(settings, {
      url: recordUrl.trim(),
      saveName: recordName || extractFileName(recordUrl),
      autoSelect: true,
      muxFormat: 'mkv',
      liveRealTimeMerge,
      livePipeMux,
      livePerformAsVod,
      liveFixVttByAudio,
      liveRecordLimit: liveRecordLimit.trim() || undefined,
      liveWaitTime: waitRaw ? Number(waitRaw) : undefined,
      liveTakeCount: takeRaw ? takeCount : 16,
    })

    setRecordStarting(true)
    try {
      const result = await window.api.download.start(taskOptions)
      if (!result.success) {
        showToast('error', `启动失败: ${result.error}`)
        return
      }

      const taskId = result.taskId || generateId()
      setRecordTaskId(taskId)
      recordTaskIdRef.current = taskId
      const task: DownloadTask = {
        id: taskId,
        url: recordUrl.trim(),
        saveName: recordName || extractFileName(recordUrl),
        saveDir: settings.saveDir,
        status: 'running',
        progress: 0,
        speed: '0 KB/s',
        downloadedSegments: 0,
        totalSegments: 0,
        startTime: new Date().toISOString(),
        logs: [],
        options: taskOptions
      }

      addTask(task)
      setActiveTask(taskId)
      showToast('success', '录制已开始')
    } finally {
      setRecordStarting(false)
    }
  }

  const handleRecordStop = async () => {
    if (!recordTaskId) return
    await window.api.download.cancel(recordTaskId)
    showToast('info', '录制已停止')
  }

  const parseBatchUrls = () => {
    const lines = batchText.split('\n').map((line) => line.trim()).filter(Boolean)
    const validUrls = lines.filter(isValidUrl)
    if (validUrls.length === 0) {
      showToast('error', '未找到有效的 URL')
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
    showToast('success', `已解析 ${next.length} 个链接`)
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
      showToast('error', '未找到可导入的下载链接，模板必须是 A 列名称 / B 列链接')
      return
    }

    setBatchItems((prev) => [...prev, ...parsedRows])
    showToast('success', `已导入 ${parsedRows.length} 个任务`)
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
      if (name.toLowerCase() === '名称' || name.toLowerCase() === '名字' || name.toLowerCase() === 'name' || name.toLowerCase() === 'url' || name.toLowerCase() === '链接' || name.toLowerCase() === '地址') {
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
          const headerLike = ['名称', '名字', '文件名', 'name', 'title', '链接', 'url', '地址', 'http', 'https']
          if (!firstCell || !secondCell) return
          if (headerLike.includes(firstCell) || headerLike.includes(secondCell)) return
          const urlCell = secondCell.includes('http') ? secondCell : extractUrlCandidate(secondCell)
          if (!urlCell || !isValidUrl(urlCell)) return
          parsedRows.push({ name: firstCell, url: urlCell })
        })

        appendImportedBatchItems(parsedRows)
      } else {
        showToast('error', '仅支持 .txt .csv .tsv .xlsx .xls 文件导入')
      }
    } catch {
      showToast('error', '导入失败：文件内容无法解析，请检查格式是否符合 A 列名称 / B 列链接')
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
      showToast('error', '请先添加下载链接')
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
        saveName: item.saveName,
        saveDir: settings.saveDir,
        status: 'pending',
        progress: 0,
        speed: '0 KB/s',
        downloadedSegments: 0,
        totalSegments: 0,
        startTime: new Date().toISOString(),
        logs: [],
        options
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
    showToast(aborted ? 'info' : 'success', aborted ? '批量下载已停止，剩余任务保持待处理' : '批量下载已全部处理完成')
  }

  const stopBatch = () => {
    batchAbortRef.current = true
    showToast('info', '正在停止批量任务，进行中的任务将继续完成…')
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
        return { success: false, message: result?.error || '清理失败：相关下载文件未能删除' }
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
      return { success: true, message: '已删除相关下载文件和临时文件' }
    } catch {
      return { success: false, message: '清理失败：相关下载文件未能删除' }
    }
  }

  const handleTaskCancel = async (task: DownloadTask) => {
    const actionText = '取消' as const
    try {
      const cancelResult = await window.api.download.cancel(task.id)
      if (!cancelResult?.success) {
        showToast('error', getTaskActionMessage(actionText, 'error', '任务可能已结束，已下载文件未被清理'))
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
        ? getTaskActionMessage(actionText, 'success', '已删除已下载文件和临时文件，记录标记为已取消')
        : getTaskActionMessage(actionText, 'success', '已取消，但部分文件清理失败'))
    } catch {
      showToast('error', getTaskActionMessage(actionText, 'error', '任务未能正常终止，已下载文件未被清理'))
    }
  }

  const handleTaskRetry = async (task: DownloadTask) => {
    const actionText = '重试' as const
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
        showToast('error', getTaskActionMessage(actionText, 'error', result?.error || '未知错误'))
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
        latestLog: `${actionText}中`,
        startTime: new Date().toISOString(),
        logs: [{ timestamp: new Date().toISOString(), level: 'INFO', message: `${actionText}中` }],
        options
      }
      addTask(recreated)
      setActiveTask(newTaskId)
      showToast('success', getTaskActionMessage(actionText, 'success', '旧任务残留已清理，正在重新下载'))
    } catch {
      showToast('error', getTaskActionMessage(actionText, 'error', '无法重新启动任务，旧下载残留未清理'))
    }
  }

  const handleTaskDelete = async (task: DownloadTask) => {
    const actionText = '删除' as const
    try {
      const cleanupResult = await deleteTaskArtifactsAndCleanup(task)
      if (!cleanupResult.success) {
        showToast('error', getTaskActionMessage(actionText, 'error', cleanupResult.message))
        return
      }
      showToast('success', getTaskActionMessage(actionText, 'success', '已清理相关下载文件和临时文件'))
    } catch {
      showToast('error', getTaskActionMessage(actionText, 'error', '任务文件可能还在，未能完成清理'))
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
      showToast('info', '没有保存位置信息')
      return
    }
    const error = await window.api.shell.openPath(dir)
    error ? showToast('error', `打开失败: ${error}`) : showToast('success', '已打开所在文件夹')
  }

  /** 录制任务行：直播录制是开放式过程，用已录时长/体积/速率取代无意义的进度百分比 */
  const renderRecordRow = (task: DownloadTask) => {
    const live = task.status === 'running' || task.status === 'pending'
    const elapsed = getRecordElapsed(task)
    const limitSeconds = parseLiveLimitSeconds(task)
    const limitPct = live && limitSeconds > 0 && elapsed !== null
      ? Math.min(100, (elapsed / limitSeconds) * 100)
      : 0
    const captured = Number(task.downloadedBytes || 0)

    return (
      <div key={task.id} className={`rounded-2xl border p-2.5 shadow-sm ${live ? 'border-red-200 bg-red-50/40' : 'border-slate-200 bg-slate-50/70'}`}>
        <div className="flex items-start gap-2.5">
          <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${live ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-500'}`}>
            {live ? (
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
              </span>
            ) : (
              <Radio size={13} />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <h3 className="truncate text-[14px] font-semibold text-slate-800">{task.saveName || task.url}</h3>
              <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${TASK_STATUS_META[task.status].tone}`}>
                {live && <span className="h-1.5 w-1.5 rounded-full bg-red-500" />}
                {task.status === 'running' ? '录制中' : TASK_STATUS_META[task.status].label}
              </span>
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-slate-400">
              {elapsed !== null ? (
                <span className="font-mono tabular-nums">已录 {formatDuration(elapsed)}</span>
              ) : null}
              {captured > 0 && <span>{formatFileSize(captured)}</span>}
              {live && task.speed && task.speed !== '0 KB/s' && <span>{task.speed}</span>}
              <span className="truncate max-w-[260px]" title={task.url}>{task.url}</span>
            </div>

            {live && limitSeconds > 0 && (
              <div className="mt-1.5">
                <div className="h-1 overflow-hidden rounded-full bg-slate-200">
                  <div className="h-full rounded-full bg-red-500 transition-all" style={{ width: `${limitPct}%` }} />
                </div>
                <div className="mt-0.5 flex justify-between text-[9px] text-slate-400">
                  <span>限额 {task.options?.liveRecordLimit}</span>
                  <span>剩余 {formatDuration(Math.max(0, limitSeconds - (elapsed ?? 0)))}</span>
                </div>
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {live ? (
              <button
                // 录制停止必须保留已录内容：直接取消进程，不走会删除产物的 handleTaskCancel
                onClick={async () => {
                  await window.api.download.cancel(task.id)
                  showToast('info', '录制已停止，已录内容已保存')
                }}
                className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[10px] font-medium text-red-600 hover:bg-red-100"
              >
                停止
              </button>
            ) : (
              <>
                {task.saveDir && (
                  <button
                    onClick={() => openTaskFolder(task)}
                    className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-600 hover:bg-slate-100"
                  >
                    打开
                  </button>
                )}
                {task.status === 'failed' && (
                  <button
                    onClick={() => handleTaskRetry(task)}
                    className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-700 hover:bg-emerald-100"
                  >
                    重试
                  </button>
                )}
                {(task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') && (
                  <button
                    onClick={() => openDeleteConfirm(task)}
                    className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[10px] font-medium text-red-700 hover:bg-red-100"
                  >
                    删除
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

  const renderTaskRow = (task: DownloadTask, index: number) => {
    if (isRecordTask(task)) return renderRecordRow(task)
    const progress = Math.min(100, Math.max(0, Number(task.progress) || 0))
    const canCancel = task.status === 'running' || task.status === 'pending'
    const canRetry = task.status === 'failed' || task.status === 'cancelled'
    const canDelete = task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled'
    const statusText = task.status === 'running' ? '下载中' : TASK_STATUS_META[task.status].label

    return (
      <div key={task.id} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-2.5 shadow-sm">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[11px] font-bold text-slate-600">
            {index + 1}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <h3 className="truncate text-[14px] font-semibold text-slate-800">{task.saveName || task.url}</h3>
              <span className={`inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${TASK_STATUS_META[task.status].tone}`}>
                {statusText}
              </span>
            </div>

            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200">
                <div
                  className={`h-full rounded-full ${task.status === 'completed' ? 'bg-emerald-500' : task.status === 'failed' ? 'bg-red-500' : task.status === 'cancelled' ? 'bg-amber-500' : 'bg-blue-500'}`}
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="text-[10px] font-medium text-slate-500">{Math.round(progress)}%</span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              onClick={() => canCancel && handleTaskCancel(task)}
              disabled={!canCancel}
              className={`rounded-md border px-2 py-1 text-[10px] font-medium ${canCancel ? 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100' : 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'}`}
            >
              取消
            </button>
            <button
              onClick={() => canRetry && handleTaskRetry(task)}
              disabled={!canRetry}
              className={`rounded-md border px-2 py-1 text-[10px] font-medium ${canRetry ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'}`}
            >
              重试
            </button>
            <button
              onClick={() => canDelete && openDeleteConfirm(task)}
              disabled={!canDelete}
              className={`rounded-md border px-2 py-1 text-[10px] font-medium ${canDelete ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100' : 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'}`}
            >
              删除
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Modal open={Boolean(deleteConfirmTask)} onClose={() => setDeleteConfirmTask(null)} title="删除任务" width="max-w-md">
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">任务名称</div>
            <div className="mt-1 truncate text-sm font-semibold text-slate-700">{deleteConfirmTask?.saveName || deleteConfirmTask?.url || ''}</div>
          </div>

          <p className="text-sm leading-6 text-slate-600">
            删除后将同时清理已下载文件、临时文件和相关缓存内容，操作无法撤销。
          </p>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              onClick={() => setDeleteConfirmTask(null)}
              className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
            >
              取消
            </button>
            <button
              onClick={() => deleteConfirmTask && handleTaskDelete(deleteConfirmTask)}
              className="rounded-lg border border-red-200 bg-red-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-red-500"
            >
              确认删除
            </button>
          </div>
        </div>
      </Modal>

      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold tracking-[0.18em] text-slate-500 uppercase">Overview</div>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">任务总览</h1>
        </div>
        <div className="flex items-center gap-2" />
      </div>

      <div className="flex justify-center">
        <div className="w-full max-w-[340px] rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
          <div className="inline-flex w-full rounded-xl bg-slate-100 p-1">
            <button
              className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition ${activeTab === 'download' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500'}`}
              onClick={() => setActiveTab('download')}
            >
              下载任务
            </button>
            <button
              className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition ${activeTab === 'record' ? 'bg-white text-red-600 shadow-sm' : 'text-slate-500'}`}
              onClick={() => setActiveTab('record')}
            >
              录制任务
            </button>
          </div>
        </div>
      </div>

      {activeTab === 'download' ? (
        <div className="space-y-6">
            <div className="card p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                  <Link size={15} />
                </div>
                <span className="text-sm font-semibold text-slate-800">下载入口</span>
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={downloadUrl}
                  onChange={(e) => handleDownloadUrlChange(e.target.value)}
                  placeholder="粘贴 m3u8 / mpd / ism 链接..."
                  className="input-field flex-1"
                  onKeyDown={(e) => e.key === 'Enter' && !isDownloading && handleDownloadStart()}
                />
                <button onClick={handlePasteFromClipboard} className="btn-secondary flex items-center gap-1.5 whitespace-nowrap text-sm">
                  <Clipboard size={14} /> 粘贴
                </button>
              </div>

              <input
                type="text"
                value={downloadName}
                onChange={(e) => setDownloadName(e.target.value)}
                placeholder="保存文件名（可选）"
                className="input-field mt-3"
              />

              <div className="mt-4 flex items-center justify-between gap-2">
                <button onClick={() => setShowDownloadAdvanced(!showDownloadAdvanced)} className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors">
                  <Settings2 size={13} /> 高级选项 {showDownloadAdvanced ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </button>
                <div className="flex gap-2">
                  <button onClick={handleDownloadStart} disabled={isDownloading} className="btn-primary flex items-center gap-2 text-sm">
                    <Play size={16} /> {isDownloading ? '启动中...' : '开始下载'}
                  </button>
                </div>
              </div>

              {showDownloadAdvanced && (
                <div className="mt-4 grid grid-cols-2 gap-2.5">
                  <div className="p-2">
                    <label className="mb-1 block text-[11px] text-slate-500">线程数</label>
                    <input type="number" value={downloadThreadCount} onChange={(e) => setDownloadThreadCount(Number(e.target.value) || 8)} className="input-field text-sm" min={1} max={64} />
                  </div>
                  <div className="p-2">
                    <label className="mb-1 block text-[11px] text-slate-500">限速</label>
                    <input type="text" value={downloadMaxSpeed} onChange={(e) => setDownloadMaxSpeed(e.target.value)} placeholder="如 10M" className="input-field text-sm" />
                  </div>
                  <div className="p-2">
                    <label className="mb-1 block text-[11px] text-slate-500">输出格式</label>
                    <select value={downloadMuxFormat} onChange={(e) => setDownloadMuxFormat(e.target.value)} className="input-field text-sm">
                      <option value="mp4">mp4</option>
                      <option value="mkv">mkv</option>
                    </select>
                  </div>
                  <div className="p-2">
                    <label className="mb-1 block text-[11px] text-slate-500">自定义参数</label>
                    <input type="text" value={downloadCustomArgs} onChange={(e) => setDownloadCustomArgs(e.target.value)} placeholder="--header ..." className="input-field text-sm" />
                  </div>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
                    <input type="checkbox" checked={downloadAutoSelect} onChange={(e) => setDownloadAutoSelect(e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600" /> 自动选择最佳流
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
                    <input type="checkbox" checked={downloadSubOnly} onChange={(e) => setDownloadSubOnly(e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600" /> 仅下载字幕
                  </label>
                </div>
              )}
            </div>

            <div className="card p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                  <FileText size={15} />
                </div>
                <span className="text-sm font-semibold text-slate-800">批量下载</span>
              </div>

              <textarea
                value={batchText}
                onChange={(e) => setBatchText(e.target.value)}
                placeholder={'每行粘贴一个 URL\nhttps://example.com/video1.m3u8\nhttps://example.com/video2.m3u8\n\n也可导入 .txt / .csv / .xlsx 表格，固定按 A 列名称、B 列链接解析'}
                className="input-field h-28 resize-none font-mono text-sm"
              />

              <div className="mt-4 flex flex-wrap gap-2">
                <button onClick={parseBatchUrls} className="btn-primary flex items-center gap-1.5 text-sm"><Play size={15} /> 解析链接</button>
                <button
                  onClick={() => batchFileInputRef.current?.click()}
                  className="btn-secondary flex items-center gap-1.5 text-sm"
                >
                  <Upload size={15} /> 导入表格
                </button>
                <button onClick={() => { setBatchText(''); setBatchItems([]) }} className="btn-secondary flex items-center gap-1.5 text-sm"><Trash2 size={15} /> 清空</button>
                <button onClick={startBatch} disabled={isBatchRunning || batchItems.length === 0} className="btn-secondary flex items-center gap-1.5 text-sm">
                  {isBatchRunning ? '处理中...' : '开始全部'}
                </button>
                {isBatchRunning && (
                  <button onClick={stopBatch} className="btn-secondary flex items-center gap-1.5 text-sm">
                    停止批量
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
                  {batchItems.map((item) => (
                    <div key={item.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 text-sm">
                      <div className="min-w-0 flex-1 pr-3">
                        <div className="truncate font-medium text-slate-700">{item.saveName}</div>
                        <div className="truncate text-[11px] text-slate-500">{item.url}</div>
                      </div>
                      <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${TASK_STATUS_META[item.status].tone}`}>
                        {item.status === 'running' ? '下载中' : TASK_STATUS_META[item.status].label}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
       </div>
      ) : (
       <div className="space-y-6">
           <div className="card p-5 bg-gradient-to-br from-white to-red-50/40">
              <div className="flex items-center gap-2 mb-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-50 text-red-600">
                  <Radio size={15} />
                </div>
                <span className="text-sm font-semibold text-slate-800">直播录制入口</span>
                {activeRecordCount > 0 && (
                  <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2 py-1 text-[11px] font-medium text-red-600">
                    <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" /> 录制中{activeRecordCount > 1 ? ` ×${activeRecordCount}` : ''}
                  </span>
                )}
              </div>

              <div className="space-y-2.5">
                <input type="text" value={recordUrl} onChange={(e) => setRecordUrl(e.target.value)} placeholder="粘贴直播 m3u8 / mpd 链接..." className="input-field" />
                <input type="text" value={recordName} onChange={(e) => setRecordName(e.target.value)} placeholder="保存文件名（可选）" className="input-field" />
              </div>

              <div className="mt-4 flex gap-2">
                <button onClick={handlePasteFromClipboard} className="btn-secondary flex items-center gap-1.5 text-sm"><Clipboard size={14} /> 粘贴</button>
                <button onClick={() => setShowRecordAdvanced(!showRecordAdvanced)} className="btn-secondary flex items-center gap-1.5 text-sm">
                  <Settings2 size={14} /> 选项 {showRecordAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
              </div>

              {showRecordAdvanced && (
                <div className="mt-4 grid grid-cols-2 gap-2.5">
                  {[
                    { v: liveRealTimeMerge, s: setLiveRealTimeMerge, l: '实时合并' },
                    { v: livePipeMux, s: setLivePipeMux, l: '管道混流' },
                    { v: livePerformAsVod, s: setLivePerformAsVod, l: '以点播方式下载' },
                    { v: liveFixVttByAudio, s: setLiveFixVttByAudio, l: '通过音频修正 VTT' },
                  ].map(({ v, s, l }) => (
                    <label key={l} className="flex cursor-pointer items-center gap-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
                      <input type="checkbox" checked={v} onChange={(e) => s(e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300 text-red-600" />
                      {l}
                    </label>
                  ))}
                  <div className="p-2">
                    <label className="mb-1 block text-[11px] text-slate-500">录制时长限制</label>
                    <input type="text" value={liveRecordLimit} onChange={(e) => setLiveRecordLimit(e.target.value)} placeholder="HH:mm:ss" className="input-field text-sm" />
                  </div>
                  <div className="p-2">
                    <label className="mb-1 block text-[11px] text-slate-500">刷新间隔 (秒)</label>
                    <input type="number" value={liveWaitTime} onChange={(e) => setLiveWaitTime(e.target.value)} placeholder="自动" className="input-field text-sm" />
                  </div>
                  <div className="p-2">
                    <label className="mb-1 block text-[11px] text-slate-500">片段数</label>
                    <input type="number" value={liveTakeCount} onChange={(e) => setLiveTakeCount(e.target.value)} min={1} max={100} className="input-field text-sm" />
                  </div>
                </div>
              )}

              <div className="mt-4 flex gap-2">
                <button onClick={handleRecordStart} disabled={recordStarting} className="btn-primary flex items-center gap-2 text-sm"><Play size={16} /> {recordStarting ? '启动中...' : '开始录制'}</button>
                <button onClick={handleRecordStop} disabled={!recordTaskId} className="btn-secondary flex items-center gap-2 text-sm"><Square size={14} /> 停止</button>
              </div>
              <p className="mt-2 text-[11px] text-slate-400">录制固定使用 MKV 封装：即使程序异常中断，已录内容仍可正常播放。可同时发起多个录制任务。</p>
            </div>

            <div className="card p-5">
              <div className={`mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] ${monitorIsLive ? 'text-red-500' : 'text-slate-400'}`}>
                <Radio size={12} />
                {monitorIsLive ? '正在录制' : '录制监控'}
              </div>

              {monitorTask && monitorIsLive ? (
                <div>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="relative flex h-2.5 w-2.5 shrink-0">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-800">{monitorTask.saveName || monitorTask.url}</div>
                        <div className="truncate text-[11px] text-slate-400">{monitorTask.url}</div>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="font-mono text-2xl font-bold tabular-nums tracking-tight text-slate-900">{formatDuration(monitorElapsed)}</div>
                      <div className="text-[10px] uppercase tracking-[0.14em] text-slate-400">已录时长</div>
                    </div>
                  </div>

                  {monitorLimitSeconds > 0 && (
                    <div className="mt-3">
                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-red-500 transition-all" style={{ width: `${monitorLimitPct}%` }} />
                      </div>
                      <div className="mt-1 flex justify-between text-[10px] text-slate-400">
                        <span>限额 {monitorTask.options?.liveRecordLimit}</span>
                        <span>剩余 {formatDuration(Math.max(0, monitorLimitSeconds - monitorElapsed))}</span>
                      </div>
                    </div>
                  )}

                  <div className="mt-4 grid grid-cols-3 gap-2.5">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5">
                      <div className="text-[10px] uppercase tracking-[0.12em] text-slate-400">已捕获</div>
                      <div className="mt-1 text-sm font-bold text-slate-800">{formatFileSize(Number(monitorTask.downloadedBytes || 0))}</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5">
                      <div className="text-[10px] uppercase tracking-[0.12em] text-slate-400">实时速率</div>
                      <div className="mt-1 text-sm font-bold text-slate-800">{monitorTask.speed || '0 KB/s'}</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5">
                      <div className="text-[10px] uppercase tracking-[0.12em] text-slate-400">{monitorThirdLabel}</div>
                      <div className="mt-1 text-sm font-bold text-slate-800">{monitorThirdValue}</div>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="min-w-0 truncate text-[11px] text-slate-400" title={monitorTask.saveDir || settings.saveDir}>
                      保存至 {monitorTask.saveDir || settings.saveDir}
                    </div>
                    <button onClick={() => openTaskFolder(monitorTask)}
                      className="shrink-0 rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-600 hover:bg-slate-100">
                      打开
                    </button>
                  </div>

                  {monitorTask.latestLog && (
                    <p className="mt-2 truncate text-[11px] text-slate-400" title={monitorTask.latestLog}>{monitorTask.latestLog}</p>
                  )}

                  <button
                    onClick={async () => {
                      await window.api.download.cancel(monitorTask.id)
                      showToast('info', '录制已停止，已录内容已保存')
                    }}
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-red-500"
                  >
                    <Square size={15} /> 停止录制并保存
                  </button>
                </div>
              ) : monitorTask ? (
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-800">{monitorTask.saveName || monitorTask.url}</div>
                      <div className="truncate text-[11px] text-slate-400">{monitorTask.url}</div>
                    </div>
                    <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${TASK_STATUS_META[monitorTask.status].tone}`}>
                      {TASK_STATUS_META[monitorTask.status].label}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
                    {Number(monitorTask.downloadedBytes || 0) > 0 && (
                      <span>录制数据 {formatFileSize(Number(monitorTask.downloadedBytes))}</span>
                    )}
                    {monitorTask.latestLog && <span className="truncate">{monitorTask.latestLog}</span>}
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="min-w-0 truncate text-[11px] text-slate-400" title={monitorTask.saveDir || settings.saveDir}>
                      保存至 {monitorTask.saveDir || settings.saveDir}
                    </div>
                    <button onClick={() => openTaskFolder(monitorTask)}
                      className="shrink-0 rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-600 hover:bg-slate-100">
                      打开文件夹
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <Radio size={28} className="mb-2 text-slate-300" />
                  <p className="text-sm text-slate-400">暂无进行中的录制</p>
                  <p className="mt-1 text-xs text-slate-300">在上方粘贴直播链接即可开始录制</p>
                </div>
              )}
            </div>
       </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-bold tracking-[0.18em] text-slate-500 uppercase">任务列表</div>
          <span className="text-xs text-slate-500">{visibleTasks.length} 个任务</span>
        </div>
        <div className="card p-3">
          <div className="space-y-2">
            {visibleTasks.length > 0 ? visibleTasks.map((task, index) => renderTaskRow(task, index)) : (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500 text-center">
                暂无{activeTab === 'download' ? '下载' : '录制'}任务，直接在上方创建{activeTab === 'download' ? '下载' : '录制'}任务。
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

