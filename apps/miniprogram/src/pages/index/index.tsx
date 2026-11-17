import type { Category, Product } from '@weshop/shared'
import { Input, ScrollView, View } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh, useReachBottom } from '@tarojs/taro'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ProductCard } from '@/components/product-card'
import { PAGE_SIZE } from '@/constants'
import { fetchCategories, fetchProducts } from '@/services/api'
import { setTabSelected, TAB_INDEX } from '@/services/tabbar'
import { LatestRequest } from '@/utils/latest-request'
import { toast } from '@/utils/toast'
import './index.scss'

export default function Index() {
  useDidShow(() => setTabSelected(TAB_INDEX.home))
  const [search, setSearch] = useState('')
  const [keyword, setKeyword] = useState('')
  const [categories, setCategories] = useState<Category[]>([])
  const [activeCategory, setActiveCategory] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const latestRequestRef = useRef(new LatestRequest())

  useEffect(() => () => latestRequestRef.current.invalidate(), [])

  useEffect(() => {
    fetchCategories()
      .then(res => setCategories(res.categories))
      .catch(() => {})
  }, [])

  // 搜索防抖 300ms，防抖后的词才真正触发查询
  useEffect(() => {
    const timer = setTimeout(() => setKeyword(search.trim()), 300)
    return () => clearTimeout(timer)
  }, [search])

  const load = useCallback(
    async (pageNum: number, replace: boolean) => {
      const requestId = latestRequestRef.current.next()
      setLoading(true)
      try {
        const res = await fetchProducts({
          search: keyword,
          category: activeCategory,
          status: 'on',
          page: pageNum,
          pageSize: PAGE_SIZE,
        })
        if (!latestRequestRef.current.isLatest(requestId))
          return
        setTotal(res.total)
        setPage(pageNum)
        setProducts(prev => (replace ? res.products : [...prev, ...res.products]))
      }
      catch (err) {
        if (latestRequestRef.current.isLatest(requestId))
          toast(err, '加载失败')
      }
      finally {
        if (latestRequestRef.current.isLatest(requestId))
          setLoading(false)
      }
    },
    [keyword, activeCategory],
  )

  // 筛选条件变化时回到第一页
  useEffect(() => {
    load(1, true)
  }, [load])

  usePullDownRefresh(async () => {
    await load(1, true)
    Taro.stopPullDownRefresh()
  })

  const hasMore = products.length < total

  useReachBottom(() => {
    if (!loading && hasMore)
      load(page + 1, false)
  })

  return (
    <View className="index-page">
      <View className="search-bar">
        <Input
          className="search-bar__input"
          placeholder="搜索商品名称或描述"
          confirmType="search"
          value={search}
          onInput={e => setSearch(e.detail.value)}
        />
      </View>

      <ScrollView className="category-bar" scrollX enableFlex>
        <View
          className={`category-bar__item ${activeCategory === '' ? 'is-active' : ''}`}
          onClick={() => setActiveCategory('')}
        >
          全部
        </View>
        {categories.map(c => (
          <View
            key={c.id}
            className={`category-bar__item ${activeCategory === c.name ? 'is-active' : ''}`}
            onClick={() => setActiveCategory(c.name)}
          >
            {c.name}
          </View>
        ))}
      </ScrollView>

      <View className="product-grid">
        {products.map(p => (
          <ProductCard key={p.id} product={p} />
        ))}
      </View>

      {!loading && products.length === 0 && <View className="list-state">暂无相关商品</View>}
      {loading && <View className="list-state">加载中…</View>}
      {!loading && products.length > 0 && !hasMore && <View className="list-state">已经到底啦</View>}
    </View>
  )
}
