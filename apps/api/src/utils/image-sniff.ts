function ascii(content: Uint8Array, start: number, end: number): string {
  return Buffer.from(content.buffer, content.byteOffset, content.byteLength).toString('ascii', start, end)
}

function startsWith(content: Uint8Array, signature: number[]): boolean {
  return content.length >= signature.length && signature.every((byte, index) => content[index] === byte)
}

function isAvif(content: Uint8Array): boolean {
  if (content.length < 12 || ascii(content, 4, 8) !== 'ftyp') return false
  const end = Math.min(content.length, 32)
  for (let offset = 8; offset + 4 <= end; offset += 4) {
    const brand = ascii(content, offset, offset + 4)
    if (brand === 'avif' || brand === 'avis') return true
  }
  return false
}

/** 同时校验实际文件头与声明 MIME，防止改扩展名或 Content-Type 上传其他文件 */
export function hasMatchingImageSignature(content: Uint8Array, mimeType: string): boolean {
  switch (mimeType) {
    case 'image/jpeg':
      return startsWith(content, [0xFF, 0xD8, 0xFF])
    case 'image/png':
      return startsWith(content, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
    case 'image/gif':
      return ascii(content, 0, 6) === 'GIF87a' || ascii(content, 0, 6) === 'GIF89a'
    case 'image/webp':
      return content.length >= 12 && ascii(content, 0, 4) === 'RIFF' && ascii(content, 8, 12) === 'WEBP'
    case 'image/avif':
      return isAvif(content)
    default:
      return false
  }
}
