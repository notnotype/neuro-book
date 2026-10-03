# EditorBreadcrumbs 规范与合同

`EditorBreadcrumbs` 是编辑器工作区顶部的紧凑路径与大纲导航面包屑，严格对齐 VS Code 面包屑交互规范。

## 职责边界

- **归属**：纯展示与受控导航零件（Presentation Component），消费当前文档路径或外部符号节点。
- **外观与微交互**：
  - 容器极窄高度 22px，底部分割线 `border-b border-[var(--divider)]`，背景色取 `--panel-surface`；
  - 路径按钮采用定高 18px（`h-[18px] px-1.5 rounded-[4px]`），在 22px 导航条中垂直居中并留有 2px 上下边距；
  - 悬停（Hover）背景使用 `var(--bg-hover)`，文字切换为 `var(--text-main)`，圆角 4px 保持标准 IDE 矩形风格，彻底避免微型胶囊形变。
- **窄屏与横向滚动策略**：
  - 各路径项 `<li>` 设置 `shrink-0`，确保长路径在容器宽度受限（如 390px 视口）时不会被压缩成几像素导致文本重叠；
  - 隐藏原生滚动条（`[scrollbar-width:none]` 与 `[&::-webkit-scrollbar]:hidden`），避免滚动条视觉侵入；
  - **鼠标滚轮横向滚动**：桌面环境下鼠标滚轮通常仅产生垂直增量（`deltaY`），组件通过 `@wheel` 拦截器将滚轮增量转换为横向 `scrollLeft` 偏移，实现平滑滚轮横移；
  - **自动暴露末尾激活项**：在挂载或路径/符号变化时，自动调用 `ensureActiveVisible()` 平滑或瞬时滚入末端项，避免进入深层路径时右侧被遮挡；
  - 每个路径节点提供截断最大宽度限制（`max-w-[160px] truncate`）；
  - 路径层级只在最后一级展示文件类型对应的主题语义图标，中间目录不展示文件夹图标以保持清爽。
- **数据与平台兼容性**：
  - 自动归一化 Windows 反斜杠（`\`）与连续斜杠，防止跨平台路径在 Windows 环境下被识别为单一片段；
  - 支持多级符号（如 Markdown 标题大纲），符号项作为末尾层级追加展示。
- **无障碍 (A11y)**：
  - 采用语义化 `<nav aria-label="文件路径大纲导航">` 与 `<ol>` / `<li>` 结构；
  - 末尾激活节点标记 `aria-current="location"`，前序目录项不标记；
  - 分隔符 `aria-hidden="true"` 避免读屏器冗余朗读；
  - 支持键盘方向键巡检：`ArrowRight`、`ArrowLeft` 顺序遍历焦点，`Home` 跳转首项，`End` 跳转末项。

## 属性 (Props)

| 名称 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `path` | `string` | `""` | 当前文件路径（如 `src/story/chapter-01.md`），用于自动拆分为层级节点 |
| `items` | `readonly BreadcrumbItem[]` | `undefined` | 外部直接提供的自定义节点（优先级高于自动解析） |
| `symbols` | `readonly {id: string; label: string; iconClass?: string}[]` | `[]` | 附加符号节点（例如 Markdown 标题大纲或代码符号） |
| `bordered` | `boolean` | `true` | 是否展示底部分割线（嵌入单行容器或已有外框时可设为 `false`，避免 2px 重叠加粗） |

## 事件 (Emits)

| 事件名 | 载荷 | 说明 |
|---|---|---|
| `navigate` | `item: BreadcrumbItem` | 点击面包屑节点触发导航跳转 |

## 插槽 (Slots)

| 插槽名 | 说明 |
|---|---|
| `trailing` | 面包屑右侧尾部插槽（如 VS Code 风格的编辑器类型切换按钮） |
