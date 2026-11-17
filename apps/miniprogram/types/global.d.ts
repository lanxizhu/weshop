/// <reference types="@tarojs/taro" />

/** 由 Taro config 的 defineConstants 注入 */
declare const API_BASE: string

declare module '*.png' {
  const src: string
  export default src
}

declare module '*.scss'
