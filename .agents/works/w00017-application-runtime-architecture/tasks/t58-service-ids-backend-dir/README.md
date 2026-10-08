---
schema: nbook.task/v2
taskId: t58-service-ids-backend-dir
---

# 服务键按 id 识别、插件后端目录改名 `backend/`、补项目级示例

## 目标与范围

开发者 2026-10-08 看 t57 的示例插件时指出工厂参数不一致、概念模糊、看不出应用级与项目级，同意三项改动并要求规范文档一起改：服务键按服务 id 识别、工厂只收宿主配置；插件里放后端代码的 `server/` 目录改名 `backend/`；补项目级示例与概念说明。

实施计划：[plan.md](plan.md)。

行为合同（本 Task 修订）：[`runtime/services.md`](../../../../../docs/specs/runtime/services.md)、[`runtime/plugins.md`](../../../../../docs/specs/runtime/plugins.md)、[`runtime/application.md`](../../../../../docs/specs/runtime/application.md)、[`runtime/plugin-manifest.md`](../../../../../docs/specs/runtime/plugin-manifest.md)。

## 前置

[t57](../t57-runtime-examples/README.md)（示例插件）。K5 的 [t56](../t56-plugin-state/README.md) 计划在本 Task 之后按新约定改写。

## 当前状态

2026-10-08 计划起草，同日开发者确认（3 项待确认均同意：删去 `keys` 与 `unknown-service-key`、插件之间可在运行时引用对方的 `shared/contracts.ts`、写 ADR 0025），开始实施。
