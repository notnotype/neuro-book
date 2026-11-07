---
标签: []
别名: ["设置提示块", "Settings Notice"]
---

# SettingsNotice

设置页一行里的问题提示：一个控件高的淡底描边块，图标加一句话。放在标题区、页面头部这种已有的一行里，不另占一行，所以有没有提示下面的内容位置都不变。设置窗口标题区的“设置文件格式有误”（[`SettingsSectionHeading`](../../plugins/settings/web/components/SettingsSectionHeading.md)）与 Profile 设置页的头部（[`ProfileDetail`](../../plugins/agent/web/components/ProfileDetail.md)）共用它。

## 布局

高度等于小号控件，文字单行，放不下时以省略号截断（父级给它留多宽由父级定）；图标不缩。色调决定描边、底色与图标的颜色。`action` 插槽接在文字后面，放“打开 →”这类小块。

## 交互

`as="button"` 时整块是按钮，有手形与焦点环，点击发 `click`；缺省 `as="p"` 是静态文字，`focusable` 让它能聚焦（好让包在外面的 `Tooltip` 用键盘也能打开）。

## 数据

```ts
type Props = {
    /** 缺省 "warning"。 */
    tone?: "warning" | "danger";
    /** 缺省 "p"。 */
    as?: "p" | "button";
    /** 缺省 false。 */
    focusable?: boolean;
};
type Emits = {(event: "click", value: MouseEvent): void};
```

插槽：默认是文字，`action` 是后面的小块。attrs 落在根上，`data-*`、`role` 由调用方写。

## 隐藏通道理由

无。
