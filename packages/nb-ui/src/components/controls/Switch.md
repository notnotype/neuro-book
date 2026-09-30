---
标签: [state:local]
---

# Switch

`Switch` 是一个紧凑的二态开关，用于表达单个布尔设置的启用/停用。它把轨道、滑块和无障碍 switch 语义封装在一起，支持受控值与由组件暂存的非受控初值；与复选框组不同，它只表示一个布尔值。

## 布局

开关是固定宽高的 inline-flex 圆角轨道，滑块沿水平方向移动。`sm`、`md`、`lg` 分别为 28×16px、36×20px、44×24px；滑块分别为 12px、16px、20px。组件不会根据文本扩张，也不包含标签，父组件负责在旁边提供说明和布局。

在 `390×844` 窄屏中尺寸保持不变；需要与文字组合时由父级控制间距和换行，开关自身不提供滚动或折行。

## 交互

- 点击开关在开启/关闭之间切换；受控模式下通过 `update:modelValue` 请求父组件回写，非受控模式下由上游原语暂存变化。
- 键盘激活行为、焦点移动与 `role="switch"` 的语义由 Reka Switch 原语负责；组件提供可见焦点环。
- `disabled` 为真时不可点击或键盘激活，轨道降低透明度。
- `name` 传给原语用于表单关联；`ariaLabel` 为开关提供可访问名称，默认是“开关”。组件挂载或卸载时不主动转移焦点。

## 数据

```ts
export type SwitchSize = "sm" | "md" | "lg";

type SwitchProps = {
    /** 当前布尔值；传入时受控；默认 undefined（不传时使用 defaultValue） */
    modelValue?: boolean;
    /** 非受控初值；默认 false */
    defaultValue?: boolean;
    /** 是否禁用；默认 false */
    disabled?: boolean;
    /** 尺寸；默认 "md" */
    size?: SwitchSize;
    /** 原生表单名称；默认 undefined */
    name?: string;
    /** 可访问名称；默认 "开关" */
    ariaLabel?: string;
};

type SwitchEmits = {
    /** 开关值变化时发出；受控使用时父组件持有最终状态 */
    (event: "update:modelValue", value: boolean): void;
};

type SwitchSlots = {};
```

`modelValue` 缺省时，组件把 `defaultValue` 传给上游并使用非受控状态；传入 `modelValue` 时由父组件控制当前状态。组件没有 slot 或 `expose` API。未声明的 attribute、`class` 与 `style` 按 Vue 默认规则传给根 `SwitchRoot`，最终 DOM 落点和未声明的原生 switch attribute 由 Reka 决定。

## 状态

- 默认：按当前布尔值显示关闭或开启轨道，滑块在对应位置。
- 禁用：不可交互并降低透明度；不会发出新的值事件。
- 只读、加载、出错、空数据：组件没有统一的只读、加载、错误或空数据状态；需要只读时由父组件保持值并禁用交互，业务反馈由父级呈现。

## 不支持

- 不支持三态、混合态或内置标签文本。
- 不支持异步切换、请求、持久化或确认流程；`update:modelValue` 只报告用户的布尔值变化。
- 不支持通过 slot 替换轨道或滑块内容；尺寸和颜色只能使用组件现有 props 与主题。

## 上游边界

Reka UI 的 Switch 原语负责 switch 角色、受控/非受控值、键盘激活和表单语义。本组件承诺尺寸、轨道/滑块视觉状态、默认可访问名称与 `update:modelValue` 映射；其余未显式约束的 DOM 和交互细节以 Reka 上游为准。

`state:local` 的理由：未传 `modelValue` 时，`defaultValue` 后的开关状态由上游原语在组件实例内持有，销毁后丢失；传入受控值时状态归父组件所有。
