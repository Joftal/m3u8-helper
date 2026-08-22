import { BrowserWindow, clipboard, ipcMain } from 'electron'
import { getStore } from './store'

let clipboardWatcher: ReturnType<typeof setInterval> | null = null
let lastClipboardContent = ''

const M3U8_PATTERN = /https?:\/\/[^\s"']+\.(?:m3u8|mpd|ism(?:\/manifest)?)[^\s"']*/i

export function startClipboardWatch(mainWindow: BrowserWindow | null): void {
  if (clipboardWatcher) return

  lastClipboardContent = clipboard.readText()

  clipboardWatcher = setInterval(() => {
    const current = clipboard.readText()
    if (current !== lastClipboardContent) {
      lastClipboardContent = current
      const match = current.match(M3U8_PATTERN)
      if (match && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('clipboard:detected', match[0])
      }
    }
  }, 1000)
}

export function stopClipboardWatch(): void {
  if (clipboardWatcher) {
    clearInterval(clipboardWatcher)
    clipboardWatcher = null
  }
}
