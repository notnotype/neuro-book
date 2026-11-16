---
标签: [state:local, state:inject, env:portal]
---

# DateInput

日期输入：值是 `YYYY-MM-DD` 字符串，可以直接在字段里打年、月、日，也可以点右边的日历按钮从月历里选。与 `Input` 同一套尺寸与外观（带框的字段，或放在已有外框里原地编辑的 `bare`），所以能和别的字段并排、也能放进卡片的一行里。

## 布局

一行：年、月、日三段（顺序与分隔符按界面语言，中文是“年/月/日”），右边一个日历按钮。没有值的段显示占位（`年`、`月`、`日` 或语言对应的写法）。宽度随内容，不撑满；放不下时整体不换行，由容器决定截不截。

日历浮层贴在字段下方（放不下时翻到上方），外框是公共的浮层外框（`.nb-ui-popover-surface`），宽约 15rem：顶上一行是上个月、年月标题、下个月，下面是星期行与日期格。选中的日子用强调色实底，今天带一圈细框，不在本月的日子淡出。周首日按界面语言（中文是周一）。

`390×844` 下结构不变；浮层按视口夹紧。

## 交互

- 字段里：点某一段或 Tab 进入，打数字填这一段（填满自动跳到下一段），上下方向键加减这一段，左右方向键在段之间走，退格清这一段。三段都有值时才算一个日期；清掉任何一段，值变成 `null`。
- 日历按钮（可访问名称 `openLabel`）打开浮层，焦点进到选中的那一天（没有值时是今天）。方向键在日期间走，PageUp、PageDown 换月，Enter 或空格选中并关闭浮层，焦点回到日历按钮；Esc 关闭，不改值；点外面关闭，不改值、不抢焦点。
- `readonly`：段可以聚焦与复制，不能改，日历按钮不出现。`disabled`：整体不可聚焦、降低不透明度。

## 数据

```ts
type DateInputSize = "sm" | "md";
type DateInputVariant = "default" | "bare";

type DateInputProps = {
    /** 受控值：`YYYY-MM-DD`，或 null 表示没有日期。不是合格日期的字符串按 null 显示，组件不改它，直到用户输入。 */
    modelValue?: string | null;
    /** 字段的 id；空时取 `Field` 上下文的 id。 */
    id?: string;
    /** 缺省 "md"。 */
    size?: DateInputSize;
    /** 缺省 "default"（带框的字段）；"bare" 没有外框与左右内边距，同 `Input`。 */
    variant?: DateInputVariant;
    disabled?: boolean;
    readonly?: boolean;
    /** 出错外观与 `aria-invalid`；与 `Field` 上下文取或。 */
    invalid?: boolean;
    required?: boolean;
    /** 日历按钮的名称；缺省“选择日期”，按显示语言覆盖。 */
    openLabel?: string;
};

type DateInputEmits = {
    /** 用户改了日期：填满三段、在日历里选中，或清掉一段（null）。 */
    (event: "update:modelValue", value: string | null): void;
};
```

没有插槽与 expose。`aria-*` 与 `role` 落在字段（`role="group"`）上，其余透传属性落在根上。

`state:local`：浮层开没开、日历显示的是哪个月。`state:inject`：经翻译端口取缺省文字与界面语言（月份写法、段的顺序、周首日）。`env:portal`：日历浮层渲染到 `body`（reka 的 Portal）；没有 `body` 的环境不支持。

## 上游边界

段的输入、日历的键盘与读屏来自 reka-ui 的 `DatePicker`；本组件承诺的是上面写的值、外观与关闭语义，段与日历的细节（例如段的读屏名称）随 reka-ui 升级可能变化。

## 不支持

日期时间（时、分）、日期范围、禁用某些日子、最早最晚日期。
