/**
 * 演示数据种子脚本（幂等，可重复执行）
 *
 * 用法：pnpm seed（等价于 pnpm --filter api seed）
 * 可用 API_DB_PATH 覆盖目标数据库（默认 apps/api/server/data.db）；空库会自动初始化表结构。
 *
 * 行为：
 * - 按分类名 / 商品名 / 规格名判重，已存在则跳过，不会产生重复数据
 * - 新商品的 SKU 初始库存写入 stock_logs（reason='init', operator='system:seed'）
 * - 写入后按 SKU 同步 products 的派生字段（price=最低价, stock=总库存）
 * - 对 3 个存量商品做规格扩展（默认规格改名 + 新增规格）
 */

import process from 'node:process'
import { db, inTransaction, syncProductDerivedFields, writeStockLog } from '../src/db.js'

// ---------- 数据定义 ----------

const NEW_CATEGORIES = [
  '数码配件',
  '家用电器',
  '智能穿戴',
  '生活日用',
  '运动户外',
  '食品饮料',
  '美妆个护',
  '母婴用品',
  '图书文创',
  '家居家装',
  '宠物用品',
]

const img = (seed, i = 1) => `https://picsum.photos/seed/weshop-${seed}-${i}/600/600`

/**
 * name, category, description, status, seed（图片种子）, imageCount
 * skus: [名称, 价格, 库存]
 */
const NEW_PRODUCTS = [
  // 基础演示商品（原先由 API 启动时自动写入，现统一由显式 seed 命令创建）
  {
    name: '无线降噪耳机 Pro',
    category: '数码配件',
    status: 'on',
    seed: 'headphones-pro',
    imageCount: 0,
    description: '主动降噪 45dB，续航 40 小时，支持双设备连接。',
    skus: [['默认规格', 1299, 86]],
  },
  {
    name: '机械键盘 87 键',
    category: '数码配件',
    status: 'on',
    seed: 'keyboard-87',
    imageCount: 0,
    description: 'Gasket 结构，全键热插拔，PBT 键帽。',
    skus: [['默认规格', 499, 120]],
  },
  {
    name: '便携咖啡机',
    category: '家用电器',
    status: 'on',
    seed: 'coffee-machine',
    imageCount: 0,
    description: '意式浓缩 19Bar 萃取，办公室与户外两用。',
    skus: [['默认规格', 899, 34]],
  },
  {
    name: '智能手环 9',
    category: '智能穿戴',
    status: 'off',
    seed: 'band-9',
    imageCount: 0,
    description: '血氧 / 心率 / 睡眠监测，14 天长续航。（库存补货中）',
    skus: [['默认规格', 349, 0]],
  },
  {
    name: '不锈钢保温杯 500ml',
    category: '生活日用',
    status: 'on',
    seed: 'thermos-500',
    imageCount: 0,
    description: '316 不锈钢内胆，24 小时保温。',
    skus: [['默认规格', 129, 260]],
  },
  {
    name: '瑜伽垫加厚 8mm',
    category: '运动户外',
    status: 'on',
    seed: 'yoga-mat',
    imageCount: 0,
    description: 'TPE 环保材质，防滑纹路，附背带。',
    skus: [['默认规格', 159, 75]],
  },
  {
    name: '桌面氛围灯',
    category: '生活日用',
    status: 'off',
    seed: 'desk-light',
    imageCount: 0,
    description: 'RGB 全彩，APP 控制，声控律动模式。',
    skus: [['默认规格', 199, 41]],
  },
  {
    name: '蓝牙音箱 Mini',
    category: '数码配件',
    status: 'on',
    seed: 'speaker-mini',
    imageCount: 0,
    description: 'IPX7 防水，20 小时续航，TWS 互联。',
    skus: [['默认规格', 259, 58]],
  },
  // 数码配件
  {
    name: '无线鼠标 M3',
    category: '数码配件',
    status: 'on',
    seed: 'mouse-m3',
    imageCount: 2,
    description: '2.4G/蓝牙双模，静音微动，人体工学握感。',
    skus: [['静音版', 99, 150], ['蓝牙双模版', 129, 86]],
  },
  {
    name: 'Type-C 快充套装',
    category: '数码配件',
    status: 'on',
    seed: 'charger-c',
    imageCount: 1,
    description: '氮化镓方案，含 1.5m C-C 数据线。',
    skus: [['65W 单口', 79, 200], ['100W 双口', 129, 120]],
  },
  {
    name: '手机支架',
    category: '数码配件',
    status: 'on',
    seed: 'phone-stand',
    imageCount: 1,
    description: '铝合金折叠支架，桌面床头两用。',
    skus: [['标准款', 29.9, 500]],
  },
  // 家用电器
  {
    name: '空气炸锅 4.5L',
    category: '家用电器',
    status: 'on',
    seed: 'air-fryer',
    imageCount: 2,
    description: '360° 热风循环，免翻面，低脂无油烹饪。',
    skus: [['米白', 299, 45], ['曜石黑', 299, 38]],
  },
  {
    name: '加湿器 3L',
    category: '家用电器',
    status: 'off',
    seed: 'humidifier',
    imageCount: 1,
    description: '上加水设计，恒湿模式，26dB 轻音。（补货中）',
    skus: [['标准款', 159, 0]],
  },
  {
    name: '电热水杯',
    category: '家用电器',
    status: 'on',
    seed: 'kettle-cup',
    imageCount: 1,
    description: '便携式烧水杯，45℃/85℃/100℃ 三档调温。',
    skus: [['300ml', 99, 80], ['500ml', 129, 66], ['700ml', 159, 0]],
  },
  // 智能穿戴
  {
    name: '运动手表 GT5',
    category: '智能穿戴',
    status: 'on',
    seed: 'watch-gt5',
    imageCount: 2,
    description: '双频 GPS，150+ 运动模式，两周续航。',
    skus: [['42mm 氟橡胶表带', 899, 25], ['46mm 米兰尼斯表带', 1099, 18], ['46mm 钛合金', 1499, 9]],
  },
  {
    name: '真无线耳机 Air',
    category: '智能穿戴',
    status: 'on',
    seed: 'buds-air',
    imageCount: 1,
    description: '半入耳舒适佩戴，通话降噪，28 小时续航。',
    skus: [['标准版', 199, 130], ['降噪版', 299, 95]],
  },
  // 食品饮料
  {
    name: '精品咖啡豆 500g',
    category: '食品饮料',
    status: 'on',
    seed: 'coffee-beans',
    imageCount: 2,
    description: '埃塞俄比亚 耶加雪菲 G1，下单后新鲜烘焙。',
    skus: [['中度烘焙', 68, 210], ['深度烘焙', 68, 180], ['浅度烘焙', 72, 96]],
  },
  {
    name: '冷萃咖啡液 10 条装',
    category: '食品饮料',
    status: 'on',
    seed: 'cold-brew',
    imageCount: 1,
    description: '0 糖 0 脂，冷水即溶，独立条装。',
    skus: [['标准装', 45, 300]],
  },
  {
    name: '每日坚果 30 包',
    category: '食品饮料',
    status: 'on',
    seed: 'daily-nuts',
    imageCount: 1,
    description: '6 种坚果果干科学配比，独立小包。',
    skus: [['原味', 89, 140], ['酸奶味', 95, 88]],
  },
  // 美妆个护
  {
    name: '氨基酸洁面乳',
    category: '美妆个护',
    status: 'on',
    seed: 'cleanser',
    imageCount: 1,
    description: '温和氨基酸表活，洗后不紧绷，敏感肌适用。',
    skus: [['100g', 59, 220], ['150g', 79, 160]],
  },
  {
    name: '保湿面霜 50g',
    category: '美妆个护',
    status: 'on',
    seed: 'cream',
    imageCount: 1,
    description: '神经酰胺 + 角鲨烷，48 小时长效保湿。',
    skus: [['标准装', 139, 74]],
  },
  // 母婴用品
  {
    name: '婴儿湿巾 80抽×5包',
    category: '母婴用品',
    status: 'on',
    seed: 'baby-wipes',
    imageCount: 1,
    description: 'EDI 纯化水，加厚无纺布，手口可用。',
    skus: [['标准装', 39.9, 320]],
  },
  {
    name: '儿童保温吸管杯',
    category: '母婴用品',
    status: 'on',
    seed: 'kids-cup',
    imageCount: 2,
    description: '316 不锈钢，一杯双盖，防漏防呛。',
    skus: [['恐龙款', 89, 54], ['独角兽款', 89, 47]],
  },
  // 图书文创
  {
    name: '手账本 A5',
    category: '图书文创',
    status: 'on',
    seed: 'planner-a5',
    imageCount: 1,
    description: '100g 米色道林纸，180° 平摊书写。',
    skus: [['方格内页', 25, 190], ['空白内页', 25, 150], ['周计划内页', 29, 120]],
  },
  {
    name: '钢笔礼盒',
    category: '图书文创',
    status: 'off',
    seed: 'pen-set',
    imageCount: 1,
    description: '铱金笔尖，含墨囊与礼盒包装。（暂时下架）',
    skus: [['标准装', 129, 40]],
  },
  // 家居家装
  {
    name: '全棉四件套 1.8m 床',
    category: '家居家装',
    status: 'on',
    seed: 'bedding-set',
    imageCount: 2,
    description: '100 支长绒棉，A 类母婴级面料。',
    skus: [['雾灰', 269, 33], ['奶白', 269, 28], ['雾蓝', 279, 21]],
  },
  {
    name: '香薰蜡烛 200g',
    category: '家居家装',
    status: 'on',
    seed: 'candle',
    imageCount: 1,
    description: '天然大豆蜡，约 45 小时燃烧时长。',
    skus: [['鼠尾草海盐', 69, 88], ['无花果', 69, 76]],
  },
  // 运动户外
  {
    name: '轴承竞速跳绳',
    category: '运动户外',
    status: 'on',
    seed: 'jump-rope',
    imageCount: 1,
    description: '双轴承顺滑不绕绳，绳长可调。',
    skus: [['标准款', 35, 210]],
  },
  // 宠物用品
  {
    name: '全价猫粮 1.5kg',
    category: '宠物用品',
    status: 'on',
    seed: 'cat-food',
    imageCount: 1,
    description: '86% 动物原料，无谷低敏配方。',
    skus: [['鸡肉味', 119, 95], ['鱼肉味', 119, 82]],
  },
]

/** 存量商品规格扩展：默认规格改名 + 追加新规格 */
const PRODUCT_EXTENSIONS = [
  {
    name: '无线降噪耳机 Pro',
    renameDefaultTo: '深空灰',
    skus: [['皓月白', 1299, 40], ['曜岩黑', 1329, 22]],
  },
  {
    name: '机械键盘 87 键',
    renameDefaultTo: '红轴',
    skus: [['茶轴', 499, 60], ['青轴', 489, 45]],
  },
  {
    name: '不锈钢保温杯 500ml',
    renameDefaultTo: '500ml 标准款',
    skus: [['350ml 便携款', 109, 120], ['750ml 大容量', 149, 90]],
  },
]

// ---------- 执行 ----------

const stats = { categories: 0, products: 0, skus: 0, extended: 0, renamed: 0, images: 0 }

try {
  await inTransaction(async () => {
    // 分类（按名称判重，sort_order 接续最大值）
    const findCategory = db.prepare('SELECT id FROM categories WHERE name=?')
    const insertCategory = db.prepare('INSERT INTO categories (name, sort_order) VALUES (?, ?)')
    const sortRow = await db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM categories').get()
    let nextSort = sortRow.m
    for (const name of NEW_CATEGORIES) {
      if (await findCategory.get(name))
        continue
      await insertCategory.run(name, ++nextSort)
      stats.categories++
    }

    const findProduct = db.prepare('SELECT id FROM products WHERE name=?')
    const insertProduct = db.prepare(
      `INSERT INTO products (name, category, price, stock, description, status) VALUES (?, ?, 0, 0, ?, ?)`,
    )
    const insertSku = db.prepare(
      'INSERT INTO product_skus (product_id, name, price, stock, image, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
    )
    const insertImage = db.prepare(
      'INSERT INTO product_images (product_id, url, sort_order) VALUES (?, ?, ?)',
    )
    const findSku = db.prepare('SELECT id, stock FROM product_skus WHERE product_id=? AND name=?')

    // 新商品
    for (const p of NEW_PRODUCTS) {
      if (await findProduct.get(p.name))
        continue
      const insertedProduct = await insertProduct.run(p.name, p.category, p.description, p.status)
      const productId = insertedProduct.lastInsertRowid
      for (const [i, [skuName, price, stock]] of p.skus.entries()) {
        const insertedSku = await insertSku.run(productId, skuName, price, stock, '', i)
        const skuId = insertedSku.lastInsertRowid
        if (stock > 0) {
          await writeStockLog({
            product_id: productId,
            sku_id: skuId,
            sku_name: skuName,
            delta: stock,
            stock_after: stock,
            reason: 'init',
            ref: '演示数据',
            operator: 'system:seed',
          })
        }
        stats.skus++
      }
      for (let i = 1; i <= p.imageCount; i++) {
        await insertImage.run(productId, img(p.seed, i), i - 1)
        stats.images++
      }
      await syncProductDerivedFields(productId)
      stats.products++
    }

    // 存量商品规格扩展
    for (const ext of PRODUCT_EXTENSIONS) {
      const product = await findProduct.get(ext.name)
      if (!product)
        continue
      const productId = product.id

      if (ext.renameDefaultTo) {
        const r = await db.prepare(
          `UPDATE product_skus SET name=?, updated_at=NOW()
           WHERE product_id=? AND name='默认规格'`,
        ).run(ext.renameDefaultTo, productId)
        if (r.changes > 0)
          stats.renamed++
      }

      const sortRow = await db.prepare(
        'SELECT COALESCE(MAX(sort_order), -1) AS m FROM product_skus WHERE product_id=?',
      ).get(productId)
      let sort = sortRow.m
      let added = 0
      for (const [skuName, price, stock] of ext.skus) {
        if (await findSku.get(productId, skuName))
          continue
        const insertedSku = await insertSku.run(productId, skuName, price, stock, '', ++sort)
        const skuId = insertedSku.lastInsertRowid
        if (stock > 0) {
          await writeStockLog({
            product_id: productId,
            sku_id: skuId,
            sku_name: skuName,
            delta: stock,
            stock_after: stock,
            reason: 'init',
            ref: '演示数据',
            operator: 'system:seed',
          })
        }
        stats.skus++
        added++
      }
      if (added > 0) {
        await syncProductDerivedFields(productId)
        stats.extended++
      }
    }
  })
}
catch (e) {
  console.error('种子数据写入失败，已回滚：', e)
  process.exit(1)
}

const totals = {
  categories: (await db.prepare('SELECT COUNT(*) AS n FROM categories').get()).n,
  products: (await db.prepare('SELECT COUNT(*) AS n FROM products').get()).n,
  skus: (await db.prepare('SELECT COUNT(*) AS n FROM product_skus').get()).n,
}

console.log('演示数据写入完成：')
console.log(`  新增分类 ${stats.categories} 个，新增商品 ${stats.products} 个，新增规格 ${stats.skus} 条，新增图片 ${stats.images} 张`)
console.log(`  存量扩展：${stats.extended} 个商品追加规格，${stats.renamed} 条默认规格改名`)
console.log(`  当前总量：分类 ${totals.categories}，商品 ${totals.products}，规格 ${totals.skus}`)
if (stats.products === 0 && stats.skus === 0 && stats.categories === 0) {
  console.log('  （全部已存在，无需重复写入）')
}
await db.close()
