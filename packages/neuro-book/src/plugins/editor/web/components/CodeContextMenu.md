---
验证入口: EditorGroup
标签: [state:local, env:clipboard]
---

# CodeContextMenu

源码编辑器正文的右键菜单（[`workbench/editor.md`](../../../../../../../docs/specs/workbench/editor.md) 输出 64）。不画触发器：自己在源码编辑器的容器上听右键与按键，用 nb-ui 的 [`ContextMenu`](../../../../../../nb-ui/src/components/popup/ContextMenu.md) 显示。只由 [`MonacoControl`](MonacoControl.md) 使用。

## 数据

```ts
type Props = {
    /** Monaco 的 API 与编辑器实例；还没加载完为 null。 */
    monaco: MonacoApi | null;
    editor: Monaco.editor.IStandaloneCodeEditor | null;
    /** 源码编辑器的容器：右键的监听挂在它上面（捕获阶段）。 */
    host: HTMLElement | null;
    readonly: boolean;
    /** 当前绑定的标识；换文件时变。 */
    binding: string | null;
    /** 控件此刻是否显示（标签被切走时为假）。 */
    visible: boolean;
};
```

菜单的文字、快捷键写法与贡献项经注入的 `editorMenusKey` 取；没有注入时（Lab 与组件测试里直接挂控件）不出菜单，右击是浏览器自己的，同 Markdown 控件。

## 行为

- **鼠标**：在容器上捕获 `contextmenu`，先于 Monaco 自己的处理。落在 Monaco 的浮层（查找框）上不拦；滚动条只拦掉浏览器的菜单；正文与行号区聚焦编辑器、点在全部选区之外时把光标移过去，再在指针处打开。
- **键盘**：`editor.onKeyDown` 里认菜单键与 Shift+F10，光标滚进可见区后在它的底边打开。不用 `editor.addCommand`：它的键位登记是整页一份，几个编辑器之间会串。
- **项**：内置项来自 [`code/context-menu.ts`](../code/context-menu.ts) 的表，打开时取一次状态；之后是位置 `editor.code-context` 的贡献项（只读时不显示）。
- **关闭**：选了一项或 Escape，焦点回编辑器；点外面不抢焦点；正文滚动、换绑定、控件不显示时关闭。
- 粘贴读不到剪贴板时经 `menus.notify` 在组顶部说明。
