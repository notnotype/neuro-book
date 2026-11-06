---
标签: []
---

# SegmentedControl

`SegmentedControl` 用紧凑的互斥选项在少量固定模式之间切换，例如列表/网格或显示范围。它将当前选项表现为一组 radio 按钮，并以滑动指示块强调选中项；它不承载对应的内容面板。

`SegmentedControl` 换模式：内容还是同一份，换个看法；也用于表单里三项以内、选项没有说明的单选。换去处用 `Tabs`，带说明或要竖排的单选用 `RadioGroup`；其余见[同类零件的分工](../../../docs/ui-development-spec.md#42-同类零件的分工)。

## 布局

根节点是带边框和浅底色的水平选项组。各段等宽，选中指示块位于选项下方，宽度与一段相同、按整段平移。图标、标签与可选计数在同一项内排列。

指示块是 `--accent-main` 实底，选中项文字取 `--text-inverse`。切换时指示块的平移与变宽过渡取 `--motion-base` 与 `--ease-standard`，连续滑向目标项。相邻两项之间有一条细竖线分隔；选中项两侧的竖线隐去，不和指示块叠在一起。

段宽规则：

- 宽度随内容（缺省）：每段取最宽一段的自然宽度，组宽是段数乘以最宽一段，再加内边距与边框；每段标签完整显示。
- 给了宽度（`fullWidth` 占满父容器，或宿主给根节点定宽）：各段平分这个宽度，标签放不下时截断。
- 父级比组的自然宽度窄：组不超出父级，各段一起收窄，标签截断而不撑开布局。

不按各段自己的宽度排：指示块的宽度与位移按「一段」计算，段宽不一时它对不上选中项。`wrap` 允许按钮换行并隐藏滑动指示块；换行时不适用上面的等宽规则。

在 `390×844` 下默认不换行；若段数乘以最宽一段超过可用空间，标签会截断，应设置 `wrap` 或缩短选项文字。`fullWidth` 只改变组宽度，不会改变每项均分指示块的计算方式。

## 交互

- 点击启用的选项时发出 `update:modelValue`；值由父组件持有，组件不维护选择状态。
- 按下选项时该项缩小到 0.96；只读和禁用时不缩。
- 禁用选项不会响应点击或键盘导航。方向键 Right/Down 前进，Left/Up 后退，Home/End 跳到首/末个启用项；移动会循环并发出新值，同时把焦点移到目标选项。
- `modelValue` 不对应任何选项时（例如当前尺寸是手动拖出来的、不属于任何预设）一个都不选中，键盘进入时停在第一个启用项；对应的是停用项时同样停在第一个启用项；方向键向后从第一项、向前从最后一项开始。
- 每个选项使用 `role="radio"`、`aria-checked` 和选中项 roving tabindex；根节点为 `role="radiogroup"`，可通过 `ariaLabel` 命名；放在 `Field` 的组形态里时，根拿字段的 `id`，经 `aria-labelledby` 以字段标签为名、`aria-describedby` 接字段说明（docs/specs/ui/forms.md 输出 27）。不写 `aria-pressed`（它是切换按钮的状态，与单选的 `aria-checked` 冲突）。
- 只读（`readonly`）：根写 `aria-readonly`，选项照常可聚焦；点击不发出变化，方向键只把焦点移到相邻项、不改选中；悬停不变色、按下不缩。停用（`disabled`）：各项停用，不进 Tab 顺序（docs/specs/ui/forms.md 输出 28）。
- `title` 优先作为选项可访问名称和悬停提示，否则使用 `label`。选项本身的 `iconClass` 是装饰性图标，不进入可访问名称。

## 数据

```ts
export type SegmentedControlValue = string | number | boolean | null;
export type SegmentedControlSize = "xs" | "sm";

export type SegmentedControlOption = {
    /** 右侧计数；默认不显示 */
    count?: number | string;
    /** 是否禁用该选项；默认 false */
    disabled?: boolean;
    /** 装饰图标 class；默认不显示 */
    iconClass?: string;
    /** 可见标签；省略或空字符串时只显示图标，这时应给 title 作可访问名称 */
    label?: string;
    /** 透传到按钮的数据测试标识；默认 undefined */
    testId?: string;
    /** 原生 title 与可访问名称；默认回退到 label */
    title?: string;
    /** 选项值；必填，应唯一 */
    value: SegmentedControlValue;
};

type SegmentedControlProps = {
    /** 当前选中值；必填、受控 */
    modelValue: SegmentedControlValue;
    /** 选项；必填，顺序决定显示顺序 */
    options: SegmentedControlOption[];
    /** radio 组可访问名称；默认空字符串（空时不设置 aria-label） */
    ariaLabel?: string;
    /** 项目尺寸；默认 "sm" */
    size?: SegmentedControlSize;
    /** 是否允许选项换行；默认 false；为 true 时不显示滑动指示块 */
    wrap?: boolean;
    /** 是否占满父容器宽度；默认 false */
    fullWidth?: boolean;
    /** 整组停用；默认 false */
    disabled?: boolean;
    /** 只读：可聚焦、交互不改值；默认 false */
    readonly?: boolean;
    /** 出错：外框描红、写 aria-invalid，与 Field 上下文的出错取或；默认 false */
    invalid?: boolean;
    /** 必填：写 aria-required，与 Field 上下文的必填取或；默认 false */
    required?: boolean;
};

type SegmentedControlEmits = {
    /** 用户选择另一个启用项时发出其 value */
    (event: "update:modelValue", value: SegmentedControlValue): void;
};

type SegmentedControlSlots = {};
```

没有 slot 或 `expose` API。未声明的 attribute、`class` 与 `style` 按 Vue 默认行为落在根分组 `<div>` 上。选中状态严格使用 `option.value === modelValue` 比较；值应唯一，且需与支持的原始类型一致。

## 状态

- 默认：匹配 `modelValue` 的选项被标为选中并显示指示块；没有匹配项时不显示选中项或指示块。
- 禁用：单个禁用选项降低透明度并不可激活、不可由方向键选中。
- 空选项：不显示按钮或指示块，根组仍存在。
- 整组停用：整组降到 45% 透明度（同 `RadioGroup`），各项不可激活；各项不再各自变淡，选中块上的字仍读得出。
- 只读：外观与可编辑相同，只是悬停与按下没有反馈。
- 出错：外框用 `--status-danger` 描红。
- 加载：组件没有加载状态。

## 不支持

- 不支持多选、动态搜索、选项插槽或在组件内保存选择。
- 不支持在 `wrap` 模式下显示连续滑动指示块。
- `count` 仅展示为计数，不隐含数据过滤或状态语义。

## 已知偏差

- 按键后聚焦目标选项时，组件以 `String(option.value)` 查找 DOM 项；当启用项使用不同类型但字符串表示相同的值（例如 `1` 和 `"1"`）时，焦点可能落到另一项。避免在同一组内混用这种可碰撞的值。
