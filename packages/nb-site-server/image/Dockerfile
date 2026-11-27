# 产物由 image/build.ts 在构建机上打好；这里只拷贝，不安装依赖。构建上下文是 dist/image/，不是仓库根。
#
# 基础镜像要 glibc：nb-flock 在 Linux 上经 bun:ffi 加载 libc.so.6 的 flock，alpine（musl）没有这个文件。
# Bun 的版本与本机、CI 构建产物用的 Bun 对齐；部署时再改成按摘要固定（w00037 t13）。
FROM oven/bun:1.4.4-slim
WORKDIR /app
COPY server.js server.js.map ./
# 官方站的网页（nb-site-web 的构建产物），由 NB_SITE_WEB_DIR 交给进程发；属主是 root、对 bun 用户只读，进程不改它。
COPY web ./web
# 数据目录的缺省位置，属于镜像里的 bun 用户（uid 1000）：挂命名卷时 Docker 按镜像里这个目录的属主初始化卷，进程不用 root 也能写。
# 挂宿主目录时属主由宿主决定，要么让它对 uid 1000 可写，要么用 --user 以宿主目录属主的身份跑。
RUN mkdir /data && chown bun:bun /data
# 容器里要监听 0.0.0.0，端口映射才通；对外是否只开放给本机由部署的 Compose 决定。
# NB_SITE_TEST_CONTROL 不设：它只许在监听本机回环时设（site.operations 的配置表），镜像里设了进程会以 config_invalid 拒绝启动。
# BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 关掉 Bun 的转译缓存（缺省写到家目录），守“不往数据目录之外写文件”。
ENV NB_SITE_HOST=0.0.0.0 \
    NB_SITE_PORT=8080 \
    NB_SITE_DATA_DIR=/data \
    NB_SITE_WEB_DIR=/app/web \
    BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
USER bun
EXPOSE 8080
# bun 直接做 1 号进程：进程自己处理 SIGTERM、SIGINT（按 site.operations 输出 9 收口），不需要 init 转发信号。
# --no-env-file：配置只来自环境变量，不读工作目录的 .env。
ENTRYPOINT ["bun", "--no-env-file", "/app/server.js"]
CMD ["serve"]
