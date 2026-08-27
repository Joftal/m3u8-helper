import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { FolderOpen, RotateCcw } from 'lucide-react'
import { useSettingsStore } from '@/store/settingsStore'
import Modal from '@/components/Modal'
import { showToast } from '@/components/Toast'
import { useTranslation } from '@/i18n'
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
function HeadersEditor({ value, onCommit, t }: { value: Record<string, string>; onCommit: (next: Record<string, string>) => void; t: (path: string, fallback?: string) => string }) {
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
              setError(t('settings.jsonObjectRequired'))
              return
            }
            setError('')
            onCommit(parsed)
          } catch {
            setError(t('settings.invalidJson'))
          }
        }}
        placeholder='{"Cookie": "xxx", "User-Agent": "xxx"}'
        className="input-field h-20 resize-none font-mono text-xs"
      />
      {error && <p className="mt-1 text-[11px] text-red-500 dark:text-red-400">{error}</p>}
    </div>
  )
}

/** 设置分区容器：必须位于组件外——定义在函数体内会因组件身份变化导致整树重挂 */
function Section({ emoji, title, children, delay = 0 }: any) {
  return (
    <motion.section initial={false} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.18 }} className="settings-panel p-5">
      <div className="settings-section-header">
        <div className="settings-section-title">
          <span className="text-xl leading-none">{emoji}</span>
          <span>{title}</span>
        </div>
        </div>
      {children}
    </motion.section>
  )
}

export default function SettingsPage() {
  const { settings, loaded, loadSettings, updateSetting, resetSettings } = useSettingsStore()
  const { t } = useTranslation()
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
    if (path) { await updateSetting(field as any, path); showToast('success', t('settings.updateSuccess')) }
  }

  const commitField = (field: keyof typeof settings, value: string) => {
    const result = validateSettingValue(field as string, value)
    if (!result.valid) {
      showToast('error', result.message ? t(result.message, t('settings.invalidValue')) : t('settings.invalidValue'))
      return
    }
    updateSetting(field as any, result.value as any)
  }

  const PathField = ({ label, field, placeholder }: any) => (
    <div>
      <label className="mb-1 block text-xs text-slate-500 dark:text-neutral-400">{label}</label>
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
          <div className="page-kicker">{t('settings.pageKicker')}</div>
          <h1 className="page-title">{t('settings.pageTitle')}</h1>
        </div>
        <button
          onClick={() => setShowResetConfirm(true)}
          className="btn-secondary px-3.5 text-sm"
        >
          {t('settings.restoreDefault')}
        </button>
      </motion.div>

      <Modal open={showResetConfirm} onClose={() => setShowResetConfirm(false)} title={t('settings.resetTitle')} width="max-w-md">
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/10 px-3 py-3 text-sm text-amber-800 dark:text-amber-300">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 dark:bg-amber-500/10 text-amber-500 dark:text-amber-400">
              <RotateCcw size={16} />
            </div>
            <div className="leading-6">
              {t('settings.resetMessage')}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              onClick={() => setShowResetConfirm(false)}
              className="rounded-lg border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3.5 py-2 text-sm font-medium text-slate-300 dark:text-neutral-600 transition hover:bg-slate-100 dark:hover:bg-neutral-800 hover:bg-slate-50 dark:hover:bg-neutral-800/60"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={async () => {
                setShowResetConfirm(false)
                await resetSettings()
                showToast('success', t('settings.resetSuccess'))
              }}
              className="rounded-lg border border-amber-200 dark:border-amber-500/20 bg-amber-600 px-3.5 py-2 text-sm font-medium text-white transition"
            >
              {t('settings.confirmReset')}
            </button>
          </div>
        </div>
      </Modal>

      <div className="settings-grid">
        <Section emoji="🔧" title={t('settings.toolPaths')} delay={0.02}>
          <div className="space-y-3">
            <PathField label={t('settings.exePath')} field="exePath" placeholder={t('settings.inputExecutablePath')} />
            <PathField label={t('settings.ffmpegPath')} field="ffmpegPath" placeholder={t('settings.inputFfmpegPath')} />
            <PathField label={t('settings.mp4decryptPath')} field="mp4decryptPath" placeholder={t('settings.inputMp4decryptPath')} />
          </div>
        </Section>

        <Section emoji="📁" title={t('settings.fileManagement')} delay={0.04}>
          <div className="space-y-3">
            <PathField label={t('settings.defaultSaveDir')} field="saveDir" placeholder={t('settings.currentDirectory')} />
            <PathField label={t('settings.tempDir')} field="tmpDir" placeholder={t('settings.currentDirectory')} />
            <div className="field-shell">
              <label className="mb-1 block text-xs text-slate-500 dark:text-neutral-400">{t('settings.savePattern')}</label>
              <DraftField value={settings.savePattern} onCommit={(v) => commitField('savePattern', v)} placeholder='<SaveName>_<Resolution>_<Bandwidth>' className="input-field text-sm" />
              <p className="mt-1 text-[11px] text-slate-500 dark:text-neutral-400">{t('settings.savePatternHint')}</p>
            </div>
            <PathField label={t('settings.logFilePath')} field="logFilePath" placeholder={t('settings.noLogFile')} />
          </div>
        </Section>
      </div>

      <div className="settings-grid">
        <Section emoji="🌐" title={t('settings.network')} delay={0.06}>
          <div className="space-y-3">
            <div className="field-shell">
              <label className="mb-1 block text-xs text-slate-500 dark:text-neutral-400">{t('settings.baseUrl')}</label>
              <DraftField value={settings.baseUrl} onCommit={(v) => commitField('baseUrl', v)} placeholder={t('settings.baseUrlPlaceholder')} className="input-field text-sm" />
              <p className="mt-1 text-[11px] text-slate-500 dark:text-neutral-400">{t('settings.baseUrlHint')}</p>
            </div>
            <div className="field-shell">
              <label className="mb-1 block text-xs text-slate-500 dark:text-neutral-400">{t('settings.proxyAddress')}</label>
              <DraftField value={settings.proxy} onCommit={(v) => commitField('proxy', v)} placeholder="http://127.0.0.1:7890" className="input-field text-sm" />
            </div>
            <div className="field-shell">
              <label className="mb-1 block text-xs text-slate-500 dark:text-neutral-400">{t('settings.customHeaders')}</label>
              <HeadersEditor value={settings.headers} onCommit={(next) => updateSetting('headers', next)} t={t} />
            </div>
          </div>
        </Section>

        <Section emoji="⚡" title={t('settings.download')} delay={0.08}>
          <div className="grid grid-cols-2 gap-3">
            <div className="field-shell">
              <label className="mb-1 block text-xs text-slate-500 dark:text-neutral-400">{t('settings.threads')}</label>
              <input type="number" value={settings.threadCount} onChange={(e) => updateSetting('threadCount', Number(e.target.value))} min={1} max={64} className="input-field text-sm" />
            </div>
            <div className="field-shell">
              <label className="mb-1 block text-xs text-slate-500 dark:text-neutral-400">{t('settings.batchConcurrency')}</label>
              <input type="number" value={settings.batchConcurrency} onChange={(e) => updateSetting('batchConcurrency', Number(e.target.value))} min={1} max={6} className="input-field text-sm" />
            </div>
            <div className="field-shell">
              <label className="mb-1 block text-xs text-slate-500 dark:text-neutral-400">{t('settings.downloadRetryCount')}</label>
              <input type="number" value={settings.downloadRetryCount} onChange={(e) => updateSetting('downloadRetryCount', Number(e.target.value))} min={0} max={20} className="input-field text-sm" />
            </div>
            <div className="field-shell">
              <label className="mb-1 block text-xs text-slate-500 dark:text-neutral-400">{t('settings.httpRequestTimeout')}</label>
              <input type="number" value={settings.httpRequestTimeout} onChange={(e) => updateSetting('httpRequestTimeout', Number(e.target.value))} min={10} max={600} className="input-field text-sm" />
            </div>
            <div className="field-shell">
              <label className="mb-1 block text-xs text-slate-500 dark:text-neutral-400">{t('settings.maxSpeed')}</label>
              <DraftField value={settings.maxSpeed} onCommit={(v) => commitField('maxSpeed', v)} placeholder={t('settings.maxSpeedPlaceholder')} className="input-field text-sm" />
            </div>
            <div className="field-shell col-span-2">
              <label className="mb-1 block text-xs text-slate-500 dark:text-neutral-400">{t('settings.customRange')}</label>
              <DraftField value={settings.customRange} onCommit={(v) => commitField('customRange', v)} placeholder={t('settings.customRangePlaceholder')} className="input-field text-sm" />
              <p className="mt-1 text-[11px] text-slate-500 dark:text-neutral-400">{t('settings.customRangeHint')}</p>
            </div>
            <div className="field-shell col-span-2">
              <label className="mb-1 block text-xs text-slate-500 dark:text-neutral-400">{t('settings.subFormat')}</label>
              <select value={settings.subFormat} onChange={(e) => updateSetting('subFormat', e.target.value)} className="input-field text-sm">
                <option value="SRT">SRT</option><option value="VTT">VTT</option>
              </select>
            </div>
          </div>
        </Section>
      </div>

      <div className="settings-grid">
        <Section emoji="🎬" title={t('settings.muxSettings')} delay={0.1}>
          <div className="grid grid-cols-2 gap-3">
            <div className="field-shell">
              <label className="mb-1 block text-xs text-slate-500 dark:text-neutral-400">{t('settings.muxFormat')}</label>
              <select value={settings.muxFormat} onChange={(e) => updateSetting('muxFormat', e.target.value)} className="input-field text-sm">
                <option value="mp4">MP4</option><option value="mkv">MKV</option>
              </select>
            </div>
            <div className="field-shell">
              <label className="mb-1 block text-xs text-slate-500 dark:text-neutral-400">{t('settings.muxMuxer')}</label>
              <select value={settings.muxMuxer} onChange={(e) => updateSetting('muxMuxer', e.target.value)} className="input-field text-sm">
                <option value="ffmpeg">ffmpeg</option><option value="mkvmerge">mkvmerge</option>
              </select>
            </div>
            <div className="field-shell">
              <label className="mb-1 block text-xs text-slate-500 dark:text-neutral-400">{t('settings.logLevel')}</label>
              <select value={settings.logLevel} onChange={(e) => updateSetting('logLevel', e.target.value)} className="input-field text-sm">
                <option value="INFO">INFO</option><option value="DEBUG">DEBUG</option><option value="WARN">WARN</option><option value="ERROR">ERROR</option><option value="OFF">OFF</option>
              </select>
            </div>
            <div className="field-shell">
              <label className="mb-1 block text-xs text-slate-500 dark:text-neutral-400">{t('settings.decryptionEngine')}</label>
              <select value={settings.decryptionEngine} onChange={(e) => updateSetting('decryptionEngine', e.target.value)} className="input-field text-sm">
                <option value="MP4DECRYPT">mp4decrypt</option><option value="SHAKA_PACKAGER">shaka-packager</option><option value="FFMPEG">ffmpeg</option>
              </select>
            </div>
            <div className="field-shell col-span-2">
              <label className="mb-1 block text-xs text-slate-500 dark:text-neutral-400">{t('settings.keyTextFile')}</label>
              <div className="flex gap-2">
                <DraftField value={settings.keyTextFile} onCommit={(v) => commitField('keyTextFile', v)} placeholder={t('settings.none')} className="input-field flex-1 text-sm" />
                <button onClick={() => handleSelectDir('keyTextFile')} className="btn-secondary px-3"><FolderOpen size={14} /></button>
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-slate-200 dark:border-neutral-800 bg-slate-50/80 dark:bg-neutral-800/70 bg-slate-100 dark:bg-neutral-800 p-2.5 transition-colors hover:bg-slate-100 dark:hover:bg-neutral-800">
              <input type="checkbox" checked={settings.muxAfterDone} onChange={(e) => updateSetting('muxAfterDone', e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300 dark:border-white/5 text-blue-500 dark:text-blue-400 focus:ring-blue-200 dark:focus:ring-blue-500/30" />
              <div>
                <span className="text-xs font-medium text-slate-700 dark:text-neutral-200">{t('settings.muxAfterDone')}</span>
                <p className="text-[10px] text-slate-500 dark:text-neutral-400">{t('settings.muxAfterDoneHint')}</p>
              </div>
            </label>
            <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-slate-200 dark:border-neutral-800 bg-slate-50/80 dark:bg-neutral-800/70 bg-slate-100 dark:bg-neutral-800 p-2.5 transition-colors hover:bg-slate-100 dark:hover:bg-neutral-800">
              <input type="checkbox" checked={settings.muxKeepFiles} onChange={(e) => updateSetting('muxKeepFiles', e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300 dark:border-white/5 text-blue-500 dark:text-blue-400 focus:ring-blue-200 dark:focus:ring-blue-500/30" />
              <div>
                <span className="text-xs font-medium text-slate-700 dark:text-neutral-200">{t('settings.muxKeepFiles')}</span>
                <p className="text-[10px] text-slate-500 dark:text-neutral-400">{t('settings.keepTrue')}</p>
              </div>
            </label>
            <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-slate-200 dark:border-neutral-800 bg-slate-50/80 dark:bg-neutral-800/70 bg-slate-100 dark:bg-neutral-800 p-2.5 transition-colors hover:bg-slate-100 dark:hover:bg-neutral-800">
              <input type="checkbox" checked={settings.muxSkipSub} onChange={(e) => updateSetting('muxSkipSub', e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300 dark:border-white/5 text-blue-500 dark:text-blue-400 focus:ring-blue-500/30" />
              <div>
                <span className="text-xs font-medium text-slate-700 dark:text-neutral-200">{t('settings.muxSkipSub')}</span>
                <p className="text-[10px] text-slate-500 dark:text-neutral-400">{t('settings.skipSubTrue')}</p>
              </div>
            </label>
          </div>
        </Section>

        <Section emoji="🔑" title={t('settings.decryptionAdvanced')} delay={0.12}>
          <div className="space-y-3">
            <div className="field-shell">
              <label className="mb-1 block text-xs text-slate-500 dark:text-neutral-400">{t('settings.customHlsMethod')}</label>
              <select value={settings.customHlsMethod} onChange={(e) => updateSetting('customHlsMethod', e.target.value)} className="input-field text-sm">
                <option value="">{t('settings.notSpecified')}</option>
                <option value="AES_128">AES_128</option>
                <option value="AES_128_ECB">AES_128_ECB</option>
                <option value="CENC">CENC</option>
                <option value="CHACHA20">CHACHA20</option>
                <option value="NONE">NONE</option>
                <option value="SAMPLE_AES">SAMPLE_AES</option>
                <option value="SAMPLE_AES_CTR">SAMPLE_AES_CTR</option>
              </select>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-neutral-400">{t('settings.customHlsMethodHint')}</p>
            </div>
            <div className="field-shell">
              <label className="mb-1 block text-xs text-slate-500 dark:text-neutral-400">{t('settings.customHlsKey')}</label>
              <DraftField value={settings.customHlsKey} onCommit={(v) => commitField('customHlsKey', v)} placeholder={t('settings.hlsKeyPlaceholder')} className="input-field text-sm" />
              <p className="mt-1 text-[11px] text-slate-500 dark:text-neutral-400">{t('settings.customHlsKeyHint')}</p>
            </div>
            <div className="field-shell">
              <label className="mb-1 block text-xs text-slate-500 dark:text-neutral-400">{t('settings.customHlsIv')}</label>
              <DraftField value={settings.customHlsIv} onCommit={(v) => commitField('customHlsIv', v)} placeholder={t('settings.hlsKeyPlaceholder')} className="input-field text-sm" />
              <p className="mt-1 text-[11px] text-slate-500 dark:text-neutral-400">{t('settings.customHlsIvHint')}</p>
            </div>
          </div>
        </Section>
      </div>

      <div className="settings-grid">
        <Section emoji="🧹" title={t('settings.adFilter')} delay={0.14}>
          <div className="field-shell">
            <label className="mb-1 block text-xs text-slate-500 dark:text-neutral-400">{t('settings.adKeywordsLabel')}</label>
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
            <p className="mt-1 text-[11px] text-slate-500 dark:text-neutral-400">{t('settings.adKeywordsHint')}</p>
          </div>
        </Section>

        <Section emoji="🔘" title={t('settings.featureFlags')} delay={0.16}>
          <div className="grid grid-cols-2 gap-2">
            {[
              { key: 'autoSelect', label: t('settings.feature.autoSelect'), desc: '--auto-select' },
              { key: 'delAfterDone', label: t('settings.feature.delAfterDone'), desc: t('settings.feature.defaultOn') },
              { key: 'autoSubtitleFix', label: t('settings.feature.autoSubtitleFix'), desc: t('settings.feature.defaultOn') },
              { key: 'binaryMerge', label: t('settings.feature.binaryMerge'), desc: '--binary-merge' },
              { key: 'writeMetaJson', label: t('settings.feature.writeMetaJson'), desc: t('settings.feature.defaultOn') },
              { key: 'checkSegmentsCount', label: t('settings.feature.checkSegmentsCount'), desc: t('settings.feature.defaultOn') },
              { key: 'concurrentDownload', label: t('settings.feature.concurrentDownload'), desc: '-mt' },
              { key: 'useSystemProxy', label: t('settings.feature.useSystemProxy'), desc: t('settings.feature.defaultOn') },
              { key: 'appendUrlParams', label: t('settings.feature.appendUrlParams'), desc: '--append-url-params' },
              { key: 'noDateInfo', label: t('settings.feature.noDateInfo'), desc: '--no-date-info' },
              { key: 'mp4RealTimeDecryption', label: t('settings.feature.mp4RealTimeDecryption'), desc: '--mp4-real-time-decryption' },
              { key: 'useFFmpegConcatDemuxer', label: t('settings.feature.useFFmpegConcatDemuxer'), desc: '--use-ffmpeg-concat-demuxer' },
              { key: 'noLog', label: t('settings.feature.noLog'), desc: '--no-log' },
              { key: 'skipMerge', label: t('settings.feature.skipMerge'), desc: '--skip-merge' },
              { key: 'allowHlsMultiExtMap', label: t('settings.feature.allowHlsMultiExtMap'), desc: t('settings.feature.experimental') },
            ].map(({ key, label, desc }) => (
              <label key={key} className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-slate-200 dark:border-neutral-800 bg-slate-50/80 dark:bg-neutral-800/70 bg-slate-100 dark:bg-neutral-800 p-2.5 transition-colors hover:bg-slate-100 dark:hover:bg-neutral-800">
                <input type="checkbox" checked={(settings as any)[key]} onChange={(e) => updateSetting(key as any, e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-300 dark:border-white/5 text-blue-500 dark:text-blue-400 focus:ring-blue-200 dark:focus:ring-blue-500/30" />
                <div>
                  <span className="text-xs font-medium text-slate-700 dark:text-neutral-200">{label}</span>
                  <p className="text-[10px] text-slate-500 dark:text-neutral-400">{desc}</p>
                </div>
              </label>
            ))}
          </div>
        </Section>
      </div>

      <Section emoji="📝" title={t('settings.customArgsTitle')} delay={0.18}>
        <div className="field-shell">
          <DraftField value={settings.customArgs} onCommit={(v) => commitField('customArgs', v)}
            placeholder={t('settings.customArgsPlaceholder')} className="input-field text-sm" />
          <p className="mt-1 text-[11px] text-slate-500 dark:text-neutral-400">{t('settings.customArgsHint')}</p>
          <p className="mt-1 text-[11px] text-amber-500 dark:text-amber-400">
            {t('settings.customArgsWarning')}
          </p>
        </div>
      </Section>
    </div>
  )
}
