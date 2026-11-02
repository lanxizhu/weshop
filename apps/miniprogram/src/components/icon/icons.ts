import type { IconNode } from 'lucide-react'
// WXML 不支持 <svg> 标签，lucide-react 的组件无法直接渲染；
// 这里只引入各图标的 __iconNode（纯路径数据），由 Icon 组件转成 base64 SVG 后用 <Image> 展示。
// 按需登记：用到的图标才加进注册表，避免全量打包（小程序包体限制）。
import { __iconNode as chevronRight } from 'lucide-react/dist/esm/icons/chevron-right'
import { __iconNode as clipboardList } from 'lucide-react/dist/esm/icons/clipboard-list'
import { __iconNode as mapPin } from 'lucide-react/dist/esm/icons/map-pin'
import { __iconNode as packageIcon } from 'lucide-react/dist/esm/icons/package'
import { __iconNode as truck } from 'lucide-react/dist/esm/icons/truck'
import { __iconNode as wallet } from 'lucide-react/dist/esm/icons/wallet'

export const ICON_NODES = {
  'chevron-right': chevronRight,
  'clipboard-list': clipboardList,
  'map-pin': mapPin,
  'package': packageIcon,
  truck,
  wallet,
} satisfies Record<string, IconNode>

export type IconName = keyof typeof ICON_NODES
