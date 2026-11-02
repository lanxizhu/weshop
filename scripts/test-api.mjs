import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// 自包含 API 冒烟运行器（pnpm test）：
// 用临时端口 + 临时数据目录起一个一次性 API 实例，再对它跑 scripts/smoke-api-ts.mjs，
// 全程不依赖任何已启动的服务，也不触碰 apps/api/server 下的开发数据库。
const repoRoot = path.resolve(import.meta.dirname, '..')
const PORT = 7821
const BASE = `http://localhost:${PORT}`
const HEALTH_TIMEOUT_MS = 30_000

const dataDir = mkdtempSync(path.join(tmpdir(), 'weshop-api-test-'))

// 非 watch 方式启动 API（等价 pnpm --filter api start）
const api = spawn('pnpm', ['--filter', 'api', 'start'], {
  cwd: repoRoot,
  env: { ...process.env, API_PORT: String(PORT), API_DATA_DIR: dataDir },
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
      env: { ...process.env, SMOKE_BASE: BASE },
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

let exitCode = 1
try {
  await waitHealthy()
  console.log(`[test-api] API 已就绪：${BASE}（临时数据目录 ${dataDir}）`)
  exitCode = await runSmoke()
} catch (err) {
  console.error(`[test-api] ${err.message}`)
  if (apiLog) console.error(`[test-api] ----- API 输出（末尾 50KB 内）-----\n${apiLog}`)
}

await cleanup()
process.exit(exitCode)
