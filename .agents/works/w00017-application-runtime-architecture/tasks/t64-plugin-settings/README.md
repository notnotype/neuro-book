---
schema: nbook.task/v2
taskId: t64-plugin-settings
---

# NeuroBook v2 第 5 步 K6：配置插件 `nbook.settings`

## 目标与范围

按 [插件的数据与状态](../../../../../docs/proposals/plugin-data-model.md)（2026-10-07 `accepted`）第 6、7 节与 [多实例运行时拓扑](../../../../../docs/proposals/multi-instance-runtime-topology.md) 第 11 节的 K6：插件声明配置项，按默认值、用户层、项目层合成有效值并推到各实例，所有已声明项可读、只写自己的；第一批使用者是界面语言与主题。设计轮的决定由开发者 2026-10-08 确认，记在计划的 Context。

实施计划：[plan.md](plan.md)。

行为合同（本 Task 新建或修订）：[`settings/configuration.md`](../../../../../docs/specs/settings/configuration.md)（新建）、[`runtime/plugin-manifest.md`](../../../../../docs/specs/runtime/plugin-manifest.md)、[`runtime/plugins.md`](../../../../../docs/specs/runtime/plugins.md)、[`runtime/plugin-api.md`](../../../../../docs/specs/runtime/plugin-api.md)、[`state/store.md`](../../../../../docs/specs/state/store.md)、[`storage/boundaries.md`](../../../../../docs/specs/storage/boundaries.md)、[`theme/system.md`](../../../../../docs/specs/theme/system.md)、[`workbench/commands.md`](../../../../../docs/specs/workbench/commands.md)。

## 前置

K5 [t56](../t56-plugin-state/README.md)（store 的读配置辅助函数建在它上面）；[t61](../t61-kernel-catalog-failure-codes/README.md) 的失败码。

## 当前状态

- 2026-10-08 计划起草；三个 omp 交叉审查（对照 VS Code、架构与授权、文件层实验与使用场景）共 34 条，主 Agent 逐条核实后全部并入计划（[审查处理](plan.md#审查处理)，报告见 `evidences/plan-review-*.txt`）。开发者授权按 [autonomous-delivery](../../../../skills/autonomous-delivery/SKILL.md) 推进，本该开发者确认的点记入 [待确认清单](../../pending-confirmations.md)。
- S0（Spec 与文档）`1abde4fa`。
- S1（只含声明的定义可以登记；`pluginsAt`、`definitionAt` 统一三个宿主与浏览器引导的插件集合；宿主能力 `clockKey`、`windowConnectionKey`）：内核 301 例、应用 338 例与组件 57 例、三份 typecheck 通过，新判据做了变异检查。
- S2（`defineSetting` 与声明校验、层文本解析与单键编辑、合成与快照比较；`jsonc-parser` 依赖，锁文件只多它）：28 例，变异检查覆盖重复键、整行删除、悬空逗号、非 JSON 数、制表符缩进、secret、默认值与层。
- S3（层的拥有者：文件读写、`proper-lockfile` 写入锁、改名前核对、符号链接与只读、监视协调与 50 毫秒合并、串行队列与停止；远程合同）：拥有者 15 例在真实临时目录、真实 `fs.watch` 与两个真实子进程上通过，连跑 5 次稳定；变异检查覆盖锁、只读、目录身份、链接链、内容去重、权限位与悬空链接。服务端与项目入口随 S4 的配置服务一起接入。发现 Bun 1.4.2 的 `toMatchObject` 带非对称匹配器时会改写被比较的对象（冻结的也会），测试里对产品持有的对象改用逐字段断言。
- S4（每个实例的配置服务：层订阅与合成、首个快照 3 秒截止、窗口回到在线时重订失败的层、按调用方门面、委托写入、读到自己的写入、远程快照冻结；三个位置的入口接入宿主与产品清单，`nbook.settings` 进代理允许清单；远程合同的写入拆成 `set`、`remove`，因为方法输入必须是严格对象）：多实例 10 例、时序单元 6 例；应用 394 例与组件 57 例、typecheck 通过；变异检查覆盖修订号比较、重订、冻结、截止、auto 选层与通知去重。
- S5（store 的 `setting`：配置有效值的只读 ref，随本窗口写入与外部改文件变化；用了 `setting` 而没给 `settings` 时 `create` 抛错）：store 测试增补 1 例，在真实配置场地上通过。
