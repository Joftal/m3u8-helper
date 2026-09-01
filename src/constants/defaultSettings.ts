import { DEFAULT_LOCALE } from './locales'
import type { AppSettings } from '../types/settings'

/**
 * 默认设置的静态部分（主进程与渲染端共享的唯一来源）。
 *
 * 路径类字段（saveDir / tmpDir / logFilePath）依赖运行时环境，不在此处：
 * - 主进程 store.ts 用应用根目录派生真实路径
 * - 渲染端 settingsStore 以空串占位（加载后由主进程权威值覆盖）
 * 新增配置项只需改这里 + AppSettings 类型，两侧自动同步。
 */
export const STATIC_DEFAULT_SETTINGS: Omit<AppSettings, 'saveDir' | 'tmpDir' | 'logFilePath'> = {
  language: DEFAULT_LOCALE,
  exePath: '',
  ffmpegPath: '',
  mp4decryptPath: '',
  savePattern: '',
  baseUrl: '',
  proxy: '',
  useSystemProxy: true,
  headers: {},
  threadCount: 8,
  downloadRetryCount: 3,
  httpRequestTimeout: 100,
  maxSpeed: '',
  autoSelect: true,
  subOnly: false,
  batchConcurrency: 2,
  binaryMerge: false,
  checkSegmentsCount: true,
  useFFmpegConcatDemuxer: false,
  skipMerge: false,
  muxAfterDone: true,
  muxFormat: 'mp4',
  muxMuxer: 'ffmpeg',
  muxKeepFiles: false,
  muxSkipSub: false,
  delAfterDone: true,
  noDateInfo: false,
  logLevel: 'INFO',
  noLog: false,
  writeMetaJson: true,
  appendUrlParams: false,
  concurrentDownload: false,
  subFormat: 'SRT',
  autoSubtitleFix: true,
  decryptionEngine: 'MP4DECRYPT',
  mp4RealTimeDecryption: false,
  keyTextFile: '',
  customHlsMethod: '',
  customHlsKey: '',
  customHlsIv: '',
  customRange: '',
  adKeywords: [],
  allowHlsMultiExtMap: false,
  customArgs: ''
}
