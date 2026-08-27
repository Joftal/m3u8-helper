import { homedir, tmpdir } from 'os'
import { isAbsolute, join, normalize, parse, relative, resolve, sep } from 'path'

/**
 * 路径安全模块
 *
 * 为递归删除等破坏性文件操作提供统一的安全校验：
 * - 仅接受绝对路径
 * - 禁止盘根、深度不足的顶层目录
 * - 禁止系统关键目录及其任意子路径（Windows / Program Files / ProgramData）
 * - 禁止用户受保护目录本身或其上级目录（主目录、Desktop、Documents 等）
 * - 支持运行时注册额外保护路径（应用安装目录、数据存储目录等）
 */

export interface PathSafetyResult {
  ok: boolean
  path?: string
  reason?: string
}

export const PATH_SAFETY_REASON = {
  notAbsolute: 'path.notAbsolute',
  rootDenied: 'path.rootDenied',
  shallowDepthDenied: 'path.shallowDepthDenied',
  criticalDirDenied: 'path.criticalDirDenied',
  protectedDirDenied: 'path.protectedDirDenied'
} as const

/** 系统关键目录：自身及任何子路径都不允许作为递归删除目标 */
const criticalExtra = new Set<string>()

/** 用户保护目录：仅禁止“该目录本身或其更上层”被整体删除，其内部的任务产物仍可清理 */
const userProtectedExtra = new Set<string>()

let criticalCache: string[] | null = null
let userProtectedCache: string[] | null = null

function toLower(p: string): string {
  return p.toLowerCase()
}

function normalizeAbsolute(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null

  let expanded = trimmed
  if (trimmed === '~' || trimmed.startsWith(`~${sep}`) || trimmed.startsWith('~/')) {
    expanded = join(homedir(), trimmed.slice(1))
  }

  if (!isAbsolute(expanded)) return null

  let normalized = normalize(resolve(expanded))
  const root = parse(normalized).root
  if (normalized.endsWith(sep) && normalized !== root) {
    normalized = normalized.slice(0, -1)
  }
  return normalized
}

function isWithinOrEqual(childLower: string, ancestorLower: string): boolean {
  if (childLower === ancestorLower) return true
  const rel = relative(ancestorLower, childLower)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

function getCriticalPaths(): string[] {
  if (criticalCache) return criticalCache
  const candidates = [
    process.env.windir,
    process.env.SystemRoot,
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.ProgramData
  ]
  criticalCache = candidates
    .map((value) => normalizeAbsolute(value))
    .filter((value): value is string => Boolean(value))
    .map(toLower)
  return criticalCache
}

function getUserProtectedPaths(): string[] {
  if (userProtectedCache) return userProtectedCache
  const home = homedir()
  const candidates = [
    home,
    join(home, 'Desktop'),
    join(home, 'Documents'),
    join(home, 'Downloads'),
    join(home, 'Pictures'),
    join(home, 'Music'),
    join(home, 'Videos'),
    join(home, 'AppData'),
    process.env.APPDATA,
    process.env.LOCALAPPDATA,
    tmpdir(),
    process.cwd(),
    dirnameOfExec()
  ]
  const normalized = candidates
    .map((value) => normalizeAbsolute(value))
    .filter((value): value is string => Boolean(value))
    .map(toLower)

  for (const value of criticalExtra) {
    const normalizedExtra = normalizeAbsolute(value)
    if (normalizedExtra) normalized.push(toLower(normalizedExtra))
  }
  for (const value of userProtectedExtra) {
    const normalizedExtra = normalizeAbsolute(value)
    if (normalizedExtra) normalized.push(toLower(normalizedExtra))
  }

  userProtectedCache = Array.from(new Set(normalized))
  return userProtectedCache
}

function dirnameOfExec(): string {
  const index = process.execPath.lastIndexOf(sep)
  return index > 0 ? process.execPath.slice(0, index) : process.execPath
}

/**
 * 注册额外的保护路径（如应用数据目录）。
 * 注册后该目录本身或其任何上级目录不允许被整体删除。
 */
export function registerProtectedPath(raw: string): void {
  const normalized = normalizeAbsolute(raw)
  if (!normalized) return
  userProtectedExtra.add(normalized)
  userProtectedCache = null
}

/**
 * 校验一个路径是否允许作为递归删除目标。
 */
export function isAllowedRecursiveDeleteTarget(raw: unknown): PathSafetyResult {
  const normalized = normalizeAbsolute(raw)
  if (!normalized) {
    return { ok: false, reason: PATH_SAFETY_REASON.notAbsolute }
  }

  const targetLower = toLower(normalized)
  const rootLower = toLower(parse(normalized).root)

  if (targetLower === rootLower) {
    return { ok: false, path: normalized, reason: PATH_SAFETY_REASON.rootDenied }
  }

  const relFromRoot = relative(parse(normalized).root, normalized)
  const depth = relFromRoot.split(sep).filter(Boolean).length
  if (depth < 2) {
    return { ok: false, path: normalized, reason: PATH_SAFETY_REASON.shallowDepthDenied }
  }

  for (const critical of getCriticalPaths()) {
    if (isWithinOrEqual(targetLower, critical)) {
      return { ok: false, path: normalized, reason: PATH_SAFETY_REASON.criticalDirDenied }
    }
  }

  for (const protectedPath of getUserProtectedPaths()) {
    if (isWithinOrEqual(protectedPath, targetLower)) {
      return { ok: false, path: normalized, reason: PATH_SAFETY_REASON.protectedDirDenied }
    }
  }

  return { ok: true, path: normalized }
}
