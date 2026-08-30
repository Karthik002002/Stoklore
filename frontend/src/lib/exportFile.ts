// Downloading a spreadsheet, a markdown file, or the same markdown to the clipboard.
//
// The xlsx writer here is deliberately hand-rolled: an .xlsx is a zip of a few XML parts, and
// writing one with no compression is ~60 lines - cheaper than adding a megabyte-class spreadsheet
// dependency for "export this table".

/** A cell as the exporters accept it: a number stays a number so Excel can sum the column. */
export type CellValue = string | number | null | undefined
export type SheetData = { sheet?: string; headers: CellValue[]; rows: CellValue[][] }

const enc = new TextEncoder()

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c >>> 0
  }
  return t
})()

function crc32(bytes: Uint8Array) {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Store-only (uncompressed) zip. Excel reads stored entries fine, and skipping deflate is what
 *  keeps this small enough to justify not taking a dependency. */
function zip(files: [string, string][], type: string) {
  // Uint8Array<ArrayBuffer>, not the plain alias: only an ArrayBuffer-backed view is a BlobPart,
  // and the default `ArrayBufferLike` (which includes SharedArrayBuffer) is not accepted by Blob.
  const parts: Uint8Array<ArrayBuffer>[] = []
  const dir: Uint8Array<ArrayBuffer>[] = []
  let offset = 0
  for (const [name, text] of files) {
    const nameB = enc.encode(name)
    const data = enc.encode(text)
    const crc = crc32(data)

    const local = new Uint8Array(30 + nameB.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint16(10, 0, true) // method: stored
    lv.setUint16(12, 0x21, true) // 1980-01-01, so the file hashes the same every run
    lv.setUint32(14, crc, true)
    lv.setUint32(18, data.length, true)
    lv.setUint32(22, data.length, true)
    lv.setUint16(26, nameB.length, true)
    local.set(nameB, 30)
    parts.push(local, data)

    const cen = new Uint8Array(46 + nameB.length)
    const cv = new DataView(cen.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(14, 0x21, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, data.length, true)
    cv.setUint32(24, data.length, true)
    cv.setUint16(28, nameB.length, true)
    cv.setUint32(42, offset, true)
    cen.set(nameB, 46)
    dir.push(cen)

    offset += local.length + data.length
  }

  const dirSize = dir.reduce((s, d) => s + d.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, dirSize, true)
  ev.setUint32(16, offset, true)

  return new Blob([...parts, ...dir, end], { type })
}

const xmlEscape = (v: unknown) =>
  String(v)
    // biome-ignore lint/suspicious/noControlCharactersInRegex: these are illegal in XML 1.0 and Excel rejects the file
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

function colName(i: number) {
  let s = ''
  for (let n = i; n >= 0; n = Math.floor(n / 26) - 1) s = String.fromCharCode(65 + (n % 26)) + s
  return s
}

const cell = (ref: string, v: CellValue) => {
  if (v == null || v === '') return ''
  if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(v)}</t></is></c>`
}

/** One sheet, header row bolded via a single style. Values are written as numbers when they are
 *  numbers, so Excel can sum a P&L column without the user retyping it. */
export function xlsxBlob({ sheet = 'Sheet1', headers, rows }: SheetData) {
  const body = [headers, ...rows]
    .map((r, y) => {
      const cells = r.map((v, x) => cell(`${colName(x)}${y + 1}`, y === 0 ? String(v) : v)).join('')
      return `<row r="${y + 1}"${y === 0 ? ' s="1"' : ''}>${cells}</row>`
    })
    .join('')

  const name = sheet.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || 'Sheet1'
  return zip(
    [
      [
        '[Content_Types].xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
      ],
      [
        '_rels/.rels',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      ],
      [
        'xl/workbook.xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEscape(name)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      ],
      [
        'xl/_rels/workbook.xml.rels',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
      ],
      [
        'xl/styles.xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf xfId="0"/><xf xfId="0" fontId="1" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
      ],
      [
        'xl/worksheets/sheet1.xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`,
      ],
    ],
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
}

const stamp = () => new Date().toISOString().slice(0, 10)

export function download(blobOrText: Blob | string, filename: string, type = 'text/plain;charset=utf-8') {
  const blob = typeof blobOrText === 'string' ? new Blob([blobOrText], { type }) : blobOrText
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export const downloadXlsx = (sheetData: SheetData, name: string) => download(xlsxBlob(sheetData), `${name}-${stamp()}.xlsx`)

export const downloadMd = (text: string, name: string) =>
  download(text, `${name}-${stamp()}.md`, 'text/markdown;charset=utf-8')

export const copyText = (text: string) => navigator.clipboard.writeText(text)

/** Markdown pipe table. Cell pipes are escaped - one unescaped `|` shifts every column after it. */
export function mdTable(headers: CellValue[], rows: CellValue[][]) {
  const cellText = (v: CellValue) => (v == null || v === '' ? '—' : String(v).replace(/\|/g, '\\|').replace(/\n/g, ' '))
  return [
    `| ${headers.map(cellText).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.map(cellText).join(' | ')} |`),
  ].join('\n')
}
