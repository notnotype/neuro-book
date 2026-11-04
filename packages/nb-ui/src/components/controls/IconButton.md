---
标签: []
---

# IconButton

`IconButton` 是只承载一个紧凑图标动作的按钮，适合工具栏、列表行和窗口 chrome。它与 `Button` 的区别是尺寸固定为正方形、默认不显示文字；组件会把 `ariaLabel` 优先作为可访问名称，没有时回退到 `title`。

## 布局

按钮是固定正方形的 inline-flex：`2xs` 为 14×14px（图标 12px，用在整行可点的标题行里当展开标记，离裁切边至少 4px），`xs` 为 24×24px（一行 32px 的头部里用，四周各留 4px，外扩焦点光晕不被头部所在的面板裁掉），`sm` 为 26×26px，`md` 为 32×32px，`lg` 为 38×38px。`xs` 和 `sm` 的圆角是 6px，`md` 是 8px，`lg` 是 10px，`2xs` 是 4px。边长不随主题的控件高度变：图标按钮多放在定宽的竖条与定高的工具条里（活动栏 48px 宽），所以 NeuroBook 主题下与同档的 Button 差 2 到 4px。图标和默认插槽内容在正方形内居中，不换行；按钮不会根据内容扩张。窄屏仍保持正方形，连续按钮应由父级安排间距，内容过多时由父级处理布局。

## 交互

- 点击按钮触发原生 `click`；组件本身不发业务事件。
- `variant` 提供 `default`、`danger`、`accent` 和 `secondary` 四种颜色层级：
  - `default` 常态透明、图标取次要文字色；悬停出现淡底、图标转 `--text-main`，按下底色再深。
  - `danger` 与 `accent` 常态透明，图标分别取 `--text-muted` 与 `--accent-text`；悬停出现对应状态色或强调色的淡底，图标转为该色，按下底色加深。
  - `secondary` 常态就有 `--text-main` 的淡色半透明底，悬停与按下依次加深。
- 按下时整体缩小到 0.93，`disabled` 时不缩放。
- `disabled` 为真时使用原生 disabled，不响应点击，并显示降低透明度的禁用态。
- 可通过鼠标或键盘 Tab 聚焦；原生按钮支持 Enter/Space 激活。组件挂载、卸载时不主动转移焦点。
- 焦点缺省画外扩光晕；`focusRing="inset"` 时画内嵌焦点线，给填满所在的条、四周没有余地的按钮用（光晕会被条裁掉）。
- `title` 同时提供浏览器悬停提示和在缺少 `ariaLabel` 时的可访问名称；明确的 `ariaLabel` 优先于 `title`。

## 数据

```ts
export type IconButtonVariant = "default" | "danger" | "accent" | "secondary";
export type IconButtonSize = "2xs" | "xs" | "sm" | "md" | "lg";
export type FocusRingStyle = "outer" | "inset";

type IconButtonProps = {
    /** 浏览器悬停提示；默认空字符串；也作为 aria-label 的回退 */
    title?: string;
    /** 可访问名称；默认空字符串；非空时优先于 title */
    ariaLabel?: string;
    /** 视觉变体；默认 "default" */
    variant?: IconButtonVariant;
    /** 正方形尺寸；默认 "md" */
    size?: IconButtonSize;
    /** 是否禁用；默认 false */
    disabled?: boolean;
    /** 由 nb-ui 图标系统消费的图标 class；默认空字符串 */
    iconClass?: string;
    /** 焦点画法；默认 "outer"（外扩光晕），"inset" 画内嵌焦点线 */
    focusRing?: FocusRingStyle;
};

type IconButtonEmits = {};

type IconButtonSlots = {
    /** 图标或其它按钮内容；可选 */
    default?: () => unknown;
};
```

没有声明 Vue emits，原生事件通过根 `<button type="button">` 使用。没有 `expose` API。未声明的 attribute、`class` 与 `style` 按 Vue 默认行为落到根按钮；唯一 slot 是默认插槽，没有具名扩展口。

## 状态

- 默认：图标居中，按 `variant` 显示颜色与悬停反馈。
- 禁用：不可操作、不可按下缩放，显示降低透明度。
- 只读、加载、出错、空数据：组件没有统一状态；没有内置 loading，业务状态由父组件控制内容或 disabled。

## 不支持

- 不支持自动生成图标或标签；`iconClass` 和默认插槽都为空时不会提供可见图标。纯图标使用必须保证 `ariaLabel` 或 `title` 至少有一个可读名称。
- 不支持 submit/reset 语义，根按钮始终是 `type="button"`。
- 不支持内置确认、请求或 tooltip 组件；title 只使用原生提示。
