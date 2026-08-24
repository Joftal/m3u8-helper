import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
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
} from 'lucide-react'
import { useDownloadStore } from '@/store/downloadStore'
import { useHistoryStore } from '@/store/historyStore'
import { useSettingsStore } from '@/store/settingsStore'
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

  const { tasks, activeTaskId, addTask, updateTask, setActiveTask } = useDownloadStore()
  const { settings } = useSettingsStore()
  const { records, addRecord } = useHistoryStore()

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
        status: data.status
      })
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
        updateTask(data.taskId, { status: data.status })
        addRecord({
          id: data.taskId,
          url: task.url,
          saveName: task.saveName,
          status: data.status === 'completed' ? 'completed' : 'failed',
          startTime: task.startTime,
          endTime: new Date().toISOString(),
          fileSize: 0,
          outputPath: '',
          duration: getTaskRuntimeSeconds(task.startTime)
        })
      }

      if (data.taskId === recordTaskId) {
        setIsRecording(false)
        setRecordTaskId(null)
        if (recordTimerRef.current) clearInterval(recordTimerRef.current)
      }

      setIsDownloading(false)
      if (downloadTimerRef.current) clearInterval(downloadTimerRef.current)
    }

    const offProgress = window.api.download.onProgress(handleProgress)
    const offLog = window.api.download.onLog(handleLog)
    const offComplete = window.api.download.onComplete(handleComplete)

    return () => {
      offProgress()
      offLog()
      offComplete()
    }
  }, [addRecord, recordTaskId, updateTask])

  const downloadTasks = tasks.filter((task) => !isRecordTask(task))
  const recordTasks = tasks.filter((task) => isRecordTask(task))
  const activeDownloadTask = downloadTasks.find((task) => task.id === activeTaskId) ?? downloadTasks[0] ?? null
  const activeRecordTask = recordTasks.find((task) => task.id === activeTaskId) ?? recordTasks[0] ?? null
  const currentTask = activeTab === 'download' ? activeDownloadTask : activeRecordTask
  const totalTaskCount = tasks.length
  const runningTaskCount = tasks.filter((task) => task.status === 'running' || task.status === 'pending').length
  const completedTaskCount = tasks.filter((task) => task.status === 'completed').length
  const lastHistoryRecord = records[0]

  const getTaskMeta = (task: DownloadTask) => {
    const progress = Math.min(100, Math.max(0, Number(task.progress) || 0))
    if (isRecordTask(task)) {
      return {
        tag: '录制任务',
        status: statusMap[task.status].label,
        progressText: `${progress}%`,
        secondary: `${task.downloadedSegments || 0} / ${task.totalSegments || 0} 片段`
      }
    }
    return {
      tag: '下载任务',
      status: statusMap[task.status].label,
      progressText: `${progress}%`,
      secondary: `${task.downloadedSegments || 0} / ${task.totalSegments || 0} 分片`
    }
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

  const startBatch = async () => {
    if (batchItems.length === 0) {
      showToast('error', '请先添加下载链接')
      return
    }

    setIsBatchRunning(true)
    for (const item of batchItems) {
      setBatchItems((prev) => prev.map((entry) => entry.id === item.id ? { ...entry, status: 'running' } : entry))

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
        setBatchItems((prev) => prev.map((entry) => entry.id === item.id ? { ...entry, status: 'completed', progress: 100 } : entry))
      } else {
        setBatchItems((prev) => prev.map((entry) => entry.id === item.id ? { ...entry, status: 'failed' } : entry))
      }
    }

    setIsBatchRunning(false)
    showToast('success', '批量下载已处理完成')
  }

  const renderTaskRow = (task: DownloadTask) => {
    const meta = getTaskMeta(task)
    const tone = statusMap[task.status].tone
    const Icon = isRecordTask(task) ? Radio : Download
    const isReady = task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled'

    return (
      <div key={task.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${isRecordTask(task) ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>
          <Icon size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-semibold text-slate-800">{task.saveName || task.url}</h3>
          <p className="mt-1 text-xs text-slate-500">{meta.secondary} · {meta.tag}</p>
        </div>
        <div className="text-right">
          <div className="text-[11px] text-slate-500">{meta.status}</div>
          <span className={`mt-1 inline-flex rounded-full px-2 py-1 text-[11px] font-bold ${tone}`}>
            {isReady ? (task.status === 'completed' ? '完成' : task.status === 'failed' ? '失败' : '取消') : meta.progressText}
          </span>
        </div>
      </div>
    )
  }

  const renderStatusPanel = () => {
    if (!currentTask) {
      return (
        <div className="card p-5">
          <div className="text-[11px] font-bold tracking-[0.18em] text-slate-500 uppercase">实时状态</div>
          <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
            暂无{activeTab === 'download' ? '下载' : '录制'}任务，先在当前页创建任务即可。
          </div>
        </div>
      )
    }

    const progress = Math.min(100, Math.max(0, currentTask.progress || 0))
    const meta = getTaskMeta(currentTask)
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(currentTask.startTime).getTime()) / 1000))
    const speedValue = currentTask.speed || '0 KB/s'

    return (
      <div className="card p-5">
        <div className="text-[11px] font-bold tracking-[0.18em] text-slate-500 uppercase">实时状态</div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <h3 className="text-[22px] font-bold tracking-tight text-slate-900">{currentTask.saveName}</h3>
          <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${statusMap[currentTask.status].tone}`}>
            {meta.status}
          </span>
        </div>

        <div className="mt-5">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>{activeTab === 'download' ? '下载进度' : '录制进度'}</span>
            <strong className="text-sm font-bold text-slate-800">{Math.round(progress)}%</strong>
          </div>
          <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full rounded-full ${activeTab === 'download' ? 'bg-gradient-to-r from-blue-500 to-cyan-400' : 'bg-gradient-to-r from-red-500 to-orange-400'}`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2.5">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5">
            <div className="text-[10px] uppercase tracking-[0.14em] text-slate-400">{activeTab === 'download' ? '下载速度' : '实时速率'}</div>
            <div className="mt-2 text-lg font-bold text-slate-800">{speedValue}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5">
            <div className="text-[10px] uppercase tracking-[0.14em] text-slate-400">{activeTab === 'download' ? '已完成' : '片段'}</div>
            <div className="mt-2 text-lg font-bold text-slate-800">{activeTab === 'download' ? `${Math.round(progress)}%` : `${currentTask.downloadedSegments || 0}/${currentTask.totalSegments || 0}`}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5">
            <div className="text-[10px] uppercase tracking-[0.14em] text-slate-400">{activeTab === 'download' ? '用时' : '时长'}</div>
            <div className="mt-2 text-lg font-bold text-slate-800">{formatDuration(elapsedSeconds)}</div>
          </div>
        </div>

        <div className="mt-5 space-y-2.5">
          <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 text-sm"><span className="text-slate-500">任务类型</span><strong className="font-semibold text-slate-800">{meta.tag}</strong></div>
          <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 text-sm"><span className="text-slate-500">状态</span><strong className="font-semibold text-slate-800">{meta.status}</strong></div>
          <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 text-sm"><span className="text-slate-500">保存目录</span><strong className="font-semibold text-slate-800">{currentTask.saveDir || settings.saveDir || '未配置'}</strong></div>
          <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 text-sm"><span className="text-slate-500">数据量</span><strong className="font-semibold text-slate-800">{currentTask.totalSegments > 0 ? `${currentTask.downloadedSegments || 0} / ${currentTask.totalSegments}` : '待开始'}</strong></div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold tracking-[0.18em] text-slate-500 uppercase">Overview</div>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">任务总览</h1>
        </div>
        <div className="flex items-center gap-2" />
      </motion.div>

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

      <div className="grid gap-4 md:grid-cols-4">
        <div className="card h-full p-4">
          <div className="flex h-full flex-col justify-between gap-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-[0.14em] text-slate-400">总任务</span>
              <Activity size={14} className="text-slate-400" />
            </div>
            <div className="text-2xl font-bold text-slate-800">{totalTaskCount}</div>
          </div>
        </div>
        <div className="card h-full p-4">
          <div className="flex h-full flex-col justify-between gap-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-[0.14em] text-slate-400">进行中</span>
              <Sparkles size={14} className="text-blue-400" />
            </div>
            <div className="text-2xl font-bold text-slate-800">{runningTaskCount}</div>
          </div>
        </div>
        <div className="card h-full p-4">
          <div className="flex h-full flex-col justify-between gap-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-[0.14em] text-slate-400">已完成</span>
              <CheckCircle2 size={14} className="text-emerald-500" />
            </div>
            <div className="text-2xl font-bold text-slate-800">{completedTaskCount}</div>
          </div>
        </div>
        <div className="card h-full p-4">
          <div className="flex h-full flex-col justify-between gap-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-[0.14em] text-slate-400">最近记录</span>
              <FolderOpen size={14} className="text-slate-400" />
            </div>
            <div className="text-base font-bold text-slate-800">{lastHistoryRecord ? lastHistoryRecord.saveName : '暂无'}</div>
          </div>
        </div>
      </div>

      {activeTab === 'download' ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_360px]">
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
                placeholder={'每行粘贴一个 URL\nhttps://example.com/video1.m3u8\nhttps://example.com/video2.m3u8'}
                className="input-field h-28 resize-none font-mono text-sm"
              />

              <div className="mt-4 flex gap-2">
                <button onClick={parseBatchUrls} className="btn-primary flex items-center gap-1.5 text-sm"><Play size={15} /> 解析链接</button>
                <button onClick={() => { setBatchText(''); setBatchItems([]) }} className="btn-secondary flex items-center gap-1.5 text-sm"><Trash2 size={15} /> 清空</button>
                <button onClick={startBatch} disabled={isBatchRunning || batchItems.length === 0} className="btn-secondary flex items-center gap-1.5 text-sm">
                  {isBatchRunning ? '处理中...' : '开始全部'}
                </button>
              </div>

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

          {renderStatusPanel()}
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_360px]">
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
                  <div className="mt-2 text-lg font-bold text-slate-800">{formatFileSize(recordSize)}</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-slate-400">状态</div>
                  <div className="mt-2 text-lg font-bold text-slate-800">{isRecording ? '在线' : '空闲'}</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-slate-400">帧率</div>
                  <div className="mt-2 text-lg font-bold text-slate-800">29.97</div>
                </div>
              </div>
            </div>
          </div>

          {renderStatusPanel()}
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-bold tracking-[0.18em] text-slate-500 uppercase">任务列表</div>
          <span className="text-xs text-slate-500">{tasks.length} 个任务</span>
        </div>
        <div className="card p-3">
          <div className="space-y-2">
            {tasks.length > 0 ? tasks.map(renderTaskRow) : (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500 text-center">
                暂无任务，直接在上方创建下载或录制任务。
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

