# AGENTS.md

## 项目概览

WeShop 商城 monorepo（pnpm workspace）：

- `apps/api` — Express 5 + node:sqlite，tsx 直跑 TypeScript，端口 7101
- `apps/web` — React 19 + Vite 7 管理后台，dev 端口 7100（代理到 api）
- `apps/miniprogram` — Taro 4.3 + React 18 微信小程序
- `apps/server` — Ktor 演示服务
- `packages/shared` — 纯 TS 共享类型
- `packages/eslint-config` — 共享 ESLint 配置

环境：Node 钉 `.nvmrc`（v24.20.0），pnpm 12。

## TODO.md 工作规则（必须遵守）

`TODO.md` 是项目优化与漏洞处理的**唯一台账**：

1. **发现即记录，注明排查时间**：审查、开发或排查中发现的漏洞、改进建议、技术债，无论是否立即处理，都要先追加到 `TODO.md` 对应分组，并在条目末尾标注 `（排查：YYYY-MM-DD）`。每次重新排查时，即使问题已存在，也要更新排查时间或追加新一轮排查记录，形成迭代轨迹。不要只在对话里口头说明。
2. **完成即勾选，注明修复时间**：每完成一项，把 `[ ]` 改为 `[x]` 并移入「已完成」区，标注 `（修复：YYYY-MM-DD）`；若验收命令未全绿，不得勾选。
3. **新增分组**：新类型的工作在「待处理」下新开分组，保持按批次/领域组织。
4. **不删除历史**：已完成条目保留在「已完成」区，按日期分批，便于回溯。

条目格式：

```markdown
- [ ] **级别 标题**：问题描述与涉及 `文件:行号`（排查：YYYY-MM-DD）
- [x] **级别 标题**：修复方案简述（排查：YYYY-MM-DD，修复：YYYY-MM-DD）
```

## 代码风格

- 注释和文档用中文
- 无分号风格（参照各包现有文件）
- `apps/api` 用 TypeScript 7（tsgo）做类型检查；eslint 已关闭 TS 感知规则，**改 api 后必须跑 `pnpm --filter api typecheck`**
- `apps/api/src/auth.ts` 的 `requireAdmin` 是泛型签名（保留 Express 5 路由参数推断），不要回退成普通 `RequestHandler` 常量写法

## 验收命令

任何修改完成后必须全绿：

```bash
pnpm typecheck && pnpm -r lint && pnpm test
# 涉及 apps/web 的改动再加：
pnpm build:web
```

- `pnpm test` 是自包含测试（临时目录 + 独立端口），安全；`pnpm smoke` 打开发库 localhost:7101，慎用
- 冒烟脚本 `scripts/smoke-api-ts.mjs` 内含改密测试（会改回 admin123，幂等）
- API 有新行为时，同步在 `scripts/smoke-api-ts.mjs` 加回归用例

## 安全约束

- 密钥一律走环境变量，禁止硬编码；生产启动有 fail-fast 校验（见 `apps/api/src/config.ts`）
- 不要在日志、回复或提交中打印密钥明文
- 批 5（上线准备）缺真实 appid/商户号/域名时不要编造，向用户索取
