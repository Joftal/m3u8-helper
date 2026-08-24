import { NavLink } from 'react-router-dom'
import {
  Home,
  Clock,
  Settings,
  Info
} from 'lucide-react'
import { useDownloadStore } from '@/store/downloadStore'
import { useHistoryStore } from '@/store/historyStore'

const navItems = [
  { path: '/', icon: Home, label: '任务总览' },
  { path: '/history', icon: Clock, label: '任务记录' },
  { path: '/settings', icon: Settings, label: '应用设置' },
  { path: '/about', icon: Info, label: '关于应用' }
]

export default function Sidebar() {
  const { tasks } = useDownloadStore()
  const { records } = useHistoryStore()

  const activeCount = tasks.filter((task) => task.status === 'running' || task.status === 'pending').length
  const completedCount = tasks.filter((task) => task.status === 'completed').length + records.filter((record) => record.status === 'completed').length
  const totalCount = tasks.length

  return (
    <aside className="flex h-full w-60 flex-col border-r border-slate-200/80 bg-[linear-gradient(180deg,#f8fafc_0%,#eef4ff_100%)]">
      <div className="px-4 pb-3 pt-4">
        <div className="px-2 py-2 text-[11px] font-bold tracking-[0.18em] text-slate-400 uppercase">导航</div>
      </div>

      <nav className="flex-1 space-y-1 px-2.5 py-2">
        {navItems.map(({ path, icon: Icon, label }) => (
          <NavLink
            key={path}
            to={path}
            className={({ isActive }) =>
              `group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-all duration-150 ${
                isActive
                  ? 'border border-blue-100 bg-white text-blue-700 shadow-[0_6px_18px_rgba(59,130,246,0.10)]'
                  : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <div className={`flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-150 ${
                  isActive ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-400 group-hover:text-slate-500'
                }`}>
                  <Icon size={16} />
                </div>
                <span className="flex-1">{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="m-4 rounded-2xl border border-slate-200 bg-white/80 p-3.5 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">运行状态</p>
        <div className="space-y-2 text-[12px] text-slate-600">
          <div className="flex items-center justify-between"><span>当前任务</span><strong className="text-slate-900">{totalCount}</strong></div>
          <div className="flex items-center justify-between"><span>进行中</span><strong className="text-slate-900">{activeCount}</strong></div>
          <div className="flex items-center justify-between"><span>已完成</span><strong className="text-slate-900">{completedCount}</strong></div>
        </div>
      </div>

      <div className="border-t border-slate-200/80 p-4">
        <p className="text-center text-[11px] text-slate-400">v1.0.0 · m3u8-box</p>
      </div>
    </aside>
  )
}
