# syntax=docker/dockerfile:1

# API 服务（Express + tsx，直接运行 TypeScript 源码）。
# 构建上下文必须是仓库根目录：api 依赖 workspace 包 @weshop/shared（纯 TS 源码，由 tsx 加载）。
FROM node:24-alpine AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

FROM base AS build
WORKDIR /app

# 先拷贝清单文件，最大化利用 Docker 层缓存
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/eslint-config/package.json packages/eslint-config/package.json
COPY apps/api/package.json apps/api/package.json

# deploy 重新生成仅含生产依赖的独立 lockfile，避免虚拟存储带入全部开发包
RUN pnpm install --frozen-lockfile --filter api...

# workspace 共享包为纯 TS 源码，deploy 前一并拷贝
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm deploy --filter api --prod /prod/api

FROM base AS runtime
WORKDIR /app
COPY --from=build /prod/api /app

# 兼容宿主机 0600 文件权限；仅数据与日志目录交由 node 写入
RUN chmod -R a+rX /app && mkdir -p /data /app/logs && chown -R node:node /data /app/logs

ENV NODE_ENV=production
ENV API_PORT=7101
# 上传目录挂到 volume，容器重建后图片不丢失；业务数据全部由 MySQL 持久化
ENV API_DATA_DIR=/data
VOLUME ["/data"]

EXPOSE 7101

USER node
CMD ["pnpm", "start"]
