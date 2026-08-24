import { Outlet } from 'react-router-dom'
import TitleBar from './TitleBar'
import Sidebar from './Sidebar'

export default function Layout() {
  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[radial-gradient(circle_at_top,_#f9fbff_0%,_#edf4ff_28%,_#edf2f8_100%)] text-slate-900">
      <TitleBar />
      <div className="flex-1 flex overflow-hidden px-2.5 pb-2.5 pt-1.5">
        <div className="flex w-full overflow-hidden rounded-[22px] border border-slate-200/80 bg-white/90 shadow-[0_16px_32px_rgba(15,23,42,0.07)] backdrop-blur-sm">
          <Sidebar />
          <main className="flex-1 overflow-y-auto bg-transparent p-6">
            <div className="mx-auto max-w-6xl">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}
