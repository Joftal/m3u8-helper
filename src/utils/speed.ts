/**
 * 网络速度格式化与解析的唯一实现。
 * 主进程与渲染进程各自维护字符串速度显示；此模块供渲染端汇总/解析使用。
 */

/** 将字节速率格式化为可读速度字符串（自动升位，保留 1-2 位小数） */
export function formatNetworkSpeed(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '0 KB/s'

  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  let value = bytesPerSecond
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  const precision = value >= 10 ? 1 : 2
  return `${value.toFixed(precision)} ${units[unitIndex]}`
}


