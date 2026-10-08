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
- S6（界面语言：`nbook.settings/locale` 由配置插件在描述里声明，删去 `DISPLAY_LOCALE`；文字在显示时才按当前语言取，选择请求接受 `LocalizedText`；命令面板、命令系统的不满足原因、“打开项目”（失败原因按失败码，说明原文进诊断）、首页文案与 `<html lang>` 跟随语言；Lab 用自己的语言常量；浏览器的 `commands` 入口贡献“切换界面语言”，三条设置命令共用 `switchSetting` 与失败转换）：应用 398 例与组件 58 例、typecheck 通过。命令系统、工作台、项目界面现在依赖配置服务，手工组装实例的测试与示例场地改为经 `definitionAt` 装上 `nbook.settings`；不装工作台的测试实例只装配置核心入口 `settingsBrowserCore`。
- S7（主题：工作台在描述里声明 `nbook.workbench/theme`、`appearance`；`src/ui/theme/` 抽出文档根的主题写入（Lab 与工作台各建一个）与产品主题包解析；工作台页面挂载的 `WorkbenchDocument` 设置 `<html lang>` 与主题，`system` 读系统明暗并监听，卸载时去掉自己写下的主题；首页背景、文字与字体消费 nb-ui token；工作台贡献“切换主题”“切换明暗”）：组件 60 例、应用 399 例、typecheck 通过。happy-dom 改系统明暗不派发 `change` 事件，跟随系统的变化留给 S8 的真实浏览器验证。
- S8（`e2e/settings.e2e.ts` 4 例：两窗口切换界面语言与刷新保持、注释保留；外部改文件后主题与页面底色变化、项目层覆盖与绑定窗口里切换主题写项目层；明暗跟随系统；Lab 显示期间改产品主题不影响 Lab、回到产品页按最新配置应用。`smoke:server` 增加 S9：带注释的 `settings.json` 经打包产物写一个键后注释保留，文件改坏时服务端照常启动并记诊断。`lab.e2e.ts` 场景 17 原先断言离开 Lab 后 `<html>` 没有主题，现在产品页会写自己的主题，改为断言换成产品配置的主题）：全量 e2e 52 例、`smoke:server` S1–S9 通过。途中 `/tmp`（内存盘）将满，Chrome 报磁盘配额不足、开发模式重新加载时模块请求被拒，基线提交上同样失败；清理本会话的旧临时文件后通过。
- S9：`settings/configuration.md` 补实现合同与证据，其它 Spec 去掉本 Task 已实现条目上的 planned 标记；`docs:check`、`governance:check` 无失败。`test:affected --typecheck --since 1d68afea` 里内核与新应用全部通过；锁文件变化把所有包都算进来，`nb-ui`（colorway 测试取不到 localStorage）、`neuro-book-test-support`（paths 测试）、`llmlint`（缺 `diff-match-patch`）的失败与本 Task 无关，本 Task 没有改动这三个包。接着交三个 omp 做实现审查。
- 实现审查（2026-10-08）：三个 omp（正确性与不变量、测试与验收映射、代码质量与文档）共 23 条，去重后 17 条，均已修正（报告见 `evidences/impl-review-*.txt`，修正提交 `c10ba389`）。产品缺陷：写入锁被判残留接管后旧写者仍提交；删除不存在的键建目录、建空文件；监视漏掉祖先目录链接改指与较长的链接链；新增键重排已有文本、挪走行尾注释；手写声明的默认值没冻结；两个调用方登记同一个函数时一方释放撤掉另一方；`update` 的失败码顺序与 Spec 不同；命令面板切换语言后旧输入不再命中。Spec 修正：释放后的语义改为与内核的按调用方门面一致（访问抛 `ServiceRevokedError`，记入待确认清单）。测试补齐：改名前冲突重做、锁接管、50 毫秒与 3 秒按 Spec 的字面值、`inspect` 经 computed 的响应式、三条设置命令登记为写入、配置场地用产品的代理允许清单、e2e 的控制台错误收集与 token 计算样式对照；`WorkbenchCommandHost`、`LabCommandInspector` 补同名文档。每条新测试都对修正做了变异检查。修正后 `test:affected --typecheck`、settings 与 lab e2e 13 例、`smoke:server` S1–S9、`docs:check`、`governance:check` 通过。
- 2026-10-08 完成：`settings/configuration.md` 晋升 `implemented`；K1–K6 验收指引见 [k1-k6-acceptance.md](../../k1-k6-acceptance.md)。
