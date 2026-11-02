import type { CSSProperties } from 'react'
import type { IconName } from './icons'
import { Image } from '@tarojs/components'
import { ICON_NODES } from './icons'

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** 小程序 JSCore 不保证有 btoa，这里手写 UTF-8 → base64 */
function toBase64(input: string): string {
  const encoded = encodeURIComponent(input)
  const bytes: number[] = []
  for (let i = 0; i < encoded.length; i++) {
    if (encoded[i] === '%') {
      bytes.push(Number.parseInt(encoded.slice(i + 1, i + 3), 16))
      i += 2
    }
    else {
      bytes.push(encoded.charCodeAt(i))
    }
  }
  let output = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    output += B64_CHARS[a >> 2]
    output += B64_CHARS[((a & 3) << 4) | ((b ?? 0) >> 4)]
    output += b === undefined ? '=' : B64_CHARS[((b & 15) << 2) | ((c ?? 0) >> 6)]
    output += c === undefined ? '=' : B64_CHARS[c & 63]
  }
  return output
}

function buildSvg(name: IconName, size: number, color: string, strokeWidth: number): string {
  const children = ICON_NODES[name]
    .map(([tag, attrs]) => {
      const attrString = Object.entries(attrs)
        .filter(([key]) => key !== 'key')
        .map(([key, value]) => ` ${key}="${value}"`)
        .join('')
      return `<${tag}${attrString}/>`
    })
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${children}</svg>`
}

export interface IconProps {
  name: IconName
  size?: number
  color?: string
  strokeWidth?: number
  className?: string
  style?: CSSProperties
}

export function Icon({ name, size = 24, color = '#333333', strokeWidth = 2, className, style }: IconProps) {
  const src = `data:image/svg+xml;base64,${toBase64(buildSvg(name, size, color, strokeWidth))}`
  return (
    <Image
      className={className ? `weshop-icon ${className}` : 'weshop-icon'}
      style={{ width: `${size}px`, height: `${size}px`, ...style }}
      src={src}
      mode="aspectFit"
    />
  )
}
