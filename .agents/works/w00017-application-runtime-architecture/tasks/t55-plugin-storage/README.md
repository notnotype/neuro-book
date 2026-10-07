---
schema: nbook.task/v2
taskId: t55-plugin-storage
---

# NeuroBook v2 第 5 步 K4：`nbook.storage`（插件记录、分区归实例、客户端代理）

## 目标与范围

按 [多实例运行时拓扑](../../../../../docs/proposals/multi-instance-runtime-topology.md)（2026-10-07 `accepted`）第 11 节的 K4 与 [插件的数据与状态](../../../../../docs/proposals/plugin-data-model.md) 第 5 节：插件按记录声明要持久化的数据；user 分区在服务端实例、project 分区在项目实例、浏览器经代理访问；按插件划分命名空间、`local` 按客户端分区；读取分类、条件保存、订阅；客户端代理经内核签发的消费上下文转发。

实施计划：[plan.md](plan.md)（2026-10-07 开发者确认；omp 设计审查见 [evidences/omp-design-review.txt](evidences/omp-design-review.txt)，12 条已并入计划）。

行为合同（本 Task 修订）：[`storage/persistence.md`](../../../../../docs/specs/storage/persistence.md)、[`storage/boundaries.md`](../../../../../docs/specs/storage/boundaries.md)、[`runtime/services.md`](../../../../../docs/specs/runtime/services.md)、[`runtime/plugin-channel.md`](../../../../../docs/specs/runtime/plugin-channel.md)、[`runtime/plugins.md`](../../../../../docs/specs/runtime/plugins.md)、[`runtime/plugin-api.md`](../../../../../docs/specs/runtime/plugin-api.md)。

## 前置

K1 [t52](../t52-kernel-instances-remote/README.md)（按调用方门面、委托、远程服务）、K2 [t53](../t53-rpc-port-browser-connection/README.md)（客户端身份）、K3 [t54](../t54-project-child-process/README.md)（项目实例与绑定）。

## 当前状态

2026-10-07 计划确认，“待确认”11 项均按计划的建议确认；从 S0 开始实施。
