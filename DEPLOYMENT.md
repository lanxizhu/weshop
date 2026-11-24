# WeShop 服务器部署文档

本文基于当前仓库的 `docker-compose.yml`、各端 Dockerfile 和 CI 配置编写，描述单台 Linux 服务器上的部署方式。

推荐交付链路为 **Docker Compose 构建并运行 Web + API，宿主机反向代理提供 HTTPS，小程序单独构建并在微信开发者工具中发布**。

## 1. 当前部署架构

| 组件 | 镜像/运行方式 | 默认端口 | 部署说明 |
| --- | --- | --- | --- |
| `web` | React/Vite 构建静态文件，Nginx 提供访问 | 宿主机 `8080` → 容器 `80` | 管理后台，同时反代 `/api`、`/uploads` |
| `api` | Node.js 24 + Express 5 + `tsx` | 容器 `7101` | 不对宿主机公开端口，仅供 Compose 内网访问 |
| SQLite/上传文件 | API 容器内的 `/data` | 无 | 持久化到命名卷 `api-data` |
| `server` | Kotlin Ktor 演示服务 | 宿主机 `8081` → 容器 `8080` | 仅 `--profile ktor` 启用，不属于默认部署链路 |
| 微信小程序 | Taro 构建为小程序产物 | 无 | 不在服务器容器中运行，需另行上传发布 |
| `standalone-admin` | 独立静态原型 | 无 | 未接入 Compose，不是正式管理后台的部署目标 |

默认请求链路：

```text
浏览器 / 微信小程序
  → 宿主机 HTTPS 反向代理（生产环境需要配置）
  → web 容器 Nginx
      ├─ 静态资源与 SPA 路由
      └─ /api、/uploads → api 容器:7101
                              └─ /data：SQLite 数据库与上传文件
```

GitHub Actions 当前只有 CI：依次执行生产依赖审计、lint、类型检查、Web/小程序构建和测试。**没有自动推送镜像或发布到服务器的 CD 流程**，服务器更新需按本文手动执行。

## 2. 上线前检查

### 2.1 必须准备的生产配置

- 一个已解析到服务器公网 IP 的域名，以及有效的 HTTPS 证书。
- 真实的微信小程序 `AppID`、`AppSecret`，填入服务器 `.env`。
- 将 `apps/miniprogram/project.config.json` 中的 `touristappid` 替换为正式 AppID。
- 将 `apps/miniprogram/config/prod.ts` 中的 `API_BASE` 替换为生产 HTTPS 域名，例如 `https://shop.example.com`，不要附加 `/api`，请求层会自动拼接。
- 在微信公众平台配置 `request` 和 `uploadFile` 合法域名。
- 为 API 签名密钥和管理员初始密码生成独立强随机值，不得沿用示例值。

当前小程序支付仍是“模拟支付”：调用接口直接把待支付订单改为已支付，并未接入微信商户号和支付签名链路。需要真实收款时，必须先完成支付功能，不能将模拟支付视为生产支付能力。

### 2.2 服务器要求

- Linux 服务器，建议至少 2 核 CPU、2 GB 内存，并预留镜像、日志和备份所需磁盘空间。
- Docker Engine 与 Docker Compose v2，命令统一使用 `docker compose`，不是旧版 `docker-compose`。
- 服务器能够访问 Docker 镜像仓库；离线环境见 [6.3 镜像打包与离线部署](#63-镜像打包与离线部署)。
- Compose 部署不要求服务器安装 Node.js 或 pnpm；只有在本机单独构建 Web/小程序时才需要。
- 安全组或防火墙仅向公网开放 `80`、`443`；SSH 仅允许可信管理地址。`8080` 用于本机反向代理时，不应对公网开放。

当前架构只支持 **单 API 实例**：SQLite 数据位于本机命名卷，限流状态也保存在单进程内存中。不要直接执行 `docker compose up --scale api=2`，多实例前需先完成共享存储和限流改造。

## 3. 标准部署：服务器拉源码并构建

### 3.1 获取代码

以下示例使用 `/opt/weshop`：

```bash
sudo mkdir -p /opt/weshop
sudo chown "$USER" /opt/weshop
git clone <仓库地址> /opt/weshop
cd /opt/weshop
```

没有 Git 仓库地址时，也可以上传完整源码包后解压到该目录。部署包必须至少包含 Compose 文件、Dockerfile、`pnpm-lock.yaml`、workspace 清单和构建所需源码。源码包不要携带 `node_modules`、`dist` 或 `.env`；服务器上的 `.env` 应在下一步单独创建。

### 3.2 配置环境变量

```bash
cd /opt/weshop
cp .env.example .env
chmod 600 .env
openssl rand -hex 32
```

将命令生成的随机十六进制字符串填入 `API_TOKEN_SECRET`，再编辑 `.env`：

```dotenv
# 固定项目名，同时影响镜像名和数据卷名；初始化后不要随意修改
COMPOSE_PROJECT_NAME=weshop

API_TOKEN_SECRET=<随机长字符串>
API_ADMIN_USERNAME=admin
API_ADMIN_PASSWORD=<独立强口令>
WX_APPID=<真实小程序 AppID>
WX_SECRET=<真实小程序 AppSecret>

WEB_PORT=8080
API_ORDER_TIMEOUT_SECONDS=900
API_ORDER_SWEEP_INTERVAL_SECONDS=30
API_LOG_MAX_BYTES=5242880
API_LOG_MAX_FILES=5
```

注意：

- `.env` 已被 Git 忽略，不要提交、转发或在日志中打印其中的密钥。
- 当前 `.dockerignore` 尚未排除 `.env`。使用远程 Docker Builder 前应先补充忽略规则，避免将密钥发送到远端构建服务；现有 Dockerfile 不会把根 `.env` 复制进镜像。
- API 镜像设置了 `NODE_ENV=production`。默认签名密钥、默认管理员密码或空微信凭证都会使 API 拒绝启动。
- 管理员账号只在 `admins` 表为空时初始化。已有数据库后再修改 `API_ADMIN_USERNAME` 或 `API_ADMIN_PASSWORD`，**不会修改已存在的管理员**。
- 首次登录后台后应立即通过“修改密码”功能更换初始密码。
- 生产环境不要执行 `pnpm seed`，该命令用于写入演示数据。
- 默认同源部署无需修改 `VITE_API_BASE_URL`，Web 会使用 `/api`，由 Web 容器 Nginx 转发。

### 3.3 校验配置并构建启动

```bash
cd /opt/weshop
docker compose config --quiet
docker compose build
docker compose up -d
```

也可以把构建和启动合并为：

```bash
docker compose up -d --build
```

构建结果：

- `weshop-api`：多阶段构建，通过 `pnpm deploy --prod` 裁剪运行依赖，以非 root 的 `node` 用户运行。
- `weshop-web`：先产出 `apps/web/dist`，再复制到 Nginx 运行镜像。

`docker compose config --quiet` 只校验配置；不要使用未脱敏的 `docker compose config` 输出作为公开日志，因为其中可能包含环境变量值。

### 3.4 验证部署

若修改了 `WEB_PORT`，请将下列命令中的 `8080` 换成实际端口：

```bash
docker compose ps
curl --fail http://127.0.0.1:8080/api/healthy
curl --head http://127.0.0.1:8080/
```

健康接口应返回类似：

```json
{"ok":true,"uptime":123}
```

继续完成以下人工验收：

1. 浏览器打开管理后台并使用初始管理员登录。
2. 立即修改管理员密码，再验证旧登录态失效、新密码可登录。
3. 验证商品、分类、订单等核心业务页面。
4. 上传一张图片，确认可以经 `/uploads/...` 正常访问。
5. 重建 API 容器后再次检查数据库与上传图片，确认 `/data` 持久化有效。

`/api/healthy` 只检查 Node 进程是否响应，不查询数据库，因此健康检查通过不等于全部业务验收通过。

## 4. 配置域名与 HTTPS

Web 容器自身只提供 HTTP。生产环境应在宿主机使用 Nginx、Caddy 或云负载均衡终止 HTTPS，再转发到 `127.0.0.1:8080`。

宿主机 Nginx 示例（替换域名和证书路径）：

```nginx
server {
    listen 80;
    server_name shop.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    http2 on;
    server_name shop.example.com;

    ssl_certificate     /etc/letsencrypt/live/shop.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/shop.example.com/privkey.pem;

    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

证书路径只是示例，可使用现有证书管理方式签发和续期。配置后执行宿主机 Nginx 的配置检查并重载：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

再验证：

```bash
curl --fail https://shop.example.com/api/healthy
```

### 4.1 反向代理层数与客户端 IP

API 使用 `API_TRUST_PROXY` 计算真实客户端 IP，用于日志和限流：

- 只有 Web 容器内的一层 Nginx：使用 `1`。
- 按上文再增加一层宿主机 Nginx：使用 `2`。
- 不要直接设置 `true`，否则会信任未经限制的代理链。

**当前 `docker-compose.yml` 尚未把 `.env` 中的 `API_TRUST_PROXY` 透传给 API 容器。** 使用宿主机反向代理前，需要在 `services.api.environment` 中补充：

```yaml
API_TRUST_PROXY: ${API_TRUST_PROXY:-1}
```

然后在上文的 `.env` 中设置：

```dotenv
API_TRUST_PROXY=2
```

最后重新创建服务：

```bash
docker compose up -d --force-recreate api
```

## 5. 日常更新与回滚

### 5.1 发布新版本

```bash
cd /opt/weshop
# 更新前先按第 7 节备份数据
git pull --ff-only
docker compose config --quiet
docker compose up -d --build
docker compose ps
curl --fail http://127.0.0.1:8080/api/healthy
```

发布后进行第 3.4 节的业务验收。数据库结构和索引会在 API 启动时执行幂等初始化/轻量迁移，因此升级前备份不可省略。

### 5.2 回滚

```bash
git checkout <已验证的旧版本提交或标签>
docker compose up -d --build
```

代码回滚不会自动回滚数据库变更。如果新版本已经迁移或写入不兼容数据，需要同时恢复升级前备份，并先在同版本测试环境验证恢复流程。

## 6. 打包产物与其他交付方式

### 6.1 单独打包管理后台

本机需要 Node.js 版本与 `.nvmrc` 一致（当前 `v24.20.0`），并通过 Corepack 使用仓库钉住的 pnpm 版本：

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm build:web
```

产物位于 `apps/web/dist/`。该目录只有静态前端；如果脱离 Compose 单独托管，必须另行配置：

- SPA 路由回退到 `index.html`；
- `/api` 反向代理到 API；
- `/uploads` 反向代理到 API；
- 与实际拓扑一致的 `VITE_API_BASE_URL`。

当前 Web Dockerfile 没有接收根目录 `.env` 中的 `VITE_*` 构建参数，默认镜像按 `/api` 同源方式构建。若需要自定义该值，应先为 Web 镜像增加明确的构建参数传递，不要误以为只修改服务器根目录 `.env` 就会改变已构建前端。

### 6.2 打包并发布微信小程序

先完成第 2.1 节的正式 AppID 和 API 域名配置，再执行：

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm --filter miniprogram build:weapp
```

产物位于 `apps/miniprogram/dist/`。使用微信开发者工具导入 `apps/miniprogram`，检查真机网络、登录、图片上传和订单流程后上传版本，再在微信公众平台提交审核并发布。

小程序依赖服务器 API 已部署且 HTTPS 域名已生效；仅构建 `dist` 并不等于完成上线。

### 6.3 镜像打包与离线部署

在与服务器 CPU 架构一致的构建机上执行：

```bash
cd /opt/weshop
docker compose build
docker compose config --images
docker save -o weshop-images.tar weshop-api weshop-web
gzip weshop-images.tar
```

将 `weshop-images.tar.gz`、相同版本的源码/Compose 文件传输到目标服务器，并确保两端 `.env` 都使用 `COMPOSE_PROJECT_NAME=weshop`：

```bash
gunzip weshop-images.tar.gz
docker load -i weshop-images.tar
cd /opt/weshop
docker compose config --quiet
docker compose up -d --no-build
```

镜像包不包含 `.env`，也不包含 `api-data` 数据卷。环境变量和业务数据必须分别安全传输、备份。

## 7. 数据、备份与日志

### 7.1 持久化内容

使用 `COMPOSE_PROJECT_NAME=weshop` 时，实际卷名为 `weshop_api-data`：

```bash
docker volume inspect weshop_api-data
```

容器内主要文件：

| 路径 | 内容 |
| --- | --- |
| `/data/data.db` | SQLite 主数据库 |
| `/data/data.db-wal`、`/data/data.db-shm` | SQLite WAL 运行期侧车文件 |
| `/data/uploads/` | 用户与管理员上传的图片 |

不要只复制运行中的 `data.db`，否则可能遗漏 WAL 中尚未合并的数据。下面的冷备份会先停止 API，再完整备份数据卷。

### 7.2 冷备份

```bash
cd /opt/weshop
mkdir -p backups
backup_file="api-data-$(date +%Y%m%d-%H%M%S).tar.gz"

docker compose stop api
docker run --rm \
  -v weshop_api-data:/data:ro \
  -v "$PWD/backups":/backup \
  alpine sh -c "tar czf /backup/$backup_file -C /data ."
docker compose start api

ls -lh "backups/$backup_file"
curl --fail http://127.0.0.1:8080/api/healthy
```

备份包含账户、订单、地址等敏感数据，应加密存储、限制访问并定期复制到服务器之外。应定期做恢复演练，而不是只检查备份文件是否存在。

### 7.3 恢复

**恢复会清空目标卷当前内容。执行前必须另存当前卷备份，并先在测试环境验证备份包。** 将命令中的备份文件名替换为实际文件：

```bash
cd /opt/weshop
docker compose stop web api
docker run --rm \
  -v weshop_api-data:/data \
  -v "$PWD/backups":/backup:ro \
  alpine sh -c 'find /data -mindepth 1 -maxdepth 1 -exec rm -rf {} + && tar xzf /backup/api-data-YYYYMMDD-HHMMSS.tar.gz -C /data && chown -R 1000:1000 /data'
docker compose up -d
docker compose ps
curl --fail http://127.0.0.1:8080/api/healthy
```

### 7.4 日志与运维命令

```bash
# 状态
docker compose ps

# 实时日志
docker compose logs -f --tail=200 api
docker compose logs -f --tail=200 web

# 重启全部默认服务（只重启现有容器，不重新构建镜像）
docker compose restart
# 已安装 pnpm 的环境也可以执行：pnpm docker:restart

# 只重启指定服务
docker compose restart api
docker compose restart web

# 重新部署：校验配置、重建镜像并强制重建默认服务（保留命名卷）
docker compose config --quiet
docker compose up -d --build --force-recreate
# 已安装 pnpm 的环境也可以执行：pnpm docker:redeploy

# 停止默认服务（不删除数据卷）
docker compose stop

# 停止并移除容器/网络（默认仍保留命名卷）
docker compose down
```

API 同时输出到标准输出和容器内 `/app/logs`。标准输出可通过 `docker compose logs` 查看；文件日志当前没有挂载持久化卷，**删除或重建容器后文件日志会丢失**。不要将 `docker compose down -v` 用于日常运维，它会删除命名卷并可能造成业务数据丢失。

## 8. 可选服务与生产限制

- Ktor 仅是 `/health` 演示服务，默认不会启动，也不是 Web/API 的依赖。其 Dockerfile 当前有已知构建路径问题，处理完成前不要将它纳入生产验收；详见 `TODO.md` 批 7。
- 当前部署为单实例，不应直接水平扩容 API。
- 当前支付为模拟支付；正式上线真实交易前需完成微信支付服务端链路。
- Web hidden sourcemap 当前会进入运行镜像；上线前按 `TODO.md` 中对应条目评估访问限制或移除方式。
- CI 尚未覆盖 Docker 镜像构建和 Compose 健康检查，发布前需在目标环境实际执行本文的构建与验收步骤。

## 9. 上线验收清单

- [ ] `.env` 权限受限，密钥、管理员密码、微信凭证均为生产值且未提交到 Git。
- [ ] `docker compose config --quiet` 通过，`web`、`api` 均为运行状态，API 健康检查通过。
- [ ] 公网仅开放必要端口，HTTPS 证书、自动续期和 HTTP 跳转正常。
- [ ] 反向代理层数与 `API_TRUST_PROXY` 一致，日志中的客户端 IP 与限流行为正确。
- [ ] 管理员已修改初始密码，核心管理功能与图片上传通过验收。
- [ ] 数据库与上传文件已做备份，并完成过恢复验证。
- [ ] 小程序正式 AppID、HTTPS API 地址、合法域名均已配置，真机流程通过。
- [ ] 如启用真实支付，已替换模拟支付并完成商户号、签名、回调和对账验收。
