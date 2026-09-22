---
标签: []
---

# EditorToolbar

编辑器工作区顶部菜单工具栏组件：负责渲染“文件 / 打开方式 / 当前视图操作”等顶部菜单集合。

组件基于 `reka-ui` 原语与 `@notnotype/nb-ui` 浮层体系构建，纯消费主题角色变量：`--text-main`、`--text-muted`、`--border-color`、`--overlay-surface`、`--overlay-blur`、`--elevation-popover`、`--overlay-item-active`、`--divider`、`--radius-menu`。严禁硬编码颜色、阴影与模糊。

## 与外壳拓扑的关系

- **受控单向流动**：作为 `EditorWorkbench` 顶部工具区或 `EditorTabBar` `#trailing` 槽位的叶子部件；
- **非受控展开契约**：仅输入 `menus: MenubarMenuData[]`，只响应 `@select(item)`，由 Reka-UI 自主维护顶层菜单展开与切换；
- **自适应单根**：单根 `<nav class="editor-toolbar ...">`，自适应高度与紧凑内边距，保证在窄视口下不换行、不溢出。

## 数据与 API

```ts
type Props = {
    /** 菜单列表数据，包含子项、快捷键与图标 */
    menus?: MenubarMenuData[];
    /** 是否提供分屏入口 */
    allowSplit?: boolean;
    /** 自定义操作集合 */
    actions?: EditorToolbarAction[];
    /** 状态文本 */
    statusText?: string;
};

type Emits = {
    /** 当用户从任何层级选择可用叶子菜单项时触发 */
    (e: "select", item: MenubarItemData): void;
    (e: "split"): void;
    (e: "action", actionId: string): void;
};
```

## 浮层 Surface 与无障碍契约

1. **唯一 Surface 登记处接入**：
   - 浮层完全交由 `.nb-ui-popover-surface.nb-ui-menu-surface` 驱动，外圈圆角严格对齐 `--radius-menu`（12px）；
   - 绝不内联写死 `backgroundColor`、`backdropFilter` 或 `boxShadow`，材质完全由主题层控制（例如 nbook 主题的 Liquid Glass 与 Apple 5 层立体环境投影）；
   - 内部项挂载 `.nb-ui-popover-item`，圆角由外框半径与等宽内边距自动推导（同心律），悬停高亮消费 `--overlay-item-active`。
2. **语义化导航与键盘全覆盖**：
   - 根元素使用 `<nav aria-label="Editor Workbench Actions">`；
   - 支持上下方向键遍历菜单项，左右方向键进出二级子菜单，Enter/Space 触发激活，Escape 关闭并归还焦点；
3. **安全禁用态与分割线**：
   - 带 `disabled: true` 的项不可点击（`aria-disabled="true"`）；带 `separator: true` 的项渲染 1px 分割线；快捷键标签（如 Ctrl+S、Ctrl+W）使用等宽字体靠右对齐展示；
4. **叶子动作选择**：
   - 仅当用户激活有效叶子项时发出 `select(item)` 事件，携带完整原始数据；
5. **规范的 ARIA 复选/单选状态**：
   - 对于 `type === 'checkbox'` 或带有 `checked` 属性的项，采用 `DropdownMenuCheckboxItem`，由 Reka 原生输出 `role="menuitemcheckbox"` 与 `aria-checked="true" | "false"`；
   - 视觉上呈现清晰统一的左侧对勾 `i-lucide-check` 与等宽对齐占位；
   - 严禁在标题正文中拼接 `(已选中)` 之类的生硬后缀，保持 IDE 文本清爽优雅。

## Component Lab 验证

- 零件本身：`app/component-lab/fixtures/EditorToolbarFixture.vue` 提供不同场景验证；
- 联合场景：`app/component-lab/fixtures/EditorWorkbenchFixture.vue` 验证真实工作区中的分屏与菜单展开交互。

