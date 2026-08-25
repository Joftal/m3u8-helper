import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Settings, FolderOpen, Cpu, Film, Globe, Save, Zap, Type, Key, Filter, RotateCcw } from 'lucide-react'
import { useSettingsStore } from '@/store/settingsStore'
import Modal from '@/components/Modal'
import { showToast } from '@/components/Toast'
import { validateSettingValue } from '@/utils/validators'

interface DraftFieldProps {
  value: string
  onCommit: (value: string) => void
  placeholder?: string
  className?: string
  type?: string
}

/** 草稿式输入：输入过程零校验，失焦或回车时提交；修复受控输入每次击键被 trim/校验导致丢字的问题 */
function DraftField({ value, onCommit, placeholder, className, type = 'text' }: DraftFieldProps) {
  const [draft, setDraft] = useState(value)
  const draftRef = useRef(draft)
  const valueRef = useRef(value)
  const commitRef = useRef(onCommit)
  draftRef.current = draft
  valueRef.current = value
  commitRef.current = onCommit

  useEffect(() => {
    setDraft(value)
  }, [value])

  // 卸载前提交未保存的草稿，避免输入后未失焦直接离开页面导致内容丢失
  useEffect(() => {
    return () => {
      if (draftRef.current !== valueRef.current) {
        commitRef.current(draftRef.current)
      }
    }
  }, [])

  return (
    <input
      type={type}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
      className={className}
    />
  )
}

function serializeHeaders(headers: Record<string, string> | undefined): string {
  return JSON.stringify(headers ?? {}, null, 2)
}

/** 草稿式请求头编辑器：编辑过程完全自由，失焦时校验入库；解析失败红字提示且保留内容 */
function HeadersEditor({ value, onCommit }: { value: Record<string, string>; onCommit: (next: Record<string, string>) => void }) {
  const [draft, setDraft] = useState(() => serializeHeaders(value))
  const [error, setError] = useState('')
  const draftRef = useRef(draft)
  const valueRef = useRef(value)
  const commitRef = useRef(onCommit)
  draftRef.current = draft
  valueRef.current = value
  commitRef.current = onCommit

  useEffect(() => {
    setDraft(serializeHeaders(value))
    setError('')
  }, [value])

  // 卸载前尝试提交合法的未保存 JSON；非法内容不强制入库
  useEffect(() => {
    return () => {
      if (draftRef.current === serializeHeaders(valueRef.current)) return
      try {
        const parsed = JSON.parse(draftRef.current)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          commitRef.current(parsed)
        }
      } catch {}
    }
  }, [])

  return (
    <div>
      <textarea
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value)
          if (error) setError('')
        }}
        onBlur={() => {
          if (draft === serializeHeaders(value)) {
            setError('')
            return
          }
          try {
            const parsed = JSON.parse(draft)
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
              setError('必须是 JSON 对象（键值对），尚未保存')
              return
            }
            setError('')
            onCommit(parsed)
          } catch {
            setError('JSON 格式错误，尚未保存')
          }
        }}
        placeholder='{"Cookie": "xxx", "User-Agent": "xxx"}'
        className="input-field h-20 resize-none font-mono text-xs"
      />
      {error && <p className="mt-1 text-[11px] text-red-500">{error}</p>}
    </div>
  )
}

export default function SettingsPage() {
  const { settings, loaded, loadSettings, updateSetting, resetSettings } = useSettingsStore()
  const [adKeywordInput, setAdKeywordInput] = useState('')
  const [showResetConfirm, setShowResetConfirm] = useState(false)

  useEffect(() => {
    if (!loaded) loadSettings()
  }, [loaded])

  useEffect(() => {
    setAdKeywordInput((settings.adKeywords || []).join('\n'))
  }, [settings.adKeywords])

  const handleSelectDir = async (field: string) => {
    const isFile = ['ffmpegPath', 'mp4decryptPath', 'exePath', 'logFilePath', 'keyTextFile'].includes(field)
    const path = isFile ? await window.api.dialog.openFile() : await window.api.dialog.openDir()
    if (path) { await updateSetting(field as any, path); showToast('success', '路径已更新') }
  }

  const Section = ({ icon, color, title, children, delay = 0 }: any) => (
    <motion.section initial={false} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.18 }} className="settings-panel p-5">
      <div className="settings-section-header">
        <div className="settings-section-title">
          <div className={`settings-icon-wrap ${color}`}>{icon}</div>
          <span>{title}</span>
        </div>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">配置</span>
      </div>
      {children}
    </motion.section>
  )

  const commitField = (field: keyof typeof settings, value: string) => {
    const result = validateSettingValue(field as string, value)
    if (!result.valid) {
      showToast('error', result.message || '参数值非法')
      return
    }
    updateSetting(field as any, result.value as any)
  }

  const PathField = ({ label, field, placeholder }: any) => (
    <div>
      <label className="mb-1 block text-xs text-slate-500">{label}</label>
      <div className="flex gap-2">
        <DraftField
          value={(settings as any)[field] ?? ''}
          onCommit={(v) => commitField(field, v)}
          placeholder={placeholder}
          className="input-field flex-1 text-sm"
        />
        <button onClick={() => handleSelectDir(field)} className="btn-secondary px-3"><FolderOpen size={14} /></button>
      </div>
    </div>
  )

  return (
    <div className="space-y-6">
      <motion.div initial={false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }} className="page-header">
        <div>
          <div className="page-kicker">Settings</div>
          <h1 className="page-title">应用设置</h1>
        </div>
        <button
          onClick={() => setShowResetConfirm(true)}
          className="btn-secondary px-3.5 text-sm"
        >
          恢复默认
        </button>
      </motion.div>

      <Modal open={showResetConfirm} onClose={() => setShowResetConfirm(false)} title="恢复默认配置" width="max-w-md">
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-600">
              <RotateCcw size={16} />
            </div>
            <div className="leading-6">
              将恢复除“工具路径”和“网络设置”外的默认配置。已保存的工具路径与代理配置不会被清除。
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              onClick={() => setShowResetConfirm(false)}
              className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
            >
              取消
            </button>
            <button
              onClick={async () => {
                setShowResetConfirm(false)
                await resetSettings()
                showToast('success', '已恢复默认配置（不含工具路径和网络设置）')
              }}
              className="rounded-lg border border-amber-200 bg-amber-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-amber-500"
            >
              确认恢复
            </button>
          </div>
        </div>
      </Modal>

      <div className="settings-grid">
        <Section icon={<Cpu size={15} className="text-blue-600" />} color="bg-blue-100 text-blue-700" title="工具路径" delay={0.02}>
          <div className="space-y-3">
            <PathField label="N_m3u8DL-RE.exe 路径" field="exePath" placeholder="输入可执行文件路径" />
            <PathField label="ffmpeg 路径" field="ffmpegPath" placeholder="输入 ffmpeg 可执行文件路径" />
            <PathField label="mp4decrypt 路径" field="mp4decryptPath" placeholder="输入 mp4decrypt 可执行文件路径" />
          </div>
        </Section>

        <Section icon={<Save size={15} className="text-emerald-600" />} color="bg-emerald-100 text-emerald-700" title="文件管理" delay={0.04}>
          <div className="space-y-3">
            <PathField label="默认保存目录" field="saveDir" placeholder="当前目录..." />
            <PathField label="临时文件目录" field="tmpDir" placeholder="当前目录..." />
            <div className="field-shell">
              <label className="mb-1 block text-xs text-slate-500">保存文件名模板</label>
              <DraftField value={settings.savePattern} onCommit={(v) => commitField('savePattern', v)} placeholder='<SaveName>_<Resolution>_<Bandwidth>' className="input-field text-sm" />
              <p className="mt-1 text-[11px] text-slate-400">变量: SaveName, Id, Codecs, Language, Resolution, Bandwidth, MediaType, Channels, FrameRate</p>
            </div>
            <PathField label="日志文件路径" field="logFilePath" placeholder="不保存日志文件..." />
          </div>
        </Section>
      </div>

      <div className="settings-grid">
        <Section icon={<Globe size={15} className="text-cyan-600" />} color="bg-cyan-100 text-cyan-700" title="网络设置" delay={0.06}>
          <div className="space-y-3">
            <div className="field-shell">
              <label className="mb-1 block text-xs text-slate-500">BaseURL</label>
              <DraftField value={settings.baseUrl} onCommit={(v) => commitField('baseUrl', v)} placeholder="不设置（自动从链接推断）" className="input-field text-sm" />
              <p className="mt-1 text-[11px] text-slate-400">对应 --base-url，为分片设置基础 URL</p>
            </div>
            <div className="field-shell">
              <label className="mb-1 block text-xs text-slate-500">代理地址</label>
              <DraftField value={settings.proxy} onCommit={(v) => commitField('proxy', v)} placeholder="http://127.0.0.1:7890" className="input-field text-sm" />
            </div>
            <div className="field-shell">
              <label className="mb-1 block text-xs text-slate-500">自定义请求头（JSON）</label>
              <HeadersEditor value={settings.headers} onCommit={(next) => updateSetting('headers', next)} />
            </div>
          </div>
        </Section>

        <Section icon={<Zap size={15} className="text-violet-600" />} color="bg-violet-100 text-violet-700" title="下载控制" delay={0.08}>
          <div className="grid grid-cols-2 gap-3">
            <div className="field-shell">
              <label className="mb-1 block text-xs text-slate-500">下载线程数</label>
              <input type="number" value={settings.threadCount} onChange={(e) => updateSetting('threadCount', Number(e.target.value))} min={1} max={64} className="input-field text-sm" />
            </div>
            <div className="field-shell">
              <label className="mb-1 block text-xs text-slate-500">批量任务并发数</label>
              <input type="number" value={settings.batchConcurrency} onChange={(e) => updateSetting('batchConcurrency', Number(e.target.value))} min={1} max={6} className="input-field text-sm" />
            </div>
            <div className="field-shell">
              <label className="mb-1 block text-xs text-slate-500">下载重试次数</label>
              <input type="number" value={settings.downloadRetryCount} onChange={(e) => updateSetting('downloadRetryCount', Number(e.target.value))} min={0} max={20} className="input-field text-sm" />
            </div>
            <div className="field-shell">
              <label className="mb-1 block text-xs text-slate-500">HTTP 请求超时（秒）</label>
              <input type="number" value={settings.httpRequestTimeout} onChange={(e) => updateSetting('httpRequestTimeout', Number(e.target.value))} min={10} max={600} className="input-field text-sm" />
            </div>
            <div className="field-shell">
              <label className="mb-1 block text-xs text-slate-500">限速（如 10M, 100K）</label>
              <DraftField value={settings.maxSpeed} onCommit={(v) => commitField('maxSpeed', v)} placeholder="不限速" className="input-field text-sm" />
            </div>
            <div className="field-shell col-span-2">
              <label className="mb-1 block text-xs text-slate-500">自定义下载范围</label>
              <DraftField value={settings.customRange} onCommit={(v) => commitField('customRange', v)} placeholder="如 0-100 或 01:00:00-02:00:00" className="input-field text-sm" />
              <p className="mt-1 text-[11px] text-slate-400">对应 --custom-range</p>
            </div>
            <div className="field-shell col-span-2">
              <label className="mb-1 block text-xs text-slate-500">字幕格式</label>
              <select value={settings.subFormat} onChange={(e) => updateSetting('subFormat', e.target.value)} className="input-field text-sm">
                <option value="SRT">SRT</option><option value="VTT">VTT</option>
              </select>
            </div>
          </div>
        </Section>
      </div>

      <div className="settings-grid">
        <Section icon={<Film size={15} className="text-purple-600" />} color="bg-purple-100 text-purple-700" title="混流设置" delay={0.1}>
          <div className="grid grid-cols-2 gap-3">
            <div className="field-shell">
              <label className="mb-1 block text-xs text-slate-500">混流格式</label>
              <select value={settings.muxFormat} onChange={(e) => updateSetting('muxFormat', e.target.value)} className="input-field text-sm">
                <option value="mp4">MP4</option><option value="mkv">MKV</option>
              </select>
            </div>
            <div className="field-shell">
              <label className="mb-1 block text-xs text-slate-500">混流器</label>
              <select value={settings.muxMuxer} onChange={(e) => updateSetting('muxMuxer', e.target.value)} className="input-field text-sm">
                <option value="ffmpeg">ffmpeg</option><option value="mkvmerge">mkvmerge</option>
              </select>
            </div>
            <div className="field-shell">
              <label className="mb-1 block text-xs text-slate-500">日志级别</label>
              <select value={settings.logLevel} onChange={(e) => updateSetting('logLevel', e.target.value)} className="input-field text-sm">
                <option value="INFO">INFO</option><option value="DEBUG">DEBUG</option><option value="WARN">WARN</option><option value="ERROR">ERROR</option><option value="OFF">OFF</option>
              </select>
            </div>
            <div className="field-shell">
              <label className="mb-1 block text-xs text-slate-500">解密引擎</label>
              <select value={settings.decryptionEngine} onChange={(e) => updateSetting('decryptionEngine', e.target.value)} className="input-field text-sm">
                <option value="MP4DECRYPT">mp4decrypt</option><option value="SHAKA_PACKAGER">shaka-packager</option><option value="FFMPEG">ffmpeg</option>
              </select>
            </div>
            <div className="field-shell col-span-2">
              <label className="mb-1 block text-xs text-slate-500">密钥文件路径</label>
              <div className="flex gap-2">
                <DraftField value={settings.keyTextFile} onCommit={(v) => commitField('keyTextFile', v)} placeholder="无" className="input-field flex-1 text-sm" />
                <button onClick={() => handleSelectDir('keyTextFile')} className="btn-secondary px-3"><FolderOpen size={14} /></button>
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50/80 p-2.5 transition-colors hover:bg-slate-100">
              <input type="checkbox" checked={settings.muxAfterDone} onChange={(e) => updateSetting('muxAfterDone', e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-200" />
              <div>
                <span className="text-xs font-medium text-slate-700">完成后执行混流</span>
                <p className="text-[10px] text-slate-400">对应 --mux-after-done</p>
              </div>
            </label>
            <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50/80 p-2.5 transition-colors hover:bg-slate-100">
              <input type="checkbox" checked={settings.muxKeepFiles} onChange={(e) => updateSetting('muxKeepFiles', e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-200" />
              <div>
                <span className="text-xs font-medium text-slate-700">保留中间混流文件</span>
                <p className="text-[10px] text-slate-400">对应 keep=true</p>
              </div>
            </label>
            <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50/80 p-2.5 transition-colors hover:bg-slate-100">
              <input type="checkbox" checked={settings.muxSkipSub} onChange={(e) => updateSetting('muxSkipSub', e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-200" />
              <div>
                <span className="text-xs font-medium text-slate-700">混流时跳过字幕</span>
                <p className="text-[10px] text-slate-400">对应 skip_sub=true</p>
              </div>
            </label>
          </div>
        </Section>

        <Section icon={<Key size={15} className="text-rose-600" />} color="bg-rose-100 text-rose-700" title="解密高级" delay={0.12}>
          <div className="space-y-3">
            <div className="field-shell">
              <label className="mb-1 block text-xs text-slate-500">自定义 HLS 加密方式</label>
              <select value={settings.customHlsMethod} onChange={(e) => updateSetting('customHlsMethod', e.target.value)} className="input-field text-sm">
                <option value="">不指定</option>
                <option value="AES_128">AES_128</option>
                <option value="AES_128_ECB">AES_128_ECB</option>
                <option value="CENC">CENC</option>
                <option value="CHACHA20">CHACHA20</option>
                <option value="NONE">NONE</option>
                <option value="SAMPLE_AES">SAMPLE_AES</option>
                <option value="SAMPLE_AES_CTR">SAMPLE_AES_CTR</option>
              </select>
              <p className="mt-1 text-[11px] text-slate-400">对应 --custom-hls-method</p>
            </div>
            <div className="field-shell">
              <label className="mb-1 block text-xs text-slate-500">自定义 HLS 解密 KEY</label>
              <DraftField value={settings.customHlsKey} onCommit={(v) => commitField('customHlsKey', v)} placeholder="文件路径、HEX 或 Base64" className="input-field text-sm" />
              <p className="mt-1 text-[11px] text-slate-400">对应 --custom-hls-key</p>
            </div>
            <div className="field-shell">
              <label className="mb-1 block text-xs text-slate-500">自定义 HLS 解密 IV</label>
              <DraftField value={settings.customHlsIv} onCommit={(v) => commitField('customHlsIv', v)} placeholder="文件路径、HEX 或 Base64" className="input-field text-sm" />
              <p className="mt-1 text-[11px] text-slate-400">对应 --custom-hls-iv</p>
            </div>
          </div>
        </Section>
      </div>

      <div className="settings-grid">
        <Section icon={<Filter size={15} className="text-orange-600" />} color="bg-orange-100 text-orange-700" title="广告过滤" delay={0.14}>
          <div className="field-shell">
            <label className="mb-1 block text-xs text-slate-500">广告分片 URL 关键字（每行一个正则）</label>
            <textarea
              value={adKeywordInput}
              onChange={(e) => setAdKeywordInput(e.target.value)}
              onBlur={() => {
                const keywords = adKeywordInput.split('\n').map((s) => s.trim()).filter(Boolean)
                updateSetting('adKeywords', keywords)
              }}
              placeholder={'ad\npromo\ncommercial'}
              className="input-field h-20 resize-none font-mono text-xs"
            />
            <p className="mt-1 text-[11px] text-slate-400">对应 --ad-keyword，匹配的分片将被跳过</p>
          </div>
        </Section>

        <Section icon={<Settings size={15} className="text-amber-600" />} color="bg-amber-100 text-amber-700" title="功能开关" delay={0.16}>
          <div className="grid grid-cols-2 gap-2">
            {[
              { key: 'autoSelect', label: '自动选择最佳流', desc: '--auto-select' },
              { key: 'delAfterDone', label: '完成后删除临时文件', desc: '默认开启' },
              { key: 'autoSubtitleFix', label: '自动修正字幕', desc: '默认开启' },
              { key: 'binaryMerge', label: '二进制合并', desc: '--binary-merge' },
              { key: 'writeMetaJson', label: '写入 meta.json', desc: '默认开启' },
              { key: 'checkSegmentsCount', label: '检查分片数量', desc: '默认开启' },
              { key: 'concurrentDownload', label: '并发下载音视频字幕', desc: '-mt' },
              { key: 'useSystemProxy', label: '使用系统代理', desc: '默认开启' },
              { key: 'appendUrlParams', label: '附加 URL 参数到分片', desc: '--append-url-params' },
              { key: 'noDateInfo', label: '混流不写入日期', desc: '--no-date-info' },
              { key: 'mp4RealTimeDecryption', label: 'MP4 实时解密', desc: '--mp4-real-time-decryption' },
              { key: 'useFFmpegConcatDemuxer', label: 'ffmpeg concat 分离器', desc: '--use-ffmpeg-concat-demuxer' },
              { key: 'noLog', label: '关闭日志文件', desc: '--no-log' },
              { key: 'skipMerge', label: '跳过合并分片', desc: '--skip-merge' },
              { key: 'allowHlsMultiExtMap', label: '允许多 EXT-X-MAP', desc: '实验性' },
            ].map(({ key, label, desc }) => (
              <label key={key} className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50/80 p-2.5 transition-colors hover:bg-slate-100">
                <input type="checkbox" checked={(settings as any)[key]} onChange={(e) => updateSetting(key as any, e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-200" />
                <div>
                  <span className="text-xs font-medium text-slate-700">{label}</span>
                  <p className="text-[10px] text-slate-400">{desc}</p>
                </div>
              </label>
            ))}
          </div>
        </Section>
      </div>

      <Section icon={<Type size={15} className="text-slate-600" />} color="bg-slate-200 text-slate-700" title="自定义参数" delay={0.18}>
        <div className="field-shell">
          <DraftField value={settings.customArgs} onCommit={(v) => commitField('customArgs', v)}
            placeholder="额外的命令行参数，会追加到末尾..." className="input-field text-sm" />
          <p className="mt-1 text-[11px] text-slate-400">高级用户可直接输入 N_m3u8DL-RE 支持的任意参数，如 --mux-import、-sv 等</p>
          <p className="mt-1 text-[11px] text-amber-600">
            风险提示：此处内容会原样追加到下载命令行，仅输入来源可信的参数；不排除个别参数会影响文件保存位置或清理行为。
          </p>
        </div>
      </Section>
    </div>
  )
}
