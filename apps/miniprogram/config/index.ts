import type { IProjectConfig } from '@tarojs/taro/types/compile'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@tarojs/cli'
import devConfig from './dev'
import prodConfig from './prod'

const dirname = path.dirname(fileURLToPath(import.meta.url))

// @weshop/shared 是纯 TS 源码的 workspace 包，需显式加入编译范围
const sharedSrc = fs.realpathSync(path.resolve(dirname, '../node_modules/@weshop/shared/src'))

export default defineConfig(async (merge) => {
  const baseConfig: IProjectConfig = {
    projectName: 'weshop-miniprogram',
    date: '2026-10-15',
    designWidth: 750,
    deviceRatio: {
      640: 2.34,
      750: 1,
      375: 2,
      828: 1.81,
    },
    sourceRoot: 'src',
    outputRoot: 'dist',
    alias: {
      '@': path.resolve(dirname, '../src'),
    },
    plugins: [],
    defineConstants: {},
    copy: {
      patterns: [],
      options: {},
    },
    framework: 'react',
    compiler: 'webpack5',
    cache: { enable: true },
    logger: { quiet: false, stats: true },
    mini: {
      webpackChain(chain) {
        // @weshop/shared 源码以 NodeNext 惯例用 .js 后缀引用 TS 文件
        chain.resolve.set('extensionAlias', {
          '.js': ['.ts', '.tsx', '.js'],
          '.jsx': ['.tsx', '.jsx'],
        })
      },
      postcss: {
        pxtransform: { enable: true, config: {} },
        cssModules: { enable: false },
      },
      compile: { include: [sharedSrc] },
    },
  }
  if (process.env.NODE_ENV === 'development') {
    return merge({}, baseConfig, devConfig)
  }
  return merge({}, baseConfig, prodConfig)
})
