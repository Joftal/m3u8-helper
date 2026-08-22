import { useState } from 'react'
import { motion } from 'framer-motion'
import { Layers, Play, Trash2, Plus, FileText } from 'lucide-react'
import { useDownloadStore } from '@/store/downloadStore'
import { useSettingsStore } from '@/store/settingsStore'
import { showToast } from '@/components/Toast'
import Progress from '@/components/Progress'
import { extractFileName, generateId } from '@/utils/format'
import { isValidUrl } from '@/utils/validators'

interface BatchItem {
  id: string
  url: string
  saveName: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  progress: number
}

export default function BatchDownload() {
  const [urlText, setUrlText] = useState('')
  const [items, setItems] = useState<BatchItem[]>([])
  const [isRunning, setIsRunning] = useState(false)

  const { addTask } = useDownloadStore()
  const { settings } = useSettingsStore()

  const parseUrls = () => {
    const lines = urlText.split('\n').map((l) => l.trim()).filter(Boolean)
    const validUrls = lines.filter(isValidUrl)
    if (validUrls.length === 0) { showToast('error', '未找到有效的 URL'); return }
    const newItems: BatchItem[] = validUrls.map((url) => ({
      id: generateId(), url, saveName: extractFileName(url), status: 'pending', progress: 0
    }))
    setItems(newItems)
    showToast('success', `已解析 ${newItems.length} 个链接`)
  }

  const startBatch = async () => {
    if (items.length === 0) { showToast('error', '请先添加下载链接'); return }
    setIsRunning(true)

    for (const item of items) {
      setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, status: 'running' } : i))

      const batchOptions = {
        url: item.url, saveName: item.saveName, saveDir: settings.saveDir, tmpDir: settings.tmpDir,
        threadCount: settings.threadCount, autoSelect: settings.autoSelect, delAfterDone: settings.delAfterDone,
        muxFormat: settings.muxFormat, maxSpeed: settings.maxSpeed || undefined,
        ffmpegPath: settings.ffmpegPath || undefined, mp4decryptPath: settings.mp4decryptPath || undefined,
        autoSubtitleFix: settings.autoSubtitleFix, subFormat: settings.subFormat, binaryMerge: settings.binaryMerge,
        writeMetaJson: settings.writeMetaJson, concurrentDownload: settings.concurrentDownload,
        useSystemProxy: settings.useSystemProxy, proxy: settings.proxy || undefined,
        headers: Object.keys(settings.headers).length > 0 ? settings.headers : undefined,
        logLevel: settings.logLevel, decryptionEngine: settings.decryptionEngine,
        downloadRetryCount: settings.downloadRetryCount, httpRequestTimeout: settings.httpRequestTimeout,
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

      const result = await window.api.download.start(batchOptions)
      if (result.success) {
        await new Promise<void>((resolve) => {
          const handler = (data: any) => {
            setItems((prev) => prev.map((i) => i.id === item.id ? {
              ...i, status: data.status === 'completed' ? 'completed' : 'failed',
              progress: data.status === 'completed' ? 100 : i.progress
            } : i))
            window.api.download.onComplete(() => {})
            resolve()
          }
          window.api.download.onComplete(handler)
        })
      } else {
        setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, status: 'failed' } : i))
      }
    }
    setIsRunning(false)
    showToast('success', '批量下载完成')
  }

  return (
    <div className="space-y-5">
      <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-xl font-bold text-gray-900">批量下载</h1>
        <p className="text-sm text-gray-500 mt-1">每行一个链接，支持批量下载多个视频</p>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="card p-5">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-md bg-primary-50 flex items-center justify-center">
            <FileText size={15} className="text-primary-600" />
          </div>
          <span className="text-sm font-semibold text-gray-800">链接列表</span>
        </div>
        <textarea value={urlText} onChange={(e) => setUrlText(e.target.value)}
          placeholder={'每行粘贴一个 m3u8/mpd 链接...\nhttps://example.com/video1.m3u8\nhttps://example.com/video2.m3u8'}
          className="input-field h-36 resize-none font-mono text-sm" />
        <div className="flex gap-2 mt-3">
          <button onClick={parseUrls} className="btn-primary flex items-center gap-1.5 text-sm"><Plus size={15} /> 解析链接</button>
          <button onClick={() => { setItems([]); setUrlText('') }} className="btn-secondary flex items-center gap-1.5 text-sm"><Trash2 size={15} /> 清空</button>
        </div>
      </motion.div>

      {items.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-gray-500">待下载 ({items.length}) · 已完成 {items.filter((i) => i.status === 'completed').length}</span>
            {!isRunning && (
              <button onClick={startBatch} className="btn-primary flex items-center gap-1.5 text-sm"><Play size={15} /> 开始批量下载</button>
            )}
          </div>
          <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
            {items.map((item, index) => (
              <div key={item.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-gray-50 border border-gray-100">
                <span className="w-5 text-[11px] text-gray-400 text-center">{index + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-700 truncate">{item.saveName}</p>
                  <p className="text-[11px] text-gray-400 truncate">{item.url}</p>
                  {item.status === 'running' && <div className="mt-1"><Progress value={item.progress} size="sm" showLabel={false} /></div>}
                </div>
                <span className={`tag ${item.status === 'completed' ? 'tag-success' : item.status === 'failed' ? 'tag-error' : item.status === 'running' ? 'tag' : ''}`}>
                  {item.status === 'pending' ? '等待' : item.status === 'running' ? '下载中' : item.status === 'completed' ? '完成' : '失败'}
                </span>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  )
}
