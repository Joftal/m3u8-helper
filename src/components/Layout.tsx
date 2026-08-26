import { Outlet } from 'react-router-dom'
import TitleBar from './TitleBar'
import Sidebar from './Sidebar'

export default function Layout() {
  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[radial-gradient(circle_at_top,_#e9edf3_0%,_#dfe5ed_30%,_#d8dee8_100%)] dark:bg-[radial-gradient(circle_at_top,_#0a0a0a_0%,_#000000_45%,_#030303_100%)] text-slate-900 dark:text-neutral-50">
      <TitleBar />
      <div className="flex-1 flex overflow-hidden px-2.5 pb-2.5 pt-1.5">
        <div className="flex w-full overflow-hidden rounded-[22px] border border-slate-200/80 dark:border-white/5 bg-[#f4f6fa]/90 dark:bg-black/60 shadow-[0_16px_32px_rgba(15,23,42,0.07)] backdrop-blur-sm">
          <Sidebar />
          <main className="flex-1 overflow-y-auto bg-transparent p-6">
            <div className="mx-auto flex min-h-full max-w-6xl flex-col">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}
