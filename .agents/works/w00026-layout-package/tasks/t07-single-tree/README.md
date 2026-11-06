---
schema: nbook.task/v2
taskId: t07-single-tree
status: active
updated: 2026-11-06
---

# 合成一棵树：外壳、视图容器、编辑组

## 目标与范围

按 t03 的设计把 shell/layout、views/placement、container-grid 与 editor/groups 迁到一棵树，三层 Teleport 与 TeleportMemory 能去掉的去掉；布局记录按 t03 的方案迁移；改 Spec 并跑通现有验收。这是这个 Work 影响面最大的一段。

合同：新建 `docs/specs/ui/workbench-layout.md`（计划第 1 片），切换时取代 `ui/workbench-shell.md` 的外壳一到三。计划见 [`plan.md`](plan.md)。

**开工前的确认点**（开发者 2026-11-05）：t04、t05、t06 交付后，开发者用真实产品的手感再确认一次，确认后才开工。

**从 t06 留下的**（还有一批接入形状的遗留，见 [t06 记录](../t06-flat-renderer/README.md) 的“遗留”，先看）：DOM 序与树序不一致时，从 grid 外面 Tab 进来、点击空白处后按 Tab 仍按 DOM 序（t06 设计审查第 7 条，Chrome 复现）。t06 里只有外壳改面板位置才不一致，t07 之后会很常见，要用 `focusin` 处理：进入时落在树序的首或尾，叶外框或可给 `tabindex="-1"` 接住点击。外壳的 `shellNodeRects` 与 `placeGrid` 算同一件事，这里一起去掉。

**从开发者手感反馈来的（2026-11-06）：** t04 到 t06 试手感时提的几条落在现行的多棵树和 ViewContainer 上，t07 之后才有自然的做法，不在旧代码上另写：

- 视图放到活动栏再成为单独容器时，现在是视图瞬间到位、落点高亮从活动栏 2px 的插入线长成整个侧栏再淡出（约 370ms），看着不对。开发者的意见是让视图自己有占满容器的动画。一棵树之后移动的叶外框直接从旧矩形过渡到新矩形；从标签组拆出来的新叶，第一帧矩形应能由调用方给（来源面板、活动栏图标），`enteringRects` 现在只会从相邻的边长出来。
- **跨面板移动视图要有位移（验收场景）**：`侧栏(视图 A | 视图 B) | (编辑器 A.md | 编辑器 B.md) | 右栏(视图 C | 视图 D)`，把视图 A 移到右栏。现在是先消失再瞬移过去，同一个容器里移动才有动画（开发者 2026-11-06 明确的场景）。放下后视图的外框要从旧矩形过渡到新矩形；拖动中的实时预览归 t08。
- 单个标签的编辑组移到别处，现在是删旧组、建新组（`groups.ts` 的 `moveToNewGroup`），新组从边上长出来。一棵树之后应该是同一块叶移动，内容不重建。
- 拆分时的份额开发者没有要求改：现在只分被拆的那一组，VS Code 缺省（`workbench.editor.splitSizing: auto`）是各组等宽时全部重新等分，两者的差别只记在这里。

## 当前状态

开发者 2026-11-06 回复“可以”开始。计划第二稿已按设计审查修订；“统一标签条、每标签一实例单列 Task”开发者还没回复，按计划的建议先走。

设计审查（一个 Sonnet，[`evidences/plan-review.txt`](evidences/plan-review.txt)，26 条：阻断 2、重要 17、建议 7）的处理：

| 条目 | 处理 |
|---|---|
| 1 内容层没有裁切方案 | 成立。比报告建议的 `clip-path` 更简单：内容项和叶外框一样两层，外层按矩形摆放并裁切，内层沿用 t06 的尺寸规则。外层不是叶外框，飞行中不被邻叶裁，也不换父元素 |
| 2 全是 `fixed` 的分支留白 | 成立（实验属实）。余量规则：含编辑组，或兄弟都不含编辑组的子节点是 `weight`。工具列按比例分，和现行容器网格一致。不用改提案里工具面板的宽度限制 |
| 3 隐藏面板的缝宽 | 成立，改法不同：隐藏的面板不进呈现树。零宽叶夹在中间时拖那条缝改的是隐藏面板，这比缝宽更严重，报告没提到 |
| 4 展平不守恒 | 成立。意图统一用 CSS px，结构操作前写成呈现尺寸，不用换算；性质测试 |
| 5、6、7、8 内容层的判定、叠放、焦点、取整 | 成立，按报告改 |
| 9 片 3 与接入遗留矛盾 | 成立。接入遗留移到 7a 跟宿主一起改 |
| 10 未绑定窗口的坏标签 | 成立。存盘前去掉动态标签 |
| 11 两份记录 | 成立。随机 `tabId`、按键合并、先 `editor.tabs` 后布局。不改提案的“按所有者分记录”，报告提的“按写入频率分”不采纳：写入顺序解决了问题，不用改上游 |
| 12 接缝切错 | 成立。按标签级操作切，活动组归工作台 |
| 13 现行行为遗漏 | 成立，逐条补进范围与设计 |
| 14 片 7 太大 | 成立。拆 7a、7b，7a 的中间态是编辑区暂时还是一棵子树；开发者的场景在 7a 就成立 |
| 15 验证与删除清单遗漏 | 成立，补 |
| 16 放不下 | 成立。纯函数 `presentationCollapse`；被收走的面板不进呈现树，不会出现“拖开呈现收起”的语义问题 |
| 17 原位判据 | 成立 |
| 18 编辑器协议 | 部分成立。补 `replaceTab`、`reorderTab`。两阶段关闭移到统一标签条：t07 里关闭按钮还在编辑器里，不用翻转调用关系 |
| 19、20、24、26 | 成立，已写进计划；第 26 条去掉 `restoreSize` |
| 21、22 焦点交接、验收缺口 | 成立，补 |
| 23 两份 Spec 并存 | 成立，改法轻：新 Spec 是一块新能力（README 允许），旧 Spec 文首写明将被取代，其余 Spec 加条目级 planned |
| 25 收尾动画的依据 | 成立。写明改动提案去向表一行，依据开发者 2026-11-06 反馈 |
| 待确认 1 的三个条件 | 接受：内容项的 `key` 由编辑器给；面板头按 `TabStripProps` 接参；代价已如实写 |

第 2 片的实现审查（一个 Sonnet，[`evidences/slice2-review.txt`](evidences/slice2-review.txt)，17 条：重要 11、建议 6，含约 4.5 万次随机操作的实验）：

| 条目 | 处理 |
|---|---|
| 1、2、9、11 展平、收起、写回、塌陷的分支：意图单位不统一 | 成立，同一个根因。改成一条写入路径：`rebaseIntents` 从呈现尺寸写回，手势后不读 `serialize()`（`writeBackIntents` 删掉）；收起的面板不写；全是工具面板的分支有兄弟不在时只更新彼此比例；展平按占份额的节点放大。比报告的逐条修更简单。Lab 里“展开只回到 80”也是它 |
| 3 同一横向分支的工具面板全部拖到零时留白 | 成立，接受：很少见，拉回一块就好，grid 给诊断 |
| 4 枚举没有产出原位 | 成立，注释写错了。原位由会话管（拿起时停在那），枚举不列 |
| 5 枚举每个候选做一次提交，极端规模 16 秒 | 成立。改成便宜的 `isInPlace`，提交时再判规范形相等 |
| 6 `SEAM_PX` 8 太大 | 成立。改 4，条与标题栏经 `excluded` 先排除 |
| 7、13 交界一行、插入位下限 | 成立，已改 |
| 8 校验漏检 | 成立，补全；`projectLayoutDoc` 抛错的输入现在过不了校验 |
| 10、12 `canInsert`、`replaceTab` 重复 | 成立，已改 |
| 14 变异存活 | 成立，补了缩放、交叉轴、交界的用例 |
| 15 `newId` 被预览调用 | 不改：宿主给随机 id，用掉几个没有影响 |
| 16 夹具进发布包 | 成立，`package.json` 的 `files` 排除 |
| 17 其余 | `structuredClone` 与响应式代理：写进模块头，文档放 `shallowRef`。`edgeTargetOf` 不知道被收走的兄弟、`newId` 冲突、`stripDynamicTabs` 无变化返回新对象：不改，收益小 |

第 3 片（内容层）实现后，Lab 的 11 条用例抓到两个真问题：整块面板移动时被别的面板盖住（`data-flying` 改成也看新旧矩形是否相交，外框也抬）；收成标题行时内容没停放（内容自己的矩形为零也算）。

第 3 片的实现审查（一个 Sonnet，[`evidences/slice3-review.txt`](evidences/slice3-review.txt)，15 条：重要 6、建议 9）：

| 条目 | 处理 |
|---|---|
| F11 内容外层 `tabindex` 打断内部滚动区的键盘滚动（推断） | 成立，代价不对等。外框和内容都不接焦点；点空白后的 Tab 改成记下按下的元素，在 `document` 上接，从那一块按树序走。F4、F5 随之消失。e2e 补“点内部滚动区之后键盘还能滚动” |
| F1 开局收起的内容不停放 | 成立。量到容器之后矩形为零就算，不要求有过尺寸 |
| F3、F6 `tabPending` 残留、弹层还焦点被改写 | 成立。在 `document` 冒泡阶段设（别的处理器跑完之后），`preventDefault` 了的不算，定时器在任务结束时清。不靠 keyup |
| F2 Shadow DOM | 成立，改用 `getRootNode` |
| F9 变异存活 | 成立。M7、M9 随设计改动消失；其余补 e2e 与 DOM 用例（预览不停放、内层保持尺寸、站内走进内容、程序聚焦与点击不改落点）；dpr 用例改成写死的期望 |
| F7、F12、F15 | 成立，已改：没活动过的也记尺寸；非法 inset 按 0；从零展开的不算飞。重复 key 不校验：内容来自文档，`validateLayoutDoc` 已保证 |
| F8 不传 `contents` 也受 Tab 重定向影响 | 设计如此（DOM 序与树序不一致时才走），Spec 改清楚了 |
| F10 “压在上面”靠时机 | 成立。改成等飞到重叠处再点 |
| F13 `NestedGrid.vue` 变胖、停放两份 | 成立。抽出 `useContentLayer`，叶的停放仍归 `useLeafParking`，内容只加自己的情况 |
| F14 外层站内步进覆盖内层“离开”（推断） | 不改：结果和浏览器相同；片 7b 之后内层 grid 没有了 |

回归：`lab-grid-panels`、`lab-grid-structure`、`lab-nested-grid`、`workbench-shell`、`workbench-views`、`workbench-dnd`、`editor-area` 共 156 条，153 条过；`workbench-shell` 的 3 条 Lab 用例在负载 15 以上时超时，单跑全过。

第 1、2、3 片已合入 master。

开发者 2026-11-06 试了第 3 片的 Lab：指出最大化时 ea、eb、e3 也跟着变（从布局里摘掉，还原时重新长一遍）；其它没发现问题。改成最大化盖在上面，别的面板不动，Spec 与计划已改。

第 4 片已合入（不接产品）：`layout-doc-store`、`default-tree`、`layout-constraints`、`shell/adjacency`，17 + 10 条单元测试（真实 storage）。写的时候抓到：别的窗口保存后本窗口显示被带着变，改成打开时只读一次记录。

第 5 片已合入（不接产品）：`WorkbenchSurface`、`WorkbenchPanelHead`、`WorkbenchToolStrip`，Lab 场景 `WorkbenchSurface`（`default`、`cards`，画布要宽，`vp=1400x720`），`lab-workbench-surface` 14 条，`state/layout-present` 与 `shell/adjacency` 单元测试。计划说组件样式派 Sonnet，实际主会话写了：样式大多从现有组件搬过来，接线和样式分不开。

写的时候定下来、计划没写到的：
- 内容层在外框之外，所以卡片的内边距和圆角在内容上要再写一遍，两层才拼成一张卡片。
- 视图动作随鼠标的范围是整块面板，指针在内容上时外框没有 `:hover`：表面按指针与焦点所在的面板写 `data-hover-actions-active`。
- 活动栏条目鼠标点时不抢焦点，否则“已经聚焦时隐藏”永远判成“焦点不在里面”。
- `NestedGrid` 加了 `sashKind`（写 `data-sash-kind`，一棵树里分隔线分三种颜色）和 `content` 插槽的 `leaf`。

片 7b 要请开发者看一眼：Spec 输出 19 按邻接算，卡片主题里相邻的两个编辑组是两张卡片加半缝，中间还有一条线；现在的产品里编辑区是一张卡片加一条线。

第 6 片已合入：`groups/panels.ts` 是接缝（`PanelTabs`、`PanelTree`，本地实现 `createLocalPanels`），`groups.ts` 只留标签属性；标签 id 改随机串。`groups.test.ts` 原有用例一条没改，新增 12 条接缝测试、2 条身份测试；`editor-area` 37 条全过。

第 7a 片已合入（`71e5f88c6`）：产品外壳切到一棵树。`WorkbenchShell` 接 `layout-doc-store`，工具面板、活动栏、记录 `workbench.layout`、命令与公开状态按新合同；工具视图的拖放在 `web/layout-drag.ts`（指针、键盘、预备区）。编辑区还是树里一块 `role: "editor"` 的面板，里面是原来的 `EditorArea`，标签拖动不变（片 7b）。旧代码留到片 8。

测试：`workbench-shell`（14 条）、`workbench-views`（27 条）、`workbench-dnd`（23 条）由 Sonnet 按去向表改写，它们报的产品问题主会话核实后修：`movable: false` 能被命令移走；纵向分支 Enter 收起后回不到原高度（落账时先写回意图、后标记收起）；用键盘在面板头隐藏面板后焦点掉到 body；“移动到”菜单关闭后焦点不回标签；窄屏把不省宽度的面板也收走；拖到零的侧栏没有预备区（量错了元素）；预备区被编辑组的外缘窄带盖住；视图拖不到编辑区旁边（空面板整块算中央）。

实现审查（一个 Sonnet，[`evidences/slice7a-review.txt`](evidences/slice7a-review.txt)，重要 2、建议 9）：

| 条 | 处理 |
|---|---|
| F1 最大化的面板被搬空后卡住 | 改。这块面板隐藏、收起、不在了都退出最大化 |
| F2 被压缩的尺寸写进意图 | 改。保留像素的节点只有被手势拖动才写（`fixedNodesOf`、`rebaseIntents` 的 `frozen`） |
| F3 Tab 绕不回去、F4 键盘的外缘被预备区盖住、F5 活动栏拿起没有原位 | 改 |
| F6 保存交错 | 改。关卡之后才取文档 |
| F7 被盖住时显示按钮没反应 | 改。显示被最大化盖住的面板时退出最大化 |
| F8 失败码与文案 | 改。Spec 的表补 `stale-target`，`limit-exceeded` 记诊断 |
| F9 `layout-drag`、`view-instances` 没有单元测试 | 接受。由 e2e 覆盖 |
| F10 零散 | a、c、e、g、i 改；b 模板里的非空断言、d 写死的占宽、f 诊断属性的中文、h 两条读路径留到片 8 |
| F11 压编辑组时不放回 | 改 |

回归中再修的：编辑组放不下时求解器连活动栏一起压（只压编辑组）；放下时高亮立刻消失（开发者 2026-11-06 看到旧外壳的高亮跟着内容走，要求松手就消失，Spec 输出 30 已改）。

最后一轮验证：类型检查、单元测试（workbench、settings、editor 752 条，nb-layout 366 + 162 条）、`governance:check` 通过；e2e 24 个文件里跑到的 232 条加 `workbench-*` 69 条全过。`lab-scenes` 没跑到；上一轮它的差异里 27 处是 `AgentConversationView`、`AgentStatusBar` 的提示光晕（w00032 t28 合入的，不是这一片），属于这一片的已修并有用例。`src/plugins/lab/web/fixtures/index.dom.test.ts` 的 `AgentCompactionDetail` 同样是别的 Work 的。

没有覆盖：Spec 输出 19“当前标签加粗”与实际（蓝色下划线加变色）不符，旧外壳就如此，留给 t16 统一标签条定。验收 2 的“放在两块之间”产品页只写了拆块，单元测试覆盖规则。

要请开发者看的：窗口约 1000 宽时编辑区比以前窄（272 变 220，Spec 定的“编辑组吸收余量、最小 220”）；默认宽度的侧栏里资源管理器的五个动作只露三个，其余在“⋯”（Spec 输出 20）。

开发者 2026-11-06 试了第 7a 片：“拖拽动画没有问题，就是拖拽逻辑和行为需要更新”，要求继续做第 7b 片。理解为编辑器标签还是旧的拖动逻辑，第 7b 片并进新规则；如果指的还有视图拖动的具体行为，试完再说。

第 7b 片（分支 `feat/w00026-t07-single-tree`，`c074772d8`）：编辑组是树上 `role: "editor"` 的面板，每块一个 `EditorGroup`，结构由布局文档持有。

- **接缝**：接口与服务键 `editorPanelsKey` 在 `workbench/shared/contracts.ts`（跨插件的运行时导入只能指向那里），实现 `createEditorPanels` 在 `shared/editor-panels.ts`，单元测试与 Lab 用同一份操作的内存版 `createMemoryEditorPanels`。`groups/panels.ts` 的本地 grid 删掉。计划里的 `canInsert` 不放进接缝：写结构的只有编辑器，放下前自己查。
- **记录**：`editor.tabs` 按键合并，只写本窗口有的、只删本窗口知道且关掉的（`known` 在记录读完那一刻定下）。页面标签留一个记号，恢复时从文档里拿掉，才分得清“页面不恢复”和“记录丢了”。丢了记录的标签是一个打不开的页面，显示原因、能关。属性变了自己写，布局存盘前走关卡再写一次；只改属性时写失败没人走关卡，所以 `session.ts` 看到失败就让布局走一次（`flush`），状态栏才亮。
- **组件**：`EditorArea.vue` 拆掉，组级的（提示条、键位、焦点进出）进 `EditorGroup`，区级的（关闭询问、标签拖动）进无布局的 `EditorHost`。贡献点给 `{host, group}`。
- **拖动**：编辑器标签也写 `data-panel-tab`，标签条写 `data-panel-strip`，工作台的会话直接认；多行与固定分区还是编辑器量（`EditorTabDrag.insertion`）。这个合同不带 DOM 类型：`web/plugin.ts` 会被测试导入，进不带 DOM 的类型检查，`tab-drag.ts` 只从 `EditorHost.vue` 进来。放下走编辑器区的动作（结算输入、合并同一标签）。单个标签的组是同一块面板移动，不结算、不重建。

和计划不一样的地方：布局的合并保存从 1 秒改成 150 毫秒。e2e 里切语言后马上刷新，活动标签回到了上一个，试过 `pagehide` 补写，页面等不到关卡的往返，所以缩短，只合并一连串的动作。

行为变了要告诉开发者的：拖到本组正文中央现在是原位（以前排到普通标签末尾，固定标签会取消固定），和工具视图一致；焦点移到别的面板不再取消拖动，移出工作台才取消；合入时开着的标签丢一次（提案已接受）。

片 7a 漏的一处在这片修了：`nbook.view.move-view` 的 `target` 是联合类型，`src/command-args.test.ts` 不通过。片 7a 收口时单元测试是按目录跑的，没覆盖这个文件；这次用 `test:affected` 才发现。

验证：类型检查通过；`test:affected` 除两条别的 Work 的（`plugins/agent` 的跨插件导入、`AgentCompactionDetail` 没有场景）全过；e2e `editor-area` 40 条、`workbench-dnd`、`workbench-shell`、`markdown-editing`、`lab-editor`、`editor-types` 全过。

## 下一步

第 7b 片的实现审查（一个 Sonnet）处理完就合入，然后请开发者在产品里试编辑器标签的拖动。之后第 8 片：删旧代码，晋升 Spec。
