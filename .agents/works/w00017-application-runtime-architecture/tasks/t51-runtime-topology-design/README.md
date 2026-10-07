---
schema: nbook.task/v2
taskId: t51-runtime-topology-design
---

# NeuroBook v2 第 5 步（设计）：多实例运行时拓扑与插件数据

## 目标与范围

[t50](../t50-workbench-shell-design/README.md) 审查期间，开发者 2026-10-06 决定推迟 Files 竖切，先补插件通信、Storage、项目与配置；讨论中进一步确定了运行时拓扑与插件数据模型。本 Task 只做设计，不改产品代码与 Spec：

- [多实例运行时拓扑](../../../../../docs/proposals/multi-instance-runtime-topology.md)（`reviewing`）：四类内核实例、项目子进程、客户端绑定、本地服务与内核路由的远程服务、RPC 协议与内核专用端口、`nbook.http` 的定位、实施切片 K1–K6；
- [ADR 0024](../../../../../docs/adr/0024-multi-instance-runtime-topology.md)：上述长期决定；
- [插件的数据与状态](../../../../../docs/proposals/plugin-data-model.md)（`reviewing`）：数据归位判据、插件状态 store、公开状态与 `when`、Storage 命名空间与分区归属、配置读写，工作台走查。

行为合同未变：本 Task 不改 Spec；两份设计稿通过后按各自“对 Spec 的预期改动”修订。

## 开发者决定

逐条见两份设计稿的决策记录。摘要：

- 2026-10-06：Files 竖切推迟；登录先不做；旧项目先不兼容；编辑器先不决定；设计考虑 TUI，TUI 作为客户端连服务端进程；命令给人与 Agent 用，一个命令只由一个位置实现；配置与 Storage 分开；插件经服务访问 Storage 与配置，内核按调用方生成服务实例；密钥归配置插件；本标签页状态放 URL；大文件走文件或资产服务。
- 2026-10-07：多项目由内核子实例机制与服务端宿主管理；项目实例运行在子进程；通信由内核路由、可直达任意服务；双向通道用 WebSocket；内核专用 RPC 端口，HTTP 端口归 `nbook.http`；客户端一生只绑定一个项目；内核可依赖 TypeBox；按需激活写作 `onRemote:<服务 id>`；所有已声明的配置项可只读访问；界面语言为平台级设置、即时切换；用户自定义菜单与快捷键用配置文件；`defineStore` 作为插件作者的统一状态入口；先做 K1–K5，再做外壳实现。

## 当前状态

2026-10-07 两份设计稿与 ADR 起草完成，开发者已看过并要求交 omp 审查。

仍在讨论：Agent 会话放在项目实例还是服务端实例（是否跨项目）。其余待定项见两份设计稿。

## 下一步

- omp 只读审查两份设计稿与 ADR，主 Agent 逐条核实后修订；
- 修订 t50 设计稿（omp 审查 11 条）；
- 设计稿通过后改为 `accepted`，修订相关 Spec 与 v2 重建提案的推进顺序，再创建 K1 Task。
