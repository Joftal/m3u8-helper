import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '../constants/locales'

const WINDOWS_DRIVE = /^[a-zA-Z]:[\\/]/
const UNIX_ABSOLUTE = /^\//
const TILDE_ABSOLUTE = /^~[\\/]/

function isValidHttpUrl(value: string): boolean {
  if (!value) return true
  try {
    const url = new URL(value)
    // 必须携带主机名：裸协议（如「socks:」）可被 URL 解析但不是可用地址
    return ['http:', 'https:', 'socks:', 'socks4:', 'socks5:'].includes(url.protocol) && url.hostname !== ''
  } catch {
    return false
  }
}

function isValidPathLike(value: string): boolean {
  if (!value || !value.trim()) return true
  return WINDOWS_DRIVE.test(value) || UNIX_ABSOLUTE.test(value) || TILDE_ABSOLUTE.test(value)
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(value, min), max)
}

export function validateQueueNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return clampNumber(parsed, min, max)
}

export function validateSettingValue(key: string, value: unknown): { valid: boolean; value: unknown; message?: string } {
  const normalized = value == null ? '' : value

  switch (key) {
    case 'exePath':
    case 'ffmpegPath':
    case 'mp4decryptPath':
    case 'saveDir':
    case 'tmpDir':
    case 'logFilePath':
    case 'keyTextFile': {
      if (typeof normalized !== 'string') return { valid: false, value: '', message: 'validation.stringRequired' }
      return { valid: normalized.trim() === '' || isValidPathLike(normalized.trim()), value: normalized.trim(), message: normalized.trim() && !isValidPathLike(normalized.trim()) ? 'validation.invalidPathFormat' : undefined }
    }

    case 'language': {
      const text = typeof normalized === 'string' ? normalized.toLowerCase() : DEFAULT_LOCALE
      return {
        valid: SUPPORTED_LOCALES.includes(text as (typeof SUPPORTED_LOCALES)[number]),
        value: text as (typeof SUPPORTED_LOCALES)[number],
        message: 'validation.unsupportedLanguage'
      }
    }

    case 'savePattern':
      return { valid: typeof normalized === 'string', value: typeof normalized === 'string' ? normalized.trim() : '' }

    case 'baseUrl':
    case 'proxy': {
      if (typeof normalized !== 'string') return { valid: false, value: '', message: 'validation.stringRequired' }
      if (normalized.trim() === '') return { valid: true, value: '' }
      return { valid: isValidHttpUrl(normalized.trim()), value: normalized.trim(), message: 'validation.invalidUrl' }
    }

    case 'headers': {
      if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
        return { valid: false, value: {}, message: 'validation.headersObjectRequired' }
      }
      return { valid: true, value: Object.fromEntries(Object.entries(normalized as Record<string, unknown>).map(([k, v]) => [k, String(v)])) }
    }

    case 'threadCount':
      return { valid: true, value: validateQueueNumber(normalized, 1, 64, 8) }

    case 'batchConcurrency':
      return { valid: true, value: validateQueueNumber(normalized, 1, 6, 2) }

    case 'downloadRetryCount':
      return { valid: true, value: validateQueueNumber(normalized, 0, 20, 3) }

    case 'httpRequestTimeout':
      return { valid: true, value: validateQueueNumber(normalized, 10, 600, 100) }

    case 'maxSpeed': {
      if (typeof normalized !== 'string') return { valid: false, value: '', message: 'validation.speedStringRequired' }
      if (normalized.trim() === '') return { valid: true, value: '' }
      const isValidPattern = /^\d+(?:\.\d+)?[KMG]?$/i.test(normalized.trim()) || /^\d+(?:\.\d+)?[KMG]B?\/?s?$/i.test(normalized.trim())
      return { valid: isValidPattern, value: normalized.trim(), message: 'validation.invalidSpeedFormat' }
    }

    case 'autoSelect':
    case 'subOnly':
    case 'binaryMerge':
    case 'checkSegmentsCount':
    case 'useFFmpegConcatDemuxer':
    case 'skipMerge':
    case 'muxAfterDone':
    case 'muxKeepFiles':
    case 'muxSkipSub':
    case 'delAfterDone':
    case 'noDateInfo':
    case 'noLog':
    case 'writeMetaJson':
    case 'appendUrlParams':
    case 'concurrentDownload':
    case 'autoSubtitleFix':
    case 'mp4RealTimeDecryption':
    case 'allowHlsMultiExtMap':
    case 'useSystemProxy':
      return { valid: typeof normalized === 'boolean', value: Boolean(normalized) }

    case 'muxFormat': {
      const text = typeof normalized === 'string' ? normalized : ''
      return { valid: ['mp4', 'mkv'].includes(text.toLowerCase()), value: text.toLowerCase() }
    }

    case 'muxMuxer': {
      const text = typeof normalized === 'string' ? normalized : ''
      return { valid: ['ffmpeg', 'mkvmerge'].includes(text.toLowerCase()), value: text.toLowerCase() }
    }

    case 'logLevel': {
      const text = typeof normalized === 'string' ? normalized : ''
      return { valid: ['INFO', 'DEBUG', 'WARN', 'ERROR', 'OFF'].includes(text.toUpperCase()), value: text.toUpperCase() }
    }

    case 'subFormat': {
      const text = typeof normalized === 'string' ? normalized : ''
      return { valid: ['SRT', 'VTT'].includes(text.toUpperCase()), value: text.toUpperCase() }
    }

    case 'decryptionEngine': {
      const text = typeof normalized === 'string' ? normalized : ''
      return { valid: ['MP4DECRYPT', 'SHAKA_PACKAGER', 'FFMPEG'].includes(text.toUpperCase()), value: text.toUpperCase() }
    }

    case 'customHlsMethod': {
      if (typeof normalized !== 'string') return { valid: false, value: '', message: 'validation.hlsMethodStringRequired' }
      const allowed = ['', 'AES_128', 'AES_128_ECB', 'CENC', 'CHACHA20', 'NONE', 'SAMPLE_AES', 'SAMPLE_AES_CTR']
      return { valid: allowed.includes(normalized.trim()) || normalized.trim() === '', value: normalized.trim(), message: normalized.trim() && !allowed.includes(normalized.trim()) ? 'validation.invalidHlsMethod' : undefined }
    }

    case 'customHlsKey':
    case 'customHlsIv': {
      if (typeof normalized !== 'string') return { valid: false, value: '', message: 'validation.mustBeString' }
      return { valid: true, value: normalized.trim().slice(0, 4096) }
    }

    case 'customRange': {
      if (typeof normalized !== 'string') return { valid: false, value: '', message: 'validation.parameterMustBeString' }
      if (normalized.trim() === '') return { valid: true, value: '' }
      return {
        valid: /^(\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?|\d{1,2}:\d{2}:\d{2}-\d{1,2}:\d{2}:\d{2})$/.test(normalized.trim()),
        value: normalized.trim(),
        message: 'validation.invalidCustomRangeFormat'
      }
    }

    case 'adKeywords':
      if (!Array.isArray(normalized)) return { valid: false, value: [], message: 'validation.adKeywordsStringArray' }
      return { valid: true, value: normalized.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean) }

    case 'customArgs':
      return { valid: typeof normalized === 'string', value: typeof normalized === 'string' ? normalized : '' }

    default:
      // 未知配置项一律拒绝：防止任意 key 写入 settings.json
      return { valid: false, value: undefined, message: 'validation.unknownSettingKey' }
  }
}

export function validateSettings<T extends Record<string, unknown>>(settings: T): { valid: boolean; settings: T; errors: string[] } {
  const errors: string[] = []
  // 从零构建而非浅拷贝：非法/未知键直接剔除，
  // 调用方以 {...defaults, ...result.settings} 合并时自动回落默认值
  const next = {} as T

  for (const [key, value] of Object.entries(settings)) {
    const result = validateSettingValue(key, value)
    if (!result.valid) {
      errors.push(`${key}: ${result.message ?? 'validation.invalidValue'}`)
      continue
    }
    ;(next as Record<string, unknown>)[key] = result.value
  }

  return { valid: errors.length === 0, settings: next, errors }
}

/** 静默净化：等价于 validateSettings 但不收集错误；非法/未知键被剔除而非保留 */
export function sanitizeSettings<T extends Record<string, unknown>>(settings: T): T {
  return validateSettings(settings).settings
}

export function isValidUrl(url: string): boolean {
  try {
    // 仅接受 http(s)：下载/录制入口与 N_m3u8DL-RE 的输入一致，
    // 避免 file:、ftp: 等协议流入下载链路（与主进程 scheme 校验双保险）
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}
