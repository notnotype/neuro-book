# t20 实施计划，第二段：颜色拆分按钮、选区菜单的块类型、注音卡片

## Context

第一段（[plan.md](plan.md)）之后，按[评审板](artifacts/review/index.html)第 1 轮的决定（[README](README.md) 的“开发者的决定”1–3）实现三项外观与交互：

1. 文字颜色与高亮用拆分按钮：左半边用上次用过的颜色（第一次红、黄），图标下的色条是这个颜色；右半边开色板。工具栏与选区菜单一起改。板上写了“上次用过的颜色记在本机，所有作品共用”。
2. 选区菜单最前面加块类型下拉（与工具栏同一个：正文、标题 1–3）。不加“⋯”。
3. 注音用一行卡片：注音直接写在卡片里，没有输入框的框；右边确定，已有注音时多一个“移除注音”。选中的文字里有注音时菜单上的注音按钮按下；点它或点注音小字打开修改；写的时候原来的选区保持高亮；回车确定、Esc 取消。

依据：[`workbench/markdown-editing.md`](../../../../../docs/specs/workbench/markdown-editing.md) 输出 1、5、6、7、9 与命令表；[`docs/standards/code/frontend.md`](../../../../../docs/standards/code/frontend.md) 的“客户端持久化与存储分层”（组件不裸写 localStorage）。同一个 worktree 与分支，接在第一段之后。

## 技术选型

无。持久化用应用已有的 `defineStore` 加 `persist(defineRecord(...))`（照 `settings/web/window-size.ts`）；保持选区高亮用 ProseMirror 的装饰。

## 关键设计

### 记住上次的颜色：`packages/neuro-book/src/plugins/markdown/web/`

- 新文件 `colors.ts`：记录 `markdown.colors`（owner `nbook.markdown`，user/local，版本 1，`{text?: "#rrggbb", highlight?: "#rrggbb"}`）与 store `markdownColorsStore`（`state.colors`、`actions.remember(action, color)`）；导出注入键 `markdownColorsKey` 与端口 `{last(action): string; remember(action, color): void}`。读不到、坏了或保存暂停时用缺省（红 `#ef4444`、黄 `#fef9c3`，取自 `menus/palette.ts`），不提示：这只是偏好。
- `plugin.ts`：依赖加 `{key: storageKey, required: false}`；激活时建 store，经 `withHost` 的 `provide` 交给组件（与方言目录、图片地址同一条路）。没有存储服务时端口退成只在内存里记。

### 拆分按钮：`menus/MarkdownColorButton.vue`

- 左半边是原来的 `IconButton`，上面盖一条 3px 的色条（上次的颜色）；点它执行 `text-color` 或 `highlight`，参数是这个颜色。右半边是 14px 宽的箭头按钮，开原来的色板；色板里选一个颜色执行并记住，选“默认”去掉颜色、不记。注入不到端口时（单测、Lab）用内存里的缺省。
- 两半各有可访问名称：“文字颜色”“选择文字颜色”，“高亮”“选择高亮颜色”（新文案进 `editor` 的消息目录）。
- `MarkdownToolbar.vue` 的宽度常量 `COLOR` 从 28 改成 42（按钮 26、箭头 14、间隙 2）。

### 选区菜单的块类型：`menus/MarkdownSelectionMenu.vue`

- 最前面放与工具栏同一个块类型下拉（同样的项、勾选与可用规则），之后一条分隔线。块类型的项与“当前块”的计算从 `MarkdownToolbar.vue` 搬到 `menus/block-menu.ts`，两处共用。
- 下拉的内容带 `data-markdown-menu-layer`（焦点进下拉时选区菜单仍算“焦点在菜单里”，与色板相同）；选了一项后焦点回到正文，不回触发按钮（照工具栏的 `onCloseAutoFocus`，nb-ui 规范“从正在编辑的内容旁打开的菜单”）。

### 注音卡片

- nb-ui `Input` 加 `variant?: "default" | "bare"`：`bare` 没有边框、底色与焦点环，放在已经有外框的容器里原地编辑，聚焦时只有光标。同名 `.md` 与 Lab 场景各加一条。t13 的批注卡片以后也用它。
- `menus/MarkdownTextPrompt.vue` 改成一行卡片：`Input variant="bare"`、确定按钮、可选的“移除”按钮；新加 props `initial`（预填）、`removeLabel`（给了才有移除按钮），事件 `remove`。回车、Esc、焦点离开的规则不变（空的回车仍是取消）。双语也用这张卡片，没有移除按钮。
- `menus/MarkdownMenus.vue`：打开注音时预填选区里注音的文字（`editor.getAttributes("markdownRuby").text`），选区里有注音时给移除按钮；打开期间保持选区高亮，关上时撤掉。在注音小字上按下指针时：选中这段注音（`@tiptap/core` 的 `getMarkRange`）并打开修改；只读时不响应。
- 保持选区高亮：nb-markdown 编辑器扩展加 `MarkdownHeldSelection`（`src/editor/held-selection.ts`，进 `createMarkdownEditorExtensions`），命令 `holdSelection()` 把当前选区画成 `.nb-markdown-held-selection`（底色 `--selection-bg`），`releaseSelection()` 撤掉；文档变化时随映射移动，换文档时清空。t13 加批注时也要用。
- 新编辑动作 `ruby-remove`（命令 `nbook.edit.ruby-remove`，`{}`，`canFormat`）：`extendMarkRange` 到整段注音再去掉；选区里没有注音时不可用。目录、实现、消息目录各加一条。
- `MarkdownSelectionMenu.vue` 的注音按钮按 `editing.active("ruby")` 显示按下。

## Spec 与文档改动

- `workbench/markdown-editing.md`：输出 1、6 写拆分按钮与记住的颜色；输出 6 加块类型下拉；输出 9 改成一行卡片（预填、移除、选区高亮、点注音小字）；命令表加 `nbook.edit.ruby-remove`；“副作用与数据”加记录 `markdown.colors`；加验收场景；证据与实现合同加新文件。
- 各组件同名 `.md`：`MarkdownColorButton`、`MarkdownSelectionMenu`、`MarkdownTextPrompt`、`MarkdownMenus`、nb-ui `Input`。

## 切片

1. nb-ui `Input` 的 `bare`（组件、`.md`、Lab 场景）；提交。
2. nb-markdown：`held-selection.ts` 与 `ruby-remove` 动作（含目录与消息目录）；提交。
3. 注音卡片：`MarkdownTextPrompt`、`MarkdownMenus`、选区菜单的按下态；提交。
4. 颜色：`colors.ts`、`plugin.ts`、`MarkdownColorButton`、工具栏宽度；提交。
5. 块类型下拉：`block-menu.ts`、选区菜单；提交。
6. Spec 与记录（主工作区 master，合入时一起提交）。

## 验收映射

| 判据 | 覆盖 |
|---|---|
| 拆分按钮：左半边上色、箭头开色板、选了记住、换页面后仍记得 | `markdown-editing.e2e.ts` 新用例（真实存储，刷新页面后再点左半边） |
| 选区菜单的块类型：选标题 2 后正文变标题、焦点回到正文 | `markdown-editing.e2e.ts` 新用例 |
| 注音卡片：新加时选区保持高亮、写了回车写回；选中已有注音时按钮按下、预填、移除；点注音小字打开修改 | `markdown-editing.e2e.ts` 改写原来的两例并新加；`ruby-remove` 与保持选区高亮另由 `editing-actions.dom.test.ts`、`held-selection.dom.test.ts` 测 |
| 目录里每个动作都有实现 | `MarkdownControl.dom.test.ts`（已有） |

## 验证

- 合入前 e2e 清单：`markdown-editing.e2e.ts`、`markdown-input.e2e.ts`、`lab-scenes`（改了 nb-ui `Input` 的 Lab 场景）。之后只重跑覆盖改动的文件与失败项。
- `bun run test:affected --typecheck`。
- UI 取证（nb-ui 共享组件那一档）：nbook、macos 各明暗四种组合下看选区菜单（拆分按钮、块类型）、注音卡片、`Input` 的 `bare`，外加 390px 视口下选区菜单不越出窗口；量计算样式，截亮色图给开发者。第一段的动效也在这一步一起看。

## 不做与风险

- 不做颜色的“最近用过”多格记忆、自定义颜色。
- 风险：选区菜单变宽（约 400px），窄窗口里靠 `AnchoredPopover` 夹进窗口；390px 下要实测。
- 风险：块类型下拉打开时焦点离开正文，选区菜单靠 `data-markdown-menu-layer` 留住；色板现在就是这样留住的，照同样的路径实测。
