# nb-ui 场景迁移矩阵（t73 S2、S2b）

旧 playground Lab（`packages/nb-ui/playground/app/component-lab/registry.ts` 与 `fixtures/`）的 52 个组件，逐个对到新 Lab 的登记（`packages/neuro-book/src/plugins/lab/web/fixtures/nb-ui/`）。审查 P04 与 F03 要求：迁移不能为了过覆盖门禁丢掉旧场景的行为，丢掉的要写明原因。

## 换法

| 旧 | 新 |
|---|---|
| `scenes` 里的 `invalid`、`disabled` 标记 | 场景输入里的真实 prop。错误态由 `FormField` 的上下文提供（`aria-invalid` 与 `nb-ui-control-invalid` 各控件共用），在 `FormField/error` 场景观察，不再由 fixture 自己画红框 |
| `controls`（布尔、文本、选择） | 场景的 `input.props`，在数据页签里改 |
| fixture 自己维护的受控值 | `model` 层；组件发 `update:<键>` 时 Lab 回写并记进事件页签 |
| `events` 名单 | 事件声明（`events`）加上 `model` 层各键的 `update:<键>` |
| `targetSelector: "#nb-lab-target"` | 组件根上的 `data-lab-subject`；根是片段或传送门的不加（`Drawer` 用 `rootless`，`Dialog`、`ContextMenu` 手写 fixture 不加） |
| 一个场景里平铺多套设计方案 | 不迁。新 Lab 一个场景一个组件，设计实验不是组件合同 |

## 逐个组件

“新场景”一栏是新 Lab 的场景 id；“去向”只写与旧版不同或需要说明的地方。

| 组件 | 旧场景 | 新场景 | 去向 |
|---|---|---|---|
| FormInput | default, prefix, invalid, disabled | default, search, password, readonly, disabled, prefix | `prefix` 用插槽预设迁回。`invalid` 见上表“错误态”。事件补回 `focus` |
| FormNumberInput | default, bounded, invalid, disabled | default, small, disabled | `bounded` 并入 `default`（带 `min`、`max`、`step`） |
| FormSelect | default, rich, invalid, disabled | default, placeholder, up, disabled | `rich`（图标、说明、禁用项）并入 `default` 的选项。事件补回 `focus` |
| FormCheckbox | default, fallback, invalid, disabled | checked, unchecked, indeterminate, disabled, no-label | `fallback`（没有标签文字）迁为 `no-label`。事件补回 `focus` |
| TimePicker | default, invalid, disabled | default, range, invalid, disabled | `invalid` 是组件自己的 prop，保留 |
| Button | default, loading, disabled | primary, secondary, subtle, danger, ghost, loading, disabled, block | `click` 是原生事件，组件没有声明 `emits`，事件页签只记声明的事件，不迁 |
| IconButton | default, disabled | default, accent, danger, small, disabled | 同 Button，`click` 不迁 |
| SegmentedControl | default, disabled-item | default, counts, full-width, xs | `disabled-item` 并入 `counts`（“冲突”一项禁用） |
| SwitchField | default, disabled | default, long, disabled | — |
| Dropdown | default, submenu, checked, controlled-open | default, compact, long, disabled | `submenu`、`checked` 并入 `default`（子菜单里有单选组，另有复选项）；勾选状态是场景输入，选择后不自动翻转。`controlled-open` 由 `model.open` 承担 |
| Tabs | default | default, small, overflow | — |
| Badge | default, dot | soft, accent, outline, dot, count | — |
| Spinner | default, labeled | md, label, lg | — |
| Pagination | default, first, last | middle, first, few | `last` 换成 `few`（页数少、不出省略号），末页可在数据页签改 `page` |
| Slider | default, disabled | single, range, disabled | — |
| RadioGroup | default, disabled | vertical, horizontal, disabled | — |
| PinInput | default, disabled | default, masked, disabled | — |
| Calendar、RangeCalendar、DatePicker、DateRangePicker、DateField、TimeField、MonthPicker、YearPicker | default, disabled | default, en, readonly, disabled | 值是 `@internationalized/date` 对象，进不了 JSON 场景输入；场景从空值开始，选出的值记进事件页签 |
| ToggleGroup | default | single, multiple, labels, vertical | 旧 fixture 的 `update:formatting`、`update:alignment` 是它自己两组按钮的名字，组件事件是 `update:modelValue` |
| Switch | default, disabled | on, off, small, disabled | — |
| Toolbar | default | horizontal, vertical | — |
| Avatar | default | 无 | 文档标签含 `io:read`（加载图片地址），按挂载规则不可挂载，Lab 显示“只能在正式界面验证”。旧 Lab 不看标签 |
| Progress | default | accent, success, danger | — |
| Kbd | default | md, sm, lg | — |
| Breadcrumb | default | default, long | — |
| DropIndicator | area, entry, line, compact, long-label | area, entry, line | `compact`、`long-label` 是旧 fixture 自己的外框尺寸与标签文字；长标签由 `DropIndicatorLabel/long` 覆盖 |
| Splitter | default | horizontal, vertical, disabled | 事件补回 `gesture-start`；`gesture-update` 每次指针移动都发，会淹没事件页签，不记 |
| NestedGrid | default, unknown-ref, malformed, high-version | 无 | 组件已改名 `GridRenderer`，布局由宿主算出，文档标 `验证入口: WorkbenchShellLayout`。坏快照（未知引用、格式错误、版本过高）的恢复由 nb-ui 的 `grid.test.ts`、`grid-geometry.test.ts` 覆盖 |
| Accordion | default, disabled | single, multiple, disabled | — |
| ScrollArea | default | hover, always | — |
| DialogWindow | default, resizable | default, resizable, busy | 手写 fixture，记 `request-close`；`resizable` 的 `model` 补上 `height`，`update:height` 回到事件页签 |
| Drawer | default | right, bottom, left | — |
| Popover | default | default, open | — |
| AlertDialog | default | danger, warning | — |
| Menubar | default | default, medium | — |
| Editable | default, disabled | default, empty, auto-resize, readonly, disabled | — |
| Stepper | default | horizontal, vertical, disabled | — |
| Listbox | default, card, grouped, transfer, disabled | default, card, groups 等 | `transfer` 是旧 fixture 用两个列表拼出的穿梭框设计方案（“方案 4”），不是组件，不迁 |
| ColorPicker | default, disabled | default, small, readonly | — |
| Rating | default, disabled | default, half, readonly | — |
| NavigationMenu | default | horizontal, vertical | — |
| Tree | default, disabled | card, plain, disabled | — |
| Autocomplete | default, disabled | default, typed, disabled | — |
| CheckboxGroup | default, disabled | vertical, horizontal, disabled | — |
| QuickInput | default, empty, disabled, loading, long-list, dialog-stack | default, empty, loading, long-list | 改为手写 fixture。`disabled`（含禁用项）并入 `default`；`long-list` 迁回；`dialog-stack` 改为控制区按钮“在对话框上打开”，任何场景都能叠到对话框上 |

## 新增的组件

旧 Lab 没有、这次补了场景的 25 个：EmptyState、Skeleton、Table、FileTree、Dialog、ContextMenu、HoverCard、Tooltip、Notification、FormTextarea、FormField、Combobox、TagInput、TimePickerDefault、DateRangeField、MonthRangePicker、YearRangePicker、TimeRangeField、AspectRatio、Collapsible、CollapsibleSection、DropFeedbackOverlay、DropIndicatorLabel、Panel、Separator。

## 怎么证明挂得上

- 覆盖门禁 `fixtures/index.dom.test.ts`：每个可挂载组件至少一个非空场景，登记合法。
- `e2e/lab-scenes.e2e.ts`：在开发会话里逐个打开全部登记场景（手机画布），要求就绪、没有加载失败、页面错误与控制台警告。
- `lab:shot` 扫全部 nb-ui 组件的结果见 [`lab-shot.md`](lab-shot.md)。
