---
标签: [state:local, state:shared-read, state:inject, env:portal, env:global]
---

# DiffWorkbenchDialog

文档冲突的模态检视与决策窗口：把 `DiffWorkbench` 放入固定尺寸对话框，并把取消、采用一侧或保存合并结果等动作及结果文档交还给父级；窗口本身不读写文档来源。

## 布局

对话框宽度为视口的 92%、高度为视口的 82%，标题栏与动作栏由通用 Dialog 提供；正文内顶部可选副标题，比较工作台占满剩余高度。视口较窄时模式按钮仍为单行且容器隐藏超出项；自定义动作标签应保持简短。

## 交互

调用方用 `modelValue` 控制显隐。关闭请求回写 `update:modelValue(false)`；本组件禁用了 Dialog 的遮罩、Esc 和关闭按钮，因此正常关闭路径是配置的动作。每次动作都发出 `action`，载荷包含动作 id、结果文本和带 `resultContent` 的文档副本。`use-current` / `use-incoming` 取相应输入文本；其它动作使用当前合并结果。`closeOnAction` 有值时按其值关闭，否则仅 `cancel` 默认关闭。文档为 `null` 时正文不渲染，动作按钮仍显示但点击不发事件。此组件不定义额外键盘动作。

## 数据

```ts
import type {
    DiffWorkbenchAction,
    DiffWorkbenchActionPayload,
    DiffWorkbenchDocument,
    DiffWorkbenchMode,
} from "./diff-workbench.types";

interface DiffWorkbenchDialogProps {
    /** 对话框显隐；必填、受控。 */
    modelValue: boolean;
    /** 当前文档；null 时不显示正文且动作无效；必填。 */
    document: DiffWorkbenchDocument | null;
    /** 底部动作列表；默认「取消」「使用 Incoming」「保存结果」。 */
    actions?: DiffWorkbenchAction[];
    /** 允许的比较模式；默认四种模式全部可用。 */
    availableModes?: DiffWorkbenchMode[];
    /** 工作台初始模式及文档变化后的模式；默认 "diff"。 */
    initialMode?: DiffWorkbenchMode;
    /** 合并结果是否只读；默认 false。 */
    mergeReadonly?: boolean;
    /** Diff 是否并排；默认 true。 */
    renderSideBySide?: boolean;
    /** 是否显示空白字符；默认 false。 */
    showWhitespace?: boolean;
    /** 对话框标题；默认 "Diff"。 */
    title?: string;
    /** 正文副标题；默认空字符串、不显示。 */
    subtitle?: string;
}

interface DiffWorkbenchDialogEmits {
    /** 通用 Dialog 请求更新显隐时发出。 */
    (event: "update:modelValue", value: boolean): void;
    /** 有文档时每次有效动作发出。 */
    (event: "action", value: DiffWorkbenchActionPayload): void;
}
```

`DiffWorkbenchAction` 与 `DiffWorkbenchActionPayload` 的完整联合类型见 `diff-workbench.types.ts`。没有 slots、没有 expose；attrs 由 Vue 默认透传到根 Dialog。内部合并结果在文档变化时用 `resultContent`、其次 `currentContent` 初始化；活动模式按 `initialMode` 初始化。

## 状态

关闭时没有可见内容。打开且有文档时显示比较工作台；无文档时正文为空。动作按各自 `disabled` 呈现禁用态。此组件没有独立加载、校验或错误态。

## 不支持

不读取或保存文件、不发起请求、不解析动作 id 的业务意义、不校验结果内容，也不负责冲突解决后的刷新或关闭策略。父级必须处理 `action` 并决定数据副作用。

## 隐藏通道理由

- `state:local`：窗口内部保存当前比较模式与合并结果草稿，文档 prop 改变时重新初始化；组件卸载后丢失。
- `state:shared-read`：内含的 `DiffWorkbench` 使用共享产品主题会话的 `appearance` 选择 Monaco 主题；正文和冲突数据仍由 props 提供。
- `state:inject`：内部 `Dialog` 通过应用 `useI18n()` 取得默认确认/取消文案，即使本组件关闭其默认 footer 仍会初始化该依赖；语言由应用提供，不逐条作为 props 传入。
- `env:portal`：内部 `Dialog` 默认把模态内容 Teleport 到 `.novel-ide-theme`，Lab 页面和 IDE 页面均提供该主题宿主；目标缺失时 Teleport 无法显示内容并由 Vue 报告目标问题。
- `env:global`：内部 `Dialog` 在 `modelValue` 从关闭切为打开时向 `document` 注册 Esc 监听，关闭或卸载时移除；若组件以 `modelValue=true` 初次挂载，Dialog 的非即时 watcher 不会注册该监听。本组件禁用了 Esc 关闭，遮罩/指针关闭也被禁用。
