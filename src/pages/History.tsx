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
    <div className="space-y-5">
      <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-xl font-bold text-gray-900">下载历史</h1>
        <p className="text-sm text-gray-500 mt-1">查看所有下载记录</p>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="flex items-center gap-2.5">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="搜索下载记录..." className="input-field pl-9" />
        </div>
        <button onClick={() => { clearHistory(); showToast('success', '历史记录已清空') }} className="btn-secondary flex items-center gap-1.5 text-sm" disabled={records.length === 0}>
          <Trash2 size={14} /> 清空
        </button>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="space-y-1.5">
        {filteredRecords.length === 0 ? (
          <div className="card p-12 text-center">
            <Clock size={40} className="mx-auto mb-3 text-gray-300" />
            <p className="text-gray-400 text-sm">{records.length === 0 ? '暂无下载记录' : '没有匹配的记录'}</p>
          </div>
        ) : (
          filteredRecords.map((record, index) => (
            <motion.div key={record.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.02 }}
              className="card-hover p-3.5">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-gray-50 flex items-center justify-center shrink-0">
                  <Clock size={16} className="text-gray-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-800 truncate">{record.saveName}</span>
                    {statusIcons[record.status]}
                  </div>
                  <p className="text-xs text-gray-400 truncate mt-0.5">{record.url}</p>
                  <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                    <span>{formatDateTime(record.startTime)}</span>
                    {record.duration > 0 && <span>耗时 {formatDuration(record.duration)}</span>}
                    {record.fileSize > 0 && <span>{formatFileSize(record.fileSize)}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`tag ${record.status === 'completed' ? 'tag-success' : record.status === 'failed' ? 'tag-error' : 'tag-warning'}`}>
                    {statusLabels[record.status]}
                  </span>
                  <button onClick={() => removeRecord(record.id)}
                    className="w-7 h-7 rounded-md flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
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
