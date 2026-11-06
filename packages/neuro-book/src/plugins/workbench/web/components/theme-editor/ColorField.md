---
标签: [state:local, state:inject, env:timer]
别名: ["配色项", "Color Field"]
验证入口: ThemeEditor
---

# ColorField

主题编辑器里一个配色变量的一行（[`theme/editor.md`](../../../../../../../../docs/specs/theme/editor.md) 输出 7、14）：变量名、色块（点开是浏览器的取色器）、色值输入、对比度比值，改过的项带一个小圆点和“还原为推导值”。

## 布局

一行六格：变量名（等宽小字、过长截断；主色行给 `label` 时改写正文字的名字）、24px 色块、色值输入（占余下的宽）、44px 的比值、12px 的手改标记、24px 的还原按钮。格宽固定，所以各行的色块与输入对得齐。取色器是盖在色块上的透明原生输入，只给不透明的 `#rrggbb`；半透明与编辑器不解析的写法（`color-mix()`、`hsl()`）色块照画、取色器不出现，改色值用输入。分区内容宽度不足 440px 时变量名单独占一行（查询量的是 `.theme-editor__section` 这个容器，不含导航），下面是色块、输入、比值、标记、还原，输入才放得下完整的色值。`plain` 的行（阴影、`--color-scheme`）没有色块。

## 交互

- 在输入里打字或在取色器里拖动：本地先显示，停手 250ms 后发一次 `change`，不会每个按键写一次记录（`env:timer`：这个防抖只能在组件里做，调用方不知道输入什么时候停）。
- 焦点离开这一行时立刻交出还在等的值，不等那 250ms：输入完马上点“推导整套”，推导读到的是刚输入的主色。
- 外面的值变了（别处改、换了主题）：输入跟着变，不留旧的本地值。
- 比值：有比值时按是否不低于 4.5 着成功色或危险色（危险色加粗），悬停提示写比值、是否低于 4.5、最差落在哪个底上；没有比值（写法不解析）显示 `–`，提示原因，不当作通过也不当作不合格。
- 点“还原为推导值”发 `reset`；只有 `touched` 且 `resettable` 时才有这个按钮。

## 数据

```ts
type Props = {
    name: string;          // CSS 变量名
    label?: string;        // 标题；省略时用变量名（等宽字），给了就用正文字并把变量名放进悬停提示
    value: string;
    check?: ContrastCheck | null;   // 来自 ui/theme/contrast-checks
    touched?: boolean;
    resettable?: boolean;
    plain?: boolean;
};
type Emits = {change: [value: string]; reset: []};
```

文字取自 `nbook.workbench` 的 `themeEditor.*`，经注入的翻译端口。
