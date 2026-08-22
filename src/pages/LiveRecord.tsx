import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { Radio, Play, Square, Clock, HardDrive, Settings2, ChevronDown, ChevronUp } from 'lucide-react'
import { useDownloadStore } from '@/store/downloadStore'
import { useSettingsStore } from '@/store/settingsStore'
import { showToast } from '@/components/Toast'
import { formatDuration, formatFileSize, generateId, extractFileName } from '@/utils/format'
import { isValidUrl } from '@/utils/validators'

export default function LiveRecord() {
  const [url, setUrl] = useState('')
  const [saveName, setSaveName] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [recordDuration, setRecordDuration] = useState(0)
  const [recordSize, setRecordSize] = useState(0)
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  const [showAdvanced, setShowAdvanced] = useState(false)
  const [liveRealTimeMerge, setLiveRealTimeMerge] = useState(true)
  const [livePipeMux, setLivePipeMux] = useState(false)
  const [livePerformAsVod, setLivePerformAsVod] = useState(false)
  const [liveFixVttByAudio, setLiveFixVttByAudio] = useState(false)
  const [liveRecordLimit, setLiveRecordLimit] = useState('')
  const [liveWaitTime, setLiveWaitTime] = useState('')
  const [liveTakeCount, setLiveTakeCount] = useState('16')

  const { addTask, updateTask } = useDownloadStore()
  const { settings } = useSettingsStore()

  useEffect(() => {
    window.api.download.onProgress((data) => {
      if (data.taskId === taskId) updateTask(data.taskId, { progress: data.progress, speed: data.speed, downloadedSegments: data.downloadedSegments, totalSegments: data.totalSegments, status: data.status })
    })
    window.api.download.onComplete((data) => {
      if (data.taskId === taskId) { setIsRecording(false); if (timerRef.current) clearInterval(timerRef.current); showToast('info', '录制已结束') }
    })
    return () => { window.api.download.removeAllListeners() }
  }, [taskId])

  const handleStart = async () => {
    if (!url.trim()) { showToast('error', '请输入直播链接'); return }
    if (!isValidUrl(url)) { showToast('error', '请输入有效的 URL'); return }

    const id = generateId()
    setTaskId(id); setIsRecording(true); setRecordDuration(0); setRecordSize(0)
    timerRef.current = setInterval(() => setRecordDuration((prev) => prev + 1), 1000)

    const taskOptions = {
      url: url.trim(), saveName: saveName || extractFileName(url), saveDir: settings.saveDir, tmpDir: settings.tmpDir,
      threadCount: settings.threadCount, autoSelect: true, delAfterDone: settings.delAfterDone, muxFormat: settings.muxFormat,
      liveRealTimeMerge, livePipeMux, livePerformAsVod, liveFixVttByAudio,
      liveRecordLimit: liveRecordLimit || undefined, liveWaitTime: liveWaitTime ? parseInt(liveWaitTime) : undefined,
      liveTakeCount: parseInt(liveTakeCount) || 16, maxSpeed: settings.maxSpeed || undefined,
      proxy: settings.proxy || undefined, headers: Object.keys(settings.headers).length > 0 ? settings.headers : undefined,
      autoSubtitleFix: settings.autoSubtitleFix, logLevel: settings.logLevel,
    }

    addTask({ id, url: url.trim(), saveName: saveName || extractFileName(url), status: 'running', progress: 0, speed: '0 KB/s', downloadedSegments: 0, totalSegments: 0, startTime: new Date().toISOString(), logs: [], options: taskOptions })

    const result = await window.api.download.start(taskOptions)
    if (!result.success) { showToast('error', `启动失败: ${result.error}`); setIsRecording(false); if (timerRef.current) clearInterval(timerRef.current) }
    else showToast('success', '录制已开始')
  }

  const handleStop = async () => {
    if (taskId) { await window.api.download.cancel(taskId); setIsRecording(false); if (timerRef.current) clearInterval(timerRef.current); showToast('info', '录制已停止') }
  }

  return (
    <div className="space-y-5">
      <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-xl font-bold text-gray-900">直播录制</h1>
        <p className="text-sm text-gray-500 mt-1">录制 HLS/DASH 直播流，支持实时合并</p>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="card p-5">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-md bg-red-50 flex items-center justify-center">
            <Radio size={15} className="text-red-500" />
          </div>
          <span className="text-sm font-semibold text-gray-800">直播源</span>
          {isRecording && (
            <span className="ml-auto flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-sm text-red-600 font-medium">录制中</span>
            </span>
          )}
        </div>

        <div className="space-y-2.5">
          <input type="text" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="粘贴直播 m3u8 / mpd 链接..." className="input-field" disabled={isRecording} />
          <input type="text" value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="保存文件名（可选）" className="input-field" disabled={isRecording} />
          <p className="text-[11px] text-gray-400">自动选择最佳流 · 分片始终保留 · 自动合并</p>
        </div>

        <div className="mt-3">
          <button onClick={() => setShowAdvanced(!showAdvanced)} className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors">
            <Settings2 size={13} /> 直播选项 {showAdvanced ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
          {showAdvanced && (
            <div className="mt-3 grid grid-cols-2 gap-2.5">
              {[
                { v: liveRealTimeMerge, s: setLiveRealTimeMerge, l: '实时合并' },
                { v: livePipeMux, s: setLivePipeMux, l: '管道混流' },
                { v: livePerformAsVod, s: setLivePerformAsVod, l: '以点播方式下载' },
                { v: liveFixVttByAudio, s: setLiveFixVttByAudio, l: '通过音频修正 VTT' },
              ].map(({ v, s, l }) => (
                <label key={l} className="flex items-center gap-2 p-2 rounded-md bg-gray-50 cursor-pointer">
                  <input type="checkbox" checked={v} onChange={(e) => s(e.target.checked)} className="w-3.5 h-3.5 rounded border-gray-300 text-primary-600" disabled={isRecording} />
                  <span className="text-xs text-gray-600">{l}</span>
                </label>
              ))}
              <div className="p-2">
                <label className="block text-[11px] text-gray-500 mb-1">录制时长限制</label>
                <input type="text" value={liveRecordLimit} onChange={(e) => setLiveRecordLimit(e.target.value)} placeholder="HH:mm:ss" className="input-field text-sm" disabled={isRecording} />
              </div>
              <div className="p-2">
                <label className="block text-[11px] text-gray-500 mb-1">刷新间隔 (秒)</label>
                <input type="number" value={liveWaitTime} onChange={(e) => setLiveWaitTime(e.target.value)} placeholder="自动" className="input-field text-sm" disabled={isRecording} />
              </div>
              <div className="p-2">
                <label className="block text-[11px] text-gray-500 mb-1">首次获取分片数</label>
                <input type="number" value={liveTakeCount} onChange={(e) => setLiveTakeCount(e.target.value)} min={1} max={100} className="input-field text-sm" disabled={isRecording} />
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-2.5 mt-4">
          {!isRecording ? (
            <button onClick={handleStart} className="btn-primary flex items-center gap-2 text-sm"><Play size={16} /> 开始录制</button>
          ) : (
            <button onClick={handleStop} className="px-6 py-2 rounded-lg font-medium text-white text-sm flex items-center gap-2 transition-all duration-150"
              style={{ background: '#ef4444', boxShadow: '0 1px 2px rgba(239,68,68,0.3)' }}>
              <Square size={16} /> 停止录制
            </button>
          )}
        </div>
      </motion.div>

      {isRecording && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="card p-5">
          <h3 className="text-xs font-semibold text-gray-500 mb-3 uppercase tracking-wider">录制状态</h3>
          <div className="grid grid-cols-3 gap-3">
            {[
              { icon: <Clock size={22} />, val: formatDuration(recordDuration), label: '录制时长', color: 'text-primary-600' },
              { icon: <HardDrive size={22} />, val: formatFileSize(recordSize), label: '文件大小', color: 'text-emerald-600' },
              { icon: <Radio size={22} />, val: 'LIVE', label: '状态', color: 'text-red-500' },
            ].map(({ icon, val, label, color }) => (
              <div key={label} className="text-center p-3 rounded-lg bg-gray-50 border border-gray-100">
                <div className={`mx-auto mb-1.5 ${color}`}>{icon}</div>
                <p className="text-lg font-bold text-gray-900">{val}</p>
                <p className="text-[11px] text-gray-400">{label}</p>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  )
}
