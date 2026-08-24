import { useEffect, useState } from 'react'
import { Copy, Minus, Square, X } from 'lucide-react'

export default function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    window.api.window.isMaximized().then(setIsMaximized)
    window.api.window.onMaximizedChanged(setIsMaximized)
  }, [])

  return (
    <div className="drag-region h-12 flex items-center justify-between bg-white/90 border-b border-slate-200 select-none backdrop-blur-sm">
      <div className="flex items-center gap-2.5 pl-4">
        <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-sky-400 via-blue-500 to-emerald-400 shadow-inner shadow-white/30" />
        <span className="text-[13px] font-semibold text-slate-800 tracking-tight">m3u8-box</span>
      </div>

      <div className="flex h-full no-drag items-center gap-1.5 pr-2">
        <button
          onClick={() => window.api.window.minimize()}
          className="flex h-8 w-8 items-center justify-center rounded-md text-slate-600 transition-colors hover:bg-slate-200 hover:text-slate-800"
          aria-label="最小化"
          title="最小化"
        >
          <Minus size={14} strokeWidth={2.5} />
        </button>

        <button
          onClick={() => window.api.window.maximize()}
          className="flex h-8 w-8 items-center justify-center rounded-md text-slate-600 transition-colors hover:bg-slate-200 hover:text-slate-800"
          aria-label={isMaximized ? '还原' : '最大化'}
          title={isMaximized ? '还原' : '最大化'}
        >
          {isMaximized ? <Copy size={14} strokeWidth={2.25} /> : <Square size={12} strokeWidth={2.25} />}
        </button>

        <button
          onClick={() => window.api.window.close()}
          className="flex h-8 w-8 items-center justify-center rounded-md text-slate-600 transition-colors hover:bg-red-500 hover:text-white"
          aria-label="关闭"
          title="关闭"
        >
          <X size={14} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  )
}
