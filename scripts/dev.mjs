import { spawn } from 'node:child_process'

// Starts the API server and the web dev server together so that
// `npm run dev` / `pnpm dev` at the workspace root gives a single
// command for the whole app. CLI args (e.g. --host/--port) are
// forwarded to the Vite dev server.
const children = [
  spawn('pnpm', ['--filter', 'api', 'dev'], { stdio: 'inherit' }),
  spawn('pnpm', ['--filter', 'web', 'dev', '--', ...process.argv.slice(2)], {
    stdio: 'inherit',
  }),
]

function shutdown() {
  for (const c of children) c.kill('SIGTERM')
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
for (const c of children) c.on('exit', (code) => {
  if (code && !children.some((x) => x.killed)) shutdown()
})
