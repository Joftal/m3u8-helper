import { motion } from 'framer-motion'
import DownloadForm from '@/features/download/DownloadForm'

export default function Home() {
  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-xl font-bold text-gray-900">快速下载</h1>
        <p className="text-sm text-gray-500 mt-1">粘贴 m3u8 / mpd / ism 链接，一键下载视频</p>
      </motion.div>
      <DownloadForm />
    </div>
  )
}
