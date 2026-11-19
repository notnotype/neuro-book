---
schema: nbook.task/v2
taskId: t34-unified-errors
status: done
updated: 2026-11-19
---

# 统一失败形状与错误码

## 目标与范围

按提案第一档第 2 项的失败一半：nb-layout 的结构操作、快照恢复与 L1 的提交回调，失败改成 `{ok: false, code, message, params?}`，L0 的 34 处中文 `reason` 归并成码，码集合开放；L2（nb-workbench-layout）只把 `detail` 改名 `message`、改英文，码不变。诊断归 [t38](../t38-grid-diagnostics/README.md)。

合同：布局行为不变，失败的形状、码与文字改变：[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md) 失败与恢复（新增失败 5 到 7），[`ui/workbench-layout`](../../../../../docs/specs/ui/workbench-layout.md) 失败与恢复的表头。依据：[提案](../../../../../docs/proposals/nb-layout-general-library.md)的“错误与诊断一种形状”与决策记录、[ADR 0054](../../../../../docs/adr/0054-nb-layout-general-library.md)。

## 当前状态

2026-11-18 经 nbdev 新建。计划见 [`plan.md`](plan.md)（第 4 稿）。

**开发者 2026-11-19 的决定**：第三轮审查后停下时推荐的三件，开发者答“同意”：

1. 拆成两个 Task：本 Task 只做失败的形状（L0 结构操作、快照恢复、L1 提交码），设计已收敛，不再送设计审查、直接实施；诊断（码、两个出口、只发新增与合成、删 `SashGestureScope.issues`）另建 [t38](../t38-grid-diagnostics/README.md) 重新设计，排在本 Task 之后、t35 之前。
2. L2 的 `rejected` 拆成四个码延后到有使用方：这一档 L2 只把 `detail` 改名 `message`、改英文。
3. 待确认清单里 t34 的两行与 t33 的一行按推荐追认（第二行的合成规则转 t38，见清单）。

第 4 稿按这个范围收窄，并吸收第三轮里属于失败形状的几条：第 3 条（401、452 拆成 `not-found` 与 `wrong-node-kind`）、第 4 条（失败的 `params` 值只用字符串与数字，对齐 `ui/i18n`；数组归 t38）、第 6 条（`validateLayoutDoc` 的 32 条问题文字一起改英文）、第 7 条（`invalid-argument` 的映射按 `field` 判别；导出判别联合不采纳，理由见计划）、第 10 条（第 1 片跑 `lab-nested-grid` 的 e2e）、第 11 条（280 的 baseline 先于 target）。第三轮其余各条归 t38。

**实施**（worktree `w00026-t34-unified-errors`，分支 `refactor/w00026-t34-unified-errors`）：

- 第 1 片 `38b8aa2fa`：nb-layout 的 `GridFailure`、库内按码检查 `params` 的构造函数（`grid-failure.ts`）、`grid.ts` 34 处、快照恢复、提交的码；Lab 夹具与 `lab-nested-grid` 两条恢复用例按码断言。`grid.test.ts` 补一组逐码用例（可达的每处一条，断言码与完整 `params`），`useGridLayout.dom.test.ts` 补落账失败原样转交，`NestedGrid.dom.test.ts` 补 `handler-missing`、`handler-threw`。变异检查：280 的两侧先后与 452 的拆分改回去，逐码用例红；诊断字符串里去掉码，两条提交用例红。
- 第 2 片 `f3d105aef`：L2 与应用 110 处 `detail` 改名 `message`、文字改英文（先空跑匹配检查、再统一写入）；测试里 23 行读 `detail` 的改读 `message`；SDK 导出四个类型；变更记录两条；nb-workbench-layout 的 README。
- 并 master `45350dd1c`（只带进别的 Work 的两个文档提交）。
- 和计划不同的三处：
  - `GridLayoutCommitResult` 定义在根入口的 `grid-types.ts`（`SashGestureBinding.onCommit` 在根入口也要用），`./vue` 照旧导出这个名字。
  - `sdk.test.ts` 按入口文件里写出的名字核对 SDK 的类型，nb-layout 根入口靠 `export *` 带出的类型它读不到：根入口显式写出失败的几个类型名。
  - 第 1 片之后没有单独跑 `lab-nested-grid`，并进收口那一轮（构建三份产物要十几分钟，两片之间没有别的改动会动到夹具的属性）。
- 验证：三个包的类型检查（应用三份配置：`tsc`、`vue-tsc` 的 web 与 browser-test）、nb-layout（bun 339、vitest 216）与 nb-workbench-layout（bun 261、vitest 48）的测试、`sdk.test`、`docs:check` 都过。`test:affected`（在第 2 片提交前）有 9 条失败，都不在本分支的改动里：7 条是同一个原因，`nbook.stickers` 在内置插件清单与产品清单里对不上（`server.test.ts` 后端宿主的 6 条，断言插件激活与关闭顺序的 152、176、204 等行；`builtin-names.test.ts:45` 一条），来自 master 上别的 Work，本分支没改这两个目录；另外 `architecture.test.ts` 一条超时、示例插件 `SnippetsPage.dom.test.ts` 一条，单独重跑都过。
- e2e（负载 8 到 14）：`lab-nested-grid` 17、`lab-grid-panels` 17、`lab-workbench-surface` 17、`workbench-views` 34、`workbench-dnd` 38 全过；`workbench-shell` 16 过 2 失败（547 等不到外框过渡、792 等不到 Lab 场景，跑到它时负载 14 以上），负载 6 到 8 时两条各单独重跑 2 次都过，归为负载（547 是主线程忙时过渡直接到终点，792 是 Lab 冷启动）。`build:sdk` 的产物里四个类型都在导出清单上，`onGestureCommit` 的类型是 `GridLayoutCommitResult`；没有另建基点 worktree 做前后整份比对，SDK 源码只改了 `components.ts` 一行类型导出。

**实现审查**（Claude Sonnet，审查 worktree 固定在 `45350dd1c`，[`evidences/impl-review.txt`](evidences/impl-review.txt)）：5 条，重要 2、建议 3，都成立，修正单独提交：

| 条 | 内容 | 处理 |
|---|---|---|
| 1 | 宿主自己写 `onGestureCommit` 时只能用库的码拒绝（返回类型的码是闭联合），和“码集合开放”矛盾 | 宿主返回的类型放宽成 `{ok: true} \| GridFailure`（任意码），`useGridLayout` 的结果仍是窄的 `GridLayoutCommitResult`、可以赋过去；补一条宿主用自己的码拒绝的用例；Spec 失败 6 补一句 |
| 2 | 校验不过的布局记录把 `code: message` 当原因显示在状态栏，现在是英文句子（改动前是中文原文，同样是把诊断文字当界面文案） | 状态栏的问题码改成已有本地化文字的 `corrupt` 或 `unsupported-version`，校验的码与 message 放进 `detail`，只进诊断日志；用例断言码与 `detail` |
| 3 | 变更记录“已经构建的照常运行，只是诊断里没有原因”不准：原因是 `undefined`，提兼容起点后旧插件也装不上 | 改成事实陈述：要改成新形状、重新构建 |
| 4 | `invalid-snapshot` 的 `id?` 让 `params` 可以有值为 `undefined` 的键 | 拆成两支：外壳、非对象节点、缺 id 不带 `id`，其余必须带 |
| 5 | 注释写了推测的后续计划；根入口只列了一部分类型名 | 删掉那句；根入口只列 SDK 导出的四个，注释写明 `sdk.test.ts` 按入口里写出的名字核对 |

下面是第 1 到 3 稿三轮设计审查的历程；表里说的诊断、L2 拆码与切片，在第 4 稿里已转 t38 或延后，以计划第 4 稿为准。

- 第 1 稿的设计审查（Claude Sonnet，[`evidences/design-review.txt`](evidences/design-review.txt)）：15 条，重要 7、建议 8，都成立（第 6 条的 `PLUGIN_API_SINCE` 一项除外，见表），改成第 2 稿；几条改了设计（只发新增的判据、切片边界、公开面清单），第 2 稿再送一轮：

  | 条 | 内容 | 处理 |
  |---|---|---|
  | 1 | 757 不是宿主规则，代码里没有“标签数上限” | 归 `not-allowed`；`policy-refused` 只留 `accepts`、`can-insert`；`rule` 一种规则一个名字 |
  | 2 | 合成同一个码后，靠两句文案区分的用例按 `params` 区分不了 | `over-constrained` 加 `cause`，311 单独成码，`invalid-argument` 每种检查一个 `field`，725 拆条件；L0 每处的 `params` 逐行写进计划 |
  | 3 | “只发新增”没定义，每帧仍会重发 | 定判据：键是码加 `params`；手势内同键只发一次，重算按上一次的键集比，事件型的不去重 |
  | 4 | 没接 `onGestureCommit` 一次发两条，`handler-missing` 没有归宿 | 放进提交码，删掉直接发的那一条 |
  | 5 | `notify-failed` 的出口与类型和计划不符 | 只在 `useGridLayout.onIssues`，不进组件事件的码；`WorkbenchSurface` 的事件写并集 |
  | 6 | 公开面漏列（`GridGesturePreview`、`SashGestureScope.issues` 是公开的、`allocateSashPanels` 的 `context` 等）；`PLUGIN_API_SINCE` 要改 | 计划加公开面变更清单；`PLUGIN_API_SINCE` 不在本 Task 改：`releasing.md` 第 2 步要它改成“这次发布的版本”，发布时才定，交付时写明 |
  | 7 | Lab 夹具的去重、显示、恢复结果读取与一条 e2e 断言没列；输出 68 的 e2e 覆盖落空 | 第 1、2 片列入范围；输出 68 改由真实存在的 dom 测试覆盖 |
  | 8 | 617、632 不可达；L2 约 40 条 `rejected` 断言要迁 | 留作防御分支、不写用例；L2 的迁移写进测试迁移规则 |
  | 9 | 第 1、2 片的边界会返工 | 第 1 片只做失败，诊断整个放第 2 片 |
  | 10 | 类型可以更少；`GridRestoreResult` 不是判别联合；码集合开放要对齐 `ui/i18n` | `GridFailure` 写成 `GridIssue & {ok: false}`；恢复结果写成判别联合；对齐开放错误域。不按操作收窄码（接受取舍：码集合开放，调用方本来就要有默认分支） |
  | 11 | 229、298、509、280 的归类，快照 `actual` 不准，L2 不转交 L0 失败 | 逐条按建议改；L2 的两个码补 `params`，800 保持 `not-found` 免得命令分支变化 |
  | 12 | 逗号连 id、非有限数进 JSON 变 `null` | 值允许字符串数组；非有限数写成字符串 |
  | 13 | `LayoutDocValidation` 留着 `detail`；L2 拆码没有消费者 | 同批改名 `message`；拆码按已定提案做，`rule` 一种规则一个名字 |
  | 14 | `plugin.ts:205` 记的不是求解诊断 | 删掉那条，改成 `structureFailure` 读 `message` |
  | 15 | Spec 文字同步 | 并入计划“Spec 与文档改动” |

- 对待确认项，审查同意定码，并建议 `handler-missing` 进提交码、决策记录写明 `not-published`、`notify-failed` 只是诊断：决策记录与待确认清单已照改。
- 第 2 稿的设计审查（第二轮，[`evidences/design-review-r2.txt`](evidences/design-review-r2.txt)）：12 条，阻断 1、重要 5、建议 6，都成立，改成第 3 稿，送第三轮（同一对象最后一轮）：

  | 条 | 内容 | 处理 |
  |---|---|---|
  | 1 | 键含数值参数，拖窗口每个像素都是新诊断（阻断） | 键只取码、`cause`、轴；`ids`、`branch` 与度量不进键 |
  | 2 | `not-collapsible` 一码两义 | 诊断改名 `no-collapse-policy`；失败码与诊断码不相交，加类型级测试 |
  | 3 | 快照恢复漏了 209 | 新码 `unresolved-root`，带 `dropped` |
  | 4 | 合成后的 `params` 没定义，删 `context` 丢了分支与轴 | 逐个 `cause` 写 `ids` 是什么、带不带 `branch`、`axis`；`allocateAxis` 传内部范围参数；结果里不合成，只在通知时同键合成 |
  | 5 | 第 1 片验证漏两个包，第 3 片漏约 36 处读 `detail` | 每片三个包都做类型检查；测试迁移规则列全文件 |
  | 6 | 作用域边界：空布局、`gesture-update`、键盘、同步回调 | 空布局与换工作面清空键集；载荷是快照不去重；键盘不发诊断记为已知限制；通知挪到收尾之后 |
  | 7 | 两处靠中文碰巧通过的断言 | `useGridLayout.dom.test.ts:208` 改成真的检查并先变异；e2e 395 读码与版本属性，夹具去掉中文兜底 |
  | 8 | `PLUGIN_API_SINCE` 理由成立但缺防遗忘；SDK 一列可以定；新类型要不要进 SDK | Work README 加“发版前”一行；SDK 一列填定；`GridIssue` 等几个类型进 SDK 的类型导出，写“新增” |
  | 9 | `collapsePolicyProblem`、`serializeTree`、`swapSkipped` 三处中文 | 前者归 t36 定入口时一起定；`serializeTree` 的异常文字改英文；`swapSkipped` 并入第 2 片 |
  | 10 | `params` 没有类型；`duplicate-id` 与 `id-taken` 两个名字 | 每层一张内部映射类型加构造函数，编译期检查；L2 改回 `duplicate-id` |
  | 11 | 232、280、503、506、`stale-*` 的取值歧义 | 逐条写明 |
  | 12 | 和提案不同的不止一处 | 决策记录追加第二条，待确认清单加一行 |

- 第 3 稿的设计审查（第三轮，[`evidences/design-review-r3.txt`](evidences/design-review-r3.txt)）：12 条，阻断 0、重要 6、建议 6。第二轮 12 条里 8 条核实到位，L0 的 34 处、诊断表的位置与 `cause`、两个出口的时序都与代码对上；剩下的重要问题：
  1. 同键合成后 `branch`、度量只对应第一条，`ids` 却是并集，对不上；
  2. 宿主的 `onIssues` 在松手那一帧（`flush`）抛出时 `finish` 不跑，手势卡住（计划只处理了 `finish` 里那一处）；
  3. L0 的 401、452 一个条件管“不存在”与“不是分支”，应像 475、594 那样拆开；
  4. `ids` 是字符串数组，宿主照 `ui/i18n` 把 `params` 交给翻译端口时类型不合、数组被丢；
  5. L2 几处 `not-found`、`duplicate-id`、`limit-exceeded` 的 `params` 取不到 id（`freshId` 吞了撞车的 id、落点只有目标），L2 的逐行表还没写；
  6. `validateLayoutDoc` 的 32 条中文问题文字仍进 `message`，与“`message` 是英文”不一致。

  第三轮之后按上面开发者的决定拆分（第 4 稿），不再送审。

- 盘点时发现提案“错误与诊断”有一句与代码不符：L1 的提交回调已有上下文已切换、版本已变、处理器抛出等失败，提案说不预设这些码。本 Task 给它们定码，提案追加决策记录，记入[待确认清单](../../pending-confirmations.md)，开发者 2026-11-19 追认。

## 下一步

无。t34 完成：合入 master（并 master `6faf07664`，实现审查修正 `063828e6d`，守护测试 `8a8407189`）；`ui/nested-grid` 失败 5 到 7 与“码集合开放”、`ui/workbench-layout` 失败形状去掉 planned（每句都有断言：逐码用例、提交码用例、宿主用自己的码拒绝、码的写法列全并按开放错误域核对、`message` 是可打印 ASCII），实现合同补“失败的构造”与合同测试。下次发版按 Work README“发版前”一行提兼容起点。
