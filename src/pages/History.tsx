import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Clock, Trash2, CheckCircle, XCircle, Ban, Search } from 'lucide-react'
import { useHistoryStore } from '@/store/historyStore'
import { showToast } from '@/components/Toast'
import { formatDateTime, formatDuration, formatFileSize } from '@/utils/format'

export default function History() {
  const { records, loaded, loadHistory, removeRecord, clearHistory } = useHistoryStore()
  const [searchTerm, setSearchTerm] = useState('')

  useEffect(() => { if (!loaded) loadHistory() }, [loaded])

  const filteredRecords = records.filter((r) =>
    r.saveName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.url.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const statusIcons = {
    completed: <CheckCircle size={14} className="text-emerald-500" />,
    failed: <XCircle size={14} className="text-red-500" />,
    cancelled: <Ban size={14} className="text-amber-500" />
  }

  const statusLabels = { completed: '已完成', failed: '失败', cancelled: '已取消' }

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="page-header">
        <div>
          <div className="page-kicker">History</div>
          <h1 className="page-title">任务记录</h1>
        </div>
        <button onClick={() => { clearHistory(); showToast('success', '历史记录已清空') }} className="btn-secondary flex items-center gap-1.5 text-xs font-semibold" disabled={records.length === 0}>
          <Trash2 size={14} /> 清空
        </button>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="card p-4">
        <div className="flex items-center gap-2.5">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="搜索下载记录..." className="input-field pl-9" />
          </div>
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="space-y-3">
        {filteredRecords.length === 0 ? (
          <div className="card p-12 text-center">
            <Clock size={40} className="mx-auto mb-3 text-slate-300" />
            <p className="text-sm text-slate-400">{records.length === 0 ? '暂无下载记录' : '没有匹配的记录'}</p>
          </div>
        ) : (
          filteredRecords.map((record, index) => (
            <motion.div key={record.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.02 }}
              className="card-hover p-3.5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                  <Clock size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-slate-800">{record.saveName}</span>
                    {statusIcons[record.status]}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-slate-400">{record.url}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
                    <span>{formatDateTime(record.startTime)}</span>
                    {record.duration > 0 && <span>耗时 {formatDuration(record.duration)}</span>}
                    {record.fileSize > 0 && <span>{formatFileSize(record.fileSize)}</span>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`tag ${record.status === 'completed' ? 'tag-success' : record.status === 'failed' ? 'tag-error' : 'tag-warning'}`}>
                    {statusLabels[record.status]}
                  </span>
                  <button onClick={() => removeRecord(record.id)}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500">
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
