---
标签: [env:global, env:portal]
别名: ["标题栏", "Title Bar"]
---

# WorkbenchTitleBar

工作台顶部 36px 的标题栏（[`ui/workbench-shell.md`](../../../../../../../docs/specs/ui/workbench-shell.md) 外壳四输出 28–31）：品牌、应用菜单、居中的命令搜索、项目切换、三个布局按钮与条目区。组件只呈现给定的菜单与条目、发出动作；菜单由能力模型（[`titlebar/menu-model.ts`](../titlebar/menu-model.ts)）生成，执行由外壳经命令服务完成。

## 布局

- 一行 36px，左右留 8px；面取 `--bg-panel`，底部分隔线取 `--divider`。左组是品牌与菜单，中间是搜索按钮（最宽 360px、居中），右组是项目切换、布局按钮与条目区。
- 宽度三档按根元素的实测宽度：
  - 至少 960px：完整菜单栏（nb-ui `Menubar`，`variant="flat"`）；
  - 600 到 959px：四组收进一个“菜单”按钮，点开按组分节（组名是不可选的一行），不嵌套；
  - 不足 600px：另外收起品牌文字，搜索只留图标，布局按钮不画（视图菜单里有对应的勾选项）。
- 菜单项禁用时以原因作提示（`title` 与 `aria-description`）；勾选项显示勾。
- 项目名过长时截断，提示里有全文。

## 交互

- Alt（单独按下再松开）或 F10：聚焦菜单入口（完整时是第一组，否则是“菜单”按钮），并记下之前的焦点；焦点在菜单入口上、菜单都关着时按 Escape，焦点回到之前的位置。
- 菜单里的键盘由 nb-ui `Menubar`、`Dropdown` 负责（上下键、Home、End、Enter、Escape）。
- 搜索按钮发 `search`；布局按钮发 `toggle-part`；项目切换在有项目时点开列出“打开项目…”，没有项目时直接发 `open-project`。

## 数据

```ts
type LayoutButton = {pressed: boolean; disabled: boolean};
type Props = {
    locale: DisplayLocale;
    /** 当前项目的显示名；没有绑定项目为 null。 */
    project: string | null;
    menus: MenuGroup[];
    /** 命令面板的快捷键，按平台写好；没有为 null。 */
    searchShortcut: string | null;
    layout: {sidebar: LayoutButton; panel: LayoutButton; auxiliarybar: LayoutButton};
    items: StripEntry[];
};
type Emits = {
    run: [command: string, args: Readonly<Record<string, unknown>>];
    search: [];
    "toggle-part": [part: "sidebar" | "panel" | "auxiliarybar"];
    "open-project": [];
    "run-item": [itemId: string];
};
```

## 隐藏通道理由

- `env:global`：Alt 与 F10 在窗口上监听：快捷键要在焦点在编辑器、侧栏等任何地方时都生效；组件卸载时摘下。
- `env:portal`：菜单与下拉经 nb-ui 的 Portal 渲染。
