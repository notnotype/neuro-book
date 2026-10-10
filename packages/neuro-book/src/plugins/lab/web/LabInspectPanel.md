---
标签: [state:local]
---

# LabInspectPanel

Lab 的右栏：检视面板的五个页签。

- **文档**：能力标签、挂载结论与同名组件文档。
- **元素**：检查器选中的元素，可复制定位报告；另给结构检查（可访问名称、id 唯一、describedby 引用、combobox 展开关系、画布边界）与计算样式读数（`inspect-checks.ts`）。
- **事件**：当前会话的事件日志，可清空。
- **数据**：编辑场景登记的分层输入（`model`、`props`、`slots`），只读展示 fixture 上报的内部状态。
- **变量**：设计变量的覆盖（`LabVariablesPanel`）。

数据全部由 LabShell 持有，本零件只呈现与转发：页签是 `v-model`，清除选中、清空事件、还原输入、编辑某一层、开关插槽预设都以事件交给 LabShell。分层输入的合法性由 LabShell 按 schema 校验，不合法时它把原因经 `inputEditError` 交回来显示。

## 布局

一个 `CollapsibleSidePanel`（内容层），顶部固定一排页签，下面是滚动的面板区。宽度由 LabShell 给，比左栏宽一档，正文用 `MarkdownView` 的阅读刻度。

## 交互

- 复制定位报告后按钮换成「已复制」，约 1.6 秒后复原。这个提示状态归本零件。
- 页签的选中同时写进地址栏（`tab` 参数），由 LabShell 处理。

## 数据

```ts
props: {
    collapsed: boolean;
    width: number;
    selected: LabComponentEntry | null;
    picked: InspectedNode | null;
    events: LabEventEntry[];
    eventLimit: number;
    sceneInput: LabSceneInput | undefined;
    fixtureSlots: readonly string[];
    fixtureState: unknown;
    inputEditError: string;
    noInput: string | undefined;   // fixture 声明没有可编辑输入的理由
    inspection: LabInspection | null;   // 选中元素的结构检查与读数
    // 变量页签，原样交给 LabVariablesPanel
    tokenGroups, resolvedTokens, overrides, overrideCount,
    onOverrideSet, onOverrideReset, onOverrideResetAll, onOverrideImport, onOverrideExport
}
model: tab   // "doc" | "element" | "events" | "data" | "variables"
emits: {
    "update:collapsed": [collapsed: boolean];
    "clear-picked": [];
    "clear-events": [];
    "reset-input": [];
    "edit-input": [layer: "props" | "model", value: unknown];
    "set-slot": [name: string, on: boolean];
}
```

## 隐藏通道理由

`state:local` 只有「已复制」提示与它的计时器，卸载时清掉计时器。复制定位报告写系统剪贴板，是使用者点按钮触发的一次动作。
