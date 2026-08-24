import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Settings, FolderOpen, Cpu, Film, Globe, Save, Zap, Type, Key, Filter, CheckCircle2, AlertTriangle } from 'lucide-react'
import { useSettingsStore } from '@/store/settingsStore'
import { showToast } from '@/components/Toast'

export default function SettingsPage() {
  const { settings, loaded, loadSettings, updateSetting } = useSettingsStore()
  const [adKeywordInput, setAdKeywordInput] = useState('')

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

  const PathField = ({ label, field, placeholder }: any) => (
    <div>
      <label className="mb-1 block text-xs text-slate-500">{label}</label>
      <div className="flex gap-2">
        <input type="text" value={(settings as any)[field]} onChange={(e) => updateSetting(field, e.target.value)} placeholder={placeholder} className="input-field flex-1 text-sm" />
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
      </motion.div>

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
              <input type="text" value={settings.savePattern} onChange={(e) => updateSetting('savePattern', e.target.value)} placeholder='<SaveName>_<Resolution>_<Bandwidth>' className="input-field text-sm" />
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
              <input type="text" value={settings.baseUrl} onChange={(e) => updateSetting('baseUrl', e.target.value)} placeholder="不设置（自动从链接推断）" className="input-field text-sm" />
              <p className="mt-1 text-[11px] text-slate-400">对应 --base-url，为分片设置基础 URL</p>
            </div>
            <div className="field-shell">
              <label className="mb-1 block text-xs text-slate-500">代理地址</label>
              <input type="text" value={settings.proxy} onChange={(e) => updateSetting('proxy', e.target.value)} placeholder="http://127.0.0.1:7890" className="input-field text-sm" />
            </div>
            <div className="field-shell">
              <label className="mb-1 block text-xs text-slate-500">自定义请求头（JSON）</label>
              <textarea value={JSON.stringify(settings.headers, null, 2)}
                onChange={(e) => { try { updateSetting('headers', JSON.parse(e.target.value)) } catch {} }}
                placeholder='{"Cookie": "xxx", "User-Agent": "xxx"}' className="input-field h-20 resize-none font-mono text-xs" />
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
              <label className="mb-1 block text-xs text-slate-500">下载重试次数</label>
              <input type="number" value={settings.downloadRetryCount} onChange={(e) => updateSetting('downloadRetryCount', Number(e.target.value))} min={0} max={20} className="input-field text-sm" />
            </div>
            <div className="field-shell">
              <label className="mb-1 block text-xs text-slate-500">HTTP 请求超时（秒）</label>
              <input type="number" value={settings.httpRequestTimeout} onChange={(e) => updateSetting('httpRequestTimeout', Number(e.target.value))} min={10} max={600} className="input-field text-sm" />
            </div>
            <div className="field-shell">
              <label className="mb-1 block text-xs text-slate-500">限速（如 10M, 100K）</label>
              <input type="text" value={settings.maxSpeed} onChange={(e) => updateSetting('maxSpeed', e.target.value)} placeholder="不限速" className="input-field text-sm" />
            </div>
            <div className="field-shell col-span-2">
              <label className="mb-1 block text-xs text-slate-500">自定义下载范围</label>
              <input type="text" value={settings.customRange} onChange={(e) => updateSetting('customRange', e.target.value)} placeholder="如 0-100 或 01:00:00-02:00:00" className="input-field text-sm" />
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
                <input type="text" value={settings.keyTextFile} onChange={(e) => updateSetting('keyTextFile', e.target.value)} placeholder="无" className="input-field flex-1 text-sm" />
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
              <input type="text" value={settings.customHlsKey} onChange={(e) => updateSetting('customHlsKey', e.target.value)} placeholder="文件路径、HEX 或 Base64" className="input-field text-sm" />
              <p className="mt-1 text-[11px] text-slate-400">对应 --custom-hls-key</p>
            </div>
            <div className="field-shell">
              <label className="mb-1 block text-xs text-slate-500">自定义 HLS 解密 IV</label>
              <input type="text" value={settings.customHlsIv} onChange={(e) => updateSetting('customHlsIv', e.target.value)} placeholder="文件路径、HEX 或 Base64" className="input-field text-sm" />
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
          <input type="text" value={settings.customArgs} onChange={(e) => updateSetting('customArgs', e.target.value)}
            placeholder="额外的命令行参数，会追加到末尾..." className="input-field text-sm" />
          <p className="mt-1 text-[11px] text-slate-400">高级用户可直接输入 N_m3u8DL-RE 支持的任意参数，如 --mux-import、-sv 等</p>
        </div>
      </Section>
    </div>
  )
}
