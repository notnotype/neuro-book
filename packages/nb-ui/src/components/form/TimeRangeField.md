---
标签: [state:local]
---

# TimeRangeField

按 locale 展示由起始和结束时间组成的可逐段编辑字段。与并排放置两个独立 `TimeField` 不同，它把两端作为一个范围控件交给 Reka UI 管理，并用固定的 `~` 分隔。

## 布局与交互

控件以行内布局显示时钟图标、起始时间段、`~` 和结束时间段。`size` 改变控件高度、字号和小尺寸图标；窄屏不切换结构，空间由父级布局提供。聚焦和键盘编辑由 Reka UI 的范围字段原语处理。

`disabled` 禁止编辑，`readonly` 保留查看但不允许修改。是否允许范围两端处于特定顺序、段的格式与键盘导航由 Reka UI 决定，本包装不另行校验。

## 数据

```ts
type TimeRangeFieldProps = {
    /** 当前范围；传入时为受控值，未提供时使用 defaultValue 管理初始状态 */
    modelValue?: any;
    /** 非受控初始范围；默认 {start: undefined, end: undefined} */
    defaultValue?: any;
    /** 禁止编辑与交互；默认 false */
    disabled?: boolean;
    /** 只读但仍可查看；默认 false */
    readonly?: boolean;
    /** 时间段格式与次序所用地区；默认 "zh-CN" */
    locale?: string;
    /** 控件尺寸；默认 "md"，可选 "sm" | "md" | "lg" */
    size?: "sm" | "md" | "lg";
};

type TimeRangeFieldEmits = {
    /** 用户修改范围后发出新值；受控用法由父组件回写 */
    (event: "update:modelValue", value: any): void;
};

type TimeRangeFieldSlots = {};
```

源码将范围值及更新事件写为 `any`，没有进一步公开 TypeScript 结构约束；默认值明确包含 `start` 与 `end` 两个未选端点。没有 expose。未声明的 attributes、`class` 与 `style` 交给唯一根 Reka `TimeRangeFieldRoot`，最终 DOM 落点由 Reka 决定。

## 状态与边界

- `modelValue` 为受控值；未提供时使用 `defaultValue` 作为非受控初值，变更通过 `update:modelValue` 报出。
- 没有独立加载、错误或空数据状态；无初值时两端均未选择。
- 不提供范围校验规则、自定义端点标签或可插拔分隔符。

## 上游边界

Reka UI 负责时间范围值的实际结构、locale 格式化、段渲染、无障碍语义、键盘编辑及受控/非受控状态。本组件承诺的只有两端并列的外观、固定 `~` 分隔符、nb-ui 尺寸以及上述 props/emits；其余行为可能随 Reka UI 升级变化。