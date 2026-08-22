import { motion } from 'framer-motion'
import { Github, ExternalLink, Heart } from 'lucide-react'

export default function About() {
  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-xl font-bold text-gray-900">关于</h1>
        <p className="text-sm text-gray-500 mt-1">M3U8 Downloader 信息</p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="card p-8 text-center"
      >
        <img src={new URL('../assets/icon.png', import.meta.url).href} alt="m3u8-box" className="w-16 h-16 mx-auto mb-5 rounded-2xl object-cover" />

        <h2 className="text-xl font-bold text-gray-900 mb-1">m3u8-box</h2>
        <p className="text-sm text-gray-400 mb-6">v1.0.0</p>

        <p className="text-gray-500 max-w-md mx-auto mb-8 text-sm leading-relaxed">
          基于 N_m3u8DL-RE 的流媒体下载工具箱。支持 HLS/DASH/MSS 流媒体下载，
          提供简洁的图形界面。
        </p>

        <div className="flex items-center justify-center gap-3 mb-8">
          <a
            href="https://github.com/nilaoda/N_m3u8DL-RE"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary flex items-center gap-2 text-sm"
          >
            <Github size={15} />
            N_m3u8DL-RE
            <ExternalLink size={13} />
          </a>
        </div>

        <div className="border-t border-gray-100 pt-5">
          <h3 className="text-xs font-semibold text-gray-500 mb-3 uppercase tracking-wider">技术栈</h3>
          <div className="flex flex-wrap justify-center gap-1.5">
            {['Electron', 'React', 'TypeScript', 'Tailwind CSS', 'Zustand', 'Vite'].map((tech) => (
              <span key={tech} className="px-2.5 py-1 rounded-md text-xs font-medium bg-gray-50 text-gray-600 border border-gray-100">{tech}</span>
            ))}
          </div>
        </div>

        <div className="border-t border-gray-100 pt-5 mt-5">
          <p className="text-xs text-gray-400 flex items-center justify-center gap-1">
            Made with <Heart size={11} className="text-red-400" /> by m3u8-box
          </p>
        </div>
      </motion.div>
    </div>
  )
}
