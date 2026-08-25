import { useEffect, useRef } from 'react'
import Modal from '@/components/Modal'
import type { LogEntry } from '@/types/download'

interface LogViewerModalProps {
  open: boolean
  onClose: () => void
  title: string
  logs: LogEntry[]
}

const LEVEL_TONE: Record<string, string> = {
  ERROR: 'text-red-600',
  WARN: 'text-amber-600',
  DEBUG: 'text-slate-400',
  INFO: 'text-slate-600'
}

function formatClock(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '--:--:--'
  return date.toLocaleTimeString('zh-CN', { hour12: false })
}

/** 任务运行日志查看器：数据源为 downloadStore 已积累的日志（此前仅 latestLog 可见） */
export default function LogViewerModal({ open, onClose, title, logs }: LogViewerModalProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  // 新日志到达时跟随滚动到底部（时间正序展示）
  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [open, logs.length])

  return (
    <Modal open={open} onClose={onClose} title={`日志 · ${title}`} width="max-w-2xl">
      <div className="max-h-[420px] overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] leading-5">
        {logs.length === 0 ? (
          <p className="py-8 text-center text-slate-400">暂无日志</p>
        ) : (
          <>
            {logs.slice(-500).map((entry, index) => (
              <div key={`${entry.timestamp}-${index}`} className={LEVEL_TONE[entry.level] || 'text-slate-600'}>
                <span className="text-slate-400">[{formatClock(entry.timestamp)}]</span>{' '}
                <span className="font-semibold">[{entry.level}]</span>{' '}
                <span className="break-all">{entry.message}</span>
              </div>
            ))}
            <div ref={bottomRef} />
          </>
        )}
      </div>
      <p className="mt-2 text-right text-[10px] text-slate-400">显示最近 {Math.min(logs.length, 500)} 条</p>
    </Modal>
  )
}
