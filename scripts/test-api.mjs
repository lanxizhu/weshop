import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

// 自包含 API 冒烟运行器（pnpm test）：
// 用临时端口 + 临时数据目录起一个一次性 API 实例，再对它跑 scripts/smoke-api-ts.mjs，
// 全程不依赖任何已启动的服务，也不触碰 apps/api/server 下的开发数据库。
const repoRoot = path.resolve(import.meta.dirname, '..')
const apiRequire = createRequire(path.join(repoRoot, 'apps/api/package.json'))
const PORT = 7821
const BASE = `http://localhost:${PORT}`
const HEALTH_TIMEOUT_MS = 30_000

const dataDir = mkdtempSync(path.join(tmpdir(), 'weshop-api-test-'))
const apiEnv = {
  ...process.env,
  API_PORT: String(PORT),
  API_DATA_DIR: dataDir,
  API_ORDER_TIMEOUT_SECONDS: '2',
  API_ORDER_SWEEP_INTERVAL_SECONDS: '1',
}

// 直接启动实际 Node/tsx 进程，清理时不会留下 pnpm 孙进程占用下一次测试端口
const api = spawn(process.execPath, [apiRequire.resolve('tsx/cli'), 'src/index.ts'], {
  cwd: path.join(repoRoot, 'apps/api'),
  env: apiEnv,
  stdio: ['ignore', 'pipe', 'pipe'],
})

// API 日志先攒着，只在失败/超时的时候打印，避免刷掉冒烟结果
let apiLog = ''
const appendLog = (chunk) => {
  apiLog += chunk
  if (apiLog.length > 50_000) apiLog = apiLog.slice(-50_000)
}
api.stdout.on('data', appendLog)
api.stderr.on('data', appendLog)

/** 轮询健康检查直到 200；API 提前退出或超时都会抛错 */
async function waitHealthy() {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (api.exitCode !== null) throw new Error(`API 进程提前退出（exit code ${api.exitCode}）`)
    try {
      const r = await fetch(`${BASE}/api/healthy`)
      // 校验响应体，避免把端口上无关的 HTTP 服务误判为 API 就绪
      if (r.status === 200 && (await r.json()).ok === true) return
    } catch {
      // 连接被拒绝：服务还没起来，继续等
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`等待 ${BASE}/api/healthy 就绪超时（${HEALTH_TIMEOUT_MS / 1000}s）`)
}

/** 跑冒烟脚本，resolve 它的 exit code */
function runSmoke() {
  return new Promise((resolve) => {
    const smoke = spawn('node', [path.join(repoRoot, 'scripts/smoke-api-ts.mjs')], {
      cwd: repoRoot,
      env: { ...process.env, SMOKE_BASE: BASE, SMOKE_ORDER_TIMEOUT: '1' },
      stdio: 'inherit',
    })
    smoke.on('exit', (code) => resolve(code ?? 1))
  })
}

let cleanedUp = false
/** 杀掉 API 子进程并删除临时数据目录；幂等，正常退出与信号两条路径都会走到 */
async function cleanup() {
  if (cleanedUp) return
  cleanedUp = true
  if (api.exitCode === null && !api.killed) {
    api.kill('SIGTERM')
    const exited = await Promise.race([
      new Promise((resolve) => api.once('exit', () => resolve(true))),
      new Promise((resolve) => setTimeout(() => resolve(false), 3000)),
    ])
    if (!exited) api.kill('SIGKILL')
  }
  rmSync(dataDir, { recursive: true, force: true })
}

// Ctrl+C / kill 也要可靠清理（信号会同时打到子进程，这里兜底杀掉 API 并退出）
for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.on(sig, () => {
    cleanup().finally(() => process.exit(code))
  })
}

async function verifyStockAdjustRollback() {
  const login = await fetch(`${BASE}/api/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  })
  const { token } = await login.json()
  const adminAuth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  const created = await fetch(`${BASE}/api/products`, {
    method: 'POST',
    headers: adminAuth,
    body: JSON.stringify({
      name: '库存回滚测试', category: '测试', price: 1, stock: 5, description: '', status: 'on', images: [],
      skus: [{ name: '默认规格', price: 1, stock: 5 }],
    }),
  })
  const { product } = await created.json()
  if (created.status !== 201) throw new Error(`库存回滚测试商品创建失败：${created.status}`)

  const triggerDb = new DatabaseSync(path.join(dataDir, 'data.db'))
  try {
    triggerDb.exec(`
      CREATE TRIGGER fail_adjust_stock_log BEFORE INSERT ON stock_logs
      WHEN NEW.reason = 'adjust'
      BEGIN
        SELECT RAISE(ABORT, 'forced stock log failure');
      END
    `)
  } finally {
    triggerDb.close()
  }

  const adjusted = await fetch(`${BASE}/api/products/${product.id}/stock`, {
    method: 'PATCH', headers: adminAuth, body: JSON.stringify({ delta: 1 }),
  })
  const current = await (await fetch(`${BASE}/api/products/${product.id}`, { headers: adminAuth })).json()
  const { logs } = await (await fetch(`${BASE}/api/products/${product.id}/stock-logs`, { headers: adminAuth })).json()
  if (adjusted.status !== 500 || current.product.stock !== 5 || current.product.skus[0].stock !== 5 ||
    logs.some(log => log.reason === 'adjust')) {
    throw new Error(`库存流水失败后未整体回滚：${JSON.stringify({ status: adjusted.status, product: current.product, logs })}`)
  }
  console.log('[test-api] 库存流水写入失败时库存与派生字段整体回滚')
}

let exitCode = 1
try {
  await waitHealthy()
  console.log(`[test-api] API 已就绪：${BASE}（临时数据目录 ${dataDir}）`)

  const emptyResponse = await fetch(`${BASE}/api/products`)
  const emptyBody = await emptyResponse.json()
  if (emptyResponse.status !== 200 || emptyBody.total !== 0 || emptyBody.products.length !== 0) {
    throw new Error('空库启动后商品列表不为空，演示数据仍在自动写入')
  }
  console.log('[test-api] 空库启动未自动写入演示数据')

  const adminLogin = await fetch(`${BASE}/api/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  })
  const { token } = await adminLogin.json()
  const adminAuth = { Authorization: `Bearer ${token}` }
  const productStats = await (await fetch(`${BASE}/api/stats`, { headers: adminAuth })).json()
  const dashboard = await (await fetch(`${BASE}/api/admin/stats/dashboard`, { headers: adminAuth })).json()
  const productFields = ['total', 'onShelf', 'offShelf', 'totalValue', 'lowStock']
  const dashboardFields = ['totalOrders', 'totalRevenue', 'pendingShipment', 'todayOrders', 'todayRevenue', 'totalUsers']
  if (!productFields.every(key => productStats[key] === 0) || !dashboardFields.every(key => dashboard.overview[key] === 0)) {
    throw new Error(`空库统计未全部返回 0：${JSON.stringify({ productStats, overview: dashboard.overview })}`)
  }
  console.log('[test-api] 空库商品与仪表盘统计全部返回 0')

  const seeded = spawnSync('pnpm', ['seed'], { cwd: repoRoot, env: apiEnv, encoding: 'utf8' })
  if (seeded.error || seeded.status !== 0) {
    throw new Error(`pnpm seed 执行失败：${seeded.error?.message ?? ''}\n${seeded.stdout ?? ''}${seeded.stderr ?? ''}`)
  }
  console.log('[test-api] 演示数据已通过 pnpm seed 显式写入')
  exitCode = await runSmoke()
  if (exitCode === 0) await verifyStockAdjustRollback()
} catch (err) {
  exitCode = 1
  console.error(`[test-api] ${err.message}`)
  if (apiLog) console.error(`[test-api] ----- API 输出（末尾 50KB 内）-----\n${apiLog}`)
}

await cleanup()
process.exit(exitCode)
