---
schema: nbook.walkthrough/v1
taskId: t05-component-lab
sequence: 2
role: tasker
status: in-progress
createdAt: 2026-08-31T00:00:00Z
---

# t05 批次二三四：右栏四个 tab、Lab 主题切换与两处结构修复

在 `.worktree/w00003-neurobook-ui-foundation-migration`、分支 `refactor/w00003-nb-ui-adoption` 上执行。

开发者看过批次一的界面后给出反馈：「这么丑，功能也不完善」。功能不完善属于计划内（批次二三四未做）；丑的部分定位到两条真实结构问题。开发者选择「先补功能，齐了再统一定形」，因此本轮把剩下三批一次做完，顺带修掉那两条。

## 已完成

先写文档、后写实现的顺序保持：两份新零件文档（`4bda7826`）早于实现（`413c9089`）。

- 新增两个零件，各自文档在前：`MarkdownView`（只读 Markdown 渲染）、`EventLogPanel`（事件列表）。
- 右栏改为四个 tab：场景、文档、事件、数据。原「概览」不再单开 tab——它显示的能力标签、耦合度、能否挂载都是文档 frontmatter 派生的，并进「文档」tab 正文上方。右栏由 280 加宽到 320。
- fixture 合同扩展两处：场景可登记 `data` 作为可改的假数据；fixture 通过 `provide`/`inject` 的 sink 上报事件。
- 两个新零件各自入驻，各带场景，Lab 展品由三个增加到五个。
- header 加 Lab 主题切换，八个内置主题。

## 已验证

- `bun run --cwd=packages/neuro-book typecheck`：无输出，退出码 0。
- **产物门禁仍成立。**真实生产构建后全文搜十个词——`component-lab`、`ViewportCanvas`、`CollapsibleSidePanel`、`LabShell`、`MarkdownView`、`EventLogPanel`、`lab-event-sink`、`Fixture`、`组件 Lab`、`nb-lab-markdown`——命中文件数均为 0；产物路由表中无 `/lab`。
- **否定结论有效**：同一套提取在同一份产物里取到 32 条路由，其中 14 条 preview。
- 开发服务下 Lab 的十个模块经 Vite 转换均返回 200 且内容非空（`event-log.types.ts` 转换后为 0 字节，是纯类型文件的正常结果）。

## 未验证

- **浏览器里的渲染、交互与视觉全部未验证**，包括本轮修的两处结构问题是否真的解决了观感。
- 八个主题在 Lab 里的实际表现未验证。
- 没有覆盖新零件的自动化测试。

## 发现一：Lab 的主题不能走 `useThemeManager`

产品的主题切换 `useThemeManager` 会把选择保存进 Global Config。Lab 里挂它等于让开发工具改用户的产品设置——切一次主题，产品跟着变，还落了盘。

改为直接用 `applyThemeVars(host, vars)` 把变量写在 Lab 自己的根节点上。好处不止是不落盘：Lab 的主题与产品当前主题**互不影响**，可以在产品是深色时单独把 Lab 切成浅色看组件。这条使 Lab 的主题切换不带 `io:` 与 `persist:` 任何标签。

代价是 Lab 的主题不记忆，刷新回到默认。这是有意的，改成记忆就得引入持久化。

## 发现二：nb-ui `Tree` 的根节点外观写死，没法嵌进别的容器

`Tree.vue` 根节点上硬编码了 `rounded border bg-panel p-2 shadow-sm`，没有 prop 能关掉。它被设计成一张独立卡片，而 Lab 左栏本身已经是一个有边框的栏，套进去就成了「一张卡片浮在栏里」——这正是开发者看到的那个观感问题。

本轮只去掉了 Lab 自己多加的一层 `p-2`，让卡片贴合左栏。**根本解法是给 nb-ui `Tree` 一个无外观的形态**，但 t05 明写不改动 nb-ui，因此登记于此，留给 nb-ui 侧处理。

## 发现三：画布不限尺寸时会塌成内容高度

`ViewportCanvas` 原本在宽高为 `0` 时给盒子设 `100%`。在 `flex-col` 的舞台里，`height: 100%` 相对的是一个高度为 auto 的父元素，结果盒子塌成内容那么高，下方留下大片空白——开发者截图里 JsonViewer 下面那一大块就是这么来的。

改为不限制时用 `align-self: stretch` 与 `flex: 1 1 auto` 让它撑满舞台。文档里「两维都传 0 时盒子铺满舞台」这句本来就是这么写的，实现没做到，因此改实现、不改文档，也不记「已知偏差」。

## 发现四：`<script setup>` 不能导出类型，事件条目类型只能单独成文件

`EventLogPanel` 的条目类型要被 fixture 和 Lab 外壳共用，但 `<script setup>` 里不允许 `export`。抽成 `event-log.types.ts`。

这不是本仓库特有的问题，是 Vue 的限制。组件规范里没有提到「组件的公共类型放哪」，写文档时按惯例写成了在组件里定义，实现时才碰到。**组件规范可以补一句**：组件对外的类型定义放同目录的 `.types.ts`，不放在组件文件里。

## 发现五：事件转发不适合用 emit 逐个声明

Lab 要显示被检视组件发出的事件，但它动态挂载 fixture，静态上并不知道对方会发什么事件。让 fixture 往上 `emit` 就得在 Lab 侧把事件名再抄一遍，抄漏了就是静默丢事件。

改用 `provide`/`inject` 给 fixture 一个 sink 函数。fixture 在自己的 handler 里调一次，Lab 不需要知道事件名清单。`inject` 带默认空实现，因此 fixture 单独渲染时不会报错。

条数上限 200 的裁剪放在 Lab 这一侧，不放进 `EventLogPanel`——零件替使用方丢数据是危险的默认行为，文档里已经写明它不裁剪。

## 发现六：假数据现场改不需要新零件

原以为要新写一个「改假数据」的零件。实际上 `JsonViewer` 传 `readOnly: false` 就是它，改完发 `update:value`。这也是它当初被选为对照组时就已具备的能力。

代价是场景登记的 `data` 必须能 JSON 化，因此 fixture 里的时间用固定值构造而不是 `new Date()`——顺带满足了「同一场景重复打开结果一致」这条验收。
