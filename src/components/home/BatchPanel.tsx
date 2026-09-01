import { useRef } from 'react'
import { Play, Trash2, Upload } from 'lucide-react'
import { useBatchStore } from '@/store/batchStore'
import { useTranslation } from '@/i18n'
import { getTaskStatusMeta, STATUS_ICON_META } from '@/utils/status'

/** 下载 Tab 的批量下载卡片（状态与编排逻辑在 batchStore，与 Home 解耦） */
export default function BatchPanel() {
  const { t, locale } = useTranslation()
  const statusMeta = getTaskStatusMeta(locale)
  const { batchText, batchItems, isBatchRunning, setBatchText, clearBatch, parseBatchUrls, importFromFile, startBatch, stopBatch } = useBatchStore()
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-2xl leading-none">🗂️</span>
        <span className="text-sm font-semibold text-slate-800 dark:text-neutral-100">{t('home.batchDownload')}</span>
      </div>

      <textarea
        value={batchText}
        onChange={(e) => setBatchText(e.target.value)}
        placeholder={t('home.batchPlaceholder')}
        className="input-field h-28 resize-none font-mono text-sm"
      />

      <div className="mt-4 flex flex-wrap gap-2">
        <button onClick={parseBatchUrls} className="btn-primary flex items-center gap-1.5 text-sm"><Play size={15} /> {t('home.parseLinks')}</button>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="btn-secondary flex items-center gap-1.5 text-sm"
        >
          <Upload size={15} /> {t('home.importTable')}
        </button>
        <button onClick={clearBatch} className="btn-secondary flex items-center gap-1.5 text-sm"><Trash2 size={15} /> {t('home.clear')}</button>
        <button onClick={startBatch} disabled={isBatchRunning || batchItems.length === 0} className="btn-secondary flex items-center gap-1.5 text-sm">
          {isBatchRunning ? t('home.processing') : t('home.startAll')}
        </button>
        {isBatchRunning && (
          <button onClick={stopBatch} className="btn-secondary flex items-center gap-1.5 text-sm">
            {t('home.stopBatch')}
          </button>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,.csv,.tsv,.xls,.xlsx"
        className="hidden"
        onChange={importFromFile}
      />

      {batchItems.length > 0 && (
        <div className="mt-4 space-y-2">
          {batchItems.map((item) => {
            const BatchIcon = STATUS_ICON_META[item.status]
            const batchStatusText = item.status === 'running' ? t('home.downloadInProgress') : statusMeta[item.status].label
            return (
              <div key={item.id} className="flex items-center justify-between rounded-xl border border-slate-200 dark:border-neutral-800 bg-slate-50/60 dark:bg-neutral-800/45 px-3 py-2 text-sm">
                <div className="min-w-0 flex-1 pr-3">
                  <div className="truncate font-medium text-slate-700 dark:text-neutral-200">{item.saveName}</div>
                  <div className="truncate text-[11px] text-slate-500 dark:text-neutral-400">{item.url}</div>
                </div>
                <span title={batchStatusText} className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
                  <BatchIcon.Icon size={14} className={`${BatchIcon.className}${BatchIcon.spin ? ' animate-spin' : ''}`} />
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
