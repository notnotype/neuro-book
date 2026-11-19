生产服务器 t133 资产（不含 secret、数据库或证书私钥）。

固定路径：
- Node 服务：/srv/llmlint/current/web/.output/server/index.mjs
- SQLite：/srv/llmlint/data/data.db
- runtime eval config：/srv/llmlint/runtime/eval.config.json
- 日志：/srv/llmlint/logs/web.jsonl
- secret：/srv/llmlint/secrets/web.env（仅远端手工写入，0600）
- systemd：/etc/systemd/system/llmlint-web.service
- TLS vhost：/etc/nginx/conf.d/llmlint-web-https.conf
- ACME vhost：/etc/nginx/conf.d/llmlint-web-acme.conf
- stream map：/etc/nginx/stream.d/stream-preflight.conf

运行时必须使用 Linux Node >=22.12，不能上传 Windows `.output`；在生产服务器上 frozen install、`db:init`、`db:generate`、build 后运行 Node 产物。`install-release.sh` 只负责解包、调用 `/usr/local/sbin/llmlint-build-release` 并切换 `current`，不会启动 systemd；正式启动仍需人工完成 secret、证书、Nginx 与 unit 验收。
stream 端口启用 `proxy_protocol`，禁止直接 `curl --resolve` 到 31445；HTTPS 验收必须经过公网 443 SNI 或等价的本地 PROXY/SNI 预演。
