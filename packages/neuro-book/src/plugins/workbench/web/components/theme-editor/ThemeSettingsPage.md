---
标签: [state:inject]
别名: ["设置里的主题页", "Theme Settings Page"]
---

# ThemeSettingsPage

设置窗口左栏“主题”页（[`theme/editor.md`](../../../../../../../../docs/specs/theme/editor.md) 输出 1，入口之一）：主题编辑器的入口，加现在用的主题与我的主题列表。页面本身不改任何设置：换主题仍在“外观”里选。

## 布局

三块自上而下。入口卡片：左边一个图标块，右边“主题编辑器”标题、一句说明与两个按钮（“在页签中打开”主按钮、“在浮动窗口中打开”次按钮并排，放不下时换行）。“正在使用”：一张主题卡片加一句“要换主题在外观里选”。“我的主题”：卡片网格（每张最窄 168px，自动换行），没有时写一句引导。主题卡片：上面一块 72px 高的预览（那套主题当前明暗下的背景色、“Aa”用它的文字色、右下一个强调色圆点），下面是标题；正在使用的那套描边用强调色并在左上角贴一个“使用中”标签。预览色都由那套主题自己的取值给（行内样式），不取设置窗口的 token。

## 交互

两个按钮只发 `open`（`tab` 或 `floating`），由插件入口交给命令 `nbook.settings.open-theme-editor`、`nbook.settings.open-theme-editor-floating` 执行。

## 数据

```ts
type Props = {
    context?: unknown;                  // 设置窗口给的页面上下文，不用
    themes: ReadonlyArray<ThemeEntry>;  // 主题目录；我的主题是 plugin 为 USER_THEME_PLUGIN 的项
    currentId: string;                  // 现在生效的主题 id
    swatch: (entry: ThemeEntry) => ThemeSwatch;   // 一套主题在当前明暗下的背景、文字、强调色（`theme-swatch.ts`）
};
type Emits = {open: [where: "tab" | "floating"]};
```

## 隐藏通道理由

- `state:inject`：经 `useWorkbenchText()` 与 `useText()` 取宿主注入的翻译端口，固定文字在 `nbook.workbench` 的 `themeEditor.entry.*`。
