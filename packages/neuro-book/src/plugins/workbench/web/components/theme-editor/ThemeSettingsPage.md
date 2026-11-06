---
标签: [state:inject, env:portal]
别名: ["设置里的主题页", "Theme Settings Page"]
---

# ThemeSettingsPage

设置窗口左栏“主题”页（[`theme/editor.md`](../../../../../../../../docs/specs/theme/editor.md) 输出 1，入口之一）：主题编辑器的入口，加现在用的主题与我的主题列表。页面本身不改任何设置：换主题仍在“外观”里选。

## 布局

页面级操作在标题区右侧：“在浮动窗口中打开”“在页签中打开”（经 `SettingsPageActions`，层不能写时窗口整体停用）。正文三块：一句说明；“正在使用”（主题标题加一句“要换主题在外观里选”）；“我的主题”（每套一行，正在用的那套带“使用中”；没有时写一句引导）。

## 交互

两个按钮只发 `open`（`tab` 或 `floating`），由插件入口交给命令 `nbook.settings.open-theme-editor`、`nbook.settings.open-theme-editor-floating` 执行。

## 数据

```ts
type Props = {
    context?: unknown;                  // 设置窗口给的页面上下文，不用
    themes: ReadonlyArray<ThemeEntry>;  // 主题目录；我的主题是 plugin 为 USER_THEME_PLUGIN 的项
    currentId: string;                  // 现在生效的主题 id
};
type Emits = {open: [where: "tab" | "floating"]};
```

## 隐藏通道理由

- `state:inject`：经 `useWorkbenchText()` 与 `useText()` 取宿主注入的翻译端口，固定文字在 `nbook.workbench` 的 `themeEditor.entry.*`。
- `env:portal`：`SettingsPageActions` 的内容经传送门放进窗口标题区。
