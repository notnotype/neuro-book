---
schema: nbook.task/v2
taskId: t16-dialog-window-nb-ui-migration
role: tasker
---

# 迁移 DialogWindow 到 nb-ui

## 目标

在 `@notnotype/nb-ui` 中完成通用 `DialogWindow` 的 Reka 基础迁移，并把 NeuroBook 主应用的全部 DialogWindow 消费者切换到公开 nb-ui 入口。组件保持当前非模态浮动窗口语义：无遮罩，窗口外页面继续可交互；Reka 仅承担 Dialog 的可访问语义、Portal、关闭事件与非模态生命周期。

本 Task 不把 `DialogWindow` 当作模态 `Dialog` 的别名，也不把 Agent Profile 设置页行为带入本 Task。

## 已批准边界

开发者已确认：

- Reka 负责 Dialog 的可访问性与模态基础；
- DialogWindow 必须显式使用 `DialogRoot :modal="false"`；
- 不为 DialogWindow 添加 Overlay、模态焦点陷阱或背景滚动锁；
- 标题栏拖拽与窗口尺寸调整由项目层实现；
- 自定义 `header` 仍必须通过 `DialogTitle` 提供可访问名称。

## 当前事实与消费者

实现基准：

- 目标公共组件：`packages/nb-ui/src/components/feedback/DialogWindow.vue`；
- 当前主应用基准：`packages/neuro-book/app/components/common/DialogWindow.vue`；
- 公开入口：`@notnotype/nb-ui/components` 的 `DialogWindow`；
- Reka 版本：`reka-ui` `^2.10.1`；拖拽能力由现有 `@vueuse/core` 复用；
- `NB_Z_INDEX.dialogWindow` 为 `8990`，低于模态 Dialog 的 `9000`。

当前主应用直接消费者：

- `packages/neuro-book/app/components/novel-ide/agent/context-inspector/AgentContextInspectorDialog.vue`；
- `packages/neuro-book/app/components/novel-ide/jobs/AgentJobsDialog.vue`；
- `packages/neuro-book/app/components/novel-ide/settings/theme/ThemeEditorDialog.vue`。

当前 nb-ui playground 直接消费者：

- `packages/nb-ui/playground/app/pages/components.vue`。

## 公共接口合同

保留现有消费者所需接口，并将尺寸调整能力设计为可选、受控行为：

```ts
type DialogWindowResizeEdge = "right" | "bottom" | "corner";

type DialogWindowProps = {
    modelValue: boolean;
    title?: string;
    width?: number;
    height?: string | number;
    maxHeight?: string;
    minWidth?: number;
    minHeight?: number;
    resizable?: boolean;
    closable?: boolean;
    closeOnEsc?: boolean;
    busy?: boolean;
    bodyClass?: string;
    teleportTarget?: string | boolean;
};

type DialogWindowEmits = {
    (event: "update:modelValue", value: boolean): void;
    (event: "request-close", reason: "close-button" | "esc"): void;
    (event: "update:width", value: number): void;
    (event: "update:height", value: number): void;
};
```

接口实现必须遵守：

- `modelValue` 继续受控；没有 `request-close` 监听器时保留现有默认关闭行为；有监听器时只发出请求，不擅自关闭；`busy` 阻止关闭与尺寸调整；
- `width` 保持像素数值；`height` 与 `maxHeight` 保持 CSS 字符串兼容，未启用受控高度调整时不改变现有调用方；
- `resizable` 默认关闭，启用后通过右边、下边及右下角手柄调整尺寸，尺寸受 `minWidth` / `minHeight` 限制，拖动结束发出受控更新事件；不得写入浏览器存储；
- 默认标题与自定义 `header` 均必须最终渲染一个 `DialogTitle`，使 Reka `DialogContent` 的 `aria-labelledby` 始终指向可见或视觉隐藏的可访问名称；
- `DialogRoot` 必须显式 `:modal="false"`；不得渲染 `DialogOverlay`；不得启用 `trapFocus`、`disableOutsidePointerEvents`、body scroll lock 或自定义全局 Escape 监听来重复 Reka 行为；
- DialogWindow 的 Escape 关闭只在 `closeOnEsc` 开启且不忙碌时生效，关闭原因仍为 `"esc"`；非模态外部交互不关闭窗口；
- `teleportTarget` 默认是公共组件的 `body`；NeuroBook 等产品必须显式传入自己的主题宿主目标（当前为 `.novel-ide-theme`），缺失目标时沿用 Vue Teleport 的目标语义，不由公共组件创建隐式宿主；
- body 与 footer slot 继续保持现有用途，DialogWindow 不提供业务数据、网络、store 或持久化能力。

## 实现范围

1. 为 nb-ui `DialogWindow` 建立同名组件文档、行为测试与公开导出合同。
2. 用 Reka `DialogRoot`、`DialogPortal`、`DialogContent`、`DialogTitle` 重建非模态窗口壳；不复用模态 `Dialog` 的 Overlay 或焦点陷阱实现。
3. 复用现有拖拽边界语义；新增可选、受控的窗口 resize 行为与键盘可达 resize 手柄，避免与标题栏拖动冲突。
4. 将 NeuroBook 三个产品消费者和 nb-ui playground 消费者切换到公开 nb-ui `DialogWindow`，逐一核对尺寸、主题宿主、关闭和 body/footer class。
5. 删除旧主应用入口及其独有的实现；更新 nb-ui README、UI development spec、同名组件文档和必要的 playground 说明。
6. 不修改模态 `Dialog`、`AlertDialog`、Agent Profile 设置页、后端/API、真实配置持久化、Profile CRUD 或产品主题 authority。

## 验收

必须观察到：

- DialogWindow 打开时无 Overlay，窗口外按钮可点击，页面仍可交互；DOM 中 `DialogRoot` 的受控行为为非模态；
- 默认标题和自定义 header 都有可访问 DialogTitle；关闭按钮有可访问名称；
- 标题栏可拖动，窗口位置始终至少保留可抓取区域；Escape、关闭按钮与 busy 阻断语义保持一致；
- `resizable` 关闭时无 resize 手柄；开启时右/下/右下手柄可鼠标拖动，键盘可聚焦并调整尺寸，最小尺寸不会被突破；
- 主应用三个消费者的现有内容、尺寸、关闭请求、footer/body slot 与主题变量保持可用；不再从 `nbook/app/components/common/DialogWindow.vue` 导入；
- 1440×900 与 390×844 的 nb-ui playground/主应用可观察窗口无页面级横向溢出，长 body 在窗口内部滚动；
- 无新增业务 API、Provider、文件、store 或浏览器持久化请求。

## 验证命令

按 nb-ui 作用域合同执行：

```text
bun run --cwd packages/nb-ui test
bun run --cwd packages/nb-ui typecheck
bun run --cwd packages/nb-ui build:css
bun run --cwd packages/nb-ui test:e2e
bun run --cwd packages/neuro-book test -- app/components/novel-ide/agent/context-inspector app/components/novel-ide/jobs app/components/novel-ide/settings/theme
bun x vue-tsc --noEmit -p packages/neuro-book/tsconfig.json
bun run docs:check
bun run governance:check
git diff --check
```

浏览器验证使用独立 Chromium 或已登记的 Source Dev 服务；只做自动交互与 DOM/计算样式/console/network 观察，不宣称人工审美验收。产品 gate、push、PR、merge、发布、部署和主应用真实配置写入均不在本 Task 内。

## 本轮前置清理记录

在建立本 Task 前，已完成并验证两项与 t15 收尾直接相关、但不属于 DialogWindow 实现的清理：

- `docs/specs/ui/agent-profile-settings.md` 的 Smoke 描述改为泛化的 Component Lab 场景登记，不再约束 fixture 文件路径；
- `packages/neuro-book/app/component-lab/fixtures/AgentProfileSettingsViewFixture.vue` 删除同时存在的 `min-h-[560px]` 与 `min-h-0` 冲突，保留 `h-full max-h-full min-h-0` 的弹性容器策略，由 Lab 画布决定实际高度。

这两项改动必须与 DialogWindow 迁移分开提交；用户未跟踪文件 `packages/neuro-book/eval-tmp.ts` 不得修改。
