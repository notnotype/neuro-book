# t22 批注界面的使用反馈：实施计划

## 1. Context

开发者 2026-11-12 试用 t13 的批注界面后提了五条反馈和两个问题；同一天看过方案与取舍（会话里确认，“可以，都做”）。依据的 Spec：[`docs/specs/workbench/markdown-editing.md`](../../../../../docs/specs/workbench/markdown-editing.md) 输出 28–35、[`docs/specs/workspace/markdown-dialect.md`](../../../../../docs/specs/workspace/markdown-dialect.md) 输出 11；上一个 Task 见 [t13](../t13-comments-ui/README.md)。

开发者的反馈与已确认的决定：

1. 浮层的打开位置与对齐再调整：现在卡片以光标为中心，盖在下一行字上。**改成左边缘对齐被批注文字在这一行的起点，贴在这一行下面，放不下翻到上面**。
2. 两条批注重叠时波浪线也重叠。**嵌套的第 2、3 层把下划线往下错开**（已在 Chrome 里验证：嵌套的 `<comment>` 各画各的线，各用自己的 `text-underline-offset`）。
3. 点到带波浪线的句子就弹卡片，打扰编辑正文。**改成鼠标停在带波浪线的字上约 0.4 秒才弹“看”卡片**，鼠标移进卡片不收；点击、方向键走进批注都不再弹；光标在批注里按 Ctrl+Alt+M 仍直接进“写”。
4. 页边：不要左边框；卡片点一下就变大，规范要求同一组件各状态尺寸与版式尽量不变；开关页边、卡片出现与移动没有动画。
5. 块批注（“整段视角混乱，需要重写”那种）样式与别处不同（虚线左边框加缩进），而且没有入口。**样式统一成与行内批注一样；块菜单加“批注”入口**。
6. 开发者问“编辑批注内的文字是否符合预期”，核对后发现：整句选中批注文字再打字替换，批注连同意见一起消失。**新字继承批注**（开发者同意）。

工作方式：Task 记录在主工作区；代码在 worktree `.worktree/w00025-t22-comments-feedback`（分支 `feat/w00025-t22-comments-feedback`），从 master 开出。设计开发者已确认，不做计划审查，只做一次实现审查（前端，Sonnet 子代理）。

## 2. 技术选型

无新依赖。

- 波浪线错开：纯 CSS，按嵌套层数给 `text-underline-offset`（Chrome 实测可行），不用装饰插件。
- 动画：CSS 过渡与关键帧，只消费时长与缓动令牌；不引入动画库。
- 悬停：原生 `pointermove` 加计时，不用 Floating UI 的 `useHover`（它假设有一个触发元素，这里的触发区域是正文里按需出现的 `<comment>` 元素）。

## 3. 关键设计

### 3.1 `packages/nb-ui`：`AnchoredPopover` 加对齐、规范补一条

- `AnchoredPopover.vue/.md`：新增 `align?: "start" | "center" | "end"`，缺省 `center`（现有调用方不变），直通 reka 的 `align`。`.md` 的“数据”与“布局”补一句；组件测试补一条“`align="start"` 时外框左缘与锚点左缘对齐”。
- `packages/nb-ui/docs/ui-development-spec.md` 第 3 节第 4 条加一条：同一组件的几种状态（摘要、展开、编辑，收起、展开）外框与内部版式尽量不变：只在某状态出现的零件（操作按钮、计数）放进预留的位置，用可见性或透明度切换；内容长短不定的限定行数，要看全文走已有的“打开详情”入口；不得不变尺寸的（长文展开、输入增行）要做过渡动画，并且不得推动周围的内容跳变。开发后自检清单里“对话框、面板在几种状态之间逐个切一遍”那条把“卡片”并进去。
- `design-language.md` 的动效节补“列表里卡片的出现与移动”一条：出现用透明度加短位移（`--motion-move`），位置变化用 `top` 的过渡（`--motion-move`、`--ease-layout`），消失用透明度（`--motion-fast`）；首次排版不动画。

### 3.2 `packages/nb-markdown`

- `display/markdown.css`：
  - 批注波浪线按嵌套层数错开：第 1 层 `0.3em`，第 2 层 `0.6em`，第 3 层及以上 `0.9em`；`comment comment`、`.nb-comment-block comment`、`comment .nb-comment-block`、`.nb-comment-block .nb-comment-block` 这几种嵌套都算一层。
  - 块批注去掉虚线左边框与 `padding-left`，只留波浪线，样式与行内一致。
- `editor/comments.ts`：
  - `commentsAt(state)` 拆出 `commentsAtPos(doc, pos)`（不看选区是否为空），悬停按指针下的位置取批注；`commentsAt` 调它。
  - 删除 `commentEntry`（`editor/comment-entry.ts` 与它的测试）：光标“进入”不再弹卡片。
- `language/syntax/comment/index.ts`：
  - **替换时继承批注**：给 `Comment` 加一个 ProseMirror 插件。`handleTextInput(view, from, to, text)`：`from < to`，且第一个被替换的字符上有批注标记 M、整个 `[from, to]` 都在 M 里（每个行内节点都带 M）时，用 `tr.insertText` 后对新文字补上这些 M（可能不止一条，重叠的几条都继承）；`transformPasted` 同理：选区在批注里、粘贴内容是单段行内文字时给文字加上标记（沿用 `pastedComments` 的位置，先继承再换新 `key` 的逻辑不能冲突：继承的是选区里原来的批注，不是粘贴内容自带的）。选区超出批注末尾（跨了未批注的字）时仍按原样，不继承。Backspace、Delete 仍是删除，批注随之去掉（预期）。
  - `addComment`：选区是**节点选区**且节点是块时（块菜单的“批注”），用 `tr.wrap` 包进 `commentBlock`；其余路径不变。
- `editor/editing-actions.ts`：`canComment` 认节点选区（块能包进 `commentBlock` 即可，`findWrapping` 非空）。块菜单点“批注”的选区由新函数 `selectBlockForComment(editor, target)`（`block-actions.ts`）放好：`text` 与 `list-item` 选中这一块自己的文字（空块返回 false，菜单置灰），`code`、`container`、`whole` 用节点选区。
- `editor/held-selection.ts`：`holdSelection` 遇到节点选区时再画一个节点装饰（同一个类），原子块（表格、图片、分割线）也看得出选中了谁。
- 两个包导出（`editor/index.ts`）：加 `commentsAtPos`、`selectBlockForComment`，去掉 `commentEntry`。

### 3.3 `packages/neuro-book/src/plugins/markdown/web/components`

**`menus/selection-anchor.ts`**：新增 `commentLineAnchor(editor, scroller, pos, info)`：返回的虚拟锚点矩形高度取 `pos` 所在那一行（`coordsAtPos`），左边取这条批注的文字在这一行的最左（用 DOM `Range` 的 `getClientRects` 里与这一行垂直重叠的最小 `left`；取不到时退回 `coordsAtPos` 的 `left`）。每次定位重新量。`caretAnchor` 由它取代，被删。选区锚点 `selectionAnchor` 不变（多行选区外接框的左边就是版心左缘）。

**`menus/comments/MarkdownCommentLayer.vue`**：状态机重写，“看”由悬停打开：

- 新状态 `viewing: {pos: number; session} | null`：卡片对着哪个位置、悬停还是跳转打开的。卡片里的批注是 `commentsAtPos(doc, viewing.pos)`，每个事务现算（沿用不缓存）。
- 打开：`scroller` 上 `pointermove`，目标在 `comment, .nb-comment-block` 里且指针没在卡片上时起一个计时（`hoverDelay`，缺省 400ms，作为 prop 注入，测试传小值），到点按指针坐标 `posAtCoords` 取位置，有批注才打开。指针换到另一条批注上重新计时；移出批注文字与卡片后 `closeDelay`（250ms）收起；指针回到卡片取消收起。
- 立刻收起：文档变了（输入）、选区变成非空、在正文里按下指针（点击就是要编辑）、Esc（只读文档的 Esc 听 `document`）、换文档、变只读、别的弹层开着（`blocked`）、开始“写”、页边画出来时不出浮层。
- 上一条、下一条与点页边摘要：`gotoComment` 后 `viewing.pos` 置为目标的起点，浮层移过去（页边画着时只是当前卡片换了）。
- 键盘：Ctrl+Alt+M 在批注里直接进“写”（不变）。删掉 `focused`、`readingInside`、`previousInside`、`pendingOpen`、`pointerDown` 与 `selectionchange` 监听：悬停不需要焦点，只读文档也一样能悬停。
- `shown`（正文里标出的那条）：浮层开着时是卡片里排在前面的那条。
- “写”与浮层的锚点：新批注用 `selectionAnchor`，已有的用 `commentLineAnchor(…, pos = viewing.pos ?? 光标位置)`；`AnchoredPopover` 传 `align="start"`；选区锚点的浮层（新批注）同样 `align="start"`。
- 新增 `beginAdd()` 对节点选区也成立（块菜单），无需新方法。

**`menus/comments/MarkdownCommentCard.vue`**：

- 结构固定：意见（“看”是文字，“写”是自动增高的文本框）加一个预留的底行（`min-height: 24px`）。“看”的底行：左边“第 i 条，共 n 条”，右边上一条、下一条、编辑、删除；“写”的底行：右边取消、保存，左边空着。
- 新增 prop `variant: "float" | "margin"`，取代 `compact`。`margin` 时：意见最多显示 3 行（行数上限，`-webkit-line-clamp: 3`），按钮在非当前且没悬停、没聚焦时 `visibility: hidden`（占位不变）。当前的卡片（`current`）意见放开到最多 12 行，高度变化瞬间完成、后面的卡片滑开（见下）；没超过 3 行的意见两种状态一样高。点非当前卡片发 `select`。
- 底行里的零件只是显隐，卡片尺寸与版式在“摘要、当前、写”之间只有意见区的行数随内容变。

**`menus/comments/MarkdownCommentMargin.vue`**：

- 去掉 `border-left`；卡片底色用 `--bg-panel` 加一点文字色（不变），当前与写着的用 `--overlay-surface`、`--elevation-popover` 阴影加 `--panel-outline` 描边（与浮层同一材质，不经 `.nb-ui-popover-surface` 的类，免得切换类时带出别的样式）。
- 动画（只消费令牌，减少动态效果时令牌为 0）：
  - 卡片首次排好位置后才显示：`offsets` 算出后下一帧置 `ready`，`ready` 时挂一次入场动画（透明度 0→1、`translateX(8px)→0`，`--motion-move`、`--ease-layout`）。`ready` 之前 `visibility: hidden` 且不过渡，所以换文档、首次打开不会从顶上滑下来。
  - `top` 加 `transition: top var(--motion-move) var(--ease-layout)`，仅 `ready` 的卡片有；页边里卡片增减、意见增行时后面的卡片滑动。
  - 当前态切换：`background-color`、`box-shadow` 与按钮透明度 `--motion-fast`。
  - 退场：`TransitionGroup` 的 leave 透明度 `--motion-fast`（卡片是绝对定位，不挤别的）。
  - 整个页边：`<Transition>` 淡入淡出。
- 开关页边时跟着稿纸走：稿纸右缘在 `padding-inline-end` 的过渡里每帧都在动，页边的 `left` 要跟着，所以开关变化后跑一个 `requestAnimationFrame` 循环重排，到 `transitionend`（或一个安全上限）为止。

**`MarkdownControl.vue`**：`.markdown-control-root` 里滚动容器的 `padding-inline-end` 加 `transition: padding-inline-end var(--motion-layout) var(--ease-layout)`（稿纸宽度被版心上限卡住，过渡中途不会重新折行）。`leave()` 里清掉的状态跟着 Layer 的新状态调整。

**`menus/MarkdownBlockGutter.vue`**：块菜单加一项“批注”（“转为”之后、分隔线之前），文案取 `menus.title("comment")`，置灰按 `props.editing.enabled("comment")`（先 `selectBlockForComment` 放好选区），点它发 `comment` 事件，`MarkdownMenus.vue` 接上 `commentLayer.beginAdd()`（与选区菜单、右键菜单同一入口）。只读文档菜单不出现（块按钮本就不出现）。

**`MarkdownMenus.vue`、`MarkdownSelectionMenu.vue`、`MarkdownContextMenu.vue`**：只改转发。

**Lab**：场景“批注：光标进批注出浮层，…”改名为悬停；“批注：页边开着”不变；补一个“批注：重叠与块批注的显示”场景（两条重叠、三层重叠、块批注套行内、一个表格块批注）。

### 3.4 同名 `.md`

`MarkdownCommentCard.md`、`MarkdownCommentLayer.md`、`MarkdownCommentMargin.md`、`MarkdownBlockGutter.md`、`MarkdownMenus.md`、`AnchoredPopover.md` 先改后写代码（组件规范：改行为先改文档）。

## 4. Spec 与文档改动（主工作区 master）

- `docs/specs/workbench/markdown-editing.md`：
  - 输出 20、28（入口：块菜单的“批注”；整块批注的可用条件）、30（浮层：悬停打开、关闭规则、位置与对齐；删去“进入”的定义）、31、32（浮层开着标出）、33（页边：不画左边框、各状态同尺寸、动画）；新增输出 36（**替换批注文字时批注不丢**：整段或一部分被打字或粘贴替换，且被替换的字都在同一条批注里，新字留在批注里；删除不算替换）与输出 37（**批注的显示**：行内与块一样的波浪线，重叠时错开）。
  - 副作用与数据、失败表（块批注包装失败）、实现合同（`commentEntry` 的不变量改成悬停规则）、验收 11–17 按新行为改写，新增 18–20（替换继承、块菜单批注、重叠波浪线）。
  - “批准依据”补 t22。
- `docs/specs/workspace/markdown-dialect.md` 输出 11：显示一句“同一段文字上的批注，波浪线按嵌套错开”；块批注没有特别样式。
- `packages/nb-ui/docs/ui-development-spec.md`、`design-language.md`：见 3.1（随代码在 worktree 提交，属组件包文档）。
- Task README、Work README 登记、`pending-confirmations.md`：悬停代替光标进入的取舍、整句替换继承批注、块批注与行内同样式。

## 5. 切片

1. **Spec 与 Task 记录**（master）：Spec 改写 + 本计划 + 待确认清单。提交前 `docs:check` 与 `governance:check` 的相关项。
2. **nb-ui**：`AnchoredPopover` 的 `align` 与测试、规范两处补写。验证：`bun run --cwd packages/nb-ui test` 里相关文件、类型检查。
3. **nb-markdown**：CSS、`commentsAtPos`、替换继承插件、块批注包装、`selectBlockForComment`、`held-selection`、导出；删 `comment-entry`。先在 `comments.dom.test.ts`、`editing-actions.dom.test.ts` 写测试（含经 `handleTextInput` 的输入入口，不只经命令）。验证：`bun run --cwd packages/nb-markdown test`、类型检查。
4. **neuro-book 前端**：先改同名 `.md`，再改 `selection-anchor.ts`、Layer、Card、Margin、Gutter、`MarkdownControl.vue`、Lab 场景，并更新 dom 测试。验证：受影响的 dom 测试与 `typecheck`。
5. **e2e 与取证**：改 `markdown-comments.e2e.ts`（悬停、块菜单、替换继承含输入法组字、重叠波浪线、页边不变尺寸、动画窗口里的状态），跑 `markdown-comments`、`markdown-editing`、`editor-area` 的标题条用例。UI 取证见第 7 节。
6. **实现审查**（Sonnet，前端）与修正；合入 master。

## 6. 验收映射

| 行为 | 覆盖 |
| --- | --- |
| 悬停约 0.4 秒弹“看”卡片；点击、方向键走进批注不弹；移进卡片不收；输入、点击、Esc 收起；只读文档也能悬停 | `MarkdownCommentLayer.dom.test.ts`（`hoverDelay` 传小值）、e2e 一例用真实的 400ms |
| 卡片左缘对齐批注在这一行的起点、贴在这一行下面、放不下翻上面 | e2e 量几何（真实布局）；`AnchoredPopover.test.ts` 的 `align` |
| 选中整句批注文字后打字、粘贴，新字仍在批注里；删除不算；跨出批注末尾不继承；输入法组字替换 | `comments.dom.test.ts`（经 `handleTextInput`、粘贴）、e2e（含 `Input.imeSetComposition`） |
| 块菜单“批注”：段落、列表项、表格、图片、代码块、引用；写回读回；撤销一步 | `editing-actions.dom.test.ts`（块包装与读回）、`MarkdownControl.dom.test.ts`（菜单项）、e2e 一例 |
| 块批注无虚线左边框与缩进；重叠的波浪线错开 | e2e 读计算样式（`border-left-width`、`padding-left`、嵌套元素的 `text-underline-offset`）加取证截图 |
| 页边：无左边框；摘要、当前、写三态外框尺寸不变（意见不超过 3 行时）；按钮占位 | `MarkdownCommentMargin.dom.test.ts`、e2e 量 `offsetHeight` 前后相等 |
| 页边与浮层的动画：入场、`top` 过渡、当前态切换、开关页边稿纸平移 | e2e 开回动效（`emulateMedia({reducedMotion: "no-preference"})`）读过渡中的计算样式；取证时多帧采样 |
| 规范补写 | `docs:check`、`governance:check` |

## 7. 验证

合入前跑一次：`markdown-comments`、`markdown-editing`、`editor-area`（标题条相关用例）、`lab-scenes`（改了 Lab 场景）。先构建三份产物。UI 取证：nbook 与 macos 主题 × 亮、暗四组合，量页边卡片三态高度、对齐几何、重叠波浪线截图、开关页边的多帧采样；因为改了 `AnchoredPopover`（nb-ui 共享基础组件），按分档追加 390px 视口：版面不溢出。

明确留下的未验证：窗口真实失焦（无头做不到）、macOS 真机的 ⌘⌥M、触屏（悬停在触屏上不触发：触屏用页边与 Ctrl+Alt+M 之外的入口暂时没有，列为已知限制）、长意见（超过 3 行）展开瞬间完成的观感。

## 8. 不做与风险

- 不做：页边里悬停正文高亮对应的卡片；键盘专用的“只读看”入口（用页边或 Ctrl+Alt+M 进“写”看）；长意见展开收起的高度动画（高度变化瞬间完成，后面的卡片滑开）；`transformPasted` 之外的路径（拖放文字）的继承。
- 风险：
  - 输入法组字替换选区是否走 `handleTextInput`：e2e 用 CDP 的 `Input.imeSetComposition` 验证；走不到时在 `compositionend` 后补一个事务，不在组字过程中改文档。
  - 悬停计时与指针在卡片之间来回移动的竞态：两个计时共用一个定时器句柄，进入卡片取消关闭计时；用例覆盖“移向卡片途中经过空白”。
  - `top` 过渡与每个事务重排：打字时后面的卡片会有轻微的滞后，量打字的帧时间不比 t13 的记录差（t13 的 `perf-margin.txt`）。
  - 页边卡片底行预留后单张卡片更高（一行意见约 62px，原 34px）：密集处卡片更常被往下让；这是为了“状态间尺寸不变”付的代价，已告知开发者。
