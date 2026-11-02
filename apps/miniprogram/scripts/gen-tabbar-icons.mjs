/**
 * 生成自定义 tabBar 图标（无第三方依赖）：
 * 在 24×24 视窗内用 SDF 描边绘制图标，4× 超采样抗锯齿，输出 96×96 PNG。
 * 用法：node scripts/gen-tabbar-icons.mjs
 */
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/custom-tab-bar/icons')
const SIZE = 96 // 输出尺寸
const SS = 4 // 超采样倍数
const VB = 24 // 矢量视窗
const PX = (SIZE * SS) / VB // 每单位对应的渲染像素
const STROKE = 2 // 线宽（视窗单位）

const COLORS = {
  normal: [113, 113, 122], // #71717a 与 tabBar color 一致
  active: [24, 24, 27], // #18181b 与 selectedColor 一致
}

// ---------- SDF 基础 ----------
function sdSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1
  const dy = y2 - y1
  const l2 = dx * dx + dy * dy
  let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

function sdCircle(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r
}

function sdRoundBox(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r)
  const qy = Math.abs(py - cy) - (hh - r)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}

// 圆弧采样为折线（角度制，0° 朝右、顺时针为正，与屏幕 y 向下一致）
function arc(cx, cy, r, a0, a1) {
  const n = 36
  const segs = []
  for (let i = 0; i < n; i++) {
    const t0 = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180
    const t1 = ((a0 + ((a1 - a0) * (i + 1)) / n) * Math.PI) / 180
    segs.push([cx + r * Math.cos(t0), cy + r * Math.sin(t0), cx + r * Math.cos(t1), cy + r * Math.sin(t1)])
  }
  return segs
}

// 图元统一为 { d(x,y) => 有符号距离, fill/thin }：fill 按 d < 0 实心着色，其余按 |d| < STROKE/2 描边
function seg(...p) {
  return { d: (x, y) => sdSeg(x, y, ...p) }
}

function strokeCircle(cx, cy, r) {
  return { d: (x, y) => Math.abs(sdCircle(x, y, cx, cy, r)), thin: true }
}

function strokeRoundBox(cx, cy, hw, hh, r) {
  return { d: (x, y) => Math.abs(sdRoundBox(x, y, cx, cy, hw, hh, r)), thin: true }
}

function fillCircle(cx, cy, r) {
  return { d: (x, y) => sdCircle(x, y, cx, cy, r), fill: true }
}

const ICONS = {
  home: [
    // 屋顶
    seg(3, 9.6, 12, 3),
    seg(12, 3, 21, 9.6),
    // 墙体与底边
    seg(5.2, 8, 5.2, 20),
    seg(5.2, 20, 18.8, 20),
    seg(18.8, 20, 18.8, 8),
    // 门
    seg(9.6, 20, 9.6, 14.6),
    seg(9.6, 14.6, 14.4, 14.6),
    seg(14.4, 14.6, 14.4, 20),
  ],
  category: [
    strokeRoundBox(6.75, 6.75, 3.75, 3.75, 1.2),
    strokeRoundBox(17.25, 6.75, 3.75, 3.75, 1.2),
    strokeRoundBox(6.75, 17.25, 3.75, 3.75, 1.2),
    strokeRoundBox(17.25, 17.25, 3.75, 3.75, 1.2),
  ],
  cart: [
    // 把手 → 左壁 → 底边 → 右壁 → 顶边
    seg(1.8, 3, 4, 3),
    seg(4, 3, 6.4, 16.6),
    seg(6.4, 16.6, 19, 16.6),
    seg(19, 16.6, 21.2, 6.6),
    seg(21.2, 6.6, 5.5, 6.6),
    // 车轮
    fillCircle(9, 20.2, 1.55),
    fillCircle(16.9, 20.2, 1.55),
  ],
  mine: [
    strokeCircle(12, 8, 3.8),
    ...arc(12, 21.5, 8, 180, 360).map(s => seg(...s)),
  ],
}

// ---------- 栅格化 ----------
function render(prims, rgb) {
  const R = SIZE * SS
  const buf = new Float32Array(R * R)
  const half = STROKE / 2
  const aa = 1.2 / PX // 抗锯齿过渡带（视窗单位）
  for (let y = 0; y < R; y++) {
    for (let x = 0; x < R; x++) {
      const ux = (x + 0.5) / PX
      const uy = (y + 0.5) / PX
      let cov = 0
      for (const p of prims) {
        const d = p.d(ux, uy)
        const edge = p.fill ? 0 : half
        const c = 1 - Math.max(0, Math.min(1, (d - edge + aa) / (2 * aa)))
        if (c > cov) {
          cov = c
        }
      }
      buf[y * R + x] = cov
    }
  }
  // 盒滤波降采样
  const out = Buffer.alloc(SIZE * SIZE * 4)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let sum = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          sum += buf[(y * SS + sy) * R + x * SS + sx]
        }
      }
      const a = Math.round((sum / (SS * SS)) * 255)
      const o = (y * SIZE + x) * 4
      out[o] = rgb[0]
      out[o + 1] = rgb[1]
      out[o + 2] = rgb[2]
      out[o + 3] = a
    }
  }
  return out
}

// ---------- PNG 编码 ----------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
  }
  return c >>> 0
})

function crc32(buf) {
  let c = 0xFFFFFFFF
  for (const b of buf) {
    c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8)
  }
  return (c ^ 0xFFFFFFFF) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePNG(rgba, w, h) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0 // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---------- 主流程 ----------
fs.mkdirSync(OUT_DIR, { recursive: true })
for (const [name, prims] of Object.entries(ICONS)) {
  for (const [state, rgb] of Object.entries(COLORS)) {
    const file = path.join(OUT_DIR, `${name}${state === 'active' ? '-active' : ''}.png`)
    fs.writeFileSync(file, encodePNG(render(prims, rgb), SIZE, SIZE))
    console.log('✓', path.relative(process.cwd(), file))
  }
}
