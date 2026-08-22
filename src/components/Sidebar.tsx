import { NavLink } from 'react-router-dom'
import {
  Home,
  Layers,
  Radio,
  Clock,
  Settings,
  Info
} from 'lucide-react'

const navItems = [
  { path: '/', icon: Home, label: '首页' },
  { path: '/batch', icon: Layers, label: '批量下载' },
  { path: '/live', icon: Radio, label: '直播录制' },
  { path: '/history', icon: Clock, label: '下载历史' },
  { path: '/settings', icon: Settings, label: '设置' },
  { path: '/about', icon: Info, label: '关于' }
]

export default function Sidebar() {
  return (
    <aside className="w-52 h-full bg-white border-r border-gray-100 flex flex-col">
      <nav className="flex-1 py-3 px-2.5 space-y-0.5">
        {navItems.map(({ path, icon: Icon, label }) => (
          <NavLink
            key={path}
            to={path}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-150 ${
                isActive
                  ? 'bg-primary-50 text-primary-700'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-150 ${
                  isActive
                    ? 'bg-primary-100 text-primary-600'
                    : 'bg-gray-50 text-gray-400 group-hover:text-gray-500'
                }`}>
                  <Icon size={17} />
                </div>
                <span>{label}</span>
                {isActive && (
                  <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary-500" />
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="p-4 border-t border-gray-100">
        <p className="text-[11px] text-gray-400 text-center">
          v1.0.0 · m3u8-box
        </p>
      </div>
    </aside>
  )
}
