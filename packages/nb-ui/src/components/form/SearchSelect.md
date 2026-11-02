---
标签: [state:local, state:inject, env:portal]
---

# SearchSelect

`SearchSelect` 是可以打字搜索的单值下拉：一个 `role="combobox"` 的输入框，下面挂 `SuggestionMenu` 的候选列表。输入的文字只是搜索词，只有选中一个选项才改值；不选就离开时，输入框恢复显示已选项的名字（[`docs/specs/ui/forms.md`](../../../../../docs/specs/ui/forms.md) 输出 30）。选项多（表单里多于 15 项，或写了 `searchable`）时用它，项少用 `Select`。

## 布局

外框与 `Input` 带前缀时相同：全宽、圆角、一档控件高，左边一个放大镜，右边一个下拉箭头（列表打开时转过来）。列表就是 `SuggestionMenu`：与外框同宽，弹出列表共用的一行（`.nb-ui-menu-item`），说明在右侧、放不下先截；下方空间不够时翻到上方，外框按可用高度收矮并滚动。`390×844` 下同样全宽，列表不超出视口。

## 交互

- 点击输入框（或外框上的放大镜、箭头）、按 ↓ 或 ↑ 打开列表，高亮落在已选项上（没有已选项时落在第一个可选项），输入框里已选项的名字全选，接着打的字替换它；再按外框一次关闭。按外框不让输入框失焦。打字时列表打开并按名称包含搜索词（不分大小写）筛选，高亮落在第一个可选项。列表里当前值的行尾有勾。
- 输入法组字中不筛选，Enter（上屏）与方向键（翻候选词）交给输入法；组字结束后按上屏的字筛选。
- ↑、↓ 在可选项之间移动高亮并循环，跳过停用项；Enter 选中高亮项；点击选项选中它。选中后列表关闭，输入框显示它的名字；选的就是当前值时不发出变化。
- Escape 关闭列表并丢掉搜索词（不冒泡到外面，不会顺带关掉所在的对话框）；失焦同样关闭并恢复显示。点选项不会先触发失焦：列表按下时不夺焦点。
- 焦点一直在输入框里，高亮项经 `aria-activedescendant` 交给读屏；列表的 id 是 `<控件 id>-listbox`，打开时写在 `aria-controls` 上。列表的名字：给了 `listLabel` 用它，否则 `aria-labelledby` 指向 `Field` 的标签。
- 只读：输入框可以聚焦、写 `aria-readonly`，打字、点击与方向键都不打开列表、不改值。停用：输入框停用，不可聚焦。

## 数据

```ts
type SearchSelectOption = {
    value: string;
    label: string;
    /** 右侧的一句说明。 */
    description?: string;
    iconClass?: string;
    disabled?: boolean;
};

type SearchSelectProps = {
    /** 当前值；缺省空串，显示占位文字。 */
    modelValue?: string;
    options: readonly SearchSelectOption[];
    /** 输入框的 id；缺省取 Field 上下文的 inputId，再缺省生成。 */
    id?: string;
    name?: string;
    placeholder?: string;
    /** 没有匹配的选项时列表里的一行字；缺省“没有匹配的选项”，按显示语言传入。 */
    emptyText?: string;
    /** 列表的可访问名称；缺省指向 Field 的标签。 */
    listLabel?: string;
    size?: "sm" | "md";
    disabled?: boolean;
    readonly?: boolean;
    /** 出错外观与 aria-invalid；与 Field 上下文的出错取或。 */
    invalid?: boolean;
    required?: boolean;
};

type SearchSelectEmits = {
    /** 选中一个选项时发出；只打字不发出。 */
    "update:modelValue": [value: string];
    focus: [event: FocusEvent];
};
```

没有插槽与 expose。`class`、`style` 落在外框，其余 attrs（`aria-label` 这类）落在输入框上。`name` 写在一个隐藏输入框上，提交的是值，不是输入框里的文字。放在 `Field` 里时读上下文的 `inputId`、`labelId`、`aria-describedby`、`required` 与 `invalid`。

## 状态

- **未选**：输入框空，显示占位文字。
- **已选**：显示已选项的名字。
- **搜索中**：显示搜索词，列表按它筛选；没有匹配时列表里只有 `emptyText` 一行。
- **出错**：外框标红，输入框写 `aria-invalid`。
- **只读、停用**：见“交互”。

## 不支持

- 多选、自由输入（打的字不能成为值）、异步加载选项、分组标题。
- 按拼音或说明搜索：只按名称包含。

## 上游边界

定位、传送与浮层层级来自 `SuggestionMenu`（底下是 reka 的 Popover 原语）；列表的行为与样子以它的文档为准。

## 隐藏通道理由

`state:local`：列表是否打开、搜索词与高亮项在组件内，卸载即丢。`state:inject`：读 `Field` 的上下文。`env:portal`：列表经 `SuggestionMenu` 传送到 `body`。

`state:inject`（翻译端口）：读宿主注入的翻译端口（`useUiText()`，`TEXT_PORT_KEY`）取列表无匹配时的缺省提示，语言跟着端口走，换语言不重新挂载；没有宿主注入时用 nb-ui 的缺省端口（`zh-CN`，自带目录 `@notnotype/nb-ui/locales`）。调用方显式传 `emptyText` 时以属性为准，不读端口。这类读屏名称与空态文案每个调用方都要有，逐处传属性不现实，所以由组件自己经端口取。
