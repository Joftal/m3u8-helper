import Modal from '@/components/Modal'
import { useTranslation } from '@/i18n'
import { formatFileSize } from '@/utils/format'
import { isRecordTask } from '@/utils/recording'
import type { DownloadTask } from '@/types/download'

interface TaskModalsProps {
  deleteConfirmTask: DownloadTask | null
  retryConfirmTask: DownloadTask | null
  onCloseDelete: () => void
  onCloseRetry: () => void
  onConfirmDelete: (task: DownloadTask) => void
  onConfirmRetry: (task: DownloadTask) => void
}

/** 任务操作确认弹窗：删除确认 + 录制重试确认（重试会清理已录产物） */
export default function TaskModals({ deleteConfirmTask, retryConfirmTask, onCloseDelete, onCloseRetry, onConfirmDelete, onConfirmRetry }: TaskModalsProps) {
  const { t } = useTranslation()
  const formatApproxSize = (bytes: number) => `(${t('common.approx')} ${formatFileSize(bytes)})`

  return (
    <>
      <Modal open={Boolean(deleteConfirmTask)} onClose={onCloseDelete} title={t('home.deleteTask')} width="max-w-md">
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 dark:border-neutral-800 bg-slate-50 dark:bg-neutral-800/60 px-3 py-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-neutral-400">{t('home.taskName')}</div>
            <div className="mt-1 truncate text-sm font-semibold text-slate-700 dark:text-neutral-200">{deleteConfirmTask?.saveName || deleteConfirmTask?.url || ''}</div>
          </div>

          <p className="text-sm leading-6 text-slate-300 dark:text-neutral-600">
            {t('home.deleteWarning')
              .replace('{target}', isRecordTask(deleteConfirmTask) ? t('home.recordTask') : t('home.downloadTask'))
             .replace('{size}', deleteConfirmTask && Number(deleteConfirmTask.downloadedBytes || 0) > 0 ? formatApproxSize(Number(deleteConfirmTask.downloadedBytes)) : '')}
          </p>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              onClick={onCloseDelete}
              className="rounded-lg border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3.5 py-2 text-sm font-medium text-slate-300 dark:text-neutral-600 transition hover:bg-slate-100 dark:hover:bg-neutral-800 hover:bg-slate-50 dark:hover:bg-neutral-800/60"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={() => deleteConfirmTask && onConfirmDelete(deleteConfirmTask)}
              className="rounded-lg border border-red-200 dark:border-red-500/20 bg-red-600 px-3.5 py-2 text-sm font-medium text-white transition"
            >
              {t('home.confirmDelete')}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={Boolean(retryConfirmTask)} onClose={onCloseRetry} title={t('home.retryRecordTask')} width="max-w-md">
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 dark:border-neutral-800 bg-slate-50 dark:bg-neutral-800/60 px-3 py-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-neutral-400">{t('home.taskName')}</div>
            <div className="mt-1 truncate text-sm font-semibold text-slate-700 dark:text-neutral-200">{retryConfirmTask?.saveName || retryConfirmTask?.url || ''}</div>
          </div>

          <p className="text-sm leading-6 text-slate-300 dark:text-neutral-600">
            {t('home.retryWarning').replace('{size}', retryConfirmTask && Number(retryConfirmTask.downloadedBytes || 0) > 0 ? formatApproxSize(Number(retryConfirmTask.downloadedBytes)) : '')}
          </p>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              onClick={onCloseRetry}
              className="rounded-lg border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3.5 py-2 text-sm font-medium text-slate-300 dark:text-neutral-600 transition hover:bg-slate-100 dark:hover:bg-neutral-800 hover:bg-slate-50 dark:hover:bg-neutral-800/60"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={() => {
                const target = retryConfirmTask
                onCloseRetry()
                if (target) onConfirmRetry(target)
              }}
              className="rounded-lg border border-emerald-200 dark:border-emerald-500/20 bg-emerald-600 px-3.5 py-2 text-sm font-medium text-white transition"
            >
              {t('home.deleteAndRerun')}
            </button>
          </div>
        </div>
      </Modal>
    </>
  )
}
