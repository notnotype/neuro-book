# 前端领域规范

适用：新应用前端（`packages/neuro-book/src/web/**`、`src/plugins/*/web/**`）中的 Vue、HTML、CSS 和客户端交互。通用与语言规则由 [`README.md`](README.md) 路由；目录专属合同见最近的 `AGENTS.md`。

## Vue 与交互

- 使用 Composition API 和仓库现有函数式风格；props、emits、slot 与 template ref 保持类型完整。派生状态用 `computed`，`watch` 只承载副作用并负责停止订阅、计时器和请求。
- 通用能力优先复用现有组件、错误映射、通知和面板工具；具体入口由最近的作用域 `AGENTS.md` 登记。
- 交互控件使用语义 HTML、键盘可达名称、正确的 disabled/focus 状态；图标按钮提供可访问名称或 Tooltip。用户文字面向第一次使用 NeuroBook 的普通作者。
- 从深层 `ref`、`reactive`（含响应式的 `Map`、`Set`）取出的是代理：要交给结构化复制的值（写配置、`postMessage`、IndexedDB）不放进去，`structuredClone` 会对代理抛错，用 `shallowRef` 或交出前 `toRaw`；拿取出的值与原对象比身份（`===`、作 `Map` 或 `Set` 的键）时，先 `toRaw` 再比。
- 列表 key 来自稳定实体身份。昂贵派生不在 template 重复调用；布局尺寸使用稳定约束，避免加载、hover 或长文本造成跳动和遮挡。
- `.vue` 单文件组件达到或超过 1200 行是硬审查线。新增职责前按稳定边界拆出组件、composable、store 或领域模块。

## CSS 与主题

- 普通界面颜色只消费 [`theme.system`](../../specs/theme/system.md) 登记的语义变量；新增变量同步主题文档与全部内置主题。
- 决定某块区域用玻璃、实心还是不给面时，判据在 [`packages/nb-ui/docs/ui-development-spec.md`](../../../packages/nb-ui/docs/ui-development-spec.md) 的“材料、颜色与层级”，取舍理由在 [`packages/nb-ui/docs/design-language.md`](../../../packages/nb-ui/docs/design-language.md)。这两份规范此前只从 nb-ui 内部路由得到，主应用侧改样式的人找不到，材料语言因此被逐页重新发明过。
- 样式由组件或语义 class 拥有，保持低特异性；动画尊重 reduced motion，文本、焦点环和状态色保持可辨识。
- 应用的样式入口是 Tailwind v4，层序 `theme, base, components, utilities`，nb-ui 的源码由应用一起编译（写法见 [`packages/neuro-book/src/web/tailwind.css`](../../../packages/neuro-book/src/web/tailwind.css) 与 `packages/nb-ui/src/tailwind.css` 的头注释）。分层的原子类压过 components 层和 nb-ui 的语义类，却会输给不分层的样式：特异性低于一个类的全局规则（reset、`html`/`body`/`*` 上的声明）要放进 `@layer base`，否则它会压过所有原子类。
- 固定格式控件、面板或网格使用 `min/max`、grid track、`aspect-ratio` 等稳定约束；长文本必须换行或动态收敛，不遮挡相邻内容。

## 受控视图

宿主负责状态、视图只负责渲染。工作台的通用 View 按这里走（[视图宿主提案](../../proposals/workbench-view-host.md)继承这一节）。这些规则来自旧应用设置界面的经验，新应用还没有共享实现；失败多半是静默的：没有报错、编译通过，截图里才发现不对。

设置窗口不是这个模型：它是即时生效或显式保存，见 [`settings-window`](../../specs/settings/settings-window.md)。下面第 3 到 6 条只适用于自动写回的视图。

### 数据与写回

1. **一份数据源**：同一份配置只取一次快照（按“作用域加配置目标”为键），视图不自己取数。N 个视图各取一次就是 N 次请求加 N 份互不相同的时序。
2. **草稿归宿主**：视图对 props 只读，改动只 emit；草稿、保存态、失败态都由宿主持有。视图里出现可写副本，迟早有两份真相。
3. **写回上下文随草稿捕获**：防抖写回落地时，用户可能已经切了作用域或配置目标。这份草稿属于哪个目标，在构建草稿时就记下（例如作为草稿对象的一个字段），写回时带上，否则旧草稿会写到新目标上。有了它，切换才能立刻生效、写回留到后台。
4. **防抖、串行、与基线相等即跳过**：改动进防抖窗口（约 500ms）；写回串行，写的期间多次触发合并成一次补写；写回内容与最近一次从配置派生的内容相等时不写（挂载、写回回声、改回原值都不该产生写入）。
5. **源回声守卫**：写回成功通常会触发重取。只有干净的草稿才接受新来源，脏草稿保住用户正在输入的内容；要强制换草稿时（切换作用域）由宿主显式重置，不靠时序碰运气。
6. **失败不静默**：自动保存没有“保存”按钮兜底，失败走系统通知。视图不内联“保存中”“保存失败”：每次自动保存闪一下提示是负体验，失败文案留在通知里，草稿留在 props 里。

### 加载与流畅性

7. **加载态延时显示**：形态按 [nb-ui 规范](../../../packages/nb-ui/docs/ui-development-spec.md)的“状态下限”；显示要延时（约 200ms），读得快的请求什么都不出现，慢请求出现时也不推动布局。判据是请求飞出去后已经等过一小段时间，不是屏幕上有没有内容。
8. **一次请求只由一个信号呈现，视图不接收 `loading`**：加载与失败由外壳统一画，外壳把所有来源（共享快照加各视图自带的取数）组合成一个忙信号、一个失败信号、一个重试入口。分层各画一次，用户会看到两块占位轮流闪。
9. **交互即时性**：作用域、标签、分区这类切换同步生效，副作用（写回、重取、惰性加载）放后台。任何“等网络回来再切”都读成卡顿。
10. **惰性加载**：重视图只在真的被打开时创建与取数；绑定对象可以在宿主 setup 里建，但请求要等启用。打开后目标变化才重新读取。
11. **切换规则单向**：作用域切回来时回到该档上次停留的分区，没记过才取第一个。
12. **上报做成回调**：可复用 composable 不在内部直接调宿主的通知或全局状态，把上报做成回调参数（`notifyError?: (message: string) => void`），由宿主注入，纯 Vitest 环境才测得了。

### 组合与布局归属

- **一个滚动所有者**：整页型视图由外壳给内边距并拥有滚动；两栏型、长列表型视图自己占满内容区、管理内部滚动。这条差异写进视图的声明（工作台 View 的 `layout: "scroll" | "fill"`；设置分区是另一套取值，见 `settings-window`），不靠 `h-full` 试出来：外壳套一层 `overflow-y-auto` 会让视图内部的百分比高度失效，两栏就滚不到一起。
- **attrs 继承看根节点数量**：给组件挂 `class`、`style`、监听器前，先确认它是单根模板。多根（`v-if`/`v-else` 两支、并列兄弟）会让 Vue 丢弃这些属性，只在开发时打一条警告，布局随之静默消失。要承载滚动、内边距的组件，把这两件事写在它自己的根上。父组件的 scoped 样式同理，只命中子组件的单一根；把 class 转发到内部元素的组件（例如 `Select` 交给触发器）带不上父组件的作用域属性，宽度这类布局给外层包裹元素。
- **布局类随内容走，不随选中态走**：外壳给内容区套的布局类（`overflow`、内边距、`layout` 模式）挂在当前被渲染的那一份内容上（过渡内的 keyed 子元素）。挂在随选中立即翻转的外层容器上时，`out-in` 期间仍在渲染的离场内容会被套上下一份内容的布局。
- **多标签共享标题栏**：标签专属的过滤或搜索控件放进该标签内部（例如 sticky 吸顶），不在共享标题栏里按条件挂载，否则标题栏高度跟着变。
- **新增视图时逐条过**：单根或把布局放在自己根上；声明 `layout`；不接收 `loading`、`loadError`；在 Component Lab 登记场景。

## 客户端持久化与存储分层

职责、归属、同步边界和版本恢复的唯一架构合同见 [Storage 架构规范](../../specs/storage/boundaries.md)（planned）；
初始化、生命周期、保存反馈与磁盘落点见 [持久化行为规范](../../specs/storage/persistence.md)；
取舍依据见 [ADR 0021](../../../packages/neuro-book-legacy/docs/adr/0021-local-storage-persistence.md)。
本节保留前端消费入口与存量债务；新的通用 Storage service 和数据迁移尚未实现。

### 前端接入

- 新状态先按架构规范确定 Config / Storage / 内存 / 领域数据归属，再声明 owner 与恢复合同；不以 Pinia 或浏览器介质反推归属。
- 禁止新增组件内裸 `localStorage` / `sessionStorage` 读写。现有消费者迁移时由宿主统一接入，Pinia 承担前端投影。
- Project 上下文必须明确有效；用户资产工作区残留的上次项目路径不能拿来选 Storage 分区。
- UI 回落默认、过滤未知引用和夹取尺寸时，按架构规范保留原记录，避免 watch 自动保存回退结果。
- grid 只消费内存布局及快照；组件不得自行建立同步通道。Component Lab / Playground 继续使用独立开发环境前缀。

### 存量迁移方向

下表是已识别的主要入口；仅登记目标，不声称已完成迁移。

| 现状 | 归属与迁移方向 |
|---|---|
| `novel.ide.local` 的主工作台左右尺寸 | Project/local 分别记忆；无项目和用户资产使用显式 User/local；旧全局值不批量复制给每个项目 |
| `novel.ide.local` 的编辑器偏好 | 核对现有 `editor.markdown` / `editor.monaco` Config 投影，消除持久化权威副本 |
| `novel.ide.session` 的 `workspaceSessions` | 拆分项目编辑器与 `user-assets` 编辑器恢复态；未保存正文按编辑器合同处理 |
| `novel.ide.session` 的 `currentProjectRoot` | 当前值是内存事实；需要记住“上次打开哪个项目”时归 User Storage |
| `novel.ide.session` 的选择项和 `detailUndoStacks` | 项目内选择需要恢复时归 Project Storage；撤销栈按编辑器合同决定保留和失效 |
| `nbook.settingsDialog.size`、`nbook.projectCreateDialog.size.v2` | User Storage 的对话框布局状态 |
| `nbook.locale` | 语言作为 Global Config 设置；字段接入仍待迁移 |
| `nbook.costDisplay.usdToCnyRate` | 汇率缓存，注明来源与有效期；持久化缓存或纯内存由缓存需求决定 |
| `agent:pinned-sessions:*`、`agent:last-session:*`、`agent:inline-editor-session:*` | 保存身份记忆；项目入口归 Project，用户资产入口归 User；继续校验 sessionIdentity，不是 Session 本身 |
| World Engine 的尺寸 ref | 目标为 Project/local；按项目分别记忆，由宿主接入，尚未迁移 |

### 待细化

本地阶段、身份分区与恢复已在 [持久化行为规范](../../specs/storage/persistence.md) 固定，
首批顺序见 [迁移合同](../../../packages/neuro-book-legacy/docs/migrations/storage-state.md)。
跨独立 data 的在线同步、缓存失效及未列入首批的消费者继续独立设计，不能借本次迁移整桶搬走领域恢复数据。

## 验证

前端改动说明桌面和窄屏影响。逻辑测试、类型检查和浏览器验收分别报告；用户可见交互或布局变化必须运行真实页面并留下可观察证据。

完成标准：目标桌面与窄屏视口均可完成受影响流程，键盘与焦点路径可用，主题和长文本不会产生溢出或布局跳动。
