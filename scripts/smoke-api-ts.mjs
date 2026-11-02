import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const BASE = process.env.SMOKE_BASE || 'http://localhost:7101'
const DATA_DIR = path.join(tmpdir(), 'weshop-api-smoke')

mkdirSync(DATA_DIR, { recursive: true })
writeFileSync(path.join(DATA_DIR, 'empty.txt'), '')

// 1x1 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
)
const pngPath = path.join(DATA_DIR, 't.png')
writeFileSync(pngPath, PNG)

let passed = 0
let total = 0
function check(name, cond, extra = '') {
  total++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
  if (cond) passed++
}

const j = (r) => r.json()

// 跨段落共享：已支付并完成的订单号，供订单 CSV 导出过滤断言使用
let completedOrderNo = ''

// 健康检查
{
  const r = await fetch(`${BASE}/api/healthy`)
  const b = await j(r)
  check('GET /api/healthy 200 + ok', r.status === 200 && b.ok === true)
}

// 管理端登录与鉴权（初始账号见 apps/api/src/config.ts，默认 admin/admin123）
let adminAuth
{
  const bad = await fetch(`${BASE}/api/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'wrong-password' }),
  })
  check('POST /admin/auth/login 错误密码 401', bad.status === 401)

  const login = await fetch(`${BASE}/api/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  })
  const lb = await j(login)
  check('POST /admin/auth/login 200 + token', login.status === 200 && typeof lb.token === 'string' && lb.admin?.username === 'admin')
  adminAuth = { 'Content-Type': 'application/json', Authorization: `Bearer ${lb.token}` }

  const noTokenMe = await fetch(`${BASE}/api/admin/auth/me`)
  check('GET /admin/auth/me 无 token 401', noTokenMe.status === 401)

  const me = await fetch(`${BASE}/api/admin/auth/me`, { headers: adminAuth })
  check('GET /admin/auth/me 200', me.status === 200 && (await j(me)).admin?.username === 'admin')

  const noTokenOrders = await fetch(`${BASE}/api/admin/orders`)
  check('GET /admin/orders 无 token 401', noTokenOrders.status === 401)

  const noTokenUsers = await fetch(`${BASE}/api/users`)
  check('GET /users 无 token 401', noTokenUsers.status === 401)

  const noTokenStats = await fetch(`${BASE}/api/stats`)
  check('GET /stats 无 token 401', noTokenStats.status === 401)

  const noTokenCreate = await fetch(`${BASE}/api/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'x', price: 1, stock: 1 }),
  })
  check('POST /products 无 token 401', noTokenCreate.status === 401)

  const fd = new FormData()
  fd.append('file', new Blob([PNG], { type: 'image/png' }), 't.png')
  const noTokenUpload = await fetch(`${BASE}/api/uploads`, { method: 'POST', body: fd })
  check('POST /uploads 无 token 401', noTokenUpload.status === 401)
}

// 鉴权绕过回归：Express 5 路由忽略尾部斜杠且大小写不敏感，export.csv / stock-logs 的变形路径也必须 401
{
  const bypassPaths = [
    '/api/products/export.csv',
    '/api/products/export.csv/',
    '/api/products/EXPORT.CSV',
    '/api/products/1/stock-logs',
    '/api/products/1/stock-logs/',
    '/api/products/1/STOCK-LOGS',
  ]
  for (const p of bypassPaths) {
    const r = await fetch(`${BASE}${p}`)
    check(`GET ${p} 无 token 401（鉴权绕过回归）`, r.status === 401)
  }

  const csvOk = await fetch(`${BASE}/api/products/export.csv`, { headers: adminAuth })
  check('GET /api/products/export.csv 带 admin token 200', csvOk.status === 200)

  // 取一个真实存在的商品 id，避免开发库中 id=1 被删导致误判
  const first = (await j(await fetch(`${BASE}/api/products?pageSize=1`))).products[0]
  const logsOk = await fetch(`${BASE}/api/products/${first.id}/stock-logs`, { headers: adminAuth })
  check('GET /api/products/:id/stock-logs 带 admin token 200', logsOk.status === 200)
}

// 管理员改密与令牌吊销（默认打开发库，结尾必须改回 admin123 恢复初始态）
{
  const noToken = await fetch(`${BASE}/api/admin/auth/password`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ oldPassword: 'admin123', newPassword: 'Test@2026weshop' }),
  })
  check('PUT /admin/auth/password 无 token 401', noToken.status === 401)

  const wrongOld = await fetch(`${BASE}/api/admin/auth/password`, {
    method: 'PUT', headers: adminAuth,
    body: JSON.stringify({ oldPassword: 'wrong-old-password', newPassword: 'Test@2026weshop' }),
  })
  check('PUT /admin/auth/password 旧密码错误 400', wrongOld.status === 400 || wrongOld.status === 401)

  const weak = await fetch(`${BASE}/api/admin/auth/password`, {
    method: 'PUT', headers: adminAuth,
    body: JSON.stringify({ oldPassword: 'admin123', newPassword: 'short' }),
  })
  check('PUT /admin/auth/password 弱密码 400', weak.status === 400)

  const change = await fetch(`${BASE}/api/admin/auth/password`, {
    method: 'PUT', headers: adminAuth,
    body: JSON.stringify({ oldPassword: 'admin123', newPassword: 'Test@2026weshop' }),
  })
  const chb = await j(change)
  check('PUT /admin/auth/password 改密 200 + 返回新 token', change.status === 200 && typeof chb.token === 'string')

  const oldTokenMe = await fetch(`${BASE}/api/admin/auth/me`, { headers: adminAuth })
  check('改密后旧 token 调 /admin/auth/me 401（令牌已吊销）', oldTokenMe.status === 401)

  const newLogin = await fetch(`${BASE}/api/admin/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'Test@2026weshop' }),
  })
  check('新密码登录 200', newLogin.status === 200 && typeof (await j(newLogin)).token === 'string')

  // 改回 admin123，恢复环境初始态，避免污染开发库
  const revert = await fetch(`${BASE}/api/admin/auth/password`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${chb.token}` },
    body: JSON.stringify({ oldPassword: 'Test@2026weshop', newPassword: 'admin123' }),
  })
  check('改回 admin123 200（恢复初始态）', revert.status === 200)

  const relogin = await fetch(`${BASE}/api/admin/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  })
  const rlb = await j(relogin)
  check('恢复后 admin123 登录 200', relogin.status === 200 && typeof rlb.token === 'string')

  // 两轮改密使最早登录拿到的 adminAuth 令牌已吊销，后续段落统一换用恢复后的新令牌
  adminAuth = { 'Content-Type': 'application/json', Authorization: `Bearer ${rlb.token}` }
}

// 种子数据
let productId
{
  const r = await fetch(`${BASE}/api/products?pageSize=100`)
  const { products } = await j(r)
  check('GET /api/products 无 token 200 + 返回种子数据', r.status === 200 && products.length >= 8, `n=${products.length}`)
  productId = products[0].id

  check(
    '商品列表带 skus 且派生字段与 SKU 汇总一致',
    products.every(
      (p) =>
        Array.isArray(p.skus) &&
        p.skus.length >= 1 &&
        p.price === Math.min(...p.skus.map((s) => s.price)) &&
        p.stock === p.skus.reduce((sum, s) => sum + s.stock, 0)
    )
  )

  // data.db 为真实开发库，种子商品的状态/库存可能已被手工改动；统计正确性以「与列表数据对账」为准（阈值 LOW_STOCK_THRESHOLD=10）
  const s = await j(await fetch(`${BASE}/api/stats`, { headers: adminAuth }))
  const expectStats = {
    total: products.length,
    onShelf: products.filter((p) => p.status === 'on').length,
    offShelf: products.filter((p) => p.status === 'off').length,
    lowStock: products.filter((p) => p.stock < 10).length,
  }
  check(
    'GET /api/stats 统计正确',
    s.total === expectStats.total && s.onShelf === expectStats.onShelf && s.offShelf === expectStats.offShelf && s.lowStock === expectStats.lowStock,
    JSON.stringify(s)
  )

  const q = await j(await fetch(`${BASE}/api/products?search=${encodeURIComponent('耳机')}`))
  const hitEarphone = (p) => p.name.includes('耳机') || (p.description ?? '').includes('耳机')
  check(
    '搜索「耳机」结果与全量列表对账',
    q.products.length === products.filter(hitEarphone).length && q.products.every(hitEarphone),
    `n=${q.products.length} expect=${products.filter(hitEarphone).length}`
  )
}

// 参数校验
{
  const r = await fetch(`${BASE}/api/products`, {
    method: 'POST',
    headers: adminAuth,
    body: JSON.stringify({ name: '', price: -1 }),
  })
  const b = await j(r)
  check('POST 非法数据 400 + errors 数组', r.status === 400 && Array.isArray(b.errors) && b.errors.length >= 3, b.errors?.join('；'))

  const noSku = await fetch(`${BASE}/api/products`, {
    method: 'POST',
    headers: adminAuth,
    body: JSON.stringify({ name: '无规格商品', price: 1, stock: 1 }),
  })
  check('POST 缺少规格 400', noSku.status === 400)
}

// 图片上传
let uploadedUrl
{
  const fd = new FormData()
  fd.append('file', new Blob([PNG], { type: 'image/png' }), 't.png')
  const r = await fetch(`${BASE}/api/uploads`, { method: 'POST', headers: { Authorization: adminAuth.Authorization }, body: fd })
  const b = await j(r)
  uploadedUrl = b.url
  check('POST /api/uploads 201 + /uploads/ 路径', r.status === 201 && /^\/uploads\/.+\.png$/.test(b.url ?? ''), b.url)

  const img = await fetch(`${BASE}${uploadedUrl}`)
  check('上传文件可访问', img.status === 200 && (await img.arrayBuffer()).byteLength === PNG.length)
}

// 商品 CRUD（创建/更新均需携带 skus，价格/库存以规格为准派生）
{
  const create = await fetch(`${BASE}/api/products`, {
    method: 'POST',
    headers: adminAuth,
    body: JSON.stringify({
      name: '冒烟测试商品', category: '测试', price: 9.9, stock: 5, description: '', status: 'on',
      images: [uploadedUrl], skus: [{ name: '默认规格', price: 9.9, stock: 5 }],
    }),
  })
  const cb = await j(create)
  check('POST 创建商品 201 + 图片关联', create.status === 201 && cb.product?.images?.[0] === uploadedUrl, `id=${cb.product?.id}`)
  check('创建商品写入规格且派生字段一致', cb.product?.skus?.length === 1 && cb.product?.price === 9.9 && cb.product?.stock === 5)

  const detail = await fetch(`${BASE}/api/products/${cb.product.id}`)
  const detailBody = await j(detail)
  check(
    'GET /:id 返回商品详情（含 skus）',
    detail.status === 200 && detailBody.product?.id === cb.product.id && detailBody.product.images[0] === uploadedUrl &&
      detailBody.product.skus?.length === 1
  )

  const noDetail = await fetch(`${BASE}/api/products/99999`)
  check('GET /:id 不存在 404', noDetail.status === 404)

  const update = await fetch(`${BASE}/api/products/${cb.product.id}`, {
    method: 'PUT',
    headers: adminAuth,
    body: JSON.stringify({
      name: '冒烟测试商品 v2', category: '测试', price: 19.9, stock: 3, description: '', status: 'off',
      images: [], skus: [{ name: '升级版', price: 19.9, stock: 3 }],
    }),
  })
  const ub = await j(update)
  check(
    'PUT 更新商品（规格全量替换）',
    update.status === 200 && ub.product.name === '冒烟测试商品 v2' && ub.product.status === 'off' && ub.product.images.length === 0 &&
      ub.product.skus?.length === 1 && ub.product.skus[0].name === '升级版' && ub.product.price === 19.9 && ub.product.stock === 3
  )

  const patch = await fetch(`${BASE}/api/products/${cb.product.id}/status`, {
    method: 'PATCH',
    headers: adminAuth,
    body: JSON.stringify({ status: 'on' }),
  })
  check('PATCH 上下架', patch.status === 200 && (await j(patch)).product.status === 'on')

  const del = await fetch(`${BASE}/api/products/${cb.product.id}`, { method: 'DELETE', headers: adminAuth })
  check('DELETE 删除商品', del.status === 200 && (await j(del)).ok === true)
}

// 分类 CRUD + 重命名联动
{
  const create = await fetch(`${BASE}/api/categories`, {
    method: 'POST',
    headers: adminAuth,
    body: JSON.stringify({ name: '冒烟分类' }),
  })
  const cb = await j(create)
  check('POST 创建分类 201 + product_count', create.status === 201 && cb.category?.product_count === 0)

  const dup = await fetch(`${BASE}/api/categories`, {
    method: 'POST',
    headers: adminAuth,
    body: JSON.stringify({ name: '冒烟分类' }),
  })
  check('重复分类 400', dup.status === 400)

  const rename = await fetch(`${BASE}/api/categories/${cb.category.id}`, {
    method: 'PUT',
    headers: adminAuth,
    body: JSON.stringify({ name: '冒烟分类2' }),
  })
  check('PUT 重命名分类', rename.status === 200 && (await j(rename)).category.name === '冒烟分类2')

  const del = await fetch(`${BASE}/api/categories/${cb.category.id}`, { method: 'DELETE', headers: adminAuth })
  check('DELETE 空分类', del.status === 200)

  const used = db_categories_has_products()
  async function db_categories_has_products() {
    // 数码配件分类有商品，删除应被拒
    const list = await j(await fetch(`${BASE}/api/categories`))
    const digital = list.categories.find((c) => c.name === '数码配件')
    const r = await fetch(`${BASE}/api/categories/${digital.id}`, { method: 'DELETE', headers: adminAuth })
    return r.status === 400
  }
  check('DELETE 有商品的分类被拒绝', await used)
}

// 列表查询：分页 / 排序 / 分类筛选 / 低库存筛选（与全量列表对账，须在增删用例前跑）
{
  const all = (await j(await fetch(`${BASE}/api/products?pageSize=100`))).products

  const p2 = await j(await fetch(`${BASE}/api/products?page=2&pageSize=5`))
  check(
    '分页 page=2&pageSize=5',
    p2.page === 2 && p2.products.length === Math.min(5, Math.max(0, p2.total - 5)),
    `n=${p2.products.length} total=${p2.total}`
  )

  const asc = await j(await fetch(`${BASE}/api/products?sort=price&order=asc`))
  const prices = asc.products.map((p) => p.price)
  check('价格升序排序', prices.every((v, i) => i === 0 || prices[i - 1] <= v), prices.join(','))

  const cat = await j(await fetch(`${BASE}/api/products?category=${encodeURIComponent('数码配件')}`))
  const catExpect = all.filter((p) => p.category === '数码配件').length
  check('按分类筛选', cat.total === catExpect && cat.products.every((p) => p.category === '数码配件'), `total=${cat.total} expect=${catExpect}`)

  const low = await j(await fetch(`${BASE}/api/products?lowStock=1`))
  const lowExpect = all.filter((p) => p.stock < 10).length
  check('低库存筛选', low.total === lowExpect && low.products.every((p) => p.stock < 10), `total=${low.total} expect=${lowExpect}`)
}

// 库存调整（单规格商品走 PATCH /:id/stock，代理到唯一规格）
{
  const create = await fetch(`${BASE}/api/products`, {
    method: 'POST',
    headers: adminAuth,
    body: JSON.stringify({
      name: '库存测试', category: '测试', price: 1, stock: 5, description: '', status: 'on',
      images: [], skus: [{ name: '默认规格', price: 1, stock: 5 }],
    }),
  })
  const { product } = await j(create)

  const add = await fetch(`${BASE}/api/products/${product.id}/stock`, {
    method: 'PATCH',
    headers: adminAuth,
    body: JSON.stringify({ delta: 5 }),
  })
  const addBody = await j(add)
  check(
    'PATCH /stock 入库 +5（规格与派生库存同步）',
    add.status === 200 && addBody.product.stock === 10 && addBody.product.skus?.[0]?.stock === 10
  )

  const over = await fetch(`${BASE}/api/products/${product.id}/stock`, {
    method: 'PATCH',
    headers: adminAuth,
    body: JSON.stringify({ delta: -100 }),
  })
  check('PATCH /stock 库存不足 400', over.status === 400)

  const zero = await fetch(`${BASE}/api/products/${product.id}/stock`, {
    method: 'PATCH',
    headers: adminAuth,
    body: JSON.stringify({ delta: 0 }),
  })
  check('PATCH /stock 非法 delta 400', zero.status === 400)

  // 复制商品
  const dup = await fetch(`${BASE}/api/products/${product.id}/duplicate`, { method: 'POST', headers: adminAuth })
  const db = await j(dup)
  check(
    'POST /:id/duplicate 复制为下架副本（规格一并复制）',
    dup.status === 201 && db.product.name.endsWith('副本') && db.product.status === 'off' && db.product.stock === 10 &&
      db.product.skus?.length === 1 && db.product.skus[0].stock === 10
  )
  await fetch(`${BASE}/api/products/${db.product.id}`, { method: 'DELETE', headers: adminAuth })

  await fetch(`${BASE}/api/products/${product.id}`, { method: 'DELETE', headers: adminAuth })
}

// 多规格商品（SKU）与库存流水
{
  const create = await fetch(`${BASE}/api/products`, {
    method: 'POST',
    headers: adminAuth,
    body: JSON.stringify({
      name: '多规格冒烟', category: '测试', price: 10, stock: 12, description: '', status: 'on', images: [],
      skus: [
        { name: '红色', price: 10, stock: 5 },
        { name: '蓝色', price: 20, stock: 7 },
      ],
    }),
  })
  const cb = await j(create)
  const red = cb.product?.skus?.[0]
  check(
    'POST 创建双规格商品 201 + 派生 price/stock 正确',
    create.status === 201 && cb.product?.skus?.length === 2 && cb.product?.price === 10 && cb.product?.stock === 12,
    `price=${cb.product?.price} stock=${cb.product?.stock}`
  )

  const detail = await j(await fetch(`${BASE}/api/products/${cb.product.id}`))
  check(
    'GET /:id 详情 skus 与派生字段一致',
    detail.product?.skus?.length === 2 &&
      detail.product.price === Math.min(...detail.product.skus.map((s) => s.price)) &&
      detail.product.stock === detail.product.skus.reduce((sum, s) => sum + s.stock, 0)
  )

  const noTokenLogs = await fetch(`${BASE}/api/products/${cb.product.id}/stock-logs`)
  check('GET /:id/stock-logs 无 token 401', noTokenLogs.status === 401)

  const multiPatch = await fetch(`${BASE}/api/products/${cb.product.id}/stock`, {
    method: 'PATCH', headers: adminAuth, body: JSON.stringify({ delta: 1 }),
  })
  check('PATCH /:id/stock 多规格商品 400', multiPatch.status === 400)

  const skuPatch = await fetch(`${BASE}/api/products/${cb.product.id}/skus/${red.id}/stock`, {
    method: 'PATCH', headers: adminAuth, body: JSON.stringify({ delta: 3 }),
  })
  const sp = await j(skuPatch)
  check(
    'PATCH /:id/skus/:skuId/stock 入库 +3 且派生 stock 同步',
    skuPatch.status === 200 && sp.product?.skus?.find((s) => s.id === red.id)?.stock === 8 && sp.product?.stock === 15,
    `stock=${sp.product?.stock}`
  )

  const skuOver = await fetch(`${BASE}/api/products/${cb.product.id}/skus/${red.id}/stock`, {
    method: 'PATCH', headers: adminAuth, body: JSON.stringify({ delta: -100 }),
  })
  check('PATCH /skus/:skuId/stock 库存不足 400', skuOver.status === 400)

  const skuMissing = await fetch(`${BASE}/api/products/${cb.product.id}/skus/999999/stock`, {
    method: 'PATCH', headers: adminAuth, body: JSON.stringify({ delta: 1 }),
  })
  check('PATCH /skus/:skuId/stock 规格不存在 404', skuMissing.status === 404)

  const logs = (await j(await fetch(`${BASE}/api/products/${cb.product.id}/stock-logs`, { headers: adminAuth }))).logs
  check(
    'stock-logs 含两条 init 流水',
    logs.filter((l) => l.reason === 'init').length === 2 &&
      logs.some((l) => l.reason === 'init' && l.sku_id === red.id && l.delta === 5 && l.stock_after === 5),
    JSON.stringify(logs.map((l) => [l.reason, l.sku_name, l.delta]))
  )
  check(
    'stock-logs 含 adjust 流水（+3 后库存 8）',
    logs.some((l) => l.reason === 'adjust' && l.sku_id === red.id && l.delta === 3 && l.stock_after === 8)
  )

  await fetch(`${BASE}/api/products/${cb.product.id}`, { method: 'DELETE', headers: adminAuth })
}

// 批量操作
{
  const mk = async (name) => {
    const r = await fetch(`${BASE}/api/products`, {
      method: 'POST',
      headers: adminAuth,
      body: JSON.stringify({
        name, category: '测试', price: 1, stock: 1, description: '', status: 'on',
        images: [], skus: [{ name: '默认规格', price: 1, stock: 1 }],
      }),
    })
    return (await j(r)).product.id
  }
  const ids = [await mk('批量测试A'), await mk('批量测试B')]

  const bs = await fetch(`${BASE}/api/products/batch-status`, {
    method: 'POST',
    headers: adminAuth,
    body: JSON.stringify({ ids, status: 'off' }),
  })
  check('POST /batch-status 批量下架', bs.status === 200 && (await j(bs)).updated === 2)

  const bd = await fetch(`${BASE}/api/products/batch-delete`, {
    method: 'POST',
    headers: adminAuth,
    body: JSON.stringify({ ids }),
  })
  check('POST /batch-delete 批量删除', bd.status === 200 && (await j(bd)).deleted === 2)
}

// CSV 导出
{
  const r = await fetch(`${BASE}/api/products/export.csv`, { headers: adminAuth })
  const buf = new Uint8Array(await r.arrayBuffer())
  const text = new TextDecoder().decode(buf)
  const hasBom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf
  check(
    'GET /export.csv 200 + BOM + 表头',
    r.status === 200 && (r.headers.get('content-type') ?? '').includes('text/csv') && hasBom && text.includes('名称')
  )
  check('商品 export.csv 表头含「规格数」列', text.includes('规格数'))

  const low = await fetch(`${BASE}/api/products/export.csv?lowStock=1`, { headers: adminAuth })
  const lowText = await low.text()
  check('export.csv 低库存过滤', lowText.includes('智能手环 9') && !lowText.includes('机械键盘'))
}

// 分类排序与迁移删除
{
  const list = (await j(await fetch(`${BASE}/api/categories`))).categories
  const reversed = [...list].reverse().map((c) => c.id)
  const re = await fetch(`${BASE}/api/categories/reorder`, {
    method: 'PUT',
    headers: adminAuth,
    body: JSON.stringify({ ids: reversed }),
  })
  const reBody = await j(re)
  check('PUT /categories/reorder 生效', re.status === 200 && reBody.categories[0].id === list[list.length - 1].id)

  const badRe = await fetch(`${BASE}/api/categories/reorder`, {
    method: 'PUT',
    headers: adminAuth,
    body: JSON.stringify({ ids: [reversed[0]] }),
  })
  check('PUT /categories/reorder 非法 ids 400', badRe.status === 400)

  // 迁移删除：源分类有商品时无 migrateTo 拒绝，带 migrateTo 则迁移后删除
  const mkCat = async (name) => {
    const r = await fetch(`${BASE}/api/categories`, {
      method: 'POST',
      headers: adminAuth,
      body: JSON.stringify({ name }),
    })
    return (await j(r)).category
  }
  const src = await mkCat('迁移源')
  const dst = await mkCat('迁移目标')
  const pr = await fetch(`${BASE}/api/products`, {
    method: 'POST',
    headers: adminAuth,
    body: JSON.stringify({
      name: '待迁移商品', category: '迁移源', price: 1, stock: 1, description: '', status: 'on',
      images: [], skus: [{ name: '默认规格', price: 1, stock: 1 }],
    }),
  })
  const { product: mp } = await j(pr)

  const noMigrate = await fetch(`${BASE}/api/categories/${src.id}`, { method: 'DELETE', headers: adminAuth })
  check('有商品的分类无 migrateTo 删除 400', noMigrate.status === 400)

  const mig = await fetch(`${BASE}/api/categories/${src.id}?migrateTo=${encodeURIComponent('迁移目标')}`, { method: 'DELETE', headers: adminAuth })
  const migBody = await j(mig)
  const moved = await j(await fetch(`${BASE}/api/products?category=${encodeURIComponent('迁移目标')}`))
  check(
    'migrateTo 迁移删除成功且商品已迁移',
    mig.status === 200 && migBody.migrated === 1 && moved.products.some((p) => p.id === mp.id)
  )

  await fetch(`${BASE}/api/products/${mp.id}`, { method: 'DELETE', headers: adminAuth })
  await fetch(`${BASE}/api/categories/${dst.id}`, { method: 'DELETE', headers: adminAuth })
}

// 登录鉴权与地址管理（Mock 模式：openid = dev_<code>）
{
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'smoke-user-1' }),
  })
  const lb = await j(login)
  check('POST /auth/login Mock 登录 200 + token', login.status === 200 && typeof lb.token === 'string' && lb.user?.openid === 'dev_smoke-user-1')
  const token = lb.token
  const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }

  const noToken = await fetch(`${BASE}/api/auth/me`)
  check('GET /auth/me 无 token 401', noToken.status === 401)

  const me = await fetch(`${BASE}/api/auth/me`, { headers: auth })
  const mb = await j(me)
  check('GET /auth/me 200', me.status === 200 && mb.user?.id === lb.user.id)

  const badToken = await fetch(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${token}x` } })
  check('GET /auth/me 篡改 token 401', badToken.status === 401)

  const profile = await fetch(`${BASE}/api/auth/me`, {
    method: 'PUT', headers: auth, body: JSON.stringify({ nick_name: '冒烟用户' }),
  })
  check('PUT /auth/me 更新昵称', profile.status === 200 && (await j(profile)).user?.nick_name === '冒烟用户')

  const emptyProfile = await fetch(`${BASE}/api/auth/me`, {
    method: 'PUT', headers: auth, body: JSON.stringify({}),
  })
  check('PUT /auth/me 空资料 400', emptyProfile.status === 400)

  const noAuthAddr = await fetch(`${BASE}/api/addresses`)
  check('GET /addresses 无 token 401', noAuthAddr.status === 401)

  // 历史运行残留的地址会干扰「首条自动默认」等断言，先清空（也是本段的最终清理方式）
  const stale = await j(await fetch(`${BASE}/api/addresses`, { headers: auth }))
  for (const a of stale.addresses) {
    await fetch(`${BASE}/api/addresses/${a.id}`, { method: 'DELETE', headers: auth })
  }

  const mkAddr = (detail, is_default) => fetch(`${BASE}/api/addresses`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ receiver: '张三', phone: '13800138000', province: '广东省', city: '深圳市', district: '南山区', detail, is_default }),
  })
  const a1 = await j(await mkAddr('科技园路 1 号'))
  check('POST /addresses 首条自动默认 201', a1.address?.is_default === 1, `id=${a1.address?.id}`)
  const a2 = await j(await mkAddr('软件园二期 5 栋'))
  check('POST /addresses 第二条非默认', a2.address?.is_default === 0)

  const badPhone = await fetch(`${BASE}/api/addresses`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ receiver: '张三', phone: '123', province: '', city: '', district: '', detail: 'x' }),
  })
  check('POST /addresses 非法手机号 400', badPhone.status === 400)

  const setDef = await fetch(`${BASE}/api/addresses/${a2.address.id}/default`, { method: 'PATCH', headers: auth })
  check('PATCH /addresses/:id/default 切换默认', setDef.status === 200 && (await j(setDef)).address?.is_default === 1)

  const list = await j(await fetch(`${BASE}/api/addresses`, { headers: auth }))
  check('GET /addresses 默认在前', list.addresses.length === 2 && list.addresses[0].id === a2.address.id)

  const upd = await fetch(`${BASE}/api/addresses/${a2.address.id}`, {
    method: 'PUT', headers: auth,
    body: JSON.stringify({ receiver: '李四', phone: '13900139000', province: '广东省', city: '广州市', district: '天河区', detail: '新详细地址', is_default: true }),
  })
  check('PUT /addresses/:id 更新', upd.status === 200 && (await j(upd)).address?.detail === '新详细地址')

  const del = await fetch(`${BASE}/api/addresses/${a2.address.id}`, { method: 'DELETE', headers: auth })
  check('DELETE 删除默认地址 200', del.status === 200)
  const after = await j(await fetch(`${BASE}/api/addresses`, { headers: auth }))
  check('删除默认后自动提新默认', after.addresses.length === 1 && after.addresses[0].is_default === 1 && after.addresses[0].id === a1.address.id)

  const adminWithUserToken = await fetch(`${BASE}/api/admin/orders`, { headers: auth })
  check('GET /admin/orders 用户 token 401', adminWithUserToken.status === 401)

  const users = await j(await fetch(`${BASE}/api/users`, { headers: adminAuth }))
  const u = users.users.find((x) => x.id === lb.user.id)
  check('GET /users 含新用户且地址数正确', !!u && u.address_count === 1, `address_count=${u?.address_count}`)

  // 清理本段剩余地址，避免污染后续运行
  const rest = await j(await fetch(`${BASE}/api/addresses`, { headers: auth }))
  for (const a of rest.addresses) {
    await fetch(`${BASE}/api/addresses/${a.id}`, { method: 'DELETE', headers: auth })
  }
}

// 用户禁用 / 恢复（管理员操作；禁用后 C 端与登录均 403）
{
  // 若上次运行中断遗留禁用状态，先恢复，保证本组可重复执行
  const pre = await j(await fetch(`${BASE}/api/users`, { headers: adminAuth }))
  const preUser = pre.users.find((u) => u.openid === 'dev_smoke-user-ban')
  if (preUser?.status === 'disabled') {
    await fetch(`${BASE}/api/users/${preUser.id}/status`, {
      method: 'PATCH', headers: adminAuth, body: JSON.stringify({ status: 'normal' }),
    })
  }

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'smoke-user-ban' }),
  })
  const lb = await j(login)
  const banAuth = { 'Content-Type': 'application/json', Authorization: `Bearer ${lb.token}` }

  const badStatus = await fetch(`${BASE}/api/users/${lb.user.id}/status`, {
    method: 'PATCH', headers: adminAuth, body: JSON.stringify({ status: 'nope' }),
  })
  check('PATCH /users/:id/status 非法状态 400', badStatus.status === 400)

  const disable = await fetch(`${BASE}/api/users/${lb.user.id}/status`, {
    method: 'PATCH', headers: adminAuth, body: JSON.stringify({ status: 'disabled' }),
  })
  check('PATCH /users/:id/status 禁用 200', disable.status === 200 && (await j(disable)).user?.status === 'disabled')

  const me = await fetch(`${BASE}/api/auth/me`, { headers: banAuth })
  check('禁用后 C 端接口 403', me.status === 403)

  const cart = await fetch(`${BASE}/api/cart`, { headers: banAuth })
  check('禁用后购物车 403', cart.status === 403)

  const relogin = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'smoke-user-ban' }),
  })
  check('禁用后登录 403', relogin.status === 403)

  const enable = await fetch(`${BASE}/api/users/${lb.user.id}/status`, {
    method: 'PATCH', headers: adminAuth, body: JSON.stringify({ status: 'normal' }),
  })
  check('PATCH /users/:id/status 恢复 200', enable.status === 200 && (await j(enable)).user?.status === 'normal')

  const me2 = await fetch(`${BASE}/api/auth/me`, { headers: banAuth })
  check('恢复后 C 端接口 200', me2.status === 200)

  const relogin2 = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'smoke-user-ban' }),
  })
  check('恢复后登录 200', relogin2.status === 200)
}

// 购物车 + 订单 + 模拟支付全流程（加购/下单均按 SKU 进行）
{
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'smoke-user-2' }),
  })
  const { token, user: user2 } = await j(login)
  const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }

  // 清掉历史运行残留的地址，避免堆积（下单用地址快照，删除不影响已有订单）
  const staleAddr = await j(await fetch(`${BASE}/api/addresses`, { headers: auth }))
  for (const a of staleAddr.addresses) {
    await fetch(`${BASE}/api/addresses/${a.id}`, { method: 'DELETE', headers: auth })
  }

  const noToken = await fetch(`${BASE}/api/cart`)
  check('GET /cart 无 token 401', noToken.status === 401)

  const mkProduct = async (name, price, stock) => {
    const r = await fetch(`${BASE}/api/products`, {
      method: 'POST',
      headers: adminAuth,
      body: JSON.stringify({
        name, category: '测试', price, stock, description: '', status: 'on',
        images: [], skus: [{ name: '默认规格', price, stock }],
      }),
    })
    return (await j(r)).product
  }
  const p1 = await mkProduct('下单测试', 10, 3)
  const p1Sku = p1.skus[0]

  const noSkuAdd = await fetch(`${BASE}/api/cart`, {
    method: 'POST', headers: auth, body: JSON.stringify({ product_id: p1.id, quantity: 1 }),
  })
  check('POST /cart 缺 sku_id 400', noSkuAdd.status === 400)

  const add = await fetch(`${BASE}/api/cart`, {
    method: 'POST', headers: auth, body: JSON.stringify({ product_id: p1.id, sku_id: p1Sku.id, quantity: 2 }),
  })
  const addBody = await j(add)
  check('POST /cart 加购 201 + 合计正确', add.status === 201 && addBody.total_quantity === 2 && addBody.total_amount === 20, JSON.stringify({ q: addBody.total_quantity, a: addBody.total_amount }))
  check('加购响应带 sku_id / sku_name', addBody.items[0]?.sku_id === p1Sku.id && addBody.items[0]?.sku_name === p1Sku.name)

  const overAdd = await fetch(`${BASE}/api/cart`, {
    method: 'POST', headers: auth, body: JSON.stringify({ product_id: p1.id, sku_id: p1Sku.id, quantity: 2 }),
  })
  check('POST /cart 累加后超库存 400', overAdd.status === 400)

  const upd = await fetch(`${BASE}/api/cart/${addBody.items[0].id}`, {
    method: 'PUT', headers: auth, body: JSON.stringify({ quantity: 3 }),
  })
  check('PUT /cart/:id 改量 200', upd.status === 200 && (await j(upd)).total_quantity === 3)

  const addr = await j(await fetch(`${BASE}/api/addresses`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ receiver: '王五', phone: '13700137000', province: '浙江省', city: '杭州市', district: '西湖区', detail: '文三路 100 号' }),
  }))

  const badOrder = await fetch(`${BASE}/api/orders`, {
    method: 'POST', headers: auth, body: JSON.stringify({ source: { type: 'nope' }, address_id: addr.address.id }),
  })
  check('POST /orders 非法 source 400', badOrder.status === 400)

  const create = await fetch(`${BASE}/api/orders`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ source: { type: 'cart', item_ids: [addBody.items[0].id] }, address_id: addr.address.id, remark: '尽快发货' }),
  })
  const { order } = await j(create)
  check(
    'POST /orders 下单 201 + 金额/状态/快照正确',
    create.status === 201 && order?.total_amount === 30 && order?.status === 'pending' &&
      order?.items?.length === 1 && order.items[0].product_name === '下单测试' && order.items[0].price === 10 &&
      order?.receiver === '王五' && order?.remark === '尽快发货' && /^WS\d{20}$/.test(order?.order_no ?? ''),
    `order_no=${order?.order_no}`
  )
  check('订单明细快照带 sku_id / sku_name', order?.items?.[0]?.sku_id === p1Sku.id && order?.items?.[0]?.sku_name === p1Sku.name)

  const cartAfter = await j(await fetch(`${BASE}/api/cart`, { headers: auth }))
  check('下单后购物车已清空', cartAfter.items.length === 0)

  const pAfter = await j(await fetch(`${BASE}/api/products/${p1.id}`))
  check('下单后库存已扣减', pAfter.product.stock === 0 && pAfter.product.skus?.[0]?.stock === 0, `stock=${pAfter.product.stock}`)

  const noTokenLogs = await fetch(`${BASE}/api/products/${p1.id}/stock-logs`)
  check('stock-logs 无管理员 token 401', noTokenLogs.status === 401)

  const logs1 = (await j(await fetch(`${BASE}/api/products/${p1.id}/stock-logs`, { headers: adminAuth }))).logs
  check(
    'stock-logs 有 order 流水（delta 为负、ref 为订单号）',
    logs1.some((l) => l.reason === 'order' && l.delta === -3 && l.ref === order.order_no && l.stock_after === 0),
    JSON.stringify(logs1.map((l) => [l.reason, l.delta, l.ref]))
  )

  const soldOut = await fetch(`${BASE}/api/orders`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ source: { type: 'direct', product_id: p1.id, sku_id: p1Sku.id, quantity: 1 }, address_id: addr.address.id }),
  })
  check('库存耗尽再下单 400', soldOut.status === 400)

  const pay = await fetch(`${BASE}/api/orders/${order.id}/pay`, { method: 'POST', headers: auth })
  const payBody = await j(pay)
  check('POST /orders/:id/pay 模拟支付 200', pay.status === 200 && payBody.order?.status === 'paid' && !!payBody.order?.paid_at)

  const payAgain = await fetch(`${BASE}/api/orders/${order.id}/pay`, { method: 'POST', headers: auth })
  check('重复支付幂等 200', payAgain.status === 200 && (await j(payAgain)).order?.status === 'paid')

  const cancelPaid = await fetch(`${BASE}/api/orders/${order.id}/cancel`, { method: 'POST', headers: auth })
  check('已支付订单用户取消 400', cancelPaid.status === 400)

  const adminList = await j(await fetch(`${BASE}/api/admin/orders?keyword=${order.order_no}`, { headers: adminAuth }))
  check('GET /admin/orders 关键词搜索命中 + 买家昵称', adminList.total === 1 && adminList.orders[0].nick_name === '微信用户', `total=${adminList.total}`)

  const ship = await fetch(`${BASE}/api/admin/orders/${order.id}/ship`, { method: 'POST', headers: adminAuth })
  check('POST /admin/orders/:id/ship 发货 200', ship.status === 200 && (await j(ship)).order?.status === 'shipped')

  const confirm = await fetch(`${BASE}/api/orders/${order.id}/confirm`, { method: 'POST', headers: auth })
  check('POST /orders/:id/confirm 确认收货 200', confirm.status === 200 && (await j(confirm)).order?.status === 'completed')
  completedOrderNo = order.order_no

  // 取消回补库存路径
  const p2 = await mkProduct('取消测试', 5, 2)
  const p2Sku = p2.skus[0]

  const directNoSku = await fetch(`${BASE}/api/orders`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ source: { type: 'direct', product_id: p2.id, quantity: 1 }, address_id: addr.address.id }),
  })
  check('direct 下单缺 sku_id 400', directNoSku.status === 400)

  const o2res = await fetch(`${BASE}/api/orders`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ source: { type: 'direct', product_id: p2.id, sku_id: p2Sku.id, quantity: 2 }, address_id: addr.address.id }),
  })
  const { order: o2 } = await j(o2res)
  check(
    'direct 下单带 sku_id 201 + 明细快照含 sku_name',
    o2res.status === 201 && o2?.items?.[0]?.sku_id === p2Sku.id && o2?.items?.[0]?.sku_name === p2Sku.name
  )

  const cancel = await fetch(`${BASE}/api/orders/${o2.id}/cancel`, { method: 'POST', headers: auth, body: JSON.stringify({}) })
  const cancelBody = await j(cancel)
  const p2After = await j(await fetch(`${BASE}/api/products/${p2.id}`))
  check(
    '取消订单 200 + 库存回补',
    cancel.status === 200 && cancelBody.order?.status === 'cancelled' && !!cancelBody.order?.cancelled_at && p2After.product.stock === 2,
    `stock=${p2After.product.stock}`
  )

  const logs2 = (await j(await fetch(`${BASE}/api/products/${p2.id}/stock-logs`, { headers: adminAuth }))).logs
  check(
    'stock-logs 有 cancel 回补流水（delta 为正、ref 为订单号）',
    logs2.some((l) => l.reason === 'cancel' && l.delta === 2 && l.ref === o2.order_no && l.stock_after === 2),
    JSON.stringify(logs2.map((l) => [l.reason, l.delta, l.ref]))
  )

  // 用户详情统计与该用户订单分页
  const ud = await j(await fetch(`${BASE}/api/users/${user2.id}`, { headers: adminAuth }))
  check(
    'GET /users/:id 详情含统计字段与地址',
    ud.user?.order_count >= 2 && typeof ud.user?.total_spent === 'number' && ud.user.total_spent >= 30 &&
      Array.isArray(ud.user?.addresses) && ud.user.address_count >= 1,
    JSON.stringify({ order_count: ud.user?.order_count, total_spent: ud.user?.total_spent })
  )

  const uo = await j(await fetch(`${BASE}/api/users/${user2.id}/orders?page=1&pageSize=1`, { headers: adminAuth }))
  check(
    'GET /users/:id/orders 分页结构正确',
    uo.orders?.length === 1 && uo.total >= 2 && uo.page === 1 && uo.pageSize === 1 && Array.isArray(uo.orders?.[0]?.items),
    `total=${uo.total}`
  )

  // 数据统计仪表盘（数据跨运行累积，只做相对断言；此刻 p1/p2 尚未删除）
  const dash = await j(await fetch(`${BASE}/api/admin/stats/dashboard?days=7`, { headers: adminAuth }))
  check(
    'GET /admin/stats/dashboard 结构正确',
    dash.days === 7 && dash.trend?.length === 7 && dash.statusDistribution?.length === 5 &&
      Array.isArray(dash.topProducts) && Array.isArray(dash.categorySales)
  )
  check(
    'dashboard 概览计入本单成交',
    dash.overview?.totalOrders >= 2 && dash.overview?.todayOrders >= 2 &&
      dash.overview?.todayRevenue >= 30 && dash.overview?.totalUsers >= 2,
    JSON.stringify(dash.overview)
  )
  check(
    'dashboard 分类分布含「测试」且成交件数 >= 3',
    dash.categorySales?.some((c) => c.category === '测试' && c.quantity >= 3),
    JSON.stringify(dash.categorySales)
  )
  const dash30 = await j(await fetch(`${BASE}/api/admin/stats/dashboard?days=30`, { headers: adminAuth }))
  check('dashboard days=30 趋势长度 30', dash30.days === 30 && dash30.trend?.length === 30)

  // 越权：另一个用户访问该订单 / 购物车项
  const other = await j(await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'smoke-user-3' }),
  }))
  const otherAuth = { 'Content-Type': 'application/json', Authorization: `Bearer ${other.token}` }
  const steal = await fetch(`${BASE}/api/orders/${order.id}`, { headers: otherAuth })
  check('越权访问他人订单 404', steal.status === 404)

  await fetch(`${BASE}/api/products/${p1.id}`, { method: 'DELETE', headers: adminAuth })
  await fetch(`${BASE}/api/products/${p2.id}`, { method: 'DELETE', headers: adminAuth })
  // 下单用的是地址快照，删除地址不影响已生成的订单
  await fetch(`${BASE}/api/addresses/${addr.address.id}`, { method: 'DELETE', headers: auth })
}

// 订单 CSV 导出 + 孤儿上传文件清理（管理端）
{
  const noToken = await fetch(`${BASE}/api/admin/orders/export.csv`)
  check('GET /admin/orders/export.csv 无 token 401', noToken.status === 401)

  const r = await fetch(`${BASE}/api/admin/orders/export.csv`, { headers: adminAuth })
  const buf = new Uint8Array(await r.arrayBuffer())
  const text = new TextDecoder().decode(buf)
  const hasBom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf
  check(
    'GET /admin/orders/export.csv 200 + BOM + 中文表头',
    r.status === 200 && (r.headers.get('content-type') ?? '').includes('text/csv') && hasBom &&
      text.includes('订单号') && text.includes('买家昵称')
  )

  const filtered = await fetch(
    `${BASE}/api/admin/orders/export.csv?status=completed&keyword=${encodeURIComponent(completedOrderNo)}`,
    { headers: adminAuth }
  )
  const fText = await filtered.text()
  check(
    '订单 export.csv 按状态 + 关键词过滤命中',
    filtered.status === 200 && fText.includes(completedOrderNo) && fText.includes('已完成')
  )

  const noTokenClean = await fetch(`${BASE}/api/admin/uploads/cleanup`, { method: 'POST' })
  check('POST /admin/uploads/cleanup 无 token 401', noTokenClean.status === 401)

  const clean = await fetch(`${BASE}/api/admin/uploads/cleanup`, { method: 'POST', headers: adminAuth })
  const cleanBody = await j(clean)
  check(
    'POST /admin/uploads/cleanup 返回 {deleted, freedBytes} 非负数字',
    clean.status === 200 && Number.isInteger(cleanBody.deleted) && cleanBody.deleted >= 0 &&
      Number.isInteger(cleanBody.freedBytes) && cleanBody.freedBytes >= 0,
    JSON.stringify(cleanBody)
  )
}

// 404 与错误体
{
  const r = await fetch(`${BASE}/api/nope`)
  const b = await j(r)
  check('未知接口 404 + errors', r.status === 404 && Array.isArray(b.errors))

  const bad = await fetch(`${BASE}/api/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{invalid json',
  })
  check('非法 JSON 400', bad.status === 400)
}

console.log(`\n${passed}/${total} 通过`)
rmSync(DATA_DIR, { recursive: true, force: true })
process.exit(passed === total ? 0 : 1)
