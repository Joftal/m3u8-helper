import { isImportHeaderAlias } from '@/i18n'
import { extractFileName } from '@/utils/format'
import { isValidUrl } from '@/utils/validators'

/** 批量导入的规范化行（名称 + 链接） */
export interface ImportedRow {
  name: string
  url: string
}

/** 去除单元格首尾 BOM/空白/各类引号，压缩换行为空格 */
export const normalizeImportCell = (value: string) => value
  .replace(/^[\uFEFF\s"'“”‘’]+|[\uFEFF\s"'“”‘’]+$/g, '')
  .replace(/[\r\n]+/g, ' ')
  .trim()

/** 解析逗号/制表符/竖线/分号分隔的一行，支持引号包裹 */
export const parseDelimitedRow = (line: string): string[] => {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    const next = line[i + 1]

    if ((char === '"' || char === "'" || char === '“' || char === '”' || char === '‘' || char === '’') && (i === 0 || line[i - 1] !== '\\')) {
      if (inQuotes) {
        if (next === '"' || next === "'" || next === '“' || next === '”' || next === '‘' || next === '’') {
          current += char
          i += 1
        } else {
          inQuotes = false
        }
        continue
      }
      inQuotes = true
      continue
    }

    if (!inQuotes && (char === ',' || char === '\t' || char === '|' || char === ';')) {
      result.push(normalizeImportCell(current))
      current = ''
      continue
    }

    if (!inQuotes && /\s{2,}/.test(char) && !/[\dA-Za-z]/.test(next ?? '')) {
      if (current.trim()) {
        result.push(normalizeImportCell(current))
        current = ''
      }
      continue
    }

    current += char
  }

  result.push(normalizeImportCell(current))
  return result.filter((cell) => cell.length > 0)
}

/** 从任意文本中提取 URL 候选（剥离尾部标点） */
export const extractUrlCandidate = (value: string) => {
  const trimmed = normalizeImportCell(value)
  const match = trimmed.match(/https?:\/\/[^\s,;|)\]]+/i)
  if (!match) return null
  return match[0].replace(/[),.;]+$/, '')
}

/**
 * 固定列解析（txt/csv/tsv 文本）：
 * 支持纯 URL 行、「名称 + URL」自由文本行、分隔符表格行；表头别名行跳过
 */
export const parseFixedColumnImport = (rawText: string): ImportedRow[] => {
  const rows: ImportedRow[] = []
  const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)

  const parseLine = (line: string): ImportedRow | null => {
    const trimmed = normalizeImportCell(line)
    if (!trimmed) return null

    if (isValidUrl(trimmed)) {
      return { name: extractFileName(trimmed), url: trimmed }
    }

    const urlMatch = trimmed.match(/https?:\/\/[^\s,;|)\]]+/i)
    if (urlMatch) {
      const url = normalizeImportCell(urlMatch[0].replace(/[),.;]+$/, ''))
      const urlIndex = trimmed.indexOf(url)
      const before = normalizeImportCell(trimmed.slice(0, urlIndex))
      const after = normalizeImportCell(trimmed.slice(urlIndex + url.length))
      const name = before || after
      if (name && isValidUrl(url)) {
        return {
          name: normalizeImportCell(name.replace(/^[\s\-：:|,;]+|[\s\-：:|,;]+$/g, '')),
          url
        }
      }
    }

    const cells = parseDelimitedRow(trimmed)
    if (cells.length >= 2) {
      const urlIndex = cells.findIndex((cell) => isValidUrl(normalizeImportCell(cell)))
      if (urlIndex >= 0) {
        const url = normalizeImportCell(cells[urlIndex])
        const name = cells.filter((_, index) => index !== urlIndex).join(' ').trim()
        if (name) {
          return { name: normalizeImportCell(name), url }
        }
        return { name: extractFileName(url), url }
      }
    }

    return null
  }

  for (const line of lines) {
    const parsed = parseLine(line)
    if (!parsed) continue
    const name = normalizeImportCell(parsed.name)
    const url = normalizeImportCell(parsed.url)
    if (!url || !isValidUrl(url)) continue
    if (isImportHeaderAlias(name)) {
      continue
    }
    rows.push({ name: name || extractFileName(url), url })
  }

  return rows
}

/** 每行一个 URL 的纯文本批量解析 */
export const parseUrlLines = (rawText: string): string[] => {
  const lines = rawText.split('\n').map((line) => line.trim()).filter(Boolean)
  return lines.filter(isValidUrl)
}
