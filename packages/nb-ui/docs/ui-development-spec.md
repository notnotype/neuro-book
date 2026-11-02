# nb-ui 界面开发规范

状态：当前规范（持续演进活文档）。适用于公共组件、主题、配色、样式基座与 playground。

**规范与代码持续同步演进准则**：
1. **活文档原则**：UI 规范与开发规范绝非一成不变的教条，而是在真实业务推演、交互调优、用户裁决与组件升级过程中**允许并鼓励持续修改与扩展**；
2. **第一现场同步更新**：在日常开发、审查与重构过程中，一旦探索出更佳的交互范式、新增了设计准则（如极简滚动条体系、Lab 测试台实底磨砂卡片规范、实体卡片多态等）或调整了设计参数，**必须第一时间就地同步更新本文及相关 UI 设计规范**，保持代码实现、测试用例与规范文档三者 100% 严谨对齐。

本文只规定工程合同。产品默认主题为什么这样设计，见 [设计语言](./design-language.md)；主题包格式、装载与市场边界，见 [主题作者规范](./authoring-themes.md)。

## 1. 事实源

| 事项 | 唯一事实源 |
| --- | --- |
| 配色变量名 | `src/colorway/colorway-contract.ts` 的 `nbColorwayVarKeys` |
| 设计与主题 token 名 | `src/theme/tokens.ts` |
| token 基线值 | `src/tokens.css` 的裸 `:root` |
| 公共控件与浮层外观 | `src/styles.css` |
| 样式入口与层序（`theme, base, components, utilities`） | `src/tailwind.css` 的头注释；宿主写法见 [`README.md`](../README.md#styles-in-the-host-app) |
| 组件导出 | `src/components/index.ts` |
| 主题可覆盖组件 | `src/theme/contracts.ts` |
| 组件交互合同 | 组件导出的 props/emits/types 与对应行为测试 |

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
5. 浮层使用 `.nb-ui-popover-surface`。菜单叠加 `.nb-ui-menu-surface`；大块玻璃面按设计语言要求显式叠加 `.nb-ui-surface-rim`。组件不得复制这些属性。
6. 新公共 token 至少有两个独立消费点或明确的跨组件角色。单组件差异留在组件内部，第三方主题专用差异走 manifest `declares`。

### 2.1 叠放层级（z-index）

1. 数值只在 [`src/theme/z-index.ts`](../src/theme/z-index.ts) 登记，组件与宿主应用用 `:style` 绑定登记表里的值，不在原子类或 CSS 里写同一个数。固定定位或传送出去的整页浮层必须从登记表取；组件内部的局部叠放（不超过 50，例如 `z-10`）可以写字面量。nb-ui 的层级测试扫描组件与组合函数，出现大于 50 的字面量即失败；宿主应用的整页浮层同样从 `@notnotype/nb-ui/theme` 取，刻意压在一切之上的（例如离线横幅）保留字面量并就地注释为什么。
2. 各档从低到高：页面里的局部浮层（下拉、提示、拖放落点）、工作台拖影、浮动窗口各层、模态各层、模态里的浮层、通知、右键菜单、命令面板、组件 Lab 的检查框。新增一档时放进这个顺序，并补进层级测试的顺序断言。
3. 三条动态规则：
   - 浮动窗口按**嵌套深度**叠放：从窗口里开出的窗口压住外层，每层的局部浮层压住本层；
   - 同时打开的模态按**打开顺序**叠放，后打开的在上面，不靠 DOM 顺序（传送锚点在挂载时就定了，和打开顺序无关）；
   - 容器**向内容提供浮层层级**：对话框与浮动窗口经 `NB_POPOVER_Z_INDEX` 提供，内容里的浮层组件读这个注入，没有注入时回退到页面浮层档。新写的浮层组件必须读它（`usePopoverLayer` 或直接注入），否则放进对话框就被盖住。
4. 层级与遮罩只在产品页验收：组件 Lab 的画布本身是一个层叠上下文，会掩盖层级缺陷。

## 3. 几何、排版与动效

1. 单行字段默认消费 `.nb-ui-control-h-md` 与 `.nb-ui-control-px`；紧凑档消费 `sm`，大档消费 `lg`。组件模板不得重新写固定高度模拟同一档。
2. 控件、面板、菜单、胶囊分别消费 `--radius-control`、`--radius-panel`、`--radius-menu`、`--radius-pill`。浮层内角由 `.nb-ui-menu-item` 推导，不独立写 `rounded-*`。
3. 界面文字消费 `--font-ui` 与登记字号；长文内容消费 `--font-display` 和阅读刻度。`--text-2xs` 只用于计数、序号、时间戳和短角标。
4. 布局使用明确的 grid/flex 轨道、gap、min/max 与 overflow 所有权。动态文字、图标、加载态和计数不得改变固定格式控件的外框尺寸。按钮与交互控件的点击、激活（active）、聚焦（focus）或悬停（hover）状态不得引起自身或父容器的盒模型尺寸（`offsetWidth` / `offsetHeight`）产生任何抖动或布局位移（Zero Layout Shift）。按压缩放动效仅允许通过 GPU 合成层（`transform: scale(...)`）进行内部视觉缩放，禁用态（disabled）严禁触发任何缩放动效；边框高亮必须预留透明占位或使用 `outline` / `box-shadow`，不得在 hover/active 时动态改变 `border-width` 挤压容器。与弹性拉伸控件（`flex-1`）同行的动态读数或状态标签，必须声明固定宽度与居中对齐（如 `w-16 shrink-0 justify-center`），杜绝因字符增减造成整行轨道的伸缩抖动。多 Tab 共享 Header 时，Tab 专属的过滤或搜索控件置于该 Tab 内部（如 sticky 吸顶），严禁在共享 Header 中按条件挂载改变 Header 高度。
5. 同一个列表里的行与卡片等高（会话、文件、搜索结果、卡片网格这类由同一模板重复出的条目；弹出列表的选项另见 4.2 节）：每个条目的行数与每行的高度固定，不随内容变。可选内容（说明、状态标记、提醒、标签）放进已有的行里，没有时那一行照样留着，不另起一行；文字单行截断，卡片可以固定 `line-clamp` 的行数并给出对应高度，全文靠悬停或打开详情看。只有条目本身就是可变长正文的列表（消息流、日志、Markdown 预览）与树里展开的子节点不受此限。
6. 390px 宽度必须无页面级横向溢出。窄屏可以重排工具面板，但不得隐藏完成核心操作所需的控件。
7. 动效只消费 `--motion-fast` / `--motion-base` / `--motion-enter` 与 `--ease-standard`；组件不得写死时长或缓动，不得使用 `transition-all`。浮层入退场编排与判据见 [设计语言](./design-language.md) 的动效节。

## 4. 组件合同与核心控件设计规范

每个公共组件必须有一份可从类型和测试读出的合同：

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

- 加载不画骨架——占位形状会暗示一个还不知道的结构；一枚转动的指示 + 一句能独立成立的说明即可。
- 失败是一屏内容（状态图标 + 原因 + 重试动作），不是一条会挤动布局的行内色块。
- 两者都要可播报：加载容器带 `aria-busy="true"` 与 `role="status"`（`aria-live="polite"`），
  文字必须独立成立（不能只有指示动画）；失败是一次性事件，带 `role="alert"`，重试入口保留可访问名称。
- 判据：不依赖颜色与动画也能读出「正在加载 / 加载失败」，且出现与消失都不推动周围内容。

字段级（控件内）的加载/失败仍按本节上文的零布局位移约束处理。

### 4.2 核心控件视觉、交互与动效规范清单

#### 1. `Button`（按钮 · 现代极简平滑 BH1-C 规范）
- **尺寸与圆角律动**：
  - 高度与字号取主题 token，与输入框等控件并排时等高、随主题的字号刻度变：
  - **紧凑档（`sm`）**：`--control-h-sm`、`--text-xs`，`px-2.5 rounded-[6px] gap-1`；
  - **标准档（`md`）**：`--control-h-md`、`--text-sm`，`px-3.5 rounded-[8px] gap-1.5`；
  - **大尺寸（`lg`）**：`--control-h-lg`、`--text-md`，`px-4.5 rounded-[10px] gap-2`；
  - 严禁对普通按钮强制夸张的最小宽度，让文字紧凑自然排布，告别过度拉伸的胖胶囊。
- **Primary（主要操作）**：`bg-[var(--accent-main)] text-[var(--text-inverse)]` + `0 1px 2px` 微底影；Hover 浓度加深并向外绽放 `0 2.5px 8px` 同色环境柔晕；Active 触觉回弹微缩放 `scale(0.975)`。
- **Secondary（次要操作）**：常态为纯净的 **`8%` 半透浅底**（`color-mix(in srgb, var(--text-main) 8%, transparent)`，去除非必要生硬边框与死白方块）；Hover 跃升至 **`18%` 饱满实底 + `0 2px 6px` 同色环境柔晕**；Active 坚实沉淀至 **`24%`** + `scale(0.975)`。
- **Danger / Subtle / Ghost**：Danger 绑定 `--status-danger` 与红色环境光晕；Subtle / Ghost 常态透明或 5% 浅底，Hover 优雅淡入 10%~14% 底板。
- **稳定性与禁用态**：固定 `border: 1px solid transparent; box-sizing: border-box;` 杜绝 1px 尺寸抖动；`disabled` 严格屏蔽所有 Hover 阴影与 Active 缩放；加载态（Loading）锁定安全内部尺寸，文案变动时零宽度跳变。

#### 2. `IconButton`（紧凑图标按钮 · 方案 2 规范）
- **尺寸与圆角**：`sm`（26px / 6px 圆角）、`md`（32px / 8px 圆角）、`lg`（38px / 10px 圆角），定值，不随主题的控件高度变（放在定宽的竖条与定高的工具条里，长高会被裁）。
- **Default（默认操作）**：常态纯镂空透明，图标为优雅次要文字色；Hover 底色浓度平滑跃升至 `15%` 饱满实底，图标转为深色；Active 加深至 `24%` 坚实沉淀底色 + `scale(0.93)` 触觉紧凑回弹。
- **Accent / Danger / Secondary**：Hover 浮现 `16%` 品牌色、危险色或 `18%` 次要底板，Active 加深至 `24%`。
- **稳定性**：盒模型尺寸 100% 绝对稳定，禁用态严格禁止任何缩放动效。

#### 3. `SegmentedControl`（分段控制器 · 方案 2-A 规范）
- **外槽与滑块**：`rounded-[var(--radius-control)]` 外槽 + `10%` 柔和半透底槽 + 1px 细微环境边框；选中滑块采用纯正品牌蓝（`var(--accent-main)`）+ 纯白反色文字 + `0 1.5px 4px` 柔和微底影。
- **智能分隔线**：相邻未选分段间带有 1px 竖向细线；当滑块滑动至某项时，该项两侧的分隔线**自动平滑隐去**。
- **动效**：消费 `var(--motion-base)`（300ms 舒缓物理阻尼曲线 `cubic-bezier(0.22, 1, 0.36, 1)`），连续平滑滑向目标项。
- **多选支持**：支持富文本样式（B/I/U/S）等独立多选组合，各激活项独立高亮。

#### 4. `Checkbox`（复选框与单选 · 实心超椭圆规范）
- **形态与圆角**：`20px × 20px`，`rounded-[8px]` 饱满超椭圆（Squircle）实心质感，无杂乱外边框。
- **未选中态**：`18%` 柔和半透深灰实心底座。
- **选中态（Checked）**：纯正 Apple 蓝底 + 加粗纯白 Apple SF Pro 矢量对勾 `[✓]`。
- **半选中态（Indeterminate）**：纯正 Apple 蓝底 + 居中纯白矢量横杠减号 `[-]`（原生支持树状子级联动）。
- **层级缩进**：树状子项支持 `32px` 显式绝对层级缩进。
- **单选按钮（Radio）**：圆形深灰实心底座，选中为蓝底 + 居中纯白小实心圆点。

#### 5. `Select`（下拉选择器与长列表规范）
- **浮层外框**：`.nb-ui-popover-surface .nb-ui-menu-surface`，内边距 `--menu-pad`（缺省 6px，nbook 4px），内圈圆角（`--nb-popover-inner-radius`）由外框圆角减描边与内边距推出；`:side-offset="7"` 避免遮挡 Trigger 聚焦发光圈；`@close-auto-focus` 消除二次弹回闪烁。材质（底色、模糊、投影、描边）只来自外框的两个类，组件只绑层级与宽度。
- **选项**：弹出列表共用的一行（`.nb-ui-menu-item`，行高 `--menu-item-h`、字号 `--menu-item-font`，与触发器的 `size` 无关）；`description` 放在同一行右侧的次要文字，所有项一样高；选中项在左侧一列画勾（替代它的图标），底色与字重不变。
- **截断与滚动**（`usePopupScroll`，六个弹出列表共用）：项超过 8 个时视口截在第 9 项的中点（按真实盒子量，分组标题、分隔线、换行项照实计入），不超过 8 个时取自然高度；外框按可用空间夹紧（`--reka-popper-available-height`），视口是唯一能收缩的一块；打开时停在选中项上。挂载与内容变化时即时重新测量，未到底时顶底 22px 渐隐（中点 8px 处 35% 透光消散）。
- **滚动条**：4px 悬浮胶囊滑块（内部零件 `PopupScrollbar`），只在可滚动时出现，视口右侧让出 6px；按住拖动（指针捕获、按 CSS 像素折算，Lab 画布缩放下也跟手）。

#### 6. `Input` & `NumberInput`（输入框规范）
- **状态准则**：常态与悬停态素雅不抖动（不主动改变边框颜色，仅依赖指针样式反馈），聚焦态统一点亮 Apple 原生 Focus 蓝光扩散光晕（`--focus-ring`）；控件填满所在的条、四周没有余地时（标签、状态栏条目、整行标题），改画内嵌焦点线（`.nb-ui-focus-ring-inset`，`Button`/`IconButton` 的 `focusRing="inset"`），同一焦点描边色。
- **数值微调**：步进按钮支持滚轮、键盘上下键与 clamp 边界保护。

#### 7. `DropdownMenu`（下拉菜单与动作浮层规范）
- **外框与层级**：`.nb-ui-popover-surface .nb-ui-menu-surface`，内边距 `--menu-pad`；层级由 `usePopoverLayer` 给（在 `Dialog` 里跟随它注入的层级）。组件里不写死圆角、面色、描边与内边距。
- **截断与滚动**：与 `Select` 同一份 `usePopupScroll`：项超过 8 个时视口截在第 9 项的中点（按真实盒子量，分组标题、分隔线、换行项照实计入），不超过 8 个时取自然高度；外框按可用空间夹紧（`--reka-popper-available-height`），视口是唯一能收缩的一块。级联子菜单的每一级（`MenuLevelPanel`）同样截断与滚动；某一级一滚动，它展开的更深层级收起，焦点在被收起的层级里时回到展开它的那一项。
- **菜单项与破坏性动作**：项是 `.nb-ui-menu-item`（`--menu-item-h`、`--menu-item-font`），高亮只认 `data-highlighted`，底色 `var(--overlay-item-active)`，不写 `:hover` 底色，鼠标与键盘指向同一项；reka 的项自己挂这个属性，手工级联与右键菜单的普通按钮项由 `MenuNodes` 在指针移动时聚焦、聚焦时挂上。展开了子菜单的父项保持高亮。勾与图标共用左侧一列（16px）：勾选的项画勾，其它项画图标；同一级有勾选项或有一项带图标时每行都留出这一列，名称左边对齐。勾选项与带图标的项通常不放在同一级。同一个列表里行高一致：说明、分类、路径都放进同一行右侧的次要文字（`__hint`，放不下时先截它），只有调用方明确要换行（DropdownMenu 的 `wrap`）的项由内容撑高。六个弹出列表都这样。行里的几格（勾与图标共用的左列、名称、右侧次要文字或箭头、行尾附加物）由内部零件 `MenuRow` 画，新写的弹出列表用它，不再手写这组 `span`；手工级联（展开、键盘、父级滚动收起、级联面板不算外部）用 `useMenuCascade`，方向键漫游用 `utils/roving.ts`。危险项（`tone: "danger"`）的 `.nb-ui-menu-item-danger` 只换文字与图标的颜色，高亮底色与其它项相同；分隔线 `.nb-ui-menu-separator`，分组标题 `.nb-ui-menu-label`。
- **菜单结构契约**：平面项、分隔线与任意层级子菜单（`children`：父项只展开、不执行 select；每一级都继续展开）。右键菜单、按钮下拉菜单和窗口菜单栏共用级联几何（`utils/popup-geometry.ts`）与级联状态（`useMenuCascade`）：第一项与父项同一行，两个面板之间留 6px 间隙，靠近视口边缘时翻到另一侧。子菜单默认不显示：悬停父项停满 300ms 才展开，左键点击或键盘进入则立即展开；已经展开后，同级切换不等待。每一级只保留一个面板：第一次展开用缩放淡入；之后在同级两个有子菜单的项之间切换时，这个面板移动并改变尺寸，内容快速淡入淡出；移到没有子菜单的项时立刻收起。入场和退场都取 `--motion-fast`。`type: "radio" | "checkbox"` 用对应原语渲染勾选态，`checked` 是**受控**值——组件只发 select，勾选永远由宿主改；radio 的同组互斥用 `group` 声明，同组连排合成一个 RadioGroup，缺 group 的贡献按单项独立成组并给开发诊断。
- **受控展开**：`open` 传入即受控（宿主不改就不变），不传则由原语自管；两种用法都会发 `update:open`，宿主据此在活动对象切换时关掉旧菜单。菜单关闭时清空已展开的子级，再次打开只显示第一级。触发按钮可以保留按下缩放；浮层按抵消缩放后的按钮外框定位，不跟着形变移动。
- **无障碍与焦点管理**：完整的键盘导航（ArrowDown/Up 循环、Home/End、Right/Left 进出子菜单、Enter/Space 选择、Tab/Esc 关闭），关闭后焦点由 Reka 原语归还给触发器；外部点击关闭时焦点随用户落点，不被抢回。

#### 8. `Badge`（状态徽章 · 方案 2-B 现代工作区超椭圆实心规范）
- **形态与圆角准则**：统一采用**现代超椭圆（Squircle，消费 `var(--radius-control)` / 紧凑档 `calc(var(--radius-control)-2px)`）**；用户明确裁决**后续所有相关组件统一继承这种饱满超椭圆形态**，与输入框、复选框、按钮的几何律动严格对齐。
- **实底饱满与反色文字**：`solid` 模式为纯正状态色实底 + 纯白反色文字（`var(--text-inverse)`，`font-semibold`）+ 16% 纯白微透光反光外边框 + `0 1px 2px` 轻微柔影。
- **温润深琥珀 Warning 调色**：告别高亮刺眼柠檬黄与黑字，Warning 状态统一采用**高级温润深琥珀暖金（`#B45309`）搭配纯白文字**，既保证高级警示层级，又维持沉浸典雅的视觉美感。
- **扩展能力**：原生支持 `dot`（带柔和发光的状态圆点）、`iconClass`（14px 纯白矢量微图标）与 `count`（内嵌半透徽标计数）。

#### 9. `Slider`（滑动条 · 现代触觉规范）
- **轨道与滑块**：胶囊圆角（`var(--radius-pill)`），轨道消费 12% 柔和底槽，激活范围条绑定品牌色（`var(--accent-main)`）。
- **滑块 Thumb**：面板底色 + 14% 环境微边框 + 双层轻微柔影；悬停轻微放大 `scale(1.1)`，按压缩放 `scale(0.95)`，禁用严格禁用缩放。
- **多维度支持**：支持单数值与范围双滑块、水平与垂直方向、`sm` / `md` / `lg` 尺寸。

#### 10. `Collapsible`（折叠规范）
- **折叠器（Collapsible）**：无侵入受控容器，原生支持 `data-[state=open]` 高度自适应动效（`--motion-base` + `--ease-standard`）。

#### 11. `Popover`（气泡规范）
- **材质基座**：消费统一的 `.nb-ui-popover-surface` 磨砂玻璃基底（75% 半透底色 + 12px~14px 模糊 + 130% 饱和度 + 1px 环境边框 + 立体柔影），禁用时 `close-auto-focus` 防止二次聚焦闪烁。

#### 12. `Splitter`（多栏可调节工作区规范）
- **双向分割**：支持水平（`horizontal`）与垂直（`vertical`）多栏分配；`Splitter` 内部不再使用 reka-ui 的分割原语，拖动、命中、键盘与收起全部走 nb-ui 自己的纯函数（`grid-geometry` / `sash-drag`）与 `useSashGesture` 输入层，`Enter` 折叠/恢复与拖动共用同一份收起策略。
- **受控尺寸**：几何只有 CSS px 一种口径。`Splitter` 的 `sizesPx` 是受控呈现（合计 = 面板空间，不含 sash），`panels` 用 `defaultSizePx` / `minSizePx` / `maxSizePx` / `sizing` / `collapse`；没有百分比往返，也没有 `autoSaveId`（原语不写存储）。等值发布被忽略，程序发布只改呈现、不产生用户提交。
- **sash 几何**：默认每条占主轴 1px；`sashSizes` 按边界提供实际像素。零值不占布局且不可交互，也不渲染装饰；非法值诊断后回退，主轴守恒不依赖 CSS 隐藏。设备像素对齐只作用在装饰层的内联几何上，**不移动 separator 的命中盒**，也不改子节点布局。常驻接缝厚度为 1 CSS px、近端边对齐设备像素；交互装饰带最多 3px，按相邻面板与 sash 可用空间夹紧，收起边界不因 overflow 裁窄。
- **拖拽触感**：静止态为常驻的 1px `--divider` 分界线，悬浮/拖动时在其上点亮品牌色指示带；命中边距 fine 5px / coarse 15px，且 hover、光标、按下与高亮读同一份命中结果——T/十字处两条线会一起点亮。相同命中 scope 连续停留约 250ms 后渐显，离开淡出；`prefers-reduced-motion: reduce` 保留延迟但取消中间渐变。
- **悬停线的样子归主题**：线芯的颜色、厚度、圆角与发光取 `--sash-line-color`、`--sash-line-size`、`--sash-line-radius`、`--sash-line-glow`，缺省是铺满装饰带的 3px 强调色实线；比装饰带细的线芯对齐静止接缝（近端边对齐设备像素），不在装饰带里居中。长轴两端：自由端按 `--sash-line-inset` 缩进，碰到另一条同时亮着的线的一端连着（T 形交汇时两条连成一体，只亮一条时两端都缩）。网格按树结构把每个分支的线两端挨着哪条外层边界传给 `Splitter`（`sashLineEnds`）。
- **手势边界**：一个公开 `NestedGrid` 独占一份会话，一次按下命中的最多两根轴（一根 width + 一根 height）属于同一场手势：`gesture-update` 携带预览布局让整棵子树按父盒实时变化，松手只发一次 `gesture-end(commit)`，`commit.changes` 里每项是该分支全部直接子节点沿主轴的 px（`baseline`/`target`/`active`/`compensated`/`collapsed`），宿主用 `grid.resizeBranches(changes)` 一次原子落账。独立 `Splitter` 仍用单分支 `SplitterGestureState`（`sizesPx` + `collapsed`）。
- **边界规则**：基线在用户开始时捕获，一次指针操作或一次键盘连发只结束一次；`keyup` 或失焦结束键盘手势；
-  `Escape`、`pointercancel`、窗口失焦、卸载与 panel 身份/约束/方向/禁用变化取消且不产生保存意图，并同时复位上游拖动状态；挂载、约束变化与视口重算仍只发 `layout`。
- **主动与补偿**：`active` 只含 sash 两侧相对基线实际改变的面板；相邻候选触界未变化时不冒充主动字段，被推着让出空间的远端兄弟记为 `compensated`。
- **收起与恢复**：指针按**按下基线 + 累计位移**的绝对边界求解，吸附只改约束、不用记忆尺寸重锚，展开跟随指针坐标——同一个鼠标位置永远对应同一个状态；低于 `minimum − 24` 吸附到 `collapsedSize`，回到 `max(minimum, collapsedSize + 24)` 且容量允许时展开。记忆尺寸只服务按钮 / `Enter` 的显式恢复（恢复空间不足时保持收起并给诊断）。会话提交的就是最后发布的那份几何，`finish` 不拿最后一次位移重解。

##### 拖放反馈：`DropFeedbackOverlay` / `DropIndicatorLabel`

- `DropFeedbackOverlay` 与 `DropIndicatorLabel` 从 `@notnotype/nb-ui/components` 导出；画区域、条目与插入线的 `DropIndicator`（`variant: "area" | "entry" | "line"` 和默认插槽，单根 div）是覆盖层的内部件，不导出。`DropIndicatorLabel` 接收 `label: string` / `iconClass?: string`，空白文案不渲染药丸；`DropFeedbackOverlay` 接收 `preview: DropFeedbackPreview | null` / `label` / 可选 `iconClass`，是自己 Teleport 到 body 的共享覆盖层。
- `DropIndicator` 与 `DropIndicatorLabel` 只渲染，不拥有手势、落点登记、业务状态或 Teleport；position、坐标、宽高与 z-index 由宿主提供。根均为 `aria-hidden`、不可选且不接管指针。
- `DropFeedbackPreview` 是宿主落点解析器给出的**语义命中几何**（viewport client 坐标）：`areaRect`（边缘插入带 / 中央整片叶 / 空容器整个内容盒）、`entryRect`（高亮条目）、`indicator`（插入线）、`orientation`（容器主轴）。覆盖层只画，不改写这份几何：内缩只进绘制盒，命中、序位与提交都用原始矩形。
- 覆盖层合同：`preview` 里一份有效几何都没有就不渲染；有有效 `areaRect` 时**不画插线**（区域已承诺落点，两条边叠起来会被读成两个落点），只有拿不出区域、只剩插入位的落点（列表插入位、原位锚点）才画线；中央保持布局的 `keep` 只给整片叶区域、没有锚点与插入线，调用方释放时也不提交。区域四边内缩 `min(6, 尺寸/4)`、插线只缩长轴 `min(2, 长轴/4)` 以保住窄/折叠目标的正面积。公共标记为 `data-drop-feedback` 与 `data-drop-feedback-area|-line|-entry|-label|-live`；attrs 透传到覆盖层根（`<Teleport>` 不会自动继承，组件内手动 `useAttrs`），落点种类、轴、并入数量一类业务语义由调用方写成 `data-*`。
- 提示药丸放在独立 fixed 包装里（不嵌进 2px 线或小条目盒，不被裁掉），有合法反馈且文案非空就显示：区域容得下「药丸 + 16px」时居中，否则贴锚点外侧并夹紧进视口 8px；只有插入线时宿主可给 `labelAt: "line-end"`，药丸贴在线的末端，用在线下方紧挨着一行标题的地方；提交后宿主可给 `settling: true` 的预览做收尾，区域滑到最终矩形再淡出，淡完（或减少动效、没有区域时立即）发 `settled`；尺寸由 `ResizeObserver` 缓存，坐标变化只重排不重读布局，反馈消失即断开观察。无障碍播报是独立的 `aria-live="polite"` 区域，只随文案变化更新，不逐像素播报。
- area/entry 使用 1px `--drop-area-border` 描边（缺省 accent 70%）、`--drop-area-fill` 底色（缺省 accent 12%）、`--radius-control` 与 `--elevation-raised`，深浅由主题定；原语只提供opacity过渡，区域几何过渡由共享覆盖层负责。line 使用实色 accent、`--radius-pill` 与4px accent光晕，无几何过渡；宿主保留2px实体厚度，不能与3px sash规则混用。
- 药丸使用6px图文间距、4px×12px内边距、14px图标、accent 40%描边、90% `--panel-surface` 底、`--accent-text`，字体与阴影/模糊均消费主题token。文字单行截断；减少透明或增强对比时改实色面板底并关闭模糊，减少动效时取消过渡。
- 几何入口在 `@notnotype/nb-ui/layout`：`resolveGridInsertion` 沿目标轴前/后 20% 返回插入位、`targetId`（命中叶）和 `halfRect`（该叶对应半区），中央 60% 返回 `keep`；是否呈现 keep 由宿主行为决定。叶间隙归后一叶，非末叶后缘仍归它自己。`resolveListInsertion` 给列表插入位，一位一线；前一项后半、间隙、后一项前半归同一位。内部线居中、追加锚末个可用成员后缘、空列表锚内容盒前缘。
- `resolveListInsertion` 可选 `edgeGap`（默认0）仅给首个可见成员前与末个可见成员后留白，内部间隙仍居中，空列表不偏移；空间不足时夹紧，负数/非有限退为0。Editor 标签带与 Workbench 容器切换器条目带都传4px（Editor 配合标签左右6px外边距、内部为5px/2px/5px；Workbench 条目相邻、只在首尾留白）；内容区的边缘插入带不消费它，默认几何不变。
- 区域及其居中提示首次出现按 `--motion-fast` / `--ease-standard` 淡入；连续换区保留同一节点，矩形的left/top/width/height与提示的left/top按 `--motion-base` / `--ease-standard` 过渡，文案立即更新，不重放淡入。过渡只影响fixed装饰盒，不改变命中、提交或正文布局；插线即时定位，取消立即卸载，无离场残留；reduced-motion取消动画和过渡。
- 几何与视觉分开：Editor 与 Workbench 的反馈均使用公共覆盖层的 fixed viewport 布局；不要另写业务私有区域框、线宽、提示标签或几何过渡。只需画一个静态的提示药丸时才直接用 `DropIndicatorLabel`。Component Lab 的 `DropIndicatorLabel` 与 `DropFeedbackOverlay` 场景提供对照，共享覆盖层按真实矩形落位。
- 新接入步骤：宿主先定义来源、目标与原子提交意图；dnd-kit 只管理输入和手势生命周期，纯解析器一次返回动作与预览，宿主只在释放时提交。列表用 `resolveListInsertion`，四边/中心用 `resolveGridEdgeDrop`；不要用默认 `useSortable` 的乐观 DOM 排序来替代“显示落点、释放提交”的合同。
- Editor 原位落点显示插入线、正文中央保留整区反馈，均以 `action:null` 表示释放不提交。Workbench 展开内容区传 `edgeRatio: 0.5`，前后各半都可提交，中点归后半；非法方向无反馈。全部可见成员收成细条时，剩余内容区作为一个落点，不拆细条。容器原位换序可以 `noop` 显示一条插入线，View 投 Switcher 则创建新容器。Workbench 边缘消费 `halfRect`，条目反馈只有线、没有额外高亮。
- 登记真实元素，统一使用可见 client 矩形并检查浮层遮挡；过滤拖动反馈与占位节点，不以它们作为排序成员。源码示例为主应用 `EditorDragProvider.vue` / `useEditorTabDrag.ts`；它复用工作台既有的 DOM reader 与输入门槛。需要稳定来源几何时使用 `DragOverlay`，不要误以为 `Feedback` 的 `clone` 模式会让原元素留在原位。
- 一场手势只发布一个落点、一份反馈。前一项后半、间隙、后一项前半必须归到同一个语义插入位与同一个线坐标。反馈不参与 flex 布局，不能挤开成员或改变命中。每个宿主明确自己的取消条件；停止、失焦、切换工作面、结构失效和卸载必须清帧、监听与观察器。
- 指针停住时滚动/尺寸变化仍需重算；正常释放按最终坐标再次验证且只提交最后已显示的同一动作，不允许失效锚点偷偷退化成末尾。外部文件/文本走原生数据交换；内部标签移动不能写 `text/plain` 把路径漏进正文。组件原语不拥有这些业务规则。

#### 13. `Drawer`、`Dialog` & `AlertDialog`（对话框、浮动窗口与反馈规范）
- **Drawer**：支持 `top` / `bottom` / `left` / `right` 四向滑出，背景采用 80% Scrim + 4px 模糊，右侧默认 380px 大纲与设定抽屉。
- **Dialog**：一个组件两种用法，外框只维护一份（组件文档 [`Dialog.md`](../src/components/feedback/Dialog.md)）。
  - **模态（缺省）**：遮罩、居中、焦点锁定、背景不可交互，关闭后焦点还给打开前的元素。点遮罩要按下与松开都在遮罩上；对话框里开着浮层时，这一下只关浮层。Escape 只关最上层，输入法组字时与内层控件已处理（`preventDefault`）的 Escape 不关。
  - **浮动窗口（`modal=false`）**：非模态语义，不渲染遮罩、不困住焦点、不锁定窗口外指针或背景滚动；窗口外页面必须继续可交互。标题区可拖动；`resizable` 默认关闭，开启后提供右、下两条边与四个角的手柄。鼠标在松开时提交 `update:width` / `update:height`，方向键按 10px、Shift 按 1px 调整，且不突破 `minWidth` / `minHeight`。
  - 标题、`header` slot 和无标题回退都必须生成对话框标题；关闭按钮必须有可访问名称。标题一律左对齐，不做居中变体；关闭按钮用 `sm` 尺寸贴右上、不贴圆角。遮罩、Escape、取消与关闭按钮一律经 `request-close`，由受控宿主决定最终关闭时机。
  - 默认 Portal 目标为 `body`。公共组件不得绑定产品私有主题宿主；产品消费者必须显式传入主题宿主目标，避免 Portal 脱离主题变量作用域。
  - 两种用法都向内容树提供局部浮层层级，里面的下拉、提示、取色面板显示在面板之上（规则见“叠放层级”）。
  - 窄屏宽度必须收敛到容器内，不产生页面级横向溢出；body 拥有长内容滚动权，footer 不随 body 滚动。
  - **内边距只有一层**：body 自带的内边距是对话框给的那一层；内容自带页面节律（导航轨 / 内容列各有自己的 `--space-*` 边距）时，宿主必须传 `body-class="!p-0"` 把这层交出去。两层叠起来会到 24–32px，读起来像内容被挤在中间。
- **AlertDialog**：居中破坏性二次确认模态窗，强制提供有明确意图的按钮出口（取消/确认），支持 `danger` / `warning` / `accent` 语调；受控模式可不提供 `trigger` slot，组件不得为无触发器实例渲染空的 `AlertDialogTrigger`。

#### 14. `Progress` & `Kbd`（数据反馈与微排版组件规范）
- **Progress**：全胶囊圆角，消费 `--motion-base` 平滑 `translateX` 进度位移，支持 4 种语义状态色。
- **Kbd**：等宽微浮雕物理键帽质感，`--control-outline` 边框 + 实体微底影，支持 `sm` / `md` / `lg` 三档字号与高宽排布。

#### 15. `ScrollArea` 与跨平台极简滚动条体系规范
- **必要性与设计定位**：在桌面优先的长篇写作软件与复杂工作区中，操作系统的原生滚动条（如 Windows 默认的 17px 灰白方块、部分 Linux 异构样式）会严重破坏磨砂玻璃质感、遮挡正文并挤压排版宽度。因此必须将滚动条纳入 UI 系统的核心规范。
- **纯 CSS 方案优先原则**：
  - 现代浏览器（Chromium 121+、Firefox、Safari）已全面原生支持 `scrollbar-width: thin` 与 `scrollbar-color` 标准属性；
  - 弃用沉重的 JavaScript 虚拟滑块与绝对定位 DOM 模拟，优先采用纯 CSS 声明式滚动（`.nb-ui-popover-scroll`），实现 0 运行时开销、丝滑的原生滚动惯性与全键盘/触控板原生兼容。
- **两类滚动条场景与 `scrollbar-gutter` 决策规约**：
  1. **场景 A：静态确定型元素（不会在「溢出」与「不溢出」状态之间频繁切换）**：
     - **典型代表**：下拉选择框浮层（`Select`）、菜单列表（`DropdownMenu` / `ContextMenu`）、固定设置表单等；
     - **处理原则**：遵循浏览器原生的 **`scrollbar-gutter: auto`**；
     - **设计考量**：这类容器在打开时选项数量是静态确定的（要么不足 5 项不溢出，要么超过截断高度溢出），且在交互期间不会动态追加或删除元素。未溢出时不预留槽位、保持内容两端绝对对称纯净；溢出时由原生细滚动条自然承载，避免盲目声明 `stable` 导致短列表单侧凭空悬空。
  2. **场景 B：动态切换型元素（会在「溢出」与「不溢出」状态之间频繁动态切换）**：
     - **典型代表**：Agent 对话消息流（`AgentChatFlow` 随着流式生成从短文本逐步增长）、动态展开/折叠面板、异步实时加载列表、搜索过滤实时列表等；
     - **抖动痛点**：若采用原生 `auto`，内容只要跨过 1px 临界阈值，滚动条就会突然冒出/消失，导致视口可用宽度瞬间跳跃（Layout Shift），引发面板和气泡宽度剧烈抖动；
     - **两种处理方式与选型决策**：
       - **方式 1：强制常显滚动条（`overflow-y: scroll`）**：在内容不足时也强制绘制禁用的空轨道。视觉体验生硬且破坏界面整体感，**通常不用此方案**；
       - **方式 2（首选推荐）：预留槽位防抖（`scrollbar-gutter: stable`）**：这是整个应用的推荐方案。库不给 `html` 写全局规则：整页会滚的宿主自己在根上挂 `.nb-ui-scrollbar-stable`（或写同一条声明），整页不滚、外壳铺满视口的宿主不挂，否则右缘会留一条空带。在内容尚未溢出时即提前预留出滚动条槽位，一旦内容溢出直接在槽位内绘制滑块，绝不挤占内容宽度，从根源消除跳变；
       - **居中对称变体（`scrollbar-gutter: stable both-edges`）**：若容器内有居中卡片、居中表单或需要绝对视觉对称的内容，使用 `stable both-edges`（工具类 `.nb-ui-scrollbar-center`），在双侧同时预留对称槽位，既防抖又维持居中重心。
  3. **场景 C：工作台视图（侧栏、右栏、面板里的视图，例如资源管理器的树）**：
     - **处理原则**：用叠加的悬停滚动条 `OverlayScrollbar`（2026-10-14 开发者按 VS Code 的做法定）：原生滚动条隐藏（`.nb-ui-scrollbar-none`），半透明滑块（宽 `--scrollbar-w`，缺省 6px）叠在内容上、不占宽度，鼠标在视图上、滚动中或拖动时显示，淡入 100ms，离开 500ms 后 800ms 淡出；
     - **设计考量**：视图常驻屏幕、内容随展开收起频繁在溢出与不溢出之间切换。叠加不占宽度，既没有跳变，也不像 `stable` 那样一直空出一条槽位；不看时整块安静。行的悬停与选中底色延伸到滑块下面，滑块盖在上面。
     - 编辑器正文、弹出列表与设置窗口不在此列，仍按场景 A、B。
- **滚动条的颜色与粗细只取 token**（`src/tokens.css`，2026-10-21 w00030 t02 统一）：
  - `--scrollbar-thumb-mix`、`--scrollbar-thumb-hover-mix`、`--scrollbar-thumb-active-mix` 是滑块常态、悬停与拖动时 `--text-main` 混进去的比例（32%、45%、55%，其余透明），随明暗换。token 只存比例，颜色在用到的元素上现场混：存成混好的颜色的话，`var()` 在 `:root` 上就代入了，套了另一套配色的子树会继承根上的颜色。取值照应用主滚动条 `OverlayScrollbar` 原来的，它占的面积最大，别处向它看齐。`OverlayScrollbar`、`ScrollArea`、`PopupScrollbar` 三个自绘滚动条都取这三个，组件里不再写自己的比例；要调整全应用滚动条的观感，改这里。
  - `--scrollbar-w`（缺省 6px）只是 `OverlayScrollbar` 滑块的粗细（轨道宽是它加 4px）。`ScrollArea` 的轨道尺寸写死；`PopupScrollbar` 有意只有 4px，免得压住弹出列表里的菜单项，两者不取它。
  - 三个自绘滑块的几何（位置、最短 20px、拖动换算）共用 `src/utils/scrollbar-geometry.ts`，不各写一份。
  - 原生细滚动条用 `.nb-ui-scrollbar-thin`（`src/styles.css`）：宿主在根元素（`<html>`）上挂这个类，整个应用的原生滚动条按 `--scrollbar-thumb-mix` 混出滑块色，悬停所在容器时按 `--scrollbar-thumb-hover-mix`（原生没有“悬停在滑块上”的选择器，`-active-mix` 只给自绘滑块用）。不必再各抄一段 `* { scrollbar-width: thin; … }`。这条规则的选择器全部在 `:where()` 里，特异性为 0，元素自己的 `.nb-ui-scrollbar-none`、原子类和组件的 scoped 样式都盖得过它。`scrollbar-width` 不继承，所以规则连后代一起写。
- **单层滚动权与外框贴边原则（Single Scroll Responsibility）**：
  - 滚动权归拥有完整视图高度的最外层容器所有，内部子组件与空状态（如 `AgentChatEmptyState`）严禁重复声明 `overflow-y: auto` 与 `h-full`，杜绝产生双层嵌套滚动与陷在内部的孤立滚动条；
  - 内部子组件不堆叠外层宿主已有的内边距（例如宿主已有 `p-4`，内部通过 `w-full my-auto` 自适应居中与延展），保证滚动条始终完整贴合最外层物理面板边缘。
- **Select 与 DropdownMenu 双向虚化与 macOS 悬浮滑块体系**：
  - 下拉弹出层明确声明 `:body-lock="false"`，杜绝打开下拉组件时锁死页面滚动条导致的全局布局跳跃；
  - **为何不用纯 CSS 原生滚动**：
    1. Reka UI 的 `SelectViewport` 原语刻意在内部注入了 `scrollbar-width: none`，原生滚动条在各浏览器被强行隐匿；
    2. 视口底部的“半截 item 虚化线索”依赖 `mask-image` 遮罩，原生滚动条位于 Viewport 盒模型内部，会被 mask-image 一并截断模糊吞噬，导致滚动条消失或残缺；
  - **两大法宝协同架构**：
    1. **后续虚化的半个 item（动态双向透光渐隐）**：视口通过 `usePopupScroll` 挂载即时感知尺寸。当内容未触底时，自动应用 22px 散焦遮罩（`nb-ui-popover-scroll-fade-bottom`，中点 8px 处 35% 透光消散），使得黄金截断露出的半个 item 产生柔润平滑的 Alpha 透光虚化，传递强烈的“下方还有内容”线索；滚到底部时虚化自动消除；
    2. **100% 绝对可见 macOS 4px 悬浮微胶囊滑块**：独立绝对定位在 `SelectContent` 表面（Viewport 外侧），完全避开渐隐遮罩裁切，不受底层原语影响；常态半透明、悬停加深、支持鼠标按住 1:1 拖拽；
    3. **内容避让**：视口在内容溢出时自动分配 6px 避让槽（`pr-1.5`），杜绝滑块与选项高亮底色或选中对勾图标重合。

#### 16. 浮层体系分级架构（Surface Tier Architecture）与黄金基座规范

全库浮层彻底告别分散硬编码，统一划分为 4 档标准分层模型（Tier 1 ~ Tier 4），由全局基座与专用 Composables 严格约束：

- **Tier 1: 紧凑说明浮层（Tooltip · 气泡说明）**：
  - **材质策略**：专用于极简说明性紧凑气泡，明确**不采用**半透明玻璃（杜绝浅色背景或文字下发灰浑浊），统一采用**实心面板底（`var(--bg-panel)`）** 与 **正文主字色（`var(--text-main)`）**；
  - **几何与尺寸**：消费控件圆角（`var(--radius-control)`）超椭圆胶囊，字号 12px，内边距 `5px 9px`，`:side-offset="6"`；
  - **无尖角原则（No-Arrow Principle）**：不使用 SVG/伪元素三角形尖角，依靠间隙与 Reka Popper 翻转表达空间关系；
  - **A11y 与交互**：配置 `pointer-events: none` 穿透，严禁与浏览器原生 `title` 双重冒出。

- **Tier 2: 交互菜单与下拉选择（DropdownMenu / Select / Menubar · 黄金标准）**：
  - **单一真相源**：所有弹出列表（`DropdownMenu`、`Select`、`Menubar`、`ContextMenu`、`QuickPick`、`SuggestionMenu`）的外框用 `.nb-ui-popover-surface .nb-ui-menu-surface`，项用 `.nb-ui-menu-item`，滚动用 `usePopupScroll`，严禁在组件内写死圆角、面色、模糊、投影或内边距；
  - **同心几何律（Concentric Geometry）**：项的圆角 = 外框圆角（`--radius-menu`）− 描边 − 内边距（`--menu-pad`）。nbook：10 − 1 − 4 = **5px**；macOS：12 − 1 − 6 = **5px**；
  - **截断视口**：项超过 8 个时视口截在第 9 项的中点（按真实盒子量，分组标题、分隔线、换行项照实计入），不超过 8 个时取自然高度；外框按可用空间夹紧（`--reka-popper-available-height`），视口是唯一能收缩的一块；
  - **双向虚化遮罩与 macOS 极简悬浮滑块**：
    - 视口自带 22px 光学散焦双向遮罩（`nb-ui-popover-scroll-fade-*`，中点 8px 处 35% 透光消散），未到底时呈现后续半项透光虚化，滑到底部虚化平滑撤销；
    - 4px 悬浮微胶囊滑块（`PopupScrollbar`）独立绝对定位在外层，常态半透明、悬停加深，按住拖动，内容溢出时出现，视口右侧让出 6px。

- **Tier 2.5: 宽大上下文面板（Large Context Popover · 宽 ≥ 480px）**：
  - **阴影轻量化**：禁止机械套用小浮层的高浓度深散焦阴影，应收敛黑度至 18% 以内并清除子卡片嵌套阴影；
  - **基准对齐与呼吸感**：与宿主保持 ≥ 12px 间隙；从带 padding 的容器弹出时，使用负边距抵消内边距，使浮层与宿主外边框在垂直线上严格平齐。

- **Tier 3: 悬浮命令面板与快速输入（QuickPick / WorkbenchCommandPalette · 全局输入）**：
  - **几何重构**：外框圆角明确锁定为 **14px**（`--nb-popover-radius: 14px`），彻底移除对 20px 巨角 `--radius-panel` 的盲目继承；与内部 8px 输入框（`rounded-lg`）达成黄金同心比例；
  - **纯净现代通透质感**：直接消费全局 `.nb-ui-popover-surface`，彻底清除顶部生硬塑料白光条（消除日光灯管反光），在 640px 宽度上呈现深邃柔和的环境悬浮投影与纯净毛玻璃底。

- **Tier 4: 对话框与浮动窗口（Dialog 的两种用法 / AlertDialog · 独立窗口）**：
  - **几何与层级**：外框圆角取 `--radius-dialog`（`.nb-ui-dialog-surface`），浮动窗口取 `--radius-window`（`.nb-ui-dialog-surface--window`）；叠在另一个窗口上的浮层，圆角不大于底下窗口的圆角，小确认框（`AlertDialog`）取 `--radius-dialog-compact`（`.nb-ui-dialog-surface--compact`）；常开、占大块屏幕的浮动窗口与工作台的部件卡片是同一类面，圆角取同一档（nbook 主题里 `--radius-window` 与 `--radius-dialog-compact` 都等于 `--shell-card-radius`，12px），不另写数值；层级按“叠放层级”一节从登记表取，模态按打开顺序、浮动窗口按嵌套深度；
  - **模态保护**：配合全屏半透明遮罩与焦点锁定，外点与 Escape 经组件判定后再请求关闭。

- **全局 Surface 基座升级（Elevation & Blur Upgrade）**：
  1. **立体微反光 4 阶柔影（`--elevation-popover`）**：
     - **白昼模式**：`0 0 0 1px rgb(0 0 0 / 0.08), 0 8px 24px -4px rgb(0 0 0 / 0.12), 0 16px 36px -8px rgb(0 0 0 / 0.16), 0 2px 6px -1px rgb(0 0 0 / 0.06)`；
     - **暗夜模式**：`0 0 0 1px rgb(255 255 255 / 0.10), 0 12px 28px -4px rgb(0 0 0 / 0.50), 0 20px 48px -8px rgb(0 0 0 / 0.65), 0 2px 6px -1px rgb(0 0 0 / 0.35)`；
     - 彻底废除老旧 `inset 0 2px ...` 生硬塑料反光条；
  2. **纯净自然滤镜（`--overlay-blur`）**：
     - 统一为 **`blur(8px) saturate(130%) brightness(1.0)`**；
     - 彻底纠正 `brightness(0.72)` 压暗 28% 导致的发脏浑浊，实现通透晶莹的现代玻璃质感。

#### 17. `QuickPick`（输入筛选、挑选一项的浮层 · S4 规范）
- **定位**：全局命令面板 / 快速输入的受控浮层原语；候选项、查询、活动项与执行语义全由宿主提供，组件不持有命令注册表、不做匹配与执行决策——`>` 命令、`:` 行号等前缀解析属宿主。props/emits 之外无自定义 slot、无 expose。
- **层级与 role（S4）**：消费 `NB_Z_INDEX.commandPalette`（9200，S4 全局命令面板角色）；模态 Dialog 语义（`DialogRoot` modal + `disableOutsidePointerEvents`），透明遮罩与 Content 同为 9200、Content 在后；外点被遮罩消费，不穿透底层。可访问名称来自 sr-only 的 `DialogTitle`；面板没有描述节点，Content 默认不带 `aria-describedby`（不指向不存在的描述 id），宿主经 attrs 显式传入时以宿主为准。
- **几何**：视口顶部居中，宽 `min(640px, calc(100vw - 24px))`，`top: clamp(16px, 8vh, 72px)`，`max-height: min(560px, calc(100dvh - 48px))`；圆角为 **14px**（`rounded-[14px]`），输入区与底部提示固定、列表 `flex:1; min-height:0` 自滚动；390px 宽仍留左右 12px。
- **材质**：消费 `.nb-ui-popover-surface` 基座（4 阶立体微反光投影 + 130% 饱和滤波）与 `--nb-popover-pad`，选中项用 `--overlay-item-active`；不叠第二层磨砂、不新开材质档。
- **键盘与焦点**：输入框 `role=combobox` + `aria-activedescendant`；ArrowUp/Down、Home/End 走 `utils/roving.ts` 的 `moveRoving`（跳过禁用、首尾回绕；Home、End 带 Ctrl 或 Cmd 时留给输入框）并只滚动候选列表这一层；Enter 在组合输入态（`isComposing`）不提交；Escape 只关闭本层并 `stopPropagation`；Tab 交给 Reka FocusScope 后阻止冒泡——下层 document/window 监听不得收到这些按键。打开时记录触发前焦点，关闭后归还仍连接的元素。
- **关闭交接（`closed`）**：关闭不加退场动画；`closed` 在内容真实卸载、Reka 焦点栈/滚动锁/指针锁全部释放后按打开周期发一次，供宿主在关闭完成后再执行命令或激活下一个交互层。`AlertDialog` 的同名事件复用同一时序；宿主不得用固定等待毫秒数替代。
- **打开动效**：挂载时消费 `.nb-ui-popover-motion`（见设计语言「七、动效」的「浮层入退场的编排是固定的」）。

### 4.3 受控视图的数据层契约（状态、请求与惰性加载）

本节是「宿主负责状态、视图只负责渲染」这条分工的工程合同。产品侧的实现范例是 NeuroBook 设置界面（外壳 `NovelIdeSettingsView` + 各区段视图 + 宿主 `NovelIdeSettingsDialog` + `useSectionDraft` / `useSettingsSnapshot`），迁移或新增受控视图时按这里走，别各自发明。

**分工**

1. **一份数据源**：同一份配置只取一次快照（按「作用域 + 配置目标」为键），区段视图一律不自己取数。N 个视图各取一次 = N 次请求 + N 份互不相同时序。
2. **草稿归宿主**：视图对 props 只读，改动只 emit；草稿、保存态、失败态都由宿主持有。视图里出现「可写副本」＝迟早两份真相。
3. **写回上下文随草稿捕获**：防抖写回落地时，用户可能已经切了作用域或配置目标。把「这份草稿属于哪个目标」在**构建草稿时**捕获（`useSectionDraft` 的 `captureContext`），写回时带上——否则旧草稿会写到新目标上。有了它，切换作用域才可以立刻生效、写回留到后台，不必「等写完再切」。

**写回策略**

4. **防抖 + 串行 + 与基线相等即跳过**：改动进防抖窗口（≈500ms）；写回串行，在写期间的多次触发合并成一次补写；写回体与最近一次从配置派生的写回体相等时不写盘（挂载、写回回声、改回原值都不该产生 PUT）。
5. **源回声守卫**：写回成功通常会触发重取（revision）。只有**干净**的草稿才接受新来源，脏草稿必须保住用户正在输入的内容；需要强制换草稿时（如切换作用域）由宿主显式 `reset()`，不要靠时序碰运气。
6. **失败绝不静默**：自动保存没有「保存」按钮兜底，失败必须走系统通知。视图不内联「保存中 / 保存失败」——每次自动保存闪一下提示是负体验，失败文案留在通知里、草稿留在 props 里。

**加载与流畅性**

7. **加载态只有一种形态，且要延时显示**：居中的指示 + 一句能独立成立的说明（共享组件，如 `SettingsLoadState`），占满它要交代的那块区域。不要第二形态（细进度条、骨架、行内色块）——加载就是这一块。显示要延时（约 200ms）：读得快的请求什么都不出现，不闪；慢请求出现时也不推动布局。判据是「请求飞出去后已经等过一小段时间」，不是「屏幕上有没有内容」。
8. **不做骨架**：占位形状会暗示一个还不知道的结构。加载＝转动的指示 + 一句能独立成立的说明。
9. **交互即时性**：作用域/标签/分区这类切换必须同步生效，副作用（写回、重取、惰性加载）放后台。任何「等网络回来再切」都会读成卡顿。
10. **惰性加载**：重区段（多会话、额外元数据端点）只在**真的被打开**时创建与取数；绑定对象可以在宿主 setup 建，但请求必须等 `enabled()`。打开后目标变化才重新读取。
11. **一个滚动 owner**：整页型区段由外壳给内边距并拥有滚动；两栏型/长列表型区段自己占满内容区并管理内部滚动。这条差异写进区段元数据（`layout: "scroll" | "fill"`），不要靠 `h-full` 试出来——外壳套一层 `overflow-y-auto` 会让区段内部的百分比高度失效，两栏就滚不到一起。

**一致性**

12. **切换规则要单向**：作用域切回来时回到该档上次停留的区段，没记过才取第一个。避免「有的方向跳第一个、有的方向保留当前」的补丁式不一致。
13. **状态占位组件化**：加载/失败是整块呈现，抽成共享组件复用（如 `SettingsLoadState`），不要每个视图各写一遍骨架或色块。
14. **可测试性**：可复用 composable 不要在内部直接调宿主态 API（`useNotification`、Nuxt `useState` 等）——纯 vitest 环境没有 Nuxt 上下文，一旦内部调用就只能靠桩。把「上报」做成回调参数（`notifyError?: (message: string) => void`），宿主注入。
15. **一次请求只由一个信号呈现，区段视图不接收 `loading`**：视图只管渲染宿主给的草稿，加载/失败由**外壳**统一画（外壳把所有来源——共享快照 + 各区段自带的取数——组合成一个忙信号 `loading`、一个失败信号 `loadError`、一个 `reload`）。分层各自画一次就会叠出「两层加载」：外壳在等快照、区段在等自己的元数据，用户看到两块占位轮流闪。重区段要自带取数时，把它折进外壳的同一个信号里（`activeSectionReady` 之类的组合 computed），而不是让视图自己长一个加载态。

### 4.4 组合与布局归属（「改了不生效」的复用来源）

受控视图的布局能力有一半来自**组合方式**而不是组件自身。下面三条是同一类事故的三种表现，
共同点是：**失败是静默的**——没有报错、编译通过、截图里才发现不对。已各踩过一次，故写成硬约束。

- **attrs 继承看根节点数量**。给组件挂 `class` / `style` / 监听器前，先确认它是**单根**模板。
  多根（`v-if`/`v-else` 两支、并列兄弟）会让 Vue 丢弃调用点传入的这些属性，只在 dev 打一条
  「Extraneous non-props attributes」警告，布局随之静默消失。需要承载滚动、内边距的组件，
  把这两件事写在**它自己的根**上，不要指望调用点。
  `sections/**` 的机械保证见 `sections-single-root.contract.test.ts`。
  父组件的 scoped 样式同理，只命中子组件的单一根；把 class 转发到内部元素的组件（例如 `Select` 交给触发器），
  带不上父组件的作用域属性，宽度这类布局给外层包裹元素。
- **布局类随内容走，不随选中态走**。外壳给内容区套的布局类（`overflow`、内边距、`layout` 模式）
  必须挂在**当前被渲染的那一份内容**上（过渡内的 keyed 子元素）。挂在随「已选中区段」立即翻转的
  外层容器上时，`out-in` 期间仍在渲染的**离场内容**会被套上**下一份内容**的布局：
  滚动区段切走时表现为「闪一下贴边无间隙」，fill 区段表现为「临时被加上外内边距」。
- **区段/视图的接线清单**（新增一个区段时逐条过）：
  1. 单根，或明确把布局放自己根上；
  2. 在区段元数据里声明 `layout`（`scroll` 由外壳给内边距并拥有滚动，`fill` 自己占满、内部滚动）；
  3. **不接收** `loading` / `loadError`，加载与失败由外壳统一呈现（见 4.3 节「受控视图的数据层契约」）；
  4. i18n 键归位：导航用 `settings.section.*`，视图内文案用 `settings.panels.*`；
  5. 在 Component Lab 登记场景（同名 `.md` 与场景登记）。

### 4.5 同类零件的分工

几个“从一组里选”的零件按用途分，不按长相分：

- `Tabs` 换去处：选中哪一项，下面就换成哪一块内容（设置的分页、面板里的几页）。
- `SegmentedControl` 换模式：内容还是同一份，换个看法（列表 / 网格、文本 / 树形）；当前状态不对应任何一项时可以一个都不选中（例如手动拖出的画布尺寸）。表单里三项以内、选项都没有说明且名字短的单选也用它（设置里的主题、明暗、语言），跟别的字段一起提交。
- `RadioGroup` 在表单里选一个值：选项带说明、名字长或要竖排时用它。
- `ToggleGroup` 是一组可以叠加的开关（粗体、斜体），可以同时按下几个，也可以都不按下；不做单选。
- `Select` 从一列值里选一个，收在下拉框里；`DropdownMenu` 点按钮弹出一列动作，选了就执行，不保留选中值。

### 4.6 取值词表与文案属性

同一个意思只有一个名字，组件之间不各写一套。共用的词表在 `src/components/shared-types.ts`，从 `./components` 导出；各组件声明自己能渲染的子集（`type InputSize = Extract<ControlSize, "sm" | "md">`），不渲染的档不进类型，也不留“有类型、没外观”的属性。

- **尺寸** `ControlSize = "2xs" | "xs" | "sm" | "md" | "lg"`。没有 `default`：缺省档就是 `md` 或组件说明里写的那一档。面板宽度（`DialogSize`）是另一套刻度，不用它。
- **语调** `Tone = "neutral" | "accent" | "info" | "success" | "warning" | "danger"`。不带语义的缺省档叫 `neutral`，不叫 `default`；出错与危险都叫 `danger`，不叫 `error`。运行状态（`CollapsibleRow` 的 `status: "error"`）不是语调，不用这套词。
- **方位** `Side = "top" | "right" | "bottom" | "left"`、`Align = "start" | "center" | "end"`；浮层的弹出位置叫 `side`，不叫 `placement`。组件有自己的选边算法时另起子类型（`SuggestionSide` 多一个 `auto`）。
- **方向** `Orientation = "horizontal" | "vertical"`。
- **文案属性**：按钮文字与读屏名称叫 `xxxLabel`（`confirmLabel`、`closeLabel`、`ariaLabel`），说明性文字叫 `xxxText`（`loadingText`、`emptyText`）。缺省值经翻译端口从 nb-ui 目录取（`src/locales/`），属性只用来覆盖；同一页可能有多个实例、需要各自名字的区域（例如 `Breadcrumb` 的导航区）才给覆盖属性。

### 4.7 浮层的打开与关闭

- **打开态**：一律 `open` 加 `update:open`。`Dialog`、`QuickPick`、`ContextMenu` 是受控的：`open` 必填，组件只发事件、自己不翻转，宿主不接 `update:open` 时浮层保持打开。`AlertDialog`、`Drawer`、`Popover`、`DropdownMenu` 另外支持带触发器的不受控用法。
- **事件**：`request-close(reason)` 是关闭请求，随后发 `update:open(false)`；打开态受控，宿主不接 `update:open`（或 `Dialog`、`FloatingWindow` 传 `:close-on-request="false"`）就等于拒绝，浮层保持打开；`closed` 在关闭完成、内容卸载并释放焦点之后发，宿主在它之后才执行命令或打开下一层，不用固定毫秒数代替。`AlertDialog`、`Drawer` 由 reka 直接关闭，不发请求。
- **关闭原因** `OverlayCloseReason`（`shared-types.ts`）：`escape`、`outside`、`close-button`、`cancel`、`select`、`tab`，各浮层只发自己有的那几种，保留各自的子集类型（`DialogCloseReason` 等）。“取消”与“关闭按钮”分开：宿主可能用取消按钮退回上一步、用关闭按钮关窗。
- **`Dialog` 关不关只看 `closeOnRequest`**（缺省 `true`），不看宿主挂了哪些监听；要拦（脏表单、守卫）就传 `false`，在 `request-close` 里自己决定。确认按钮只发 `confirm`，关不关由宿主决定。

## 5. 表单与无障碍

1. 字段组件接入 `Field` context：生成或接受 `id`，连接 `aria-describedby`，合并 `required`，错误时输出 `aria-invalid`。
2. 表单受控/非受控契约：所有表单控件（`Input`, `Select`, `Checkbox`, `NumberInput`, `Textarea`）的 `modelValue` 声明为可选并使用 `withDefaults` 赋予安全默认值，杜绝静态展示或非受控场景下的控制台告警。
3. nb-ui 持有的原生 input（公共组件内部 input 与 playground 自建控件）使用 `.nb-ui-native-input` 标记。`src/styles.css` 对 search decoration 和 number spinner 的抑制必须以该标记为作用域；未标记的宿主原生 input 保留浏览器默认伪元素。
4. 可见标签优先。图标按钮必须有非空 `aria-label`；tooltip 不能替代可访问名称。
   反过来也成立：**说明「这一页 / 这一节是什么、会写到哪里」的元信息不该单独占一行**——它走 tooltip 或标题旁的 info 图标，只有影响判断的正文才占行。区段标题下挂一句 20 字以上的灰色说明是最常见的违反形态。
5. 复合选择控件必须暴露正确角色和状态，并支持预期方向键、Home/End、Enter、Escape。关闭浮层后焦点回到触发器。
6. 只读不等于禁用：只读字段可聚焦、可复制，不提交值变化；禁用控件不响应指针或键盘，也不进入正常 Tab 顺序。
7. `prefers-reduced-motion` 与 `prefers-reduced-transparency` 的公共降级规则优先于主题。动效只解释出现、消失、位置或状态变化，不承担必要信息。
8. **校验结果不改变表单的排版**：出错时不在字段下插入文字，否则错误一多，表单每提交一次就换一次样子。
   - 能事先防住的不报错：必填项没填、格式不对时提交按钮不可用；长度靠输入上限，取值靠选择控件。
   - 提交之后才知道的错（服务端拒绝、选的文件不合规）：对应字段标红并得到焦点（`Field` 的 `error` 只标红、把原因交给读屏），看得见的原因写在一个固定位置。对话框里是页脚左侧的状态行（`Dialog` 的 `status`），一次只写一条。
   - 字段旁的计数、说明这类辅助信息也不占新行：计数贴在标签行右端，说明走标签旁的说明图标。

## 6. 测试与交付

行为测试只守可观察合同：值变化、边界、键盘、焦点、ARIA、打开后的 portal 内容、滚动和错误状态。不得以源代码字符串或无意义的 class 快照代替行为；外观来源和公共登记类可以用窄断言防止职责回流。

每批组件完成时：

1. 更新组件类型、所有本仓调用方和 barrel 导出；
2. 增加或更新覆盖新合同的 happy-dom 测试；
3. 在 `/components` 组合画廊检查受影响组合；
4. 同步 README 的公开用法与本文设计规范；
5. 测试、类型检查按仓库 [验证门禁](../../../docs/testing/README.md#验证门禁) 与包级条件触发规则运行；
6. UI 行为与视觉验收按 [UI 验收分档](../../../docs/testing/README.md#ui-验收分档) 进行，共享基础组件验证四种主题 × 配色组合及 390px，记录实测计算样式、键盘路径、控制台与页面错误；
7. 样式只改源码，不再有需要提交的 CSS 产物（宿主编译 nb-ui 源码，见 [`README.md`](../README.md#styles-in-the-host-app)）；明确阶段 2 尚未经 NeuroBook 主仓接入验证。

## 7. Component Lab

nb-ui 组件的场景登记在新应用的 Component Lab，行为合同见 [`ui/component-lab`](../../../docs/specs/ui/component-lab.md)，登记写法见 `packages/neuro-book/src/plugins/lab/web/fixtures/README.md`。playground 的 `/lab` 已删除；需要真实浏览器（真实指针与布局引擎）的验收（嵌套分栏、多栏分割、勾选框聚焦时不滚动外层容器）在 playground 的 `/acceptance/<组件>` 页，由 `e2e/nested-grid.spec.ts`、`e2e/splitter.spec.ts`、`e2e/checkbox.spec.ts` 驱动。

1. **登记位置**：`packages/neuro-book/src/plugins/lab/web/fixtures/nb-ui/` 按组件目录分文件（控制、展示、反馈、表单、布局）。只需绑定输入与记录事件的用 `defineSubjectFixture`，需要组合演示的手写 fixture 并用 `defineLabFixture<typeof C>`。
2. **一个场景一个组件**：场景表达组件的一种状态或输入组合，不在一个场景里平铺多套设计方案；设计实验不是组件合同。
3. **输入与事件**：可编辑的值写进场景的 `props`、`model`、`slots` 三层，受控值进 `model` 层由组件回写；要记录的事件显式声明；组件根上的 `data-lab-subject` 供检查器定位，根是片段或传送门的组件不加。
4. **领域数据**：场景数据用与长篇写作相关的真实题材（作品、分卷章节、人物、设定条目），不用 `Foo`、`Test 1` 这类占位。
5. **截图回归**：新增或修改组件后用 `bun run lab:shot`（在 `packages/neuro-book`）按手机与宽屏、深浅配色出截图与溢出报告。

## 8. 全库组件工业级微物理与动效工程规范（Frontend UI Engineering 落地标准）

依据 `frontend-ui-engineering` 标准，全库 48 个组件已完成逐一深度优化与物理动效装配：

1. **按压物理回弹（Active Spring）**：
   - 交互按钮类（`Button`, `IconButton`, `SegmentedControl`, `ToggleGroup`）统一装配 `not-disabled:active:scale-[0.93~0.975]` 物理弹性回弹；
   - 禁用态（`disabled`）严格通过 `disabled:active:transform-none` 屏蔽位移与缩放，杜绝误导性交互反馈。
2. **GPU 加速与平滑位移（Hardware Accelerated Transforms）**：
   - 滑块（`SegmentedControl`, `Switch`, `Slider`, `Progress`）指示物统一使用 GPU 硬件加速的 `transform: translateX(...)` / `translateY(...)` 进行位移，杜绝 `left`/`top` 引发的重排重绘；
   - 动效时长精确消费 `--motion-fast` (120ms) / `--motion-base` (180ms) / `--motion-enter` (220ms)，缓动统一消费 `--ease-standard`。
3. **零 `transition-all` 性能铁律**：
   - 过渡属性必须显式枚举（如 `transition-[background-color,color,transform,box-shadow]`），禁止使用 `transition-all`；
   - 100% 通过 `token-consumption.test.ts` 静态扫描。
4. **WCAG 2.1 AA 键盘导航与焦点管理**：
   - `Tabs`, `SegmentedControl`, `DropdownMenu`, `Menubar`, `Tree` 等复合组件全面支持 `ArrowUp/Down/Left/Right`, `Home/End`, `Enter/Space`, `Escape` 键盘导航并联动焦点环（`.nb-ui-focus-ring` / `--focus-ring`）。
   - `Tree` 的 `modelValue` 对外始终使用节点 `id`：单选为 `string | undefined`，多选为 `string[]`；组件内部负责把 id 映射为 Reka TreeRoot 所需的节点对象，并把更新事件映射回 id，调用方不得持有原语内部节点对象。
   - `Tree` 的选中行使用整行淡强调底、强调文字与中等字重，不使用常驻左边框或指示条；层级只由缩进与展开箭头表达，焦点继续由 `.nb-ui-focus-ring` 独立表达。

## 9. DropdownMenu 与 Popover 浮层 Surface 黄金标准规范（Select 唯一样式源）

全库所有下拉菜单（`DropdownMenu`）、选择器（`Select`）、命令面板（`QuickPick` / `WorkbenchCommandPalette`）与弹出浮层必须严格以 `Select` 的黄金调优标准为唯一样式规范：

1. **底色与对比度（nbook：小浮层亮 72% / 暗 75%，对话框 90%）**：
   - 小浮层（菜单、下拉、气泡、命令面板）读 `--overlay-surface`：nbook 亮色 `color-mix(in srgb, var(--bg-panel) 72%, transparent)`、暗色 75%，保证文字可读，杜绝过薄透明（如 14%）导致的底层正文透光干扰与眩光；
   - 对话框与浮动窗口读 `--dialog-surface`，叠在对话框上的对话框读 `--dialog-surface-nested`：nbook 两档都是 90%，大面积、字段多的面要读得清（开发者 2026-11-01 在 Lab 里对着彩色背景挑定）。两个变量缺省都回落到上一档，主题不给时与小浮层一样；
   - 高对比度 / 降低透明度模式：三档都回退 `var(--bg-panel)` 实心面板底。
2. **高阶微滤波（8px 模糊 + 130% 饱和度）**：
   - 统一消费 `backdrop-filter: blur(8px) saturate(130%) brightness(1.0);`，避免大半径模糊与复杂 SVG 折射引发的边缘文字走样或错位。
3. **4 阶立体微反光环境柔影**：
   - 统一消费 `--elevation-popover`：`0 0 0 1px color-mix(in srgb, var(--text-main) 8%, transparent), 0 6px 16px -2px color-mix(in srgb, var(--shadow-color) 16%, transparent), 0 20px 48px -4px color-mix(in srgb, var(--shadow-color) 28%, transparent), 0 36px 80px -8px color-mix(in srgb, var(--shadow-color) 20%, transparent)`，外发散柔影与 1px 微反光边缘兼备。
   - 菜单与下拉（`.nb-ui-menu-surface`）改读 `--elevation-menu`，缺省等于 `--elevation-popover`；主题可以给菜单单独收小投影（nbook：一圈 0.5px 细边加一层 4px 偏移、14px 模糊的近投影，圆角 `--radius-menu` 为 10px、内边距 `--menu-pad` 为 4px，项的圆角推出 5px）。
4. **单一样式源**：
   - 任何涉及下拉与浮层的组件，外观只用 `.nb-ui-popover-surface .nb-ui-menu-surface` 两个类，层级用 `usePopoverLayer`，滚动用 `usePopupScroll`，项用 `.nb-ui-menu-item`；严禁在模板中重复书写内联样式。

## 10. 开发后自检与易错清单（Checklist）

本节收录在真实开发与实测推演中沉淀出的检查项（不设假想项，可被自动化脚本拦截的条目由 CI 与测试负责；本节仅收录真实踩坑沉淀、且自动化工具难以静态拦截的体验与行为判据，随实践动态演进）：

- [ ] **浮层高亮材质**：玻璃浮层（`.nb-ui-popover-surface`）内的项高亮消费 `--overlay-item-active`（半透明 tint），不使用实色 `--bg-hover`，避免在通透玻璃上产生实色色块（设计语言「五、颜色角色」）；
- [ ] **同心圆角防负值**：所有内圆角推导公式包裹 `max(2px, calc(...))`，防止负半径导致浏览器丢弃属性突变直角（设计语言「三、几何」）；
- [ ] **单层滚动权**：页面最外层容器持有滚动权，内部子组件不滥用 `overflow-y: auto` 产生双层嵌套滚动；动态流式列表声明 `scrollbar-gutter: stable` 防 1px 抖动（4.2 节第 15 条 `ScrollArea`）；
- [ ] **浮层关闭时序**：浮层关闭与状态交接依赖原语真实的 `closed` 事件或过渡钩子，不使用固定 `setTimeout` 毫秒数推断（设计语言「七、动效」浮层编排的第 6 条）；
- [ ] **去框化流式卡片（去三段式盒子）**：展示卡片与留痕面板严禁采用“独立背景横幅头 + 内容大框 + 底部提示横幅”的三段式机械堆叠；区段之间消费 `--divider` 发丝线或 `Separator`，标题与正文同字号（`--text-sm`）依靠字重和色阶区分，严禁大面积整卡漫铺刺眼警示黄底（设计语言「三、几何」「五、颜色角色」）；
- [ ] **Tab 滚动权按页隔离**：多 Tab 容器严禁由外层统一声明 `overflow-y: auto`；各 Tab 独立控制滚动，固定高度的 Tab 必须显式声明 `overflow-hidden`，防止微溢出触发误滚动；
- [ ] **Agent 交互与工具调用留痕契约**：前端工具卡片必须对照底层真实 Schema（`server/agent/tools/`），严禁凭空臆造字段；严格按底层数据形状区分开放式与选项式提问；交互决策留痕组件应声明为 `mode: "message"` 顶级消息卡片，杜绝嵌套在普通执行工具的 `mode: "block"` 折叠灰盒内产生外壳套内盒；
- [ ] **同类交互状态一致与外扩阴影防裁切**：自定义交互元素与基础控件表达同类状态（hover / focus / active / selected）时，复用同一基座类或状态 token，不手写近似的局部边框或阴影；外层带 `overflow` 裁切时，确认外扩阴影（如焦点光环）留有内边距冗余，不被容器边缘切边；填满所在条、四周没有余地的控件改用内嵌焦点线；只为动画裁切的容器只在动画进行中裁（见 design-language 坑 48），不用“内边距加等量负外边距”把裁切盒往外放（外框会比父容器宽，在可横向滚动的父容器里多出滚动距离）；工具条、表单行这类只有一行控件高的容器不设 `overflow: hidden`（不横向滚动靠换行与收缩），余量按主题 `--focus-ring` 的实色部分算（不偏移那几圈的扩散量，nbook、macos 是 3.5px；带偏移的模糊光切掉一截看不出，不算）；`lab:shot` 机检这一条（按样式表里的焦点规则找会画焦点环的元素，环画在外框上时按外框算；离裁切祖先的边比实色部分近就报）；
- [ ] **测量层的复本只复刻尺寸**：为了量宽度而放在不可见测量层里的复本（逐级让位、宽度适配用）不带 `role`、`id`，也不用被测试或样式引用的真元素类名（样式经测量层自己的类共用），否则文档里出现重复 `id`，按角色、类名或文字找真元素的地方会碰到复本；
- [ ] **改别的组件的颜色字号走它的覆盖点**：调整另一个包或宿主注入的组件的颜色、字号时，按它文档公开的覆盖点写在它的根元素上（透传的 `style` 或文档列出的变量），不靠外层继承：根上声明了同名属性时，继承进不去；
- [ ] **可点击卡片内嵌操作防按钮嵌套**：卡片同时具备“点击主区域选中/展开”与“行内局部操作按钮（`IconButton` / `Button`）”时，主触发区与操作按钮组并列为兄弟节点（或外层容器配键盘回车/空格监听），禁止在 `<button>` 内嵌套 `<button>`。
- [ ] **同行两段文字一段先收**：同一行两段文字要一段先收完、另一段再收时（例如说明先截断、标题后截断），先收的那段用 `flex: 1 1 0` 只占剩下的宽度；不要靠加大收缩系数：收缩按“系数乘基准宽度”分摊，另一段也会少一两个像素、平白出省略号；
- [ ] **同一列表的行等高**：列表或卡片的条目在缺少可选内容、文字很长、带状态标记或转圈时，高度与其它条目相同（第 3 节第 5 条）；Lab 场景里放一条什么都没有的和一条什么都有的，在真实浏览器里比一遍同一列表各条目的高度；
- [ ] **包装组件转发外露方法**：包装别的组件的组件（提供注入、按需加载、加回退）要把外露方法转给里面的组件，否则调用方的模板引用停在外层、拿不到方法；Vue 只对 `defineAsyncComponent` 自动转发；
- [ ] **程序聚焦容器不滚动**：用程序把焦点放到一个可能比可见区域高的容器上（例如接住随列表卸载而丢掉的焦点）时，用 `focus({preventScroll: true})`；否则浏览器把容器顶边滚到最上面，它上方的标题与返回按钮被滚走。

