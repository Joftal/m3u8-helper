import { useEffect, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { Github, ExternalLink } from 'lucide-react'

const TECH_STACK = ['Electron', 'React 19', 'TypeScript', 'Tailwind CSS', 'Zustand', 'Framer Motion', 'Vite']

const FEATURES = ['HLS / DASH / MSS 下载', '直播实时录制', '批量任务队列', '定时计划任务']

const AUTHOR = {
  name: 'Joftal',
  profile: 'https://github.com/Joftal',
  avatar: 'https://avatars.githubusercontent.com/u/42807405?v=4',
  repo: 'https://github.com/Joftal/m3u8-helper'
}

export default function About() {
  const [version, setVersion] = useState('')

  useEffect(() => {
    window.api.app.getVersion().then(setVersion).catch(() => {})
  }, [])

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-2 py-4">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className="w-full max-w-2xl space-y-4">
        {/* 身份区：无底色，靠图标与字重建立层次 */}
        <div className="flex items-center gap-4">
          <img
            src={new URL('../assets/icon.png', import.meta.url).href}
            alt="m3u8-helper"
            className="h-16 w-16 shrink-0 rounded-2xl object-cover shadow-md ring-1 ring-slate-200 dark:ring-neutral-700"
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-neutral-50">m3u8-helper</h2>
              <span className="inline-flex items-center rounded-full border border-slate-200 dark:border-neutral-800 bg-slate-50 dark:bg-neutral-800/60 px-2 py-0.5 font-mono text-xs font-medium text-slate-500 dark:text-neutral-400">
                {version ? `v${version}` : 'v—'}
              </span>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-slate-500 dark:text-neutral-400">
              基于 N_m3u8DL-RE 的流媒体下载工具箱，为命令行引擎提供完整的图形化操作界面。
            </p>
          </div>
        </div>

        {/* 特性一览 */}
        <div className="flex flex-wrap gap-1.5">
          {FEATURES.map((feature) => (
            <span key={feature} className="rounded-full border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-2.5 py-1 text-xs font-medium text-slate-500 dark:text-neutral-400">
              {feature}
            </span>
          ))}
        </div>

        {/* 应用信息 */}
        <div className="card p-5">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-neutral-400">应用信息</h3>
          <dl className="divide-y divide-slate-100 dark:divide-neutral-800">
            {([
              ['当前版本', version ? `v${version}` : '—'],
              ['项目仓库',
                <a
                  key="repo"
                  href={AUTHOR.repo}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-blue-500 dark:text-blue-400 transition hover:underline"
                >
                  Joftal/m3u8-helper
                  <ExternalLink size={12} />
                </a>],
              ['核心引擎', 'N_m3u8DL-RE'],
              ['界面框架', 'Electron · React 19'],
              ['开源许可', 'MIT License']
            ] as Array<[string, ReactNode]>).map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
                <dt className="shrink-0 text-[13px] text-slate-500 dark:text-neutral-400">{label}</dt>
                <dd className="min-w-0 truncate text-right text-[13px] font-medium text-slate-700 dark:text-neutral-200">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 border-t border-slate-100 dark:border-white/5 pt-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-neutral-400">技术栈</div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-slate-600 dark:text-neutral-300">{TECH_STACK.join(' · ')}</p>
          </div>
        </div>

        {/* 项目作者 */}
        <div className="card flex items-center gap-3.5 p-4">
          <img
            src={AUTHOR.avatar}
            alt={AUTHOR.name}
            className="h-11 w-11 shrink-0 rounded-full bg-slate-100 dark:bg-neutral-800 object-cover ring-1 ring-slate-200 dark:ring-neutral-700"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold text-slate-800 dark:text-neutral-100">{AUTHOR.name}</span>
              <span className="shrink-0 rounded-md bg-slate-100 dark:bg-neutral-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:text-neutral-400">项目作者</span>
            </div>
            <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-neutral-400">{AUTHOR.profile}</p>
          </div>
          <a
            href={AUTHOR.profile}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-xs"
          >
            <Github size={13} />
            GitHub 主页
            <ExternalLink size={12} />
          </a>
        </div>

        {/* 核心引擎致谢 */}
        <div className="card p-5">
          <div className="flex items-start gap-3">
            <span className="text-3xl leading-none">⚛️</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-semibold text-slate-800 dark:text-neutral-100">N_m3u8DL-RE</span>
                <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 dark:text-neutral-500">CLI</span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-neutral-400">
                nilaoda 开发的命令行流媒体下载程序。本应用的下载、解密与录制能力均由其提供。
              </p>
            </div>
          </div>
          <a
            href="https://github.com/nilaoda/N_m3u8DL-RE"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3.5 py-2 text-sm font-medium text-slate-600 dark:text-neutral-300 transition hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-50 dark:hover:bg-neutral-800/60"
          >
            <Github size={15} />
            访问 GitHub 仓库
            <ExternalLink size={13} />
          </a>
        </div>

        <p className="pt-1 text-center text-xs text-slate-500 dark:text-neutral-400">
          MIT License · © {new Date().getFullYear()} {AUTHOR.name} · m3u8-helper
        </p>
      </motion.div>
    </div>
  )
}
