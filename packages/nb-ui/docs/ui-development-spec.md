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
3. 组件不得直接引用某套主题私有变量。公共组件只消费配色合同、`nbDesignTokens`、`nbThemeTokens` 或 manifest 声明且具备 fallback 的变量。`FormCheckbox` 渐变中的 `#000000` 仅作为 `color-mix()` 的纯黑计算端点，不承担组件配色语义；静态规则只豁免这一文件中的这一字面值。
4. 只有 raised、popover、dialog 三档层级。阴影消费 `--elevation-*`；普通页面区块不以阴影代替结构。**这三档是阴影的档，与第 1 条层级轴的色阶各管各的**，不要互相推导——Material Design 3 曾把面色绑在 elevation 上，后来主动解绑（"not tied to elevation"）。
5. 浮层使用 `.nb-ui-popover-surface`。菜单叠加 `.nb-ui-menu-surface`；大块玻璃面按设计语言要求显式叠加 `.nb-ui-surface-rim`。组件不得复制这些属性。
6. 新公共 token 至少有两个独立消费点或明确的跨组件角色。单组件差异留在组件内部，第三方主题专用差异走 manifest `declares`。

## 3. 几何、排版与动效

1. 单行字段默认消费 `.nb-ui-control-h-md` 与 `.nb-ui-control-px`；紧凑档消费 `sm`，大档消费 `lg`。组件模板不得重新写固定高度模拟同一档。
2. 控件、面板、菜单、胶囊分别消费 `--radius-control`、`--radius-panel`、`--radius-menu`、`--radius-pill`。浮层内角由 `.nb-ui-popover-item` 推导，不独立写 `rounded-*`。
3. 界面文字消费 `--font-ui` 与登记字号；长文内容消费 `--font-display` 和阅读刻度。`--text-2xs` 只用于计数、序号、时间戳和短角标。
4. 布局使用明确的 grid/flex 轨道、gap、min/max 与 overflow 所有权。动态文字、图标、加载态和计数不得改变固定格式控件的外框尺寸。按钮与交互控件的点击、激活（active）、聚焦（focus）或悬停（hover）状态不得引起自身或父容器的盒模型尺寸（`offsetWidth` / `offsetHeight`）产生任何抖动或布局位移（Zero Layout Shift）。按压缩放动效仅允许通过 GPU 合成层（`transform: scale(...)`）进行内部视觉缩放，禁用态（disabled）严禁触发任何缩放动效；边框高亮必须预留透明占位或使用 `outline` / `box-shadow`，不得在 hover/active 时动态改变 `border-width` 挤压容器。
5. 390px 宽度必须无页面级横向溢出。窄屏可以重排工具面板，但不得隐藏完成核心操作所需的控件。
6. 动效只消费 `--motion-fast` / `--motion-base` / `--motion-enter` 与 `--ease-standard`；组件不得写死时长或缓动，不得使用 `transition-all`。浮层入退场编排与判据见 [设计语言](./design-language.md) 的动效节。

## 4. 组件合同与核心控件设计规范

每个公共组件必须有一份可从类型和测试读出的合同：

- props：受控值、禁用/只读/必填/无效状态、语义尺寸和必要 HTML 属性；
- emits：值变化、提交、焦点或关闭原因等消费方可观察事件；
- slots：只开放稳定的内容插槽，不把内部 DOM 层级变成合同；
- a11y：角色、名称、状态、关联描述、键盘和焦点归还；
- 边界：空值、未知值、禁用项、最小/最大值、溢出与窄屏行为。

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
  - **紧凑档（`sm` · 26px）**：`h-[26px] px-2.5 text-[12px] rounded-[6px] gap-1`；
  - **标准档（`md` · 32px）**：`h-[32px] px-3.5 text-[13px] rounded-[8px] gap-1.5`；
  - **大尺寸（`lg` · 38px）**：`h-[38px] px-4.5 text-[14px] rounded-[10px] gap-2`；
  - 严禁对普通按钮强制夸张的最小宽度，让文字紧凑自然排布，告别过度拉伸的胖胶囊。
- **Primary（主要操作）**：`bg-[var(--accent-main)] text-[var(--text-inverse)]` + `0 1px 2px` 微底影；Hover 浓度加深并向外绽放 `0 2.5px 8px` 同色环境柔晕；Active 触觉回弹微缩放 `scale(0.975)`。
- **Secondary（次要操作）**：常态为纯净的 **`8%` 半透浅底**（`color-mix(in srgb, var(--text-main) 8%, transparent)`，去除非必要生硬边框与死白方块）；Hover 跃升至 **`18%` 饱满实底 + `0 2px 6px` 同色环境柔晕**；Active 坚实沉淀至 **`24%`** + `scale(0.975)`。
- **Danger / Subtle / Ghost**：Danger 绑定 `--status-danger` 与红色环境光晕；Subtle / Ghost 常态透明或 5% 浅底，Hover 优雅淡入 10%~14% 底板。
- **稳定性与禁用态**：固定 `border: 1px solid transparent; box-sizing: border-box;` 杜绝 1px 尺寸抖动；`disabled` 严格屏蔽所有 Hover 阴影与 Active 缩放；加载态（Loading）锁定安全内部尺寸，文案变动时零宽度跳变。

#### 2. `IconButton`（紧凑图标按钮 · 方案 2 规范）
- **尺寸与圆角**：`sm`（26px / 6px 圆角）、`md`（32px / 8px 圆角）、`lg`（38px / 10px 圆角）。
- **Default（默认操作）**：常态纯镂空透明，图标为优雅次要文字色；Hover 底色浓度平滑跃升至 `15%` 饱满实底，图标转为深色；Active 加深至 `24%` 坚实沉淀底色 + `scale(0.93)` 触觉紧凑回弹。
- **Accent / Danger / Secondary**：Hover 浮现 `16%` 品牌色、危险色或 `18%` 次要底板，Active 加深至 `24%`。
- **稳定性**：盒模型尺寸 100% 绝对稳定，禁用态严格禁止任何缩放动效。

#### 3. `SegmentedControl`（分段控制器 · 方案 2-A 规范）
- **外槽与滑块**：`rounded-[var(--radius-control)]` 外槽 + `10%` 柔和半透底槽 + 1px 细微环境边框；选中滑块采用纯正品牌蓝（`var(--accent-main)`）+ 纯白反色文字 + `0 1.5px 4px` 柔和微底影。
- **智能分隔线**：相邻未选分段间带有 1px 竖向细线；当滑块滑动至某项时，该项两侧的分隔线**自动平滑隐去**。
- **动效**：消费 `var(--motion-base)`（300ms 舒缓物理阻尼曲线 `cubic-bezier(0.22, 1, 0.36, 1)`），连续平滑滑向目标项。
- **多选支持**：支持富文本样式（B/I/U/S）等独立多选组合，各激活项独立高亮。

#### 4. `FormCheckbox`（复选框与单选 · 实心超椭圆规范）
- **形态与圆角**：`20px × 20px`，`rounded-[8px]` 饱满超椭圆（Squircle）实心质感，无杂乱外边框。
- **未选中态**：`18%` 柔和半透深灰实心底座。
- **选中态（Checked）**：纯正 Apple 蓝底 + 加粗纯白 Apple SF Pro 矢量对勾 `[✓]`。
- **半选中态（Indeterminate）**：纯正 Apple 蓝底 + 居中纯白矢量横杠减号 `[-]`（原生支持树状子级联动）。
- **层级缩进**：树状子项支持 `32px` 显式绝对层级缩进。
- **单选按钮（Radio）**：圆形深灰实心底座，选中为蓝底 + 居中纯白小实心圆点。

#### 5. `FormSelect`（下拉选择器与长列表规范）
- **浮层材质与同心对称性**：65% 底色不透明度 + 8px 高斯模糊 + 130% 饱和度 + 1.0 亮度；外层容器四周统一为严格对称的 6px 等宽内边距（`p-1.5`），内部视口常态零额外边距，确保上下左右均为严格相等的 6px，内圈圆角（`--nb-popover-inner-radius`）与外圈完美同心；`:side-offset="7"` 避免遮挡 Trigger 聚焦发光圈；`@close-auto-focus` 消除二次弹回闪烁。
- **黄金截断高度（50%~64% 截断）**：单项槽总高 `32px + 4px = 36px`（sm 档 `26px + 4px = 30px`）；默认视口高度设为 **`233px`**（露出 53% 基线横截）或 **`238px`**（2/3 露出），严格截在文字躯干/基线上，杜绝 80%+ 削顶事故或 20%- 脏边感知。
- **即时感知与双向微渐隐**：挂载与尺寸变动时即时计算（`setViewportRef`），无需等待用户滚动即可直接呈现底部虚化与滚动条；渐隐遮罩收敛至 **`8px`~`14px`**，避免洗淡文字。
- **滚动条**：内置 4px 悬浮 macOS 胶囊滑块（仅在内容溢出时为视口动态分配 `pr-1.5`，支持自由鼠标拖拽），底层逻辑抽取为 `useFloatingScrollbar.ts`。

#### 6. `FormInput` & `FormNumberInput`（输入框规范）
- **展示容器**：Lab 展示统一装配 `macos-compact-card` 磨砂卡片容器（75% 半透明底色 + 20px 模糊 + 14px 圆角 + 4 层立体环境阴影）。
- **状态准则**：常态与悬停态素雅不抖动（不主动改变边框颜色，仅依赖指针样式反馈），聚焦态统一点亮 Apple 原生 Focus 蓝光扩散光晕（`--focus-ring`）。
- **数值微调**：步进按钮支持滚轮、键盘上下键与 clamp 边界保护。

#### 7. `Dropdown`（下拉菜单与动作浮层规范）
- **浮层材质单一真相源（强制对齐 FormSelect 黄金标准）**：所有 Dropdown 及其派生菜单（包括动作下拉、选择菜单、工作区工具栏下拉）**唯一保留并严格继承 `FormSelect.vue` 已经调好的 Surface 体系**，严禁在组件内写死 `10px` 圆角、`65%` 面色或独立描边。
- **底层 Composables 架构规范**：
  1. `useDropdownSurfaceStyle`：统一输出 4 层微反光立体环境投影（`0 0 0 1px ... + 3 阶环境柔影`）、130% 饱和度多阶微滤波（`blur(8px) saturate(130%) brightness(1.0)`）、四周对称 6px 内边距（`p-1.5`）、同心内圆角（`--nb-popover-inner-radius`）与 `:side-offset="7"`；
  2. `useDropdownTruncatedHeight`：统一输出 N.5 项（默认 6.5 项，紧凑 5.5 项）齐腰截半露底高度计算（默认 `238px` / `233px`，紧凑 `168px`），精准横截文字躯干提供可滚动潜意识线索；
  3. `useFloatingScrollbar` 与 `useDropdownFloating`：挂载即时感知尺寸与滚动溢出，仅在溢出时长显 4px macOS 悬浮胶囊滑块并给视口动态补偿 `pr-1.5` 避让。
- **菜单项与破坏性动作**：普通项 hover/active 消费 `var(--overlay-item-active)` 8% 柔光叠加；项级圆角严格跟随 `.nb-ui-popover-item` 派生同心圆角；危险项（`tone: "danger"`）消费 `.nb-ui-menu-item-danger`；分隔线采用 `border-[color:var(--divider)]`。
- **菜单结构契约**：平面项、分隔线与**一层子菜单**（`children`：父项只展开、不执行 select；子项里再写 children 不再展开，按普通项渲染并给开发诊断）；`type: "radio" | "checkbox"` 用对应原语渲染勾选态，`checked` 是**受控**值——组件只发 select，勾选永远由宿主改；radio 的同组互斥用 `group` 声明，同组连排合成一个 RadioGroup，缺 group 的贡献按单项独立成组并给开发诊断。`active` 保持旧的视觉字段语义，不复用为勾选态。
- **受控展开**：`open` 传入即受控（宿主不改就不变），不传则由原语自管；两种用法都会发 `update:open`，宿主据此在活动对象切换时关掉旧菜单。
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

#### 10. `Accordion` & `Collapsible`（折叠面板规范）
- **手风琴（Accordion）**：平滑高度折叠动效（`--motion-base` + `--ease-standard`），右侧 Chevron 箭头 180° 平滑翻转，支持单选/多选展开模式。
- **折叠器（Collapsible）**：无侵入受控容器，原生支持 `data-[state=open]` 高度自适应动效。
- **折叠区段（CollapsibleSection）**：`Collapsible` 之上的标准标题行——「图标 + 标题 + meta 插槽 + chevron」，供设置页区段使用。标题行是「一节」而不是「单元」：静止态不画描边与填色，悬停只给半量底色，图标与 chevron 在悬停 / 展开时转 accent。整行（含底色与图标）左右各留 8px 内缩，不贴列边缘；需要裸触发器时继续用 `Collapsible`。

#### 11. `Popover` & `HoverCard`（气泡与悬浮卡片规范）
- **材质基座**：消费统一的 `.nb-ui-popover-surface` 磨砂玻璃基底（75% 半透底色 + 12px~14px 模糊 + 130% 饱和度 + 1px 环境边框 + 立体柔影），禁用时 `close-auto-focus` 防止二次聚焦闪烁。
- **长文写作场景**：`HoverCard` 预设 250ms 打开延迟与 200ms 关闭平滑过渡，为设定集词条、人名档案与外部链接提供即时轻量预览。

#### 12. `Splitter`（多栏可调节工作区规范）
- **双向分割**：支持水平（`horizontal`）与垂直（`vertical`）多栏分配；`Splitter` 内部不再使用 reka-ui 的分割原语，拖动、命中、键盘与收起全部走 nb-ui 自己的纯函数（`grid-geometry` / `sash-drag`）与 `useSashGesture` 输入层，`Enter` 折叠/恢复与拖动共用同一份收起策略。
- **受控尺寸**：几何只有 CSS px 一种口径。`Splitter` 的 `sizesPx` 是受控呈现（合计 = 面板空间，不含 sash），`panels` 用 `defaultSizePx` / `minSizePx` / `maxSizePx` / `sizing` / `collapse`；没有百分比往返，也没有 `autoSaveId`（原语不写存储）。等值发布被忽略，程序发布只改呈现、不产生用户提交。
- **sash 几何**：默认每条占主轴 1px；`sashSizes` 按边界提供实际像素。零值不占布局且不可交互，非法值诊断后回退，主轴守恒不依赖 CSS 隐藏；设备像素对齐只做在内部装饰胶囊的 `transform` 上，**不移动 separator 的命中盒**，也不改子节点布局。
- **拖拽触感**：精细分隔线 + 悬浮/拖动时点亮品牌色胶囊指示器；命中边距 fine 5px / coarse 15px，且 hover、光标、按下与高亮读同一份命中结果——T/十字处两条线会一起点亮。
- **手势边界**：一个公开 `GridRenderer` 独占一份会话，一次按下命中的最多两根轴（一根 width + 一根 height）属于同一场手势：`gesture-update` 携带预览布局让整棵子树按父盒实时变化，松手只发一次 `gesture-end(commit)`，`commit.changes` 里每项是该分支全部直接子节点沿主轴的 px（`baseline`/`target`/`active`/`compensated`/`collapsed`），宿主用 `grid.resizeBranches(changes)` 一次原子落账。独立 `Splitter` 仍用单分支 `SplitterGestureState`（`sizesPx` + `collapsed`）。
- **边界规则**：基线在用户开始时捕获，一次指针操作或一次键盘连发只结束一次；`keyup` 或失焦结束键盘手势；
  Escape、pointercancel、窗口失焦、卸载与 panel 身份/约束/方向/禁用变化取消且不产生保存意图，并同时复位上游拖动状态；挂载、约束变化与视口重算仍只发 `layout`。
- **主动与补偿**：`active` 只含 sash 两侧相对基线实际改变的面板；相邻候选触界未变化时不冒充主动字段，被推着让出空间的远端兄弟记为 `compensated`。
- **收起与恢复**：指针按**按下基线 + 累计位移**的绝对边界求解，吸附只改约束、不用记忆尺寸重锚，展开跟随指针坐标——同一个鼠标位置永远对应同一个状态；低于 `minimum − 24` 吸附到 `collapsedSize`，回到 `max(minimum, collapsedSize + 24)` 且容量允许时展开。记忆尺寸只服务按钮 / `Enter` 的显式恢复（恢复空间不足时保持收起并给诊断）。会话提交的就是最后发布的那份几何，`finish` 不拿最后一次位移重解。

#### 13. `Drawer`、`DialogWindow` & `AlertDialog`（浮动窗口与反馈规范）
- **Drawer**：支持 `top` / `bottom` / `left` / `right` 四向滑出，背景采用 80% Scrim + 4px 模糊，右侧默认 380px 大纲与设定抽屉。
  - **DialogWindow**：明确使用非模态 Dialog 语义（`DialogRoot :modal="false"`），不渲染 Overlay、不困住焦点、不锁定窗口外指针或背景滚动；窗口外页面必须继续可交互。
  - 标题、`header` slot 和无标题回退都必须生成 `DialogTitle`；关闭按钮必须有可访问名称。标题一律左对齐，不做居中变体；关闭按钮用 `sm` 尺寸贴右上、不贴窗口圆角。Escape、关闭按钮与 `request-close` 由受控宿主决定最终关闭时机。
  - 默认 Portal 目标为 `body`。公共组件不得绑定产品私有主题宿主；产品消费者必须显式传入主题宿主目标，避免 Portal 脱离主题变量作用域。
  - 标题栏拖动由项目层实现；`resizable` 默认关闭，开启后提供右侧、底部和右下角手柄。鼠标 pointerup 提交 `update:width` / `update:height`，方向键按 10px 调整、Shift 按 1px 调整，且不突破 `minWidth` / `minHeight`。
  - DialogWindow body 内的 nb-ui `FormSelect` 下拉使用高于窗口表面的专用 popover 层级；窗口外仍使用普通 popover 层级，避免下拉被非模态窗口遮挡。
  - 窄屏窗口宽度必须收敛到视口内，不产生页面级横向溢出；body 拥有长内容滚动权，footer 不随 body 滚动。
  - **内边距只有一层**：body 的 `px-4 py-3` 是窗口给的那一层；内容自带页面节律（导航轨 / 内容列各有自己的 `--space-*` 边距）时，宿主必须传 `body-class="!p-0"` 把这层交出去。两层叠起来会到 24–32px，读起来像内容被挤在窗口中间。
- **AlertDialog**：居中破坏性二次确认模态窗，强制提供有明确意图的按钮出口（取消/确认），支持 `danger` / `warning` / `accent` 语调；受控模式可不提供 `trigger` slot，组件不得为无触发器实例渲染空的 `AlertDialogTrigger`。

#### 14. `Progress` & `Avatar` & `Kbd`（数据反馈与微排版组件规范）
- **Progress**：全胶囊圆角，消费 `--motion-base` 平滑 `translateX` 进度位移，支持 4 种语义状态色。
- **Avatar**：支持现代超椭圆（`squircle`）与圆形，图片加载缺失时 0 延迟即时呈现大写 Fallback 字母，加载时提供防闪烁机制。
- **Kbd**：等宽微浮雕物理键帽质感，`--control-outline` 边框 + 实体微底影，支持 `sm` / `md` / `lg` 三档字号与高宽排布。

#### 15. `ScrollArea` 与跨平台极简滚动条体系规范
- **必要性与设计定位**：在桌面优先的长篇写作软件与复杂工作区中，操作系统的原生滚动条（如 Windows 默认的 17px 灰白方块、部分 Linux 异构样式）会严重破坏磨砂玻璃质感、遮挡正文并挤压排版宽度。因此必须将滚动条纳入 UI 系统的核心规范。
- **两层架构标准**：
  1. **组件级（`ScrollArea` / `FormSelect` / `Dropdown`）**：
     - 基于 `ScrollAreaRoot` / `ScrollAreaScrollbar` / `ScrollAreaThumb`，或通过 `useFloatingScrollbar.ts` 自适应挂载；
     - 滑块采用 4px~6px 悬浮微胶囊形态（`rounded-[var(--radius-pill)]`），常态半透明（`color-mix(in srgb, var(--text-main) 16%, transparent)`），Hover / Drag 时平滑加深至 `32%`；
     - 轨道完全透明，不抢占内容区常态盒模型空间，未溢出时彻底隐藏。
  2. **全局容器级（CSS 滚动条规范）**：
     - 适用于侧边栏（如 `/lab` 的 `LabNav`）、代码块、长表格与抽屉面板；
     - WebKit 滚动条（`::-webkit-scrollbar`）：宽度 6px，轨道透明，滑块圆角 `var(--radius-pill)`，消费 `--motion-fast` 渐变；
     - 标准属性：`scrollbar-width: thin`，`scrollbar-color: color-mix(in srgb, var(--text-main) 18%, transparent) transparent`。
  3. **滚动槽位预留与防抖动（`scrollbar-gutter` 规约）**：
     - 全局根视口（`html`）：默认注入 `scrollbar-gutter: stable;`，防止内容高度动态改变（如异步消息加载、区段折叠展开）触发滚动条出现时，页面或面板可用宽度骤减导致内容横向跳变（Layout Shift）；
     - 对称居中容器：模态弹窗、居中卡片或对称表单若需保持视觉绝对对称居中，应使用 `scrollbar-gutter: stable both-edges;`（工具类 `.nb-ui-scrollbar-center`），避免单侧预留槽位破坏居中对齐；
     - 内部长视口：对话流（如 `agent-chat-flow`）与长列表容器显式声明 `scrollbar-gutter: stable;`。
  4. **单层滚动权与外框贴边原则（Single Scroll Responsibility）**：
     - 滚动权归拥有完整视图高度的最外层容器所有，内部子组件与空状态（如 `AgentChatEmptyState`）严禁重复声明 `overflow-y: auto` 与 `h-full`，杜绝产生双层嵌套滚动与陷在内部的孤立滚动条；
     - 内部子组件不堆叠外层宿主已有的内边距（例如宿主已有 `p-4`，内部通过 `w-full my-auto` 自适应居中与延展），保证滚动条始终完整贴合最外层物理面板边缘；
  5. **FormSelect 防抖与避让范式**：
     - 下拉弹出层明确声明 `:body-lock="false"`，杜绝打开下拉组件时锁死页面滚动条导致的全局布局跳跃；
     - 视口右侧预留 8px 物理避让（`pr-2 pl-0.5`），配合独立绝对定位的 4px macOS 悬浮滑块与黄金截半露底线索，在无原生滚动条占位干扰的前提下提供清晰的交互指示。

#### 16. `Listbox`（高级列表选择框与实体卡片规范）
- **设计定位**：就地常驻展开（Inline）的多选/单选容器，与下拉弹层式 `Select` 形成互补；专用于长篇写作大纲分卷多选、世界观词条/人物档案实体选择与标签池。
- **四大展示与交互方案体系**：
  1. **方案 1：macOS 经典紧凑检查器（`variant="compact"` · 推荐）**：单行高 28px~32px，单选为经典高斯蓝底（`var(--accent-main)`）高亮，多选为左侧实心超椭圆微 Checkbox + 右侧状态标签，集成即时搜索与底部快捷全选/反选/清空状态栏；
  2. **方案 2：现代富实体卡片（`variant="card"`）**：独立微卡片排版，支持左侧大图标/头像插槽、粗体主标题、2 行副标题描述与右侧状态胶囊徽章（Badge），选中态带有 `0 0 0 1.5px var(--accent-main)` 柔光微外框；
  3. **方案 3：分段多组折叠大纲（`grouped`）**：基于 `ListboxGroup` / `ListboxGroupLabel`，支持粘性磨砂组头、组内数量指示与「切换全选本组」快捷操作；
  4. **方案 4：双栏穿梭流转分配器（Shuttle Transfer）**：待选章节池 vs 本次导出目标双栏，支持 `>` `<` `>>` `<<` 穿梭流转与导出顺序上下调整。
- **搜索与操作状态栏**：
  - 顶部内嵌 `ListboxFilter` 即时搜索栏，支持跨标题、描述、徽标与分组多字段模糊匹配；
  - 底部提供 `showActionBar` 状态操作栏（`已选 N / M 项`、全选、反选、清空）。

#### 17. 浮层体系分级架构（Surface Tier Architecture）与黄金基座规范

全库浮层彻底告别分散硬编码，统一划分为 4 档标准分层模型（Tier 1 ~ Tier 4），由全局基座与专用 Composables 严格约束：

- **Tier 1: 紧凑说明浮层（Tooltip · 气泡说明）**：
  - **材质策略**：专用于极简说明性紧凑气泡，明确**不采用**半透明玻璃（杜绝浅色背景或文字下发灰浑浊），统一采用**实心面板底（`var(--bg-panel)`）** 与 **正文主字色（`var(--text-main)`）**；
  - **几何与尺寸**：消费控件圆角（`var(--radius-control)`）超椭圆胶囊，字号 12px，内边距 `5px 9px`，`:side-offset="6"`；
  - **无尖角原则（No-Arrow Principle）**：不使用 SVG/伪元素三角形尖角，依靠间隙与 Reka Popper 翻转表达空间关系；
  - **A11y 与交互**：配置 `pointer-events: none` 穿透，严禁与浏览器原生 `title` 双重冒出。

- **Tier 2: 交互菜单与下拉选择（Dropdown / FormSelect / Menubar · 黄金标准）**：
  - **单一真相源**：所有下拉与弹出菜单统一接入 `useDropdownFloating`，严禁在组件内写死内联 `backgroundColor: 65%`、`backdropFilter`、`boxShadow` 或 `borderRadius: 10px`；
  - **同心几何律（Concentric Geometry）**：
    - 外框圆角精确锁定 **12px**（`--nb-popover-radius: 12px`）；
    - 列表项圆角精确推导为 **5px**（`--nb-popover-inner-radius: 5px`，满足 $R_{inner} = R_{outer} - Padding$ 的严密视觉同心律）；
  - **齐腰截半露底视口（N.5 Truncated Viewport）**：
    - 视口高度由 `useDropdownTruncatedHeight` 动态计算：单行第 6.5 项截断（标准 238px，紧凑 168px）、双行第 3.5 项截断，向用户传递清晰可感知的可滚动线索；
  - **macOS 极简悬浮滚动条**：4px 悬浮微胶囊滑块，常态半透明、悬停加深，内容溢出时自动挂载，视口右侧保留 8px 避让间距。

- **Tier 3: 悬浮命令面板与快速输入（QuickInput / WorkbenchCommandPalette · 全局输入）**：
  - **几何重构**：外框圆角明确锁定为 **14px**（`--nb-popover-radius: 14px`），彻底移除对 20px 巨角 `--radius-panel` 的盲目继承；与内部 8px 输入框（`rounded-lg`）达成黄金同心比例；
  - **纯净现代通透质感**：直接消费全局 `.nb-ui-popover-surface`，彻底清除顶部生硬塑料白光条（消除日光灯管反光），在 640px 宽度上呈现深邃柔和的环境悬浮投影与纯净毛玻璃底。

- **Tier 4: 模态对话框与大窗体（Dialog / DialogWindow / AlertDialog · 独立窗口）**：
  - **几何与层级**：外框圆角 16px ~ 20px（`var(--radius-panel)`），消费 `NB_Z_INDEX.dialog`（9300）及以上层级；
  - **模态保护**：配合全屏半透明遮罩与严格焦点锁定（FocusScope），支持外点阻断与键盘 Escape。

- **全局 Surface 基座升级（Elevation & Blur Upgrade）**：
  1. **立体微反光 4 阶柔影（`--elevation-popover`）**：
     - **白昼模式**：`0 0 0 1px rgb(0 0 0 / 0.08), 0 8px 24px -4px rgb(0 0 0 / 0.12), 0 16px 36px -8px rgb(0 0 0 / 0.16), 0 2px 6px -1px rgb(0 0 0 / 0.06)`；
     - **暗夜模式**：`0 0 0 1px rgb(255 255 255 / 0.10), 0 12px 28px -4px rgb(0 0 0 / 0.50), 0 20px 48px -8px rgb(0 0 0 / 0.65), 0 2px 6px -1px rgb(0 0 0 / 0.35)`；
     - 彻底废除老旧 `inset 0 2px ...` 生硬塑料反光条；
  2. **纯净自然滤镜（`--overlay-blur`）**：
     - 统一为 **`blur(8px) saturate(130%) brightness(1.0)`**；
     - 彻底纠正 `brightness(0.72)` 压暗 28% 导致的发脏浑浊，实现通透晶莹的现代玻璃质感。

#### 18. `QuickInput`（全局快速输入浮层 · S4 规范）
- **定位**：全局命令面板 / 快速输入的受控浮层原语；候选项、查询、活动项与执行语义全由宿主提供，组件不持有命令注册表、不做匹配与执行决策——`>` 命令、`:` 行号等前缀解析属宿主。props/emits 之外无自定义 slot、无 expose。
- **层级与 role（S4）**：消费 `NB_Z_INDEX.commandPalette`（9200，S4 全局命令面板角色）；模态 Dialog 语义（`DialogRoot` modal + `disableOutsidePointerEvents`），透明遮罩与 Content 同为 9200、Content 在后；外点被遮罩消费，不穿透底层。
- **几何**：视口顶部居中，宽 `min(640px, calc(100vw - 24px))`，`top: clamp(16px, 8vh, 72px)`，`max-height: min(560px, calc(100dvh - 48px))`；圆角为 **14px**（`rounded-[14px]`），输入区与底部提示固定、列表 `flex:1; min-height:0` 自滚动；390px 宽仍留左右 12px。
- **材质**：消费 `.nb-ui-popover-surface` 基座（4 阶立体微反光投影 + 130% 饱和滤波）与 `--nb-popover-pad`，选中项用 `--overlay-item-active`；不叠第二层磨砂、不新开材质档。
- **键盘与焦点**：输入框 `role=combobox` + `aria-activedescendant`；ArrowUp/Down 走 `moveHighlight`（跳过禁用、首尾回绕）并 `scrollIntoView(block:nearest)`；Enter 在组合输入态（`isComposing`）不提交；Escape 只关闭本层并 `stopPropagation`；Tab 交给 Reka FocusScope 后阻止冒泡——下层 document/window 监听不得收到这些按键。打开时记录触发前焦点，关闭后归还仍连接的元素。
- **关闭交接（`closed`）**：关闭不加退场动画；`closed` 在内容真实卸载、Reka 焦点栈/滚动锁/指针锁全部释放后按打开周期发一次，供宿主在关闭完成后再执行命令或激活下一个交互层。`AlertDialog` 的同名事件复用同一时序；宿主不得用固定等待毫秒数替代。
- **打开动效**：挂载时消费 `.nb-ui-popover-motion`（见设计语言 §七浮层入场配方）。

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
- **布局类随内容走，不随选中态走**。外壳给内容区套的布局类（`overflow`、内边距、`layout` 模式）
  必须挂在**当前被渲染的那一份内容**上（过渡内的 keyed 子元素）。挂在随「已选中区段」立即翻转的
  外层容器上时，`out-in` 期间仍在渲染的**离场内容**会被套上**下一份内容**的布局：
  滚动区段切走时表现为「闪一下贴边无间隙」，fill 区段表现为「临时被加上外内边距」。
- **区段/视图的接线清单**（新增一个区段时逐条过）：
  1. 单根，或明确把布局放自己根上；
  2. 在区段元数据里声明 `layout`（`scroll` 由外壳给内边距并拥有滚动，`fill` 自己占满、内部滚动）；
  3. **不接收** `loading` / `loadError`，加载与失败由外壳统一呈现（见 §4.3）；
  4. i18n 键归位：导航用 `settings.section.*`，视图内文案用 `settings.panels.*`；
  5. 注册进 Component Lab（fixture + 同名 `.md` + `registry`/`index` 场景）。

## 5. 表单与无障碍

1. 字段组件接入 `FormField` context：生成或接受 `id`，连接 `aria-describedby`，合并 `required`，错误时输出 `aria-invalid`。
2. 表单受控/非受控契约：所有表单控件（`FormInput`, `FormSelect`, `FormCheckbox`, `FormNumberInput`, `FormTextarea`, `Combobox`）的 `modelValue` 声明为可选并使用 `withDefaults` 赋予安全默认值，杜绝静态展示或非受控场景下的控制台告警。
3. nb-ui 持有的原生 input（公共组件内部 input 与 playground 自建控件）使用 `.nb-ui-native-input` 标记。`src/styles.css` 对 search decoration 和 number spinner 的抑制必须以该标记为作用域；未标记的宿主原生 input 保留浏览器默认伪元素。`PinInput type="number"` 保持 Reka 的 `type="text"`、`inputmode="numeric"`、`pattern="[0-9]*"` 数字键盘合同。
4. 可见标签优先。图标按钮必须有非空 `aria-label`；tooltip 不能替代可访问名称。
   反过来也成立：**说明「这一页 / 这一节是什么、会写到哪里」的元信息不该单独占一行**——它走 tooltip 或标题旁的 info 图标，只有影响判断的正文才占行。区段标题下挂一句 20 字以上的灰色说明是最常见的违反形态。
5. 复合选择控件必须暴露正确角色和状态，并支持预期方向键、Home/End、Enter、Escape。关闭浮层后焦点回到触发器。
6. 只读不等于禁用：只读字段可聚焦、可复制，不提交值变化；禁用控件不响应指针或键盘，也不进入正常 Tab 顺序。
7. `prefers-reduced-motion` 与 `prefers-reduced-transparency` 的公共降级规则优先于主题。动效只解释出现、消失、位置或状态变化，不承担必要信息。

## 6. 测试与交付

行为测试只守可观察合同：值变化、边界、键盘、焦点、ARIA、打开后的 portal 内容、滚动和错误状态。不得以源代码字符串或无意义的 class 快照代替行为；外观来源和公共登记类可以用窄断言防止职责回流。

每批组件完成时：

1. 更新组件类型、所有本仓调用方和 barrel 导出；
2. 增加或更新覆盖新合同的 happy-dom 测试；
3. 在 `/components` 组合画廊完成组件组合验收；
4. 同步 README 的公开用法与本文设计规范；
5. 依次运行 `bun run test`、`bun run typecheck`、`bun run build:css`、`git diff --check`；
6. 在真实 playground 验收桌面和 390px 窄屏，记录主题 × 配色、计算样式、键盘路径、控制台与页面错误；
7. 提交 `dist/nb-ui.css`，并明确阶段 2 尚未经 NeuroBook 主仓接入验证。

## 7. Component Lab（/lab 诊断实验室）开发与展示规范

`/lab` 是组件设计语言推演、动效手感调优、多主题/配色回归与 Token 即时诊断的唯一官方运行台。新增或优化组件时必须遵守以下规范：

### 7.1 三栏仪器式架构规范
1. **左栏导航（`LabNav` · 260px）**：
   - 顶部提供高斯磨砂悬浮即时搜索栏，支持跨中文名、英文名、分组与描述进行即时模糊过滤，右上角展示全库组件计数（`N / M`）；
   - 下部为按分类聚合的组件导航树，各组展示数量指示，所有滚动区域统一消费 macOS 极简悬浮滚动条规范，严禁出现浏览器原生粗重滚动条。
2. **中栏舞台（`LabStage`）**：
   - 顶部工具条提供场景（Scene）、视口断点（Responsive/Desktop/Tablet/Mobile）、主题（Theme）与配色（Colorway）切换；
   - 画布区域承载对应组件的 `*Fixture.vue`，支持透出窗体磨砂底纹。
3. **右栏检查器（`LabInspectorPanel` · 340px）**：
   - 提供 Token 即时采样器、CSS 变量实时 Override 注入器、事件日志实时流与可访问性状态检查。

### 7.2 Fixture（测试台用例）开发准则
1. **磨砂卡片容器（`.macos-compact-card`）**：
   - 所有组件展示必须包裹在 `.macos-compact-card` 容器中；
   - 必须使用 **75% 半透明高斯磨砂玻璃标准配方**：`background: color-mix(in srgb, var(--bg-panel) 75%, transparent);` 搭配 `backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);` + 1px 细微环境边框（`color-mix(in srgb, var(--border-color) 70%, transparent)`）+ 2 层立体悬浮环境柔影（`0 20px 48px -12px ...` 与 `0 2px 8px ...`），既能优雅透出窗体背景底纹，又保证前景色高对比度与典雅的 macOS Liquid Glass 质感。
2. **页面内多方案切换器（In-Page Scheme Switcher）**：
   - 当组件存在多种设计风格或展示形态（如 Button 的 4 种方案、IconButton 的 5 种风格、Listbox 的 4 种方案）时，**统一在 Fixture 页面顶部使用 `SegmentedControl` 进行就地平滑切换**；
   - 顶部切换条采用 75% 磨砂底座，配备统一的 `.scheme-banner`（`color-mix(in srgb, var(--bg-panel) 70%, transparent)` + 12px 模糊 + 1px 环境边框 + `scheme-pill` 方案解析胶囊 + <code> 等宽技术参数），直观陈述几何圆角、动效参数、透明度比例与业务适用场景。
3. **真实小说与工作区领域数据（Domain-Realistic Data）**：
   - Fixture 数据**严禁使用 `Foo / Bar / Test 1` 等无意义占位符**；
   - 必须使用与长篇小说创作、桌面写作工作区（NeuroBook）强相关的真实题材数据（如世界观设定集标签、出场人物档案与阵营状态、分卷章节大纲目录、电子书导出排版穿梭等）。
4. **事件与采样驱动（`lab-event` & `rendered`）**：
   - Fixture 必须通过 `emit('lab-event', name, payload)` 上报组件交互事件（如 `click`、`update:modelValue`、`change`）；
   - 在组件挂载与场景切换时，必须通过 `nextTick(() => emit('rendered'))` 触发右侧检查器的 Token 采样刷新；
   - 必须将核心可交互 DOM 节点绑定 `id="nb-lab-target"`，以便检查器准确定位并高亮目标节点。

### 7.3 注册表（`registry.ts`）声明规范
每个组件在 `registry.ts` 的 `labComponents` 中必须声明：
- `id`：kebab-case 唯一标识；
- `label`：英文原语名称；
- `labelZh`：中文规范全名；
- `group`：所属分类（`控制` | `表单` | `导航` | `布局` | `显示` | `反馈`）；
- `description`：一句话说明组件的定位与写作场景；
- `scenes`：至少覆盖 `default` 与 `disabled` 场景，多态组件可声明对应专属场景；
- `controls`：声明右侧控制面板支持的动态调优项（`type: "boolean" | "select" | "text" | "number"`）；
- `targetSelector`：目标选择器（如 `"#nb-lab-target"`）；
- `events`：监听的可观察事件列表。

## 8. 全库组件工业级微物理与动效工程规范（Frontend UI Engineering 落地标准）

依据 `frontend-ui-engineering` 标准，全库 48 个组件已完成逐一深度优化与物理动效装配：

1. **按压物理回弹（Active Spring）**：
   - 交互按钮类（`Button`, `IconButton`, `SegmentedControl`, `ToggleGroup`, `Pagination`, `CalendarPrev/Next`）统一装配 `not-disabled:active:scale-[0.93~0.975]` 物理弹性回弹；
   - 禁用态（`disabled`）严格通过 `disabled:active:transform-none` 屏蔽位移与缩放，杜绝误导性交互反馈。
2. **GPU 加速与平滑位移（Hardware Accelerated Transforms）**：
   - 滑块（`SegmentedControl`, `Switch`, `Slider`, `Progress`）指示物统一使用 GPU 硬件加速的 `transform: translateX(...)` / `translateY(...)` 进行位移，杜绝 `left`/`top` 引发的重排重绘；
   - 动效时长精确消费 `--motion-fast` (120ms) / `--motion-base` (180ms) / `--motion-enter` (220ms)，缓动统一消费 `--ease-standard`。
3. **零 `transition-all` 性能铁律**：
   - 过渡属性必须显式枚举（如 `transition-[background-color,color,transform,box-shadow]`），禁止使用 `transition-all`；
   - 100% 通过 `token-consumption.test.ts` 静态扫描。
4. **WCAG 2.1 AA 键盘导航与焦点管理**：
   - `Tabs`, `SegmentedControl`, `Dropdown`, `Menubar`, `Tree`, `Listbox`, `Combobox` 等复合组件全面支持 `ArrowUp/Down/Left/Right`, `Home/End`, `Enter/Space`, `Escape` 键盘导航并联动焦点环（`.nb-ui-focus-ring` / `--focus-ring`）。
   - `Tree` 的 `modelValue` 对外始终使用节点 `id`：单选为 `string | undefined`，多选为 `string[]`；组件内部负责把 id 映射为 Reka TreeRoot 所需的节点对象，并把更新事件映射回 id，调用方不得持有原语内部节点对象。
   - `Tree` 的选中行使用整行淡强调底、强调文字与中等字重，不使用常驻左边框或指示条；层级只由缩进与展开箭头表达，焦点继续由 `.nb-ui-focus-ring` 独立表达。
5. **Component Lab 5 方案多态体系（5-Scheme Lab Matrix）**：
   - 全库 47 个组件 Fixture 均配备完整的 5 方案推演矩阵（macOS 经典、现代极简、悬浮微晶发光、精工工控刻度、实底高反差），并在页面顶部集成 `SegmentedControl` 即时切换与 `.scheme-banner` 设计解析胶囊；
   - 严格绑定真实长篇小说写作与 NeuroBook 领域数据，保证组件在真实界面场景下的层级与材质一致性。

## 9. Dropdown 与 Popover 浮层 Surface 黄金标准规范（FormSelect 唯一样式源）

全库所有下拉菜单（`Dropdown`）、选择器（`FormSelect`）、命令面板（`QuickInput` / `WorkbenchCommandPalette`）与弹出浮层必须严格以 `FormSelect` 的黄金调优标准为唯一样式规范：

1. **底色与对比度（65% 温润白底 / 75% 烟熏深底）**：
   - 亮色模式：`--overlay-surface: color-mix(in srgb, var(--bg-panel) 65%, transparent);`，提供一层温润半透明白底，保证浮层内文字具有充分对比度与可读性，杜绝过薄透明（如 14%）导致的底层正文透光干扰与眩光；
   - 暗色模式：`--overlay-surface: color-mix(in srgb, var(--bg-panel) 75%, transparent);`，采用 75% 烟熏深底，既稳稳托住文字层级，又能透出背景微弱折射光感；
   - 高对比度 / 降低透明度模式：`--overlay-surface: var(--bg-panel);` 彻底回退实心面板底。
2. **高阶微滤波（8px 模糊 + 130% 饱和度）**：
   - 统一消费 `backdrop-filter: blur(8px) saturate(130%) brightness(1.0);`，避免大半径模糊与复杂 SVG 折射引发的边缘文字走样或错位。
3. **4 阶立体微反光环境柔影**：
   - 统一消费 `--elevation-popover`：`0 0 0 1px color-mix(in srgb, var(--text-main) 8%, transparent), 0 6px 16px -2px color-mix(in srgb, var(--shadow-color) 16%, transparent), 0 20px 48px -4px color-mix(in srgb, var(--shadow-color) 28%, transparent), 0 36px 80px -8px color-mix(in srgb, var(--shadow-color) 20%, transparent)`，外发散柔影与 1px 微反光边缘兼备。
4. **单一样式源与组合子（`useDropdownFloating` / `useDropdownSurfaceStyle`）**：
   - 任何涉及下拉与浮层的组件，严禁在模板中重复书写内联样式，统一调用 `useDropdownFloating` 或 `useDropdownSurfaceStyle`，自动注入标准 `popoverClasses`、`popoverStyle`、同心圆角视口与避让 Trigger 发光圈的 `side-offset: 7`。



