import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import * as XLSX from 'xlsx'
import {
  Activity,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clipboard,
  Download,
  FileText,
  FolderOpen,
  Link,
  Play,
  Radio,
  Settings2,
  Sparkles,
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
import type { DownloadTask } from '@/types/download'

interface BatchItem {
  id: string
  url: string
  saveName: string
  status: 'pending' | 'running' | 'completed' | 'failed'
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

function formatNetworkSpeed(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '0 KB/s'

  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  let value = bytesPerSecond
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  const precision = value >= 10 ? 1 : 2
  return `${value.toFixed(precision)} ${units[unitIndex]}`
}

function parseSpeedToBytesPerSecond(raw: string): number {
  const match = raw.match(/([\d.]+)\s*(B\/s|KB\/s|MB\/s|GB\/s|Bps|KBps|MBps|GBps)/i)
  if (!match) return 0

  const value = Number(match[1]) || 0
  const unit = match[2].toLowerCase().replace(/ps$/, '/s')
  const base: Record<string, number> = {
    'b/s': 1,
    'kb/s': 1024,
    'mb/s': 1024 * 1024,
    'gb/s': 1024 * 1024 * 1024
  }
  return value * (base[unit] ?? 1)
}

const statusMap = {
  pending: { label: '等待', tone: 'bg-slate-100 text-slate-600' },
  running: { label: '进行中', tone: 'bg-blue-50 text-blue-700' },
  completed: { label: '已完成', tone: 'bg-emerald-50 text-emerald-700' },
  failed: { label: '失败', tone: 'bg-red-50 text-red-700' },
  cancelled: { label: '已取消', tone: 'bg-amber-50 text-amber-700' }
} as const

export default function Home() {
  const [activeTab, setActiveTab] = useState<'download' | 'record'>('download')

  const [downloadUrl, setDownloadUrl] = useState('')
  const [downloadName, setDownloadName] = useState('')
  const [showDownloadAdvanced, setShowDownloadAdvanced] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [downloadElapsed, setDownloadElapsed] = useState(0)
  const downloadTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [downloadThreadCount, setDownloadThreadCount] = useState(8)
  const [downloadAutoSelect, setDownloadAutoSelect] = useState(true)
  const [downloadMuxFormat, setDownloadMuxFormat] = useState('mp4')
  const [downloadMaxSpeed, setDownloadMaxSpeed] = useState('')
  const [downloadSubOnly, setDownloadSubOnly] = useState(false)
  const [downloadCustomArgs, setDownloadCustomArgs] = useState('')

  const [recordUrl, setRecordUrl] = useState('')
  const [recordName, setRecordName] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [recordTaskId, setRecordTaskId] = useState<string | null>(null)
  const [recordDuration, setRecordDuration] = useState(0)
  const [recordSize, setRecordSize] = useState(0)
  const [showRecordAdvanced, setShowRecordAdvanced] = useState(false)
  const [liveRealTimeMerge, setLiveRealTimeMerge] = useState(true)
  const [livePipeMux, setLivePipeMux] = useState(false)
  const [livePerformAsVod, setLivePerformAsVod] = useState(false)
  const [liveFixVttByAudio, setLiveFixVttByAudio] = useState(false)
  const [liveRecordLimit, setLiveRecordLimit] = useState('')
  const [liveWaitTime, setLiveWaitTime] = useState('')
  const [liveTakeCount, setLiveTakeCount] = useState('16')
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [batchText, setBatchText] = useState('')
  const [batchItems, setBatchItems] = useState<BatchItem[]>([])
  const [isBatchRunning, setIsBatchRunning] = useState(false)
  const [deleteConfirmTask, setDeleteConfirmTask] = useState<DownloadTask | null>(null)
  const batchFileInputRef = useRef<HTMLInputElement | null>(null)

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
        const nextStatus = data.status === 'completed' ? 'completed' : data.status === 'failed' || data.status === 'cancelled' ? 'failed' : 'running'
        return {
          ...entry,
          status: nextStatus,
          progress: typeof data.progress === 'number' ? Number(data.progress) : entry.progress
        }
      }))
      if (data.taskId === recordTaskId) {
        setRecordSize((prev) => Math.max(prev, Number(data.downloadedBytes || prev || 0)))
      }
    }

    const handleLog = (data: any) => {
      useDownloadStore.getState().addLog(data.taskId, {
        timestamp: new Date().toISOString(),
        level: data.level,
        message: data.message
      })
    }

    const handleComplete = (data: any) => {
      const task = useDownloadStore.getState().getTask(data.taskId)
      if (task) {
        updateTask(data.taskId, {
          status: data.status,
          progress: typeof data.progress === 'number' ? data.progress : 100,
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
          outputPath: task.saveDir || task.options?.saveDir || settings.saveDir || '',
          duration: getTaskRuntimeSeconds(task.startTime)
        })
      }

      setBatchItems((prev) => prev.map((entry) => {
        if (entry.taskId !== data.taskId) return entry
        const nextStatus = data.status === 'completed' ? 'completed' : data.status === 'failed' || data.status === 'cancelled' ? 'failed' : 'running'
        return {
          ...entry,
          status: nextStatus,
          progress: typeof data.progress === 'number' ? Number(data.progress) : entry.progress
        }
      }))

      if (data.taskId === recordTaskId) {
        setIsRecording(false)
        setRecordTaskId(null)
        if (recordTimerRef.current) clearInterval(recordTimerRef.current)
      }

      const hasActiveDownload = useDownloadStore.getState().tasks.some((candidate) => {
        if (isRecordTask(candidate)) return false
        return candidate.status === 'pending' || candidate.status === 'running'
      })
      if (!hasActiveDownload) {
        setIsDownloading(false)
        if (downloadTimerRef.current) clearInterval(downloadTimerRef.current)
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
  }, [addRecord, recordTaskId, tasks, updateTask])

  const downloadTasks = tasks.filter((task) => !isRecordTask(task))
  const recordTasks = tasks.filter((task) => isRecordTask(task))
  const activeDownloadTask = downloadTasks.find((task) => task.id === activeTaskId) ?? downloadTasks[0] ?? null
  const activeRecordTask = recordTasks.find((task) => task.id === activeTaskId) ?? recordTasks[0] ?? null
  const currentTask = activeTab === 'download' ? activeDownloadTask : activeRecordTask

  const getTaskMeta = (task: DownloadTask) => {
    const progress = Math.min(100, Math.max(0, Number(task.progress) || 0))
    const downloadedBytes = Number(task.downloadedBytes ?? 0)
    const totalBytes = Number(task.totalBytes ?? 0)
    const sizeSummary = totalBytes > 0
      ? `${formatFileSize(downloadedBytes)} / ${formatFileSize(totalBytes)}`
      : task.totalSegments > 0
        ? `${task.downloadedSegments || 0} / ${task.totalSegments}`
        : '0 / 0'

    if (isRecordTask(task)) {
      return {
        tag: '录制任务',
        status: statusMap[task.status].label,
        progressText: `${progress}%`,
        sizeSummary,
        speed: task.speed || '0 KB/s'
      }
    }
    return {
      tag: '下载任务',
      status: statusMap[task.status].label,
      progressText: `${progress}%`,
      sizeSummary,
      speed: task.speed || '0 KB/s'
    }
  }

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
    setDownloadElapsed(0)
    if (downloadTimerRef.current) clearInterval(downloadTimerRef.current)
    downloadTimerRef.current = setInterval(() => setDownloadElapsed((prev) => prev + 1), 1000)

    const taskOptions = {
      url: downloadUrl.trim(),
      saveName: downloadName || extractFileName(downloadUrl),
      saveDir: settings.saveDir,
      tmpDir: settings.tmpDir,
      threadCount: downloadThreadCount,
      autoSelect: downloadAutoSelect,
      muxFormat: downloadMuxFormat,
      maxSpeed: downloadMaxSpeed || undefined,
      subOnly: downloadSubOnly,
      customArgs: downloadCustomArgs || undefined,
      ffmpegPath: settings.ffmpegPath || undefined,
      mp4decryptPath: settings.mp4decryptPath || undefined,
      autoSubtitleFix: settings.autoSubtitleFix,
      subFormat: settings.subFormat,
      binaryMerge: settings.binaryMerge,
      writeMetaJson: settings.writeMetaJson,
      concurrentDownload: settings.concurrentDownload,
      delAfterDone: settings.delAfterDone,
      useSystemProxy: settings.useSystemProxy,
      proxy: settings.proxy || undefined,
      headers: Object.keys(settings.headers).length > 0 ? settings.headers : undefined,
      logLevel: settings.logLevel,
      decryptionEngine: settings.decryptionEngine,
      downloadRetryCount: settings.downloadRetryCount,
      httpRequestTimeout: settings.httpRequestTimeout,
      checkSegmentsCount: settings.checkSegmentsCount,
      baseUrl: settings.baseUrl || undefined,
      skipMerge: settings.skipMerge || undefined,
      customHlsMethod: settings.customHlsMethod || undefined,
      customHlsKey: settings.customHlsKey || undefined,
      customHlsIv: settings.customHlsIv || undefined,
      customRange: settings.customRange || undefined,
      adKeywords: settings.adKeywords?.length > 0 ? settings.adKeywords : undefined,
      allowHlsMultiExtMap: settings.allowHlsMultiExtMap || undefined,
      keyTextFile: settings.keyTextFile || undefined,
      mp4RealTimeDecryption: settings.mp4RealTimeDecryption || undefined,
      appendUrlParams: settings.appendUrlParams || undefined,
      noDateInfo: settings.noDateInfo || undefined,
      noLog: settings.noLog || undefined,
    }

    const result = await window.api.download.start(taskOptions)
    if (!result.success) {
      showToast('error', `启动失败: ${result.error}`)
      setIsDownloading(false)
      if (downloadTimerRef.current) clearInterval(downloadTimerRef.current)
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

    setIsRecording(true)
    setRecordDuration(0)
    setRecordSize(0)
    if (recordTimerRef.current) clearInterval(recordTimerRef.current)
    recordTimerRef.current = setInterval(() => setRecordDuration((prev) => prev + 1), 1000)

    const taskOptions = {
      url: recordUrl.trim(),
      saveName: recordName || extractFileName(recordUrl),
      saveDir: settings.saveDir,
      tmpDir: settings.tmpDir,
      threadCount: settings.threadCount,
      autoSelect: true,
      delAfterDone: settings.delAfterDone,
      muxFormat: settings.muxFormat,
      liveRealTimeMerge,
      livePipeMux,
      livePerformAsVod,
      liveFixVttByAudio,
      liveRecordLimit: liveRecordLimit || undefined,
      liveWaitTime: liveWaitTime ? Number(liveWaitTime) : undefined,
      liveTakeCount: Number(liveTakeCount) || 16,
      maxSpeed: settings.maxSpeed || undefined,
      proxy: settings.proxy || undefined,
      headers: Object.keys(settings.headers).length > 0 ? settings.headers : undefined,
      autoSubtitleFix: settings.autoSubtitleFix,
      logLevel: settings.logLevel,
    }

    const result = await window.api.download.start(taskOptions)
    if (!result.success) {
      showToast('error', `启动失败: ${result.error}`)
      setIsRecording(false)
      if (recordTimerRef.current) clearInterval(recordTimerRef.current)
      return
    }

    const taskId = result.taskId || generateId()
    setRecordTaskId(taskId)
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
  }

  const handleRecordStop = async () => {
    if (!recordTaskId) return
    await window.api.download.cancel(recordTaskId)
    setIsRecording(false)
    if (recordTimerRef.current) clearInterval(recordTimerRef.current)
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

  const startBatch = async () => {
    if (batchItems.length === 0) {
      showToast('error', '请先添加下载链接')
      return
    }

    setIsBatchRunning(true)
    for (const item of batchItems) {
      setBatchItems((prev) => prev.map((entry) => entry.id === item.id ? { ...entry, status: 'running', taskId: undefined } : entry))

      const options = {
        url: item.url,
        saveName: item.saveName,
        saveDir: settings.saveDir,
        tmpDir: settings.tmpDir,
        threadCount: settings.threadCount,
        autoSelect: settings.autoSelect,
        delAfterDone: settings.delAfterDone,
        muxFormat: settings.muxFormat,
        maxSpeed: settings.maxSpeed || undefined,
        ffmpegPath: settings.ffmpegPath || undefined,
        mp4decryptPath: settings.mp4decryptPath || undefined,
        autoSubtitleFix: settings.autoSubtitleFix,
        subFormat: settings.subFormat,
        binaryMerge: settings.binaryMerge,
        writeMetaJson: settings.writeMetaJson,
        concurrentDownload: settings.concurrentDownload,
        useSystemProxy: settings.useSystemProxy,
        proxy: settings.proxy || undefined,
        headers: Object.keys(settings.headers).length > 0 ? settings.headers : undefined,
        logLevel: settings.logLevel,
        decryptionEngine: settings.decryptionEngine,
        downloadRetryCount: settings.downloadRetryCount,
        httpRequestTimeout: settings.httpRequestTimeout,
        checkSegmentsCount: settings.checkSegmentsCount,
        baseUrl: settings.baseUrl || undefined,
        skipMerge: settings.skipMerge || undefined,
        customHlsMethod: settings.customHlsMethod || undefined,
        customHlsKey: settings.customHlsKey || undefined,
        customHlsIv: settings.customHlsIv || undefined,
        customRange: settings.customRange || undefined,
        adKeywords: settings.adKeywords?.length > 0 ? settings.adKeywords : undefined,
        allowHlsMultiExtMap: settings.allowHlsMultiExtMap || undefined,
        keyTextFile: settings.keyTextFile || undefined,
        mp4RealTimeDecryption: settings.mp4RealTimeDecryption || undefined,
        appendUrlParams: settings.appendUrlParams || undefined,
        noDateInfo: settings.noDateInfo || undefined,
        noLog: settings.noLog || undefined,
      }

      const result = await window.api.download.start(options)
      if (result.success) {
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
      } else {
        setBatchItems((prev) => prev.map((entry) => entry.id === item.id ? { ...entry, status: 'failed', taskId: undefined } : entry))
      }
    }

    setIsBatchRunning(false)
    showToast('success', '批量下载已处理完成')
  }

  const syncTaskRuntimeFlags = () => {
    const liveTasks = useDownloadStore.getState().tasks
    const hasActiveDownload = liveTasks.some((candidate) => !isRecordTask(candidate) && (candidate.status === 'pending' || candidate.status === 'running'))
    const hasActiveRecord = liveTasks.some((candidate) => isRecordTask(candidate) && (candidate.status === 'pending' || candidate.status === 'running'))

    setIsDownloading(hasActiveDownload)
    if (!hasActiveDownload && downloadTimerRef.current) {
      clearInterval(downloadTimerRef.current)
      downloadTimerRef.current = null
    }

    setIsRecording(hasActiveRecord)
    if (!hasActiveRecord && recordTimerRef.current) {
      clearInterval(recordTimerRef.current)
      recordTimerRef.current = null
    }
  }

  const deleteTaskArtifactsAndCleanup = async (task: DownloadTask) => {
    try {
      const result = await (window.api as any).download.delete(task.id, {
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
      await (window.api as any).runtime.remove(task.id)
      if (task.id === activeTaskId) setActiveTask(null)
      await removeRecord(task.id)
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

      const cleanupResult = await deleteTaskArtifactsAndCleanup(task)
      updateTask(task.id, {
        status: 'cancelled',
        latestLog: cleanupResult.success ? getTaskActionMessage(actionText, 'success', '已删除已下载文件与临时文件') : getTaskActionMessage(actionText, 'success', '已取消，但清理未完全成功')
      })
      if (activeTaskId === task.id) {
        setActiveTask(null)
      }
      syncTaskRuntimeFlags()
      showToast('info', cleanupResult.success
        ? getTaskActionMessage(actionText, 'success', '已删除已下载文件和临时文件')
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
      tmpDir: task.options?.tmpDir || settings.tmpDir,
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

  const renderTaskRow = (task: DownloadTask, index: number) => {
    const progress = Math.min(100, Math.max(0, Number(task.progress) || 0))
    const canCancel = task.status === 'running' || task.status === 'pending'
    const canRetry = task.status === 'failed' || task.status === 'cancelled'
    const canDelete = task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled'
    const statusText = task.status === 'completed' ? '已完成' : task.status === 'failed' ? '失败' : task.status === 'cancelled' ? '已取消' : task.status === 'running' ? '下载中' : '等待中'

    return (
      <div key={task.id} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-2.5 shadow-sm">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[11px] font-bold text-slate-600">
            {index + 1}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <h3 className="truncate text-[14px] font-semibold text-slate-800">{task.saveName || task.url}</h3>
              <span className={`inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${statusMap[task.status].tone}`}>
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
                      <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${item.status === 'completed' ? 'bg-emerald-50 text-emerald-700' : item.status === 'failed' ? 'bg-red-50 text-red-700' : item.status === 'running' ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>
                        {item.status === 'completed' ? '已完成' : item.status === 'failed' ? '失败' : item.status === 'running' ? '下载中' : '待处理'}
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
                {isRecording && (
                  <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2 py-1 text-[11px] font-medium text-red-600">
                    <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" /> 录制中
                  </span>
                )}
              </div>

              <div className="space-y-2.5">
                <input type="text" value={recordUrl} onChange={(e) => setRecordUrl(e.target.value)} placeholder="粘贴直播 m3u8 / mpd 链接..." className="input-field" disabled={isRecording} />
                <input type="text" value={recordName} onChange={(e) => setRecordName(e.target.value)} placeholder="保存文件名（可选）" className="input-field" disabled={isRecording} />
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
                      <input type="checkbox" checked={v} onChange={(e) => s(e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300 text-red-600" disabled={isRecording} />
                      {l}
                    </label>
                  ))}
                  <div className="p-2">
                    <label className="mb-1 block text-[11px] text-slate-500">录制时长限制</label>
                    <input type="text" value={liveRecordLimit} onChange={(e) => setLiveRecordLimit(e.target.value)} placeholder="HH:mm:ss" className="input-field text-sm" disabled={isRecording} />
                  </div>
                  <div className="p-2">
                    <label className="mb-1 block text-[11px] text-slate-500">刷新间隔 (秒)</label>
                    <input type="number" value={liveWaitTime} onChange={(e) => setLiveWaitTime(e.target.value)} placeholder="自动" className="input-field text-sm" disabled={isRecording} />
                  </div>
                  <div className="p-2">
                    <label className="mb-1 block text-[11px] text-slate-500">片段数</label>
                    <input type="number" value={liveTakeCount} onChange={(e) => setLiveTakeCount(e.target.value)} min={1} max={100} className="input-field text-sm" disabled={isRecording} />
                  </div>
                </div>
              )}

              <div className="mt-4 flex gap-2">
                <button onClick={handleRecordStart} disabled={isRecording} className="btn-primary flex items-center gap-2 text-sm"><Play size={16} /> {isRecording ? '录制中...' : '开始录制'}</button>
                <button onClick={handleRecordStop} disabled={!isRecording} className="btn-secondary flex items-center gap-2 text-sm"><Square size={14} /> 停止</button>
              </div>
            </div>

            <div className="card p-5">
              <h3 className="text-base font-semibold text-slate-800">当前状态</h3>
              <div className="mt-4 grid grid-cols-2 gap-2.5">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-slate-400">时长</div>
                  <div className="mt-2 text-lg font-bold text-slate-800">{formatDuration(recordDuration)}</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-slate-400">容量</div>
                  <div className="mt-2 text-lg font-bold text-slate-800">{formatFileSize(recordSize || currentTask?.downloadedBytes || 0)}</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-slate-400">状态</div>
                  <div className="mt-2 text-lg font-bold text-slate-800">{isRecording ? '在线' : '空闲'}</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-slate-400">速率</div>
                  <div className="mt-2 text-lg font-bold text-slate-800">{(currentTask?.speed || '0 KB/s').replace(/\s+$/, '')}</div>
                </div>
              </div>
            </div>
       </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-bold tracking-[0.18em] text-slate-500 uppercase">任务列表</div>
          <span className="text-xs text-slate-500">{(activeTab === 'download' ? downloadTasks : recordTasks).length} 个任务</span>
        </div>
        <div className="card p-3">
          <div className="space-y-2">
            {(activeTab === 'download' ? downloadTasks : recordTasks).length > 0 ? (activeTab === 'download' ? downloadTasks : recordTasks).map((task, index) => renderTaskRow(task, index)) : (
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

