---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: ui.agent-profile-settings
owners:
  - ui
---

# Agent Profile 设置视图

## 目标与非目标

目标：提供一个受控的 Agent Profile 设置视图组件，以常用设置优先的双栏工作区呈现默认设置页与各 Profile 详情，支持模型参数、运行策略、Profile 自定义表单的编辑草稿，以及保存、放弃修改、恢复默认与维护动作的事件上报。视图在 Component Lab 中以确定性 fixture 完成展示与交互验证。

非目标：本能力不承诺产品配置持久化、真实 Provider/Model 调用、Profile 资产创建/删除/改名、编译调度或 Home 数据删除；这些仍由配置宿主与后端拥有。本能力不改变 Component Lab 的场景、索引与排除合同。

## 术语与参与者

- **页面草稿**：一次编辑会话中全部可编辑配置的内存形态（默认 Profile 选择、默认模型/运行策略、各 Profile 的模型/运行策略/自定义设置草稿）。
- **基线**：宿主最近一次接受的页面草稿快照；未保存标记通过与它比较得出。
- **继承基线**：某字段未显式覆盖时实际生效的上层值，由视图按作用域层序推导。
- **作用域**：`global`（编辑完整值）或 `project`（编辑显式覆盖）。
- **宿主**：持有页面草稿、基线与上下文并执行真实保存的调用方；在 Lab 中是 fixture。

## 输入与前置条件

- Props：页面草稿 `modelValue`、基线 `baseline`、上下文 `context`（作用域、目标标签、继承默认 Profile、全局模型默认、全局 Profile 模型覆盖、已准备好的配置元数据与继承层、可选用途文案表）、`loading`、`saving`、`loadError`、`saveError`、`resettingHomeKey`。
- 前置条件：`context.settings` 已由宿主解析为只读元数据；视图不自行发起任何请求。上下文与草稿均为确定性输入。
- 权限：无。视图不读取凭据、文件系统或浏览器持久化。

## 输出与可观察行为

- 双栏工作区：主体双栏从顶部自然铺展，去除内置全宽 Header，避免后续作为 `DialogWindow` 或弹窗内容时产生双重标题栏冲突；左侧为 Profile 导航（含默认设置入口、搜索、状态徽标、未保存与覆盖计数），右侧为详情工作区。
- 底部固定动作栏：位于组件底部，左侧展示作用域徽标（`scopeLabel`）、未保存状态徽标（`有未保存的修改`）与保存中/保存错误状态提示；右侧提供「放弃修改」（无未保存内容时禁用）与「保存修改」（有修改且校验通过时可用）按钮。
- 容器宽度响应式：依托 CSS Container Query（`container-type: inline-size`）按组件自身容器宽度小于 700px 自动切换为单列（导航与详情二选一），不依赖浏览器全局窗口视口；详情顶部提供“选择 Profile”按钮，移动导航展开时顶部提供“返回详情”按钮，焦点在打开、返回与选择后精确归还。
- 默认设置页：默认 Profile 选择与实际生效值、默认模型与推理强度常驻；高级模型参数与通用运行策略折叠；消除多余的浮动卡片嵌套，各区段以语义分隔线自然划分。
- Profile 详情固定顺序：身份与状态 → 使用模型（常驻）→ 专属设置（有表单且 loaded 时默认展开，否则显示原因）→ 高级模型参数（折叠）→ 运行策略（折叠）→ 诊断与维护。失败原因同时在头部可见。
- 编辑任何字段即时发出 `update:modelValue`（复制被改分支，不修改 props）；导航的未保存标记与覆盖计数随之更新；切换 Profile 或搜索过滤不丢失草稿。
- 「保存修改」校验通过后发出 `save` 携带整份页面草稿；「放弃修改」在有未保存修改时激活，确认后发出 `update:modelValue` 恢复基线；「恢复默认」只清空当前详情的覆盖；重置 Home 经确认后发出 `reset-home` 携带 profileKey。`reload` 在加载错误态发出。
- 保存中、加载中显示对应反馈并禁用编辑；加载错误显示错误与重载入口；保存错误保留全部草稿并提供再提交入口。
## 状态与转换

本能力不引入持久状态。视图本地状态：当前选中项（Profile key 或默认页）、搜索词、折叠区开合、确认对话框。初始选中第一个按 key 排序的 Profile，空列表时选中默认设置页。选中的 Profile 从草稿移除时回到默认设置页；搜索过滤不改变选中。加载/保存忙状态统一禁用修改类动作。

## 副作用与数据

无持久化、无网络、无文件访问。视图发出的全部副作用通过事件由宿主执行；Lab fixture 仅将基线更新为当前草稿的内存副本，通过数据面板、事件面板及保存提示提供「已保存到本次预览」明确反馈，不写真实配置。
## 失败与恢复

- 运行策略字段校验失败（非法数值、超出范围的百分比等）在字段下方显示错误、展开对应分区并阻止保存；不提交非法数据。
- 温度须为空或有限非负数；TopK 须为空或正整数。
- 未保存标记以页面草稿与基线的可编辑字段比较为准：非法输入仍视为有修改，不因序列化丢弃而显示「无修改」。
- 加载错误不挂载可编辑表单，提供 `reload`；保存错误不回滚草稿，用户可修正后再次保存或放弃修改。
- Lab 场景输入非法时显式显示输入错误，不静默捏造可用数据。

## 边界与兼容

- 视图属于 NeuroBook 领域层（`novel-ide/settings/agent-profile/`），只消费 nb-ui 公共组件与语义 token；不引入 `isLab`、路由判断或旧主题变量。
- 运行策略与模型草稿的序列化、继承解析沿用 `agent-profile-draft.ts` 与 `profile-runtime-settings.ts` 的现有纯函数，不建立第二套算法。
- Profile 自定义设置沿用 LowCodeForm 的 global 完整值 / project overridePaths + resourceMutations 合同。
- 组件文档（同名 `.md`）持有精确 props/emits/slots 合同与能力标签；本规范不复制类型声明。
- 正式设置页接线、产品主题 clean cutover 与 Product gate 不属于本能力。

## 验收与 Smoke

1. Given Lab `global` 场景，When 修改某 Profile 模型后切换到其它 Profile 再返回，Then 修改保留、导航未保存标记与覆盖计数同步。
2. Given Lab `global` 场景，When 保存，Then 事件面板记录 save 与完整草稿，未保存标记清除且提示「已保存到本次预览」；When 再编辑后放弃，Then 恢复到保存值。
3. Given Lab `project` 场景，When 修改默认温度，Then 未覆盖项立即跟随新基线、显式覆盖项不变；When 运行策略输入非法百分比（如 2），Then 字段错误阻止保存，改回合法值后可保存。
4. Given Lab `custom-settings` 场景，When 编辑九类字段并切换继承↔覆盖、执行资源创建/改名/删除，Then 草稿与事件面板反映对应变化，无文件写入。
5. Given `loading`/`load-error`/`save-error`/`saving` 场景，Then 分别呈现骨架与禁用、错误加重载、错误保草稿、保存中禁用编辑。
6. Given 容器 1440×900、768×1024 与 390×844，Then 核心操作可完成，无页面级横向滚动；键盘可完成选择、折叠、保存与确认；明暗主题下文本与浮层可读。
7. Given 全程监测网络，Then 除 Lab 自身资源外无业务 API、Provider 或文件请求。

Smoke 入口：`bun run --cwd packages/neuro-book smoke:component-lab -- --url <source-dev-url> --browser-executable <chromium>`；场景细节由 `app/component-lab/fixtures/AgentProfileSettingsViewFixture.vue` 登记。

## 实现合同

- 模块归属与形态：NeuroBook 领域设置层受控组件，面向对话框或浮动窗口宿主设计；顶部不设全宽标题栏以避免与宿主标题栏产生双重标题冲突，底部设有统一固定动作栏管理会话级状态。
- 数据流契约：完全受控的单向数据流。输入页面草稿与基线快照，字段编辑发出局部更新事件，保存与放弃作用于整个会话草稿；组件内部不持有持久化、全局存储与网络请求。
- 容器响应式契约：以组件自身容器宽度 700px 为阈值实现单列与双栏切换，不依赖外部浏览器视口；单列模式下提供导航与详情双向切换控件，且在打开导航、关闭导航与选择项之间确保键盘焦点精准流转与归还。
- 独立验证边界：视图对外不产生持久化或网络副作用，所有状态、继承与校验行为可在无真实配置写入的受控环境与聚焦测试中完整验证。
## 证据

- 批准依据：用户于 2026-09-08 批准的 Lab-first 完整设置页计划（`local://profile-settings-lab-plan.md`，本会话批准记录）；Work `w00003-neurobook-ui-foundation-migration` Lab-first replacement 路线。
