import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { applyTheme, getStoredTheme } from './utils/theme'
import { applyNativeWindowBehavior } from './utils/nativeBehavior'
import './index.css'

// 渲染前应用持久化主题，避免首帧闪白/闪黑
applyTheme(getStoredTheme())

// 屏蔽浏览器默认交互（选中、拖拽、右键、缩放等），贴近原生 exe 表现
applyNativeWindowBehavior()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
