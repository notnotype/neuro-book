# EditorTabItem 规范与合同

`EditorTabItem` 是编辑器标签栏中的单个标签项。

## 职责边界

- **归属**：纯展示与受控交互零件（Presentation Component），不直接操作 Store 或历史栈。
- **外观**：圆角药丸条目，高度 28px（固定标签 26px），条目自身带 1px 边框（激活/非激活都以边框占位，切换不产生像素跳动）；标题单行截断，激活态取 `--panel-surface`，非激活态透明底 + hover `--bg-hover`。
- **插入槽留白**：条目左右各6px外边距，相邻标签形成12px间隙；共享列表算法把2px插入线居中，两侧各5px。Editor传 `edgeGap:4`，首项前与末项后也留4px（空间不足时仍夹紧到可见盒）。间距在静止与拖动中一致，不插占位节点或临时挤开标签。
- **状态表达**：
  - **预览态 (Preview)**：斜体标题字体；
  - **Git 状态色**：未跟踪/新增 (`U`) 与脏状态使用 `--status-success`；已修改未提交 (`M`) 使用 `--status-warning`；
  - **脏标记 (Dirty)**：未保存状态默认展示圆点，hover 时平滑过渡为关闭叉号按钮；
  - **固定状态 (Pinned)**：图钉是标签选择按钮旁的独立取消固定按钮，20px命中盒、12px图标，hover有背景/颜色反馈、键盘focus有焦点环；不嵌套button，不属于拖动手柄。固定标签标题最大160px（普通240px）；固定分区不再铺灰色底块。
  - **路径缩写 (Description)**：支持展示消歧义的相对路径前缀（如 `...\doc-review`）。
- **无障碍**：`role="tab"`，支持 `aria-selected`、`aria-controls`、`tabindex`（基于 roving tabindex 管理），支持 `focus-visible` 键盘焦点环。
- **类型化句柄**：暴露 `EditorTabItemHandle`（含 `focus` 与 `getButtonElement`），杜绝父级 hack 探测 DOM。
- **不认识拖放**：条目**不画**落点反馈、不解析命中、不提交拖动、也**没有**原生 `draggable` 属性与 `DragEvent` 处理器。落点、预览与提交都属于宿主的编辑拖动会话（见下）。

## 属性 (Props)

| 名称 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `tab` | `EditorTabPresentation` | **必填** | 标签呈现数据模型（包含 path, title, pinned, preview, dirty, statusText, description 等） |
| `active` | `boolean` | `false` | 是否为当前激活选中的标签 |
| `focused` | `boolean` | `false` | 是否拥有 roving tabindex 焦点 |
| `pinned` | `boolean` | `false` | 是否处于固定标签组 |
| `groupId` | `string` | `undefined` | 所属编辑组，拖动源载荷的一半；缺席时不登记拖动源 |
| `tabId` | `string` | `undefined` | 供无障碍绑定的 DOM id |
| `ariaControls` | `string` | `undefined` | 对应面板的 DOM id (`aria-controls`) |

## 事件 (Emits)

| 事件名 | 载荷 | 说明 |
|---|---|---|
| `select` | `path: string` | 单击标签触发选中 |
| `close` | `path: string` | 点击关闭按钮关闭标签 |
| `keep` | `path: string` | 双击预览标签将其固化为正式标签 |
| `unpin` | `path: string` | 图钉点击或键盘激活请求取消固定，不顺带选择/关闭；宿主接受后焦点回到标签 |
| `contextmenu` | `event: MouseEvent` | 右键触发上下文菜单 |
| `keydown` | `event: KeyboardEvent` | 键盘漫游与快捷键传递 |

## 拖动源合同（dnd-kit）

- **只在会话里才是拖动源**：宿主提供了编辑拖动会话（`useEditorTabDrag()` 的 context，由 `EditorDragProvider` / `EditorWorkbench` 提供）且 `groupId` 有效时，条目用 `useDraggable` 登记自身为拖动源；没有会话时**不调用** `useDraggable`（脱离 Provider 调用会直接抛错），条目就是纯展示。
- **拖动面**：`element` 是整个条目（会话按它读拖动源的真实几何），`handle` 是 `role="tab"` 按钮——关闭按钮与脏标记区不在手柄里，并且显式带 `data-no-drag`，按住它们不会起拖。
- **载荷与身份**：`data` 只有 `{kind: 'editor-tab', groupId, path}`（`kind` 同时是拖动源 `type`，落点按它过滤）；拖动源 `id` 用 `useId()` 的实例级稳定键——**不用** `group + path` 拼 id，路径变化会在 dnd-kit 注册表里留下删不掉的死键。
- **激活门槛**：由会话的传感器提供（Provider 用 `editorDragSensors()` 建管理器：鼠标/笔按距离、触摸按延迟，`Ctrl+Space` 起键盘拖动）；条目不再逐源重复一份——`useDraggable` 的 `sensors` 只接数组形式，逐源再传与 Provider 的配置完全重复。
- **反馈**：保留原Tab的可见性、位置与尺寸，Provider用 `DropIndicatorLabel` 提供另一份Custom Drag Preview，不把它称为源快照或原生drag image。`DragOverlay`关闭落点动画，落点指示线由公共 `DropFeedbackOverlay` 画；没有隐藏源、占位副本或实时排序位移动画。条目本身不配置Feedback、不画指示线。
- **点击抑制**：拖动激活后抑制同一次手势末尾的 `click`（用 `@click.capture` + `@pointerdown.capture` 复位），松手落在标签上不会顺带把它选中。
- **DOM 标记**：条目带 `data-role="editor-tab-item"` 与 `data-editor-tab-path`，会话几何读取按它取真实条目，并排除 dnd-kit 打标记的反馈层/占位副本（`[data-dnd-dragging]` / `[data-dnd-placeholder]`）——只有真实条目参与几何求值。

## 动效与主题规范

- 过渡统一消费 `[transition-duration:var(--motion-fast)]`；
- 在 `prefers-reduced-motion: reduce` 环境下应用 `motion-reduce:transition-none`；
- 状态色彩严格消费主题语义变量（`--status-warning`, `--status-success` 等），在四套主题切换下均满足 WCAG 4.5:1 对比度要求。
