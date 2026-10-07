---
schema: nbook.work/v1
workId: w00017-application-runtime-architecture
issueId: null
---

# 应用运行时与内置插件架构

## 当前结论与授权

2026-09-20 开发者接受基础架构与分段推进方向，并要求先完成规范与实施规划：

1. 第一实现切片止于**环境适配入口 + 小内核**，必须可验证、代码规范、能适配不同宿主与作用域。
2. 第二切片以内置服务插件检验地基；当前最小真实集合为**诊断、平台文件、SQLite**。其它应用服务随首次真实功能消费接入，不先搬完所有后台。
3. 后续按**外部插件开发者视角**推进 Lab → Files → Settings → World/Plot，不把第三方市场/SDK/沙箱引入当前范围。
4. 开发者要求先等 w00003 合并 master 再创建 w00017 worktree；该条件已于 `bb688931`（Merge branch `refactor/w00003-nb-ui-adoption` into master）满足，实现 worktree 已创建，t05–t09 已按批准的实施计划执行。
5. 2026-09-28 开发者重做需求分析并确认 [ADR 0022](../../../docs/adr/0022-extensible-platform-and-plugin-trust.md)：开放第三方可执行插件；内核拥有进程，HTTP、workbench、Agent、模型等都是内置插件；第一版完全信任、公开 API 为远程形态。第 3 条的第三方范围与 Files 之后的顺序由此改为“地基 → Files 竖切 → 扩展点 → 文生图验收”。机制设计见 [t26](tasks/t26-platform-architecture-redesign/README.md)，设计稿于 2026-09-30 `accepted`；实施前先由 [t27](tasks/t27-platform-risk-gates/README.md) 验证风险门 G0、G1、G2。
6. 2026-10-03 阶段 2 第 1 片（t42）完成后，开发者决定暂停在 `packages/neuro-book` 上的 Files 竖切，改为在同一仓库并排新建应用、从零构建；旧包只读作参照，w00017 成为长期分支、暂不合 master。新应用先只有运行时底座与 workbench 底座，Files 竖切在这个壳子上验证。详见[整体实施路径](implementation-plan.md#2026-10-03-暂停改为并排新建应用)。
7. 2026-10-07 开发者认可 [多实例运行时拓扑](../../../docs/proposals/multi-instance-runtime-topology.md)、[插件的数据与状态](../../../docs/proposals/plugin-data-model.md) 与修订后的 [外壳设计稿](../../../docs/proposals/workbench-shell-abstractions.md)（均 `accepted`），长期决定见 [ADR 0024](../../../docs/adr/0024-multi-instance-runtime-topology.md)：服务端、项目子进程、浏览器与 TUI 客户端四类内核实例，插件间只用本地服务与内核路由的远程服务。v2 推进顺序随之修订：第 5 步先做 K1–K6（内核、宿主 RPC 端口、项目子进程、Storage、插件状态与公开状态、配置），外壳实现排在 K5 之后，Files 竖切改为第 6 步。设计见 [t50](tasks/t50-workbench-shell-design/README.md)、[t51](tasks/t51-runtime-topology-design/README.md)。

规范、Work、整体路径、Task 与审查证据在主线提交 `bc144b2d`。第一片（t05–t09）与第二片（t10–t13）的七项 Spec 已晋升 `implemented`；[t14 Lab 宿主边界](tasks/t14-lab-host-boundary/README.md) 将 LabShell 常驻产品命令宿主收回命令场景，直接打开 `/lab` 跳过产品配色与旧桶迁移，保持 Lab 自有检视和偏好。2026-09-26 开发者报告在 `http://localhost:3000/lab` 完成人工验证，目前未发现问题；后续 [t15 Files 设计](tasks/t15-files-explorer-design/README.md) 纳入文件切换性能重构与主页面左侧资源管理器迁入 Lab。Files 切片期间已将进程级 Session Store gate 和 Project generation owner 接入 runtime.application；产品日志器与既有数据库仍走旧入口。未执行 push、PR、合并或真实模型验收。开发者 2026-09-23 决定首两片一起合，第三片按方案 B 继续本地实施；远端操作仍需授权。

2026-09-26 开发者接受 Files 首版 F1–F9 默认策略、第二版草案及文档拆分后，明确批准首版实施计划并要求逐步执行、逐步验证；2026-09-27 又批准两项合同逐条复核。仅允许计划内本地开发、自建 Temp 初始化迁移、独立服务及主页面/Lab 浏览器验收；不触碰作品、现有服务或真实模型，不包含提交或远端操作。t16–t24 完成精确绑定、双模式、操作结算、四组热切换测量、最后标签释放、双窗口与 Lab 390 px 画布验收；[t25 逐条复核](tasks/t25-files-contract-closure/README.md)补 Files 插件注册及请求租约、多选删除/原生鼠标拖动、同目录改名复制、源实体核对、未知结果处理和 SSE EOF 中断提示，并在隔离主页面复验。Project generation owner 已迁入 Application 子 Scope；追加 Windows 本机原子 no-replace move 竞争与完整产品镜像构建验证。两项 Files 合同仍为 `planned`：Linux/macOS 与其它文件系统未实测，跨机器基础操作缺第二隔离宿主。第二版快速打开/删除恢复仍为 `draft`，不纳入。

## 规范与实施入口

- [总体提案](../../../packages/neuro-book-legacy/docs/proposals/application-runtime-and-plugins.md)：`accepted` 为基础架构与分段方向；任意热卸载/代码升级仍仅评估，未纳入当前实施。
- [可扩展应用平台设计](../../../docs/proposals/extensible-application-platform.md)：`accepted`（2026-09-30），2026-09-28 需求重做后的内核、插件模型、热插拔、插件通道与推进路线；已确认的长期决定见 [ADR 0022](../../../docs/adr/0022-extensible-platform-and-plugin-trust.md)。
- 第一片 `implemented`：[runtime.lifecycle](../../../docs/specs/runtime/lifecycle.md)、[runtime.services](../../../docs/specs/runtime/services.md)、[runtime.plugins](../../../docs/specs/runtime/plugins.md)、[runtime.application](../../../docs/specs/runtime/application.md)（受控装配入口；进程级产品门禁/Session Store lease 及 Project generation owner 已接入）。
- 第二片 `implemented`：[runtime.diagnostics](../../../docs/specs/runtime/diagnostics.md)、[platform.files](../../../docs/specs/platform/files.md)、[platform.sqlite](../../../docs/specs/platform/sqlite.md)（真实服务插件；产品日志器与既有数据库尚未迁入）。
- Files 首版 `planned`：[workspace.files](../../../docs/specs/workspace/files.md)、[workbench.files-explorer](../../../docs/specs/workbench/files-explorer.md)；F1–F9 产品交互、Project owner、单机浏览器主链与 t25 合同复核已落地；Windows 原子 no-replace 移动本机验证及完整产品镜像构建通过，Linux/macOS、其它文件系统及跨机器基础操作未验收，不等于整体 `implemented`。
- [Files 第一版设计](../../../packages/neuro-book-legacy/docs/proposals/files-explorer.md)：`accepted`，设计理由与性能依据；[第二版草案](../../../packages/neuro-book-legacy/docs/proposals/files-explorer-v2.md)：`draft`，新增目标与待审风险；[产品装配设计](../../../packages/neuro-book-legacy/docs/proposals/application-runtime-product-integration.md)：跨功能接入细化，`reviewing`。
- [整体实施路径](implementation-plan.md)：各切片模块、文件边界、依赖、实际smoke、旧入口退出与worktree前提；是工程计划，不复制行为合同。
- 既有命令、Storage、Lab、Workbench等能力沿同一Spec修订，不建“插件版”副本。

## 当前 Task 与继续条件

| Task | 当前范围 |
|---|---|
| [t01](tasks/t01-architecture-proposal/README.md) | 已完成架构提案与 B/S 追加设计的历史交付 |
| [t02](tasks/t02-runtime-contract-review/README.md) | 独立运行时／资源合同复核；各轮报告分开 |
| [t03](tasks/t03-document-governance-review/README.md) | 独立读者／治理与计划可执行性复核 |
| [t04](tasks/t04-foundation-spec-plan/README.md) | 当前规范、整体实施方案与治理集成 |
| [t05](tasks/t05-runtime-lifecycle/README.md) | 生命周期机制与独立验证入口；提交 `a03c7169`、`3defd3dc`，后由 t09 复核将 `runtime.lifecycle` 晋升 `implemented` |
| [t06](tasks/t06-runtime-services/README.md) | 服务装配、依赖解析；提交 `c8d7000e`、`b7e7b41c`，后由 t09 复核将 `runtime.services` 晋升 `implemented` |
| [t07](tasks/t07-runtime-plugins/README.md) | 插件描述、激活与贡献事务；机制、测试与 smoke 已交付，后由 t09 复核将 `runtime.plugins` 晋升 `implemented` |
| [t08](tasks/t08-runtime-application/README.md) | 第一片收口单元：`runtime.application` 内核、后端／浏览器适配器与 `smoke:runtime-foundation`；测试、typecheck、真实子进程与真实 Chromium smoke 已通过并提交 |
| [t09](tasks/t09-foundation-integration-review/README.md) | 首片集成复核：逐条对照四项 Spec，修复有界停止、实例身份退役等缺口（`4d0b3c84`、`728acd40`、`b53753b9`），经独立 Reviewer 复核后四项 Spec 晋升 `implemented` |
| [t10](tasks/t10-runtime-diagnostics/README.md) | 第二片：诊断记录能力与插件、JSONL/console 出口；产品日志器共用 JSONL 写入与脱敏 |
| [t11](tasks/t11-platform-files/README.md) | 第二片：受根约束的文件能力插件（授予、包含校验、watch、锁、关闭门禁） |
| [t12](tasks/t12-platform-sqlite/README.md) | 第二片：受管 SQLite 机制插件（具名资源 owner、借用、事务、代次） |
| [t13](tasks/t13-services-integration-review/README.md) | 第二片集成复核：`--services` 组合 smoke、逐条对照三项 Spec、修复插件释放重试等缺口后晋升 `implemented` |
| [t14](tasks/t14-lab-host-boundary/README.md) | 第三片：Lab 文档启动边界、命令场景局部宿主、四个检视 tab、core 浏览器 smoke 与 w00016 交接 |
| [t15](tasks/t15-files-explorer-design/README.md) | Files 首版 F1–F9 已收口到两项 planned 合同；独立首版设计、第二版 draft 与总提案拆分治理；尚未实施或测量提速 |
| [t16](tasks/t16-files-baseline/README.md) | 首版批准计划的隔离基线与冻结预算：真实主页面冷开、源码/富文本单/双组热切换 |
| [t17](tasks/t17-files-primitives-editor-state/README.md) | 排他文件原语、并发实测与编辑状态挂接实验；公开 Tiptap/Monaco 路径可行，产品适配未实施 |
| [t18](tasks/t18-files-binding-read-write/README.md) | 精确 Project 绑定的服务、API、浏览器客户端与真实条件读写；隔离主页面树/正文及 HTTP 写入、旧代次/冲突已验证 |
| [t19](tasks/t19-open-switch-settlement/README.md) | 打开/切换输入结算、失败/冲突/在途保存不释放旧正文；定向测试和隔离浏览器 A→B→A 输入保留通过 |
| [t20](tasks/t20-controlled-files-explorer/README.md) | 已完成：受控文件树、普通/内容节点双模式、模式记录与主页面适配；定向测试、typecheck、隔离主页面往返及 390px 重开恢复通过 |
| [t21](tasks/t21-safe-base-file-operations/README.md) | 已完成：基础创建、重命名/移动、删除复用精确绑定与 Storage 边界；显式拒绝自身后代、同路径 no-op、同名排他；原语测试与 typecheck 通过 |
| [t22](tasks/t22-multi-select-clipboard-batch/README.md) | 已完成：真实多选、窗口内剪贴板、批量复制/移动、父子去重、逐项反馈、部分失败残留、绑定失效停止、History 与产品磁盘验收通过 |
| [t23](tasks/t23-file-operation-settlement/README.md) | 已完成：复制 dirty 三选一、移动输入结算与成功重绑定、删除影响确认及 dirty/conflict 取消；定向测试/typecheck 与隔离浏览器磁盘验收通过 |
| [t24](tasks/t24-files-switch-performance/README.md) | 四组永久标签 3×30 热切换与输入撤销通过，富文本单/双组 p95=38.0/42.1 ms，源码单/双组 p95=53.8/53.4 ms；Lab 五态无产品请求，390 px 手机画布可见；双窗口、错误重试、最后标签 Tiptap/Monaco 释放已实测 |
| [t25](tasks/t25-files-contract-closure/README.md) | 全合同复核与本机修复验收：同名协商、多选删除/原生拖动、源身份、取消/未知结果、EOF 失同步与内置 Files 服务装配；追加原子 no-replace 路径移动、Windows 同名竞争和完整产品镜像构建验证；跨平台与跨机器仍未闭合 |
| [t26](tasks/t26-platform-architecture-redesign/README.md) | 2026-09-28 需求重做与设计走查：需求记入 ADR 0022；可扩展应用平台设计 2026-09-30 `accepted`；无产品代码改动 |
| [t27](tasks/t27-platform-risk-gates/README.md) | 风险门 G0（自有服务端入口与 WebSocket 升级）、G1（运行时加载组件共享 Vue 与 nb-ui）、G2（看门狗、进程重启、worker 池）的一次性验证 |
| [t28](tasks/t28-platform-planned-specs/README.md) | 按已接受的平台设计写 10 份 `planned` Spec（插件清单、宿主、通道、API 文档、热插拔、安装、代码装载、公开 API、看门狗），并做跨模型审查；只改文档 |
| [t29](tasks/t29-master-sync/README.md) | 同步 master 与 w00020（PR #245），解决冲突；发现分支原有的测试回归 |
| [t30](tasks/t30-branch-test-baseline/README.md) | 修复分支测试与类型检查基线（omp 编码）；修复 Profile 预览线程边界与 watcher 前 rename 丢失；之后 master 快进到 `f00f0380` |
| [t31](tasks/t31-product-lifecycle-smoke/README.md) | 阶段 1 生命周期 smoke `smoke:product-lifecycle`（L1–L10）与当前基线（omp 编码） |
| [t32](tasks/t32-kernel-entry-dependencies/README.md) | 阶段 1 第一片：服务 id 归插件、按入口受阻推导、插件汇总、启动按依赖激活、关闭严格逆序与激活/关闭诊断（omp 编码）；`runtime.plugins`、`runtime.application` Spec 同步修订 |
| [t33](tasks/t33-owner-contribution-points/README.md) | 阶段 1 第二片：贡献点由拥有者插件定义、按单条贡献校验、接收者由拥有者入口交出并按交付账本补交与撤回，Files 改由过渡插件 `nbook.workbench` 接收（omp 编码）；`runtime.plugins`、`runtime.application`、`runtime.plugin-manifest` Spec 同步修订 |
| [t34](tasks/t34-builtin-service-plugins/README.md) | 阶段 1 第三片：App State、Storage、Session Store、Project、Agent 的生命周期迁为启动必需的内置插件，关闭顺序由依赖图产生，插件诊断写入产品日志，L2 通过（omp 编码）；发现内核显式恢复逐层推进与生产归档下载 crc32 打包两个缺陷 |
| [t35](tasks/t35-archive-crc32-bundle/README.md) | 修复产品后处理 esbuild 把 `buffer-crc32`、`bignumber.js` 的 `require` 解析到 ESM 入口的问题（生产归档下载崩溃、大整数解析失败），新增真实产物检查；L3、L4 在途下载通过（omp 编码） |
| [t36](tasks/t36-lifecycle-recover-cascade/README.md) | 修复内核显式恢复逐层推进：关闭与恢复先同步登记整棵子树的尝试再规划释放，一次恢复推进整条依赖链，保留原有启动时序（omp 编码）；`runtime.lifecycle` Spec 同步修订 |
| [t37](tasks/t37-server-host-entry/README.md) | 自有服务端宿主入口与 `nbook.http`：宿主拥有进程信号与停止通道，先排空（503、SSE 主动关闭、20 秒上限）再按依赖逆序关闭，退出码 0/1/75；删除启动中间件、`productRuntimeReady()` 与关闭控制器（omp 编码）；L1–L7、L10 通过 |
| [t38](tasks/t38-development-host/README.md) | 开发宿主（#244）：nuxi 主线程中的开发宿主接管信号并经 `BroadcastChannel` 与 worker 协调，热重载先停旧实例，Session Store 租约对同进程旧实例有界等待，开发进程有序停止后退出；同 worker 内请求重试按开发者决定不做（omp 编码）；L1–L8、L10 通过 |
| [t39](tasks/t39-browser-host/README.md) | 浏览器宿主（最小范围）：需要登录的引导接口，client plugin 在挂载前完成引导并激活 `nbook.workbench`，失败显示带重试的连接失败页而不渲染工作台；命令表归 workbench 插件，`index.vue` 不再创建运行实例（omp 编码）；`smoke:product-lifecycle` L1–L10 全部通过 |
| [t40](tasks/t40-phase1-closing/README.md) | 阶段 1 收尾：`server/plugins/` 下 5 个 Nitro 插件迁入内置插件（`nbook.diagnostics` 进入产品清单并借用 `appLogger` 的 writer），产品启动包装进程链如实传递退出码，smoke 在检查未执行时以非零退出（omp 编码）；阶段 1 完成 |
| [t41](tasks/t41-files-vertical-design/README.md) | 阶段 2 Files 竖切需求讨论：与开发者逐条划定需求、成功标准（性能表）与分项决定，写成设计稿 [项目文件底座与 Files 竖切](../../../docs/proposals/project-file-foundation.md)，2026-10-02 `accepted`；随后写入 `workspace.resources`、`workspace.folder-kinds` 两份 `planned` Spec 并修订两份 Files Spec |
| [t42](tasks/t42-files-baseline-research/README.md) | 阶段 2 Files 竖切第 1 片：在约 3000 个文件的合成样本上拆解打开项目与切换文件的耗时，针对性调研 VS Code 文件服务与资源管理器；不改产品行为（只加常驻计时点）。2026-10-03 完成：3000 个文件时打开项目约 6 s、切换 0.9–1.6 s，主因是 Pinia 持久化对整个 store 的深度订阅（耗时随文件数线性增长）与文件树单击固定等待 180 ms；结论待开发者确认 |
| [t43](tasks/t43-repository-reorganization/README.md) | NeuroBook v2 第 1 步：旧包改名 `neuro-book-legacy`，删除交付链，归档过时文档，有效设计文档移到仓库级，改写入口与治理检查；2026-10-03 完成，`docs:check`、`governance:check` 无失败 |
| [t44](tasks/t44-governance-check-cleanup/README.md) | 第 2 步前的治理整理：`docs:check`、`governance:check` 的警告只报本次改动，删除核对冻结历史的规则与两条迁移命令，修正指向已删除路径的规则，新增 `test:affected` 按改动选包运行测试；2026-10-03 完成，治理检查主文件与测试由 4437 行减到 1148 行，两项检查失败为 0 |
| [t45](tasks/t45-nb-runtime-package/README.md) | NeuroBook v2 第 2 步：内核 `runtime/` 抽成 `packages/nb-runtime`（零依赖，`bun test`），五份内核 Spec 的证据改指新包；主 Agent 编码，omp 审查无阻断，4 条意见已采纳；2026-10-03 完成，166 个用例通过 |
| [t46](tasks/t46-server-host/README.md) | NeuroBook v2 第 3 步（上）：新应用的后端宿主、`nbook.http`（Bun 监听、排空、插件路由贡献点）与 `nbook.diagnostics`（JSONL 出口）；主 Agent 编码，omp 审查 2 条阻断经核实改为 1 处防御修正与 Spec 澄清，其余 5 条采纳；2026-10-03 完成，40 个用例通过 |
| [t47](tasks/t47-web-host-dev-supervisor/README.md) | NeuroBook v2 第 3 步（下）：开发监督进程、Vite + Vue 前端、浏览器宿主与引导接口、生产静态资源；打开后是空工作台；主 Agent 编码，omp 审查；2026-10-03 完成，omp 审查 7 条中 5 条修正，81 个合同测试与 6 个浏览器 e2e 通过 |
| [t48](tasks/t48-web-ui-foundation-lab/README.md) | NeuroBook v2 第 4 步（一）：前端基础（vue-router、UnoCSS、nb-ui、Vitest 组件测试）与只在开发模式加载的 Lab 插件；第 4 步拆三个 Task，Lab 先行；主 Agent 编码，omp 审查；2026-10-04 完成，omp 审查 12 条中 11 条修正、1 条改 Spec，111 个 Bun 用例、33 个组件测试与 18 个浏览器 e2e 通过 |
| [t49](tasks/t49-commands-quick-open/README.md) | NeuroBook v2 第 4 步（二）：命令系统做成两端都有入口的内置插件 `nbook.commands`（内核不提供 `ctx.commands`，ADR 0022 与平台设计同步修订；激活事件改由拥有者插件定义），workbench 提供命令面板与浏览器键位分发，Lab 命令场景用 textarea 样板编辑器；主 Agent 编码，omp 审查；2026-10-06 完成，omp 审查 4 条全部成立（1 条代码修正、2 条改 Spec、1 条改测试断言），173 个 Bun 用例、47 个组件测试与 30 个浏览器 e2e 通过 |
| [t50](tasks/t50-workbench-shell-design/README.md) | NeuroBook v2 第 4 步（三）：工作台外壳的抽象设计（Part、ToolPart、Switcher、ActivityBar、ViewContainer、View 的对象模型，插件面向的视图合同，布局记录与持久化端口），设计稿 [workbench-shell-abstractions](../../../docs/proposals/workbench-shell-abstractions.md)；只改文档；2026-10-06 开发者批准持久化、隐式容器与取舍表三项；omp 审查 11 条全部成立并已修订，布局直接用 `nbook.storage`；2026-10-07 `accepted`，外壳实现排在 t51 的 K5 之后 |
| [t51](tasks/t51-runtime-topology-design/README.md) | NeuroBook v2 第 5 步（设计）：多实例运行时拓扑（服务端、项目子进程、浏览器与 TUI 客户端；内核路由的远程服务与专用 RPC 端口；`nbook.http` 只做 HTTP 边缘）与插件数据（插件状态 store、公开状态与 `when`、Storage 分区归属、配置读写），设计稿 [multi-instance-runtime-topology](../../../docs/proposals/multi-instance-runtime-topology.md)、[plugin-data-model](../../../docs/proposals/plugin-data-model.md) 与 [ADR 0024](../../../docs/adr/0024-multi-instance-runtime-topology.md)；Files 竖切推迟到第 6 步；Agent 会话在服务端、可跨项目；只改文档；2026-10-07 起草，omp 审查 16 条全部成立并已修订，复审无阻断、10 条建议已补；2026-10-07 两稿与 ADR `accepted`，v2 推进顺序同步修订 |
| [t52](tasks/t52-kernel-instances-remote/README.md) | NeuroBook v2 第 5 步 K1：内核的开放运行位置、按调用方门面与委托、远程服务（合同、路由、协议、订阅、按需激活）与子实例租约；先修订 7 份 runtime Spec；2026-10-07 计划批准（[plan.md](tasks/t52-kernel-instances-remote/plan.md)），S0–S10 完成，omp 审查 10 条均已修正，测试与文档检查通过；开发者决定 K1 等 K6 完成后一起验收 |
| [t53](tasks/t53-rpc-port-browser-connection/README.md) | NeuroBook v2 第 5 步 K2：服务端内核 RPC 端口（WebSocket、`Origin` 校验）、握手字段与重连规则、浏览器窗口的连接与重连、引导接口告知端口；只做未绑定项目的客户端；2026-10-07 计划确认（[plan.md](tasks/t53-rpc-port-browser-connection/plan.md)），S0–S8 完成，omp 审查 5 条均已修正，测试、smoke 与 e2e 通过；随 K6 完成后一起验收 |
| [t54](tasks/t54-project-child-process/README.md) | NeuroBook v2 第 5 步 K3：项目子进程（Bun IPC 接入服务端路由）、项目管理（身份、登记表、租约、宽限期、崩溃；不做防双开的锁）、浏览器按 `/?project=` 绑定与宽限期内重连、服务端停止顺序、合同声明提供方位置、宿主能力 `projectsKey` 与 `nbook.projects` 的“打开项目”命令；2026-10-07 计划确认（[plan.md](tasks/t54-project-child-process/plan.md)）、omp 设计审查后修订；S0–S9 实现完成，omp 实现审查 3 条已修正，待验收 |
| [t55](tasks/t55-plugin-storage/README.md) | NeuroBook v2 第 5 步 K4：`nbook.storage`：插件按记录持久化，user 分区在服务端、project 分区在项目实例、浏览器经代理；按插件命名空间、`local` 按客户端分区；条件保存与订阅；内核的跨实例委托与调用方客户端身份；2026-10-07 计划确认（[plan.md](tasks/t55-plugin-storage/plan.md)），omp 设计审查 12 条已并入，待确认 11 项按建议确认；S0–S6 已实现，两轮 omp 实现审查的发现均已修正；`persistence.md` 晋升待开发者审批 |

Project generation 真所有权与此前单机浏览器验收已有证据；t25 针对复核发现的操作与插件装配缺口完成修复和隔离主页面验证。Windows 本机路径竞争以原子 no-replace 拒绝，未知平台和模拟原语不支持时失败关闭。Authoring Kit 意外引用应用认证闭包已切断，受控 SQLite 内建动态导入已登记，完整产品镜像构建通过；Linux/macOS 及其它文件系统未实测，跨机器基础操作仍缺第二隔离宿主；不晋升 Files Spec。

## 执行位置与版本

实现 checkout：`.worktree/w00017-runtime-foundation`（2026-09-28 `governance:context` 核实的实际路径），分支 `refactor/w00017-runtime-foundation`，基线 `411449ec4c1fbc57cceaeb7aa9d2385132a0d3e0`（master，含 w00003 合并 `bb688931` 与本 Work 七项 Spec 提交 `bc144b2d`）。分支上依次有 t05 提交 `a03c7169`、`3defd3dc`，t06 提交 `c8d7000e`、`b7e7b41c`，规则调整 `e457375d`，t07 提交 `e6ef6f19`、`492bc849`，t08 提交 `0e938172`、`2a17e85f`，t09 提交 `4d0b3c84`、`728acd40`、`b53753b9` 与文档提交 `d8956662`、`eeeec16b`，t10–t13 第二片提交。各 Task 的 `governance:context` 在该 checkout 核实身份，原始输出见各自 evidences。

Work／Task 进度只在实现分支维护；主工作区保持 `master`，其 Work 目录副本是 `bc144b2d` 的占号记录，不回填进度、不在主树切分支。登记按 [编号合同](../README.md#编号分配与记录位置) 本地协调，不要求独立登记 PR 或非 squash 祖先关系。

## 不变的产品边界

- 必需服务可插件化，首批随产品发布，不支持任意在线卸载/替换。
- 显式关闭先协商dirty/在途工作；强制退出不保证保存；窗口离开不关闭共享后台Project/Job。
- 服务实例寿命不等于持久记录寿命；不改变现有用户格式、数据库布局或迁移策略。
- 小内核不依赖具体领域、框架、文件/数据库驱动；代理/服务发现不代替服务端授权。
- Lab只做组件展示与局部显式依赖，不形成第二产品宿主或通用插件Lab。
- 当前 Files 首版实施按批准范围进行，保留已有未提交文档；远端 Issue/Project/PR 写入、push、合并、发布仍未授权；`issueId: null`。历史交付与其授权见各 Task。

## 质量与证据

纯文档检查链接、结构、capability唯一性、成熟度与批准边界，并用独立Reviewer反证生命周期/资源/依赖合同和实施计划。t05、t06、t07 的机制验证为应用包 `test:runtime-foundation`、`typecheck:runtime-foundation`、各一次临时 smoke；t08 追加 `smoke:runtime-foundation` 在真实子进程与真实 Chromium 各跑一次；t09 另跑包级全量 `bun run test`（失败均为 master 既有，见 [t09 证据](tasks/t09-foundation-integration-review/evidences/full-suite.txt)）、`nuxt typecheck`，并由独立 Reviewer 复核四项 Spec 晋升；t13 追加 `smoke:runtime-foundation -- --services` 组合真实子进程 smoke 与日志器/脱敏消费方回归（见 [t13 证据](tasks/t13-services-integration-review/README.md#验证命令与结果)）。每个 Task 另有仓库根 `docs:check` 与 Task `governance:context`。build、人工浏览器验收、迁移和Provider不属于已运行项。

规划阶段 `governance:check` 的两项失败见 [原始输出](tasks/t01-architecture-proposal/evidences/governance-check-tracer.txt)：w00003/t14缺README、根AGENTS固定标记不匹配。前者已由主线 `34c3d5db` 补齐；本 Work 未重跑全仓 `governance:check`，不宣称全仓治理通过。

历史交付（不作本轮新Spec验证）：
- 首轮 [审查处理](tasks/t01-architecture-proposal/walkthroughs/review-resolution.md)、[质量基线](tasks/t01-architecture-proposal/walkthroughs/quality-baseline.md)。
- B/S追加 [源码调查](tasks/t01-architecture-proposal/walkthroughs/tracer-design.md)、[审查处理](tasks/t01-architecture-proposal/walkthroughs/tracer-resolution.md)、[文档门禁](tasks/t01-architecture-proposal/evidences/docs-check-tracer.txt)。

本轮新审查分别写 t02/t03 的 `walkthroughs/foundation-review.md`；t04 记录处理与最终质量证据，不用旧报告为新Spec背书。

本轮规范规划的处理与验证入口：[t04交付记录](tasks/t04-foundation-spec-plan/walkthroughs/foundation-resolution.md)、[身份检查](tasks/t04-foundation-spec-plan/evidences/context-checks.txt)。实现单元的公开接口、验证结果与未运行项见各自快照：[t05](tasks/t05-runtime-lifecycle/README.md)、[t06](tasks/t06-runtime-services/README.md)、[t07](tasks/t07-runtime-plugins/README.md)、[t08](tasks/t08-runtime-application/README.md)；首片复核结论见 [t09](tasks/t09-foundation-integration-review/README.md)；第二片见 [t10](tasks/t10-runtime-diagnostics/README.md)、[t11](tasks/t11-platform-files/README.md)、[t12](tasks/t12-platform-sqlite/README.md) 与复核 [t13](tasks/t13-services-integration-review/README.md)；Lab 第三片见 [t14](tasks/t14-lab-host-boundary/README.md)。
