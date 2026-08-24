import { useEffect } from 'react'
import { HashRouter, Routes, Route } from 'react-router-dom'
import Layout from '@/components/Layout'
import Toast from '@/components/Toast'
import Home from '@/pages/Home'
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

  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="history" element={<History />} />
          <Route path="settings" element={<Settings />} />
          <Route path="about" element={<About />} />
        </Route>
      </Routes>
      <Toast />
    </HashRouter>
  )
}
