---
标签: []
---

# EditorToolbar

编辑器工作区顶部菜单工具栏组件：负责渲染“文件 / 打开方式 / 当前视图操作”等顶部菜单集合。

组件纯复用 `@notnotype/nb-ui` 的 `Menubar` 原语，消费主题角色变量：`--text-main`、`--text-muted`、`--border-color`、`--bg-panel`、`--divider`、`--radius-control`、`--radius-panel`。严禁硬编码颜色。

## 与外壳拓扑的关系

- **受控单向流动**：作为 `EditorWorkbench` 顶部工具区或 `EditorTabBar` `#trailing` 槽位的叶子部件；
- **非受控展开契约**：仅输入 `menus: MenubarMenuData[]`，只响应 `@select(item)`，绝不将叶子项的 `item.value` 反写覆盖 `modelValue`，由 Reka-UI 自主维护顶层菜单展开与切换；
- **自适应单根**：单根 `<nav class="editor-toolbar ...">`，自适应高度与紧凑内边距，保证在窄视口下不换行、不溢出。

## 数据与 API

```ts
type Props = {
    /** 菜单列表数据，包含子项、快捷键与图标 */
    menus?: MenubarMenuData[];
};

type Emits = {
    /** 当用户从任何层级选择可用叶子菜单项时触发 */
    (e: "select", item: MenubarItemData): void;
};
```

## 无障碍与交互契约

1. **语义化导航地标**：根元素使用 `<nav aria-label="Editor Workbench Menus">`；
2. **键盘导航全覆盖**：复用 Menubar 内置无障碍能力，支持左右方向键在菜单标题间移动，下方向键或 Enter/Space 展开下拉，上下方向键遍历菜单项，Escape 关闭菜单并归还焦点；
3. **安全禁用态与分割线**：带 `disabled: true` 或 `separator: true` 的项不可聚焦且不可点击；快捷键标签（如 Ctrl+S、Ctrl+W）纯文本展示在项右侧；
4. **叶子动作选择**：仅当用户激活有效叶子项时发出 `select(item)` 事件，外壳负责解析对应动作并派发至宿主，不直接污染菜单组件内部展开状态；
5. **复选/单选状态展示适配**：底层 `Menubar` 只渲染普通菜单项，不消费 `checked`，也不渲染任何勾选 ARIA，因此本组件在展示层补齐**可读**的勾选表达：
   - `checked: true` 项提供 `i-lucide-check` 勾选图标，并在文案后追加「已选」后缀，肉眼与读屏都能读出选中态；写一个模板根本不渲染的 `aria-checked` 只会制造虚假的无障碍声明；
   - `checked: false` 项提供同尺寸隐形占位图标（`invisible i-lucide-check`），保证同组文本对齐；
   - 选择叶子项时通过原始对象缓存恢复并完整发出原始 `MenubarItemData`（`value` / `shortcut` / `tone` 等字段一个不少），不回传被改写过的显示副本。

## Component Lab 验证

- 零件本身：`app/component-lab/fixtures/EditorToolbarFixture.vue` 摆四档——`default`（快捷键 / 分隔符 / 停用 / 危险项）、`checked`（可勾选项混排 + 整菜单停用）、`submenu`（子菜单递归勾选）、`empty`（空菜单数组）；页面上的读数显示最近回传叶项的 `value` / `label` / `checked` / `type`，用来确认回传的是原始叶项而不是显示副本。
- 联合场景：`app/component-lab/fixtures/EditorWorkbenchFixture.vue` 的 `keyboard-menu` 场景验证真实外壳下的键盘漫游与无障碍导航，以及带快捷键提示的叶子项（如 Ctrl+S 保存、Ctrl+W 关闭）能否正确触发。
