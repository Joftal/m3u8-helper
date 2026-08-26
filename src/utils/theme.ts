export type ThemeMode = 'light' | 'dark'

const STORAGE_KEY = 'm3u8-helper-theme'

/** 读取持久化的主题偏好；无记录或存储异常时回落亮色 */
export function getStoredTheme(): ThemeMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

/** 应用主题到文档根节点并持久化 */
export function applyTheme(mode: ThemeMode): void {
  document.documentElement.classList.toggle('dark', mode === 'dark')
  try {
    localStorage.setItem(STORAGE_KEY, mode)
  } catch {}
}

/** 切换主题并返回新模式 */
export function toggleTheme(): ThemeMode {
  const next: ThemeMode = getStoredTheme() === 'dark' ? 'light' : 'dark'
  applyTheme(next)
  return next
}
