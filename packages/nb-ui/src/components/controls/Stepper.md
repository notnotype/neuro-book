---
标签: [state:local]
---

# Stepper

`Stepper` 以有序步骤导航展示多阶段流程的进度，显示当前步骤、已完成步骤和后续步骤，可横向或纵向排列。它只管理步骤选择与状态呈现，不包含每一步的内容面板，也不提交流程数据。

## 布局

横向模式下各步骤沿一行分布，步骤之间用连接线分隔；纵向模式下按列排列，连接线垂直连接相邻项。每项包含圆形编号/图标指示、标题和可选说明；已完成项使用完成色，当前项使用强调色。容器宽度由父级决定，横向步骤和说明文字较多时会压缩可用空间；在 `390×844` 窄屏下，长流程建议改用纵向模式。

## 交互

- 激活步骤触发上游 Stepper 交互；状态变化后发出 `update:modelValue`。传入 `modelValue` 时由父组件决定当前步骤，不传时由上游按 `defaultValue` 管理。
- `linear` 为真时，是否允许跳过未完成步骤遵循上游线性步骤规则；默认 `false`。
- 全局 `disabled` 或步骤自身 `disabled` 禁止对应步骤交互。
- 焦点移动与步骤按钮的键盘语义由 Reka Stepper 原语负责；组件不额外监听全局快捷键，也不主动将焦点移出步骤栏。

## 数据

```ts
export interface StepperStepData {
    /** 步骤编号；用于上游步骤顺序与当前状态判断 */
    step: number;
    /** 步骤标题 */
    title: string;
    /** 可选的补充说明；默认不显示 */
    description?: string;
    /** 可选图标 class；提供时优先于完成勾号或数字 */
    iconClass?: string;
    /** 是否禁用该步骤；默认 false */
    disabled?: boolean;
}

type StepperProps = {
    /** 当前步骤；传入时受控；默认 undefined */
    modelValue?: number;
    /** 非受控初始步骤；默认 1 */
    defaultValue?: number;
    /** 步骤数据；默认空数组 */
    steps?: StepperStepData[];
    /** 水平或垂直排列；默认 "horizontal" */
    orientation?: "horizontal" | "vertical";
    /** 是否使用线性导航规则；默认 false */
    linear?: boolean;
    /** 是否禁用所有步骤；默认 false */
    disabled?: boolean;
};

type StepperEmits = {
    /** 上游当前步骤更新时发出；包装器将 falsy 值归一为 1 */
    (event: "update:modelValue", value: number): void;
};

type StepperSlots = {};
```

`steps` 按输入顺序渲染；`step` 应提供与流程顺序一致的唯一编号。没有 slot 或 `expose` API。根节点为 Reka `StepperRoot`；未声明的 attribute、`class` 与 `style` 按 Vue 默认规则传给该根组件，实际 DOM 落点由 Reka 决定。

`state:local` 来自未受控时上游持有的当前步骤状态；传入 `modelValue` 时由父组件持有步骤值。

## 状态

- 默认：未传受控值时从 `defaultValue`（默认 1）开始；空 `steps` 时只呈现空步骤根节点。
- 当前：与 `modelValue`/非受控值匹配的步骤显示 active 状态；小于当前值的步骤按完成状态显示。
- 禁用：全局或单项禁用会阻止该步骤交互并降低透明度。
- 只读、加载、错误：组件没有统一只读、加载或错误态；流程内容与失败反馈由宿主呈现。

## 不支持

- 不支持步骤内容、流程校验、异步推进、返回策略或自动保存。
- 不支持由组件保证步骤编号连续、从 1 开始或输入顺序递增；这些是调用方的数据责任。
- 不支持同时提供 slot 自定义步骤内容。

## 上游边界

Reka UI 的 Stepper 原语负责当前步骤状态、线性导航规则、步骤语义和焦点/键盘行为。本组件负责将 `steps` 映射成指示器、标题、说明与连接线，并将更新值映射到 `update:modelValue`；未由包装器显式约束的行为以 Reka 上游为准。

## 已知偏差

- 指示器完成勾号的判断使用 `(modelValue ?? defaultValue) - 1` 与 `steps` 数组索引比较，而上游步骤状态使用 `step` 编号。若步骤编号不从 1 连续开始或数组顺序与编号不一致，圆圈中的勾号可能与 active/completed 样式不同步；输入非连续编号时不要依赖此勾号表现。
- `update:modelValue` 转发时将 falsy 值归一为 `1`；不要把 0 当作有效步骤编号。
