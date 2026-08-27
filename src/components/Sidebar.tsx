import { useEffect, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { ArrowDown, ArrowUp, Globe2, Moon, Sun } from 'lucide-react'
import { SUPPORTED_LOCALES } from '../constants/locales'
import { useTranslation } from '@/i18n'
import { useSettingsStore } from '@/store/settingsStore'
import { formatNetworkSpeed } from '@/utils/speed'
import { getStoredTheme, toggleTheme, type ThemeMode } from '@/utils/theme'

const navItems = [
  { path: '/', emoji: '📈', labelKey: 'nav.overview' },
  { path: '/history', emoji: '📜', labelKey: 'nav.history' },
  { path: '/settings', emoji: '🧰', labelKey: 'nav.settings' },
  { path: '/about', emoji: '🪐', labelKey: 'nav.about' }
]

const SPARK_SLOTS = 40

/** 下行速率趋势图（最近 40 秒）：3 点滑动平均去毛刺 + 平滑贝塞尔曲线 + 渐变面积 */
function Sparkline({ data }: { data: number[] }) {
  const w = 100
  const h = 30

  // 3 点滑动平均：抑制单秒毛刺，保留趋势
  const smoothed = data.map((_, i) => {
    const a = data[Math.max(0, i - 1)]
    const b = data[i]
    const c = data[Math.min(data.length - 1, i + 1)]
    return (a + b + c) / 3
  })

  const max = Math.max(...smoothed, 1) * 1.15 // 顶部预留空间，峰值不顶格
  const step = w / (SPARK_SLOTS - 1)
  const offset = (SPARK_SLOTS - smoothed.length) * step
  const pt = (i: number): [number, number] => [
    offset + i * step,
    h - 1.5 - (smoothed[i] / max) * (h - 4)
  ]

  if (smoothed.length < 2) return <div className="h-8 rounded-lg bg-slate-200/40 dark:bg-neutral-800/50" />

  // 平滑路径：二次贝塞尔以相邻中点为端点，控制点取数据点
  const pts = smoothed.map((_, i) => pt(i))
  let line = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`
  for (let i = 1; i < pts.length; i++) {
    const mid = [(pts[i - 1][0] + pts[i][0]) / 2, (pts[i - 1][1] + pts[i][1]) / 2]
    line += ` Q ${pts[i - 1][0].toFixed(1)} ${pts[i - 1][1].toFixed(1)}, ${mid[0].toFixed(1)} ${mid[1].toFixed(1)}`
  }
  line += ` L ${pts[pts.length - 1][0].toFixed(1)} ${pts[pts.length - 1][1].toFixed(1)}`
  const area = `${line} L ${w},${h} L ${offset.toFixed(1)},${h} Z`

  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-8 w-full">
      <defs>
        <linearGradient id="netSparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#netSparkFill)" stroke="none" />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export default function Sidebar() {
  const { t } = useTranslation()
  const { settings, updateSetting } = useSettingsStore()
  // 系统网络速度：主进程 netstat 网卡差分采样（真实网络吞吐，含所有程序）
  const [net, setNet] = useState<{ down: number; up: number } | null>(null)
  const [spark, setSpark] = useState<number[]>([])
  const downHistory = useRef<number[]>([])
  const [mode, setMode] = useState<ThemeMode>(getStoredTheme())

  useEffect(() => {
    return window.api.network.onStats((s) => {
      setNet(s)
      const buf = downHistory.current
      buf.push(s.down)
      if (buf.length > SPARK_SLOTS) buf.shift()
      setSpark([...buf])
    })
  }, [])

  const handleToggleTheme = () => setMode(toggleTheme())

  return (
    <aside className="flex h-full w-60 flex-col border-r border-slate-300 dark:border-white/10 bg-[linear-gradient(180deg,#e2e8f1_0%,#d5dce8_100%)] dark:bg-[linear-gradient(180deg,#0a0a0a_0%,#000000_100%)]">
      <div className="px-4 pb-4 pt-5">
        {/* 艺术字程序名 + 主题切换同行 */}
        <div className="flex items-center justify-between px-1">
          <div className="flex select-none items-baseline gap-1 whitespace-nowrap leading-none">
            <span className="pr-1.5 text-[24px] font-black italic tracking-tighter bg-gradient-to-br from-amber-300 via-orange-500 to-rose-600 bg-clip-text text-transparent drop-shadow-[0_2px_10px_rgba(249,115,22,0.3)]">
              m3u8
            </span>
            <span className="text-[15px] font-extrabold tracking-tight text-slate-700 dark:text-neutral-200">helper</span>
          </div>

          {/* 主题切换：单图标按钮 */}
          <button
            onClick={handleToggleTheme}
            title={mode === 'dark' ? t('common.theme.light') : t('common.theme.dark')}
            aria-label={mode === 'dark' ? t('common.theme.light') : t('common.theme.dark')}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200/80 bg-white/70 text-slate-500 shadow-sm transition hover:bg-slate-100 hover:text-slate-700 dark:border-neutral-700 dark:bg-neutral-800/80 dark:text-neutral-300 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
          >
            {mode === 'dark' ? <Sun size={15} className="text-amber-400" /> : <Moon size={15} className="text-indigo-500" />}
          </button>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-2.5 py-2">
        {navItems.map(({ path, emoji, labelKey }) => (
          <NavLink
            key={path}
            to={path}
            className={({ isActive }) =>
              `group flex items-center gap-3 rounded-xl border px-3 py-2.5 text-[13px] font-medium transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
                isActive
                  ? 'border-blue-100 bg-white text-blue-700 shadow-[0_6px_18px_rgba(59,130,246,0.10)] dark:border-blue-500/30 dark:bg-neutral-900 dark:text-blue-300'
                  : 'border-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:border-transparent dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span className="text-xl leading-none">{emoji}</span>
                <span className="flex-1">{t(labelKey)}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-slate-300 dark:border-white/10 p-4 pt-4">
        <div className="mb-4 rounded-2xl border border-slate-200/80 bg-slate-100/80 p-3 shadow-[0_8px_24px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-neutral-900/70 dark:shadow-[0_8px_20px_rgba(0,0,0,0.3)]">
          <div className="mb-3 flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-blue-600 shadow-inner dark:bg-blue-500/15 dark:text-blue-300">
              <Globe2 size={13} />
            </div>
            <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-neutral-400">
              {t('common.language')}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {SUPPORTED_LOCALES.map((locale) => {
              const active = settings.language === locale
              const label = t(`settings.languageOptions.${locale}`)

              return (
                <button
                  key={locale}
                  type="button"
                  onClick={() => updateSetting('language', locale)}
                  aria-pressed={active}
                  className={`rounded-xl border px-2.5 py-2 text-left transition-all duration-200 ${
                    active
                      ? 'border-blue-200 bg-white text-blue-700 shadow-[0_6px_16px_rgba(59,130,246,0.12)] dark:border-blue-500/30 dark:bg-neutral-800 dark:text-blue-300'
                      : 'border-transparent bg-slate-200/70 text-slate-500 hover:bg-slate-200 dark:bg-neutral-800/80 dark:text-neutral-400 dark:hover:bg-neutral-700/80'
                  }`}
                >
                  <div className="text-[12px] font-semibold leading-snug">{label}</div>
                </button>
              )
            })}
          </div>
        </div>

        {/* 网络速度：下行/上传分行 + 实时趋势图（系统网卡吞吐） */}
        <div className="rounded-2xl border border-slate-200/60 bg-white/50 p-3 dark:border-white/5 dark:bg-neutral-900/40">
          <div
            className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.14em] text-slate-400 dark:text-neutral-500"
            title={t('network.tooltip')}
          >
            <span className="text-xs leading-none">⚡</span>
            {t('network.label')}
          </div>

          <div className="mt-2.5 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <span className="flex h-4 w-4 items-center justify-center rounded bg-blue-100 dark:bg-blue-500/15">
                  <ArrowDown size={10} className="text-blue-600 dark:text-blue-400" />
                </span>
                <span className="text-[11px] font-semibold text-slate-600 dark:text-neutral-300">{t('network.download')}</span>
              </span>
              <span className="font-mono text-[13px] font-bold tabular-nums text-slate-800 dark:text-neutral-100">
                {net ? formatNetworkSpeed(net.down) : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <span className="flex h-4 w-4 items-center justify-center rounded bg-amber-100 dark:bg-amber-500/15">
                  <ArrowUp size={10} className="text-amber-600 dark:text-amber-400" />
                </span>
                <span className="text-[11px] font-medium text-slate-500 dark:text-neutral-400">{t('network.upload')}</span>
              </span>
              <span className="font-mono text-[11px] tabular-nums text-slate-500 dark:text-neutral-400">
                {net ? formatNetworkSpeed(net.up) : '—'}
              </span>
            </div>
          </div>

          {/* 下行速率趋势图 */}
          <div className="mt-2.5 text-blue-500 dark:text-blue-400">
            <Sparkline data={spark} />
          </div>
        </div>
      </div>
    </aside>
  )
}
