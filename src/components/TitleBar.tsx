import { useEffect, useState } from 'react'
import { Minus, Square, X, Copy } from 'lucide-react'

export default function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    window.api.window.isMaximized().then(setIsMaximized)
    window.api.window.onMaximizedChanged(setIsMaximized)
  }, [])

  return (
    <div className="drag-region h-11 flex items-center justify-between bg-white border-b border-gray-100 select-none">
      {/* 左侧 */}
      <div className="flex items-center gap-2.5 pl-4">
        <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: '#2563eb' }}>
          <span className="text-[11px] font-bold text-white">M</span>
        </div>
        <span className="text-[13px] font-semibold text-gray-800 tracking-tight">m3u8-box</span>
      </div>

      {/* 右侧 */}
      <div className="flex h-full no-drag">
        <button
          onClick={() => window.api.window.minimize()}
          className="w-12 h-full flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors"
        >
          <Minus size={15} />
        </button>
        <button
          onClick={() => window.api.window.maximize()}
          className="w-12 h-full flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors"
        >
          {isMaximized ? <Copy size={13} /> : <Square size={13} />}
        </button>
        <button
          onClick={() => window.api.window.close()}
          className="w-12 h-full flex items-center justify-center text-gray-400 hover:text-white hover:bg-red-500 transition-colors"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  )
}
