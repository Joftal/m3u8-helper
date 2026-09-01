import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useDownloadStore } from '@/store/downloadStore'
import { useHistoryStore } from '@/store/historyStore'
import { useSettingsStore } from '@/store/settingsStore'
import { useBatchStore } from '@/store/batchStore'
import DownloadPanel from '@/components/home/DownloadPanel'
import RecordPanel from '@/components/home/RecordPanel'
import BatchPanel from '@/components/home/BatchPanel'
import TaskList from '@/components/home/TaskList'
import TaskModals from '@/components/home/TaskModals'
import { showToast } from '@/components/Toast'
import { useTranslation } from '@/i18n'
import { generateId } from '@/utils/format'
import { isRecordTask } from '@/utils/recording'
import type { DownloadTask } from '@/types/download'

function getTaskRuntimeSeconds(startTime?: string): number {
  if (!startTime) return 0
  const start = Date.parse(startTime)
  if (Number.isNaN(start)) return 0
  return Math.max(0, Math.floor((Date.now() - start) / 1000))
}

/**
 * 首页骨架：Tab 切换 + IPC 事件订阅 + 任务操作（取消/重试/删除）+ 确认弹窗。
 * 入口表单与批量队列已拆分为 DownloadPanel / RecordPanel / BatchPanel，
 * 任务列表渲染在 TaskList，弹窗在 TaskModals。
 */
export default function Home() {
  const location = useLocation()
  const { t } = useTranslation()
  // 挂载一次的 IPC 订阅（下方 useEffect []）内的 handler 通过 ref 读取最新 t，
  // 避免闭包捕获首次渲染的 t——彼时 loadSettings 尚未返回，语言还是默认值
  const tRef = useRef(t)
  tRef.current = t

  // 支持跨页跳转直达指定页签（如历史页"再次执行"录制条目 → 录制 Tab）
  const [activeTab, setActiveTab] = useState<'download' | 'record'>(() =>
    (location.state as { tab?: 'download' | 'record' } | null)?.tab === 'record' ? 'record' : 'download'
  )

  // 正在执行停止操作的录制任务：按钮保持禁用直至 complete 事件确认终止，
  // 避免对同一进程重复下发终止信号（PID 复用误杀风险）
  const [cancellingIds, setCancellingIds] = useState<string[]>([])
  // 重试确认弹窗目标：录制任务重试会清理已录产物，必须显式确认
  const [retryConfirmTask, setRetryConfirmTask] = useState<DownloadTask | null>(null)
  const [deleteConfirmTask, setDeleteConfirmTask] = useState<DownloadTask | null>(null)
  // 录制计时基准：由任务 startTime 派生（单一数据源），仅在存在活跃录制时每秒跳动
  const [nowTs, setNowTs] = useState(() => Date.now())

  const { tasks, activeTaskId, updateTask, setActiveTask, removeTask } = useDownloadStore()
  const { settings } = useSettingsStore()
  const { addRecord, removeRecord } = useHistoryStore()

  useEffect(() => {
    const handleProgress = (data: any) => {
      updateTask(data.taskId, {
        progress: data.progress,
        speed: data.speed,
        downloadedSegments: data.downloadedSegments,
        totalSegments: data.totalSegments,
        downloadedBytes: data.downloadedBytes,
        totalBytes: data.totalBytes,
        etaSeconds: data.etaSeconds,
        currentFrameRate: data.currentFrameRate,
        latestLog: data.latestLog,
        status: data.status
      })
      useBatchStore.getState().notifyProgress(data)
    }

    const handleComplete = (data: any) => {
      // 批量队列：释放并发槽位并同步条目状态
      useBatchStore.getState().notifyComplete(data)

      // 停止流程已被 complete 事件确认：解除对应按钮的禁用态
      setCancellingIds((prev) => prev.filter((id) => id !== data.taskId))

      const task = useDownloadStore.getState().getTask(data.taskId)
      if (task) {
        updateTask(data.taskId, {
          status: data.status,
          progress: typeof data.progress === 'number' ? data.progress : task.progress,
          speed: data.speed || task.speed || '0 KB/s',
          downloadedSegments: typeof data.downloadedSegments === 'number' ? data.downloadedSegments : task.downloadedSegments,
          totalSegments: typeof data.totalSegments === 'number' ? data.totalSegments : task.totalSegments,
          downloadedBytes: typeof data.downloadedBytes === 'number' ? data.downloadedBytes : task.downloadedBytes,
          totalBytes: typeof data.totalBytes === 'number' ? data.totalBytes : task.totalBytes,
          etaSeconds: typeof data.etaSeconds === 'number' ? data.etaSeconds : task.etaSeconds,
          currentFrameRate: typeof data.currentFrameRate === 'number' ? data.currentFrameRate : task.currentFrameRate,
          latestLog: data.latestLog || task.latestLog || tRef.current('status.completed'),
          endTime: new Date().toISOString()
        })

        // 录制任务终态反馈：
        // - 失败必须显式提示（后台挂机录制的异常终止此前完全静默）；
        // - 取消即“停止并保存”，在此统一播报，替代停止按钮点击时的抢跑文案
        if (isRecordTask(task)) {
          if (data.status === 'failed') {
            showToast('error', tRef.current('home.recordAborted').replace('{name}', task.saveName || task.url))
          } else if (data.status === 'cancelled') {
            showToast('info', tRef.current('home.recordStoppedSaved'))
          }
        }

        addRecord({
          id: data.taskId,
          url: task.url,
          saveName: task.saveName,
          status: data.status === 'completed' ? 'completed' : data.status === 'cancelled' ? 'cancelled' : 'failed',
          kind: isRecordTask(task) ? 'record' : 'download',
          startTime: task.startTime,
          endTime: new Date().toISOString(),
          fileSize: Number(task.totalBytes || task.downloadedBytes || 0),
          outputPath: task.saveDir || task.options?.saveDir || useSettingsStore.getState().settings.saveDir || '',
          duration: getTaskRuntimeSeconds(task.startTime)
        })
      }
    }

    const offProgress = window.api.download.onProgress(handleProgress)
    const offComplete = window.api.download.onComplete(handleComplete)
    // 录制停止/中断后主进程自动把 TS 中间产物转封装为 MKV，这里反馈结果
    const offRemux = window.api.download.onRemuxDone((data) => {
      if (!data || data.attempted <= 0) return
      if (data.outputs.length > 0) {
        showToast('success', tRef.current('home.remuxSuccess').replace('{count}', String(data.outputs.length)))
      } else {
        showToast('error', tRef.current('home.remuxFailed'))
      }
    })

    return () => {
      offProgress()
      offComplete()
      offRemux()
    }
    // 订阅仅挂载时注册一次：handler 内通过 getState()/ref 取最新值，避免随进度更新反复重挂
  }, [])

  const downloadTasks = tasks.filter((task) => !isRecordTask(task))
  const recordTasks = tasks.filter((task) => isRecordTask(task))
  const visibleTasks = activeTab === 'download' ? downloadTasks : recordTasks

  // 录制计时 ticker：仅在录制 Tab 可见且存在活跃录制任务时运行，
  // 驱动基于 startTime 的已录时长刷新（下载 Tab 期间录制 UI 不可见，无需空转重渲染）
  const activeRecordCount = recordTasks.filter((task) => task.status === 'running' || task.status === 'pending').length
  const hasLiveRecord = activeRecordCount > 0
  const recordTickerActive = hasLiveRecord && activeTab === 'record'
  useEffect(() => {
    if (!recordTickerActive) return
    setNowTs(Date.now())
    const timer = setInterval(() => setNowTs(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [recordTickerActive])

  const getTaskActionMessage = (
    action: 'cancel' | 'retry' | 'delete',
    outcome: 'success' | 'error' | 'info',
    detail: string
  ) => {
    const actionText = t(`home.taskAction.${action}`)
    const resultText = outcome === 'error' ? t('home.taskAction.failed') : t('home.taskAction.success')
    return t('home.taskAction.messageTemplate')
      .replace('{action}', actionText)
      .replace('{result}', resultText)
      .replace('{detail}', detail)
  }

  /**
   * 停止一个录制任务：立即置为“停止中”禁用相关按钮，
   * 直到 download:complete 到达再解除，避免对同一进程重复下发终止信号
   */
  const stopRecording = async (taskId: string) => {
    if (cancellingIds.includes(taskId)) return
    setCancellingIds((prev) => prev.includes(taskId) ? prev : [...prev, taskId])
    try {
      const result = await window.api.download.cancel(taskId)
      if (!result?.success) {
        // 任务可能已自行结束并被移除：立即解除禁用
        setCancellingIds((prev) => prev.filter((id) => id !== taskId))
      }
    } catch {
      setCancellingIds((prev) => prev.filter((id) => id !== taskId))
    }
  }

  /** 重试入口：录制任务的旧产物会被清理，先经确认弹窗；普通下载维持直接重试 */
  const requestRetry = (task: DownloadTask) => {
    if (isRecordTask(task)) {
      setRetryConfirmTask(task)
      return
    }
    performRetry(task)
  }

  const deleteTaskArtifactsAndCleanup = async (task: DownloadTask, options: { keepHistory?: boolean } = {}) => {
    try {
      const result = await window.api.download.delete(task.id, {
        saveDir: task.saveDir || settings.saveDir,
        saveName: task.saveName,
        tmpDir: task.options?.tmpDir || settings.tmpDir,
        outputPath: (task.options as any)?.outputPath,
        options: task.options || {}
      })
      if (!result?.success) {
        return { success: false, message: result?.error || t('home.taskAction.cleanupFailed') }
      }
      removeTask(task.id)
      await window.api.runtime.remove(task.id)
      if (task.id === activeTaskId) setActiveTask(null)
      // 历史语义：仅"删除任务"移除历史记录；"取消任务"保留痕迹，
      // 由 handleTaskCancel 显式写入一条已取消记录（keepHistory: true）
      if (!options.keepHistory) {
        await removeRecord(task.id)
      }
      return { success: true, message: t('home.taskAction.cleaned') }
    } catch {
      return { success: false, message: t('home.taskAction.cleanupFailed') }
    }
  }

  const handleTaskCancel = async (task: DownloadTask) => {
    const actionText = 'cancel' as const
    try {
      const cancelResult = await window.api.download.cancel(task.id)
      if (!cancelResult?.success) {
        showToast('error', getTaskActionMessage(actionText, 'error', t('home.taskAction.alreadyFinished')))
        return
      }

      // 取消保留历史痕迹：清理文件与任务列表，但不移除记录
      const cleanupResult = await deleteTaskArtifactsAndCleanup(task, { keepHistory: true })

      // 显式落一条"已取消"记录：complete 事件与任务清理存在竞速，
      // 事件侧可能因任务已被移除而跳过写入，这里统一兜底；
      // store 与主进程的 history:add 均按 id 幂等覆盖，不会产生重复
      await addRecord({
        id: task.id,
        url: task.url,
        saveName: task.saveName,
        status: 'cancelled',
        kind: 'download',
        startTime: task.startTime,
        endTime: new Date().toISOString(),
        fileSize: Number(task.totalBytes || task.downloadedBytes || 0),
        outputPath: task.saveDir || task.options?.saveDir || settings.saveDir || '',
        duration: getTaskRuntimeSeconds(task.startTime)
      })

      if (activeTaskId === task.id) {
        setActiveTask(null)
      }
      showToast('info', cleanupResult.success
        ? getTaskActionMessage(actionText, 'success', t('home.taskAction.cancelledAndSaved'))
        : getTaskActionMessage(actionText, 'success', t('home.taskAction.cancelledPartial')))
    } catch {
      showToast('error', getTaskActionMessage(actionText, 'error', t('home.taskAction.notStopped')))
    }
  }

  /** 执行重试（录制任务须经 requestRetry 确认后才会进入这里） */
  const performRetry = async (task: DownloadTask) => {
    const actionText = 'retry' as const
    const options = {
      ...(task.options || {}),
      url: task.url,
      saveName: task.saveName,
      saveDir: task.saveDir || settings.saveDir,
      // 重试一律从全局基目录重新派生隔离临时目录；
      // 旧任务的 task-<id> 目录已由上方 cleanup 删除，若复用会产生 task-old/task-new 嵌套路径
      tmpDir: settings.tmpDir,
      customArgs: task.options?.customArgs || settings.customArgs || undefined,
      maxSpeed: task.options?.maxSpeed || settings.maxSpeed || undefined,
      proxy: task.options?.proxy || settings.proxy || undefined,
      headers: Object.keys(task.options?.headers || {}).length > 0 ? task.options.headers : (Object.keys(settings.headers).length > 0 ? settings.headers : undefined),
      logLevel: task.options?.logLevel || settings.logLevel
    }

    try {
      const cleanupResult = await deleteTaskArtifactsAndCleanup(task)
      if (!cleanupResult.success) {
        showToast('error', getTaskActionMessage(actionText, 'error', cleanupResult.message))
        return
      }

      const result = await window.api.download.start(options)
      if (!result?.success) {
        showToast('error', getTaskActionMessage(actionText, 'error', result?.error || t('common.unknownError')))
        return
      }
      const newTaskId = result.taskId || generateId()
      const recreated: DownloadTask = {
        ...task,
        id: newTaskId,
        status: 'pending',
        progress: 0,
        speed: '0 KB/s',
        downloadedSegments: 0,
        totalSegments: task.totalSegments || 0,
        downloadedBytes: 0,
        totalBytes: task.totalBytes || 0,
        etaSeconds: 0,
        endTime: undefined,
        latestLog: t('home.taskAction.retry'),
        startTime: new Date().toISOString(),
        options: result.options || options
      }
      useDownloadStore.getState().addTask(recreated)
      setActiveTask(newTaskId)
      showToast('success', getTaskActionMessage(actionText, 'success', t('home.taskAction.oldResidual')))
    } catch {
      showToast('error', getTaskActionMessage(actionText, 'error', t('home.taskAction.cannotRestart')))
    }
  }

  const handleTaskDelete = async (task: DownloadTask) => {
    const actionText = 'delete' as const
    try {
      const cleanupResult = await deleteTaskArtifactsAndCleanup(task)
      if (!cleanupResult.success) {
        showToast('error', getTaskActionMessage(actionText, 'error', cleanupResult.message))
        return
      }
      showToast('success', getTaskActionMessage(actionText, 'success', t('home.taskAction.cleaned')))
    } catch {
      showToast('error', getTaskActionMessage(actionText, 'error', t('home.taskAction.taskFileMayExist')))
    } finally {
      setDeleteConfirmTask(null)
    }
  }

  const openTaskFolder = async (task: DownloadTask) => {
    const dir = task.saveDir || settings.saveDir
    if (!dir) {
      showToast('info', t('home.noOutputPath'))
      return
    }
    const error = await window.api.shell.openPath(dir)
    error ? showToast('error', t('home.openFolderFailed').replace('{error}', String(error))) : showToast('success', t('home.folderOpened'))
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <TaskModals
        deleteConfirmTask={deleteConfirmTask}
        retryConfirmTask={retryConfirmTask}
        onCloseDelete={() => setDeleteConfirmTask(null)}
        onCloseRetry={() => setRetryConfirmTask(null)}
        onConfirmDelete={handleTaskDelete}
        onConfirmRetry={performRetry}
      />

      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold tracking-[0.18em] text-slate-500 dark:text-neutral-400 uppercase">{t('home.pageKicker')}</div>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-neutral-50">{t('home.overview')}</h1>
        </div>
        <div className="flex items-center gap-2" />
      </div>

      <div className="flex justify-center">
        <div className="w-full max-w-[340px] rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-1.5 shadow-sm">
          <div className="inline-flex w-full rounded-xl bg-slate-100 dark:bg-neutral-800 p-1">
            <button
              className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition ${activeTab === 'download' ? 'bg-white dark:bg-neutral-900 text-blue-700 dark:text-blue-300 shadow-sm' : 'text-slate-500 dark:text-neutral-400'}`}
              onClick={() => setActiveTab('download')}
            >
              {t('home.downloadTask')}
            </button>
            <button
              className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition ${activeTab === 'record' ? 'bg-white dark:bg-neutral-900 text-red-600 dark:text-red-400 shadow-sm' : 'text-slate-500 dark:text-neutral-400'}`}
              onClick={() => setActiveTab('record')}
            >
              {t('home.recordTask')}
            </button>
          </div>
        </div>
      </div>

      {activeTab === 'download' ? (
        <div className="space-y-6">
          <DownloadPanel />
          <BatchPanel />
        </div>
      ) : (
        <div className="space-y-6">
          <RecordPanel />
        </div>
      )}

      <TaskList
        tasks={visibleTasks}
        activeTab={activeTab}
        nowTs={nowTs}
        cancellingIds={cancellingIds}
        onCancel={handleTaskCancel}
        onRetry={requestRetry}
        onDelete={setDeleteConfirmTask}
        onStopRecord={stopRecording}
        onOpenFolder={openTaskFolder}
      />
    </div>
  )
}
