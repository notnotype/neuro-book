# nb-ui 界面开发规范

适用于公共组件、主题、配色、样式基座与 playground。本文只规定工程合同：产品默认主题为什么这样设计，见 [设计语言](./design-language.md)；主题包格式、装载与市场边界，见 [主题作者规范](./authoring-themes.md)；单个组件的行为，见它的同名 `.md`。

规则变了就在改代码的同一次提交里改这里。一条规则只在一处写；具体数值只在 token、CSS、主题 `vars.css` 与同名 `.md` 里，本文写角色、判据与选型。

## 1. 事实源

| 事项 | 唯一事实源 |
| --- | --- |
| 配色变量名 | `src/colorway/colorway-contract.ts` 的 `nbColorwayVarKeys` |
| 设计与主题 token 名 | `src/theme/tokens.ts` |
| token 基线值 | `src/tokens.css` 的裸 `:root` |
| 公共控件与浮层外观 | `src/styles.css` |
| 样式入口与层序（`theme, base, components, utilities`） | `src/tailwind.css` 的头注释；宿主写法见 [`README.md`](../README.md) 的“宿主里的样式” |
| 组件导出 | `src/components/index.ts` |
| 组件的行为、布局与能力标签 | 同名 `.md`，写法见 [组件规范](../../../docs/standards/code/components.md) |
| 组件的类型合同 | 组件导出的 props/emits/types 与对应行为测试 |

同一规则只在表中指定的位置维护。README 只描述公开用法，playground 只提供可运行证据。

## 2. 材料、颜色与层级

1. 表面分**两条轴**，判据是这块面**压在什么上面**，不是它是哪个部件、也不是它装什么。
   - **材质轴**：直接压在窗体底纹上的那一层——顶栏、侧栏、面板、浮层。**一个页面只有这一层材质**，往上不再叠。**只有这一层开模糊**：嵌套 `backdrop-filter` 在规范里语义未定（w3c/fxtf-drafts#500 未解）、三家浏览器行为不一致、规范自述重绘开销每层翻倍，并且它会为 `position: fixed` 后代创建包含块。**只有这一层有不透明度下限**，因为只有它压在不可控的背景上。是玻璃还是实心由主题决定。
   - **层级轴**：从材质层往上叠的**不透明色阶**——面板里的表单、卡片、操作条、表头。**不开模糊，不定不透明度**（它压的是自己家的面，不存在可读性风险）。方向固定：**往上更亮**，明暗两态都是。「凹」是特例，只能用在层级 0 上。
   - **「不给面」不是第三种材质**，是「这块区域不该有容器」这个答案本身。展台、画布属于这一类：不承载长文、不叠任何面色，浮在它上面的盒子自带面、边与抬起。
   - 面板里再放一个面时，多数情况的正确答案是**不给面**（靠间距与分隔线成组），需要框住才层级 +1。**不要为它新开一档材质。**
   - **当前库里两条轴尚未落地**：现有 8 个表面变量仍按部件命名，`--toolbar-surface` / `--sidebar-surface` / `--overlay-surface` 属材质轴，`--panel-surface` / `--strip-surface` 属层级轴，nbook 把 `--strip-surface` 定成半透明是按新模型的一处错。目标形态、取值下限与迁移清单见 [表面模型提案](../../../docs/proposals/nb-ui-surface-model.md)（`accepted`）。**新写组件时按两条轴选角色，不要新增按部件命名的表面变量。**
2. 组件不得写字面颜色。颜色来自配色变量；形状、密度、装饰和角色映射来自主题 token。纯黑或纯白的低透明度光照层仅可在主题包内使用。
3. 组件不得直接引用某套主题私有变量。公共组件只消费配色合同、`nbDesignTokens`、`nbThemeTokens` 或 manifest 声明且具备 fallback 的变量。`Checkbox` 渐变中的 `#000000` 仅作为 `color-mix()` 的纯黑计算端点，不承担组件配色语义；静态规则只豁免这一文件中的这一字面值。
4. 只有 raised、popover、dialog 三档层级。阴影消费 `--elevation-*`；普通页面区块不以阴影代替结构。**这三档是阴影的档，与第 1 条层级轴的色阶各管各的**，不要互相推导——Material Design 3 曾把面色绑在 elevation 上，后来主动解绑（"not tied to elevation"）。
5. 浮层外框只用 CSS 类，组件不复制这些属性，见“浮层外框”。
6. 新公共 token 至少有两个独立消费点或明确的跨组件角色。单组件差异留在组件内部，第三方主题专用差异走 manifest `declares`。

### 2.1 叠放层级（z-index）

1. 数值只在 [`src/theme/z-index.ts`](../src/theme/z-index.ts) 登记，组件与宿主应用用 `:style` 绑定登记表里的值，不在原子类或 CSS 里写同一个数。固定定位或传送出去的整页浮层必须从登记表取；组件内部的局部叠放（不超过 50，例如 `z-10`）可以写字面量。nb-ui 的层级测试扫描组件与组合函数，出现大于 50 的字面量即失败；宿主应用的整页浮层同样从 `@notnotype/nb-ui/theme` 取，刻意压在一切之上的（例如离线横幅）保留字面量并就地注释为什么。
2. 各档从低到高：页面里的局部浮层（下拉、提示、拖放落点）、工作台拖影、浮动窗口各层、模态各层、模态里的浮层、通知、右键菜单、命令面板、组件 Lab 的检查框。新增一档时放进这个顺序，并补进层级测试的顺序断言。
3. 三条动态规则：
   - 浮动窗口按**嵌套深度**叠放：从窗口里开出的窗口压住外层，每层的局部浮层压住本层；
   - 同时打开的模态按**打开顺序**叠放，后打开的在上面，不靠 DOM 顺序（传送锚点在挂载时就定了，和打开顺序无关）；
   - 容器**向内容提供浮层层级**：对话框与浮动窗口经 `NB_POPOVER_Z_INDEX` 提供，内容里的浮层组件读这个注入，没有注入时回退到页面浮层档。新写的浮层组件必须读它（`usePopoverLayer` 或直接注入），否则放进对话框就被盖住。
4. 层级与遮罩只在产品页验收：组件 Lab 的画布本身是一个层叠上下文，会掩盖层级缺陷。

### 2.2 浮层外框

浮层的底色、模糊、描边、圆角与投影只来自 `src/styles.css` 的类，取值由主题决定（`--overlay-surface`、`--overlay-blur`、`--elevation-*`、`--radius-*`）。组件只绑层级、宽度与位置；`token-consumption.test.ts` 拦内联的模糊与面色。

| 浮层 | 类 | 要点 |
| --- | --- | --- |
| 小提示（`Tooltip`） | `.nb-ui-tooltip-surface` | 实心面板底，不用玻璃；无箭头，靠间隙与翻转表达关系；指针穿透 |
| 气泡（`Popover`） | `.nb-ui-popover-surface` | 大块玻璃面才另加 `.nb-ui-surface-rim` |
| 弹出列表（`DropdownMenu`、`Select`、`Menubar`、`ContextMenu`、`QuickPick`、`SuggestionMenu`） | `.nb-ui-popover-surface .nb-ui-menu-surface` | 圆角切到 `--radius-menu`，投影读 `--elevation-menu`（主题可单独收小），内边距 `--menu-pad`；其余见“弹出列表的共同合同” |
| 对话框（`Dialog`、`AlertDialog`） | `.nb-ui-dialog-surface` | 面读 `--dialog-surface`；小确认框加修饰类 `--compact`，叠在对话框上的加 `--nested` |
| 浮动窗口（`FloatingWindow`） | `.nb-ui-dialog-surface` 加 `--window` | 圆角取 `--radius-window`；常开、占大块屏幕的窗口与工作台部件卡片是同一类面，圆角取同一档 |

- 叠在另一个窗口上的浮层，圆角不大于底下窗口的圆角。
- 减少透明度与高对比度下，这些面回退实心面板底、关闭模糊，这条优先于主题。
- 内圈圆角由外框圆角减描边与内边距推出，公式包 `max(2px, …)`，负半径会让浏览器丢弃整条属性。
- 入场消费 `.nb-ui-popover-motion`，编排见设计语言“浮层入退场的编排是固定的”。


## 3. 几何、排版与动效

1. 单行字段默认消费 `.nb-ui-control-h-md` 与 `.nb-ui-control-px`；紧凑档消费 `sm`，大档消费 `lg`。组件模板不得重新写固定高度模拟同一档。
2. 控件、面板、菜单、胶囊分别消费 `--radius-control`、`--radius-panel`、`--radius-menu`、`--radius-pill`。浮层内角由 `.nb-ui-menu-item` 推导，不独立写 `rounded-*`。
3. 界面文字消费 `--font-ui` 与登记字号；长文内容消费 `--font-display` 和阅读刻度。`--text-2xs` 只用于计数、序号、时间戳和短角标。
4. 布局使用明确的 grid/flex 轨道、gap、min/max 与 overflow 所有权，状态变化不推动周围内容：
   - 动态文字、图标、加载态和计数不改变固定格式控件的外框尺寸。
   - 点击、激活、聚焦或悬停不改变控件自身或父容器的盒模型尺寸；边框高亮预留透明占位，或用 `outline`、`box-shadow`，不改 `border-width`。
   - 按压缩放只用 `transform: scale(...)`，缩放幅度由组件定；禁用态不缩放。滑块类指示物（`SegmentedControl`、`Switch`、`Slider`、`Progress`）用 `transform` 位移，不动 `left`、`top`。
   - 与弹性控件（`flex-1`）同行的动态读数或状态标签给固定宽度，不收缩，字符增减不牵动整行。
5. 同一个列表里的行与卡片等高（会话、文件、搜索结果、卡片网格这类由同一模板重复出的条目；弹出列表的选项见“弹出列表的共同合同”）：每个条目的行数与每行的高度固定，不随内容变。可选内容（说明、状态标记、提醒、标签）放进已有的行里，没有时那一行照样留着，不另起一行；文字单行截断，卡片可以固定 `line-clamp` 的行数并给出对应高度，全文靠悬停或打开详情看。只有条目本身就是可变长正文的列表（消息流、日志、Markdown 预览）与树里展开的子节点不受此限。
6. 390px 宽度必须无页面级横向溢出。窄屏可以重排工具面板，但不得隐藏完成核心操作所需的控件。
7. 动效只消费 `--motion-fast` / `--motion-base` / `--motion-enter` 与 `--ease-standard`；组件不得写死时长或缓动，不得使用 `transition-all`（属性列表写明）。浮层入退场编排与判据见 [设计语言](./design-language.md) 的动效节。

## 4. 组件合同

每个公共组件的行为写在同名 `.md`（写法见 [组件规范](../../../docs/standards/code/components.md)），类型与测试能读出下面这些：

- props：受控值、禁用/只读/必填/无效状态、语义尺寸和必要 HTML 属性；
- emits：值变化、提交、焦点或关闭原因等消费方可观察事件；
- slots：只开放稳定的内容插槽，不把内部 DOM 层级变成合同；
- a11y：角色、名称、状态、关联描述、键盘和焦点归还；
- 边界：空值、未知值、禁用项、最小/最大值、溢出与窄屏行为。

透传属性也是合同的一部分。各宿主的模板类型检查打开了 `checkUnknownProps`、`checkUnknownEvents`，用来拦写错或改过名的属性与事件；vue-tsc 认为组件只接受自己声明的属性，所以：

- 组件把调用方的 HTML 属性与原生事件透传到某个元素上时，在 `defineProps` 里用 `& /* @vue-ignore */ <该元素的属性类型>` 声明（例如 `ButtonHTMLAttributes`；只类型检查用，不变成运行时 prop）。组件自己发出的事件与原生事件同名时（例如 `scroll`），从声明里 `Omit` 掉它。
- ARIA 属性与 `role` 已在 `src/components/aria-attributes.ts` 里对所有组件放行，不用逐个声明。
- 传给 reka 等第三方组件、而它的类型没声明的原生事件、`id`、`title`，写进 `v-bind` 对象（`v-bind="{onKeydown: …}"`），与透传属性合并时用 `mergeProps`，保留两边的同名监听。

### 4.1 状态下限

所有可交互组件至少覆盖：默认、hover、focus-visible、active/selected、disabled。字段再覆盖 readonly、required、invalid、empty/placeholder；异步组件覆盖 loading、empty、error；浮层覆盖 open、close、outside interaction、Escape 与视口碰撞。

**页面级**加载态与失败态占满它们要交代的那块区域，并居中：

- 结构还不知道时不画骨架，占位形状会暗示一个还不知道的结构：一枚转动的指示加一句能独立成立的说明。结构已知时（书架的卡片格）可以用 `Skeleton`，它只是装饰（`aria-hidden`），读屏听那句说明。
- 失败是一屏内容（状态图标 + 原因 + 重试动作），不是一条会挤动布局的行内色块。
- 两者都要可播报：加载容器带 `aria-busy="true"` 与 `role="status"`（`aria-live="polite"`），
  文字必须独立成立（不能只有指示动画）；失败是一次性事件，带 `role="alert"`，重试入口保留可访问名称。
- 判据：不依赖颜色与动画也能读出「正在加载 / 加载失败」，且出现与消失都不推动周围内容。

字段级（控件内）的加载/失败仍按本节上文的零布局位移约束处理。

### 4.2 同类零件的分工

几个“从一组里选”的零件按用途分，不按长相分：

- `Tabs` 换去处：选中哪一项，下面就换成哪一块内容（设置的分页、面板里的几页）。
- `SegmentedControl` 换模式：内容还是同一份，换个看法（列表 / 网格、文本 / 树形）；当前状态不对应任何一项时可以一个都不选中（例如手动拖出的画布尺寸）。表单里三项以内、选项都没有说明且名字短的单选也用它（设置里的主题、明暗、语言），跟别的字段一起提交。
- `RadioGroup` 在表单里选一个值：选项带说明、名字长或要竖排时用它。
- `ToggleGroup` 是一组可以叠加的开关（粗体、斜体），可以同时按下几个，也可以都不按下；不做单选。
- `Select` 从一列值里选一个，收在下拉框里；`DropdownMenu` 点按钮弹出一列动作，选了就执行，不保留选中值。

### 4.3 取值词表与文案属性

同一个意思只有一个名字，组件之间不各写一套。共用的词表在 `src/components/shared-types.ts`，从 `./components` 导出；各组件声明自己能渲染的子集（`type InputSize = Extract<ControlSize, "sm" | "md">`），不渲染的档不进类型，也不留“有类型、没外观”的属性。

- **尺寸** `ControlSize = "2xs" | "xs" | "sm" | "md" | "lg"`。没有 `default`：缺省档就是 `md` 或组件说明里写的那一档。面板宽度（`DialogSize`）是另一套刻度，不用它。
- **语调** `Tone = "neutral" | "accent" | "info" | "success" | "warning" | "danger"`。不带语义的缺省档叫 `neutral`，不叫 `default`；出错与危险都叫 `danger`，不叫 `error`。运行状态（`CollapsibleRow` 的 `status: "error"`）不是语调，不用这套词。
- **方位** `Side = "top" | "right" | "bottom" | "left"`、`Align = "start" | "center" | "end"`；浮层的弹出位置叫 `side`，不叫 `placement`。组件有自己的选边算法时另起子类型（`SuggestionSide` 多一个 `auto`）。
- **方向** `Orientation = "horizontal" | "vertical"`。
- **文案属性**：按钮文字与读屏名称叫 `xxxLabel`（`confirmLabel`、`closeLabel`、`ariaLabel`），说明性文字叫 `xxxText`（`loadingText`、`emptyText`）。缺省值经翻译端口从 nb-ui 目录取（`src/locales/`），属性只用来覆盖；同一页可能有多个实例、需要各自名字的区域（例如 `Breadcrumb` 的导航区）才给覆盖属性。

### 4.4 浮层的打开与关闭

- **打开态**：一律 `open` 加 `update:open`。`Dialog`、`QuickPick`、`ContextMenu` 是受控的：`open` 必填，组件只发事件、自己不翻转，宿主不接 `update:open` 时浮层保持打开。`AlertDialog`、`Drawer`、`Popover`、`DropdownMenu` 另外支持带触发器的不受控用法。
- **事件**：`request-close(reason)` 是关闭请求，随后发 `update:open(false)`；打开态受控，宿主不接 `update:open`（或 `Dialog`、`FloatingWindow` 传 `:close-on-request="false"`）就等于拒绝，浮层保持打开；`closed` 在关闭完成、内容卸载并释放焦点之后发，宿主在它之后才执行命令或打开下一层，不用固定毫秒数代替。`AlertDialog`、`Drawer` 由 reka 直接关闭，不发请求。
- **关闭原因** `OverlayCloseReason`（`shared-types.ts`）：`escape`、`outside`、`close-button`、`cancel`、`select`、`tab`，各浮层只发自己有的那几种，保留各自的子集类型（`DialogCloseReason` 等）。“取消”与“关闭按钮”分开：宿主可能用取消按钮退回上一步、用关闭按钮关窗。
- **点外面关闭不回滚值**：回滚是 Escape 的语义，点外面只是不再编辑。
- **`Dialog` 关不关只看 `closeOnRequest`**（缺省 `true`），不看宿主挂了哪些监听；要拦（脏表单、守卫）就传 `false`，在 `request-close` 里自己决定。确认按钮只发 `confirm`，关不关由宿主决定。

### 4.5 弹出列表的共同合同

`DropdownMenu`、`Select`、`Menubar`、`ContextMenu`、`QuickPick`、`SuggestionMenu` 六个弹出列表共用下面这些；单个组件的 props、键盘与受控语义见各自的 `.md`。

- **外框**：见“浮层外框”。层级用 `usePopoverLayer`，在对话框里跟随它注入的层级。
- **行**：项是 `.nb-ui-menu-item`（行高 `--menu-item-h`、字号 `--menu-item-font`，与触发器尺寸无关）；几格（勾与图标共用的左列、名称、右侧次要文字或箭头、行尾附加物）由内部零件 `MenuRow` 画，新写的列表用它，不手写这组 `span`。
- **同一列表行高一致**：说明、分类、路径放进同一行右侧的次要文字，放不下时先截它；只有调用方明确要换行（`DropdownMenu` 的 `wrap`）的项由内容撑高。
- **勾与图标**：共用左侧一列，勾选的项画勾，其它项画图标；同一级有一项需要这一列，每行都留出，名称左边对齐。选中不改底色与字重。
- **高亮**：只认 `data-highlighted`，底色 `--overlay-item-active`，不写 `:hover` 底色，鼠标与键盘指向同一项。展开了子菜单的父项保持高亮。危险项（`.nb-ui-menu-item-danger`）只换文字与图标的颜色。
- **截断与滚动**：用 `usePopupScroll`。项超过 8 个时视口截在第 9 项的中点（按真实盒子量，分组标题、分隔线、换行项照实计入），否则取自然高度；外框按可用空间夹紧，视口是唯一能收缩的一块。未到底时顶底渐隐，告诉读者还有内容。滑块是内部零件 `PopupScrollbar`，只在可滚动时出现，视口右侧让出它的宽度。
- **级联**：右键菜单、按钮下拉菜单与窗口菜单栏共用级联几何（`utils/popup-geometry.ts`）与状态（`useMenuCascade`），行为见 `DropdownMenu.md`。
- **方向键漫游**：用 `utils/roving.ts`。

### 4.6 滚动条

| 容器 | 用什么 | 为什么 |
| --- | --- | --- |
| 弹出列表 | `PopupScrollbar`（见“弹出列表的共同合同”） | 原生滚动条在视口里，会被顶底渐隐的遮罩一起裁掉；reka 的 `SelectViewport` 也把它隐藏了 |
| 工作台视图（侧栏、右栏、面板里的视图） | `OverlayScrollbar` | 内容随展开收起频繁在溢出与不溢出之间切换；叠加不占宽度，没有跳变，也不空出一条槽位 |
| 需要自己建滚动容器、又要统一滑块的区域 | `ScrollArea` | 见它的 `.md` |
| 其它会溢出的容器 | 原生细滚动条（`.nb-ui-scrollbar-thin`，宿主挂在根元素上） | 零运行时开销，键盘与触控板行为照原生 |

原生滚动条的容器再按溢出状态分：

- 内容静态确定（固定设置表单）：`scrollbar-gutter: auto`，不溢出时不预留，两端对称。
- 内容会在溢出与不溢出之间切换（消息流、展开收起的面板、过滤中的列表）：`scrollbar-gutter: stable`（`.nb-ui-scrollbar-stable`），否则滚动条一出现可用宽度就跳；内容要居中对称时用 `.nb-ui-scrollbar-center`（`stable both-edges`）。不用 `overflow-y: scroll`，内容不足时会画一条空轨道。

其它约定：

- 库不给 `html` 写全局规则：整页会滚的宿主自己在根上挂 `.nb-ui-scrollbar-stable`，整页不滚、外壳铺满视口的宿主不挂，否则右缘多一条空带。
- 颜色只取 `--scrollbar-thumb-mix`、`--scrollbar-thumb-hover-mix`、`--scrollbar-thumb-active-mix`（`--text-main` 混进去的比例）。token 只存比例，颜色在用到的元素上现场混：存成混好的颜色时，`var()` 在 `:root` 上就代入了，套了另一套配色的子树会继承根上的颜色。要调全应用滚动条的观感，改这三个。
- `--scrollbar-w` 只是 `OverlayScrollbar` 滑块的粗细；`ScrollArea` 与 `PopupScrollbar` 不取它（后者有意更细，免得压住菜单项）。三个自绘滑块的几何共用 `src/utils/scrollbar-geometry.ts`。
- **单层滚动权**：滚动权归拥有完整视图高度的最外层容器；内部子组件与空状态不重复声明 `overflow-y: auto` 与 `h-full`，也不重复外层已有的内边距，滚动条贴着最外层面板的边缘。

## 5. 表单与无障碍

1. 字段组件接入 `Field` context：生成或接受 `id`，连接 `aria-describedby`，合并 `required`，错误时输出 `aria-invalid`。
2. 表单控件的共同合同（统一的属性、组合控件的名字、只读语义、单选的选型、可搜索的下拉）写在 [`docs/specs/ui/forms.md`](../../../docs/specs/ui/forms.md) 的输出 26 到 31。
3. nb-ui 持有的原生 input（公共组件内部 input 与 playground 自建控件）使用 `.nb-ui-native-input` 标记。`src/styles.css` 对 search decoration 和 number spinner 的抑制必须以该标记为作用域；未标记的宿主原生 input 保留浏览器默认伪元素。
4. 可见标签优先。图标按钮必须有非空 `aria-label`；tooltip 不能替代可访问名称。
   反过来也成立：**说明「这一页 / 这一节是什么、会写到哪里」的元信息不该单独占一行**——它走 tooltip 或标题旁的 info 图标，只有影响判断的正文才占行。区段标题下挂一句 20 字以上的灰色说明是最常见的违反形态。
5. 复合选择控件必须暴露正确角色和状态，并支持预期方向键、Home/End、Enter、Escape。关闭浮层后焦点回到触发器；点外面关闭除外，那时不抢焦点。
6. `prefers-reduced-motion` 与 `prefers-reduced-transparency` 的公共降级规则优先于主题。动效只解释出现、消失、位置或状态变化，不承担必要信息。
7. **校验结果不改变表单的排版**：出错时不在字段下插入文字，否则错误一多，表单每提交一次就换一次样子。
   - 能事先防住的不报错：必填项没填、格式不对时提交按钮不可用；长度靠输入上限，取值靠选择控件。
   - 提交之后才知道的错（服务端拒绝、选的文件不合规）：对应字段标红并得到焦点（`Field` 的 `error` 只标红、把原因交给读屏），看得见的原因写在一个固定位置。对话框里是页脚左侧的状态行（`Dialog` 的 `status`），一次只写一条。
   - 字段旁的计数、说明这类辅助信息也不占新行：计数贴在标签行右端，说明走标签旁的说明图标。

## 6. 测试与交付

行为测试只守可观察合同：值变化、边界、键盘、焦点、ARIA、打开后的 portal 内容、滚动和错误状态。不得以源代码字符串或无意义的 class 快照代替行为；外观来源和公共登记类可以用窄断言防止职责回流。

每批组件完成时：

1. 更新组件类型、所有本仓调用方和 barrel 导出；
2. 增加或更新覆盖新合同的 happy-dom 测试；
3. 在 Component Lab 登记并检查受影响的场景；
4. 同步 README 的公开用法、同名 `.md` 与本文；
5. 测试、类型检查按仓库 [验证门禁](../../../docs/testing/README.md#验证门禁) 与包级条件触发规则运行；
6. UI 行为与视觉验收按 [UI 验收分档](../../../docs/testing/README.md#ui-验收分档) 进行，共享基础组件验证四种主题 × 配色组合、一个主题都没装的状态及 390px，记录实测计算样式、键盘路径、控制台与页面错误；
7. 样式只改源码，不再有需要提交的 CSS 产物（宿主编译 nb-ui 源码，见 [`README.md`](../README.md) 的“宿主里的样式”）。

## 7. Component Lab

nb-ui 组件的场景登记在新应用的 Component Lab，行为合同见 [`ui/component-lab`](../../../docs/specs/ui/component-lab.md)，登记写法见 [`fixtures/README.md`](../../neuro-book/src/plugins/lab/web/fixtures/README.md)。需要真实指针与布局引擎的验收（嵌套分栏、多栏分割、勾选框聚焦时不滚动外层容器）在 playground 的 `/acceptance/<组件>` 页，由 `e2e/` 下的同名用例驱动。

- 一个场景表达组件的一种状态或输入组合，不在一个场景里平铺多套设计方案。
- 场景数据用与长篇写作相关的真实题材（作品、分卷章节、人物、设定条目），不用 `Foo`、`Test 1` 这类占位。
- 新增或修改组件后用 `bun run lab:shot`（在 `packages/neuro-book`）出截图与溢出报告。

## 8. 开发后自检与易错清单

只收真实踩过、自动化工具难以静态拦截的判据；能被测试拦下的不写。

- [ ] **键盘走得通**：焦点环可见，Tab 没有被拦截；
- [ ] **浮层高亮材质**：玻璃浮层（`.nb-ui-popover-surface`）内的项高亮消费 `--overlay-item-active`（半透明 tint），不使用实色 `--bg-hover`，避免在通透玻璃上产生实色色块（设计语言「五、颜色角色」）；
- [ ] **同心圆角防负值**：所有内圆角推导公式包裹 `max(2px, calc(...))`，防止负半径导致浏览器丢弃属性突变直角（设计语言「三、几何」）；
- [ ] **单层滚动权**：页面最外层容器持有滚动权，内部子组件不滥用 `overflow-y: auto` 产生双层嵌套滚动；动态流式列表声明 `scrollbar-gutter: stable` 防 1px 抖动（见“滚动条”）；
- [ ] **浮层关闭时序**：浮层关闭与状态交接依赖原语真实的 `closed` 事件或过渡钩子，不使用固定 `setTimeout` 毫秒数推断（设计语言“浮层入退场的编排是固定的”）；
- [ ] **去框化流式卡片（去三段式盒子）**：展示卡片与留痕面板严禁采用“独立背景横幅头 + 内容大框 + 底部提示横幅”的三段式机械堆叠；区段之间消费 `--divider` 发丝线或 `Separator`，标题与正文同字号（`--text-sm`）依靠字重和色阶区分，严禁大面积整卡漫铺刺眼警示黄底（设计语言「三、几何」「五、颜色角色」）；
- [ ] **Tab 滚动权按页隔离**：多 Tab 容器严禁由外层统一声明 `overflow-y: auto`；各 Tab 独立控制滚动，固定高度的 Tab 必须显式声明 `overflow-hidden`，防止微溢出触发误滚动；
- [ ] **工具卡片按真实形状画**：工具卡片的字段对照工具的真实 schema，不臆造字段；按数据形状区分开放式与选项式提问；
- [ ] **同类交互状态一致与外扩阴影防裁切**：自定义交互元素与基础控件表达同类状态（hover / focus / active / selected）时，复用同一基座类或状态 token，不手写近似的局部边框或阴影；外层带 `overflow` 裁切时，确认外扩阴影（如焦点光环）留有内边距冗余，不被容器边缘切边；填满所在条、四周没有余地的控件改用内嵌焦点线；只为动画裁切的容器只在动画进行中裁（见 design-language 坑 48），不用“内边距加等量负外边距”把裁切盒往外放（外框会比父容器宽，在可横向滚动的父容器里多出滚动距离）；工具条、表单行这类只有一行控件高的容器不设 `overflow: hidden`（不横向滚动靠换行与收缩），余量按主题 `--focus-ring` 的实色部分算（不偏移那几圈的扩散量，nbook、macos 是 3.5px；带偏移的模糊光切掉一截看不出，不算）；`lab:shot` 机检这一条（按样式表里的焦点规则找会画焦点环的元素，环画在外框上时按外框算；离裁切祖先的边比实色部分近就报）；
- [ ] **测量层的复本只复刻尺寸**：为了量宽度而放在不可见测量层里的复本（逐级让位、宽度适配用）不带 `role`、`id`，也不用被测试或样式引用的真元素类名（样式经测量层自己的类共用），否则文档里出现重复 `id`，按角色、类名或文字找真元素的地方会碰到复本；
- [ ] **改别的组件的颜色字号走它的覆盖点**：调整另一个包或宿主注入的组件的颜色、字号时，按它文档公开的覆盖点写在它的根元素上（透传的 `style` 或文档列出的变量），不靠外层继承：根上声明了同名属性时，继承进不去；
- [ ] **可点击卡片内嵌操作防按钮嵌套**：卡片同时具备“点击主区域选中/展开”与“行内局部操作按钮（`IconButton` / `Button`）”时，主触发区与操作按钮组并列为兄弟节点（或外层容器配键盘回车/空格监听），禁止在 `<button>` 内嵌套 `<button>`。
- [ ] **同行两段文字一段先收**：同一行两段文字要一段先收完、另一段再收时（例如说明先截断、标题后截断），先收的那段用 `flex: 1 1 0` 只占剩下的宽度；不要靠加大收缩系数：收缩按“系数乘基准宽度”分摊，另一段也会少一两个像素、平白出省略号；
- [ ] **同一列表的行等高**：列表或卡片的条目在缺少可选内容、文字很长、带状态标记或转圈时，高度与其它条目相同（见“几何、排版与动效”）；Lab 场景里放一条什么都没有的和一条什么都有的，在真实浏览器里比一遍同一列表各条目的高度；
- [ ] **包装组件转发外露方法**：包装别的组件的组件（提供注入、按需加载、加回退）要把外露方法转给里面的组件，否则调用方的模板引用停在外层、拿不到方法；Vue 只对 `defineAsyncComponent` 自动转发；
- [ ] **程序聚焦容器不滚动**：用程序把焦点放到一个可能比可见区域高的容器上（例如接住随列表卸载而丢掉的焦点）时，用 `focus({preventScroll: true})`；否则浏览器把容器顶边滚到最上面，它上方的标题与返回按钮被滚走。
