import { useRef, useEffect, useState } from 'react'
import { Terminal, Search, ChevronDown, ChevronUp } from 'lucide-react'
import type { LogEntry } from '@/types/download'

interface LogViewerProps {
  logs: LogEntry[]
}

export default function LogViewer({ logs }: LogViewerProps) {
  const [expanded, setExpanded] = useState(true)
  const [filter, setFilter] = useState('')
  const [levelFilter, setLevelFilter] = useState<string>('all')
  const logEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (expanded) logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs, expanded])

  const filteredLogs = logs.filter((log) => {
    if (levelFilter !== 'all' && log.level !== levelFilter) return false
    if (filter && !log.message.toLowerCase().includes(filter.toLowerCase())) return false
    return true
  })

  const levelColors: Record<string, string> = {
    INFO: 'text-gray-400', WARN: 'text-amber-600', ERROR: 'text-red-600', DEBUG: 'text-gray-300'
  }

  return (
    <div className="card overflow-hidden">
      <button onClick={() => setExpanded(!expanded)}
        className="w-full px-5 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors">
        <div className="flex items-center gap-2">
          <Terminal size={14} className="text-gray-400" />
          <span className="text-sm font-medium text-gray-600">日志输出</span>
          <span className="text-xs text-gray-400">({logs.length})</span>
        </div>
        {expanded ? <ChevronUp size={15} className="text-gray-400" /> : <ChevronDown size={15} className="text-gray-400" />}
      </button>

      {expanded && (
        <div className="border-t border-gray-100">
          <div className="px-4 py-2 flex items-center gap-2 border-b border-gray-50">
            <div className="relative flex-1">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="搜索日志..."
                className="w-full pl-7 pr-3 py-1.5 text-xs rounded-md bg-gray-50 border border-gray-200 text-gray-700 placeholder-gray-400 focus:outline-none focus:border-primary-400" />
            </div>
            <select value={levelFilter} onChange={(e) => setLevelFilter(e.target.value)}
              className="text-xs px-2 py-1.5 rounded-md bg-gray-50 border border-gray-200 text-gray-600 focus:outline-none">
              <option value="all">全部</option>
              <option value="INFO">INFO</option>
              <option value="WARN">WARN</option>
              <option value="ERROR">ERROR</option>
              <option value="DEBUG">DEBUG</option>
            </select>
          </div>

          <div className="max-h-[280px] overflow-y-auto p-4 font-mono text-[11px] leading-[18px] bg-gray-50">
            {filteredLogs.length === 0 ? (
              <p className="text-gray-400 text-center py-4">暂无日志</p>
            ) : (
              filteredLogs.map((log, i) => (
                <div key={i} className="flex gap-2 py-px hover:bg-white rounded px-1">
                  <span className={`shrink-0 ${levelColors[log.level] || 'text-gray-400'}`}>[{log.level}]</span>
                  <span className="text-gray-600 break-all">{log.message}</span>
                </div>
              ))
            )}
            <div ref={logEndRef} />
          </div>
        </div>
      )}
    </div>
  )
}
