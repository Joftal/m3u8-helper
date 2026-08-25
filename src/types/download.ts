export interface DownloadTask {
  id: string
  url: string
  saveName: string
  saveDir?: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  progress: number
  speed: string
  downloadedSegments: number
  totalSegments: number
  downloadedBytes?: number
  totalBytes?: number
  etaSeconds?: number
  currentFrameRate?: number
  latestLog?: string
  startTime: string
  endTime?: string
  logs: LogEntry[]
  options: DownloadOptions
}

/**
 * 下载选项 — 与 N_m3u8DL-RE CLI 参数一一对应
 * 参考: CommandInvoker.cs 中的 Option 定义
 */
export interface DownloadOptions {
  // 必填
  url: string

  /**
   * GUI 元数据：任务类别标记（record = 直播录制）。
   * 不传给 CLI，仅用于前端 Tab 分类与主进程产物清理/通知策略，
   * 避免依赖 live 字段嗅探的脆弱判定（旧快照仍回退到字段嗅探）。
   */
  kind?: 'download' | 'record'

  // 文件管理
  saveName?: string
  saveDir?: string
  savePattern?: string
  tmpDir?: string
  logFilePath?: string
  baseUrl?: string

  // 下载控制
  threadCount?: number
  downloadRetryCount?: number
  httpRequestTimeout?: number
  maxSpeed?: string

  // 流选择
  autoSelect?: boolean
  subOnly?: boolean
  videoFilter?: string       // -sv
  audioFilter?: string       // -sa
  subtitleFilter?: string    // -ss
  dropVideoFilter?: string   // -dv
  dropAudioFilter?: string   // -da
  dropSubtitleFilter?: string // -ds

  // 合并控制
  skipMerge?: boolean
  binaryMerge?: boolean
  useFFmpegConcatDemuxer?: boolean
  checkSegmentsCount?: boolean

  // 混流
  muxAfterDone?: boolean
  muxFormat?: string         // mp4 | mkv
  muxMuxer?: string          // ffmpeg | mkvmerge
  muxKeepFiles?: boolean
  muxSkipSub?: boolean
  muxImports?: string[]

  // 清理
  delAfterDone?: boolean
  noDateInfo?: boolean

  // 日志
  noLog?: boolean
  logLevel?: string

  // 元数据
  writeMetaJson?: boolean
  appendUrlParams?: boolean

  // 并发
  concurrentDownload?: boolean

  // 字幕
  subFormat?: string
  autoSubtitleFix?: boolean

  // 网络
  headers?: Record<string, string>
  proxy?: string
  useSystemProxy?: boolean

  // 解密
  keys?: string[]
  keyTextFile?: string
  decryptionEngine?: string  // MP4DECRYPT | SHAKA_PACKAGER | FFMPEG
  mp4decryptPath?: string
  mp4RealTimeDecryption?: boolean
  customHlsMethod?: string
  customHlsKey?: string
  customHlsIv?: string

  // 工具路径
  ffmpegPath?: string

  // 范围和广告
  customRange?: string
  adKeywords?: string[]

  // 任务调度
  taskStartAt?: string       // yyyyMMddHHmmss
  allowHlsMultiExtMap?: boolean

  // 直播录制
  livePerformAsVod?: boolean
  liveRealTimeMerge?: boolean
  livePipeMux?: boolean
  liveFixVttByAudio?: boolean
  liveRecordLimit?: string   // HH:mm:ss
  liveWaitTime?: number
  liveTakeCount?: number

  // 自定义参数（追加到末尾）
  customArgs?: string
}

export interface LogEntry {
  timestamp: string
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG'
  message: string
}

export interface HistoryRecord {
  id: string
  url: string
  saveName: string
  status: 'completed' | 'failed' | 'cancelled'
  startTime: string
  endTime: string
  fileSize: number
  outputPath: string
  duration: number
}
