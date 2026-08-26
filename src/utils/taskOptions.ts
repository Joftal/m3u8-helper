import type { DownloadTask, DownloadOptions } from '../types/download'
import type { AppSettings } from '../types/settings'

/**
 * 由全局设置生成任务参数基座，调用方通过 overrides 覆盖差异字段。
 * 消除下载/录制/批量/历史重下载多处重复的 settings→options 手写映射。
 */
export function buildTaskOptions(settings: AppSettings, overrides: Partial<DownloadOptions> = {}): DownloadOptions {
  return {
    saveDir: settings.saveDir,
    tmpDir: settings.tmpDir,
    threadCount: settings.threadCount,
    autoSelect: settings.autoSelect,
    delAfterDone: settings.delAfterDone,
    muxFormat: settings.muxFormat,
    maxSpeed: settings.maxSpeed || undefined,
    ffmpegPath: settings.ffmpegPath || undefined,
    mp4decryptPath: settings.mp4decryptPath || undefined,
    autoSubtitleFix: settings.autoSubtitleFix,
    subFormat: settings.subFormat,
    binaryMerge: settings.binaryMerge,
    writeMetaJson: settings.writeMetaJson,
    concurrentDownload: settings.concurrentDownload,
    useSystemProxy: settings.useSystemProxy,
    proxy: settings.proxy || undefined,
    // 防御式判空：settings 对象形状由加载/重置链路保证完整，此处兜底避免历史路径下的 undefined 崩溃
    headers: settings.headers && Object.keys(settings.headers).length > 0 ? settings.headers : undefined,
    logLevel: settings.logLevel,
    decryptionEngine: settings.decryptionEngine,
    downloadRetryCount: settings.downloadRetryCount,
    httpRequestTimeout: settings.httpRequestTimeout,
    checkSegmentsCount: settings.checkSegmentsCount,
    baseUrl: settings.baseUrl || undefined,
    skipMerge: settings.skipMerge || undefined,
    customHlsMethod: settings.customHlsMethod || undefined,
    customHlsKey: settings.customHlsKey || undefined,
    customHlsIv: settings.customHlsIv || undefined,
    customRange: settings.customRange || undefined,
    adKeywords: settings.adKeywords?.length > 0 ? settings.adKeywords : undefined,
    allowHlsMultiExtMap: settings.allowHlsMultiExtMap || undefined,
    keyTextFile: settings.keyTextFile || undefined,
    mp4RealTimeDecryption: settings.mp4RealTimeDecryption || undefined,
    appendUrlParams: settings.appendUrlParams || undefined,
    noDateInfo: settings.noDateInfo || undefined,
    noLog: settings.noLog || undefined,
    // overrides 由内部调用点受控传入；展开后 TS 将必填字段放宽为可空，这里统一收窄
    ...overrides
  } as DownloadOptions
}

export interface CreateTaskParams {
  id: string
  url: string
  saveName: string
  saveDir: string
  options: DownloadOptions
}

/** 由任务参数构造前端任务记录（pending 态），供发起下载的各入口复用 */
export function createTaskRecord(params: CreateTaskParams): DownloadTask {
  return {
    id: params.id,
    url: params.url,
    saveName: params.saveName,
    saveDir: params.saveDir,
    status: 'pending',
    progress: 0,
    speed: '0 KB/s',
    downloadedSegments: 0,
    totalSegments: 0,
    startTime: new Date().toISOString(),
    logs: [],
    options: params.options
  }
}
