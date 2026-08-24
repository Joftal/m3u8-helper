import { useCallback, useEffect, useState } from 'react'

/**
 * IPC 通信 hook
 */
export function useIpc<T>(channel: string, defaultValue: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(defaultValue)

  useEffect(() => {
    window.api.settings.get(channel).then((v) => {
      if (v !== undefined && v !== null) setValue(v)
    })
  }, [channel])

  const update = useCallback(async (newValue: T) => {
    setValue(newValue)
    await window.api.settings.set(channel, newValue)
  }, [channel])

  return [value, update]
}

/**
 * 主题 hook
 */
export function useTheme() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')

  useEffect(() => {
    window.api.settings.get('theme').then((t) => {
      if (t) setTheme(t)
    })
  }, [])

  const toggleTheme = useCallback(async () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark'
    setTheme(newTheme)
    await window.api.settings.set('theme', newTheme)
  }, [theme])

  return { theme, toggleTheme, setTheme }
}

