# t13 实施计划：批注界面（第一稿）

## 1. Context

- **为什么做**：批注的格式早已实现（[`workspace.markdown-dialect`](../../../../../docs/specs/workspace/markdown-dialect.md) 输出 11，编辑内核有 `addComment`、`setComment`、`unsetComment`），但编辑器里只有波浪线：意见要换到源码编辑器才看得到、改得了，也没有加批注的入口（t06 决定 13、t08 只留菜单位置）。
- **开发者已确认的决定**（README 决定 1–5，评审板两轮）：写作时只有波浪线、要看的那一条才展开；浮层与页边都要，页边由标签条上的“批注 N”开关打开（缺省关，按作品记住，放不下退回浮层）；写意见就在查看用的卡片里原地编辑，卡片外观不变，没有输入框的边框与灰底。评审板第 1 轮没单独问、照推荐做的六条在[待确认清单](../../pending-confirmations.md)。
- **期望结果**：[`workbench.markdown-editing`](../../../../../docs/specs/workbench/markdown-editing.md) 输出 28–35 与验收 11–16；第 1 轮的静态稿（Lab 草稿 worktree `.worktree/w00025-t13-drafts`，不合并）只作样子的参照，代码重写（依赖草稿自己的数据与引擎，按重写估）。
- **工作方式**：代码在新 worktree（`feat/w00025-t13-comments-ui`，从 master 拉）；Spec、本计划与 Task 记录在主工作区 master 上改；审查派 Sonnet 子代理（前端）；开发者在场，计划先给开发者看，确认后再审查与实施。

## 2. 技术选型

| 问题 | 选用 | 否决 |
|---|---|---|
| 卡片外壳与定位 | nb-ui `AnchoredPopover`（浮层）；页边是稿纸右边的普通绝对定位列，不用浮层库 | 页边也用浮层：几十张卡片各算一次定位，滚动时跟不上 |
| 卡片里的字 | 多行输入沿用注音卡片的做法（nb-ui 输入控件的 `variant="bare"`）；核对 nb-ui 有没有多行的 `Textarea` 且支持 bare，没有就照 `Input` 加，改同名 `.md` 与 Lab 场景 | 自己写 contenteditable：输入法与撤销都要重做 |
| 当前批注的标出、加批注时原选区的显示 | ProseMirror 装饰（照 `held-selection.ts`），不进历史 | 改标记属性画高亮：会进撤销历史、写进文件 |
| 页边的宽度判断 | 控件自己的容器宽度（`ResizeObserver` 量滚动容器），拆分后每组各自判断 | 窗口宽度或媒体查询：拆成两栏、开侧栏时窗口没变，控件变窄 |
| 开关的存放 | 设置 `nbook.editor/markdownCommentMargin`（同 `markdownToolbar`），写作品层 | 另建本地记录：多一套存储，设置窗口、命令面板、公开键都要另接 |
| 标签条上的“批注 N” | 给标题动作条目加一个可选的 `badge`（数字），编辑器自己的动作按控件句柄的 `comments` 出现 | 贡献点 `editor.title` 由 `nbook.markdown` 贡献：标题是静态文字、画不出会变的条数，也读不到活动控件 |

## 3. 关键设计

### 3.1 批注的数据操作：`packages/nb-markdown/src/editor/comments.ts`（新）与 `comments.dom.test.ts`

纯 Tiptap，从 `editor/index.ts` 导出：

```ts
interface CommentInfo { index: number; body: string; block: boolean; segments: ReadonlyArray<{from: number; to: number}> }
listComments(doc): CommentInfo[]                 // 输出 31 的先后；分截的各截是一条
commentsAt(state): CommentInfo[]                 // 光标在文字上或紧挨两端；块批注按光标在块里算（输出 30）
setCommentBody(editor, index, body): boolean     // 一个事务，各截同一步；保留 id、key
removeComment(editor, index): boolean            // 去掉所有截的标记，或解开块批注；一个事务
gotoComment(editor, index): boolean              // 光标到开头（块：第一个文字处）并滚进视野
markShownComment(editor, index | null): void    // 输出 32 的装饰，经 transaction meta，不进历史
```

- 一条批注的各截按 `key` 合起来；块批注（`commentBlock` 节点）没有 `key`，所以对外用序号找，序号只在同一份文档状态里有效（Spec 命令表）。不给块批注加 `key` 属性：它要写进读回校验的排除项，改动面大于收益。
- `markShownComment` 的装饰按位置映射，随编辑移动；`MarkdownControl` 换文档、存状态前清掉（同 `releaseSelection`）。
- 要守住的不变量：改意见、去标记都经 `tr.addMark/removeMark/setNodeMarkup`，不碰文字；分截的批注的 `id` 保留（写回时的分配与残缺分截规则在编解码器，已有）；注音整体插件（输出 26）不受影响。

### 3.2 编辑动作、命令与入口：`nb-markdown/src/editor/editing-actions.ts`、`editor/shared/editing.ts`、`editor/web/editing-commands.ts`

- 动作表加 `comment`（`{text}`、需要选区、`format`、图标 `i-lucide-message-square-plus`、快捷键 `Mod+Alt+M`）、`comment-edit`（`{index, text}`、`move`）、`comment-remove`（`{index}`、`move`）；`editing-commands.ts` 的参数表加两种形状。
- `comment` 的 `enabled`：选区里有非空白的文字，且光标所在块的 schema 允许批注标记（代码块、原样块不允许）。不用 `editor.can().addComment`：`addComment` 内部判断与 `can()` 的试跑路径不同，写测试核对两者一致。
- Ctrl+Alt+M 不是 Tiptap 快捷键（它要开卡片，不是直接执行动作）：`MarkdownMenus` 在滚动容器上监听 `keydown`，按 `event.code === "KeyM"` 判断（macOS 上 Option 会改变 `key`），有选区开“写”（新批注），光标在批注里且选区空开这条的“写”（改意见）。
- 选区菜单加“批注”按钮（注音之后，`emit("prompt", "comment")`）；右键菜单 `MarkdownContextMenu.vue` 加“添加批注”（粘贴那一节之后）。不进工具栏与斜杠菜单。
- 命令声明、`when`、公开键 `hasComments`、`commentMargin`、文字（`commands.nbook.edit.comment*.title`、`menus.*`）在 `editor` 插件的 `locales/zh-CN.json`、`en-US.json`，`locales.test.ts` 核对两种语言键相同。

### 3.3 卡片与浮层：`packages/neuro-book/src/plugins/markdown/web/components/menus/comments/`（新，每个组件有同名 `.md`）

- `MarkdownCommentCard.vue`：一张卡片，只管显示与发事件。属性：`body`、`index`、`total`、`mode`（`view`/`write`）、`readonly`、`compact`（页边的摘要：最多两行）；事件：`edit`、`remove`、`prev`、`next`、`submit(text)`、`cancel`。写状态：多行输入没有自己的框与灰底，预填原意见、光标在末尾；Ctrl+Enter/⌘Enter 保存，Esc 取消，组字时回车与 Esc 归输入法（`event.isComposing`）；去空白后为空等于取消；焦点离开卡片发 `cancel`（照 `MarkdownTextPrompt.vue`）。
- `MarkdownCommentLayer.vue`：状态机与定位，挂在 `MarkdownMenus.vue` 里。
  - 数据：每次事务后用 `commentsAt`、`listComments` 重算（防抖，见 3.5 的预算），驱动浮层与页边。
  - 浮层何时出：选区变化的事务**没有改文档**、选区为空、光标在批注里、没有按过 Esc、页边没有画出来、指针已松开时出；事务改了文档（输入）就收起（输出 30“打字移进来的不弹”按事务判断，不按键或时间）。鼠标点批注文字走同一条（点只是移动光标）。
  - 锚点：光标所在行（`posToDOMRect`），块批注用块的第一行；`AnchoredPopover` `side="bottom"`，放不下翻面（沿用选区菜单的锚点 `selection-anchor.ts` 写法，加一个按光标的版本）。
  - 加批注：`prompt("comment")` 时调 `holdSelection`（同注音）；改已有批注：`markShownComment`。确认走 `menus.run("comment", {text})`、`menus.run("comment-edit", {index, text})`，删除 `menus.run("comment-remove", {index})`。卡片开着时正文被程序改了（重载）就收起。
  - 重叠：`commentsAt` 返回几条就在一张浮层里上下排几张卡片。
- Lab 场景（`MarkdownCommentCard`：看、写、只读、空意见、长意见、摘要）登记在 Lab 的 fixtures；浮层与页边用已有的 Markdown 控件场景加一份带批注的样本，在 e2e 里验。

### 3.4 页边与开关：`MarkdownCommentMargin.vue`、`MarkdownControl.vue`、`editor` 插件

- 页边画在滚动容器里（`Teleport` 到 `scroller`），绝对定位在稿纸右边，随正文一起滚；每条批注一张卡片，`top` 取这条批注第一行的 `coordsAtPos` 相对滚动容器的位置，按文档顺序往下排开不重叠；当前一条 `mode="view"` 展开，其余 `compact`。点摘要或批注文字：`gotoComment`。
- 稿纸让位：页边画出来时给 `.markdown-control` 一个属性，用 `margin-inline` 把版心整体左移页边宽（缺省约 270px 加间隙）；宽度够不够由 `ResizeObserver` 量滚动容器，阈值是版心 + 页边 + 两侧最小留白，取一个常量（约 1000px），写在 `MarkdownControl.md`。
- 重排时机：事务后、容器尺寸变化、字体与图片加载后（观察 `root` 的高度）；用 `requestAnimationFrame` 合并，不在每次按键同步量全部卡片。
- 控件句柄加 `comments: {count: Ref<number>}`（`EditorControlHandle`，`editor/shared/contracts.ts`）；`EditorMenus` 加 `commentMargin: Ref<boolean>`（读设置）。
- `editor` 插件：设置 `markdownCommentMargin`（`shared/settings.ts`，在“编辑器”分区）；命令 `nbook.editor.toggle-comment-margin`（在 `editing-commands.ts`，仿 `toggleToolbar`；写作品层，没有作品时写用户层，**实施前先核对 `settings.update` 能不能指定层**，不能就在设置服务上补一个入口，同 Spec 的副作用一节）；标题动作 `own:comment-margin`（`title-actions.ts`，`whenHidden`：活动控件没有 `comments` 时不出现；`pressed` 读设置；`badge` 读 `comments.count`）；`ui/menus/title-actions.ts` 的 `TitleActionEntry` 加可选 `badge`，`EditorGroupHead.vue` 画在图标之后，收进“⋯”时不画。

### 3.5 性能

`listComments` 遍历整份文档，每次事务都跑会拖慢长章节。条数（标签条上的数字）、页边与浮层都读同一份结果，在一个防抖（150 毫秒，同提交延迟）里重算，光标移动只重新选当前那一条。S4 起用一份五万字、两百条批注的章节量一次（预算：每次重算 5 毫秒内），结果写进证据。

## 4. Spec 与文档改动

已在主工作区改好（待开发者确认后提交）：`workbench/markdown-editing.md`（目标与不承诺、命令表、公开键与设置、输出 6、20、28–35、状态与时序、失败、验收 11–16、实现合同、证据）；`workbench/editor.md`（不承诺一条、控件句柄的 `comments`、输出 34 的标题动作）。实施中补：两份同名 `.md`、`docs/testing/README.md` 无需改。

## 5. 切片

| 片 | 内容 | 提交边界 | 自跑验证 |
|---|---|---|---|
| S1 | 3.1 数据操作与装饰 | `nb-markdown` | `comments.dom.test.ts` 加 `editing.test.ts` 的批注读回（重叠、分截、块、撤销） |
| S2 | 3.2 动作、命令、入口、文字 | `nb-markdown` + `editor` + `markdown` | `editing-actions.dom.test.ts`、`editing-commands.test.ts`、`locales.test.ts`、`MarkdownToolbar`、右键菜单与选区菜单的组件测试 |
| S3 | 3.3 卡片、浮层、Lab 场景 | `markdown` | `MarkdownCommentCard.dom.test.ts`、`MarkdownControl.dom.test.ts`（光标进批注、打字不弹、Esc、只读、换文档）、Lab 场景 e2e |
| S4 | 3.4、3.5 页边、开关、标题动作 | `markdown` + `editor` + `ui` | `title-actions.test.ts`、`EditorGroupHead.dom.test.ts`、页边的组件测试（排布、窄退回）、性能测量 |
| S5 | e2e 与 UI 取证 | `e2e` | `e2e/markdown-comments.e2e.ts`；Lab 里四种主题组合与窄宽的截图 |

收口：Sonnet 子代理做一次实现审查（前端），处理后再合入。

## 6. 验收映射

| Spec | 覆盖 |
|---|---|
| 输出 28、验收 11 | `editing-actions.dom.test.ts`（可用条件）、`MarkdownControl.dom.test.ts`（Ctrl+Alt+M 开卡片、改意见入口）、`markdown-comments.e2e.ts`（真实键盘、保存、关闭重开、撤销） |
| 输出 29、34、35、验收 12、14、16 | `comments.dom.test.ts`（分截、块、保留 id）、`MarkdownCommentCard.dom.test.ts`（写状态的键盘与输入法、空意见取消、只读）、e2e |
| 输出 30、31、验收 13 | `MarkdownControl.dom.test.ts`、`comments.dom.test.ts`（顺序、到头）、e2e（打字落在批注末尾不弹） |
| 输出 32 | `comments.dom.test.ts`（装饰不进历史、不写文件） |
| 输出 33、验收 15 | `title-actions.test.ts`（出现条件、徽标、按下态）、页边的组件测试（排布、窄退回）、e2e（拆两栏、重开作品） |
| 输出 6、20 | 选区菜单与右键菜单的组件测试 |

做变异检查：把“按事务判断打字”改成总弹、把“窄退回”去掉、把去空白判断去掉，对应测试要失败。

## 7. 验证

- 合入前：`comments.dom.test.ts`、`editing-actions.dom.test.ts`、`editing-commands.test.ts`、`MarkdownControl.dom.test.ts`、`MarkdownCommentCard.dom.test.ts`、`title-actions.test.ts`、`EditorGroupHead.dom.test.ts`、`locales.test.ts`，类型检查，`governance:check`；e2e 三个文件：`markdown-comments`（新）、`markdown-editing`（选区菜单与右键）、`editor-area`（标题动作）。
- UI 取证：nbook、macos × 亮、暗，各截浮层、页边（开、窄退回）、写状态；对照第 2 轮静态稿。
- 未验证：触屏（选区菜单本来也只按鼠标与键盘验）；很长的批注（几百字）只看了排版，不测滚动。

## 8. 不做与风险

- 不做：全部批注的侧栏列表；键盘走到卡片上的删除；批注的作者、时间、回复。
- 风险：页边的位置要等排版稳定（字体、图片）；`coordsAtPos` 在折行处取起点那一行，批注跨行时卡片对着第一行；注音的行内块（t21）改过行盒，页边卡片对齐时按文字的 `coordsAtPos`，不按段落盒；Ctrl+Alt+M 在部分键盘布局（Alt 键产生字符）下靠 `event.code`，Linux 上被输入法占用时不触发，右键与选区菜单是并行入口。
