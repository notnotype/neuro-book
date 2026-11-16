---
schema: nbook.task/v2
taskId: t17-e2e-open-file-wait
status: done
updated: 2026-11-16
---

# e2e 打开文件的等待

## 目标与范围

`e2e/markdown-input.e2e.ts`、`e2e/editor-area.e2e.ts` 的打开文件步骤凭一次 `aria-expanded` 决定点不点文件夹，恢复会话时可能把刚展开的收起来，文件没打开；`editor-area` 的“重新打开回到上次的光标”还有按键早于聚焦的问题。都只在负载下偶发。照 `markdown-editing.e2e.ts` 的写法改掉（[`docs/testing/README.md`](../../../../../docs/testing/README.md#测试写法)）。下面粗体、斜体、删除线一处查下来是产品问题，[`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md) 输出 62 补了一条；其余几处行为合同未变。

另一处（t20 记，2026-11-10）：`markdown-input.e2e.ts` 的“按快捷键打出的粗体、斜体、删除线”打完字紧接着按快捷键，负载 5–16 下失败过 3 次，写回成 `看**粗***斜删*`（关斜体、开删除线两次按键没生效）；单独跑或低负载下都过。先查是按键早于编辑器处理完输入（`keyboard.type` 打中文走 `insertText`），还是产品里存下的格式被冲掉，再决定改测试还是改产品。

又一处（t20 记，2026-11-11）：`markdown-editing.e2e.ts` 的“块菜单：下移、副本、删除”在负载 6 时失败一次，点了“删除”之后文件里那一块还在（写回 `二\n\n二\n一\n` 之类）；单独重跑 3 次都过。

再一处（t21 记，2026-11-11）：`editor-area.e2e.ts` 的“有未保存的修改时离开页面先请求确认；保存之后不再请求”在三个文件连跑 12 分钟后失败一次（期望 `第二章x\n`，写回 `第二章改x\n`，打字与保存的时序）；单独重跑 3 次都过。

再两处（t22 记，2026-11-12）：一、`editor-area.e2e.ts` 的“有未保存的修改时离开页面先请求确认”在五个文件连跑 10 分钟的收口里又失败一次（同上，写回 `第二章改x\n`），之后单独重跑通过。二、同一轮里 `editor-area.e2e.ts` 的“每个标签一个控件……恢复会话只建活动标签的控件”在 `page.reload()` 之后标签只有 2 个（期望 3 个）失败，随后的一次部分重跑又失败一次，再单独连跑 3 次都过：三个文件刚点开就刷新，会话里的第三个标签可能还没存下来，要等标签条上有 3 个标签且存储落盘再刷新。另：`markdown-comments.e2e.ts` 里“选区之后立刻按快捷键或粘贴”漏选最后一个字（ProseMirror 经 `selectionchange` 异步同步选区）已在 t22 的 e2e 里加了等选区同步的辅助（`syncedSelection`），别的 e2e 里同样写法的地方可以照做。

## 当前状态

2026-11-16 开发者确认开工（“那就直接开工 t17”），当日完成并合入 master。分支 `fix/w00025-t17-e2e-open-file-wait` 变基到 `3f3115114` 后快进合入，三个提交：`d8aa154e8`（产品修正）、`b2db86a59`（e2e）、`2dd7d3ab9`（实现审查的处理）；worktree 与分支已删。

### 逐处的根因与处理

| 偶发失败 | 根因 | 处理 |
| --- | --- | --- |
| `markdown-input` 的粗体、斜体、删除线 | **产品问题**。停手 150ms 把正文交给文档、被接受后，控件把写法回填进编辑器（`written.accept`，只改属性）；这是一笔改文档的事务，ProseMirror 随之清掉接着打字要用的格式（stored marks）。快捷键按在“打完字”与“这次交出”之间时，切换就丢了，下一个字沿用前一个字的格式。负载只是把交出推迟到了快捷键之后；人打完字 150ms 内按快捷键、停一下再打字，同样会碰到 | `MarkdownControl.vue` 的 `commitNow` 回填时把 stored marks 原样带过去；`MarkdownControl.dom.test.ts`“在格式的边界打字”一组补一例（经按键处理与输入入口，交出落在快捷键与下一个字之间），修复前写回 `看**粗斜**`、修复后通过；Spec `workbench/editor.md` 输出 62 补一条，组件 `.md` 补一句 |
| `editor-area` 的离开页面先请求确认（写回 `第二章改x`） | 不是打字与保存的时序：这一例用共用的 `notes/b.md`，前面“编辑器标签和工具面板……”一例在 `b.md` 里打过“改”，缺省的失焦时自动保存在负载下把它写进了磁盘（整份文件里只有那一例往 `b.md` 打“改”） | 改用自己的文件 `notes/leave.md`（用完删掉），并按文件开头的约定关掉自动保存（验离开确认的用例都关） |
| `editor-area` 恢复会话只建活动标签的控件（刷新后只有 2 个标签） | 刷新时会话还没落盘：标签在 `editor.tabs`，在哪块面板、谁活动在 `workbench.layout`，两条分开写 | 刷新前等两条记录都含这三个标签（新辅助 `tabsSaved`，“标签的记录丢了”一例原来手写的同样等法也换成它） |
| `editor-area`、`markdown-input` 凭一次 `aria-expanded` 决定点不点 | 打开作品时资源管理器也在展开目录（恢复展开状态、揭示恢复出的活动文件，`explorer/web/plugin.ts` 的 `revealOnOpen`），读到“收起”再点可能正好收起来 | `editor-area` 新辅助 `expand`（点完核对，不对就重来），七处都换成它；`markdown-input` 的 `openFile` 照 `markdown-editing` 改成等到活动标签真是这个文件 |
| `editor-area` 重新打开回到上次的光标：按键早于聚焦 | 点正文、点 Monaco 之后立刻按键 | `atEnd` 里先等正文聚焦（调用方传的都是 Markdown 正文）；Monaco 与 `cursor.md` 两处点完先等聚焦 |
| `markdown-editing` 的块菜单“下移、副本、删除” | **没有复现**：8 倍降速 8 轮、20 倍降速 10 轮全过（证据 [`probe.txt`](evidences/probe.txt)）；原记录的写回结果是“之类”，从代码里没有找到能对上的竞态。实现审查给的候选：悬停辅助只等块按钮出现，不等它挪到目标块旁边，按钮还在上一块时点下去，菜单作用在上一块 | 测试侧：悬停辅助等块按钮与目标块对齐（纵向相差不到 16px，与同组“光标所在的块常显按钮”一例的等法一致）再点。它是不是原来那次失败的根因仍未验证；再出现时先留下 trace 与写回原文 |
| 收口时新出现的：`markdown-editing`“拆分后”一例打开 `notes/split.md` 找不到行（60 秒超时） | 资源树是虚拟列表，资源管理器只占侧栏一半高；这份文件每例都往 `notes/` 写自己的文件，跑到这一例时 `split.md` 前面排着 37 个文件，它的行不在渲染范围里。`markdown-comments` 也在门槛边上（36 个文件、视口更矮） | 两份文件都在 `afterEach` 里删掉这一例写的文件（经 `openFile` 写的与直接写的），树不再越积越长 |

别的 e2e 里“键盘选字后立刻操作”的写法逐处看过：后面跟的都是会重试的断言（选区菜单出现、可访问名称），或读浏览器同步更新的页面选区，`editor-area` 的那处已经在等选区同步，没有改。别的 e2e 文件里也有“读一次 `aria-expanded` 再决定点不点”的写法，它们没有出过偶发失败，不在本 Task 范围，没有改。

### 实现审查

一个 Claude Sonnet（报告 [`impl-review-sonnet.txt`](evidences/impl-review-sonnet.txt)，审的是变基前的 `f17e22300..14f6fda75`），阻断 0、重要 0、建议 12，逐条处理见 [`impl-review-disposition.txt`](evidences/impl-review-disposition.txt)：

- 改了 9 条：注释说清带过去的是回填前的格式；DOM 用例与 e2e 里遮蔽外层名字的变量改名；直接写的两个文件、`leave.md` 也删；Monaco 聚焦的等法限定到这一个编辑器；`tabsSaved` 空列表不算存下、读标签前先等到 3 个；`expand` 的读取与点击给超时；块菜单的悬停等对齐（上表）。
- 接受取舍 1 条：别处改了正文、控件按新正文重载时，替换照样清掉刚切换的格式。要两个组同时编辑同一份文档，且正好落在切换与下一个字之间；写进组件文档 `MarkdownControl.md` 作已知限制，不加机制。
- 不成立 2 条：删文件后下一例恢复出已删除的标签（每例新开浏览器上下文，不恢复上一例的会话）；worktree 里留着探针文件（审查期间临时放回、跑完已删，从未提交）。
- 范围备注 1 条：见上一段末尾。

### 验证（都在分支上，负载 7–13）

- 单元：`bun run test:affected --files`（neuro-book 受影响的 Bun 与 Vitest 文件）全部通过；`MarkdownControl.dom.test.ts` 55 例通过。
- 类型：`tsc --noEmit`、`vue-tsc -p tsconfig.web.json`、`vue-tsc -p tsconfig.browser-test.json`（最后一次改 e2e 之后重跑）都通过。
- e2e：先跑 `markdown-input`、`markdown-editing`、`markdown-comments`、`editor-area`、`editor-autosave` 五份，145 例里 144 过，失败的是上表最后一行；改了 `markdown-editing`、`markdown-comments` 之后重跑这两份，80 例全过。处理实现审查之后重跑改到的 `editor-area`、`markdown-editing`、`markdown-comments` 三份，132 例全过。
- 变基之后：master 在开分支以来新增的代码改动在 `plugin-platform/` 与 `shared/product.ts`，与本分支改的文件不重叠，之后的几个提交只改文档。在 `d8de0393f` 上重跑 `bun run test:affected --since master --files --typecheck`：类型检查（`tsc`、两份 `vue-tsc`）通过，Bun 185 例、Vitest 6 个文件 77 例全过。e2e 没有因变基重跑。

- 降速复现（[`probe.txt`](evidences/probe.txt)）：粗体、斜体、删除线的按键序列在 8 倍 CPU 降速下，修复前 8 轮失败 2 轮，事务记录里每次交出后都跟着一笔回填，清掉了刚设的格式；修复后的构建同样降速 10 轮全过。

### 未验证

- 块菜单那一例的根因未找到（见上表）。

## 下一步

无。块菜单那一例再出现时，留下 trace 与写回原文另查。
