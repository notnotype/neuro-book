# t13 实施计划：批注界面（第二稿，实施中按下面“实施中的改动”补正）

第二稿按[第一稿的设计审查](evidences/design-review-1-sonnet.txt)重写（Sonnet 子代理，15 条：阻断 1、重要 10、建议 4；处理见 [disposition](evidences/design-review-1-disposition.txt)）。第一稿的几处假设不成立：用序号当批注身份、却没有“正文被程序改了”的信号；“光标在批注里”写成了状态判断；页边卡片没有浮层的按下保护；`TitleActions.vue` 才是画按钮的地方；“左移页边宽”与阈值的算术对不上；`Textarea` 没有无框变体。

## 1. Context

- **为什么做**：批注的格式早已实现（[`workspace.markdown-dialect`](../../../../../docs/specs/workspace/markdown-dialect.md) 输出 11，编辑内核有 `addComment`、`setComment`、`unsetComment`），但编辑器里只有波浪线：意见要换到源码编辑器才看得到、改得了，也没有加批注的入口（t06 决定 13、t08 只留菜单位置）。
- **开发者已确认的决定**（README 决定 1–5，评审板两轮）：写作时只有波浪线、要看的那一条才展开；浮层与页边都要，页边由标签条上的“批注 N”开关打开（缺省关，按作品记住，放不下退回浮层）；写意见就在查看用的卡片里原地编辑，卡片外观不变，没有输入框的边框与灰底。开发者 2026-11-11 看过第一稿的 Spec 与计划，回“可以”；第二稿有两处与那次所见不同（开关改存本机记录、窗口失焦不丢意见），见[待确认清单](../../pending-confirmations.md)。
- **期望结果**：[`workbench.markdown-editing`](../../../../../docs/specs/workbench/markdown-editing.md) 输出 28–35 与验收 11–17；第 1 轮的静态稿（草稿 worktree `.worktree/w00025-t13-drafts`，不合并）只作样子的参照，代码重写。
- **工作方式**：代码在 worktree `.worktree/w00025-t13-comments-ui`（分支 `feat/w00025-t13-comments-ui`，从 master 拉）；Spec、本计划与 Task 记录在主工作区 master 上改；审查派 Sonnet 子代理（前端）。

## 2. 技术选型

| 问题 | 选用 | 否决 |
|---|---|---|
| 卡片外壳与定位 | nb-ui `AnchoredPopover`（浮层）；页边是稿纸右边的普通绝对定位列 | 页边也用浮层：几十张卡片各算一次定位，滚动时跟不上 |
| 卡片里的多行输入 | nb-ui `Textarea` 加 `variant="bare"`（无框无底无内边距、不可拖拽缩放）与自动长高（按 `scrollHeight` 回写高度，设上限）；改同名 `.md` 与 Lab 场景 | 自己写 contenteditable：输入法与撤销都要重做；`field-sizing: content`：目标浏览器不都有 |
| 当前批注的标出、加批注时原选区的显示 | ProseMirror 装饰（照 `held-selection.ts`），不进历史 | 改标记属性画高亮：会进撤销历史、写进文件 |
| 批注的身份 | 序号加指纹（意见与被批注的开头文字），在最新文档里核对，对不上不执行 | 给块批注加 `key` 属性：要改读回校验的排除项，复制块时 `key` 重复；靠“程序改了就收起”：控件没有可靠信号（重载与写回回填走同一条不进历史的事务） |
| 页边的宽度判断 | `MarkdownControl` 量 `.markdown-control-root`（已是 `container-type: inline-size`，宽度不含滚动条）加迟滞，算一份下传 | 量滚动容器：页边卡片撑高出滚动条，临界宽度来回闪；窗口宽度：拆分、开侧栏时窗口没变 |
| 页边开关的存放 | `nbook.editor` 的项目分区本机记录 `editor.comment-margin`（`{on}`，照 `editor.tabs` 的 `defineRecord`/`persist`） | 设置项写作品层：落在可进 Git 的 `.nbook/settings.json`，第二个人打开同一作品页边就开着，且项目层盖住用户层 |
| 标签条上的“批注 N” | 给标题动作条目加可选 `badge`，落点是共享的 `ui/menus/TitleActions.vue`；编辑器自己的动作按控件句柄的 `comments` 出现 | 贡献点 `editor.title`：标题是静态文字，画不出变化的条数，也读不到活动控件 |
| Ctrl+Alt+M | 监听挂在 `editor.view.dom` 上的 `keydown`（按 `event.code`，自己判 Mod、Shift、AltGraph、组字），键位判断抽成纯函数 | Tiptap 扩展的 `addKeyboardShortcuts`：编辑器实例在标签槽里跨控件重挂保留，扩展选项里的回调会指向已卸载的控件；监听在滚动容器上：页边卡片里的按键会冒泡进来 |

## 3. 关键设计

### 3.1 批注的数据操作：`packages/nb-markdown/src/editor/comments.ts`（新）与 `comments.dom.test.ts`

纯 Tiptap，从 `editor/index.ts` 导出：

```ts
interface CommentInfo {index: number; body: string; quote: string; block: boolean; start: number; end: number; segments: ReadonlyArray<{from: number; to: number}>}
interface CommentRef {index: number; body: string; quote: string}      // 指纹：意见与被批注的开头文字
listComments(doc): CommentInfo[]            // 输出 31 的先后；分截的各截是一条
commentsAt(state): CommentInfo[]            // 光标在文字上或紧挨两端；块批注按光标在块里算（输出 30）
findComment(doc, ref): CommentInfo | null   // 按 index 取，指纹对不上就在附近找相同指纹的唯一一条，找不到为 null
setCommentBody(editor, ref, body): boolean  // 一个事务，各截同一步；找不到、没变化返回 false
removeComment(editor, ref): boolean         // 只去目标那一条的标记（或解开块批注）；一个事务
gotoComment(editor, ref): boolean           // 光标到开头（块：第一个文字处）并滚进视野
markShownComment(editor, ref | null): void  // 输出 32 的装饰，经 transaction meta，不进历史
commentEntry(previous, next): ...           // 浮层“进入”的纯函数，见 3.3
```

- 排序键是（起点，终点，块批注在前，编号）：起点对块批注是块里第一个文字处；编号取标记 `key`（`k` 加 base36 计数）里的数，不用字符串比较（`k10` 在 `k2` 之前）；读入时同一段上重叠的批注，里层的编号靠前（读入按标记集合的顺序编号）。不依赖标记集合在改意见后的顺序。
- 改意见与去标记只动目标标记实例（`Mark.eq` 比较 id、body、key），按文本节点处理：先去掉该节点上目标及排在它后面的同类标记，再按原先后加回，所以盖住同一段的别的批注不会一起没、写回的嵌套顺序也不变。不用按类型的 `removeMark`/`unsetMark`（`excludes: ""` 让两条共存，按类型会一起删）。块批注用 `setNodeMarkup`、`replaceWith(pos, pos + size, node.content)`。
- 保存后紧接着打的字不并进这个撤销步：实测不需要 `closeHistory`（块批注与行内批注、贴着起点终点打字都是两步，审查 14.8 的担心没有出现），用例守着这条行为。
- `markShownComment` 的装饰按位置映射，随编辑移动；`MarkdownControl` 换文档、存状态前清掉（同 `releaseSelection`）。
- 不变量：改意见、去标记都不碰文字；分截批注的 `id` 保留（写回时的分配与残缺分截规则在编解码器，已有）；注音整体插件（输出 26）不受影响。

### 3.2 编辑动作、入口与文字：`nb-markdown/src/editor/editing-actions.ts`、`editor/shared/editing.ts`、`editor/web/editing-commands.ts`

- 动作目录（`EDITING_ACTIONS`，每项生成命令）只加 `comment`（`{text}`、需要选区、`format`、图标 `i-lucide-message-square-plus`、快捷键 `Mod+Alt+M`）。`comment-edit`、`comment-delete` 是控件内部动作：在 `markdownEditingActions` 里实现、不进目录、不生成命令；卡片经 `editing.run("comment-edit", {index, body, quote, text})` 调用，控件在最新文档里按指纹核对（`findComment`）。
- `comment` 的 `enabled`：选区里有非空白的文字，且起止所在的块允许批注标记（代码块、原样块不允许）；不用 `editor.can().addComment`（实测代码块里 `can()` 为真但文档不变）。`run` 按事务是否真的改了文档返回，没改返回 false，卡片不关成“已保存”。
- Ctrl+Alt+M：`MarkdownMenus` 监听 `editor.view.dom` 的 `keydown`，用纯函数 `isCommentShortcut(event, mac)`：按 `event.code === "KeyM"`，非 mac 要 `ctrlKey && altKey && !metaKey`，mac 要 `metaKey && altKey && !ctrlKey`，都不带 Shift，排除 `getModifierState("AltGraph")` 与组字（`isComposing`）；处理了才 `preventDefault`。有选区开“写”（新批注），光标在批注里且选区空开这条的“写”，其余不处理。
- 选区菜单加“批注”按钮（注音之后）；右键菜单 `MarkdownContextMenu.vue` 加“添加批注”（粘贴那一节之后）。不进工具栏与斜杠菜单。
- 命令声明、公开键 `hasComments`、`commentMargin`、文字（`commands.nbook.edit.comment.title`、`menus.*`、标题动作与命令 `toggle-comment-margin` 的标题）在 `editor` 插件的 `locales/zh-CN.json`、`en-US.json`，`locales.test.ts` 核对两种语言键相同。

### 3.3 卡片与浮层：`packages/neuro-book/src/plugins/markdown/web/components/menus/comments/`（新，每个组件有同名 `.md`）

- `MarkdownCommentCard.vue`：一张卡片，只管显示与发事件。属性：`body`、`index`、`total`、`mode`（`view`/`write`）、`readonly`、`compact`（页边摘要：最多两行）；事件：`edit`、`remove`、`prev`、`next`、`submit(text)`、`cancel`。
  - 写状态：nb-ui `Textarea` 的 `bare` 加自动长高，字体字号行距与“看”一致，意见区最高约 12 行再滚；预填原意见、光标在末尾；Ctrl+Enter/⌘Enter 保存，Esc 取消，组字时回车与 Esc 归输入法（`event.isComposing`）；去空白后为空等于取消。
  - 焦点：卡片根上对不在输入控件里的 `mousedown` 做 `preventDefault`（浮层里 `AnchoredPopover` 已做，页边没有，所以写在卡片里，两处一样）；`focusout` 时只有 `relatedTarget` 是卡片外的节点才发 `cancel`；`relatedTarget` 为空且文档没有焦点（窗口失焦）不算离开。每个出口（保存、取消、删除、点摘要跳转）之后 `editor.view.focus()`，“写”换成“看”时 DOM 被替换，不能让焦点掉到 body。
- `MarkdownCommentLayer.vue`：状态与定位，挂在 `MarkdownMenus.vue` 里。
  - **列表**：每次事务后同步用 `listComments`、`commentsAt` 重算（不缓存、不防抖），驱动浮层、页边与标签条的条数。
  - **当前批注**：Layer 自己的状态（指纹），由光标进入（取 `commentsAt` 里排在最前的）、上一条下一条、点摘要写入；卡片与页边展开读它，不从光标反推。`gotoComment` 在起点相同、光标没动时也更新它并重新标出。
  - **浮层何时出**：纯函数 `commentEntry(previous, next)`（`nb-markdown`，单测）。输入：上一次选区变化时光标处的批注集合与已被 Esc 收起的批注、这一次的集合、这次选区变化的事务有没有改文档、`view.composing`；输出：是否“进入”了一条新的批注、新的已收起集合。只看选区变化的事务（刷新引用链接、保持选区、写回回填的事务不算），点击时指针没松开就存下结论、松开时用。改了文档的事务把当前集合记为“已看过”并收起卡片。浮层还要求：选区为空、页边没画出来、注音或双语卡片没开（`prompting === null`）、右键菜单没开、不是只读时的编辑入口。
  - **锚点**：光标所在行（`posToDOMRect`），块批注用块的第一行；加批注时用选区终点所在行（同注音卡片的 `selectionAnchor` 取下沿）；`AnchoredPopover` `side="bottom"` 放不下翻面。
  - **动作**：加批注 `prompt("comment")` 时调 `holdSelection`，确认走 `menus.run("comment", {text})`；改已有批注 `markShownComment`，保存与删除走 `editing.run("comment-edit" | "comment-delete", {…指纹})`，返回 false 就收起卡片。`binding`、`readonly` 变（换文档、文件被删变只读）时收起并放弃，同 `MarkdownMenus` 对注音卡片的做法。
  - 重叠：`commentsAt` 返回几条就在一张浮层里排几张卡片，每张各有序号与按钮。
- Lab 场景（`MarkdownCommentCard`：看、写、只读、空意见、长意见、摘要）登记在 Lab 的 fixtures；浮层与页边用已有的 Markdown 控件场景加一份带批注的样本，在 e2e 里验。

### 3.4 页边与开关：`MarkdownCommentMargin.vue`、`MarkdownControl.vue`、`editor` 插件、`ui/menus/TitleActions.vue`

- **能不能画**：`MarkdownControl` 用 `ResizeObserver` 量 `.markdown-control-root` 的宽度，`marginDrawn = 开关开 && 宽度够`，出现在 ≥ 1032px、已画出的在 < 1000px 收起（迟滞）；常量 `MARGIN_WIDTH = 264`、`MARGIN_GAP = 16`，`D = 280`，阈值是 `720 + D + 32`，写在 `MarkdownControl.md` 与代码里同一处。`marginDrawn` 下传给版心、页边、浮层与场景图。
- **让位**：画出来时滚动内容区加 `padding-inline-end: D`，`margin-inline: auto` 的版心自然居中在剩下的宽度里（左移 D/2，宽 1032 时左边缘 ≥ 0）；页边列绝对定位在版心右边缘外（取版心的位置）；两侧场景图画出来时不画（`markdown-control-root` 加属性，场景图选择器排除）；工具栏仍在编辑组中轴上（输出 2 改为页边关着时与版心同轴）。块按钮随正文走。
- **页边内容**：画在滚动容器里（`Teleport` 到 `scroller`），随正文滚；每条批注一张卡片，`top` 取这条批注第一行的 `coordsAtPos` 相对滚动容器的位置（批注在折叠的提示块里时取提示块节点自己的 DOM 顶边），按文档顺序往下排开不重叠；当前一条 `mode="view"`，其余 `compact`；列表里再加一个可选的“待写的新批注”项（位置取选区起点所在行，按起点插入，取消时去掉、保存时成为列表里的一条）。点摘要或批注文字：当前批注换成它并 `gotoComment`。
- **重排时机**：页边画出来时每帧（`requestAnimationFrame`）按事务、滚动容器与根节点的尺寸变化、字体加载（`document.fonts` 的 `loadingdone`）重排；只在页边画出来时才量。
- **开关与标题动作**：
  - 记录 `editor.comment-margin`（`editor/web/comment-margin-record.ts`，项目分区本机记录，`defineRecord`/`persist`，照 `tabs-record.ts`）；命令 `nbook.editor.toggle-comment-margin`（在 `editing-commands.ts`）；公开键 `commentMargin` 读记录；`EditorMenus` 加 `commentMargin: Ref<boolean>`。
  - 控件句柄 `comments: {count: Ref<number>}`（`EditorControlHandle`，`editor/shared/contracts.ts`）。
  - `createEditorTitleActions`（`editor/web/title-actions.ts`）的 `area` 选项加 `activeHandle`；`own:comment-margin` 条目：`whenHidden`（活动句柄没有 `comments` 时不出现）、`pressed` 读 `commentMargin`、`badge` 读 `comments.count`，三者读同一份响应式依赖。
  - `ui/menus/title-actions.ts` 的 `TitleActionEntry` 加可选 `badge`，`TitleActions.vue`（同名 `.md`，视图标题也在用）画在图标之后、收进“⋯”时不画；`buttonBudget` 按每个按钮的实际宽度算（带数字的更宽），保住标签条的 96px。

### 3.5 性能

数据（`listComments`、`commentsAt`、条数）每个事务同步算：五万字、两百条批注的全文扫描实测约 0.1 毫秒（审查者在 happy-dom 里测的）。真正要量的是页边的布局（两百次 `coordsAtPos`、量卡片高度、写回位置），要在真实浏览器里测；预算是一帧（16 毫秒）里布局占一小半，S4 在 Lab 里造这份章节量一次，写进证据。

## 4. Spec 与文档改动

已在主工作区改好并提交：`workbench/markdown-editing.md`（目标与不承诺、命令表、公开键、输出 6、20、28–35、状态与时序、副作用与数据（页边开关记录）、失败、验收 11–17、实现合同、证据）；`workbench/editor.md`（不承诺一条、控件句柄的 `comments`、输出 34 的标题动作）。实施中补：`Textarea.md`、`TitleActions.md`、新组件的同名 `.md`、`MarkdownControl.md`（页边与阈值）；输出 2 的“工具栏与版心同轴”改成“页边关着时”（S4）。

## 5. 切片

| 片 | 内容 | 提交边界 | 自跑验证 |
|---|---|---|---|
| S1 | 3.1 数据操作、进入判断纯函数与装饰 | `nb-markdown` | `comments.dom.test.ts`（分截、块、重叠、列表与引用里的块批注、改意见与删除的先后、撤销、保存后立刻打字再撤销、指纹对不上）、`entry` 纯函数单测、`editing.test.ts` 的批注读回 |
| S2 | 3.2 动作、快捷键判断、入口、文字 | `nb-markdown` + `editor` + `markdown` | `editing-actions.dom.test.ts`（含 `comment` 在代码块里的可用性与返回值）、快捷键纯函数单测、`editing-commands.test.ts`、`locales.test.ts`、选区菜单与右键菜单的组件测试 |
| S3 | nb-ui `Textarea` 的 `bare` 与自动长高；3.3 卡片、浮层、Lab 场景 | `nb-ui` + `markdown` | `Textarea.dom.test.ts`、`MarkdownCommentCard.dom.test.ts`、`MarkdownControl.dom.test.ts`（进入、打字不弹、方向键、Esc、只读、换文档、外部重载后保存不改错） |
| S4 | 3.4 页边、记录、标题动作与徽标、性能测量 | `markdown` + `editor` + `ui` | `title-actions.test.ts`、`TitleActions` 与 `EditorGroupHead` 的组件测试（含带数字的预算与视图标题不变）、页边组件测试（排布、折叠块、待写卡片）、Lab 里的布局测量 |
| S5 | e2e 与 UI 取证 | `e2e` | `e2e/markdown-comments.e2e.ts`；Lab 里四种主题组合与窄宽的截图；手动与 CDP 验证 |

收口：Sonnet 子代理做一次实现审查（前端），处理后再合入。

## 6. 验收映射

| Spec | 覆盖 |
|---|---|
| 输出 28、验收 11 | `editing-actions.dom.test.ts`（可用条件）、快捷键纯函数单测、`MarkdownControl.dom.test.ts`（开卡片、改意见入口）、`markdown-comments.e2e.ts`（真实键盘、保存、关闭重开、撤销） |
| 输出 29、34、35、验收 12、14、16、17 | `comments.dom.test.ts`、`MarkdownCommentCard.dom.test.ts`（写状态的键盘与输入法、空意见取消、只读、按下不夺焦、窗口失焦不收起、长意见上限）、e2e |
| 输出 30、31、验收 13 | 进入判断的纯函数单测、`MarkdownControl.dom.test.ts`、`comments.dom.test.ts`（顺序、到头、紧挨的批注）、e2e（打字落在批注末尾不弹；真实输入法用 CDP `Input.imeSetComposition`） |
| 输出 32 | `comments.dom.test.ts`（装饰不进撤销历史、不写进文件） |
| 输出 33、验收 15 | `title-actions.test.ts`（出现条件、徽标、按下态、预算）、页边组件测试（排布、折叠块、待写卡片）、e2e（宽 999、1000、1031、1032，带不带滚动条，有场景图的主题；拆两栏；重开作品；先悬停标题行再断言按钮） |
| 输出 6、20 | 选区菜单与右键菜单的组件测试 |

变异检查：去掉“进入”判断里“只看选区变化的事务”、把按指纹核对改成只看序号、把 `removeMark` 改成按类型、去掉窄退回与迟滞、去掉窗口失焦的判断、去掉空意见判断，对应测试要失败。

## 7. 验证

- 合入前：`comments.dom.test.ts`、进入判断与快捷键的单测、`editing-actions.dom.test.ts`、`editing-commands.test.ts`、`MarkdownControl.dom.test.ts`、`MarkdownCommentCard.dom.test.ts`、`Textarea.dom.test.ts`、`title-actions.test.ts`、`TitleActions`/`EditorGroupHead` 的组件测试、`locales.test.ts`，类型检查，`governance:check`；e2e 三个文件：`markdown-comments`（新）、`markdown-editing`（选区菜单与右键）、`editor-area`（标题动作）。
- 自己在真实 Chrome 里补验：页边阈值（宽度、滚动条、场景图）、窗口失焦、真实输入法（CDP）、折叠提示块里的批注定位。
- UI 取证：nbook、macos × 亮、暗，各截浮层、页边（开、窄退回）、写状态；对照第 2 轮静态稿。
- 未验证：触屏；macOS 的 ⌘⌥M 真实键盘（只测键位判断的纯函数）；几百字的意见只看了排版与滚动上限。

## 8. 不做与风险

- 不做：全部批注的侧栏列表；键盘走到卡片上的删除（键盘只管添加与改意见，开发者 11-11 确认）；批注的作者、时间、回复。
- 风险：页边的位置要等排版稳定（字体、图片），观察尺寸与字体加载；`coordsAtPos` 在折行处取起点那一行，批注跨行时卡片对着第一行；注音的行内块（t21）改过行盒，对齐按文字的 `coordsAtPos`，不按段落盒；Ctrl+Alt+M 在 Linux 上可能被输入法或桌面占用，右键与选区菜单是并行入口；批注在列表里的块批注改了意见后，写回会让列表多一个空行（已知行为，Spec 输出 35）；两个窗口开着同一作品时开关是后写者赢，不损坏数据。

## 9. 实施中的改动（2026-11-11，已做完的切片与计划不同的地方）

- 标签条上的“批注 N”按钮画成图标加数字（提示“显示或隐藏批注页边”），没有“批注”二字：条目的 `badge` 至多三个字符（99+），按钮预算由 `titleModelFor` 扣掉多出的 26px（`ui/menus/title-actions.ts`），徽标画在共享的 `TitleActions.vue`（视图标题不受影响）。
- 只读的正文（`contenteditable=false`）拿不到焦点，批注层用 `document` 的 `selectionchange` 判断浏览器选区还在不在正文里，卡片才留得住（实机 e2e 发现）。
- 保存之后不需要 `closeHistory`：实测相邻的打字本来就不并进批注的撤销步。
- Ctrl+Alt+M 的键位匹配放在 `editor/web/key-event.ts`，经 `EditorMenus.matches` 交给控件：`MarkdownControl` 不认识命令服务，键位仍只写在动作目录里一处；`EditorMenus.label` 加了 `{{name}}` 参数（“第 i 条，共 n 条”）。
- 页边画不画由 `MarkdownControl` 量控件根的宽度：阈值 1032px（版心 + 页边 264 + 空 16 + 两侧各 16），已画出的窄于 1000px 才收起；页边卡片、让位与场景图的处理照 3.4。
- Lab 加两个场景（`EditorGroup/comments`、`comments-margin`），用于 UI 取证。
- 实现审查（Sonnet，14 条，[报告](evidences/impl-review-1-sonnet.txt)、[处理](evidences/impl-review-1-disposition.txt)）后补的：写着的字存在批注层里（`draftText`），换位置不丢；批注层在换文档时让列表重算并按新文档重记“进入”；页边按序号加指纹（`matchComment`）判断展开与写；删块批注后光标平移；新批注保存走控件句柄、加不上留在“写”；只读的 Esc；页边没有 `top` 过渡、排完之前藏着；`Textarea` 的行高 `normal`、边框与观察器；页边开关记录与页边排布补了测试。
