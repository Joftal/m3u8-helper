import { useEffect, useState } from 'react'
import { Copy, Minus, Square, X } from 'lucide-react'
import { useTranslation } from '@/i18n'

export default function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false)
  const { t } = useTranslation()
  const appIcon = new URL('../assets/icon.png', import.meta.url).href

  useEffect(() => {
    window.api.window.isMaximized().then(setIsMaximized)
    window.api.window.onMaximizedChanged(setIsMaximized)
  }, [])

  return (
    <div className="drag-region h-12 flex items-center justify-between bg-white/70 dark:bg-neutral-900/90 border-b border-slate-200/70 dark:border-neutral-800 select-none backdrop-blur-sm">
      <div className="flex items-center gap-2.5 pl-4">
        <img src={appIcon} alt="m3u8-helper" className="h-6 w-6 rounded-lg object-cover shadow-sm ring-1 ring-slate-200 dark:ring-neutral-700" />
        <span className="text-[13px] font-semibold text-slate-800 dark:text-neutral-100 tracking-tight">m3u8-helper</span>
      </div>

      <div className="flex h-full no-drag items-center gap-1.5 pr-2">
        <button
          onClick={() => window.api.window.minimize()}
          className="flex h-8 w-8 items-center justify-center rounded-md text-slate-600 dark:text-neutral-300 transition-colors hover:bg-slate-200 dark:hover:bg-neutral-700 hover:text-slate-800 dark:hover:text-slate-100"
          aria-label={t('common.minimize')}
          title={t('common.minimize')}
        >
          <Minus size={14} strokeWidth={2.5} />
        </button>

        <button
          onClick={() => window.api.window.maximize()}
          className="flex h-8 w-8 items-center justify-center rounded-md text-slate-600 dark:text-neutral-300 transition-colors hover:bg-slate-200 dark:hover:bg-neutral-700 hover:text-slate-800 dark:hover:text-slate-100"
          aria-label={isMaximized ? t('common.restoreWindow') : t('common.maximize')}
          title={isMaximized ? t('common.restoreWindow') : t('common.maximize')}
        >
          {isMaximized ? <Copy size={14} strokeWidth={2.25} /> : <Square size={12} strokeWidth={2.25} />}
        </button>

        <button
          onClick={() => window.api.window.close()}
          className="flex h-8 w-8 items-center justify-center rounded-md text-slate-600 dark:text-neutral-300 transition-colors hover:bg-red-500 hover:text-white"
          aria-label={t('common.close')}
          title={t('common.close')}
        >
          <X size={14} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  )
}
