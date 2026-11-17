import type { Product, ProductListResult, ProductStats } from '@weshop/shared'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { adjustStock, fetchCategories, fetchProducts, fetchStats, onServerRecover } from '@/lib/api'
import Home from './Home'

vi.mock('@/lib/api', () => ({
  adjustStock: vi.fn(),
  batchDeleteProducts: vi.fn(),
  batchSetProductStatus: vi.fn(),
  cleanupUploads: vi.fn(),
  createProduct: vi.fn(),
  deleteProduct: vi.fn(),
  downloadProductsCsv: vi.fn(),
  duplicateProduct: vi.fn(),
  fetchCategories: vi.fn(),
  fetchProducts: vi.fn(),
  fetchStats: vi.fn(),
  onServerRecover: vi.fn(),
  setProductStatus: vi.fn(),
  updateProduct: vi.fn(),
}))

vi.mock('@/components/product-detail-drawer', () => ({
  ProductDetailDrawer: ({ product }: { product: Product | null }) => product
    ? <div data-testid="drawer-stock">{product.stock}</div>
    : null,
}))

vi.mock('@/components/product-form-dialog', () => ({
  ProductFormDialog: () => null,
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const EMPTY_STATS: ProductStats = { total: 0, onShelf: 0, offShelf: 0, totalValue: 0, lowStock: 0 }

function makeProduct(name: string, stock: number): Product {
  const now = '2026-11-17 10:00:00'
  return {
    id: 1,
    name,
    category: '测试',
    price: 10,
    stock,
    description: '',
    status: 'on',
    created_at: now,
    updated_at: now,
    images: [],
    skus: [{ id: 1, product_id: 1, name: '默认规格', price: 10, stock, image: '', sort_order: 0, created_at: now, updated_at: now }],
  }
}

function listResult(products: Product[]): ProductListResult {
  return { products, total: products.length, page: 1, pageSize: 10 }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(fetchCategories).mockResolvedValue({ categories: [] })
  vi.mocked(onServerRecover).mockReturnValue(() => {})
})

describe('home', () => {
  it('空库显示空状态与零值统计', async () => {
    vi.mocked(fetchProducts).mockResolvedValue(listResult([]))
    vi.mocked(fetchStats).mockResolvedValue(EMPTY_STATS)
    render(<Home />)

    expect(await screen.findByText('没有找到匹配的商品')).toBeInTheDocument()
    for (const [title, value] of [['商品总数', '0'], ['库存总价值', '¥0.00']] as const) {
      const card = screen.getByText(title).closest<HTMLElement>('[data-slot="card"]')
      expect(card).not.toBeNull()
      expect(within(card!).getByText(value)).toBeInTheDocument()
    }
  })

  it('搜索条件变化后忽略延迟返回的旧列表', async () => {
    const initial = deferred<ProductListResult>()
    const filtered = deferred<ProductListResult>()
    vi.mocked(fetchStats).mockResolvedValue(EMPTY_STATS)
    vi.mocked(fetchProducts).mockImplementation(params => params.search === '耳机' ? filtered.promise : initial.promise)
    render(<Home />)

    await waitFor(() => expect(fetchProducts).toHaveBeenCalledTimes(1))
    fireEvent.change(screen.getByPlaceholderText('搜索名称或描述…'), { target: { value: '耳机' } })
    await waitFor(() => expect(fetchProducts).toHaveBeenCalledTimes(2))

    await act(async () => {
      filtered.resolve(listResult([makeProduct('新耳机', 1)]))
      await filtered.promise
    })
    expect(await screen.findByText('新耳机')).toBeInTheDocument()

    await act(async () => {
      initial.resolve(listResult([makeProduct('旧商品', 1)]))
      await initial.promise
    })
    expect(screen.queryByText('旧商品')).not.toBeInTheDocument()
    expect(screen.getByText('新耳机')).toBeInTheDocument()
  })

  it('入库后同步列表、详情抽屉与统计卡片', async () => {
    const initial = makeProduct('测试商品', 10)
    const updated = makeProduct('测试商品', 11)
    vi.mocked(fetchProducts).mockResolvedValue(listResult([initial]))
    vi.mocked(fetchStats)
      .mockResolvedValueOnce({ ...EMPTY_STATS, total: 1, onShelf: 1, totalValue: 100 })
      .mockResolvedValueOnce({ ...EMPTY_STATS, total: 1, onShelf: 1, totalValue: 110 })
    vi.mocked(adjustStock).mockResolvedValue({ product: updated })
    render(<Home />)

    fireEvent.click(await screen.findByText('测试商品'))
    expect(screen.getByTestId('drawer-stock')).toHaveTextContent('10')
    fireEvent.click(screen.getByTitle('入库 1'))

    await waitFor(() => expect(screen.getByTestId('drawer-stock')).toHaveTextContent('11'))
    expect(adjustStock).toHaveBeenCalledWith(1, 1)
    expect(screen.getByTitle('入库 1').parentElement).toHaveTextContent('11')
    const totalValueCard = screen.getByText('库存总价值').closest<HTMLElement>('[data-slot="card"]')
    expect(totalValueCard).not.toBeNull()
    await waitFor(() => expect(within(totalValueCard!).getByText('¥110.00')).toBeInTheDocument())
  })
})
