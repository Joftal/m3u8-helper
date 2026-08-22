import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Settings, FolderOpen, Cpu, Film, Globe, Monitor, Save, RotateCcw, Clipboard, Zap, Hash, FileText, Shield, Type, Key, Filter } from 'lucide-react'
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
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }} className="card p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className={`w-7 h-7 rounded-md flex items-center justify-center ${color}`}>{icon}</div>
        <span className="text-sm font-semibold text-gray-800">{title}</span>
      </div>
      {children}
    </motion.div>
  )

  const PathField = ({ label, field, placeholder }: any) => (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <div className="flex gap-2">
        <input type="text" value={(settings as any)[field]} onChange={(e) => updateSetting(field, e.target.value)} placeholder={placeholder} className="input-field flex-1 text-sm" />
        <button onClick={() => handleSelectDir(field)} className="btn-secondary px-3"><FolderOpen size={14} /></button>
      </div>
    </div>
  )

  return (
    <div className="space-y-5">
      <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-xl font-bold text-gray-900">设置</h1>
        <p className="text-sm text-gray-500 mt-1">配置下载器和应用参数</p>
      </motion.div>

      {/* 工具路径 */}
      <Section icon={<Cpu size={15} className="text-primary-600" />} color="bg-primary-50" title="工具路径" delay={0.02}>
        <div className="space-y-3">
          <PathField label="N_m3u8DL-RE.exe 路径" field="exePath" placeholder="自动检测或手动指定..." />
          <PathField label="ffmpeg 路径" field="ffmpegPath" placeholder="自动查找..." />
          <PathField label="mp4decrypt 路径" field="mp4decryptPath" placeholder="自动查找..." />
        </div>
      </Section>

      {/* 文件管理 */}
      <Section icon={<Save size={15} className="text-emerald-600" />} color="bg-emerald-50" title="文件管理" delay={0.04}>
        <div className="space-y-3">
          <PathField label="默认保存目录" field="saveDir" placeholder="当前目录..." />
          <PathField label="临时文件目录" field="tmpDir" placeholder="当前目录..." />
          <div>
            <label className="block text-xs text-gray-500 mb-1">保存文件名模板</label>
            <input type="text" value={settings.savePattern} onChange={(e) => updateSetting('savePattern', e.target.value)} placeholder='<SaveName>_<Resolution>_<Bandwidth>' className="input-field text-sm" />
            <p className="text-[11px] text-gray-400 mt-1">变量: SaveName, Id, Codecs, Language, Resolution, Bandwidth, MediaType, Channels, FrameRate</p>
          </div>
          <PathField label="日志文件路径" field="logFilePath" placeholder="不保存日志文件..." />
        </div>
      </Section>

      {/* 网络设置 */}
      <Section icon={<Globe size={15} className="text-cyan-600" />} color="bg-cyan-50" title="网络设置" delay={0.06}>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">BaseURL</label>
            <input type="text" value={settings.baseUrl} onChange={(e) => updateSetting('baseUrl', e.target.value)} placeholder="不设置（自动从链接推断）" className="input-field text-sm" />
            <p className="text-[11px] text-gray-400 mt-1">对应 --base-url，为分片设置基础 URL</p>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">代理地址</label>
            <input type="text" value={settings.proxy} onChange={(e) => updateSetting('proxy', e.target.value)} placeholder="http://127.0.0.1:7890" className="input-field text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">自定义请求头（JSON）</label>
            <textarea value={JSON.stringify(settings.headers, null, 2)}
              onChange={(e) => { try { updateSetting('headers', JSON.parse(e.target.value)) } catch {} }}
              placeholder='{"Cookie": "xxx", "User-Agent": "xxx"}' className="input-field h-20 resize-none font-mono text-xs" />
          </div>
        </div>
      </Section>

      {/* 下载控制 */}
      <Section icon={<Zap size={15} className="text-blue-600" />} color="bg-blue-50" title="下载控制" delay={0.08}>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">下载线程数</label>
            <input type="number" value={settings.threadCount} onChange={(e) => updateSetting('threadCount', Number(e.target.value))} min={1} max={64} className="input-field text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">下载重试次数</label>
            <input type="number" value={settings.downloadRetryCount} onChange={(e) => updateSetting('downloadRetryCount', Number(e.target.value))} min={0} max={20} className="input-field text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">HTTP 请求超时（秒）</label>
            <input type="number" value={settings.httpRequestTimeout} onChange={(e) => updateSetting('httpRequestTimeout', Number(e.target.value))} min={10} max={600} className="input-field text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">限速（如 10M, 100K）</label>
            <input type="text" value={settings.maxSpeed} onChange={(e) => updateSetting('maxSpeed', e.target.value)} placeholder="不限速" className="input-field text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">自定义下载范围</label>
            <input type="text" value={settings.customRange} onChange={(e) => updateSetting('customRange', e.target.value)} placeholder="如 0-100 或 01:00:00-02:00:00" className="input-field text-sm" />
            <p className="text-[11px] text-gray-400 mt-1">对应 --custom-range</p>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">字幕格式</label>
            <select value={settings.subFormat} onChange={(e) => updateSetting('subFormat', e.target.value)} className="input-field text-sm">
              <option value="SRT">SRT</option><option value="VTT">VTT</option>
            </select>
          </div>
        </div>
      </Section>

      {/* 混流设置 */}
      <Section icon={<Film size={15} className="text-purple-600" />} color="bg-purple-50" title="混流设置" delay={0.1}>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">混流格式</label>
            <select value={settings.muxFormat} onChange={(e) => updateSetting('muxFormat', e.target.value)} className="input-field text-sm">
              <option value="mp4">MP4</option><option value="mkv">MKV</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">混流器</label>
            <select value={settings.muxMuxer} onChange={(e) => updateSetting('muxMuxer', e.target.value)} className="input-field text-sm">
              <option value="ffmpeg">ffmpeg</option><option value="mkvmerge">mkvmerge</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">日志级别</label>
            <select value={settings.logLevel} onChange={(e) => updateSetting('logLevel', e.target.value)} className="input-field text-sm">
              <option value="INFO">INFO</option><option value="DEBUG">DEBUG</option><option value="WARN">WARN</option><option value="ERROR">ERROR</option><option value="OFF">OFF</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">解密引擎</label>
            <select value={settings.decryptionEngine} onChange={(e) => updateSetting('decryptionEngine', e.target.value)} className="input-field text-sm">
              <option value="MP4DECRYPT">mp4decrypt</option><option value="SHAKA_PACKAGER">shaka-packager</option><option value="FFMPEG">ffmpeg</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">密钥文件路径</label>
            <div className="flex gap-2">
              <input type="text" value={settings.keyTextFile} onChange={(e) => updateSetting('keyTextFile', e.target.value)} placeholder="无" className="input-field flex-1 text-sm" />
              <button onClick={() => handleSelectDir('keyTextFile')} className="btn-secondary px-3"><FolderOpen size={14} /></button>
            </div>
          </div>
        </div>
      </Section>

      {/* 解密高级 */}
      <Section icon={<Key size={15} className="text-rose-600" />} color="bg-rose-50" title="解密高级" delay={0.12}>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">自定义 HLS 加密方式</label>
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
            <p className="text-[11px] text-gray-400 mt-1">对应 --custom-hls-method</p>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">自定义 HLS 解密 KEY</label>
            <input type="text" value={settings.customHlsKey} onChange={(e) => updateSetting('customHlsKey', e.target.value)} placeholder="文件路径、HEX 或 Base64" className="input-field text-sm" />
            <p className="text-[11px] text-gray-400 mt-1">对应 --custom-hls-key</p>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">自定义 HLS 解密 IV</label>
            <input type="text" value={settings.customHlsIv} onChange={(e) => updateSetting('customHlsIv', e.target.value)} placeholder="文件路径、HEX 或 Base64" className="input-field text-sm" />
            <p className="text-[11px] text-gray-400 mt-1">对应 --custom-hls-iv</p>
          </div>
        </div>
      </Section>

      {/* 广告过滤 */}
      <Section icon={<Filter size={15} className="text-orange-600" />} color="bg-orange-50" title="广告过滤" delay={0.14}>
        <div>
          <label className="block text-xs text-gray-500 mb-1">广告分片 URL 关键字（每行一个正则）</label>
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
          <p className="text-[11px] text-gray-400 mt-1">对应 --ad-keyword，匹配的分片将被跳过</p>
        </div>
      </Section>

      {/* 功能开关 */}
      <Section icon={<Settings size={15} className="text-amber-600" />} color="bg-amber-50" title="功能开关" delay={0.16}>
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
            { key: 'clipboardWatch', label: '剪贴板监听', desc: '检测 m3u8 链接' },
            { key: 'appendUrlParams', label: '附加 URL 参数到分片', desc: '--append-url-params' },
            { key: 'noDateInfo', label: '混流不写入日期', desc: '--no-date-info' },
            { key: 'mp4RealTimeDecryption', label: 'MP4 实时解密', desc: '--mp4-real-time-decryption' },
            { key: 'useFFmpegConcatDemuxer', label: 'ffmpeg concat 分离器', desc: '--use-ffmpeg-concat-demuxer' },
            { key: 'noLog', label: '关闭日志文件', desc: '--no-log' },
            { key: 'skipMerge', label: '跳过合并分片', desc: '--skip-merge' },
            { key: 'allowHlsMultiExtMap', label: '允许多 EXT-X-MAP', desc: '实验性' },
          ].map(({ key, label, desc }) => (
            <label key={key} className="flex items-center gap-2.5 p-2.5 rounded-lg bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors border border-gray-100">
              <input type="checkbox" checked={(settings as any)[key]} onChange={(e) => updateSetting(key as any, e.target.checked)}
                className="w-3.5 h-3.5 rounded border-gray-300 text-primary-600 focus:ring-primary-200" />
              <div>
                <span className="text-xs font-medium text-gray-700">{label}</span>
                <p className="text-[10px] text-gray-400">{desc}</p>
              </div>
            </label>
          ))}
        </div>
      </Section>

      {/* 自定义参数 */}
      <Section icon={<Type size={15} className="text-gray-500" />} color="bg-gray-100" title="自定义参数" delay={0.18}>
        <input type="text" value={settings.customArgs} onChange={(e) => updateSetting('customArgs', e.target.value)}
          placeholder="额外的命令行参数，会追加到末尾..." className="input-field text-sm" />
        <p className="text-[11px] text-gray-400 mt-1">高级用户可直接输入 N_m3u8DL-RE 支持的任意参数，如 --mux-import、-sv 等</p>
      </Section>
    </div>
  )
}
