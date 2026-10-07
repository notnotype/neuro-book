---
schema: nbook.task/v2
taskId: t53-rpc-port-browser-connection
---

# NeuroBook v2 第 5 步 K2：服务端 RPC 端口与浏览器宿主连接

## 目标与范围

按 [多实例运行时拓扑](../../../../../docs/proposals/multi-instance-runtime-topology.md)（2026-10-07 `accepted`）第 11 节的 K2：服务端宿主开内核 RPC 专用端口（WebSocket，校验 `Origin`），固定握手字段与重连规则，浏览器窗口启动时连上它并在断线后重连；引导接口告知 RPC 端口。只做未绑定项目的客户端，项目绑定与项目子进程归 K3。

实施计划：[plan.md](plan.md)（2026-10-07 开发者确认）。

行为合同（本 Task 修订）：[`runtime/plugin-channel.md`](../../../../../docs/specs/runtime/plugin-channel.md)、[`runtime/server-host.md`](../../../../../docs/specs/runtime/server-host.md)、[`runtime/browser-host.md`](../../../../../docs/specs/runtime/browser-host.md)、[`runtime/api-docs.md`](../../../../../docs/specs/runtime/api-docs.md)。

## 前置

K1 [t52](../t52-kernel-instances-remote/README.md)：内核远程服务、路由与协议（进程内链路）已实现并经 omp 审查修正。

## 当前状态

2026-10-07 开发者确认计划末尾的 4 项，从 S0 开始实施；完成后交 omp（默认模型）在后台只读审查。
