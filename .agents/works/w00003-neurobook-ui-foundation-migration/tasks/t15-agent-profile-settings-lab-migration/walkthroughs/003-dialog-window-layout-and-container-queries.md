# t15 Walkthrough 003 — DialogWindow 规格重构与 CSS Container Query 闭合

## 背景

开发者指出：
1. 删掉 `AgentProfileSettingsViewFixture.vue` 顶部的固定预览提示行（`仅供预览：修改只保留在本次场景，不写入真实配置。`）；
2. 明确指出该组件**后续是要放到 dialog window 中**的，因此原先横跨 1340px 的全宽顶部 `<header>`（包含大标题、作用域和保存按钮）显得怪异且与 DialogWindow 自带的窗口标题栏形成双重标题栏冲突。

## 重构与优化

### 1. 消除冗余顶栏，双栏从顶部自然铺展
- 彻底移除 `AgentProfileSettingsView.vue` 最外层的 `<header>` 元素；
- 避免组件嵌入 `DialogWindow` 时与窗口原生标题栏（Titlebar，含窗口标题、拖拽把手、关闭按钮）重叠冲突；
- 左侧 `AgentProfileNavList` 面板和右侧详情工作区面板直接从顶部平整展开。

### 2. 底部固定动作栏（Footer Action Bar）
- 依据标准弹窗/浮动窗口规格，将操作栏下沉到组件底部：`<footer class="flex shrink-0 ... border-t border-[var(--divider)] ...">`；
- **左侧状态感知**：
  - 作用域徽标：`<Badge tone="neutral" size="sm" variant="soft">{{ scopeLabel }}</Badge>`（「全局设定」或「项目设定: xxx」）；
  - 脏状态提示：仅在有未保存修改时浮现 `<Badge tone="warning">有未保存的修改</Badge>`，修改保存或放弃后自动消失；
  - 错误与保存中提示：就地在底部左侧紧凑展示，不再于主体上方横插破坏双栏布局的通知行。
- **右侧动作按钮**：
  - 「放弃修改」：无脏数据时置灰禁用（`:disabled="busy || !hasDirty"`），避免误操作并清晰反馈状态；
  - 「保存修改」：有有效修改且校验通过时高亮激活，点击保存后更新内存基线。

### 3. 严格遵循计划：CSS Container Queries (`@container`) 与双向焦点流转
- 闭合此前文档记录的“按浏览器视口而非组件容器断点”的已知偏差；
- 根元素声明 `container-type: inline-size;`；
- 通过 `@container (max-width: 699px)` 监听**组件自身容器宽度**：
  - 容器宽度 `<700px` 时（例如在 Lab 390px 手机画布、手机视口或窄尺寸 DialogWindow 内），自动进入单列移动端模式；
  - 详情工作区顶部提供「选择 Profile」按钮，点击呼出全宽导航并将焦点精准转移给导航顶部的「返回详情」按钮；
  - 展开的移动导航顶部提供「返回详情」按钮，点击关闭导航并将焦点精准归还给「选择 Profile」按钮；
  - 在导航列表中点选任意 Profile 项时，自动折叠导航并聚焦详情标题（`tabindex="-1"`），焦点流转完全闭合；
  - 容器宽度 `≥700px` 时，自动恢复标准桌面双栏，移动端切换条完全隐藏。

### 4. 清理 Fixture 顶部横条与弹性自适应高度
- 删除了 `AgentProfileSettingsViewFixture.vue` 顶部的灰色预览提示条；
- 调整 fixture 容器高度为 `h-full min-h-[560px] max-h-full w-full` 弹性自适应，不再硬编码固定高度导致不同视口截断或多余滚动。

### 5. 同步规范（Spec）条款
- 同步更新 `docs/specs/ui/agent-profile-settings.md`：
  - 将输出与可观察行为更新为无内置全宽顶栏、底部固定动作栏（DialogWindow 规格）；
  - 明确 CSS Container Query 容器断点响应与移动端双向焦点归还；
  - 在实现合同中明确组件入口、拆分架构、数据流与测试命令。

### 6. 窗口内单层 chrome：flush 布局
- 开发者反馈：内嵌 Dialog 时窗口标题与导航 `Agent Profiles` 标题重复；隐藏导航标题后左侧只剩一个搜索框，反而更不和谐。
- 浏览器实测（1157×919、DPR 1.25、浅色配色）确认真正的问题是双层边框：窗口自身有描边和 12px 圆角，窗口内又套两张 `--radius-panel` 卡片，卡片圆角（20px）比窗口还大，底部动作栏的 8px 内边距也与窗口标题栏的 16px 不对齐。
- 因此不再用「卡片套卡片」的独立页面布局，而是让视图在窗口里只留一层 chrome：
  - `AgentProfileNavList` 新增 `surface="plain"`：根 `nav` 不再画描边、圆角、底色和内边距，面与分割线交给宿主（旧宿主 `NovelIdeAgentProfileModelSettingsPanel` 继续用默认 `panel`）；
  - `AgentProfileSettingsView` 只保留无面形态：删掉 `layout` 属性（宿主只有设置对话框这类浮层，卡片档没有消费者），导航轨补 16px 内边距、轨宽 276px 以保持内容宽度，详情与底部动作栏同样 16px，与标题栏 `pl-4` 对齐；
  - `AgentProfileSettingsViewFixture` 的 `dialog-window` 场景只保留 `show-nav-heading=false`；独立场景同样是无面线条布局，只是保留导航视觉标题。
- `DialogWindow` 的拖拽把手图标（`i-lucide-grip-vertical`）从标题栏删除：拖动区域本来就是标题栏容器，图标只是装饰；nb-ui 组件测试断言不再渲染该图标。

### 7. 框与线的分工：区段标题去框、栏间竖线两端收弱

- 开发者反馈两点：独立场景仍在用圆角卡片分割；窗口里的竖线「生硬」，与设计风格冲突。
- 定位：窗口内仍有 5 处整条描边 + 填色的圆角框（`Collapsible` 触发器：高级模型参数、运行策略覆盖、通用运行默认值、Profile 预设、默认模型高级区）。它们与同页真正的标题行（使用模型、诊断与维护）视觉不同源，读起来既不像标题也不像控件。竖线则是整条 `border-right`，在标题栏与底栏两处横线上交出直角。
- 处理：
  - 5 个触发器改为静止态无框的标题行：去掉 `border` / `bg-[var(--bg-input)]` / `px-2.5`，保留图标、文本、徽标、chevron 与 hover 底色，`gap` 与标题行统一为 `--space-1.5`；焦点环改用本目录统一的 `focus-visible:shadow-[var(--focus-ring)]`。
  - 栏间竖线由 `border-r` 改为 `background-image` 上的 1px 渐变：`transparent → var(--divider) 10% → var(--divider) 90% → transparent`，两端各渐隐 10%。
- 判据写进设计语言 §二「什么时候画框，什么时候用线」：线条给「同一容器里的顺序分段」，圆角框给「可交互的单元」或「需要框住的面」；区段标题静止态带描边与填色即判错。另加一条「竖分割线两端收弱」。

### 8. 内容列封顶

- 开发者反馈：窗口放大后「还是有点不太自然」。
- 浏览器复现（1442×1155、浅色、窗口 1400×1112）读到：详情滚动区 1122px，其中下拉框实测 **1090px 宽**——表单控件随窗口无上限拉伸，「选择默认模型」变成一条整行宽的横条。
- 处理：详情滚动内容包一层 `max-w-3xl`（768px）。控件、字段与区段分隔线都落在内容列内；导航轨、窗口标题栏仍贴窗口边缘（它们是窗体 chrome，不封顶）。底部动作栏在下一节一并移入内容列。
- 判据写进设计语言 §三「内容列有上限宽度」与检查表：窗口拖到 1400px 以上时，内容列宽度不再增长、任一控件宽度 ≤ 内容列宽度。smoke 增加对应断言（内容列 ≤ 769px 且不超过滚动区宽度）。
- 同时对比过「导航轨加底色、去掉竖线」的方案（macOS 侧栏式）：观感可行，但它等于在浮层里再加一层有色面，与本轮刚写进设计语言的「浮层内分栏不给面」冲突，因此不采用，保留竖线（竖线本身在下一节改回与其他线同款）。

### 9. 线条层次与动作栏归属

- 开发者反馈：竖线不要用虚化，和别的线保持一致；横线不能穿过竖线（竖线优先级更高）；底部动作栏 `div > div > div > footer`（1146 × 35）没有优化；DialogWindow 内嵌也有同样问题。
- 诊断：原先竖线是两端渐隐的背景线，与区段横线不是同一种线；底部动作栏是双栏行的兄弟节点、`border-t` 横跨整个窗口，于是「标题栏横线 + 竖线 + 动作栏横线」读成一个「工」字，横线在竖线下方横穿。
- 处理：
  - 竖线改回 `border-right: var(--border-w) solid var(--divider)`，与区段横线同款同色，不再渐隐；
  - 结构改为「导航轨 + 右列（详情 + 动作栏）」：导航轨独占双栏行的整高，其竖线从标题栏连续走到窗口下沿；动作栏移入右列，上边线从竖线右侧开始，不再横跨侧栏；
  - 动作栏内部同样用 `max-w-3xl` 封顶，徽标与按钮和上方字段左右对齐。
- 判据写进设计语言 §二：竖线划分区域、横线划分区域内的段落，相交时横线收住、竖线连续走到底；横线横穿竖线即判错。检查表把原来的「竖线两端收弱」替换为「竖线不被横线穿过」与「竖线与同类横线同款」。
- smoke 断言（本节实施后由下一节扩充）：竖线画在导航轨上、动作栏上边线左右起点 ≥ 竖线 x、竖线底端 ≥ 动作栏顶边。

### 10. 竖线两端留边距 + 改成就地保存

- 开发者反馈三点：竖线应该和横线一样在边缘留一点空间；底部动作栏「逻辑不对」，建议不要保存按钮、改成就地保存；DialogWindow 内嵌仍有 T 形线条。
- 诊断：竖线原本两端顶到标题栏分隔线与窗口下沿，于是与标题栏的横线交成 T 形；底部动作栏承载的保存/放弃按钮把「改完再提交」的模型硬塞进一个内容列，既占位置又和「改完立即生效」的字段编辑不一致。
- 处理：
  - 竖线改为 `::after` 伪元素：`top/bottom: var(--space-6)`，与横线两端的内边距同值，四条边都不贴边，T 形消失；单列断点下不画竖线。
  - 就地保存：删除 `baseline` prop 与 `save` 事件、未保存比较、放弃修改确认弹窗与两个按钮；底部动作栏降级为只读状态条（作用域徽标 + 保存中 / 保存失败 / 常态提示）。fixture 每次修改后立即推进内存快照并提示「改动已就地保存到本次预览」；`save-error` 场景模拟失败：草稿保留、`saved` 不推进。
  - `AgentProfileNavList` 的 `dirty` / `defaultsDirty` 改为可选（旧宿主继续传，视图不再传），i18n 删除 `discard` / `saveChanges` / `discardConfirmTitle` / `discardConfirmBody` / `saveHintPreview`，新增 `savingHint` / `autoSaveHint`。
- 判据写进设计语言 §二：竖线两条要求（两端留边距、不被横线穿过）；检查表同步两条。
- 取舍：没有显式放弃意味着误改会立刻持久化，撤销只能靠宿主的版本能力；保存失败必须由宿主重试，视图只保证草稿不被丢弃。

### 11. 去掉底部栏、标题居中、修关闭按钮

- 开发者反馈三点：`footer > div`（768 × 24）可以删掉；DialogWindow 标题可以居中；DialogWindow 关闭按钮没做好。
- 诊断：
  - 底部状态条在就地保存后只剩「作用域徽标 + 自解释文案」，是纯占位；
  - 关闭按钮是 `md`（32×32）且标题栏高度由它决定（33px），悬停底色顶满标题栏上下沿，10px 圆角又与窗口 12px 圆角贴在一起，读成一大块灰；
  - 标题左对齐，与 macOS 的窗口标题习惯不符。
- 处理：
  - 删除整个底部动作栏。作用域徽标（`scopeLabel`）移到导航轨底部与导航同列；保存中 / 保存失败改为内容列顶部内联（`v-if` 只在有状态时渲染），常态不占位；i18n 删除 `autoSaveHint`。
  - DialogWindow 标题栏：左右各放一个 26px 占位（有 `closable` 时），标题用 `flex-1 text-center` 严格居中；关闭按钮从 `md`（32）改 `sm`（26），栏高 `min-h-9`，按钮距窗口上沿 6px、右沿 17px，避开窗口圆角。
- 实测：`{barHeight: 36, titleCenterOffset: 0, button: {w: 26, gapTop: 6, gapRight: 17}, footers: 0, scopeBadgeInRail: true}`。
- smoke 断言更新：窗口内 `footer` 数为 0、内容列直接落到窗口底边、标题中心偏移 ≤ 2px；内容列封顶断言保留。

### 12. 标题对齐改为可选、去掉作用域徽标

- 开发者反馈：标题位置做成可选、默认仍放左边；导航轨底部的 `div.shrink-0`（244 × 20，作用域徽标）要删掉或换位置。
- 处理：
  - `DialogWindow` 新增 `titleAlign?: "left" | "center"`，默认 `left`（不改变既有消费者）；`center` 时在关闭按钮一侧补等宽占位，标题落在标题栏正中。Lab 的 `dialog-window` 场景显式传 `title-align="center"`，保留上一轮确认过的观感。
  - 删除导航轨底部的作用域徽标，并清掉随之失效的 `scopeLabel`、`context.targetLabel`、i18n `scopeGlobal` / `scopeProject` 与未使用的 `Badge` 导入。理由：作用域是宿主 chrome 的职责（Lab 场景名、产品设置对话框都已有作用域切换），视图只保留 `context.scope` 参与继承解析。
- 回归：nb-ui 新增用例「默认左对齐、传 center 才居中」；Dialog smoke 断言改为「无 `footer` 且内容列直接落到窗口底边（`bottomGap ≤ 2`）」，标题居中断言保留（fixture 传 center）。

### 13. 标题里拼作用域、既有消费者显式左对齐

- 开发者要求：用 `header` slot 把作用域拼进窗口标题；既有消费者显式写 `left`。
- 处理：
  - `AgentProfileSettingsViewFixture` 的 `dialog-window` 场景改用 `header` slot：`Agent Profile 设置` + 变弱色的 `· 全局设定`（作用域文案取 i18n `scopeGlobal` / `scopeProject`，项目作用域带 `示例项目`）。整段仍由 `DialogTitle` 承载，是窗口的可访问名。
  - 既有四个消费者（`DialogWindowFixture`、playground `components.vue`、`AgentContextInspectorDialog`、`AgentJobsDialog`）显式写 `title-align="left"`；Lab 的场景保持 `center`。
- 实测：标题文本 `Agent Profile 设置 · 全局设定`，中心偏移 `0`；smoke 增加「标题由宿主拼出页面身份与作用域」断言（标题元素改按 `aria-labelledby` 取，不再靠 `h2` 猜）。

### 14. 作用域承载、焦点光裁剪、折叠标题行抽组件

- 开发者反馈三条：真实设置界面不只有全局设置（还有启动 / 浏览器等作用域），这些怎么承载；`FormInput` 聚焦后的光被外层裁断；折叠标题行是否该抽成通用组件、样式也要优化。
- 作用域：核对宿主 `NovelIdeSettingsDialog.vue` —— 它自己有四档 scope（`boot` 启动配置 / `global` 全局配置 / `project` 项目配置 / `browser` 浏览器状态）与每个 scope 的 section 矩阵，`agent-profile-models` 只出现在 `globalConfigSections` 与 `projectConfigSections`。视图的 `ConfigSettingsScope = "global" | "project"` 与这张矩阵一致：作用域轴由宿主 chrome（scope 切换器 + 标题）承载，视图只接收已解析的 `context.scope` 用于继承层序，不自己再表达作用域。
- 焦点光裁剪：`AgentProfileNavList` 根 `nav` 上的 `overflow-hidden` 把搜索框的 focus glow 在顶边切掉（`nav` 顶边与输入框顶边重合）。改为只在 `surface="panel"`（卡片圆角需要裁剪）保留，`plain` 档不裁。实测 `nav.overflow = visible`，光完整包住输入框。
- 抽组件：5 个区段里逐字重复的折叠标题行收敛为 nb-ui `CollapsibleSection`（图标 + 标题 + `meta` 插槽 + chevron），`Collapsible` 仍是裸触发器。样式同时收紧：行高 `min-h-9` → `min-h-8`、图标与 chevron 在悬停 / 展开转 `--accent-main`、悬停底色降到 `--bg-hover` 的 60%（整条满色读起来像输入框）、`select-none`、过渡改用 `--motion-fast` / `--motion-base` token。

### 15. 悬停底色留边、删批量恢复默认、补折叠动画

- 开发者反馈三条：`CollapsibleSection` 的悬停底色左右没有留 margin；诊断区那一行「已经能自动保存了，是否可以删掉」；给 `CollapsibleSection` 按 UI 规范加动画。
- 行内缩：整行（底色 + 图标 + 文本）在列内左右各让 8px——`mx-[var(--space-4)] w-[calc(100%-2*var(--space-4))]`，底色就是按钮本身。第一版只把底色单独做成内缩图层、内容仍贴列边缘，结果图标露在底色外（开发者截图指出）；`<button>` 的 `width: auto` 是 fit-content，必须显式给宽度。实测 `rowInsetLeft / rowInsetRight = 8`、`iconInset = 6`、行 752×32。
- 删除批量「恢复默认」：就地保存下它会立即写盘且没有撤销入口，而逐字段的继承 / 默认选项足以达到同样效果。连带删除 `reset` 事件链（诊断区段 → 详情面板 → 视图 `resetActiveDefaults`）、`Tooltip` 导入、i18n `resetProfileDefaults` / `resetDefaultsHint`、区段 fixture 的 `@reset` 与 `cloneLowCodeObject` 导入。**「重置 Home」保留**：它是独立的破坏性能力，已有确认弹窗。
- 折叠动画：`Collapsible` / `Accordion` 原本写的是 `data-[state=open]:animate-collapsible-down`——`animate-*` 的可选键要在 UnoCSS 主题里登记，而项目用的是 `presetUno()`，这个键不存在，**动画从来没有生成过**；`styles.css` 里的 `.animate-collapsible-*` 一直是死代码。改为状态属性驱动的样式表规则，动画真正生效（探针读到 `getAnimations()` 返回 `nb-accordion-down`）。该坑已登记进设计语言坑表 #47，smoke 增加「展开必须走高度动画」断言。
- chevron 旋转与状态反馈按 §七 时长刻度改回 `--motion-fast`（原为 `--motion-base`），内容高度动画仍是 `--motion-base`（控件形变档）。

### 16. 行宽对齐、默认页顶线、删除诊断区段

- 开发者反馈三条：`CollapsibleSection` 高亮时的宽度没有和其他元素对齐；默认设置页最顶上有一条横线看着不对；「诊断与维护」可以删了。
- 行宽对齐：上一版把整行左右内缩 8px，高亮底色因此比区段分隔线与控件窄 16px。改为**底色占满整列宽度**（与分隔线、表单控件同宽），内容用 `px-[var(--space-3)]` 退让 6px——「要不要留边」问的是内容与底色边缘的关系，不是底色与列边缘的关系。实测 `band {l:0,r:0,w:768}`、`section {w:768}`、`iconLeftInBand 6`。
- 默认页顶线：`AgentProfileDefaultsPanel` 里 `<AgentProfileDefaultProfileSection>` 只写了使用、**没有 import**——Nuxt 无法按短名解析（组件名会带路径前缀），于是它被渲染成一个空的自定义元素（高度 0、无内容），最上面那条横线其实是下一个区段（默认参数）的 `border-t`。补上导入后：默认 Profile 选择器回来了，顶线也随之消失（它现在分隔的是默认 Profile 与默认参数两段）。
- 删除诊断与维护：连同 `AgentProfileDiagnosticsSection.vue` / `.md`、详情面板的 `reset-home` 事件与 `resetHomeDisabled` / `resettingHome` props、视图的 `reset-home` 事件与确认弹窗（`requestResetHome` / `confirmResetHome` / `cancelResetHome` / `resetHomeDialogOpen` / `pendingResetHomeKey` / 弹窗 JSX 与 `AlertDialog` 导入）、`resettingHomeKey` prop、区段预览 fixture 与注册表条目、i18n `settingsView.diagnostics` / `settingsView.buildStateReason` 一并清除。旧宿主自己的「重置 Home」仍保留（不属本 Task）。

### 17. LowCodeForm 的下拉换实现、折叠容器不剪光环

- 开发者反馈：专属设置里那个 FormSelect「surface 不对」，聚焦后发光还被外层截断。
- surface：`LowCodeSelectField` 一直用旧的应用内下拉（`app/components/common/form/FormSelect.vue`）——自绘、`rounded-md`、面板是不透明 `--bg-panel` + `shadow-xl`，与面板里其它 nb-ui 控件不是同一套材质。改为 `@notnotype/nb-ui/components` 的 `FormSelect`（属性形状一致，直接替换），下拉从此走 `.nb-ui-menu-surface` 磨砂表面，实测 `backdrop-filter: blur(8px) saturate(1.3) brightness(1)`。
- 光环被剪：折叠内容为高度动画必须 `overflow: hidden`，裁切盒等于内容盒，而控件贴满内容盒时光环画在盒子外面。给 `.nb-collapsible-content` / `.nb-accordion-content` 加 `padding: 6px` + `margin: -6px`：子元素位置与尺寸不变，裁切边界向外放 12px。实测控件两侧到裁切边缘各 6px 余量，光环完整。
- 该现象与修法登记进设计语言坑表 #48（并注明不要用「给内容加 padding」把控件推进来，那会让控件与同列元素错位）。

### 18. LowCodeForm 其余字段控件全部换成 nb-ui

- 开发者要求：其余 LowCode 专属设置表单组件也一起改。
- 处理（只换控件实现，不动字段语义与 mutation 逻辑）：
  - 文本 / 数字 → nb-ui `FormInput`（`type`、`step`、`min`、`max` 原样透传）；多行 → nb-ui `FormTextarea`（`rows`，禁用走 `disabled` 而不是 `pointer-events-none`）。
  - 开关 → nb-ui `Switch`；单选 → 无描述时 nb-ui `SegmentedControl`、有描述时 nb-ui `RadioGroup`；多选 → nb-ui `CheckboxGroup`。后两者用 `optionKey` / `optionByKey` 做 string key 与原始 JSON 值之间的映射——低代码选项值可以是 number/boolean，而 nb-ui 这些组件的值是 string。
  - 资源预设字段：`FormSelect`、表单内 `<input>`、资源内容 `<textarea>`、两个 `<Dialog>`、管理器里的六个手写按钮与删除图标按钮，全部换成 nb-ui `FormSelect` / `FormInput` / `FormTextarea` / `Dialog` + `Button` / `IconButton`；颜色与圆角 token 从 `--border-color` / `bg-input` 收口到 `--panel-outline` / `bg-subtle` / `--radius-control`。
  - 下拉组合框（`combobox` 字段）没有语义等价的 nb-ui 组件（nb-ui `Combobox` 是自由文本 + 联想，本字段是「选一个选项」）。保留实现，触发器改用 `.nb-ui-control` + `nb-ui-control-h-sm`（自带描边、内阴影、focus 辉光与 `data-state=open` 态），面板改用 `.nb-ui-popover-surface .nb-ui-menu-surface`，列表项挂 `.nb-ui-popover-item`。
- 结果：`app/components/common/low-code-form/` 下不再有指向旧 `app/components/common/form/*` 或旧 `Dialog` 的引用；专属设置里的下拉、文本域、开关、单选、多选与面板其它控件同一套材质。

### 19. 身份区信息层次与区段分隔线

- 开发者指出身份区（红框）需要优化。
- 诊断：标题区是四行小字堆叠——名称 + 徽标 / 描述 / `profileKey` / `源文件: …`，后两行同色同字号各占一行，且第一段（身份）与下一段（使用模型）之间没有分隔线，而同页其它区段边界都有。
- 处理：
  - 描述改成 `mt-1.5 leading-relaxed`；`profileKey` 与来源路径合并成一行等宽元数据（`fact-reviewer · profiles/fact-reviewer.profile.ts`，中间用 `·` 分隔，路径截断并带 `title`），四行收敛到三行，`源文件:` 标签随之删除（i18n `sourcePath` 已无消费者，一并移除）。
  - 给「使用模型」与「专属设置」两个区段补 `border-t pt-3`：现在每两个区段之间都有一条线，身份区（首段）不带线。
- 过程中另修一处环境问题：`/lab` 一度 500，日志是 `Agent Session Store 正被另一运行实例使用 … runtime.lease`（持有者 pid 是上一次 dev 进程树里残留的 runtime）。按租约提示「owner 仍存活时不要删 lock」，改走 `hub restart` 重启服务，租约随进程退出释放，页面恢复 200。

## 验证事实

1. DialogWindow 内嵌场景使用默认 `body` Portal；Dialog smoke 已验证打开时 rect `left=328, top=64, right=1428, bottom=844`、viewport `1440×900`、页面 `scrollWidth=clientWidth=1440`，以及 DialogWindow body 内 FormSelect 下拉层级高于窗口。
2. 同一 smoke 验证 3 个 resize handles、键盘调宽、关闭和重开可见；未把 Dialog DOM 声称为 `.nb-lab-stage-box` 的后代，也未引入局部 portal 宿主。
3. Dialog smoke 的线条、布局与就地保存断言：导航轨竖线由 `::after` 画在轨内、`top`/`bottom` 均为 16px（两端留边距）、轨自身无描边；根 `nav` 与详情 `section` 描边为 `0px`、`nav` 内边距为 `0px`；窗口内 `footer` 数为 0 且内容列直落窗口底边；标题中心偏移 ≤ 2px（fixture 传 `title-align="center"`）；内容列封顶 ≤ 769px。
4. 浏览器实测（1440×900 暗色与 1157×919、DPR 1.25 浅色）：窗口标题、搜索框与底部「全局设定」左边缘同为 16px；标题栏不再出现拖拽把手图标。1530×918 实测竖线 `top/bottom` 计算值为 `16px`、宽 `1px`，动作栏按钮数 `0`。
5. DPR 2 放大截图复核：竖线两端均与横线脱开（不贴标题栏分隔线、不贴窗口下沿）；默认设置页与 Profile 详情页的区段全部由横线分隔，静止态带描边的只剩真正的控件（搜索框、下拉、按钮），动作栏只有作用域徽标与保存状态文字。
6. 宽窗口实测（1442×1155、浅色、窗口 1400×1112）：封顶前下拉框宽 1090px、内容列随窗口增长；封顶后内容列 768px、下拉框不超过内容列，导航轨与底部动作栏仍贴窗口边缘。smoke 断言覆盖该项。
7. `AgentProfileSettingsViewFixture` 数据 sink 现在同时监听 draft、baseline、message，保存后数据面板立即反映新的内存基线与提示。
8. 分层后的 core smoke、Agent Profile smoke 与完整组合 smoke 均已在 3001 最新代码上通过；t15 聚焦集合 9 文件 / 36 个测试通过（移除 3 条放弃修改弹窗用例，新增 1 条就地保存用例）。
9. `vue-tsc --noEmit -p packages/neuro-book/tsconfig.json`：0 错误。
10. t15 聚焦集合：9 个文件 / 38 个测试全通。
11. `bun run docs:check`：0 失败；`bun run governance:check`：0 失败、0 warnings。
12. `git diff --check`：通过；仅显示 Windows LF→CRLF 提示。
13. `packages/neuro-book/eval-tmp.ts` 严格保留未动。
