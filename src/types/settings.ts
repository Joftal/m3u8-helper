/**
 * 应用设置 — 与 N_m3u8DL-RE CLI 参数对应
 * 参考: CommandInvoker.cs + MyOption.cs
 */
import type { SupportedLocale } from '../constants/locales'

export type Language = SupportedLocale

export interface AppSettings {
  language: Language

  // 工具路径
  exePath: string
  ffmpegPath: string
  mp4decryptPath: string

  // 文件管理
  saveDir: string
  tmpDir: string
  savePattern: string
  logFilePath: string

  // 网络
  baseUrl: string
  proxy: string
  useSystemProxy: boolean
  headers: Record<string, string>

  // 下载控制
  threadCount: number
  downloadRetryCount: number
  httpRequestTimeout: number
  maxSpeed: string
  autoSelect: boolean
  subOnly: boolean

  // 批量任务并发数（UI 层，非 CLI 参数）
  batchConcurrency: number

  // 合并控制
  binaryMerge: boolean
  checkSegmentsCount: boolean
  useFFmpegConcatDemuxer: boolean
  skipMerge: boolean

  // 混流
  muxAfterDone: boolean
  muxFormat: string
  muxMuxer: string
  muxKeepFiles: boolean
  muxSkipSub: boolean

  // 清理
  delAfterDone: boolean
  noDateInfo: boolean

  // 日志
  logLevel: string
  noLog: boolean

  // 元数据
  writeMetaJson: boolean
  appendUrlParams: boolean

  // 并发
  concurrentDownload: boolean

  // 字幕
  subFormat: string
  autoSubtitleFix: boolean

  // 解密
  decryptionEngine: string
  mp4RealTimeDecryption: boolean
  keyTextFile: string
  customHlsMethod: string
  customHlsKey: string
  customHlsIv: string

  // 范围
  customRange: string

  // 广告
  adKeywords: string[]

  // HLS 高级
  allowHlsMultiExtMap: boolean

  // 自定义参数
  customArgs: string
}
