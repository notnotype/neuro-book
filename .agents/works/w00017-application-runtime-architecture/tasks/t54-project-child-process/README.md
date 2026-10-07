---
schema: nbook.task/v2
taskId: t54-project-child-process
---

# NeuroBook v2 第 5 步 K3：项目子进程、项目管理与客户端绑定

## 目标与范围

按 [多实例运行时拓扑](../../../../../docs/proposals/multi-instance-runtime-topology.md)（2026-10-07 `accepted`）第 11 节的 K3：服务端宿主管理项目（身份、登记表、锁、租约、宽限期、崩溃通知），每个打开的项目一个子进程、里面一个 `project` 位置的内核实例，经进程间链路接入服务端路由；浏览器窗口按 `/?project=` 绑定项目代次，宽限期内重连恢复、超过宽限期要求重新加载；服务端停止时先封闭接纳、再停项目子进程；最小的“打开项目”命令。

实施计划：[plan.md](plan.md)（2026-10-07 开发者确认，Context 里列出了讨论中确认的 7 项）。

行为合同（本 Task 修订）：新 Spec `runtime/projects.md`，以及 [`runtime/plugin-channel.md`](../../../../../docs/specs/runtime/plugin-channel.md)、[`runtime/server-host.md`](../../../../../docs/specs/runtime/server-host.md)、[`runtime/browser-host.md`](../../../../../docs/specs/runtime/browser-host.md)、[`runtime/application.md`](../../../../../docs/specs/runtime/application.md)、[`workspace/resources.md`](../../../../../docs/specs/workspace/resources.md)。

## 前置

K1 [t52](../t52-kernel-instances-remote/README.md)（子实例与租约、远程服务路由）；K2 [t53](../t53-rpc-port-browser-connection/README.md)（服务端 RPC 端口、浏览器连接与重连）。

## 当前状态

2026-10-07 计划确认：进程间通信用 Bun IPC；宽限期 5 分钟、崩溃不自动重启；项目身份写进 `.nbook/project.json`；不做防双开的锁（遗留设计，推迟到出现项目级持久数据时再定）；项目管理由宿主以本地能力 `projectsKey` 提供，`nbook.projects` 只做界面与客户端的远程入口；合同声明提供方位置、`.at()` 可省略；无租约访问只到 `available` 的项目。交 omp（默认模型）只读审查设计，审查修订后从 S0 开始。
