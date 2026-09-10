---
schema: nbook.task/v2
taskId: t15-agent-profile-settings-lab-migration
role: tasker
---

# 协作试迁移 Agent Profile 设置页

## 目标

在 NeuroBook Component Lab 中交付完整可操作的 Agent Profile 设置页 `AgentProfileSettingsView`：常用设置优先的双栏工作区，包含默认设置页、Profile 详情、模型与运行策略、LowCodeForm 自定义设置、未保存状态、保存/放弃/恢复默认与加载/保存错误状态。允许重新设计组件与前端数据结构；正式页面可以保持不可用，不要求本次恢复主页或兼容旧界面。Lab 数据只作用于场景内存，不写真实配置、不删除 Home、不调用真实 Provider。

## 范围与边界

- 交付物：`app/components/novel-ide/settings/sections/agent-profile/AgentProfileSettingsView.vue` + `.types.ts` + 同名 `.md`；原地重设计 `AgentProfileModelFields.vue`、`ProfileRuntimeSettingsFields.vue`、`AgentProfileDetailPanel.vue`、`AgentProfileDefaultsPanel.vue`；新增 `app/component-lab/fixtures/AgentProfileSettingsViewFixture.vue` 并在 `fixtures/index.ts` 登记 10 个场景（增加 `dialog-window` 内嵌预览）。
- 计划正文：`local://profile-settings-lab-plan.md`（本 Task 的行为合同来源）。批准它的用户授权即为开发者决策记录。
- 不修改 `component-index.ts`、LabShell、shared DTO、后端 schema、LowCodeForm 渲染器本体；不新增 Profile 资产 CRUD、编译器、模型调用或真实持久化。`dialog-window` 只在既有 fixture 中组合已公开的 nb-ui `DialogWindow`，不修改 DialogWindow 或正式设置宿主。
- Product gate 已知 incomplete：本次不生成 Product image evidence，不宣称 Work/Product gate 闭合。
- 保留用户未跟踪文件 `packages/neuro-book/eval-tmp.ts`。

## 开发者参与点

已确认（2026-09-08，本会话）：
1. 先在 Lab 做新版设计，正式页面暂不接线。
2. 常用设置优先：模型/推理强度/专属设置常驻，高级参数与运行策略折叠。

## 验证

1. 聚焦测试：`bun run --cwd packages/neuro-book test -- app/components/novel-ide/settings/sections/agent-profile/components/AgentProfileNavList.test.ts app/components/novel-ide/settings/sections/agent-profile/profile-runtime-settings.test.ts app/components/novel-ide/settings/sections/agent-profile/components/AgentProfileModelFields.test.ts app/components/novel-ide/settings/sections/agent-profile/AgentProfileSettingsView.test.ts app/component-lab`
2. Lab smoke 按职责分层：`bun run --cwd packages/neuro-book smoke:component-lab:core -- --url http://127.0.0.1:3001 --browser-executable <chromium>` 验证 Lab 壳与通用场景；`bun run --cwd packages/neuro-book smoke:component-lab:agent-profile -- --url http://127.0.0.1:3001 --browser-executable <chromium>` 只验证 Agent Profile 导航与 DialogWindow。`smoke:component-lab` 保留为完整组合入口。
3. 真实 `/lab` 交互验证设置页 10 组场景（含 DialogWindow 内嵌预览）与原有 9 组观察点：编辑/保存/放弃/继承/错误态/场景隔离/键盘/明暗主题/无真实副作用。当前仅完成 DialogWindow 场景自动观察，逐项人工验收仍未完成。
4. `bun run --cwd packages/neuro-book scripts:typecheck`。
5. `git diff --check`。
## 本轮缺陷修复

- `DialogWindow` 通过 nb-ui 注入上下文为其 body 子树提供专用 popover 层级 `8991`；`FormSelect` 在该上下文中使用 `8991`，普通页面仍使用 `60`，避免 DialogWindow `8990` 覆盖下拉。公共回归覆盖 DialogWindow 内 FormSelect 下拉层级。
- 窗口内嵌组合改为单层 chrome：`AgentProfileNavList` 新增 `surface="plain"`（旧宿主继续用默认 `panel`）。`AgentProfileSettingsView` 自身只保留无面形态——导航轨用一条与横线同款、两端各留 16px 的竖线与详情分开，两处内边距统一为 16px 与窗口标题栏 `pl-4` 对齐；不再出现「窗口套两张卡片」的双层边框，也不再有窗口标题与 `Agent Profiles` 的双标题。原先的 `layout="panel" | "flush"` 两档变体已删除：宿主只有设置对话框这类浮层，卡片档没有消费者。
- `AgentProfileSettingsViewFixture` 的 Lab 数据 sink 同时监听 `draft`、`baseline` 与 `message`，保存、重载和重置提示会立即同步到数据面板。
- 区段标题统一为线条分割：5 个区段的 `Collapsible` 触发器（高级模型参数、运行策略覆盖、通用运行默认值、Profile 预设、默认模型高级区）从「整条描边 + 填色的圆角框」改成静止态无框的标题行（图标 + 文本 + 徽标 + chevron，hover 才出现底色）。面板里只剩真正的控件（输入框、下拉、按钮）带框，不再出现「一节」长得像「一个单元」的混读。
- 线条层次：竖线改回与其他分割线同款（`--border-w` / `--divider`，不再渐隐），并且和横线一样两端留 16px 边距（`::after` 伪元素画在轨内），不再与标题栏分隔线交成 T 形；结构改为「导航轨 + 右列（详情）」，没有底部动作栏，横线不与竖线相交。设计语言 §二补「竖线两端留边距」「竖线不被横线穿过」「竖线与同类横线同款」三条判据。
- 详情内容列封顶 `max-w-3xl`（768px）：窗口放大到 1400px 时，原先下拉框会被拉到 1090px 宽（整行宽的横条）。封顶后控件、字段与区段分隔线都落在内容列内，导航轨仍贴窗口左边缘。设计语言 §三新增「内容列有上限宽度」，smoke 增加「内容列 ≤ 768px 且不超过滚动区宽度」断言。
- 就地保存：删除 `baseline` prop、`save` 事件、未保存比较、放弃修改确认弹窗，以及底部动作栏本身（保存中 / 保存失败改为内容列顶部内联、常态不占位）。视图不再展示作用域——`scopeLabel`、`context.targetLabel` 与 i18n `scopeGlobal` / `scopeProject` 一并删除，作用域交给宿主 chrome。fixture 每次修改后立即推进内存快照并提示「改动已就地保存到本次预览」，`save-error` 场景草稿保留、快照不推进。`AgentProfileNavList` 的 `dirty` / `defaultsDirty` 改为可选，i18n 删除 `discard` / `saveChanges` / `discardConfirmTitle` / `discardConfirmBody` / `saveHintPreview`，新增 `savingHint`。
- 设计语言补判据：§二新增「同一份内容被页面和浮层同时承载时，面由宿主声明」「什么时候画框，什么时候用线」「竖线两端留边距 / 不被横线穿过 / 与同类横线同款」，§三新增「内容列有上限宽度」；检查表同步增加对应条目。
- 已重启 `neuro-book-dev-3001`（`persist: true`，避免 last-omp teardown 再次杀掉服务）并使用最新代码执行三套 smoke：core、agent-profile 与完整组合入口均通过。Dialog geometry 输出为 `left=328, top=64, right=1428, bottom=844`，viewport 为 `1440×900`，document `scrollWidth=1440/clientWidth=1440`；Agent Profile smoke 还通过了单层线条组合（导航轨 1px 实竖线且无背景画线、导航与详情无卡片描边、动作栏上边线从竖线右侧开始、竖线走到窗口下沿）、内容列封顶、FormSelect 下拉层级、resize、关闭/重开与导航交互。
- DialogWindow 标题栏：新增 `titleAlign?: "left" | "center"`（默认 `left`，不改变既有消费者），`center` 时左右等宽占位让标题严格居中（实测中心偏移 0）；关闭按钮改 `sm`（26×26）、栏高 `min-h-9`，按钮距窗口上沿 6px、右沿 17px，避开窗口圆角。
- 窗口标题由宿主拼出作用域：Lab 的 `dialog-window` 场景改用 `header` slot 组合 `Agent Profile 设置 · <作用域>`（作用域取 i18n，次要色）；既有四个 DialogWindow 消费者显式 `title-align="left"`，Lab 场景保持 `center`。
- 折叠标题行抽成 nb-ui `CollapsibleSection`：5 份逐字重复的触发器收敛为一个组件（图标 + 标题 + `meta` 插槽 + chevron），行高 36 → 32、图标与 chevron 悬停 / 展开转 accent、悬停底色降到 `--bg-hover` 的 60%。
- `AgentProfileNavList` 的 `overflow-hidden` 只在 `surface="panel"` 保留：`plain` 档（窗口内导航轨）此前把搜索框的 focus glow 在顶边裁断。
- 作用域承载方式记入 walkthrough：宿主 `NovelIdeSettingsDialog` 自己有四档 scope 与 section 矩阵，`agent-profile-models` 只在全局 / 项目两档挂载，视图只消费已解析的 `context.scope`。
- `CollapsibleSection` 整行在列内左右各内缩 8px（底色即按钮本身，图标与文本一起内缩）；chevron 旋转按 §七 改回 `--motion-fast`。
- 修复折叠动画从未生效的缺陷：`animate-*` 键不在 `presetUno()` 主题里，`data-[state=open]:animate-collapsible-*` 变体不生成 CSS；改为样式表里用 `[data-state]` 驱动，`Collapsible` / `Accordion` 同时修正，坑表登记 #47。
- 删除诊断区的批量「恢复默认」（就地保存下立即写盘且不可撤销；逐字段继承 / 默认可达同样结果）及其 `reset` 事件链与 i18n；「重置 Home」保留。
- `CollapsibleSection` 底色改为占满整列宽度（与分隔线、控件同宽），内容 `px` 退让 6px；上一版的整行内缩会让高亮比其它元素窄 16px。
- 修复 `AgentProfileDefaultsPanel` 缺失的 `AgentProfileDefaultProfileSection` 导入（未 import 被渲染成空自定义元素）：默认 Profile 选择器恢复，默认设置页顶部那条多余横线随之消失。
- 删除「诊断与维护」区段及其整条 `reset-home` 链（详情面板事件与 props、视图弹窗与 prop、区段预览 fixture、注册表、i18n）；旧宿主保留自己的重置 Home。
- `LowCodeSelectField` 从旧的应用内下拉换成 nb-ui `FormSelect`：surface 与面板其余控件统一（磨砂浮层），不再是不透明自绘面板。
- `.nb-collapsible-content` / `.nb-accordion-content` 用 `padding: 6px; margin: -6px` 把裁切盒向外放 12px：折叠区段里的控件聚焦光环不再被高度动画的 `overflow: hidden` 剪掉（坑表 #48）。
- LowCodeForm 其余字段控件全部换成 nb-ui（`FormInput` / `FormTextarea` / `Switch` / `SegmentedControl` / `RadioGroup` / `CheckboxGroup`），资源预设字段连同两个对话框、管理器按钮一并换掉；下拉组合框保留实现但改用 nb-ui 控件基座与浮层基座（nb-ui 无同语义组件）。该目录已无旧 `app/components/common/form/*` 引用。
- 身份区（详情页标题块）从四行小字收敛到三行：`profileKey` 与来源路径合并为一行等宽元数据并去掉 `源文件:` 标签；「使用模型」「专属设置」补 `border-t pt-3`，每个区段边界都有分隔线。
- 未修改 `LabShell.vue`、`DialogWindow` 的 Portal 目标、侧栏拖宽范围或用户文件 `packages/neuro-book/eval-tmp.ts`。
- 复审收口（提交后独立审查）：`LowCodeCheckboxField` 曾按选项键重建取值，会静默丢掉「选项已下线」与「当前 disabled」两种历史值——改为只增删控件渲染出来的选项，其余原样带过，并补三个回归用例（无修复时失败）；`CollapsibleSection` 删除 `defaultOpen` 非受控路径（chevron 与内容不同源，箭头会指反）；`withDefaults` 中残留的 `resettingHomeKey` 与导航 fixture 的死常量 `fixtureStateKeys` 删除。
- 迁移配方、坑表与复用要求沉淀在 [t13 walkthrough 002](../t13-lab-first-migration-strategy/walkthroughs/002-trial-migration-gold-standard.md)；本页是实施记录，后续批次以那份为准。
