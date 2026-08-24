import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { Play, Square, Download, Link, Settings2, ChevronDown, ChevronUp, Clipboard } from 'lucide-react'
import { useDownloadStore } from '@/store/downloadStore'
import { useSettingsStore } from '@/store/settingsStore'
import { useHistoryStore } from '@/store/historyStore'
import { showToast } from '@/components/Toast'
import Progress from '@/components/Progress'
import { formatDuration, extractFileName, generateId } from '@/utils/format'
import { isValidUrl } from '@/utils/validators'
import TaskCard from './TaskCard'
import LogViewer from './LogViewer'

export default function DownloadForm() {
  const [url, setUrl] = useState('')
  const [saveName, setSaveName] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [elapsedTime, setElapsedTime] = useState(0)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const elapsedTimeRef = useRef(0)

  const [threadCount, setThreadCount] = useState(8)
  const [autoSelect, setAutoSelect] = useState(true)
  const [muxFormat, setMuxFormat] = useState('mp4')
  const [maxSpeed, setMaxSpeed] = useState('')
  const [subOnly, setSubOnly] = useState(false)
  const [customArgs, setCustomArgs] = useState('')

  const { tasks, activeTaskId, addTask, updateTask, setActiveTask } = useDownloadStore()
  const { settings } = useSettingsStore()
  const { addRecord } = useHistoryStore()
  const activeTask = tasks.find((t) => t.id === activeTaskId)

  useEffect(() => {
    setThreadCount(settings.threadCount)
    setAutoSelect(settings.autoSelect)
    setMuxFormat(settings.muxFormat)
  }, [settings])

  useEffect(() => {
    elapsedTimeRef.current = elapsedTime
  }, [elapsedTime])

  useEffect(() => {
    const getTaskDuration = (startTime?: string) => {
      if (!startTime) return 0
      const start = Date.parse(startTime)
      if (Number.isNaN(start)) return 0
      return Math.max(0, Math.floor((Date.now() - start) / 1000))
    }

    const handleProgress = (data: any) => {
      updateTask(data.taskId, {
        progress: data.progress,
        speed: data.speed,
        downloadedSegments: data.downloadedSegments,
        totalSegments: data.totalSegments,
        status: data.status
      })
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
          duration: getTaskDuration(task.startTime)
        })
      }
      setIsDownloading(false)
      if (timerRef.current) clearInterval(timerRef.current)
    }

    const offProgress = window.api.download.onProgress(handleProgress)
    const offLog = window.api.download.onLog(handleLog)
    const offComplete = window.api.download.onComplete(handleComplete)

    return () => {
      offProgress()
      offLog()
      offComplete()
    }
  }, [addRecord, updateTask])

  const handleUrlChange = (value: string) => {
    setUrl(value)
    if (!saveName && value) setSaveName(extractFileName(value))
  }

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text && isValidUrl(text)) {
        handleUrlChange(text)
        showToast('info', '已从剪贴板粘贴 URL')
      }
    } catch {}
  }

  const handleStart = async () => {
    if (!url.trim()) { showToast('error', '请输入下载链接'); return }
    if (!isValidUrl(url)) { showToast('error', '请输入有效的 URL'); return }

    setIsDownloading(true)
    setElapsedTime(0)
    elapsedTimeRef.current = 0
    timerRef.current = setInterval(() => setElapsedTime((prev) => prev + 1), 1000)

    const taskOptions = {
      url: url.trim(),
      saveName: saveName || extractFileName(url),
      saveDir: settings.saveDir,
      tmpDir: settings.tmpDir,
      threadCount,
      autoSelect,
      muxFormat,
      maxSpeed: maxSpeed || undefined,
      subOnly,
      customArgs: customArgs || undefined,
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
      if (timerRef.current) clearInterval(timerRef.current)
      return
    }

    const taskId = result.taskId || generateId()
    const task = {
      id: taskId,
      url: url.trim(),
      saveName: saveName || extractFileName(url),
      status: 'pending' as const,
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

  const handleCancel = async () => {
    if (activeTaskId) {
      await window.api.download.cancel(activeTaskId)
      updateTask(activeTaskId, { status: 'cancelled' })
      setIsDownloading(false)
      if (timerRef.current) clearInterval(timerRef.current)
      showToast('info', '下载已取消')
    }
  }

  return (
    <div className="space-y-5">
      {/* URL 输入 */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="card p-5">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-md bg-primary-50 flex items-center justify-center">
            <Link size={15} className="text-primary-600" />
          </div>
          <span className="text-sm font-semibold text-gray-800">下载链接</span>
        </div>

        <div className="flex gap-2">
          <input type="text" value={url} onChange={(e) => handleUrlChange(e.target.value)}
            placeholder="粘贴 m3u8 / mpd / ism 链接..." className="input-field flex-1"
            onKeyDown={(e) => e.key === 'Enter' && !isDownloading && handleStart()} />
          <button onClick={handlePasteFromClipboard} className="btn-secondary flex items-center gap-1.5 whitespace-nowrap text-sm">
            <Clipboard size={14} /> 粘贴
          </button>
        </div>

        <div className="mt-2.5">
          <input type="text" value={saveName} onChange={(e) => setSaveName(e.target.value)}
            placeholder="保存文件名（可选，自动从 URL 提取）" className="input-field" />
        </div>
      </motion.div>

      {/* 高级选项 */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="card overflow-hidden">
        <button onClick={() => setShowAdvanced(!showAdvanced)}
          className="w-full px-5 py-3.5 flex items-center justify-between hover:bg-gray-50 transition-colors">
          <div className="flex items-center gap-2">
            <Settings2 size={15} className="text-gray-400" />
            <span className="text-sm font-medium text-gray-600">高级选项</span>
          </div>
          {showAdvanced ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
        </button>

        {showAdvanced && (
          <div className="px-5 pb-5 grid grid-cols-2 gap-3 border-t border-gray-50 pt-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">线程数</label>
              <input type="number" value={threadCount} onChange={(e) => setThreadCount(Number(e.target.value))} min={1} max={32} className="input-field" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">混流格式</label>
              <select value={muxFormat} onChange={(e) => setMuxFormat(e.target.value)} className="input-field">
                <option value="mp4">MP4</option>
                <option value="mkv">MKV</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">限速 (如 10M, 100K)</label>
              <input type="text" value={maxSpeed} onChange={(e) => setMaxSpeed(e.target.value)} placeholder="不限速" className="input-field" />
            </div>
            <div className="flex items-end gap-5">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={autoSelect} onChange={(e) => setAutoSelect(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-200" />
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={subOnly} onChange={(e) => setSubOnly(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-200" />
              </label>
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-gray-500 mb-1">自定义参数</label>
              <input type="text" value={customArgs} onChange={(e) => setCustomArgs(e.target.value)}
                placeholder="额外的命令行参数..." className="input-field" />
            </div>
          </div>
        )}
      </motion.div>

      {/* 操作按钮 */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="flex gap-2.5">
        {!isDownloading ? (
          <button onClick={handleStart} className="btn-primary flex items-center gap-2 px-7 py-2.5 text-sm">
            <Play size={18} /> 开始下载
          </button>
        ) : (
          <button onClick={handleCancel} className="px-7 py-2.5 rounded-lg font-medium text-white text-sm flex items-center gap-2 transition-all duration-150"
            style={{ background: '#ef4444', boxShadow: '0 1px 2px rgba(239,68,68,0.3)' }}>
            <Square size={18} /> 取消下载
          </button>
        )}
      </motion.div>

      {/* 下载进度 */}
      {activeTask && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Download size={16} className="text-primary-600" />
              <span className="text-sm font-medium text-gray-800">{activeTask.saveName}</span>
            </div>
            <span className={`tag ${activeTask.status === 'completed' ? 'tag-success' : activeTask.status === 'failed' ? 'tag-error' : activeTask.status === 'running' ? 'tag' : 'tag-warning'}`}>
              {activeTask.status === 'completed' ? '已完成' : activeTask.status === 'failed' ? '失败' : activeTask.status === 'cancelled' ? '已取消' : activeTask.status === 'running' ? '下载中' : '等待中'}
            </span>
          </div>
          <Progress value={activeTask.progress} size="lg" />
          <div className="flex items-center gap-5 text-xs text-gray-400">
            <span>速度: <span className="text-primary-600 font-medium">{activeTask.speed || '计算中...'}</span></span>
            {activeTask.totalSegments > 0 && <span>分片: {activeTask.downloadedSegments}/{activeTask.totalSegments}</span>}
            <span>已用时: {formatDuration(elapsedTime)}</span>
          </div>
        </motion.div>
      )}

      {/* 任务列表 */}
      {tasks.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <h3 className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wider">下载任务</h3>
          <div className="space-y-1.5">
            {tasks.map((task) => (
              <TaskCard key={task.id} task={task} isActive={task.id === activeTaskId} onClick={() => setActiveTask(task.id)} />
            ))}
          </div>
        </motion.div>
      )}

      {/* 日志 */}
      {activeTask && activeTask.logs.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
          <LogViewer logs={activeTask.logs} />
        </motion.div>
      )}
    </div>
  )
}
