---
schema: nbook.task/v2
taskId: t13-deploy-and-cutover
status: planned
updated: 2026-11-24
---

# 部署与切换

## 目标与范围

生产主机上的 Compose 与反向代理配置（含不留 IP 的那几项）、每晚备份、按固定摘要升级；先在遥测的域名上线，再切站点域名。每一步生产操作另取开发者授权。

合同：[`site.operations`](../../../../../docs/specs/site/operations.md)；[`site.telemetry-ingest`](../../../../../docs/specs/site/telemetry-ingest.md) 的部署前置（写入口不留来源地址）。

## 当前状态

未开工：开发者 2026-11-24 要求先把 ADR、Task 与文档写好，开工等他的指示。

范围：生产主机上的 Compose 与反向代理配置、每晚备份、按固定摘要升级的脚本；分两步上线：先在遥测的域名上线（旧站不动），再切站点域名（停旧站、导入、切换）。

前置：第一步要 [t06](../t06-telemetry-ingest/README.md)；第二步要 t07 到 t12 全部完成、条款上线（[w00053 t08](../../../w00053-telemetry-feedback-stats/tasks/t08-terms/README.md)）。每一步生产操作（DNS、证书、反向代理、启停服务）动手前另取开发者授权。还没定的：遥测写入口的域名、站点域名是否沿用现在的、异地备份。

从 t05、t06 的审查接过来的（2026-11-24）：

- 升级前的备份用正在运行的那个版本做：新版本的备份命令遇到还没迁移的库会以 `prepare_failed` 失败。
- 能换回去的版本都要带统计的删除任务与备份时的清空（`site.telemetry-ingest` 的边界一节）；发布时的相邻版本验证比的是已部署的那个版本，不只是基准提交。
- 备份目录与每份备份新建时是 0700；把 `backups` 链到另一块盘是允许的。
- 来自 t05 第 7 片：基础镜像按摘要固定、CI 的 Bun 版本与镜像对齐、Compose 的停止宽限 17 秒、数据卷的属主、健康检查与反向代理；CI 的 `site-image` 作业在分支上没实际跑过，合入并推送后看第一次的结果。

- 来自 t07 的计划（2026-11-24）：Better Auth 钉在一个精确的版本上，安全修复不会自动到；发布步骤里加一项“查上游的安全公告与依赖告警”，升级时照账号模块说明里的升级清单重跑那几组用例。

- 来自 t10（2026-11-27）：
  - 部署用的镜像构建要设 `NB_SITE_RELEASE=1`（只认 `1`），例如 `NB_SITE_RELEASE=1 bun run --cwd packages/nb-site-server build:image`：这时隐私政策与服务条款还是占位正文就构建失败。CI 每次的镜像构建不设它，所以 CI 打出的镜像里可能是占位正文，不能直接拿去部署。条款文字来了：删两份正文的 `placeholder` 行，版本改成服务端 `NB_SITE_IDENTITY_TERMS_VERSION` 的值。
  - 镜像里 `NB_SITE_WEB_DIR=/app/web`，进程发网页；压缩、`ETag` 与 HSTS 不由进程做，交反向代理（`site.operations` 不承诺一节）。
  - 网页在启动时解开一次产物目录，换产物要重启进程。

## 下一步

开工时写实施计划与逐步的回退办法。
