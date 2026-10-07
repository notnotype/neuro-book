---
schema: nbook.task/v2
taskId: t52-kernel-instances-remote
---

# NeuroBook v2 第 5 步 K1：内核的开放运行位置、按调用方门面、远程服务与子实例

## 目标与范围

按 [多实例运行时拓扑](../../../../../docs/proposals/multi-instance-runtime-topology.md)（2026-10-07 `accepted`）第 11 节的 K1，在 `packages/nb-runtime` 实现拓扑需要的内核机制，并先修订对应 Spec。只改内核与 Spec，不接产品：真实 WebSocket 与浏览器宿主归 K2，项目子进程归 K3，Storage 归 K4，插件状态 store 归 K5。

实施计划：[plan.md](plan.md)（2026-10-07 开发者在计划模式中批准）。

行为合同（本 Task 修订）：[`runtime/lifecycle.md`](../../../../../docs/specs/runtime/lifecycle.md)、[`runtime/services.md`](../../../../../docs/specs/runtime/services.md)、[`runtime/plugins.md`](../../../../../docs/specs/runtime/plugins.md)、[`runtime/application.md`](../../../../../docs/specs/runtime/application.md)、[`runtime/plugin-manifest.md`](../../../../../docs/specs/runtime/plugin-manifest.md)、[`runtime/plugin-channel.md`](../../../../../docs/specs/runtime/plugin-channel.md)、[`runtime/plugin-hot-plug.md`](../../../../../docs/specs/runtime/plugin-hot-plug.md)。

## 开发者决定（2026-10-07）

- K1 一个 Task，内部按计划分片逐片提交；
- `runtime/plugin-channel.md` 原地改写为“远程服务与 RPC 协议”，保留路径与 capability；
- 本 Task 实现通用的“拥有者定义的激活事件”机制，`onRemote` 是第一个使用者；
- 主 Agent 编码，omp（默认模型）只读审查；内核可依赖 TypeBox。

## 当前状态

2026-10-07 计划批准；计划已存为 [plan.md](plan.md)，计划指南回写为 Skill [implementation-planning](../../../../skills/implementation-planning/SKILL.md)。下一步：S0 修订 7 份 Spec。
