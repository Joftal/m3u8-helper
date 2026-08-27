import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(process.cwd())
const resourcesDir = join(root, 'resources')
const sourcePng = join(resourcesDir, 'icon.png')
const targetIcns = join(resourcesDir, 'icon.icns')
const iconsetDir = join(resourcesDir, 'icon.iconset')

function run(cmd, args) {
  execFileSync(cmd, args, { stdio: 'inherit' })
}

if (process.platform !== 'darwin') {
  console.log('[ensure-macos-icon] skip: current platform is not macOS.')
  process.exit(0)
}

if (!existsSync(sourcePng)) {
  console.error(`[ensure-macos-icon] source icon not found: ${sourcePng}`)
  process.exit(1)
}

if (existsSync(targetIcns)) {
  const sourceMtime = statSync(sourcePng).mtimeMs
  const targetMtime = statSync(targetIcns).mtimeMs
  if (targetMtime >= sourceMtime) {
    console.log('[ensure-macos-icon] icon.icns is up-to-date.')
    process.exit(0)
  }
}

rmSync(iconsetDir, { recursive: true, force: true })
mkdirSync(iconsetDir, { recursive: true })

const sizes = [16, 32, 128, 256, 512]
for (const size of sizes) {
  run('sips', ['-z', String(size), String(size), sourcePng, '--out', join(iconsetDir, `icon_${size}x${size}.png`)])
  run('sips', ['-z', String(size * 2), String(size * 2), sourcePng, '--out', join(iconsetDir, `icon_${size}x${size}@2x.png`)])
}

run('iconutil', ['-c', 'icns', iconsetDir, '-o', targetIcns])
rmSync(iconsetDir, { recursive: true, force: true })

console.log('[ensure-macos-icon] generated resources/icon.icns')
