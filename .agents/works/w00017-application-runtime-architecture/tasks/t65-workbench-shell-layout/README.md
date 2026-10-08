---
schema: nbook.task/v2
taskId: t65-workbench-shell-layout
---

# NeuroBook v2 外壳一：外壳与布局

## 目标与范围

按 [外壳设计稿](../../../../../docs/proposals/workbench-shell-abstractions.md)（2026-10-07 `accepted`）第 11 节的外壳一：七个 Part 的外壳几何、面板四位置与四对齐、四种“消失”形态、紧凑呈现、三条布局记录经插件状态 store 持久化、工作台公开状态与五条面板命令；`/` 页换成外壳。容器、视图与拖放属于外壳二、外壳三。旧应用的外壳经开发者 2026-10-08 人工验证，作为几何与组件的参照。

实施计划：[plan.md](plan.md)。

行为合同（本 Task 修订）：[`ui/workbench-shell.md`](../../../../../docs/specs/ui/workbench-shell.md)、[`workbench/commands.md`](../../../../../docs/specs/workbench/commands.md)、[`storage/persistence.md`](../../../../../docs/specs/storage/persistence.md)。

## 前置

K5 [t56](../t56-plugin-state/README.md)（store 与公开状态）、K6 [t64](../t64-plugin-settings/README.md)（主题与界面语言）。

## 当前状态

- 2026-10-08 计划起草；三个 omp 审查（对照旧应用与设计稿、状态与多窗口、可实现性与测试）合并去重 13 条，全部并入计划（[审查处理](plan.md#审查处理)，报告见 `evidences/plan-review-*.txt`）；三项记入 [待确认清单](../../pending-confirmations.md)。按 [autonomous-delivery](../../../../skills/autonomous-delivery/SKILL.md) 进入实施。
- S0（Spec）：`ui/workbench-shell.md` 按 v2 重写（外壳一的行为写成可判定的 14 条输出与 13 条验收，外壳二、三保留已批准的合同，旧验收 24 条逐条给去向，旧口径原文归档到 `docs/archived/specs/ui/workbench-shell.md`）；`workbench/commands.md` 第二批改为读公开状态的 `when`、四条面板命令参数可省略；平台设计 P7 追加决策记录。`storage/persistence.md` 没有“首批消费者”一节，不需要改。`docs:check`、`governance:check` 无失败。
- S1（纯模型）：`web/shell/panel-state.ts`、`layout.ts` 从旧应用搬入，Part 改用 v2 词表，侧栏 340、右栏 400 的默认宽收进本模块；手势结算拆成落账前的 `shellGestureProblem` 与落账后的 `shellPatch`，配合 `useGridLayout` 的唯一落账入口。旧模型里“宽度放得下水平面板、放不下左右面板时临时按底部居中”的分支在现行常量下不可达（外壳宽 ≥ 800 时主体至少 740px，左右面板布局最少要 603px），删去并同步 Spec。浏览器代码的单元测试（`src/plugins/*/web/**/*.test.ts`）改由 `tsconfig.browser-test.json` 做类型检查：它们引用 nb-ui 的布局入口，需要 DOM 类型与 `.vue` 声明。34 例通过，6 处变异各被抓到。
- S2（记录与 store）：`web/state/records.ts` 三条记录（尺寸两条按绑定选 user 或 project 分区，用户定制在 user 分区；Storage 要求顶层 schema 严格，外壳二只加可选字段）；`layout-store.ts` 的 `defineStore("workbench-layout")`：按字段合成的定制 action、同值不写、显示面板时清收起、按记录各提交一次的尺寸补丁、`acceptLayoutFacts`、`retry`（读不到或订阅已结束时先重新打开）与 `discard`、汇总各记录问题的 `problems`（读不到、受保护、未保存）。9 例在真实 Storage 场地通过，7 处变异各被抓到。发现断线时 Storage 的订阅不结束（重连后续上），断线期间的保存以 `unavailable` 失败暂停；两个窗口各自连续改同一记录两次时可能两次冲突而暂停，属于持久化字段的既有语义（只重放一次），测试按一轮一个修改编排。
- S3（公开状态与面板命令）：外壳模型拆成两层：`shell/sizes.ts`（Part 词表、尺寸常量、夹取、补丁与呈现事实的类型，不依赖 nb-ui）给 store、公开状态与命令用，`shell/layout.ts`（几何投影与手势，依赖 nb-ui 的网格原语）只给外壳组件用，服务端与 Bun 测试因此不加载浏览器代码；`web/testing/` 的测试辅助与 `web/**/*.test.ts` 由 `tsconfig.browser-test.json` 做类型检查。`state/layout-host.ts` 惰性持有布局 store；`state/public-state.ts` 声明八个公开键并从惰性 store 派生（“水平位置”按保存的位置，Spec 同步写明）；`commands/panel-commands.ts` 五条命令（位置与对齐省略参数时经选择，隐藏与收起切换）。工作台浏览器入口新增依赖 `storageKey`，贡献公开键与五条命令；两处手工组装的测试场地（项目命令登记、设置命令）补上 Storage 浏览器入口。4 例通过，5 处变异抓到 4 处；未抓到的一处（`panelVisible` 要求记录已读完）只在首个快照前的瞬间有区别，改为只看 store 是否已创建。新应用 Bun 测试全部通过。
- S4（纯布局组件）：`WorkbenchShellLayout.vue` 与同名 `.md`（先写文档）。测量用 nb-ui `useLayoutExtent`，落账经 `useGridLayout`：外壳只加落账前的整批核对与落账后的补丁，不再自写测量与 `resizeBranches`；七个 Part 的内容经 Teleport 搬到 `[data-leaf]` 落点，没有落点时停放（`hidden inert aria-hidden`）；保留旧应用的焦点策略（搬动后恢复焦点与滚动，隐藏与最大化时交给 `panel-toggle`、`panel-title` 落点，不抢外壳之外的焦点）。Lab 场景 `WorkbenchShellLayoutFixture`（8 个场景，状态写回 Lab 场景输入，最大化清除与 store 同一规则）与编辑器槽样例 `ShellSampleEditor`（实例编号、累计创建与卸载次数）。组件测试 3 例（插槽各挂载一次、停放不卸载、呈现事实不重复发）；在 3917 端口的开发服务上用 `lab:shot` 截了 8 个场景 × 两种画布，溢出与页面问题都为 0，1520 宽画布下几何与 Spec 一致。nbook 主题里 `--panel-surface` 等于 `--bg-panel`，样例卡片靠分隔线描边区分；外壳的正式配色随 S5、S6。
- S5（面板与状态栏）：`WorkbenchPanelSurface`（32px 标题头，标题是 `panel-title` 落点；框架按钮由宿主给出名称、图标、是否可用与原因，点了只发 `action`，宿主执行命令）与 `WorkbenchStatusBar`（项目名或“未打开项目”；布局问题提示，没保存上的优先，原因换成可读文字，带重试与放弃；面板显隐按钮是 `panel-toggle` 落点），各自先写同名 `.md`。两个都是受控零件，Lab 用 `defineSubjectFixture` 透传（面板 4 个场景、状态栏 5 个），`lab:shot` 18 张截图无溢出与页面问题。组件测试 5 例；途中发现英文界面里混进了中文冒号，提示句改为中英两份完整模板。新文件出现后 Lab 的组件索引要重启开发服务才收进来（`import.meta.glob` 没有随新文件更新）。
