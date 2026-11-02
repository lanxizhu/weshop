# syntax=docker/dockerfile:1

# Kotlin Ktor 服务（当前仅 /health 演示接口）。
# 构建上下文为 apps/server 目录。
FROM gradle:8.14-jdk24 AS build

WORKDIR /home/gradle/src
COPY --chown=gradle:gradle . .
RUN gradle installDist --no-daemon

FROM eclipse-temurin:24-jre

WORKDIR /app
COPY --from=build /home/gradle/src/build/install/server ./

EXPOSE 8080
CMD ["./bin/server"]
