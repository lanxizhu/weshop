import { describe, expect, it } from 'vitest'
import { hasMatchingImageSignature } from './image-sniff.js'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

describe('hasMatchingImageSignature', () => {
  it('识别 PNG 文件头', () => {
    expect(hasMatchingImageSignature(PNG, 'image/png')).toBe(true)
    expect(hasMatchingImageSignature(PNG, 'image/jpeg')).toBe(false)
  })

  it('识别 JPEG 文件头', () => {
    expect(hasMatchingImageSignature(Uint8Array.from([0xFF, 0xD8, 0xFF, 0xE0]), 'image/jpeg')).toBe(true)
  })

  it('识别 GIF87a / GIF89a', () => {
    expect(hasMatchingImageSignature(Buffer.from('GIF87a'), 'image/gif')).toBe(true)
    expect(hasMatchingImageSignature(Buffer.from('GIF89a'), 'image/gif')).toBe(true)
  })

  it('识别 RIFF WEBP 双文件头', () => {
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')])
    expect(hasMatchingImageSignature(webp, 'image/webp')).toBe(true)
    expect(hasMatchingImageSignature(Buffer.from('RIFF----NOPE'), 'image/webp')).toBe(false)
  })

  it('识别 AVIF 主品牌及兼容品牌', () => {
    expect(hasMatchingImageSignature(Buffer.from('0000ftypavif'), 'image/avif')).toBe(true)
    expect(hasMatchingImageSignature(Buffer.from('0000ftypmif1avif'), 'image/avif')).toBe(true)
    expect(hasMatchingImageSignature(Buffer.from('0000ftypmif1heic'), 'image/avif')).toBe(false)
  })

  it('拒绝空文件、未知 MIME 和伪造图片', () => {
    expect(hasMatchingImageSignature(Buffer.alloc(0), 'image/png')).toBe(false)
    expect(hasMatchingImageSignature(PNG, 'application/octet-stream')).toBe(false)
    expect(hasMatchingImageSignature(Buffer.from('<script>alert(1)</script>'), 'image/png')).toBe(false)
  })
})
