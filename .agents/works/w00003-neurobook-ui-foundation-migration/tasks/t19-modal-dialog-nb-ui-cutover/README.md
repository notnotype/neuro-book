---
schema: nbook.task/v2
taskId: t19-modal-dialog-nb-ui-cutover
---

# 模态 Dialog 迁移到 nb-ui

## 目标

把 NeuroBook 主应用的**模态对话框**消费者从 `app/components/common/Dialog.vue` 迁到 `@notnotype/nb-ui/components` 的 `Dialog`，并在迁移中保持既有产品行为（主题宿主、关闭入口、按钮文案、尺寸语义）不变。工作台型大窗口、命令式对话框与旧组件删除不在本批。

## 已批准决策（开发者 2026-09-13）

### D1 Teleport 宿主：产品侧显式声明

- **决策**：每个会话消费者显式传 `teleport-target=".novel-ide-theme"`；`app/pages/admin/users.vue` 例外，保持 `:teleport-target="false"`。
- **理由**：nb-ui `Dialog` 的 `teleportTarget` 默认是 `body`，而产品主题变量（`--bg-panel`、`--text-main` 等）由 `.novel-ide-theme` 宿主发布；teleport 到 `body` 会让对话框拿不到主题变量。t16 已为 `DialogWindow` 定下同一合同——**产品必须显式传入自己的主题宿主，公共组件不硬编码产品宿主**。admin 页面不挂 `.novel-ide-theme`（页面自带主题挂载），关闭 teleport 反而保持原有继承关系。
- **落地**：19 个文件的 23 个 `Dialog` 实例全部显式传入（20 处宿主字符串 + 3 处 `false`），无遗漏、无隐式默认。

### D2 关闭入口：保留 `closable`

- **决策**：保留 `closable`。
- **理由**：旧 `common/Dialog.vue` 的 `closable` 默认 `true`，nb-ui `Dialog` 默认 `false`；迁移不得静默移除用户可见的关闭入口。自带 `#header` 的实例不加（自己的 header 里已有出口，避免出现两个关闭行为）。
- **落地**：19 处 `closable`；4 处自带 `#header` 的实例未加（`AgentSessionDialog`、`WorkspaceCharacterDetailPanel`、`WorkspaceLocationProfileDialog`、`WorkspaceRuleProfileDialog`）。

### D3 按钮文案：沿用产品 i18n

- **决策**：默认 footer 的确认按钮显式补 `:confirm-label`，取值沿用既有 i18n `common.confirm`（zh-CN「确定」/ en-US「Confirm」），不接受 nb-ui 的硬编码默认「确认」。
- **理由**：旧 `common/Dialog.vue` 的确认按钮就是 `t("common.confirm")`；若留空走 nb-ui 默认值，中文界面会静默从「确定」变成「确认」——一次迁移引入的文案回退。
- **落地**：7 处（详细清单见 walkthrough 001）。其中 `NovelPlotPanel.vue`、`ProfileTemplateVisualEditor.vue` 此前没有任何 i18n 用法，为使文案来源唯一，补 `const {t} = useI18n();`（与 `NovelIdeToolPanel.vue` 等邻近文件的写法一致），不新增 i18n key。

### D4 行为升级：接受焦点陷阱与背景滚动锁

- **决策**：接受 nb-ui `Dialog`（Reka 模态语义）带来的焦点陷阱与背景滚动锁，视为本批的有意升级。
- **理由**：旧 `common/Dialog.vue` 两者都没有，焦点可以跑到遮罩后面、页面背景仍可滚动；模态对话框的定义本就包含这两条。
- **代价**：初始焦点落点、嵌套滚动容器（对话框内部 `overflow-auto` 区域）的滚动锁叠加需要真实浏览器确认——本批没有浏览器验收，见「未完成项」。

### D5 尺寸与几何：工作台型大窗口本批冻结

- **决策**：(d) 冻结 10 个工作台型大窗口，本批不迁移；只迁移「靠默认 footer 的普通模态对话框」。
- **理由**：这些窗口都用旧组件的 `body-class="!p-0 !gap-0 !overflow-hidden ..."` 接管 body 内边距与滚动，而 nb-ui `Dialog` 没有关闭/接管 body 内边距的能力；迁过去必须先给公共组件加能力（`padded/flush`），属公共库改动而不是消费者迁移。硬凑会在消费者里堆特例。
- **落地**：10 个文件保持旧入口不动（清单见 walkthrough 001）；能力缺口登记为 backlog 1。

### D6 死代码与命令式对话框

- **决策**：
  - (a) 删除三个全仓无引用的组件：`app/components/novel-ide/rag/NovelRagPanel.vue`、`app/components/novel-ide/rag/NovelRagInspectorDialog.vue`、`app/components/markdown-studio/MarkdownStudioTutorialAgentDialog.vue`；
  - (c) 命令式 confirm / prompt / choose 服务**单独立项**，本批不做；
  - (d) `app/composables/useDialog.ts` 本批不动。
- **理由**：迁移批次只处理显式模板消费者。命令式服务是跨入口产品 authority（`app/app.vue` 把它装到 `window.$dialog/$notify` 并覆写 `window.alert/confirm/prompt`），它的 promise 语义、宿主 teleport、文案与焦点行为要单独立项定义；把它塞进「等价迁移」会把迁移变成重设计。
- **落地**：(a) 已完成（含引用它们源码/名称的测试断言处理，见 walkthrough 001）；(c) 登记为 backlog 2；(d) `useDialog.ts` 中 3 处 `h(Dialog, ...)` 保持原样。

### D7 旧组件处置：本批不删

- **决策**：`app/components/common/Dialog.vue` 本批不删。
- **理由**：仍有 11 个真实消费者（10 个工作台窗口 + `useDialog.ts` 的动态渲染）；删掉会连带 D5 冻结与 D6(c) 立项的两批工作。
- **解封条件**：backlog 1（`padded/flush`）与 backlog 2（命令式服务）都落地后，旧入口才可以谈删除。迁移期指引已写进 `packages/neuro-book/AGENTS.md`：新代码不再新增旧入口消费者。

## Backlog

### backlog 1：nb-ui `Dialog` 的 `padded` / `flush` 能力

- **缺口**：nb-ui `Dialog` 固定渲染 body 内边距；工作台型窗口需要「窗口自己拥有 body 内边距与滚动」。当前 10 个冻结窗口靠旧组件的 `body-class="!p-0 ..."` 特例实现（见 walkthrough 001 的清单）。
- **目标**：给 nb-ui `Dialog` 一个显式开关（例如 `padded?: boolean` 默认 `true`，或与 `body-class` 并列的 flush 入口），使消费者不必用 `!important` 工具类覆盖公共组件内边距。
- **判据**：开关打开时 body 的 `padding` 为 0 且滚动由内容自己持有；默认（普通对话框）内边距与本批迁移后的观感完全一致；10 个冻结窗口迁移后不出现「两层边距」。

### backlog 2：命令式 confirm / prompt / choose 服务

- **缺口**：`app/composables/useDialog.ts` 提供 `alert/confirm/prompt/choose`，并在 `app/app.vue` 里挂成 `window.$dialog/$notify` 且覆写 `window.alert/confirm/prompt`；它内部用 `h(Dialog, ...)`（3 处）直接渲染**旧**组件。
- **目标**：单独立项定义命令式对话框的服务形态（promise 语义、宿主 teleport、按钮文案、焦点与滚动锁、与 nb-ui `Dialog` 的关系），再决定是否切换实现。不得用 nb-ui `Dialog` 或别名隐藏差异。
- **现状**：本批不动；旧组件的删除（D7）依赖此项与 backlog 1。

## 事实基准

- 迁移范围：19 个消费文件，共 23 个 nb-ui `Dialog` 实例；其中 20 处 `teleport-target=".novel-ide-theme"`，3 处（`app/pages/admin/users.vue`）`:teleport-target="false"`。
- 旧入口剩余真实消费者 11 个：10 个工作台型大窗口 + `app/composables/useDialog.ts`（另有 `NovelIdeModelSelect.vue` 只在注释里提到该路径，不构成依赖）。
- 10 个冻结窗口都同时使用 `:show-footer="false"` 与 `body-class="!p-0 ..."`（`DiffWorkbenchDialog` 例外，它用 `:closable="false"` + `body-class="min-h-0"`）。

## 实现范围

1. 逐个消费者切换导入到 `@notnotype/nb-ui/components`，并按 D1/D2/D3 补齐显式属性。
2. 迁移后核对每个实例的 props 差异（尺寸、`show-footer`、`overlay-type`、`busy`、事件接线）。
3. 删除 D6(a) 的三个死组件并处理引用其源码/名称的测试断言。
4. 记录决策、backlog 与核对证据；同步 `packages/neuro-book/AGENTS.md` 的组件复用指引。

## 验收

- `bun x vue-tsc --noEmit -p packages/neuro-book/tsconfig.json` 无输出；
- 聚焦测试通过（`app/components/novel-ide/rag/rag-entry-visibility.contract.test.ts` 等受影响文件）；
- 全仓源码不再引用被删除的三个组件；
- 10 个冻结窗口与 `useDialog.ts` 未被本批修改（git diff 可查）。

## 未完成项

- **浏览器人工验收未做**（本机 Chromium 不可用）：焦点陷阱与背景滚动锁（D4）在真实页面上的表现、长表单对话框的初始焦点、以及 7 处确认按钮文案在两种语言下的实际渲染，都需要一次真实浏览器复核。
- 10 个工作台窗口的迁移依赖 backlog 1；命令式服务依赖 backlog 2；旧组件删除依赖两者（D7）。
- `app/components/novel-ide/rag/` 下 `NovelRagInspectorSidebar/Main/Detail.vue` 与 `rag-inspector-workbench.types.ts` 在 `NovelRagInspectorDialog.vue` 删除后已无消费者，本批按 D6(a) 的清单未删除；另 `askTutorialAgent` / `askTutorialAgentDescription` 两个 i18n key 在 `MarkdownStudioTutorialAgentDialog.vue` 删除后不再被引用。两项都需要新授权后再清理。
