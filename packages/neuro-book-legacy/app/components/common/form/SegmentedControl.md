---
标签: []
别名: ["分段控件", "模式切换"]
---

# SegmentedControl

一排互斥选项的紧凑切换控件，用来做模式切换（富文本/源码、按类型筛选、按范围过滤这类）。和下拉框的区别是全部选项一次可见、点一下即切换、没有浮层；和单选按钮组的区别是它更紧凑，选中项靠面板底色与阴影从输入底色里抬起来，选项可以带图标、计数与悬停提示。

## 数据

```ts
type SegmentedControlValue = string | number | boolean | null;
type SegmentedControlSize = "xs" | "sm";
type SegmentedControlTone = "default" | "accent" | "warning";

type SegmentedControlOption = {
    /** 选项文字；必填 */
    label: string;
    /** 选项值；必填；选中判定是严格相等（类型也要一致） */
    value: SegmentedControlValue;
    /** 该选项是否禁用；默认 false */
    disabled?: boolean;
    /** 图标类名，可选；渲染在文字左侧 */
    iconClass?: string;
    /** 悬停提示，可选 */
    title?: string;
    /** 尾部计数，可选；以等宽字体渲染 */
    count?: number | string;
    /** 该选项专用的色调；不传则用组件的 tone */
    tone?: SegmentedControlTone;
    /** 渲染时的 data-testid，可选 */
    testId?: string;
};

interface SegmentedControlProps {
    /** 当前选中值；必填、受控——组件不保存选中态，点击只会发事件 */
    modelValue: SegmentedControlValue;
    /** 选项列表；必填；为空时只剩一个空的容器 */
    options: SegmentedControlOption[];
    /** 尺寸；默认 "sm"（高 28px、12px 字），"xs" 为高 24px、11px 字 */
    size?: SegmentedControlSize;
    /** 默认色调；默认 "default"；accent 让选中项用强调色，warning 用提醒色 */
    tone?: SegmentedControlTone;
    /** 是否允许换行；默认 true；设为 false 时选项挤压、文字截断而不是溢出容器 */
    wrap?: boolean;
}

interface SegmentedControlEmits {
    /** 点击可用选项时发出，携带该选项的值；点到已选中项也会原样再发一次 */
    (event: "update:modelValue", value: SegmentedControlValue): void;
}
```

没有 slot，没有 `expose`。未声明的 attribute 落到根容器上（`class` 会与内置类名合并），因此可以从外面加宽度或测试 id；选项元素本身拿不到外部 attribute。

## 交互

每个选项是一个原生按钮，因此键盘可达：Tab 逐个进入选项（没有方向键在组内切换的约定），回车或空格激活。选中态通过 `aria-pressed` 暴露，禁用项不可点击也不发事件。组件不移动、不接管焦点，焦点去向由使用方自己安排。

禁用是逐项声明的，组件没有统一的 `disabled` 状态；`options` 为空时渲染成一个空的容器壳，没有占位或错误态。
