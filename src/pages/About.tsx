import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Github, ExternalLink, Heart } from 'lucide-react'

export default function About() {
  const [version, setVersion] = useState('')

  useEffect(() => {
    window.api.app.getVersion().then(setVersion).catch(() => {})
  }, [])

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="page-header">
        <div>
          <div className="page-kicker">About</div>
          <h1 className="page-title">关于应用</h1>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="card p-8 text-center"
      >
        <img src={new URL('../assets/icon.png', import.meta.url).href} alt="m3u8-helper" className="mx-auto mb-5 h-16 w-16 rounded-2xl object-cover shadow-sm" />

        <h2 className="mb-1 text-2xl font-bold tracking-tight text-slate-900">m3u8-helper</h2>
        <p className="mb-6 text-sm text-slate-400">{version ? `v${version}` : ''}</p>

        <p className="mx-auto mb-8 max-w-md text-sm leading-relaxed text-slate-600">
          基于 N_m3u8DL-RE 的流媒体下载工具箱。支持 HLS/DASH/MSS 流媒体下载，
          提供简洁的图形界面。
        </p>

        <div className="mb-8 flex items-center justify-center gap-3">
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

        <div className="border-t border-slate-200 pt-5">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">技术栈</h3>
          <div className="flex flex-wrap justify-center gap-1.5">
            {['Electron', 'React', 'TypeScript', 'Tailwind CSS', 'Zustand', 'Vite'].map((tech) => (
              <span key={tech} className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">{tech}</span>
            ))}
          </div>
        </div>

        <div className="mt-5 border-t border-slate-200 pt-5">
          <p className="flex items-center justify-center gap-1 text-xs text-slate-400">
            Made with <Heart size={11} className="text-red-400" /> by m3u8-helper
          </p>
        </div>
      </motion.div>
    </div>
  )
}
