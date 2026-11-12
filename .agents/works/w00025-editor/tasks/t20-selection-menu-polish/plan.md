# t20 实施计划，第一段：不用开发者定的修复

## Context

开发者 2026-11-10 试用 t04、t05 后提了问题（见 [README](README.md) 的“目标与范围”“调查结果”）。要看外观的三项（颜色按钮、选区菜单加哪些项、注音怎么写与改）在[评审板](artifacts/review/index.html)上等决定，定了以后另写第二段计划。本段是会话里已经说明、开发者没有异议的四项：

1. 注音当成一个整体：格式只盖住一段注音的一部分时，整段注音一起改，不再拆成两段、各显示一份完整的注音。
2. 拖选经过注音时，注音小字不画成选中。
3. 选区菜单、注音输入、斜杠菜单补上入场与退场动效（设计语言“浮层入退场的编排是固定的”）。
4. 源码编辑器的底色改成稿纸底 `--bg-panel`（开发者同意统一，改判待确认清单 t05 第 5 行）。

依据：[`workbench/markdown-editing.md`](../../../../../docs/specs/workbench/markdown-editing.md)、[`workspace/markdown-dialect.md`](../../../../../docs/specs/workspace/markdown-dialect.md) 输出 12（注音的写法）、[`theme/system.md`](../../../../../docs/specs/theme/system.md)、nb-ui [`design-language.md`](../../../../../packages/nb-ui/docs/design-language.md) 的动效一节。

工作方式：一个 worktree `.worktree/w00025-t20-selection-menu-polish`（分支 `feat/w00025-t20-selection-menu-polish`），第二段接着用。开发者在场，不按 autonomous-delivery。

## 技术选型

无。用 ProseMirror 自带的 `appendTransaction`、`AddMarkStep`、`RemoveMarkStep`，与 nb-ui 已有的 `.nb-ui-popover-motion`。

## 关键设计

### `packages/nb-markdown/src/language/syntax/ruby/`

- `MarkdownRuby` 加 `addProseMirrorPlugins()`，返回一个插件（新文件 `whole-ruby.ts`，导出 `wholeRubyPlugin(type: MarkType): Plugin`）。
- 规则：`appendTransaction` 里逐个看本批事务的每一步。是加标记或去标记的步（`AddMarkStep`、`RemoveMarkStep`，含注音自己）时，在这一步之前的文档上看它的两端：一端落在一段注音中间（两侧是同一个注音，`mark.eq`），就把这一端扩到这段注音的边上。扩出来的范围经这一步及之后各步、之后各事务的映射换到最终文档，再对它做同样的事：加标记就 `addMark` 同一个标记，去标记就按类型 `removeMark`。
- 只看两端就够：整个落在范围里的注音已经被盖全。在步之前的文档上找注音：设新注音（`setMarkdownRuby` 盖住旧注音的一半）时，要替换的是用户选中的那段旧注音，步之后它已经变了。
- 收敛：补上的步两端都在注音的边上，下一轮什么都不做。撤销：追加的事务与原事务在同一个撤销步里（ProseMirror 的 history 对 `appendedTransaction` 的处理）。
- 覆盖的入口：选区菜单与工具栏的动作、StarterKit 自带的 Ctrl+B 等快捷键与 `**…**` 输入规则、清除格式、批注、链接、行内代码（它排斥注音，盖住一半时整段注音变成代码）。不覆盖：在注音中间带着存下的格式打字、往注音中间粘贴带格式的文字（替换步，不是标记步）；这两种照旧拆开，记为已知限制。
- 注音小字不可选：`display/markdown.css` 的 `.nb-markdown .nb-ruby-text` 加 `user-select: none`。编辑器与只读显示共用这条：复制只读正文时也不带注音，与编辑器复制的结果一致。

### `packages/nb-ui/src/components/popup/`

- `AnchoredPopover.vue`、`SuggestionMenu.vue` 的 `PopoverContent` 挂 `.nb-ui-popover-motion`（`src/styles.css` 已有：入场 `--motion-fast` 加 `--ease-layout`，退场 `--ease-dialog-leave`，原点读 reka 的 `--reka-popover-content-transform-origin`）。退场靠 reka 的 Presence 等 `animationend` 才卸载。
- 同名 `.md` 补“动效”一句。`AnchoredPopover.test.ts`、`SuggestionMenu.test.ts` 在 happy-dom 里没有动画，卸载时机不变。
- 选区菜单开着时选区变化不重新入场：`open` 一直为真，只是锚点在动。

### `packages/neuro-book/src/plugins/editor/web/code/monaco-theme.ts`

- 底色读 `--bg-panel`。注释写明：编辑组的面是 `--panel-surface`，自带主题里它就是 `--bg-panel`；Monaco 要不透明的颜色，所以读配色变量，不读可能半透明的面变量。
- `nb-ui/src/tokens.css` 语法色那段注释里“源码编辑器的底是 --bg-main”改成 `--bg-panel`；加深 25% 的理由（状态色按面板底校）照旧成立。

## Spec 与文档改动

- `workbench/markdown-editing.md`：加输出 26“注音是一个整体”（格式盖住注音一部分时整段一起改；拖选时注音小字不画成选中；已知限制两种）；加验收场景 7；实现合同的公开入口与证据加 `whole-ruby.ts` 与测试。
- `theme/system.md`：Monaco 主题一条写明底色取 `--bg-panel`，与 Markdown 稿纸相同。
- `editor.md` 不改（主工作区有别的会话未提交的改动；输出 65 只说“在源码编辑器的底色上读得清”，不写是哪个变量）。
- 待确认清单 t05 第 5 行写结果：开发者改判统一，t20 做。
- nb-ui `AnchoredPopover.md`、`SuggestionMenu.md` 补动效。

## 切片

1. 注音当整体与不可选：`whole-ruby.ts`、`ruby/index.ts`、`markdown.css`、测试；提交。验证：`bun run --cwd packages/nb-markdown test`（含新用例），`e2e/markdown-editing.e2e.ts` 的注音几例。
2. 入场动效：两个 nb-ui 组件与 `.md`；提交。验证：nb-ui 包测试；真实浏览器按 UI 验收分档量 nbook、macos 各明暗下三个菜单的计算动画（名字、时长、曲线）与 390px 下选区菜单不溢出。
3. 源码编辑器底色：`monaco-theme.ts`、`tokens.css` 注释、`editor-code-menu.e2e.ts` 第 282 行的断言改成 `--bg-panel`；提交。验证：`code/monaco-theme.test.ts`、`editor-code-menu.e2e.ts` 的语法配色四例，看一张亮色截图里的当前行高亮与缩进线。
4. Spec 与记录（主工作区 master）。

## 验收映射

| 编号 | 覆盖 |
|---|---|
| markdown-editing 输出 26 的格式部分 | `whole-ruby.dom.test.ts`（新）：经动作、经 `keyboardShortcut("Mod-b")`、清除格式、设新注音盖住旧注音一半、行内代码、撤销；写回的 Markdown 只有一个 `<ruby>` |
| markdown-editing 输出 26 的不可选、验收 7 | `markdown-editing.e2e.ts` 新用例：真实鼠标从注音中间拖到注音之后，`getSelection().toString()` 不含注音；Ctrl+B 后存盘是一个 `<ruby>` |
| 三个菜单的动效 | `markdown-editing.e2e.ts` 新用例（开回动态效果）：选区菜单与斜杠菜单出现时有 `nb-popover-in`，曲线是 `--ease-layout` 的值；关闭后在退场结束才从 DOM 里拿掉 |
| editor 场景 43（底色） | `editor-code-menu.e2e.ts` 的语法配色四例 |

## 验证

- 合入前 e2e 清单（3 个文件）：`markdown-editing.e2e.ts`、`editor-code-menu.e2e.ts`、`markdown-input.e2e.ts`（注音的输入行为在这里，插件改了标记步的处理）。改动后只重跑覆盖改动的文件与失败项。
- `bun run test:affected --typecheck`（nb-markdown、nb-ui 与依赖它们的包）。
- 未验证边界：触屏拖选；其它渲染器打开以前写出的、已经拆成两段的注音照旧显示两份（文件本身就是两段）。

## 不做与风险

- 不改注音的 Markdown 写法（方言输出 12）：格式只盖住注音一部分的文件，读进来照原样显示。
- 风险：插件对每个事务都看标记步，长文档里全选加粗时两端各做一次 `resolve`，开销可以忽略；不在没有标记步的事务上做任何事。
- 风险：批注盖住注音一半时也会扩到整段注音，批注范围比用户选的多几个字。可以接受：否则批注把注音拆开、显示两份。
