# t67 实施记录：工作台部件布局、标题操作与无业务骨架 Lab

计划：[`local://workbench-shell-parts-lab-plan.md`](../../../../../../../../local/workbench-shell-parts-lab-plan.md)（批准版，权威合同）。
工作树：`C:/Users/notnotype/Documents/CodeRepository/GithubProjects/neuro-book/.worktree/w00003-neurobook-ui-foundation-migration`，分支 `refactor/w00003-nb-ui-adoption`，基线 HEAD `26479d48`。
本记录按切片追加；**没有 commit / push / PR / 合并 / 发布**。

## 切片 1：几何与稳定槽位（已完成）

交付：

| 文件 | 内容 |
|---|---|
| `app/utils/workbench/panel-state.ts`（新） | Panel 位置/对齐枚举、默认值、`resolvePanelPreferences`、`panelMaximizable` 等纯判定；几何、持久化、命令目录与纯布局组件共用一份取值域 |
| `app/utils/workbench/layout.ts`（重写几何部分） | 新拓扑 `root V[titlebar, main H[activity, body], statusbar]`；`projectShell` 纯投影（位置/对齐树形、尺寸分配、紧凑呈现、短容器退化、最大化）；`createShellGrid`；`settleShellGesture`（只映射直接主动且真实变化的叶）；`mergeShellSizePatch`；删除 `createDefaultShellGrid`/`recalcShellSizes`/`distributeShellHeights`/`resizeShellBranch`/`shellGestureAxis`/`clampLeafSizes`/`ShellSizeStore`/`ShellHeights` 等旧模型符号，不留兼容别名 |
| `app/components/workbench/WorkbenchShellLayout.vue`（新） | 纯布局组件：ResizeObserver 测量、投影、GridRenderer 渲染、七个 Part 槽位只创建一次并用 Teleport 搬进叶落点（隐藏/最大化停放到 `hidden inert` 停放区）、手势结算与上下文失效、焦点/滚动保留、隐藏与最大化后的焦点落点策略；受控 props `{sizes, panel, contextKey, hiddenParts?, disabled?}`，emits `resize/layout/gesture-cancel` |
| `app/utils/workbench/descriptors.ts` | `WORKBENCH_PART_IDS` 补 `statusbar`（七 Part 与布局叶一一对应） |
| `app/utils/workbench/layout.test.ts`（重写） | 26 例：默认 activity 通高、10 种位置/跨度组合都不与活动栏交叠且在容器内、隐藏叶、最大化占满编辑列、短高度退 32px 标题头、紧凑呈现无 sash、手势补丁只含主动字段、余量分支不保存、非法输入拒绝 |
| `app/components/workbench/WorkbenchShellLayout.test.ts`（新） | 11 例：七槽各渲染一次并落到叶落点、换位置/隐藏/窄宽后同一 DOM 节点实例不变、隐藏只停放不卸载、最大化只改呈现、短容器事实外发、隐藏后焦点交给宿主入口、普通换位不抢焦点、一次有效手势只发一次 resize、换工作面与容器变化作废旧基线、余量分支不保存 |

实测（`packages/neuro-book`）：

```text
bun run test app/utils/workbench/layout.test.ts app/components/workbench/WorkbenchShellLayout.test.ts
→ Test Files 2 passed (2)；Tests 35 passed (35)
```

要点与取舍：

- **活动栏通高**：`main = H[activity, body]`，`body` 承载侧栏/编辑区/Panel 的全部组合；Panel 永远在 `body` 内，结构上不可能跨过活动栏（不是靠 margin 修补）。
- **固定内部 id**：`body`、`panel-stack`（Panel 与其内容兄弟）、`content-row`（跨度包含的侧栏与 editor）；叶查找按 id，不依赖父链。
- **只有可调整边界占 1px**：activity 相邻、titlebar/statusbar 相邻、Panel 收起或最大化时都不占；收起判定先于 sash 计算（否则退到 32px 头的那 1px 会漏进容器）。
- **装不下只改呈现**：宽度轴进入紧凑呈现（容器宽 < 800 或侧栏/Panel/编辑区最小宽度装不下），高度轴先把 Panel 退到 32px 标题头、仍不足时编辑器取非负余量并给诊断。
- **手势只保存主动轴**：`settleShellGesture` 复用 `gridBranchGesture` + `resizeBranch` 验证，再映射 `leftPanelWidth`/`agentPanelWidth`/`panelHeight`/`panelWidth` 中真正变化的项；余量分支（如 `content-row` 里的 editor）不产生保存。
- 组件在每次重建后按模型重新发布一次呈现（新对象身份），拖动结束后受控尺寸回到偏好口径，不留下临时比例。

## 文档与入口（已完成部分）

- `docs/specs/ui/workbench-shell.md`：跨活动栏拓扑、四个位置 × 四种水平跨度、收起/隐藏/最大化三种形态、容器宽 < 800 的紧凑呈现、尺寸装不下时的降级、标题操作的框架/View 两层、状态归属表（面板尺寸与面板偏好分属两条记录）、新增验收 11–14 与 `workbench-shell` smoke 入口。
- `docs/standards/code/components.md`：新增可选 frontmatter `别名` 的语义（canonical 名不变，别名只影响检索；写坏给开发诊断）。
- `docs/specs/ui/component-lab.md`：检索按组件名/显示名/别名（不搜正文）、索引派生字段、索引边界与新增验收 11。
- `scripts/smoke/component-lab.ts`：新增 `workbench-shell` 套件分支与参数校验，`all` 同样调用（并先恢复宽画布）。
- `scripts/smoke/workbench-shell.ts`（新）：八步浏览器验收（部件检索、默认与跨度、resize 与取消、三种状态、View 动作与移动、生命周期与键盘、窄/短容器、复位），全部按数据属性定位。
- `app/components/workbench/WorkbenchShell.md`（新）：产品外壳的文档，如实声明 Storage 与会话依赖、不可直接挂载、指向纯布局与 Lab 骨架。

## 切片 6（进行中）：主页接入

已落地：

| 文件 | 内容 |
|---|---|
| `app/components/workbench/WorkbenchShell.vue`（重写） | 产品包装层：保留 Storage 会话与提示条，几何全部下移到纯布局组件；受控 props `{surface, panel, maximized?}`，`@update:maximized` 回传失效的瞬时最大化（去重，只报一次）；`setLeafVisible` 收窄到 titlebar/activity/left/right（editor 与状态栏不可隐藏）；暴露 `{setLeafVisible, hidden, facts, panelSize}` |
| `app/pages/index.vue` | 外壳新 props 接线；面板状态改走 `viewPlacements.setPanelState`（位置/对齐/隐藏/收起同一写者）；状态栏面板项改零占用语义（隐藏后用「显示面板」同时清 hidden+collapsed），并标 `data-shell-focus-target="panel-toggle"`；新增 `provideWorkbenchCommands` 宿主 + 命令上下文同源 + `registerWorkbenchShellCommands`/`registerViewTitleCommands` 注册与卸载释放 + `panelTitleActions` + `handleTitleAction`；三处 ViewHost 接 `actionsByView`/`panelActions`/`allowViewMove`/`contextKey`/`@title-action`，面板容器接 `@panel-collapse`；`WorkbenchViewInstances` 接必填 `view-factory-resolver` 与 `@view-actions`/`@view-handle-ready`；`move-view`/`select-view` 适配统一事件载荷 |
| `app/components/workbench/WorkbenchShell.test.ts`（新） | 6 例：读数来自会话且程序布局不提交、一次有效手势只提交一次（带代际键与主动轴补丁）、叶显隐只接受登记 Part、失效最大化回传且不写存储、呈现事实带 mode/生效状态、提示条重试/放弃/迁移重试出口 |
| `app/components/workbench/workbench-grid-consumers.test.ts` | 剥掉旧外壳会话桩与三条旧用例（迁到 `WorkbenchShell.test.ts`），保留 GridRenderer 与 Spike 的原语消费测试 |
| `app/utils/workbench/descriptors.test.ts` | 「未登记 Part id」用例改用仍未登记的 `editor-zone`（`statusbar` 现在是合法 Part） |
| `app/i18n/locales/{zh-CN,en-US}.ts` | 面板命令/位置/对齐/禁用原因/更多触发器与 View 动作组文案，中英同步 |
| `docs/specs/workbench/commands.md` | 第二批命令目录（七条 `view` 域命令、参数、可用性、effect、agent 暴露、保存令牌语义） |
| `packages/neuro-book/docs/proposals/workbench-view-host.md` | 决策记录追加 2026-09-19 的替代决定（不改写 2026-09-13 的历史结论） |
| `scripts/smoke/component-lab.ts` + `scripts/smoke/workbench-shell.ts` | 新增 `workbench-shell` 套件（八步验收：部件检索、默认与跨度、resize/取消、三种状态、View 动作与移动、生命周期与键盘、窄/短容器、复位），`all` 同样调用；按数据属性定位，菜单支持一层子菜单 |

实测：`bun run test app/utils/workbench/descriptors.test.ts` 11/11、`bun run test app/components/workbench/WorkbenchShell.test.ts` 6/6、`bun run test app/components/workbench/workbench-grid-consumers.test.ts` 6/6。

## 真实浏览器验收（进行中）

隔离服务被迁移门禁挡住（新隔离根需要 `migrate:application-state -- --apply`，未获授权未执行；裸 `nuxt dev` 在本机起不来，dev worker 503）。经开发者提示改用**本 Work 的常驻 dev 服务 `http://localhost:3001`**（隔离根 `Temp/nb-3001-8KseHT`）跑 Lab 侧 smoke：Lab 夹具不写产品数据，不创建 Project，不改动该服务的状态根。

### 缺陷一：标题操作区 ResizeObserver 自激（已修，真实浏览器实测）

**现象**：骨架夹具与 ViewHost 夹具的标题操作容器 2 秒内产生 3300 / 1030 次 DOM 变更（≈130 次/秒），按钮永远处于「脱离 DOM / 不稳定」状态——冒烟的菜单点击因此全部超时（`locator.click: Timeout`），页面也一直在重渲染。

**定位过程（真实浏览器）**：临时探针记录 `measure() / watch / render / RO 回调` 四个计数与最近 12 次 `容器宽|自身宽|visibleCount`：
- 计数：`render 260 / measure 260 / RO 259 / watch 0` → 与 `watch` 无关，是 **ResizeObserver → measure → 改状态 → 重渲染 → RO** 的闭环；
- 序列：`26/1 ↔ 54/0` 无限交替（`availableWidth/visibleCount`）。

**根因**：`WorkbenchTitleActions` 用**父盒宽度**当折叠判据，而宿主的动作区盒子是 `flex: 0 0 auto`（随内容收缩）——折叠一改内容宽，父盒宽度跟着变，于是判据自己动起来。`WorkbenchContainerSection`、`WorkbenchContainerSurface`、`WorkbenchPanelSurface` 与 `WorkbenchViewHost` 的三层包装全部命中。

**修法**（宿主合同 + 部件自保）：
| 层 | 改动 |
|---|---|
| 三个宿主动作区 | `flex: 1 1 0` + `min-width: 0` + `justify-content: flex-end`：宽度只由宿主给的空间决定 |
| 标题 / 标签条 | `flex: 4 1 0`（确定份额；放不下的标签自己滚动） |
| `WorkbenchViewHost` 两层包装 | `flex: 1 1 0` |
| `WorkbenchTitleActions` 根 | `width: 100%` + `flex: 1 1 auto`（吃满确定的盒子） |
| 冒烟 | 新增「静置 1.5 秒内壳内 DOM 变更 < 100」的回归断言 |

复核：四个配置（骨架默认 / 骨架 view-actions / ViewHost.actions / PanelSurface.view-actions）**均为 0 次变更**（此前 3300 / 1030 / 0 / 0）。

### 缺陷二：默认画布下 Panel 无可操作宽度（已修）

Lab「随窗口」画布约 810px，而侧栏最小值是 280 + 320（产品合同），三栏全开时编辑列只有 ~150px → Panel 标题区连一个动作按钮都放不下。骨架 fixture 的默认场景因此**初始隐藏右栏**（活动栏第二项「辅助侧边栏」随时显示；两端对齐的跨度断言由冒烟先显示右栏再验证），并把 Lab 初值档从产品默认 340/400 改为侧栏最小值。实测编辑列 901px、Panel 动作区 72px、框架「更多」菜单可点。

### 缺陷三：把手拖动在真实浏览器里根本激活不了（已修一半，落点仍不开）

**现象**：在 Lab 里按住视图标题的拖动把手拖动，屏幕毫无反应；Lab 事件面板里没有任何 `view-move`。

**定位（真实浏览器）**：
- 逐步检查拖动中的把手类名（`isDragging` 会加 `opacity-60`）：修之前**从不出现** → 指针传感器根本没激活；
- 源码核对：宿主（`pages/index.vue` 与骨架夹具）都配的是 `PointerSensor.configure({activatorElements: (source) => [source.handle]})`，而 `WorkbenchViewDragHandle` 的 `useDraggable` 只给了 `element`、没给 `handle` → `source.handle` 是 `undefined` → 传感器永远匹配不上。

**已修**：`WorkbenchViewDragHandle` 现在同时传 `element` 与 `handle`（同一元素）。复核：拖动中把手**出现 `opacity-60`** → 激活成功。这条也影响主页面（`index.vue` 用的是同一套配置 + 同一个把手），属于产品级缺陷。

**仍未修（本任务阻断项）**：光标拖到容器上松开，**`dragEnd` 根本不触发**。为了不靠猜，临时在夹具的 `handleViewDropEnd` **最前面**插了一条 `drag-end-raw` 事件（绕过 canceled 与 kind 判断），真实浏览器里一次都没记录到；同一轮里把手在拖动中**有时**出现 `opacity-60`、有时完全没有（同一段脚本两次运行结果不同）。结论：这条路径的问题在 **dnd-kit 的指针传感器激活 / 会话结束**这一层，不在 fixture 的 kind 匹配；需要按 dnd-kit `@dnd-kit/vue` 的 `PointerSensor` 激活条件（`activatorElements` + `handle` + 激活距离）与会话结束的监听目标系统排查。左栏、右栏两个落点都试过，都一样。

**原始描述（保留）**：激活之后**落点不被接受**——指针在右栏中心松开，`panel-b` 仍然留在 Panel，`view-move` 事件一条都没发。下一步排查方向：`WorkbenchViewHost` 的 `useDroppable`（`element: dropRef`、`accept: ["workbench-view"]`、`disabled: !allowViewMove`，夹具三处都传了 `allow-view-move="true"`）以及碰撞检测用的矩形是否落在右栏容器内。

### 缺陷三的收尾：拖动链路已修，附带暴露一个 View 动作解析回归

**已修（子代理 `DragDropInvestigator`，Leader 已复核）**：

1. **拖动源的 dnd-kit id 按 `viewId` 派生** → 注册表按「注册时的 key、当前的 id」反注册，换过容器/页签就留下删不掉的死条目，下一次拖动的 `source` 是残留那份、落点带着旧容器被命令层拒绝。改成实例恒定的 `workbench-view:<useId()>`。
2. **侧栏行头没有拖动源**：`moveTargets` 是个没人传的 prop（产品与 Lab 都没传，默认 `[]`），改用求值切片里已算好的 `presentation.moveTargets`。
3. **`activatorElements: (source) => [source.handle]` 静默失败**：`handle` 缺失时一个 pointerdown 监听器都不挂（「按下去毫无反应」而不报错）。夹具与产品宿主都改成 `source.handle ?? source.element`。
4. **折叠迟滞的负宽度**：`foldAt === current` 时又拿 `availableWidth - size`（可能为负）算一次，折叠函数把非正宽度当「量不到」而返回全部项 → 按钮按 `justify-content: flex-end` 向左溢出**盖住拖动把手**（320px 竖直面板实测按把手点到的是「隐藏面板」）。
5. Leader 追加：折叠判据现在区分「量不到」（jsdom，全部渲染）与「真的量到 0 宽」（只留「更多」），修掉「父盒被挤成 0 时整排溢出」这一类。

**验证**：新回归测试 `WorkbenchViewDragHandle.test.ts` 在旧实现下 **2 条全失败**（Leader 复现：临时把 id 改回按 `viewId` 派生 → `2 failed`，还原后 `2 passed`）。冒烟里三段真实拖动（面板→左栏、左栏→面板、左栏→右栏）与 Escape 取消**全部通过**：归属唯一、`view-move` 计数正确、取消不移动。

**收尾（同一子代理第二轮）**：那 6 条失败**不是回归**，是冒烟脚本的选择器：侧栏每个 Section 行头现在也有自己的 `[data-title-actions="view"]` 动作组（计划要求的行为），脚本 `.first()` 落到了**没有贡献的左栏行头**上，于是在那一组里永远找不到 `increment`。子代理把标题动作的选择器收窄到面板标题条（`[data-leaf="panel"] [data-title-actions="view"]`）后：

- 实测会话层完全正常：`presentation.entries` 里 `lab.panel-a` 带 `increment/reset`、`lab.panel-b` 带 `toggle/disabled`，`actionsByView` 有完整求值结果，`issues: []`；面板那一组点开「更多」正是 `增加演示计数 / 重置演示计数 / 移动到`。
- primary 出现在菜单而不是按钮上，是因为该场景面板标题条只给动作区 ~29px，按设计折进「更多」（jsdom 没有布局、宽度视为未知，所以不折——这解释了「jsdom 有按钮、浏览器在菜单里」）。

**现在的状态**：`--suite workbench-shell` **八步全绿**（Leader 亲自复核：「Component Lab workbench shell smoke passed」），`--suite core` 也通过。产品宿主 `index.vue` 三处 `WorkbenchViewHost` 与夹具同形（`:actions-by-view="viewActions.actionsByView.value"` + 同一套 `registerViewTitleCommands`），无产品侧改动需要。

**原始记录（保留）**：骨架夹具里 `useWorkbenchViewActions` 解析出的 View 动作在**真实浏览器**里为空——按钮与菜单都没有（`panel-a` 的 `increment`/`reset`、`panel-b` 的 `toggle`/`disabled`），而 `[data-view-host__note]` 无诊断、控制台无错误；对照 `WorkbenchViewHost` 夹具的静态 `actionsByView` 正常（`view[refresh,more]`），jsdom 的夹具测试也通过（`increment` 按钮存在）。冒烟里 6 条相关断言因此失败（`执行 panel-a 的「增加演示计数」`等），其余全绿。

### 已修的其他冒烟阻塞

| 现象 | 根因 | 修复 |
|---|---|---|
| `DataCloneError: structuredClone ... could not be cloned` | 骨架 fixture 用深 `ref` 持有呈现事实，Lab 数据面板 `structuredClone` 拿到的是 Proxy | `layoutFacts` 改 `shallowRef` |
| dnd-kit `isFocusable ... toLowerCase` 页面错误 | `WorkbenchViewDragHandle` 把**组件实例**交给 dnd-kit（`tagName` 未定义）；Nuxt 自动导入还把 `IconButton` 解析到应用内同名组件（不吃 `icon-class`，把手是个空按钮） | 拖动源改为普通元素包装 + 显式 import nb-ui 的 `IconButton` |
| `ReferenceError: __name is not defined` | `tsx` 的 esbuild keepNames 给 `page.evaluate(函数)` 注入了页面上下文不存在的助手 | 三处 evaluate 改为字符串表达式 |
| `[data-lab-demo="counter"]` 找不到 | ViewHost 的标题动作区挂载时抛异常，打断了 `registerTarget`，实例层 `published` 永远为空 → 四个实例一个都不渲染（锚点在、内容为 0） | 同上：把手元素绑定修好后实例落位恢复（四锚点各 1 子节点、实例内容 4 份） |

## 统一验证结果（本机实测）

| 命令 | 结果 |
|---|---|
| `packages/neuro-book`：`bun run test app/components/workbench app/utils/workbench app/component-lab app/components/novel-ide/workspace/WorkspaceFilePanel.test.ts app/components/novel-ide/NovelIdeActivityBar.test.ts shared/storage server/storage/product-definitions.test.ts` | **48 文件 / 531 例通过** |
| `packages/neuro-book`：`bun run test app/components/editor-workbench app/utils/editor-workbench app/composables/useEditorWorkbench.test.ts app/stores/novel-ide-editor.test.ts` | **15 文件 / 133 例通过**（t64/t65/t66 合同未破） |
| `packages/neuro-book`：`bun run typecheck` | 进行中/见下 |
| `packages/nb-ui`：`bun run test` / `typecheck` / `build:css` | **24 文件 / 399 例通过**；类型生成成功；CSS 构建成功（`dist/nb-ui.css` 的改动来自并行 nb-ui 工作，不是本任务编辑） |
| Work 根：`bun run docs:check` | **6175 文件，failures 为空** |
| Work 根：`bun run governance:check` | **failures 为空、warnings 为空** |
| `bun run nuxt:build:raw`（NODE_ENV=production） | 构建成功；产物排除检查：`/lab` 路由、`nbook.view.lab-increment`、`data-workbench-skeleton-fixture`、`WorkbenchShellLayoutFixture` 全部**不在**产物中；正向对照 `WorkbenchShellLayout` / `data-shell-focus-target` / `nbook.view.refresh-files` 在 `public/_nuxt/BHgC0KF7.js` 中**存在**（扫描 100 个产物 JS） |

### 四主题 × 浅深对照（直连探针，8 组合）

冒烟脚本里的主题步骤被上面的漂移挡住，改用直连探针逐组合验证：

| 组合 | 主题/外观 | 叶 | 布局 | Panel 底色 | 溢出 |
|---|---|---|---|---|---|
| nbook-nbook-light | nbook/light | 6 | split | `rgb(255,252,245)` | 0 |
| nbook-nbook-dark | nbook/dark | 6 | split | `rgb(45,41,37)` | 0 |
| macos-nbook-light | macos/light | 6 | split | `rgb(255,252,245)` | 0 |
| macos-nbook-dark | macos/dark | 6 | split | `rgb(45,41,37)` | 0 |
| editorial-nbook-light | editorial/light | 6 | split | `rgb(255,252,245)` | 0 |
| editorial-nbook-dark | editorial/dark | 6 | split | `rgb(45,41,37)` | 0 |
| aurora-nbook-light | aurora/light | 6 | split | `rgb(255,252,245)` | 0 |
| aurora-nbook-dark | aurora/dark | 6 | split | `rgb(45,41,37)` | 0 |

8 个组合全部通过：主题/外观确实落到了 `<html>`、六个叶齐、布局是 split、浅深两档底色不同（不是硬编码）、页面无横向溢出；截图在 `evidence/theme-<主题>-<配色>.png`。四个主题在**同一配色**下底色相同是预期——Lab 的配色变量由配色档（nbook-light/nbook-dark）提供，主题提供其余角色。

## 真实浏览器 Smoke（已全绿）

| 命令 | 结果 |
|---|---|
| `--suite workbench-shell`（Lab 骨架八步） | **passed**（部件检索 / 默认与跨度 / resize 与取消 / 收起·隐藏·最大化 / View 动作与三段真实拖动 + Escape / lifetime 实例保留 / 窄画布 / 静置不抖动 / 复位） |
| `--suite core`（Lab 既有冒烟） | **passed** |

## 尚未完成

- **Lab 冒烟的漂移已定位到 Lab 外壳而不是本任务组件**（直连探针复现）：两次键盘菜单操作之后，夹具内的左栏分隔条落在 `x=253`（而不是它在舞台里的 694），于是脚本按下/拖动的坐标压在 **Lab 左侧导航树**上，把组件切成 `ViewportCanvas`——之后所有查询自然「夹具不在」。控制台无任何错误（`[]`），所以不是 Vue 渲染崩掉，而是指针落错元素。**下一位接手的人**：先查 Lab 舞台在自动交互后是否发生了滚动/位移（`stage.getBoundingClientRect()` 与 leaf 坐标一起读），再决定是修 Lab 外壳还是让冒烟按 stage 相对坐标点击。**未完成项，不是已通过项**：`workbench-shell` 冒烟没有端到端全绿。
- **Lab 冒烟脚本仍有一处未定位的漂移（原始记录，保留）**：位置/对齐循环跑完之后、拖左栏分隔条那一步，Lab 会从骨架夹具切走（失败快照：`夹具=不在`）。同样的拖动在「新开页面 → 直接拖」的直连探针里正常（280 → 319px，夹具仍在），所以更像冒烟脚本自身的状态污染（早先菜单键盘漫游的方向键曾落到左侧导航树上，已加守卫；这一步的原因还没坐实）。**未完成项，不是已通过项**：`workbench-shell` 冒烟没有端到端全绿。
- 由直连探针单独验证过、且结论明确的行为（可作为该条要求的证据，但不能替代冒烟）：默认 bottom/center 几何（activity 通高 662、Panel 与编辑区同列、`panel.left ≥ activity.right`）、四种位置与四种对齐的跨度、左栏拖动 +40px 生效、收起后 32px 标题头且框架「更多」仍在（26×26）、`view-actions` 场景活动视图与动作、实例落位（四锚点各 1 子节点）、标题区静置 0 次 DOM 变更。
- **主页验收未做**：需要创建 Project 与文档（写状态根），按规则要单独授权，未执行。
- 四主题 × 浅深截图对照可跑但是 smoke 脚本内的步骤，受上面漂移影响，未产出。
- walkthrough 末尾统一格式化（项目 formatter）在冒烟闭合后再跑。

### 并行切片状态

- 切片 2（尺寸保存与 Panel 状态）：`PersistenceSlice` 交付，本机独立复跑 25 文件 / 273 例通过。
- 切片 3（活动栏与菜单原语）：`ActivityBarSlice` 交付，本机独立复跑 nb-ui 24 文件 / 399 例 + 活动栏 9 例通过。
- 切片 4（View 动作与宿主）：`ViewActionsSlice` 交付 122 例 + 同目录 567 例；**骨架夹具的实例落位缺陷**已交回它定位。
- 切片 5（Lab 目录与整壳骨架）：`SkeletonFixtureSlice`（骨架 fixture + 文档 + 6 例）与 `LabPartsCoverage`（四个零件文档与 fixture、两个容器场景扩展、45 例）均已交付；`fixtures/index.ts` 的登记由 Leader 统一完成。

### 红色分支登记

切片 1 删除旧几何 API 后，`WorkbenchShell.vue`/`shell-layout.ts`/`layout-session.ts` 曾短暂无法编译，已由切片 2/6 修复；当前无已知红色分支。未 commit / 未 push / 未提 PR / 未发布。

## 2026-09-21 拖动预览缺陷（开发者反馈第十五轮）

开发者报告：「移动视图没有指示，没有类似 grid sash 分屏的那种指示」「移动视图似乎位置不对，而且高度为 0」。
在 Lab（`/lab` → `WorkbenchShellLayout`）+ 真实 Chromium 里用 Playwright 指针逐条复现，定位到两个独立根因。

### 复现与取证

同容器拖动（把 `lab.primary` 标题拖到同容器第二个叶的内容区）：

- 修复前：拖动中 `document.querySelector(".workbench-drop-overlay")` 为 `null`（整层不渲染），松手后顺序**确实**
  变成 `[extra-a, primary]` ⇒「有结果、无指示」。
- 临时探针（把每次事件写进 `document.documentElement.dataset.wbTrace`，验证后已删）显示那一场只有一条
  `{"at":"end","target":"workbench-container-content-target","containerId":"lab.container.left","decision":"move-view","lastOver":null}`
  ——`onDragOver` 从未被调用。

跨容器拖动（`lab.primary` → 面板容器）：预览层存在，但 `style.left: 634px` 的元素渲染在 `x=984`。祖先链扫描给出两个对照事实：

- `body` 下临时插入 `position: fixed; inset: 0` 的参照元素 → `(0,0,1670,1050)`（正常全屏，排除页面级缩放/zoom）；
- 覆盖层自身 rect = `(350,30,900,728)`，与它的直接祖先同尺寸；再往上的 `.nb-lab-stage-box` 带
  `backdrop-filter: blur(8px) saturate(1.6) brightness(0.62)` ⇒ 它就是 fixed 的包含块。

### 根因

1. `node_modules/@dnd-kit/abstract/index.js` 的 `DragActions.setDropTarget`：
   `if (dragOperation.targetIdentifier === id) { return Promise.resolve(false); }`
   ——`dragover` 是「命中目标**变化**」事件，不是「指针移动」事件。同容器拖动时目标恒定（始终是同一个内容落点），
   整场零派发。逐帧事件是 `dragmove`（`DragDropProviderEmits` 里与 `dragEnd` 并列，之前没接）。
2. `WorkbenchDropOverlay` 的 `position: fixed`：祖先链上出现 `backdrop-filter` / `transform` / `contain` /
   `container-type` 时，fixed 以那个祖先为包含块，而预览几何来自 `getBoundingClientRect`（viewport 坐标）——必然错位。

### 改动

- `app/composables/useWorkbenchDrop.ts`：`handlers` 增 `onDragMove`（与 `onDragOver` 同一个 resolver 与 `publish`），
  类型 `WorkbenchDropHandle.handlers` 同步；拖动期间预览随指针每帧重算。
- `app/pages/index.vue`、`app/component-lab/fixtures/WorkbenchShellLayoutFixture.vue`：`@drag-move="…onDragMove"`。
- `app/components/workbench/WorkbenchDropOverlay.vue`：渲染体 `Teleport to="body"`（`pointer-events: none` 不变）。
- `scripts/smoke/workbench-lab.ts`：新增 `readDropPreview()` 量具与 `dragOnto({sample})` 松手前采样钩子。
- `scripts/smoke/workbench-containers.ts`：同容器换序步骤断言预览存在、`kind=move-view`、线非零尺寸、两份坐标差 ≤1.5px。

### 验证

- 修复后同容器：`kind=move-view`、`label=移动视图`、线 `style {left:420, top:827.5, width:208, height:2}` /
  `rendered {x:419, y:828}`（-1 是 `margin-top: -1px` 的居中微调）；覆盖层 rect 回到 `(0,0,1670,1050)`。
- 修复后跨容器：`style.left=634` / `rendered.x=634`；顺序 `left=[extra-a]`、`panel=[primary,panel-a,panel-b]`。
- 容器拖到切换器条目：`move-container`、`entry` 高亮 104×32（非零）。
- `--suite workbench-shell` → **passed**（91.03s，含新断言）；聚焦套件 **54 文件 / 712 例通过**；
  `vue-tsc` 无新增错误（94 个全在既有 Agent 夹具与 `AgentChatFlow.vue`）。

### 未覆盖

主页面（`app/pages/index.vue`）的视图拖动未实测：当前没有打开的 Project / 视图，
真实页面 `[data-workbench-drag-kind="view"]` 数量为 0。Lab 与主页面共用同一 composable、同一覆盖层组件与同一套事件绑定，
但「真实页面」这一格仍未验证。

## 2026-09-21 工作台收起、容器移动与 parking 复验

- 收紧 `WorkbenchContainerInstances` 的目标有效性：仅 `target.isConnected` 时交给 Teleport；注销时同步转 parking，注册时同步切换目标，`nextTick` 负责最终校正。`WorkbenchPartHost.test.ts` harness 改为挂载到 `document.body`，断连目标回归在浏览器连接语义下验证。
- `WorkbenchPartHost` 空态保留为 `v-show` 节点；最后容器移走时 `view-placements` 清除来源 Part 的旧活动选择，目标 Part 选中移动容器。
- 真实 Chromium `--suite workbench-shell` 最终复跑通过（111.12s，3001 服务未重启）：两轴收起/恢复、3px sash 装饰带、hover/reduced-motion、整容器跨 Part、空 Part 接收、View 同容器换序与跨容器移动。
- 验证：`app/components/workbench app/utils/workbench` 42 文件 / 678 例通过；容器/placements targeted 2 文件 / 97 例通过；nb-ui 28 文件 / 490 例通过、typecheck 与 CSS build 通过；生产 raw build `Build complete!`；`docs:check` 6217 文件无失败；`governance:check` 无失败/警告。
- 限制：广义 55 文件 focused 重跑有 1 项无关 `AgentSidebarViewFixture.test.ts` 15 秒超时；脚本类型检查仍有已知 `product-agent-state-root-smoke.ts:318` 类型错误；nb-ui E2E webServer 等待 120 秒超时，未进入测试；独立 reviewer 未能返回报告。未做主页业务 View 拖动，也未重跑四主题/DPR 矩阵。

## 2026-09-21 统一拖放反馈与切换器落点

本轮沿用 Work `w00003-neurobook-ui-foundation-migration`、Task `t67-workbench-shell-parts-lab`、role `tasker` 与 checkout `.worktree/w00003-neurobook-ui-foundation-migration`，分支 `refactor/w00003-nb-ui-adoption`。开发者已批准 `local://workbench-drag-feedback-plan.md` 并要求继续实施；验证针对共享未提交工作树，没有独立 revision，HEAD 本轮收口未重新核实。保留他人改动，未 commit/push/PR/merge/deploy，未触真实 Provider/Model 或创建业务数据。

### 实现边界

- `WorkbenchPartHost` 用容器清单判断零容器 Part；非空 left 禁用头部 band，reader 仍保留当前标题条目及其精确矩形。非空 Panel/right 只读 selector。零容器时不渲染空 selector，整个 head 只接收整容器，正文不登记落点。
- left 标题新增 `:key="activeContainer.containerId"`。浏览器复现“移到第二容器→复位→投当前标题”时，旧实体可迭代、DOM连接有效，但 `registry.droppables.get(d.id)` 是 undefined。按容器身份重建标题后两次真实释放累计2次移动/2次提交，业务实例寿命不变。新增回归先以19例/1失败证明，再与Editor合跑2文件/29例通过。
- nb-ui `DropIndicator(area|entry|line)` / `DropIndicatorLabel(label, iconClass?)` 只拥有渲染和主题皮肤。Editor保留原生DragEvent与local absolute定位；Workbench保留body Teleport和fixed viewport。未增加状态层、registry、落点schema或公共业务概念。
- Workbench area四边内缩 `min(6,size/4)`，line仅长轴内缩 `min(2,span/4)`；不回写preview和提交。标签独立于反馈盒，按area→entry→indicator选锚点、缓存真实尺寸、视口夹紧，一个ResizeObserver随反馈/卸载断开，live region保留全文。
- Editor固定组末尾dragover已确定pinned语义后停止冒泡，避免外层普通组重复改写；回归通过真实冒泡验证固定/普通末尾各自归属。
- smoke量具要求对应源激活、终点真实命中链、两稳定帧、释放后归属与事件差值；exactAim不把无效点替换成合法点。失败Escape、finally松手。未调用业务handler或改源pointer-events造证据。

### 本轮实际验证

| 检查 | 实际结果与覆盖边界 |
| --- | --- |
| 应用focused：Workbench组件/工具、Editor组件/工具与骨架fixture | 57文件/810例通过；在最后两个新增回归之前执行 |
| PartHost与EditorTabBar最终回归 | 2文件/29例通过，包含活动标题切回和固定组末尾冒泡 |
| 应用 `vue-tsc --noEmit -p tsconfig.json` | 最新与本轮基线的 `error TS` 行 added/removed均为空；命令仍因既有Agent fixture/其它诊断失败 |
| `bun run scripts:typecheck` | exit2，仍只有 `product-agent-state-root-smoke.ts:318` 缺 `colorwayId` / `userColorways` |
| nb-ui test/typecheck/build:css | 28文件/490例通过，组件与playground类型通过，CSS构建通过 |
| nb-ui完整E2E | 首跑49通过/15失败；其中2个入口失败在恢复自有44779服务后，lab行为套件19/19通过；13个全页快照差异保留，未更新基线 |
| nb-ui原语playground | 1440px与390px的area/entry/line/compact/long-label五场景通过；1440px area/line在reduce+contrast:more下无过渡，药丸无blur |
| `--suite workbench-shell` | 最终exit0，189.65s；旧shell/sash场景与新增标题两半、left空白/动作拒绝、三空Part回收/拒绝、双轴换序/并入一起执行 |
| `--suite core` | exit1，刷新后应恢复手机画布 `390 × 844` 未找到，24.87s；不计全绿 |
| Editor真实native拖动 | 最终通过，8.53s：before/after、pin、pinned/regular末尾，左/上/下预览Escape，右释放创建第二组，跨组center移回 |
| 生产 `NODE_ENV=production bun run nuxt:build:raw` | `Build complete!`，175.21s；在最终恢复Editor事件穿透class之前执行，未启动生产服务 |

整壳前次在T/十字 `offset=4` 中出现采样归零、事件计数倒退。该次与Lab读取文档的编辑重叠，热更新干扰仅是推断；随后停止文件修改完整复跑通过，保留前次失败日志。滚舞台/窗口resize后Escape零提交、页面卸载后覆盖层消失已有局部证据；改用键盘打开场景下拉并选择 `container-moved`，按住拖动时旧overlay正确清除（7.81s）。CSS缩放和实际滚动位移的完整矩阵未闭合。

### 初次实施时的运行阻塞与未验证项（历史，后续续验已解除CSS阻塞）

3001的完整CSS模块响应（315882字符）不含 `.nb-ui-drop-indicator`，磁盘dist（114828字节）含该规则；两种载体格式不同，不用字节差判版本，结论来自完整规则检索和CSSOM。实际预览是透明底、0圆角、无阴影；修复前Editor事件记录为捕获层dragover→overlay `pointer-events:auto`→捕获层dragleave，反复清空预览。独立审阅指出宿主事件穿透不能依赖皮肤，Main恢复覆盖层原有 `pointer-events-none` 后实际五向行为通过；没有修改分屏算法，未重启/调整3001或注入CSS。

小条目/仅线提示的最终公共皮肤、四主题双配色、DPR1/1.25/1.5/2及CSS缩放矩阵仍未验收；独立playground不能替代应用运行证据。390px应用窗口的舞台可见范围为325..325，源/目标不可命中；260px画布探针源被裁剪，均未伪造拖动激活。真实主页面没有可用Project/View，未创建业务数据来绕过。

core的源码线索：`LabShell.vue` 的 `watch(selectedName)` 无条件清零画布尺寸，而偏好restore同次先恢复尺寸、再恢复selectedComponentName；这可能覆盖恢复值，尚未针对性运行证实。该文件不在本轮实现范围，未扩大修改偏好系统。

### 证据与审阅

本轮原始产物根为系统Temp下 `neuro-book/acceptance/workbench-drag-feedback-1789968348964/`。`workbench-shell-final.txt` 是最终整壳通过输出；`workbench-shell-after-key-full.txt` 保留前次失败；`title-switch-red.txt`、`title-switch-green-browser.txt`、`title-editor-green.txt` 记录身份修复；`types-final.txt` / `types-final-delta.json` 记录最终类型对照；`production-build.txt` 记录生产构建。

`primitives.json`、`primitives-reduced.json` 与对应PNG记录公共原语；最终 `editor-full.json` 包含五种标签操作、四缘和center，配套截图仍是缺公共皮肤状态，不能当作视觉签核。`editor-event-trace.json`、`css-runtime-gap.json`、`served-css-before.txt` 保留修复前事件与运行资源证据；`visual-matrix.json` 的results为空，只记录失败。`narrow-blockers.json`、`page-unmount-cancel.txt`、`scene-keyboard.json` 与core诊断记录保留局部边界。

独立 `ReviewDropOverlay` 对几何、标签缓存/夹紧、观察器释放、ARIA、两处调用者和量具合同静态审阅，未发现阻断项。`ReviewDropPrimitive` 提出1项P1：Editor分屏覆盖层失去宿主事件穿透；Main已恢复，并以真实native五向拖动验证。原始两份报告存为同名JSON；审阅未运行测试/浏览器，不构成最终视觉签核。最后定向Vitest只收集EditorTabBar 1文件/10例，命令中不存在的EditorGroup测试没有计入通过数。

`docs:check` 检查6221文件，failures为空；`governance:check` failures/warnings为空。仓库没有formatter脚本或prettier/biome/dprint配置，未安装依赖或执行全树格式化。

范围检查覆盖本轮29个文件：无尾随空白、冲突标记或缺失文件。清理26个本轮Temp目录内的一次性 `.mts` 探针，复核无残留，保留JSON、日志、截图与失败证据；自有 `drop-indicator-playground`（44779）已停止，3001保持原状。最终待办保留四项视觉/矩阵阻塞，不将其标记为已完成。

## 2026-09-21 3001续验及最新用户交互要求

开发者明确关闭外部3001并授权本工作树启动后，服务 `workbench-feedback-3001` 以应用目录 `bun run dev` 启动，端口3001并观察ready。完整响应200、322284字符且包含公共规则；旧315882字符缺规则的证据保留为历史。服务继续供开发者使用，不停止。

最新用户要求取消100×18当前容器标题落点、移除内容矩形旁的蓝色插线，并反馈空Panel回收/View投Switcher困难。实现收口为：非空left标题的accept为空、head几何返回null，标题仍能搬整容器；内容area存在时只画内缩矩形和提示，无area时仍可画Switcher换序/空头部线。两种来源复用既有 `useWorkbenchDrag → useWorkbenchDrop → resolveWorkbenchDrop`，没有另造手势/会话；move-view、move-container、merge-container保留原来各自的动作语义。

空Panel与Switcher沿既有修复续验，未凭用户报告另造第二套落点。新smoke补上直接拖走Panel两个容器再搬回（原回收用例主要通过菜单清空）、View/容器分别落到Panel/right标签，连同活动栏与三Part闭环全部通过。此证据限定Lab，不能推断用户真实页面的全部前置状态已覆盖。

另发现静止指针时目标尺寸变化没有触发重算。`useWorkbenchDrop` 在会话开始时观察现有droppable元素，ResizeObserver回调复用单rAF调度；松手、Escape、失焦、结构取消、卸载经同一清理断开。更严格的真实RED/GREEN先去掉此新增观察代码：目标宽208→228但overlay仍196（预期216），exit1，7.66s；恢复后相同输入通过，7.78s。长期smoke已有目标确实变宽、无pointermove更新、Escape零提交断言。此前画布width探针允许无预览的局限没有作为唯一修复证据。

| 最新检查 | 实际结果与边界 |
|---|---|
| 工作台完整smoke | exit0，230.01s；标题拒绝、两来源三种Switcher释放、菜单与拖动清空Panel回收、三Part实例保持、双轴内容只画area、尺寸变化与旧sash/取消 |
| 聚焦Vitest | 实际5文件/89例通过，23.06s；命令列入但不存在的ContainerTab测试未计入 |
| 应用/scripts类型 | 应用相对本轮基线added/removed均空；scripts只有原有TS2739，均未宣称全量绿 |
| 最终四主题×明暗 | 8/8，81.40s；Workbench area/entry与Editor split，computed皮肤一致，原生联系表复核 |
| 最终DPR | nbook双明暗×1/1.25/1.5/2，8/8；两轴内容及两轴Switcher插线，无错误；未逐张人工签核 |
| 合并/仅线/75%/短画布 | 10/10，27.99s；最终合并截图无蓝色插线；75%双明暗两轴及entry；short 260px内容与entry |
| 手机/短屏entry | 3/3，13.18s；390×844真实可见舞台内area/entry与260px短屏entry，原生手机截图已看 |
| 动态滚动/画布/切场景 | 3/3，12.46s；真实wheel位移、Escape、键盘切场景清旧overlay；尺寸回归另外以严格RED/GREEN证明 |

窄屏探针修正了量具问题：`dragOnto` 原本始终按源/目标完整宽度居中横向滚动，使原本可见40px条目滚出舞台。现在两端已可命中时不改变scrollLeft；不可命中时才尝试原有定位。没有修改业务源CSS、注入handler或伪造拖动状态。

本轮产物根下 `resume-3001/` 保留旧失败JSON、新 `stationary-red/green.json`、`dynamic.json`、`narrow.json`、`types-final.txt`/`types-delta.json`、`workbench-shell-final.txt`，`final-visual/` 为最终矩阵及PNG。早期themes/dpr与small-title是最新用户改变合同前的历史证据，不再将small-title接收作为当前要求。

开发者随后明确“后续不用浏览器验证，交给我手动验证”。已停止后续自动浏览器工作，未执行DPR逐图复核或新的浏览器补验。手动入口为 `http://localhost:3001/lab` → WorkbenchShellLayout；检查标题拒绝、并入矩形、空Panel头部回收、View/容器落真实Switcher。真实主页验收仍由开发者进行。新服务core仍失败于恢复 `390 × 844`（38.46s），nb-ui仍有13项快照差异，基线类型错误仍在；均未扩大修改、未掩盖失败。

最终静态审阅：`ReviewFinalTargets` 结论correct、findings为空；`ReviewSessionResize` 结论correct、无已证明阻断，另列4项未验证边界（RO不捕获纯位移、只观察已登记盒而非全部后代、会话中节点替换后的新增盒、没有单独jsdom生命周期用例）。这些未证明为可触发缺陷，不扩大本次修复；长期真实smoke与stationary RED/GREEN已覆盖当前尺寸场景，审阅本身未运行测试/浏览器。完整报告在 `resume-3001/ReviewFinalTargets.json`、`ReviewSessionResize.json`。

最终非浏览器检查：docs检查6221文件、failures为空；governance failures/warnings为空，合计38.39s。范围检查31文件，无尾随空白/冲突标记；删除续验新增7个一次性 `.mts`，余数0，JSON/日志/截图保留。`final-checks.json`、`scope-check.json`、`cleanup.json`记录结果。以上未提交工作树仍无独立revision，3001服务保留，后续验收交开发者。

## 2026-09-21 dnd-kit 升级与编辑器范围收敛

开发者批准顺便升级 dnd-kit，并要求先讨论长期选型、优先缩小到 EditorWorkbench。本轮将根与主应用的 `@dnd-kit/vue` / `@dnd-kit/helpers` 从 `^0.3.2` 升至 `^0.5.0`，七个关联包实际安装版本均为0.5.0。按官方0.4迁移说明删除情节行、情节卡片和模板节点三处已移除的 `feedback: "default"`；已核对新版仍默认使用default，不增加冗余插件配置。编辑器迁移尚未实施，ActivityBar几何问题仍待处理。

安装第一次因Manager的本地file合同包复制报ENOENT；定向更新锁文件后，主应用过滤安装与冻结安装通过，后者1.48s。Bun同时重新解析已有类型依赖，包括 `bun-types` 1.3.14→1.4.0、局部 `@types/bun` 1.4.0→1.4.2及嵌套类型包重排；没有手改生成锁文件，没有宣称全工作区安装通过。

升级后聚焦检查实际8文件/130例通过（19.41s）。类型检查暴露旧 `useWorkbenchDrag.test.ts` 读取库内部protected options的新增TS2352，已删除配置镜像断言，改用公开ActivationController验证鼠标/笔超过6px激活、触摸200ms激活、超出6px滚动或松手取消；该文件6例通过（5.06s）。应用既有Agent fixture、用户字段和AgentSessionSummaryDto类型问题仍保留。

源码核对：Tab排序、跨组转移和拖到正文边缘分屏均走native DragEvent与 `useEditorTabDrag`；点击分屏走宿主布局事务，分隔条由nb-ui GridRenderer/求解器管理。长期建议将前三者作为EditorWorkbench内的一套dnd-kit手势迁移，保留项目自己的排序/分屏规则、唯一提交路径和Grid布局；外部文件/文本仍交原生入口。此处只记录建议，不把讨论当作迁移批准。

原始安装失败、依赖图变化、类型检查、测试与自审产物保留在系统Temp `neuro-book/acceptance/product-runtime/dnd-kit-upgrade-1789979874029/`。沿用开发者手动浏览器验收约定，本轮未操作浏览器，未重启3001、提交或执行远端动作。

## 2026-09-21 编辑器拖放迁移与共享反馈

开发者批准继续迁移Editor，强调后续同类场景复用同一做法、反馈方框与线宽一致、尽量可在Lab独立inspect，并要求记录经验；浏览器检查仍由开发者手动执行。本轮保留既有editor-session/Grid写入合同，Tab排序、固定分区移动、跨组移动与四向分屏改用同一局部dnd-kit会话。移除旧native DragEvent路径、全局activeDraggedTab、正文捕获层与条目/组尾分散画线。

`EditorDragProvider`为EditorWorkbench与独立TabBar Lab共用的宿主；`useEditorTabDrag`登记真实源与目标、复用工作台输入门槛和可见DOM命中、单rAF发布预览，冻结来源及组/标签/固定状态和context/revision。释放重新求值并与已发布动作比较，仅同意图提交一次；Escape、失焦、pointercancel、文档隐藏、结构变化及卸载均清帧/监听/观察器。DragOverlay只画来源标题并关闭drop动画，原标签留在布局中；不能把库的Feedback clone误认为源节点不动。点击分屏与sash不换实现。

纯解析器 `editor-tab-drop.ts`与公共 `resolveListInsertion`把前项后半、项间空隙、后项前半归为同一beforeId与同一2px线；末尾空白不新增flex节点，也不跳到宽空白尽头。可见末项后有裁剪标签时仍插到下一标签前。保留同组中心、唯一标签自边缘及allowSplit关闭时正文拒绝。正常Space/Enter继续选中，Ctrl+Space启动键盘拖动，方向键移动、Space/Enter释放、Escape取消。

原WorkbenchDropOverlay的几何内缩、label测量缓存/夹紧、ARIA与清理完整提取到nb-ui `DropFeedbackOverlay`。Editor直接使用，Workbench仅保留kind→icon与data属性适配；共享area/entry/line主题皮肤、2px线、区域6px及线长轴2px留白，反馈不改语义几何。smoke选择器迁移为 `data-drop-feedback*`。nb-ui的drop-indicator既有五场景增加“显示共享覆盖层”按钮，可检查真实fixed覆盖层。接入规则与常见陷阱落在 `packages/nb-ui/docs/ui-development-spec.md`，组件文档与workbench-shell spec引用同一合同，不创建平行规则文档。

非浏览器证据根：系统Temp `neuro-book/acceptance/product-runtime/editor-dnd-migration-1789981993152/`。公共几何/覆盖层2文件38例、nb-ui typecheck与build:css通过；真实Editor Provider的7例使用库自身registry、PointerSensor/KeyboardSensor、collision、resolver与释放路径，jsdom只补缺失布局/命中/动画查询/pointerCapture能力。初次执行暴露jsdom接口缺失与宿主单根透传回归，前者补环境能力，后者恢复最外层section。应用类型对照升级后的94条诊断，归一行号后added/removed均为空；不是全量类型通过。

手动检查场景：主应用 `/lab` 的EditorWorkbench mixed检查间隙/尾部换序、固定切换、工具栏分屏后跨组中心/四边投递、Escape和离开窗口清理；EditorTabBar overflow检查横向滚动与末项；WorkbenchShellLayout对照区域框/线宽/提示外观；nb-ui playground的drop-indicator检查独立原语与共享覆盖层。本轮没有操作浏览器或创建真实业务数据。

最终组合检查18文件184例通过（38.66s），恢复的EditorTabItem公开focus合同单文件5例通过（7.50s）。`NODE_ENV=production bun run nuxt:build:raw`完成（142.57s），有sourcemap、第三方注释及chunk大小警告，无构建失败。docs检查6227文件、failures为空，governance failures/warnings为空（53.02s）；18个核心源/测试文件无冲突标记或尾随空白。完整构建输出、诊断对照与检查结果保留在证据根，临时探针均已移除。

服务异常单独记录：原workbench-feedback-3001在运行约2小时后退出134，日志为Node约4GB堆耗尽。恢复后发现同工作树另一来源启动的Nuxt实例持有runtime.lease，返回ELOCKED；已停止自己恢复的重复服务，没有结束外部实例或删除租约。外部实例重启时曾返回500（worker entry not found，`.nuxt/dev/index.mjs`），完成重建后最终 `http://localhost:3001/lab` HTTP 200、4695字节；原始错误与最终状态保留在service-exit/recovery/final.json。这仅证明入口响应，手动浏览器验收尚未完成。

独立审阅收口：SharedFeedback判定correct，指出未知kind可能从原型链取图标（P3），已加Object.hasOwn并用constructor反例验证，适配层3例通过（8.15s）。EditorSession最初以HEAD而非迁移前共享工作树EditorGroup作比较，误报外部native回归；核对实际前置“仅activeDraggedTab时挂捕获层”后审阅撤回finding，最终correct/findings为空。没有添加全局.prevent改变视图外部文本行为。真实浏览器的top-layer命中、缩放、横向滚动、触摸与空固定区起拖首帧变化仍交开发者检查。最终docs检查6228文件、failures为空，governance failures/warnings为空（41.22s）；证据根无剩余一次性脚本，审阅原始与纠正结论一并保留。

## 2026-09-21 标签插入间距与分屏常驻接缝

用户澄清插入条问题是「标签 | 标签」之间需要留白，不是反馈提示药丸。公共 `resolveListInsertion` 将有足够间隙的相邻可见成员之间的 2px 插入线居中，保持同一 beforeId 只有一条稳定线；无间隙、首项、尾项及裁剪边界仍保留既有退化规则。`EditorTabItem` 左右各 4px 外边距形成 8px 槽，不在拖动时挤开标签。横竖间隙回归先失败（2例），修复后几何/覆盖层 2文件39例通过；应用最终聚焦16文件128例通过（20.19s）。

共享 `Splitter` 新增独立 1 CSS px `--divider` 常驻接缝，既有 3px accent 悬停/拖动带保留，零宽 sash 不渲染两层装饰；命中盒、尺寸、Grid 与 Store 不变。审查补正了缩放容器下近端边对齐的 scale 换算。nb-ui全量29文件518例通过（缩放补正前）；补正后Splitter单文件55例通过。nb-ui typecheck、build:css通过；未将此前生产构建或应用94条类型基线当成本轮通过证据。

本轮确实操作隔离浏览器，区别于上文迁移阶段的手动验收记录。3001遇存储租约冲突后未删锁；临时3011因空State要求迁移而停止，未执行迁移。开发者随后明确原3001已关闭并授权重启，`editor-spacing-3001` 启动成功，保留供复测。浏览器确认Editor mixed标签槽两侧各3px、插入线2px、源opacity=0与唯一活动overlay；三组布局同时测得横竖常驻线厚1px、opacity=1，静止交互带opacity=0，悬停后交互带厚3px且opacity=1。截图位于系统Temp `neuro-book/acceptance/product-runtime/editor-spacing-1789992365370/`。

VS Code main源码分析已区分：普通中央投递是并入组、边缘投递是分屏；Ctrl（Windows/Linux）/Option（macOS）复制。Shift在目标支持时让组覆盖层让位给正文DropIntoEditor及其provider，文件载荷可转路径/链接，不等于插入文件全文。独立组分屏与Split in Group是不同模型；当前未改修饰键、20%边缘带或增加组内双视图。Tab菜单“双栏”的产品含义仍待开发者确认，不把分析结论冒充功能已实现。

## 2026-09-21 多行标签模式

开发者澄清「双栏」是标签自动换行，不是新的编辑器视图。每组更多操作新增「多行标签」复选项，默认单行；开关仅为组挂载期间的呈现状态，不写Store或持久化。多行按固定优先的连续流换行，外层唯一滚动宿主改为纵向，180px上限与组头50%上限保留正文空间，工具栏留在顶部。关闭模式恢复36px单行及横向滚轮；切换不改标签顺序。

多行落点登记整个标签带，以可见行筛选后复用共享resolveListInsertion；行尾映射完整分区后继，不误追加到全列表末尾，跨行同一边界统一显示下一行首项前的插线。空固定/普通分区拖动时保留24px落区。上下键按实际相邻行找同列最近项，固定标签高度略矮不误分行；Ctrl+Space仍交拖动会话。独立EditorTabBar Lab也有同样开关，但只记移动意图，EditorWorkbench Lab实际应用排序。

最终应用聚焦16文件132例通过（19.20s）；新增跨行解析、真实Provider提交/模式重登记、上下键与多行滚轮不转换回归。Splitter审阅未找到实现错误，指出整数起点缩放测试无保护力，已改400.2→402.2并验证视口近端400；单文件55例通过（4.89s）。

真实浏览器验证：桌面509px标签带自动排4行、scrollWidth等于clientWidth；当时quick-draft已在chapter-01前，该次释放是顺序不变的no-op，不能作为实际排序改变证据。拖动中2×24px插线、源opacity=0、唯一overlay。上下键AGENTS→chapter-01→AGENTS；关闭多行后恢复36px、顺序不变。390px画布标签带312px、最大高180px、纵向scrollHeight250px，End能滚到末项（scrollTop70），正文仍617px高。四种主题样式均检查，无横向溢出；未扩称四主题全部明暗组合。

最新应用typecheck仍失败：101条诊断、11文件，全部位于本轮未改的Agent fixture、ReferenceSelectorPopover及Agent视图文件；没有Editor工作台/本轮fixture诊断。不把历史94条当作当前数量，也不宣称全量类型通过。完整日志artifact://7756。范围diff检查还报告已有6处EOF空行（含原有EditorTabBar.test.ts末尾），未顺手格式化其他工作。

截图工具的path参数实际未落到指定证据根，前面的截图路径声称需按工具返回的omp-sshots临时webp理解；最终改用page.screenshot明确落盘wrapped-tabs-final.png、wrapped-tabs-390-final.png及对应JSON，位于editor-spacing-1789992365370证据根。3001保留供开发者复测；没有commit、push、迁移或删除存储锁。

Splitter既有Playwright回归最终14例通过（51.2s，artifact://7776）。首次复用3010因localhost可达但127.0.0.1不可达而在webServer等待120秒超时，未进入用例；随后通过hub临时启动同一nb-ui playground于127.0.0.1:3012，显式复用后完成全部用例。验证后停止3012及本轮临时3010，主应用3001继续保留。

## 2026-09-21 拖动源保留、固定分区与中央无操作

本节取代上面历史记录中的源隐藏、混合多行与空分区起拖时出现的合同。按开发者反馈采用「保留源Tab + Custom DragOverlay + 插入线」，不引入实时排序动画或源快照。起拖不再生成24px空落区，源位置/尺寸/可见性不变；固定区为空时可用菜单固定第一项。单行固定区不登记目标且解析器明确拒绝拖入；多行固定区在普通区上方独立换行，两区有真实盒、浅底色/分隔。正文中央不给预览、不提交任何操作，跨组移动走标签栏，四边仍分屏。

共享resolveListInsertion新增可选edgeGap（默认0不改变其它宿主），Editor传4px；Tab左右各6px，内部12px槽中的2px线两侧各5px，首尾可见空间足够时留4px。共享DropFeedbackOverlay区域/居中药丸只做opacity淡入，按语义变化重放，不插值几何、不保留离场；插线不动画，reduced-motion归零。文档与i18n死键同步，未新增Store/Grid状态或全局preventDefault。

本轮实际验证：应用Editor聚焦16文件133例通过（28.28s）；nb-ui全量29文件525例通过（11.13s），共享几何/反馈2文件45例复核通过（2.14s）；nb-ui typecheck通过（35.61s）；nb-ui build:css通过并更新dist产物。一次在workspace根运行build:css失败（无该脚本），随后在packages/nb-ui正确执行成功。应用全量typecheck仍为101条/11文件（artifact://7812），未出现本轮Editor文件诊断；git diff --check仍报已有9处EOF空行及CRLF提示，未处理无关格式。未重跑完整生产构建或Splitter e2e，不用历史结果替代。

真实浏览器localhost:3001/lab：chapter-01起拖后全部9个标签矩形逐字段不变，源opacity=1、placeholder=0、活动overlay=1。首项.env前线右缘距标签4px；.env/AGENTS内部线两侧各5px、线宽2px、仅一条。quick-draft从普通区末尾实际移到AGENTS前，顺序从[.env,AGENTS,...,quick-draft]变为[.env,quick-draft,AGENTS,...]；中央释放不改顺序，反馈0而跟随overlay仍1；区域淡入实测90ms、中途opacity约0.864，reduced-motion时0s/opacity1；Escape后反馈与活动overlay均0，该段浏览器console warning/error为空。

通过真实菜单固定.env、AGENTS后，390px画布固定区真实换成三行（top154.5/188.5/222.5），普通区从253.5开始；标签带clientWidth=scrollWidth=312、高180、scrollHeight319，正文617px。四主题切换保持NeuroBook·夜配色，均无横向溢出；不声明未测的其它配色。证据目录：系统Temp/neuro-book/acceptance/product-runtime/editor-partitions-1789999824050/，含pinned-wrap-390.png、runtime.json、themes.json。3001继续留给开发者复测；没有commit/push/迁移/删锁。
