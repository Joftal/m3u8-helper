/* 系统网络速度监控（netstat 轮询差分）
 *
 * 原理：读取 netstat 输出的累计收发字节数（自开机起），
 * 每秒轮询一次并做差分 → 真实的系统网络吞吐（下行/上行）。
 *
 * 为什么不是"按进程"：实验证伪了 IO 计数器方案——
 * socket 收发落在 IO Write 桶（curl 2MB/s 下载时 Write=2007KB/s），
 * 与磁盘写入混合无法区分；IO Other 桶几乎不含网络。
 * 按进程的精确网络统计需要 ETW/管理员权限，超出无权限约束。
 * 因此本模块提供系统级真实网速；本应用为主要流量时≈程序网速。
 *
 * 解析健壮性：netstat 表头随系统语言本地化，
 * 但数据行是「标签 + 两个纯数字」结构，
 * 取累计值最大的一行（= 字节统计，自开机累计必然最大）即可，与语言无关。
 */
import { spawn } from 'child_process'
import { BrowserWindow } from 'electron'

export interface NetworkSample {
  /** 系统下行字节率 B/s */
  down: number
  /** 系统上行字节率 B/s */
  up: number
}

const POLL_INTERVAL = 1000
let timer: ReturnType<typeof setTimeout> | null = null
let stopping = false
let inFlight = false
let prev: { rx: number; tx: number; at: number } | null = null

function push(sample: NetworkSample): void {
  BrowserWindow.getAllWindows()[0]?.webContents.send('network:stats', sample)
}

/** Windows: 解析 netstat -e 输出，取「两个大整数」行中累计值最大的一组（= 字节数行） */
function parseWindowsNetstat(text: string): { rx: number; tx: number } | null {
  let best: { rx: number; tx: number } | null = null
  for (const m of text.matchAll(/(\d{6,})\s+(\d{6,})/g)) {
    const rx = Number(m[1])
    if (!best || rx > best.rx) best = { rx, tx: Number(m[2]) }
  }
  return best
}

/** macOS: 解析 netstat -ib 输出，按接口名去重后聚合 Ibytes/Obytes */
function parseDarwinNetstat(text: string): { rx: number; tx: number } | null {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0)
  let headerIndex = -1
  let iBytesIndex = -1
  let oBytesIndex = -1

  for (let i = 0; i < lines.length; i += 1) {
    const cols = lines[i].trim().split(/\s+/)
    const iIdx = cols.findIndex((item) => item.toLowerCase() === 'ibytes')
    const oIdx = cols.findIndex((item) => item.toLowerCase() === 'obytes')
    if (iIdx >= 0 && oIdx >= 0) {
      headerIndex = i
      iBytesIndex = iIdx
      oBytesIndex = oIdx
      break
    }
  }

  if (headerIndex < 0) return null

  const perInterface = new Map<string, { rx: number; tx: number }>()
  for (const line of lines.slice(headerIndex + 1)) {
    const cols = line.trim().split(/\s+/)
    const name = (cols[0] || '').trim()
    const iRaw = cols[iBytesIndex]
    const oRaw = cols[oBytesIndex]
    if (!name || !iRaw || !oRaw) continue
    const iValue = Number(iRaw.replace(/,/g, ''))
    const oValue = Number(oRaw.replace(/,/g, ''))
    if (!Number.isFinite(iValue) || !Number.isFinite(oValue)) continue
    const prev = perInterface.get(name)
    if (!prev) {
      perInterface.set(name, { rx: iValue, tx: oValue })
      continue
    }
    if (iValue > prev.rx || oValue > prev.tx) {
      perInterface.set(name, { rx: Math.max(prev.rx, iValue), tx: Math.max(prev.tx, oValue) })
    }
  }

  let rx = 0
  let tx = 0
  for (const value of perInterface.values()) {
    rx += value.rx
    tx += value.tx
  }

  if (rx <= 0 && tx <= 0) return null
  return { rx, tx }
}

function getSamplerConfig(): { command: string; args: string[]; parser: (text: string) => { rx: number; tx: number } | null } | null {
  if (process.platform === 'win32') {
    return { command: 'netstat', args: ['-e'], parser: parseWindowsNetstat }
  }
  if (process.platform === 'darwin') {
    return { command: 'netstat', args: ['-ib'], parser: parseDarwinNetstat }
  }
  return null
}

function sampleOnce(): void {
  if (stopping || inFlight) return
  const sampler = getSamplerConfig()
  if (!sampler) return
  inFlight = true
  try {
    const child = spawn(sampler.command, sampler.args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    // 看门狗：netstat 意外挂起时强杀，防止 inFlight 永久卡死轮询
    const hangGuard = setTimeout(() => {
      try {
        child.kill()
      } catch {}
    }, 3000)
    child.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString()
    })
    child.on('error', () => {
      clearTimeout(hangGuard)
      inFlight = false
    })
    child.on('close', () => {
      clearTimeout(hangGuard)
      inFlight = false
      if (stopping) return

      const cur = sampler.parser(out)
      if (!cur) return

      const now = Date.now()
      if (prev) {
        const sec = Math.max((now - prev.at) / 1000, 0.2)
        const down = Math.max(0, cur.rx - prev.rx) / sec
        const up = Math.max(0, cur.tx - prev.tx) / sec
        push({ down, up })
      }
      prev = { rx: cur.rx, tx: cur.tx, at: now }
    })
  } catch {
    inFlight = false
  }
}

function loop(): void {
  if (stopping) return
  sampleOnce()
  timer = setTimeout(loop, POLL_INTERVAL)
}

/** 启动监控（Windows/macOS 有效；幂等） */
export function startNetworkMonitor(): void {
  if (stopping || timer) return
  stopping = false
  prev = null
  if (!getSamplerConfig()) return
  loop()
}

/** 停止监控（应用退出时调用） */
export function stopNetworkMonitor(): void {
  stopping = true
  prev = null
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}
