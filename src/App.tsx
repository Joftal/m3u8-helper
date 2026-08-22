import { useEffect } from 'react'
import { HashRouter, Routes, Route } from 'react-router-dom'
import Layout from '@/components/Layout'
import Toast from '@/components/Toast'
import Home from '@/pages/Home'
import BatchDownload from '@/pages/BatchDownload'
import LiveRecord from '@/pages/LiveRecord'
import History from '@/pages/History'
import Settings from '@/pages/Settings'
import About from '@/pages/About'
import { useSettingsStore } from '@/store/settingsStore'
import { useHistoryStore } from '@/store/historyStore'

export default function App() {
  const { loadSettings } = useSettingsStore()
  const { loadHistory } = useHistoryStore()

  useEffect(() => {
    loadSettings()
    loadHistory()
  }, [])

  // 剪贴板监听
  useEffect(() => {
    const check = async () => {
      const settings = await window.api.settings.get('clipboardWatch')
      if (settings) window.api.clipboard.start()
    }
    check()
    return () => { window.api.clipboard.stop() }
  }, [])

  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="batch" element={<BatchDownload />} />
          <Route path="live" element={<LiveRecord />} />
          <Route path="history" element={<History />} />
          <Route path="settings" element={<Settings />} />
          <Route path="about" element={<About />} />
        </Route>
      </Routes>
      <Toast />
    </HashRouter>
  )
}
