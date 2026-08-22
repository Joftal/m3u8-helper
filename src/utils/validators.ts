/**
 * 验证 URL 是否有效
 */
export function isValidUrl(url: string): boolean {
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

/**
 * 验证是否为 m3u8/HLS/DASH 链接
 */
export function isMediaUrl(url: string): boolean {
  const patterns = [
    /\.m3u8(\?.*)?$/i,
    /\.mpd(\?.*)?$/i,
    /\.ism\/manifest(\?.*)?$/i,
    /\/manifest(\?.*)?$/i
  ]
  return patterns.some((p) => p.test(url))
}

/**
 * 验证文件路径格式
 */
export function isValidPath(path: string): boolean {
  if (!path) return false
  // Windows 路径
  return /^[a-zA-Z]:\\|^\/|^~\//.test(path)
}
