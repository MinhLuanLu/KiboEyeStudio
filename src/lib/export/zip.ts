// Minimal ZIP writer — STORED (uncompressed) entries only, so no DEFLATE implementation is
// needed, just correct local/central-directory headers and CRC32. Hand-rolled instead of
// adding a dependency (no zip library exists in this project), consistent with this codebase's
// existing preference for small custom implementations over new packages (the RGB565 packer,
// the native-browser-parser tricks for HTML/CSS, etc.). Good enough for a handful of small
// generated text files — nothing here needs compression to be a reasonable download size.

let crcTable: Uint32Array | null = null

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  crcTable = table
  return table
}

function crc32(bytes: Uint8Array): number {
  const table = getCrcTable()
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function dosDateTime(date: Date): { time: number; date: number } {
  const time = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() >> 1) & 0x1f)
  const dosYear = Math.max(0, date.getFullYear() - 1980)
  const dateVal = ((dosYear & 0x7f) << 9) | (((date.getMonth() + 1) & 0xf) << 5) | (date.getDate() & 0x1f)
  return { time, date: dateVal }
}

class ByteWriter {
  private chunks: number[] = []
  u8(v: number) {
    this.chunks.push(v & 0xff)
  }
  u16(v: number) {
    this.chunks.push(v & 0xff, (v >>> 8) & 0xff)
  }
  u32(v: number) {
    this.chunks.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff)
  }
  bytes(b: Uint8Array) {
    for (let i = 0; i < b.length; i++) this.chunks.push(b[i])
  }
  toUint8Array(): Uint8Array {
    return new Uint8Array(this.chunks)
  }
}

export interface ZipEntry {
  name: string
  content: string | Uint8Array
}

export function createZip(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder()
  const { time, date } = dosDateTime(new Date())

  const out = new ByteWriter()
  const centralEntries: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name)
    const dataBytes = typeof entry.content === 'string' ? encoder.encode(entry.content) : entry.content
    const crc = crc32(dataBytes)

    const localHeaderStart = offset
    const local = new ByteWriter()
    local.u32(0x04034b50) // local file header signature
    local.u16(20) // version needed
    local.u16(0) // flags
    local.u16(0) // method: 0 = stored
    local.u16(time)
    local.u16(date)
    local.u32(crc)
    local.u32(dataBytes.length) // compressed size
    local.u32(dataBytes.length) // uncompressed size
    local.u16(nameBytes.length)
    local.u16(0) // extra field length
    local.bytes(nameBytes)
    local.bytes(dataBytes)
    const localBytes = local.toUint8Array()
    out.bytes(localBytes)
    offset += localBytes.length

    const central = new ByteWriter()
    central.u32(0x02014b50) // central directory header signature
    central.u16(20) // version made by
    central.u16(20) // version needed
    central.u16(0) // flags
    central.u16(0) // method
    central.u16(time)
    central.u16(date)
    central.u32(crc)
    central.u32(dataBytes.length)
    central.u32(dataBytes.length)
    central.u16(nameBytes.length)
    central.u16(0) // extra field length
    central.u16(0) // comment length
    central.u16(0) // disk number start
    central.u16(0) // internal attributes
    central.u32(0) // external attributes
    central.u32(localHeaderStart)
    central.bytes(nameBytes)
    centralEntries.push(central.toUint8Array())
  }

  const centralStart = offset
  let centralSize = 0
  for (const c of centralEntries) {
    out.bytes(c)
    centralSize += c.length
  }

  const eocd = new ByteWriter()
  eocd.u32(0x06054b50) // end of central directory signature
  eocd.u16(0) // disk number
  eocd.u16(0) // disk with central directory
  eocd.u16(entries.length) // entries on this disk
  eocd.u16(entries.length) // total entries
  eocd.u32(centralSize)
  eocd.u32(centralStart)
  eocd.u16(0) // comment length
  out.bytes(eocd.toUint8Array())

  return out.toUint8Array()
}
