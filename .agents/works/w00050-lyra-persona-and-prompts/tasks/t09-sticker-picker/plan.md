# t09 计划：表情选择器、补全与输入框发表情

第 2 稿（2026-11-18）：按设计审查（[`evidences/design-review.txt`](evidences/design-review.txt)，17 条，处理见 [`evidences/design-review-disposition.txt`](evidences/design-review-disposition.txt)）修订；第 1 稿开发者已确认，修订只补实现路径与边界，另有决定 9 改了补全的触发。

## Context

开发者 2026-11-18 意见第 3 条：编辑器没有表情的输入控件、没有选择器，Agent 输入框不能发表情。设计定在 [README](README.md) 决定 1 到 9：编辑器与输入框都能打 `:` 补全、点按钮开选择器；选择器版式 A（搜索、表情包标签、分组网格、底部写名字与写法，“最近用过”在最前）；输入框里显示成行内小图，发出的消息与回复同一大小规则，只有表情的一条消息不画气泡；查询只有 1 个英文字母时不弹（颜文字）。

依据：[`agent/stickers.md`](../../../../../docs/specs/agent/stickers.md)（写法、目录、输出 10 到 18、39 到 45）、[`ui/prompt-editor.md`](../../../../../docs/specs/ui/prompt-editor.md)、[`workbench/markdown-editing.md`](../../../../../docs/specs/workbench/markdown-editing.md)（输出 1、11、54、62，命令表）、[`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md)。

t10 会给目录加内置来源与“我的优先”的同名规则；本 Task 的写法包段由后端算好随目录下发（下文），t10 只改后端的算法。

## 技术选型

- 拼音首字母：沿用斜杠菜单的 `pinyin-pro`，懒加载，装在 `shallowRef` 里；加载完成前只按名字与包筛，加载后响应式重算（同 `MarkdownSlashMenu`）。
- 最近用过：`defineRecord`（`scope: "user"`、`locality: "local"`），同 `markdown/web/colors.ts`。
- 弹层：nb-ui `AnchoredPopover` 只当外框；补全用 `SuggestionMenu`。
- 没有新依赖。

## 关键设计

### 共用样式：`nb-markdown/src/stickers.css`（新）

- 把 `display/markdown.css` 里 `.nb-markdown .nb-sticker…` 的规则（尺寸、`vertical-align: -0.16em`、`margin-block`、间隙类、大图、选中描边）搬成不带 `.nb-markdown` 前缀的 `.nb-sticker…`，由展示器、Markdown 编辑器、`PromptEditor`、`PromptTextView` 共同引入（审查第 4 条）。提示词里的表情节点视图用裸 `<span class="nb-sticker">`，不套 `InlineChip` 的 `inline-flex` 外壳。
- 行高不同的三处（展示器、输入框、用户消息）各有一个 Lab 场景，按同一量法核对图与汉字的竖直中心。

### `plugins/stickers`（目录与选择器服务）

- 浏览器目录（输出 18）每个表情包多带：`title`、`source`、插件的 `{id, title}`（插件来源才有），以及后端算好的写法包段 `writing`（输出 14 的规则，在完整目录上算，不受浏览器目录截断影响，审查第 8 条）。槽也改用这个函数，函数放 `stickers/shared/writing.ts`。预算测试按新字段重算。
- 选择器自己排分组：我的在前，各插件按插件显示名（没有时插件 id）一组；同组内按目录顺序（Spec 39 改成“选择器自己排”）。
- 入口拆分（审查第 7 条）：`browser` 入口不加依赖，多交一个服务 `stickerDirectoryKey`（目录的响应式快照与 `resolve`，`stickerResolverKey` 仍交 `resolve`，Markdown 不受影响）；新入口 `picker` 依赖 `stickerDirectoryKey`、`storageKey`（可选）、`windowTextKey`（可选）、`settingsKey`（可选，打开表情包页），提供 `stickerPickerKey`：

  ```ts
  interface StickerPicker {
      /** 分好组的表情包（响应式）。 */
      readonly groups: Readonly<Ref<readonly PickerGroup[]>>;
      /** 同步：名字包含、拼音首字母开头、`包/` 限定（包段按文件夹名、id 或显示名的开头）；拼音库未到时只按名字与包。 */
      search(query: string, limit: number): readonly PickerItem[];
      /** 同步认一条写法（提示词编辑器决定是否成为表情小块）；目录未到时 undefined。 */
      known(raw: string): boolean | undefined;
      readonly recent: Readonly<Ref<readonly PickerItem[]>>;
      used(item: PickerItem): void;
      /** 面板组件，按需加载。 */
      loadPanel(): Promise<Component>;
      openPacksPage(): void;
  }
  ```

  `search` 同步（审查第 11 条）。`包/` 后面没有字时列这个包的全部（不受 8 项上限）。`recent` 存表情包 id 与名字（审查第 12 条）；目录里没有的不列；坏记录当空。
- `web/components/StickerPickerPanel.vue` 与同名 `.md`：版式 A；标签只用底色标当前；方向键、回车、Shift+回车或 Shift+点击不关；Esc、点外面、焦点离开时发 `close`，焦点回收由面板发出的事件统一处理，两个宿主不各写（审查第 10 条）。没有表情包时“在设置里新建”调 `openPacksPage`。Lab 场景：有最近、搜索、没有表情包、390 宽、英文界面。

### nb-ui `SuggestionMenu`

- `SuggestionMenuItem` 加 `imageUrl?`：图标列 24px、`object-fit: contain`。`.md` 与测试同改。

### nb-markdown：编辑器

- `editor/sticker-trigger.ts`（照 `slash-trigger.ts`）：段落、标题、列表项、表格单元格里，光标前是“开头或一个不是 ASCII 字母数字的字、半角 `:`、查询”，查询没有空白与 `:`，且不是“只有 1 个 ASCII 字母”（决定 9）；光标在行内代码、代码块、原样块里不触发。导出 `activeSticker`、`dismissSticker`、`insertStickerAtTrigger(editor, raw)`。
- 编辑动作表 `editor/editing-actions.ts` 加 `sticker`：`run` 先 `parseSticker(text)`，不是一个完整写法返回 false（审查第 6 条，守住“节点原文一定是写法”）；光标或选区在行内代码里不可用；插入后不留 `code` 标记。`insertStickerAtTrigger` 同样校验。

### nb-markdown：`PromptEditor` 与 `PromptTextView`

- 宿主端口 `MarkdownHost` 加 `stickerKnown?: (raw: string) => boolean | undefined`（同步）。表情是独立节点类型 `promptSticker`（`atom`、自己的节点视图、不进 `PromptTokenAttrs`、不发 `token-activate`，审查第 5 条）：只在 `stickerKnown` 为真时成立；为假、未定或没有端口时就是文字（审查第 14 条，Spec 44 改成“认不出的就是文字”）。目录晚到时，已打开的正文在目录到了后按原文重新识别一次（不进撤销历史）。
- 往返（审查第 1 条）：插入写法（菜单确认、弹层 `insert`）前检查插入后同一行重新分词时它仍是一个整体，不是就在前面补一个空格；`prompt-text.test.ts` 的往返用例加“前文有 `:词`”。
- `findPromptTrigger` 改成每个触发字符一条规则的表（审查第 15 条）：`@`、`$`、`/` 照旧；`:` 用决定 3、9 的边界。查询含 `:` 时不触发、也不往后找。
- `PromptEditorMenu` 加 `hideWhenEmpty?: boolean`（审查第 2 条，表情菜单为真：没有匹配时不弹，回车照常发送）；`PromptEditorMenuItem` 加 `imageUrl?` 与 `appendSpace?`（缺省真）。
- `PromptTextView`：表情节点同上；一段（空行分段）只有表情与空白、不超过 3 个时是大图，规则与展示器共用 `stickerBlockSize`。
- 导出 `stickerOnlyMessage(texts: readonly string[], known)`：所有文字块拼起来去掉空白后只剩 1 到 3 个认得出的写法。

### nb-agent-ui

- 端口 `PromptBarenessPort = (texts: readonly string[]) => boolean`（审查第 13 条）：`AgentConversationTurn` 收集这条用户消息的文字块；有附件块、正文被省略（`contentOmitted`）、正在就地编辑时一律画气泡；端口为真时不画气泡，内容照常经 `AgentUserContent`。无气泡时左缩进与消息头对齐、和下一条的间距同有气泡时；Lab 加一个场景。
- `ToolbarButtonEntry`：`placement` 加 `"after-add"`（`+` 后面；单行版式并入前置按钮，审查第 9 条）；加第三种形态 `{popover: () => Promise<Component>}`，点了用 `AnchoredPopover` 在按钮旁打开（输入框在面板底部，放不下下方时翻到上方，实际朝上），交给组件 `{insert(text), close()}`；`insert` 走编辑器 `insertText`（同上补空格检查）并把焦点交回编辑器。只读、不可发送时禁用。

### neuro-book：编辑器接线

- `plugins/editor`（审查第 6 条）：`shared/editing.ts` 的 `EDITING_ACTIONS` 加 `sticker`（`args: "text"`，`canFormat`）；`web/editing-commands.ts` 的参数表、`editing-menus.ts`、`locales/*.json` 的标题中英两份、Lab 的 `editor-scene/lab-editor-menus.ts` 替身同改。
- `plugins/markdown`：可选解析 `stickerPickerKey`（`resolve`，晚到时按钮后出现，不拦激活）。
  - `MarkdownStickerMenu.vue`：补全，照 `MarkdownSlashMenu`；确认后 `insertStickerAtTrigger` 并 `used`。
  - 工具栏“表情”（`prompt: sticker`，进 `PROMPTS`；固定宽度表加一格）、斜杠“块”组“表情”。
  - 菜单层（审查第 10 条）照插图卡片接：打开时 `holdSelection`/`holdCaret`，选区菜单 `suspended`、批注层 `blocked`，与注音、链接、插图卡片互斥，换文档或变只读时关；锚点：工具栏按钮在视图里时锚按钮，在“⋯”里或从斜杠打开时锚光标（`selectionAnchor`）；从 `+` 块的斜杠打开、放弃时回收空段落（同 `removeSlashBlock`）。选了经 `menus.run('sticker', {text})`。

### neuro-book：输入框接线

- `plugins/agent/web`（审查第 3 条）：`HOST_TRIGGERS` 随 `stickerPickerKey` 是否解析到加 `:`；注册表加一条 `toolbarButtons`（`placement: "after-add"`、`popover: picker.loadPanel`）与 `:` 的触发；`resolveTriggerMenu` 对 `:` 用 `picker.search(query, 8)`，项带 `imageUrl`、`appendSpace: false`，菜单 `hideWhenEmpty`；确认后 `used`。Markdown 宿主的 `stickerKnown` 接 `picker.known`；注入 `PromptBarenessPort`。
- 历史消息的就地编辑器（`AgentMessageEditor`）显示表情节点，不开 `:` 补全与按钮（Spec 写明）。

## Spec 与文档改动

已提交的 planned 条目按审查改：stickers 输出 18（插件信息与写法包段）、39（分组由选择器排、锚点）、40（包段也按显示名、`包/` 空查询）、42（决定 9、没有匹配时不弹）、44（认不出的就是文字）、45（文字块、省略、编辑时）；验收 12 的 `:k` 改 `:kx`；prompt-editor 的写法表与输出 5（`hideWhenEmpty`、补空格检查）；agent-conversation-view 的按钮位置与就地编辑。组件 `.md` 同计划第 1 稿，另加 `stickers.css` 的说明进 `MarkdownDisplay.md`。

## 切片

1. **Spec 修订**（主工作区）。
2. **目录与服务**：后端目录字段与写法包段、`stickerDirectoryKey`、`picker` 入口的 `search`、`known`、`recent`。验证：`bun test src/plugins/stickers src/plugins/agent/stickers-slot.test.ts`、typecheck。
3. **nb-ui 与 nb-markdown**：`imageUrl`；`stickers.css`；提示词的 `promptSticker`、触发规则表、`hideWhenEmpty`、补空格检查、大图、`stickerOnlyMessage`；编辑器的 `sticker-trigger.ts` 与 `sticker` 动作。验证：两包 vitest 与 typecheck，`check:dist`。
4. **选择器面板**与 Lab 场景、DOM 测试。
5. **编辑器接线**（`plugins/editor` 与 `plugins/markdown`）。
6. **输入框接线**（nb-agent-ui 与 `plugins/agent/web`）。
7. 收口：e2e、实现审查（前端派 Sonnet；后端目录字段改动小，按任务大小降级不另开 omp）、Spec 晋升。

## 验收映射

| Spec | 覆盖 |
|---|---|
| stickers 输出 18 | `stickers.test.ts` 目录预算与写法包段（截断时仍按完整目录写 id） |
| 输出 39 到 43 | `web/picker.test.ts`（真实目录数据；分组、搜索含拼音与显示名、`包/` 空查询、`known`、最近用过的读写与目录删除后不列）、`StickerPickerPanel.dom.test.ts` |
| 输出 42、44、prompt-editor 输出 1、5 | `prompt-text.test.ts`（触发规则表：`10:30`、`http://x`、`备注:$a`、`你好:开:心`、`::1`、`:D`、`:kx`、`(:开`、`，:开`；往返含前文 `:词`）、`PromptEditor.dom.test.ts`（无匹配不弹、回车发送；认不出的是文字；目录晚到后识别） |
| markdown-editing 输出 62 与命令 | `sticker-trigger.dom.test.ts`、`editing-actions.dom.test.ts`（非写法参数返回 false、行内代码不可用）、`MarkdownMenus.dom.test.ts` |
| 输出 45、agent-conversation-view | `AgentConversationTurn`/`AgentUserContent` 的 DOM 测试（附件、省略、多文字块、编辑中）、`AgentConversationComposer.dom.test.ts`（`after-add`、弹层插入、单行版式） |
| 样式对齐 | Lab 三个场景的量法（展示器、`PromptEditor`、`PromptTextView`） |
| 验收 11、12 | `e2e/sticker-picker.e2e.ts`（最近用过等记录写入后再重开） |

## 验证

- 每片自跑上面的命令。
- e2e 合入前一次：`sticker-picker.e2e.ts`（新）、`stickers.e2e.ts`、`sticker-packs.e2e.ts`、`agent-conversation.e2e.ts`、`lab-agent-ui.e2e.ts`、`lab-markdown.e2e.ts`、`markdown-editing.e2e.ts`（工具栏折叠与斜杠条目）、`markdown-input.e2e.ts`，共 8 个。实施中只重跑改到的。
- 未验证边界：真实输入法组字中的 `:`；多窗口同时写“最近用过”的合并（记录机制的行为，按现有 `colors.ts` 的程度接受）。

## 不做与风险

- 不做：拖放插入、收藏与排序、按 Profile 限制列出的包、全角冒号触发、就地编辑历史消息时的补全与按钮。
- 风险：提示词的表情只在“认得出”时成为节点，目录晚到时要重新识别一次；用 `PromptEditor.dom.test.ts` 的晚到用例兜底，用真实的 `parsePromptText`。
