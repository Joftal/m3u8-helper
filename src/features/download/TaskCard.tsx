import { motion } from 'framer-motion'
import { Download, CheckCircle, XCircle, Loader2, Ban } from 'lucide-react'
import type { DownloadTask } from '@/types/download'
import Progress from '@/components/Progress'

interface TaskCardProps {
  task: DownloadTask
  isActive: boolean
  onClick: () => void
}

export default function TaskCard({ task, isActive, onClick }: TaskCardProps) {
  const statusIcons = {
    pending: <Loader2 size={14} className="text-gray-400 animate-spin" />,
    running: <Loader2 size={14} className="text-primary-500 animate-spin" />,
    completed: <CheckCircle size={14} className="text-emerald-500" />,
    failed: <XCircle size={14} className="text-red-500" />,
    cancelled: <Ban size={14} className="text-amber-500" />
  }

  const statusLabels = {
    pending: '等待中', running: '下载中', completed: '已完成', failed: '失败', cancelled: '已取消'
  }

  return (
    <motion.div
      whileHover={{ scale: 1.005 }}
      onClick={onClick}
      className={`card-hover p-3.5 cursor-pointer ${isActive ? 'ring-2 ring-primary-200 border-primary-200' : ''}`}
    >
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-primary-50 flex items-center justify-center shrink-0">
          <Download size={16} className="text-primary-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-800 truncate">{task.saveName}</span>
            {statusIcons[task.status]}
          </div>
          <p className="text-xs text-gray-400 truncate mt-0.5">{task.url}</p>
          {task.status === 'running' && <div className="mt-1.5"><Progress value={task.progress} size="sm" showLabel={false} /></div>}
        </div>
        <div className="text-right shrink-0">
          <span className={`tag ${task.status === 'completed' ? 'tag-success' : task.status === 'failed' ? 'tag-error' : task.status === 'cancelled' ? 'tag-warning' : ''}`}>
            {statusLabels[task.status]}
          </span>
          {task.status === 'running' && <p className="text-xs text-primary-600 mt-1">{task.speed}</p>}
        </div>
      </div>
    </motion.div>
  )
}
