# syntax=docker/dockerfile:1

# API 服务（Express + tsx，直接运行 TypeScript 源码）。
# 构建上下文必须是仓库根目录：api 依赖 workspace 包 @weshop/shared（纯 TS 源码，由 tsx 加载）。
FROM node:24-alpine

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /app

# 先拷贝清单文件，最大化利用 Docker 层缓存
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/eslint-config/package.json packages/eslint-config/package.json
COPY apps/api/package.json apps/api/package.json

# 仅安装 api 及其 workspace 依赖（devDependencies 中的 tsx 为运行时所需，不能裁剪）
RUN pnpm install --frozen-lockfile --filter api...

# 再拷贝源码
COPY packages/shared packages/shared
COPY apps/api apps/api

ENV NODE_ENV=production
ENV API_PORT=7101
# 数据目录挂到 volume，容器重建后 SQLite 与上传文件不丢失
ENV API_DATA_DIR=/data
VOLUME ["/data"]

EXPOSE 7101

CMD ["pnpm", "--filter", "api", "start"]
