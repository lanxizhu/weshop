/**
 * 自定义 tabBar 的全局状态（当前选中项 + 购物车角标数量）。
 * tabBar 组件与页面共享同一 JS 上下文，模块级单例即可；
 * 选中态由各 tab 页在 useDidShow 中上报，角标由购物车相关操作后同步。
 */

/** tab 序号：首页 0 / 分类 1 / 购物车 2 / 我的 3 */
export const TAB_INDEX = { home: 0, category: 1, cart: 2, mine: 3 } as const

export interface TabbarState {
  selected: number
  cartCount: number
}

let state: TabbarState = { selected: 0, cartCount: 0 }
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach(fn => fn())
}

/** useSyncExternalStore 的 snapshot：不可变引用，未变化时返回同一对象 */
export function getTabbarState(): TabbarState {
  return state
}

export function subscribeTabbar(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function setTabSelected(selected: number) {
  if (state.selected === selected)
    return
  state = { ...state, selected }
  emit()
}

export function setCartBadge(cartCount: number) {
  if (state.cartCount === cartCount)
    return
  state = { ...state, cartCount }
  emit()
}
