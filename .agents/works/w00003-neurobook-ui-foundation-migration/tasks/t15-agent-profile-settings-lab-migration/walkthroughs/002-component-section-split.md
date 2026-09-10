# 逐组件拆分与优化记录

## 背景

开发者指出 `AgentProfileSettingsView.vue` 右侧滚动区仍由两个大组件承担，无法按职责逐个优化。此次切片先拆分组件，再分别建立 Lab 入口；没有把整页视觉重做与拆分混在一起。

## 拆分结果

`AgentProfileDetailPanel.vue` 现在只做受控编排，右侧职责拆为：

- `AgentProfileIdentitySection.vue`：名称、用途、key、源路径、编译/加载状态。
- `AgentProfileModelSection.vue`：常用模型/推理强度与高级模型参数折叠。
- `AgentProfileCustomSettingsSection.vue`：LowCodeForm、继承值和 resource mutations。
- `AgentProfileRuntimeSection.vue`：运行策略覆盖折叠和基线传递。
- `AgentProfileDiagnosticsSection.vue`：恢复默认、Home 重置请求和构建原因。

`AgentProfileDefaultsPanel.vue` 现在只做默认页组合，拆为：

- `AgentProfileDefaultProfileSection.vue`
- `AgentProfileDefaultModelSection.vue`
- `AgentProfileDefaultRuntimeSection.vue`

所有新组件都有同名 Markdown 文档与 `state:local` 能力标签；`AgentProfileSettingsView` 另声明 `state:inject` 与 `env:portal`，因为它注入 i18n 并由 nb-ui `AlertDialog` Portal 到默认 `body`；其它区段没有新增 store、IO、route 或持久化隐藏通道。

- `AgentProfileModelFields.vue` 接收页面校验映射，在温度与 TopK `FormField` 下显示错误并透传 `aria-invalid`；`AgentProfileSettingsView` 按默认页/Profile 分组传递错误，不改变受控更新边界。
- 受控无 trigger 的 `AlertDialog` 只在存在 `trigger` slot 时挂载 `AlertDialogTrigger`，避免空 as-child 节点阻断 Home 确认；nb-ui 增加 triggerless portal 回归测试。
- 默认页与详情内容区保持 loading → load-error → active Profile → defaults 条件链，避免模板收窄和错误覆盖。
- 运行策略默认页的覆盖计数与错误自动展开保持受控；Profile 详情继承层继续由页面组装，不叠加当前 Profile 草稿。
- `AgentProfileModelFields.test.ts` 验证温度/TopK 错误文本与 `aria-invalid`，nb-ui `components.test.ts` 验证无 trigger 受控 AlertDialog。

## 验证（当前工作树 revision）

当前 `HEAD` 仍为 `c75bbb601621a33d959bfe3a338cfef432280eda`；其后的 t15 修复尚未提交。已验证：
- `bun x vue-tsc --noEmit -p packages/neuro-book/tsconfig.json`：通过。
- t15 聚焦集合：8 个文件 / 36 个测试通过，包含运行时基线层序、真实默认设置链路、模型错误和页面级 Dialog 焦点回归，以及 10 个设置场景注册（含 DialogWindow 内嵌）。
- `bun run --cwd packages/nb-ui test`：15 个文件 / 260 个测试通过。
- `bun run --cwd packages/nb-ui typecheck` 与 `build:css`：通过。
- Component Lab Dialog 专项路径通过；验证 viewport rect `left=328, top=64, right=1428, bottom=844`、页面 `scrollWidth=clientWidth=1440`、DialogWindow 内 FormSelect 下拉层级高于窗口、3 个 resize handles、键盘调宽和关闭/重开。整套 smoke 另有既有 CollapsibleSidePanel 文案断言失败。
- `docs:check`：5413 个文件、0 failures；`governance:check`：0 failures、0 warnings。
- `git diff --check`：通过；仅 Git 报告工作树 LF→CRLF 提示。
- `bun run --cwd packages/nb-ui test:e2e`：20 个通过、14 个失败；本次失败包含视觉基线漂移与 `#nb-lab-target` 等待超时，未更新基线。

本轮代码修复：

1. 页面按 defaults/Profile 建立 `modelValidation` 字段错误映射，贯穿默认页、详情、模型区段和 `FormField`；温度与 TopK 错误同时进入 `aria-invalid` 语义，错误时自动展开高级区并阻止保存。
2. runtime 基线 helper 仅服务 Lab 受控 View：Global defaults 从 harness 开始，Project defaults 叠加已保存 Global patch；Profile 详情排除当前 Profile 草稿但允许当前作用域 defaults 草稿影响跟随项。正式旧宿主仍独立组装 runtime 层，本切片未迁移它。
3. `AlertDialog` 仅在存在 `trigger` slot 时挂载 `AlertDialogTrigger`，恢复遮罩，并在 triggerless 受控模式阻止上游自动抢焦点；增加有 trigger 与无 trigger 的行为测试及页面级取消/Escape/确定焦点回归。
4. 设置页 footer、loading → load-error → Profile → defaults 条件链和 fixture 的 `h-full`/`data-lab-subject` 保持当前实现。

## 未闭合项与边界

1. Product gate 仍为 `incomplete`；本切片只交付 Lab 界面与自动交互证据，不生成 Product image/sourceDigest/HTTP/log/Bearer shutdown/static scan 证据。
2. 正式设置页仍未接线；t16 DialogWindow 迁移与本 Task 严格分离。
3. 本轮新增的真实 `/lab` DialogWindow 自动观察已由独立 smoke 覆盖；10 个设置场景的完整人工逐项验收（编辑/保存/放弃/继承/错误态/场景隔离/键盘/明暗主题/无真实副作用）仍未完成。
4. nb-ui E2E 仍未闭合：视觉基线漂移和共享 `#nb-lab-target` 等待超时未归因于 t15，未更新基线。
5. 用户未跟踪文件 `packages/neuro-book/eval-tmp.ts` 保留未动。
