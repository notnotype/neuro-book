---
schema: nbook.task/v2
taskId: t26-platform-architecture-redesign
---

# 平台化需求与架构重设计

## 目标与范围

2026-09-28 开发者要求重新做架构设计：先做需求分析，确认后把需求记录进仓库，再展开架构设计（开发者选择“记录与设计一起做”）。

本 Task 只交付文档：

- 已确认的长期决定：[ADR 0022](../../../../../packages/neuro-book/docs/adr/0022-extensible-platform-and-plugin-trust.md)（Accepted）。
- 架构设计：[可扩展应用平台](../../../../../packages/neuro-book/docs/proposals/extensible-application-platform.md)（2026-09-30 `accepted`）。
- 在[总提案](../../../../../packages/neuro-book/docs/proposals/application-runtime-and-plugins.md)、[产品装配提案](../../../../../packages/neuro-book/docs/proposals/application-runtime-product-integration.md)与[提案索引](../../../../../docs/proposals/README.md)中标注被取代的部分与新入口。

不修改产品代码、Spec 或实施计划中已完成切片的记录；不提交、不执行远端操作。

## 已确认的需求

开发者在访谈中逐条确认（最后一轮明确回复“是”）：

- 形态接近 VS Code 的写作 IDE。插件系统最终面向社区第三方开发者，要有公开 API、安装和隔离。
- 以文生图插件为最终验收样例：从本地文件夹安装，不改源码、不重新构建，在编辑器右键菜单、Agent 工具、侧边视图、Project 资产写入四处生效。2026-09-29 修订：安装、启用、禁用、卸载、升级都即时生效，不需要重启。
- 内核拥有进程；Nitro、workbench、编辑器、Agent、模型、Project/Files 都是内置插件，插件之间只经贡献点、导出 API、命令协作。
- 第一版完全信任、同进程运行；公开 API 按远程调用形态设计，密钥由模型 Provider 插件保管。开发者认为折中信任方案对第一版过于复杂。
- 推进顺序：地基与内置插件 → 主页面左侧文件资源管理器竖切 → 补齐文生图所需内置插件 → 文生图验收。演示不赶时间。
- 假设 H1–H3 均确认：服务端按单一所有者处理；w00017 已有实现当作素材重新审查、能用则保留；开放第三方代码是需要单独记录的新决定。

## 当前状态

文档已写完。设计稿的三个评审问题已于 2026-09-28 批准：清单用 `package.json`；内置插件新端点一律走插件通道，端点经 SDK 声明、由内核收集生成 API 文档；G0/G1 先于阶段 1 单独验证。开发者要求在 G0/G1 之前先走查前后端启动流程。走查中批准的内容已写入设计稿 P1、P3、P7、P9、P11，ADR 0022 同步修订为运行期即时生效：

- 同源部署加可分离边界、端点静态声明与 API 文档插件；
- 插件热插拔与加载、卸载规则；
- 插件的浏览器部分、G1 比较两种做法；
- 三种协作方式、`nbook.project` 两端。

“Agent 工具与 Profile 的装配”已移交 nb-harness 重构，记于 [w00002 研究材料](../../../w00002-neuro-agent-harness-redesign/research/2026-09-29-plugin-agent-tools-and-profiles.md)。

2026-09-30 开发者重新确定需求基线六条并全部确认：插件系统、热插拔三档（L1 承诺、L2 尽力可验证、不做 L3）、三种协作方式、可选能力（门面加贡献或联动项）、引用撤回（内核账本与转发器）、在途工作（三步停止、worker 池、看门狗）。第三方插件与宿主同线程运行，不采用每插件一个 worker。已写入设计稿 P1、P3、P4、P6、P11 与 ADR 0022。支撑实验：[worker 实验](evidences/worker-probe/output.txt)、[同线程卸载、内存与看门狗实验](evidences/inproc-probe/output.txt)；开发者仓库外的两份笔记（HMR 与模块卸载、插件与前端通信）按路径在调研文档中引用。

2026-09-30 开发者确认插件与前端通信（P5）的全部细化，设计改为 `accepted`。本 Task 交付完成：ADR 0022 与可扩展应用平台设计已于 `476d430b` 本地提交。

三个风险门的验证移交 [t27](../t27-platform-risk-gates/README.md)：

- **G0**：Nitro `entry` 选项配合 `node-listener` 形态的自有服务端入口，以及该入口上的 WebSocket 升级与鉴权；
- **G1**：浏览器端让运行时加载的插件组件共享宿主的 Vue 与 nb-ui（import map 与宿主模块表两种做法）；
- **G2**：看门狗阈值、Desktop 与 Manager 在进程被结束后的重启行为、Windows 上结束进程的方式、worker 池 API。

## 验证

- `governance:context -- --work w00017-application-runtime-architecture --task t26-platform-architecture-redesign`：见 [evidences/context-check.txt](evidences/context-check.txt)。
- 仓库根 `bun run docs:check`：见 [evidences/docs-check.txt](evidences/docs-check.txt)。
- 未运行产品测试、构建或浏览器验证；本 Task 无产品代码改动。`evidences/` 下的实验脚本只在本机 Bun 1.4.2 上运行，未覆盖 Windows。

## 下一步

无。后续工作在 [t27](../t27-platform-risk-gates/README.md) 继续：三个风险门的结论决定 P6、P7 是否需要修改；都成立后把 `runtime.plugins`、`runtime.application` 的改动与新增 capability 写入 `planned` Spec，再进入阶段 1。
