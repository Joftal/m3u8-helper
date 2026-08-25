import { NavLink } from 'react-router-dom'
import {
  Home,
  Settings,
  Info,
  Gauge,
  Clock
} from 'lucide-react'
import { useDownloadStore } from '@/store/downloadStore'
import { formatNetworkSpeed, parseSpeedToBytesPerSecond } from '@/utils/speed'
import { isRecordTask } from '@/utils/recording'

const navItems = [
  { path: '/', icon: Home, label: '任务总览' },
  { path: '/history', icon: Clock, label: '任务记录' },
  { path: '/settings', icon: Settings, label: '应用设置' },
  { path: '/about', icon: Info, label: '关于应用' }
]

export default function Sidebar() {
  const { tasks } = useDownloadStore()
  const helperNetworkSpeed = (() => {
    const activeRunningTasks = tasks.filter((task) => task.status === 'running' || task.status === 'pending')
    const totalBytesPerSecond = activeRunningTasks.reduce((sum, task) => sum + parseSpeedToBytesPerSecond(task.speed || '0 KB/s'), 0)
    return formatNetworkSpeed(totalBytesPerSecond)
  })()

  // 全局录制指示：录制任务被过滤在下载列表之外，离开录制 Tab 后用户仍需感知其存活
  const activeRecordCount = tasks.filter((task) =>
    (task.status === 'running' || task.status === 'pending') && isRecordTask(task)).length

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

      {activeRecordCount > 0 && (
        <div className="mx-2.5 mb-2 flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2">
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
          </span>
          <span className="text-[12px] font-medium text-red-600">
            录制中{activeRecordCount > 1 ? ` ×${activeRecordCount}` : ''}
          </span>
        </div>
      )}

      <div className="border-t border-slate-200/80 p-4">
        <div className="rounded-2xl border border-slate-200 bg-white/90 p-3 shadow-sm">
          <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.14em] text-slate-400">
            <Gauge size={12} />
            网络速度
          </div>
          <div className="mt-2 text-lg font-bold tracking-tight text-slate-800">{helperNetworkSpeed}</div>
        </div>
      </div>
    </aside>
  )
}
