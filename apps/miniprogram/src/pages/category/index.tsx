import type { Category, Product } from '@weshop/shared'
import { ScrollView, View } from '@tarojs/components'
import { useDidShow } from '@tarojs/taro'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ProductCard } from '@/components/product-card'
import { PAGE_SIZE } from '@/constants'
import { fetchCategories, fetchProducts } from '@/services/api'
import { setTabSelected, TAB_INDEX } from '@/services/tabbar'
import { LatestRequest } from '@/utils/latest-request'
import { toast } from '@/utils/toast'
import './index.scss'

export default function CategoryPage() {
  useDidShow(() => setTabSelected(TAB_INDEX.category))
  const [categories, setCategories] = useState<Category[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const latestRequestRef = useRef(new LatestRequest())

  useEffect(() => () => latestRequestRef.current.invalidate(), [])

  // 首次进入加载分类，默认选中第一个
  useEffect(() => {
    fetchCategories()
      .then((res) => {
        setCategories(res.categories)
        if (res.categories.length > 0)
          setActiveId(res.categories[0].id)
        else setLoading(false)
      })
      .catch((err) => {
        setLoading(false)
        toast(err, '加载失败')
      })
  }, [])

  const activeCategory = categories.find(c => c.id === activeId)
  const activeName = activeCategory?.name ?? ''

  const load = useCallback(
    async (pageNum: number, replace: boolean) => {
      if (!activeName)
        return
      const requestId = latestRequestRef.current.next()
      if (replace)
        setProducts([])
      setLoading(true)
      try {
        const res = await fetchProducts({ category: activeName, status: 'on', page: pageNum, pageSize: PAGE_SIZE })
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
    [activeName],
  )

  // 切换分类时回到第一页
  useEffect(() => {
    load(1, true)
  }, [load])

  const hasMore = products.length < total

  const handleScrollToLower = () => {
    if (!loading && hasMore)
      load(page + 1, false)
  }

  return (
    <View className="category-page">
      <ScrollView className="category-page__side" scrollY>
        {categories.map(c => (
          <View
            key={c.id}
            className={`side-item ${c.id === activeId ? 'is-active' : ''}`}
            onClick={() => setActiveId(c.id)}
          >
            {c.name}
          </View>
        ))}
      </ScrollView>

      <ScrollView
        className="category-page__main"
        scrollY
        lowerThreshold={60}
        onScrollToLower={handleScrollToLower}
      >
        <View className="category-page__list">
          {products.map(p => (
            <ProductCard key={p.id} product={p} />
          ))}
        </View>
        {!loading && activeName && products.length === 0 && (
          <View className="list-state">该分类暂无商品</View>
        )}
        {loading && <View className="list-state">加载中…</View>}
        {!loading && products.length > 0 && !hasMore && <View className="list-state">已经到底啦</View>}
      </ScrollView>
    </View>
  )
}
