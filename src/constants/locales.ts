export const SUPPORTED_LOCALES = ['zh', 'en'] as const

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

export const DEFAULT_LOCALE: SupportedLocale = 'zh'

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === 'string' && SUPPORTED_LOCALES.includes(value as SupportedLocale)
}

export function normalizeLocale(value: unknown, fallback: SupportedLocale = DEFAULT_LOCALE): SupportedLocale {
  if (typeof value === 'string') {
    const normalized = value.toLowerCase()
    if (isSupportedLocale(normalized)) {
      return normalized
    }
  }

  return fallback
}

export const LOCALE_LABELS: Record<SupportedLocale, string> = {
  zh: '中文',
  en: 'English'
} as const
