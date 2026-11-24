---
schema: nbook.task/v2
taskId: t05-scaffold
status: active
updated: 2026-11-24
---

# 脚手架：包、进程入口、迁移、合同测试底座、镜像

## 目标与范围

建七个工作区包与进程入口；每个模块自带迁移并在启动前执行；合同测试包能起真实进程并经 HTTP 测一个健康检查；测试文档登记新的一类；CI 里能构建镜像。做完时有一个能部署、只有健康检查的空服务。

合同：[`site.operations`](../../../../../docs/specs/site/operations.md)；包的划分见 [ADR 0059](../../../../../docs/adr/0059-official-site-one-process-split-ready-modules.md)，数据库见 [ADR 0061](../../../../../docs/adr/0061-official-site-sqlite-file-per-module.md)。

## 当前状态

开发者 2026-11-24 让顺序 1 到 4 开工。实施计划见 [`plan.md`](plan.md)（Opus 子代理起草，主会话审定）；`site.operations` 已按计划第 4 节补上命令名、变量名、数据目录布局与两个失败码。

范围：七个工作区包的骨架与按仓库规则的登记；进程入口的启动、只迁移、备份三个命令与两个健康检查；每个模块的迁移运行；合同测试包能起真实进程、每个测试文件一个临时目录；模块包的依赖白名单测试、“合同测试只 import 合同包”的源码守卫与不许 `ATTACH` 的守卫（ADR 0061 决策 1）；测试文档登记“要起服务进程的测试”这一类与 CI 的做法；CI 里构建镜像。不含任何账号与统计的业务接口。

前置：无。代码在 Work 分支 `feat/w00037-official-site`、worktree `.worktree/w00037-official-site`（开工时建）。

## 下一步

按计划的七片依次实施：第 1、2 片（包骨架与登记、迁移运行器）先做，同时请审查者审计划；第 3 片之后与第 7 片之后各交一次实现审查，第 6 片另交前端审查。
