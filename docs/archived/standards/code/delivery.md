# CI、容器与交付配置规范

适用：`.github/**`、`Dockerfile*`、`docker-compose.yml`、`.dockerignore`、`.gitattributes`、`.gitignore`、`patches/**` 和发布平台配置。

- Workflow 权限使用完成 job 所需的最小集合；外部输入、PR 内容、artifact 和 secret 保持不可信边界。版本、action 和运行时依赖使用现有 pinning 合同。
- 本地与 CI 调用同一 package script 和配置；路径触发器覆盖所维护的源文件，命令顺序保持 prepare、check、build、publish 的既有前置关系。
- 容器使用多阶段构建和最小运行闭包；build arg、环境变量、端口、volume 和 state/cache owner 与产品运行时合同一致。秘密只通过部署环境注入。
- 补丁必须绑定精确上游版本并有校验脚本；升级依赖时先证明补丁仍需要，再更新 hunk 和验证合同。
- YAML/JSON 追加 [`data-formats.md`](data-formats.md)，shell 入口追加 [`scripts/bash.md`](scripts/bash.md)。发布或部署执行仍需要用户授权。

完成标准：权限最小、secret 不落盘、CI 与本地入口一致、容器运行闭包可重建、补丁版本与校验匹配，受影响 workflow 或镜像场景有可观察验证。