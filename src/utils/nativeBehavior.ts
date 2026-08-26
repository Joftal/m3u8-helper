/**
 * 原生窗口行为约束：屏蔽 Chromium 默认的浏览器交互，
 * 使应用表现接近普通 exe 程序。
 * 文本输入框（input / textarea / contentEditable）内保留
 * 选择、右键菜单与快捷键，保证正常录入体验。
 */

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable
  )
}

export function applyNativeWindowBehavior(): void {
  // 阻止元素原生拖拽（图片、链接、选中文字拖动）
  document.addEventListener('dragstart', (event) => event.preventDefault())

  // 阻止外部文件/内容拖入窗口触发导航或打开
  const blockDropNavigation = (event: DragEvent) => event.preventDefault()
  document.addEventListener('dragover', blockDropNavigation)
  document.addEventListener('drop', blockDropNavigation)

  // 右键菜单仅在文本输入框内保留，其余位置禁用
  document.addEventListener('contextmenu', (event) => {
    if (!isEditableTarget(event.target)) event.preventDefault()
  })

  // 中键自动滚动光标
  document.addEventListener(
    'mousedown',
    (event) => {
      if (event.button === 1) event.preventDefault()
    },
    true
  )

  // Ctrl+滚轮页面缩放
  document.addEventListener(
    'wheel',
    (event) => {
      if (event.ctrlKey) event.preventDefault()
    },
    { passive: false }
  )

  // 触控板捏合缩放手势
  document.addEventListener('gesturestart', (event) => event.preventDefault())

  // 浏览器专属快捷键：查找 / 打印 / 另存为 / 查看源码（输入框内不拦截）
  document.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey)) return
    if (isEditableTarget(event.target)) return
    const key = event.key.toLowerCase()
    if (key === 'f' || key === 'p' || key === 's' || key === 'u') {
      event.preventDefault()
    }
  })
}
