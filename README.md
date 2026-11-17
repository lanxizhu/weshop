# weshop

电商示例项目：React 管理后台 + 微信小程序 C 端 + Express/SQLite API，pnpm monorepo 组织。

## 目录结构

| 路径 | 说明 |
| --- | --- |
| `apps/web` | 管理后台（React 19 + TanStack Router + Vite 7 + Tailwind + shadcn 风格组件），dev 端口 7100，`/api`、`/uploads` 代理到 7101 |
| `apps/api` | 后端 API（Express 5 + tsx 直跑 TS，`node:sqlite` 持久化），默认端口 7101 |
| `apps/miniprogram` | 微信小程序 C 端（Taro 4.3 + React 18），产物为微信小程序 |
| `apps/server` | Kotlin Ktor 演示服务（仅 `/health`），docker compose `--profile ktor` 才启动 |
| `packages/shared` | 前后端共享 TS 类型包（`@weshop/shared`，纯源码 workspace 包，无构建） |
| `packages/eslint-config` | 共享 ESLint 配置（`@weshop/eslint-config`） |
| `scripts/` | 工程脚本：dev 启动器、API 冒烟测试（见下文「测试与检查」） |

## 环境要求

- Node.js 版本见 `.nvmrc`（当前 v24.20.0；API 依赖 `node:sqlite`，不能用太老的 Node）
- pnpm 12（`packageManager` 字段已钉死 `pnpm@12.11.2`），建议 `corepack enable` 让包管理器自动对齐

## 快速开始

```bash
pnpm install
pnpm seed       # 可选：显式写入演示数据（幂等，空库会自动初始化表结构）
pnpm dev        # 并行启动 api(7101) + web(7100)
```

API 启动时不会自动写入演示商品；生产环境请跳过 `pnpm seed`。
打开 <http://localhost:7100> 即是管理后台，默认管理员账号 `admin` / `admin123`（生产必改，见文末）。
也可以单独启动：`pnpm dev:api`、`pnpm dev:web`。

小程序端：

```bash
pnpm dev:mp     # taro build --type weapp --watch
```

然后用微信开发者工具导入 `apps/miniprogram`（`project.config.json` 里目前是 `touristappid` 测试号）。
开发态 API 地址在 `apps/miniprogram/config/dev.ts` 的 `API_BASE`，按需改成本机局域网 IP + 7101 端口。
未配置微信凭证时，小程序登录走 Mock 模式（openid = `dev_<code>`），不影响本地联调。

## 环境变量

复制 `.env.example` 为 `.env` 后按需修改（docker compose 会自动读取根目录 `.env`）：

| 变量 | 说明 |
| --- | --- |
| `API_TOKEN_SECRET` | 登录令牌签名密钥，**生产必改** |
| `API_ADMIN_USERNAME` / `API_ADMIN_PASSWORD` | 初始管理员账号，仅在首次启动（admins 表为空）时写入，**生产必改** |
| `WX_APPID` / `WX_SECRET` | 微信小程序登录凭证；不配置则登录走 Mock 模式 |
| `API_TRUST_PROXY` | Express 信任的反向代理层数或地址，默认 `1`；API 直连且不经过代理时设为 `0` |
| `API_ORDER_TIMEOUT_SECONDS` | 待支付订单自动关闭时限，默认 `900` 秒 |
| `API_ORDER_SWEEP_INTERVAL_SECONDS` | 超时订单扫描周期，默认 `30` 秒 |
| `API_LOG_MAX_BYTES` / `API_LOG_MAX_FILES` | API 日志单个文件大小上限与保留文件数，默认 `5242880` 字节 / `5` 个 |
| `WEB_PORT` / `KTOR_PORT` | docker compose 宿主机端口映射 |
| `VITE_API_BASE_URL` | Web Axios 请求根路径，默认 `/api` |
| `VITE_API_PROXY_TARGET` | Vite 开发服务器 `/api`、`/uploads` 代理目标，默认 `http://localhost:7101` |

`VITE_` 变量会进入客户端构建，不能存放密钥。
登录、创建订单和上传接口按客户端 IP 做进程内固定窗口限流，超限返回 429 与 `Retry-After`；多实例部署时应改用共享限流存储。
待支付订单超时后由 API 自动取消并回补库存；上传图片同时校验声明 MIME 与实际文件头，伪造或损坏内容会被拒绝并删除。
API 日志按大小轮转并限制保留文件数；请求日志保留查询参数名但隐藏参数值，避免收货人等敏感信息进入日志。

**重要**：docker compose 中 `API_TOKEN_SECRET` / `API_ADMIN_PASSWORD` 已无兜底默认值，必须显式配置，否则 API 容器起不来。
生产部署时，API 在 `NODE_ENV=production` 下会对默认密钥、默认管理员密码、空微信凭证 fail-fast 拒绝启动，提前暴露配置问题。

## 测试与检查

- `pnpm test` — 先运行 API、小程序与 Web Vitest 单测（业务校验、异步密码散列、日志轮转与脱敏、列表竞态、购物车改量、空库 UI 与库存同步等），再用临时端口 7821 + 临时 SQLite 库起一次性 API 实例，验证空库不自动灌数据、显式执行 `pnpm seed` 并跑 `scripts/smoke-api-ts.mjs`（覆盖鉴权、商品/分类 CRUD、订单全生命周期与超时关单、越权、CSV 安全、图片引用、上传魔数与限流），结束后自动清理，不污染开发库
- `pnpm smoke` — 直接对已在运行的服务跑同一份冒烟（默认 `http://localhost:7101`，可用 `SMOKE_BASE` 环境变量覆盖）
- `pnpm lint` — 所有包 ESLint
- `pnpm typecheck` — api + miniprogram 类型检查（web 的类型检查含在 `pnpm build:web` 内）

CI（`.github/workflows/ci.yml`）在 push 到 main 与 PR 时依次执行：生产依赖审计 → lint → typecheck → build:web → build:weapp → `pnpm test`。

## 构建与部署

- `pnpm build:web` — 构建管理后台，产物在 `apps/web/dist`；同时生成 hidden sourcemap（`.js.map`，业务 JS 不附加 `sourceMappingURL` 引用）
- `docker compose up -d --build` — 启动 web（宿主机 8080）+ api；SQLite 数据库与上传文件持久化在 `api-data` volume。API 使用多阶段镜像和 `pnpm deploy --prod`，运行镜像不包含 ESLint、Vitest 等开发依赖
- Ktor 演示服务：`docker compose --profile ktor up -d --build`（`apps/server` 仅作健康检查演示，宿主机 8081）
- 小程序发布：`pnpm --filter miniprogram build:weapp` 后用微信开发者工具上传。发布前把 `apps/miniprogram/project.config.json` 的 `appid` 换成正式 appid，并把 `apps/miniprogram/config/prod.ts` 的 `API_BASE` 改成生产 API 域名（必须为 HTTPS 且在微信公众平台配置合法域名）

## 默认管理员与安全提醒

初始管理员 `admin` / `admin123` 的默认值在 `apps/api/src/config.ts`（`API_ADMIN_USERNAME` / `API_ADMIN_PASSWORD`），仅在 admins 表为空时创建。生产环境务必通过环境变量覆盖默认口令；已初始化的库改环境变量不会更新已有账号，需先删除对应 admins 记录再重启以新值重建。
