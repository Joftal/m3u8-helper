/* 系统网络速度监控（netstat -e 轮询差分）
 *
 * 原理：netstat -e 输出网卡的累计收发字节数（自开机起），
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
  BrowserWindowAll()[0]?.webContents.send('network:stats', sample)
}

function BrowserWindowAll(): import('electron').BrowserWindow[] {
  return (require('electron') as typeof import('electron')).BrowserWindow.getAllWindows()
}

/** 解析 netstat -e 输出：取「两个大整数」行中累计值最大的一组（= 字节数行） */
function parseNetstat(text: string): { rx: number; tx: number } | null {
  let best: { rx: number; tx: number } | null = null
  for (const m of text.matchAll(/(\d{6,})\s+(\d{6,})/g)) {
    const rx = Number(m[1])
    if (!best || rx > best.rx) best = { rx, tx: Number(m[2]) }
  }
  return best
}

function sampleOnce(): void {
  if (stopping || inFlight) return
  inFlight = true
  try {
    const child = spawn('netstat', ['-e'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
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

      const cur = parseNetstat(out)
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

/** 启动监控（仅 Windows 有效；幂等） */
export function startNetworkMonitor(): void {
  if (stopping || timer) return
  stopping = false
  if (process.platform !== 'win32') return
  loop()
}

/** 停止监控（应用退出时调用） */
export function stopNetworkMonitor(): void {
  stopping = true
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}
