import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react'

interface ToastItem {
  id: string
  type: 'success' | 'error' | 'info' | 'warning'
  message: string
}

let toastListeners: Array<(toast: ToastItem) => void> = []

export function showToast(type: ToastItem['type'], message: string) {
  const toast: ToastItem = { id: Date.now().toString(), type, message }
  toastListeners.forEach((fn) => fn(toast))
}

export default function Toast() {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  useEffect(() => {
    const handler = (toast: ToastItem) => {
      setToasts((prev) => [...prev, toast])
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toast.id))
      }, 3500)
    }
    toastListeners.push(handler)
    return () => { toastListeners = toastListeners.filter((fn) => fn !== handler) }
  }, [])

  const icons = {
    success: <CheckCircle size={16} className="text-emerald-500 dark:text-emerald-400" />,
    error: <AlertCircle size={16} className="text-red-500 dark:text-red-400" />,
    info: <Info size={16} className="text-primary-500 dark:text-primary-400" />,
    warning: <AlertTriangle size={16} className="text-amber-500 dark:text-amber-400" />
  }

  return (
    <div className="fixed left-1/2 top-14 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: -12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.97 }}
            className="bg-white dark:bg-neutral-900 px-4 py-3 rounded-lg border border-gray-100 dark:border-gray-700/60 flex items-center gap-3 min-w-[260px] max-w-[420px]"
            style={{ boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
          >
            {icons[toast.type]}
            <span className="text-sm text-gray-700 dark:text-gray-200 flex-1">{toast.message}</span>
            <button
              onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
              className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              <X size={14} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
