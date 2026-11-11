---
验证入口: EditorGroup
标签: [state:local, state:inject]
---

# MarkdownColorButton

文字颜色或高亮的拆分按钮（[`workbench/markdown-editing.md`](../../../../../../../../docs/specs/workbench/markdown-editing.md) 输出 1、6）：工具栏与选区菜单共用。

## 布局与交互

- 左半边是 26px 的图标按钮，图标底线上盖一条 3px 的色条，是上次用过的颜色（第一次是红色文字、黄色高亮）；点它直接用这个颜色。高亮的浅色在亮底上看不清，色条另描一圈很淡的边。
- 右半边是 14px 宽的小箭头，点了开色板：第一个是“默认”（去掉颜色），选中的是上次的颜色。选一个颜色执行并记住，选“默认”只去掉、不记。选了之后色板收起。
- 两半各有名称：左半边是动作名（“文字颜色”“高亮”），箭头是“选择文字颜色”“选择高亮颜色”。只读或动作不可用时两半都不可用。
- 总宽 40px，工具栏按 42px（连按钮间距）排版。

## 数据

```ts
type MarkdownColorButtonProps = {
    action: "text-color" | "highlight";
    editing: EditorEditing;
    menus: EditorMenus;
    readonly: boolean;
    /**
     * 放在选区菜单里；默认 false。为真时色板开着、焦点在色板上，选区菜单仍算“焦点在菜单里”而留着；工具栏里的不算，
     * 否则选区菜单留着会盖住工具栏打开的色板。
     */
    inSelectionMenu?: boolean;
};
```

没有事件、插槽与 expose：执行走 `menus.run`。

`state:inject`：上次用过的颜色（`markdownColorsKey`，`nbook.markdown` 的浏览器入口经组件包装交下来，背后是一条 user/local 记录，见 `web/colors.ts`）。颜色要跨作品、跨刷新记住，又要工具栏与选区菜单两处一致，由插件持有比逐层传属性直接。没有注入时（组件测试、Lab）只在内存里记。`state:local`：色板的开关。

## 不支持

自定义颜色：写进 Markdown 的是字面量，色板之外的颜色暂时只能改源码。只记上次的一个颜色，不记“最近用过”的几个。
