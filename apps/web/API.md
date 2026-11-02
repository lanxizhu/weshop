# Web 端请求层说明

`src/lib/api.ts` 是前端统一的 API 封装，基于 axios，内置**异常归一化**与**两级自动重试**。

## 快速使用

业务代码只需调用封装好的接口函数，无需关心重试逻辑：

```ts
import { createProduct, fetchProducts } from '@/lib/api'

const { products, total, page } = await fetchProducts({ search: '耳机', status: 'all', page: 1 })
await createProduct({ name: '新商品', price: 99, stock: 10, category: '数码配件', description: '', status: 'on', images: [] })
```

所有函数抛出的是带用户可读消息的 `Error`（例如「商品名称不能为空；价格必须是不小于 0 的数字」），直接用 `e.message` 展示即可。

## 接口一览

### 商品

| 函数 | 接口 | 说明 |
|---|---|---|
| `fetchProducts(params)` | `GET /api/products` | 列表，参数：`search`（名称/描述模糊）、`status`（on/off/all）、`category`（精确）、`lowStock: 1`、`sort`（price/stock/updated_at）、`order`（asc/desc）、`page` / `pageSize`（默认 10，上限 100）；返回 `{ products, total, page, pageSize }` |
| `fetchStats()` | `GET /api/stats` | 概览：`total / onShelf / offShelf / totalValue / lowStock`（库存 < 10 即低库存） |
| `createProduct(input)` | `POST /api/products` | 新建（含图片数组，最多 10 张） |
| `updateProduct(id, input)` | `PUT /api/products/:id` | 更新（图片全量替换） |
| `setProductStatus(id, status)` | `PATCH /api/products/:id/status` | 单个上/下架 |
| `adjustStock(id, delta)` | `PATCH /api/products/:id/stock` | 库存增减（原子操作，库存不足返回 400「库存不足，无法出库」） |
| `batchSetProductStatus(ids, status)` | `POST /api/products/batch-status` | 批量上/下架，返回 `{ updated }` |
| `batchDeleteProducts(ids)` | `POST /api/products/batch-delete` | 批量删除（图片级联清理），返回 `{ deleted }` |
| `duplicateProduct(id)` | `POST /api/products/:id/duplicate` | 复制商品：名称加「副本」，初始为下架状态，图片一并复制 |
| `deleteProduct(id)` | `DELETE /api/products/:id` | 删除 |
| `uploadImage(file)` | `POST /api/uploads` | 上传单张图片（≤5MB），返回 `/uploads/...` 路径 |
| `downloadProductsCsv(params)` | `GET /api/products/export.csv` | 导出 CSV（带 BOM，Excel 不乱码）；接口需管理员令牌，该函数走 axios blob 下载（自动带 Authorization，重试生效）；支持列表同款过滤参数，不分页（上限 5000 条） |

### 分类

| 函数 | 接口 | 说明 |
|---|---|---|
| `fetchCategories()` | `GET /api/categories` | 列表（按 `sort_order` 排序，附 `product_count`） |
| `createCategory(input)` | `POST /api/categories` | 新建（排在最后，名称 ≤ 20 字） |
| `updateCategory(id, input)` | `PUT /api/categories/:id` | 重命名，同步更新该分类下所有商品 |
| `reorderCategories(ids)` | `PUT /api/categories/reorder` | 按 ids 数组顺序重排（必须传入全部现有分类 id） |
| `deleteCategory(id, migrateTo?)` | `DELETE /api/categories/:id?migrateTo=` | 空分类直接删；有商品时必须传 `migrateTo`（目标分类名），先迁移商品再删除，返回 `{ ok, migrated }` |
| `fetchUsers()` | `GET /api/users` | 用户列表（按注册倒序，附 `address_count`） |

### 登录鉴权（管理端）

管理后台使用账号密码登录。`POST /api/admin/auth/login` 返回 `{ token, admin }`，前端把 token 存入 `localStorage`（`src/lib/auth.ts`），axios 请求拦截器自动携带 `Authorization: Bearer <token>`；任意接口返回 401 时自动清登录态并跳转 `/login`。

令牌与小程序端同为 HMAC-SHA256 自包含 token（有效期 30 天，密钥 `API_TOKEN_SECRET`），但 payload 带 `role: 'admin'`，C 端用户令牌访问管理端接口同样返回 401。

初始管理员在首次启动（`admins` 表为空）时由环境变量 `API_ADMIN_USERNAME` / `API_ADMIN_PASSWORD` 创建（默认 `admin` / `admin123`，生产环境务必覆盖）。密码以 scrypt 哈希存储。

| 函数 | 接口 | 说明 |
|---|---|---|
| `adminLogin(username, password)` | `POST /api/admin/auth/login` | 登录，返回 `{ token, admin }`；用户名或密码错误统一 401 |
| `fetchAdminMe()` | `GET /api/admin/auth/me` | 当前管理员，返回 `{ admin }` |

需管理员令牌的接口：`/api/admin/**` 全部、商品/分类全部写操作（POST/PUT/PATCH/DELETE）、`GET /api/stats`、`GET /api/users`、`GET /api/products/export.csv`。保持公开：`GET /api/products`、`GET /api/categories`（小程序 C 端在用）。`POST /api/uploads` 用户或管理员令牌皆可（小程序头像上传共用）。

### 登录鉴权（小程序端）

`POST /api/auth/login`：用 `wx.login` 的 `code` 换取登录态。配置了 `WX_APPID` / `WX_SECRET` 环境变量时走真实 `code2session`；未配置时为开发 Mock（openid = `dev_<code>`）。返回 `{ token, user }`。

令牌为 HMAC-SHA256 自包含 token（有效期 30 天，密钥由 `API_TOKEN_SECRET` 控制）。C 端接口需在请求头携带 `Authorization: Bearer <token>`；令牌缺失/失效统一返回 `401 { errors: ['请先登录'] }`。

| 接口 | 说明 |
|---|---|
| `POST /api/auth/login` | 登录/注册，body：`{ code, nickName?, avatarUrl? }`，返回 `{ token, user }` |
| `GET /api/auth/me` | 当前用户，返回 `{ user }` |
| `PUT /api/auth/me` | 更新资料，body：`{ nick_name?, avatar_url? }`（至少一个），返回 `{ user }` |

### 收货地址（小程序端，需登录）

| 接口 | 说明 |
|---|---|
| `GET /api/addresses` | 当前用户地址列表（默认地址在前），返回 `{ addresses }` |
| `POST /api/addresses` | 新建，body：`{ receiver, phone, province, city, district, detail, is_default? }`；首条自动设为默认；每人上限 20 条；返回 201 `{ address }` |
| `PUT /api/addresses/:id` | 更新（全量字段，校验归属当前用户），返回 `{ address }` |
| `PATCH /api/addresses/:id/default` | 设为默认地址，返回 `{ address }` |
| `DELETE /api/addresses/:id` | 删除；删的是默认地址且仍有剩余时自动把最新一条提为默认，返回 `{ ok }` |

### 购物车（小程序端，需登录）

全部接口需 `Authorization: Bearer <token>`，用户身份取自令牌。`CartItem` 含服务端 join 出的商品信息与 `subtotal` 小计；商品已下架或库存不足时标记 `invalid: true`（仍保留在购物车中展示，不计入合计）。加购/改数量后返回**完整购物车** `{ items, total_quantity, total_amount }`（合计只统计有效商品），前端直接整体替换本地状态即可。

| 接口 | 说明 |
|---|---|
| `GET /api/cart` | 购物车列表（按加入倒序），返回 `{ items, total_quantity, total_amount }` |
| `POST /api/cart` | 加购，body：`{ product_id, quantity }`；同商品已存在则累加数量（单项封顶 99 且不超过库存），返回 201 + 完整购物车 |
| `PUT /api/cart/:id` | 修改数量，body：`{ quantity }`（≥1，不超过库存），返回完整购物车 |
| `DELETE /api/cart/:id` | 删除购物车项，返回 `{ ok }` |

请求示例：

```http
POST /api/cart
Authorization: Bearer <token>
Content-Type: application/json

{ "product_id": 1, "quantity": 2 }
```

响应示例（201，POST 加购后；GET/PUT 结构相同）：

```json
{
  "items": [
    {
      "id": 3,
      "user_id": 1,
      "product_id": 1,
      "quantity": 2,
      "created_at": "2026-10-20 10:00:00",
      "updated_at": "2026-10-20 10:05:00",
      "name": "无线耳机",
      "price": 199,
      "stock": 50,
      "status": "on",
      "image": "/uploads/xxx.png",
      "subtotal": 398,
      "invalid": false
    }
  ],
  "total_quantity": 2,
  "total_amount": 398
}
```

常见错误：未登录 401；`商品不存在` 404；`商品已下架：xxx` / `库存不足：xxx 仅剩 N 件` 400；操作他人记录 404 `购物车记录不存在`。

### 订单（小程序端，需登录）

全部接口需 `Authorization: Bearer <token>`，只能读写本人订单。下单时**服务端计算金额**（不信任前端传值），在**事务内原子扣减库存**（任一商品库存不足/已下架则整单回滚），并写入商品快照（`order_items` 的 `product_name/product_image/price`）与收货地址快照（`receiver/phone/province/city/district/detail`），不随商品、地址后续编辑变化。取消订单会**回补库存**。

订单状态机（`OrderStatus`）：

```
pending（待支付）─ pay ──→ paid（待发货）─ ship(管理端) ─→ shipped（待收货）─ confirm ─→ completed（已完成）
    │                      │
    └──── cancel ──────────┴──── cancel(用户/商家) ──────→ cancelled（已取消，回补库存）
```

| 接口 | 说明 |
|---|---|
| `POST /api/orders` | 下单，body 见下；返回 201 `{ order }` |
| `GET /api/orders` | 本人订单列表，参数：`status`（all/pending/paid/shipped/completed/cancelled）、`page`、`pageSize`（默认 10，上限 50）；返回 `{ orders, total, page, pageSize }`，每条带 `items` 明细 |
| `GET /api/orders/:id` | 本人订单详情，返回 `{ order }` |
| `POST /api/orders/:id/pay` | 模拟支付：pending → paid（幂等，已支付直接返回成功），返回 `{ order }` |
| `POST /api/orders/:id/cancel` | 用户取消：仅 pending 可取消，body：`{ reason? }`（默认「用户取消」），回补库存，返回 `{ order }` |
| `POST /api/orders/:id/confirm` | 确认收货：shipped → completed，返回 `{ order }` |

下单 body 的 `source` 有两种形态（`CreateOrderSource`）：

```jsonc
// 购物车结算：item_ids 为选中的购物车项，下单成功后自动清理这些购物车项
{
  "source": { "type": "cart", "item_ids": [3, 5] },
  "address_id": 1,
  "remark": "周末再送"
}

// 立即购买：直接指定商品与数量
{
  "source": { "type": "direct", "product_id": 1, "quantity": 2 },
  "address_id": 1
}
```

响应示例（201，`POST /api/orders`；其他返回 `{ order }` 的接口结构相同）：

```json
{
  "order": {
    "id": 8,
    "order_no": "WS20261020103000123456",
    "user_id": 1,
    "status": "pending",
    "total_amount": 398,
    "receiver": "张三",
    "phone": "13800138000",
    "province": "广东省",
    "city": "深圳市",
    "district": "南山区",
    "detail": "xx 小区 1 栋 101",
    "remark": "周末再送",
    "paid_at": null,
    "shipped_at": null,
    "completed_at": null,
    "cancelled_at": null,
    "cancel_reason": "",
    "created_at": "2026-10-20 10:30:00",
    "updated_at": "2026-10-20 10:30:00",
    "items": [
      {
        "id": 12,
        "order_id": 8,
        "product_id": 1,
        "product_name": "无线耳机",
        "product_image": "/uploads/xxx.png",
        "price": 199,
        "quantity": 2,
        "created_at": "2026-10-20 10:30:00"
      }
    ]
  }
}
```

常见错误：未登录 401；`收货地址不存在` / `购物车选中项不存在，请刷新购物车` / `商品已下架：xxx` / `库存不足：xxx` 400；操作他人订单 404 `订单不存在`；状态不允许的操作 400（如「当前订单状态不可支付」）。

### 订单（管理端）

管理端接口需管理员令牌（见「登录鉴权（管理端）」）。`AdminOrder` = `Order` + `nick_name`（买家昵称，join users 得出）。前端对应函数见下表（`src/lib/api.ts`，重试与异常归一化自动生效）。

| 函数 | 接口 | 说明 |
|---|---|---|
| `fetchAdminOrders(params)` | `GET /api/admin/orders` | 订单列表，参数：`status`（all/pending/paid/shipped/completed/cancelled）、`keyword`（订单号/收货人模糊）、`page`、`pageSize`（默认 10，上限 50）；返回 `{ orders, total, page, pageSize }`，每条带 `items` 明细 |
| `fetchAdminOrder(id)` | `GET /api/admin/orders/:id` | 订单详情（含明细与买家昵称），返回 `{ order }` |
| `shipOrder(id)` | `POST /api/admin/orders/:id/ship` | 发货：paid → shipped；其他状态 400「仅待发货订单可发货」，返回 `{ order }` |
| `cancelAdminOrder(id, reason?)` | `POST /api/admin/orders/:id/cancel` | 商家取消：pending/paid → cancelled，body：`{}` 或 `{ reason }`（默认「商家取消」），事务内回补库存，返回 `{ order }` |

请求示例：

```http
GET /api/admin/orders?status=paid&keyword=张三&page=1&pageSize=10
```

```http
POST /api/admin/orders/8/cancel
Content-Type: application/json

{ "reason": "买家申请退款" }
```

响应示例（列表）：

```json
{
  "orders": [
    {
      "id": 8,
      "order_no": "WS20261020103000123456",
      "user_id": 1,
      "nick_name": "小明",
      "status": "paid",
      "total_amount": 398,
      "receiver": "张三",
      "phone": "13800138000",
      "province": "广东省",
      "city": "深圳市",
      "district": "南山区",
      "detail": "xx 小区 1 栋 101",
      "remark": "",
      "paid_at": "2026-10-20 10:35:00",
      "shipped_at": null,
      "completed_at": null,
      "cancelled_at": null,
      "cancel_reason": "",
      "created_at": "2026-10-20 10:30:00",
      "updated_at": "2026-10-20 10:35:00",
      "items": [
        {
          "id": 12,
          "order_id": 8,
          "product_id": 1,
          "product_name": "无线耳机",
          "product_image": "/uploads/xxx.png",
          "price": 199,
          "quantity": 2,
          "created_at": "2026-10-20 10:30:00"
        }
      ]
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 10
}
```

`{ order }` 响应结构与 C 端订单详情一致，仅多 `nick_name` 字段。常见错误：订单不存在 404；状态不允许的操作 400（如「当前订单状态不可取消」）。

### 数据统计（管理端）

经营仪表盘聚合接口，需管理员令牌。成交口径：`status IN ('paid','shipped','completed')` 的订单计入营收；趋势与「今日」均按订单创建日（`created_at`，本地时区）归集。

| 函数 | 接口 | 说明 |
|---|---|---|
| `fetchDashboard(days)` | `GET /api/admin/stats/dashboard?days=N` | 一次返回概览 + 趋势 + 分布 + 榜单；`days` 为趋势区间天数（默认 7，上限 90），前端固定传 7 / 30 |

响应结构（`DashboardStats`）：

```json
{
  "days": 7,
  "overview": {
    "todayOrders": 3,
    "todayRevenue": 428,
    "pendingShipment": 2,
    "totalOrders": 56,
    "totalRevenue": 12880.5,
    "totalUsers": 12
  },
  "trend": [
    { "date": "2026-10-14", "orders": 2, "revenue": 398 },
    { "date": "2026-10-15", "orders": 0, "revenue": 0 }
  ],
  "statusDistribution": [
    { "status": "pending", "count": 1, "amount": 99 },
    { "status": "paid", "count": 2, "amount": 398 }
  ],
  "topProducts": [
    { "product_id": 1, "product_name": "无线耳机", "product_image": "/uploads/xxx.png", "quantity": 12, "revenue": 2388 }
  ],
  "categorySales": [
    { "category": "数码配件", "quantity": 20, "revenue": 5600 }
  ]
}
```

- `trend` 固定 `days` 条、按日期升序，无订单的日期补 0，前端直接画图无需补点。
- `statusDistribution` 固定 5 项（pending/paid/shipped/completed/cancelled），无该状态订单时 `count` / `amount` 为 0。
- `topProducts` 为成交口径热销 Top 5（按件数排序）；`categorySales` 按成交额降序，商品已删除的明细归入「其他」。

## 异常处理

错误统一由 `toAppError()` 归一化：

| 错误来源 | 抛出消息 |
|---|---|
| 服务端返回 `{ errors: [...] }` | 数组拼接为「；」分隔的中文消息 |
| 网络层失败（断网 / 宕机 / 超时） | `服务连接失败，恢复后将自动重试` |
| 其他 | `请求失败，请重试` |

## 重试策略

仅**网络层失败**（axios 错误且无 response）触发重试，HTTP 4xx/5xx 业务错误不重试。

```
请求失败
   │
   ├─ L1 即时重试：指数退避重试 immediateRetries 次（默认 2 次：~1s → ~2s，20% 随机抖动）
   │      └─ 成功 → 正常返回
   │
   └─ L2 恢复重试：请求按 method+url+body 去重入队
          每 healthCheckInterval（默认 3s）轮询 GET /api/healthy
          拿到任意响应即判定恢复 → 逐个重放队列 → 触发 onServerRecover 事件
```

关键行为：

- **首次失败即入队**并开始健康探测，不等即时重试耗尽，恢复发现更快。
- **重试与重放互斥**：每次即时重试前先从队列移除该请求，避免与健康探测的重放叠加导致重复写入；请求成功或遇到业务错误也会移出队列。
- 重放期间服务再次宕机，请求会重新排队等下一轮恢复。
- 相同的失败请求（如连续搜索触发相同 GET）在队列中去重，只保留最后一次。

### 配置

默认即可满足大部分场景；如需调整（或测试中加速），使用 `configureRetry`：

```ts
import { configureRetry } from '@/lib/api'

configureRetry({
  immediateRetries: 3, // 即时重试次数（默认 2）
  backoffBaseMs: 500, // 退避基数（默认 1000），第 N 次等待 backoffBaseMs × 2ⁿ
  healthCheckInterval: 5000, // 健康探测间隔（默认 3000ms）
})
```

注意：健康探测会随页面存活持续轮询，不要把 `healthCheckInterval` 设得过小，避免给恢复中的服务增加压力。

### 服务恢复事件

页面可订阅恢复事件以刷新数据（`Home.tsx` / `Categories.tsx` 已接入）：

```ts
import { onServerRecover } from '@/lib/api'

useEffect(() => {
  return onServerRecover(() => {
    // 服务已恢复且失败请求已重放完成，重新拉取最新数据
    load()
  })
}, [load])
```

## 后端依赖

L2 恢复重试依赖 API 服务的健康检查接口（已在 `apps/api/src/routes/healthy.ts` 提供）：

```
GET /api/healthy → 200 { "ok": true, "uptime": 60 }
```

接口非常轻量（不查数据库），可直接用于负载均衡探活。删除该接口后，L2 自动重放将无法工作，但 L1 即时重试不受影响。

## 新增接口的步骤

在 `api.ts` 中仿照现有函数添加即可，重试与异常处理自动生效：

```ts
export function fetchSomething(id: number) {
  return request<Something>(`/something/${id}`)
}

// 上传等非 JSON 请求使用 executeWithRetry 包裹：
export function uploadFile(file: File) {
  const fd = new FormData()
  fd.append('file', file)
  const config = { method: 'POST', url: '/uploads', data: fd }
  return executeWithRetry(config, async () => {
    const res = await http.request<{ url: string }>(config)
    return res.data.url
  })
}
```
