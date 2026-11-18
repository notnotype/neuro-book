# t09 计划：表情选择器、补全与输入框发表情

## Context

开发者 2026-11-18 意见第 3 条：编辑器没有表情的输入控件、没有选择器，Agent 输入框不能发表情。设计在会话与第 1 轮评审板里定了（[README](README.md) 决定 1 到 8）：编辑器与输入框都能打 `:` 补全、点按钮开选择器；选择器版式 A（搜索、表情包标签、分组网格、底部写名字与写法，“最近用过”在最前）；输入框里显示成行内小图，发出的消息与回复同一大小规则，只有表情的一条消息不画气泡。

依据：[`agent/stickers.md`](../../../../../docs/specs/agent/stickers.md)（写法、目录、输出 10 到 18）、[`ui/prompt-editor.md`](../../../../../docs/specs/ui/prompt-editor.md)（触发菜单、小块、静态显示）、[`workbench/markdown-editing.md`](../../../../../docs/specs/workbench/markdown-editing.md)（工具栏、斜杠菜单、命令表）、[`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md)（输入框与用户消息）。

约束：行内小图沿用展示器现有的样式（`.nb-sticker`，按汉字字形中心对齐，`markdown.css`）；评审板附言“表情和文字高度没对齐”来自草稿用了 `vertical-align: middle`，产品里输入框与用户消息都用同一份类名，验收时在真实浏览器里量。t10 会给目录加内置来源，选择器的分组顺序跟着目录的来源顺序走，不另写。

## 技术选型

- 拼音首字母：沿用斜杠菜单已有的 `pinyin-pro`，第一次用到时才加载。
- 最近用过：仓库的记录机制 `defineRecord`（`scope: "user"`、`locality: "local"`），同 `markdown.colors`；不裸写 `localStorage`。
- 弹层：nb-ui 的 `AnchoredPopover`（插图卡片、注音卡片同款）；补全用 `SuggestionMenu`。
- 没有新依赖。

## 关键设计

### `plugins/stickers`（目录与选择器服务）

- 浏览器目录（输出 18）每个表情包多带 `title`（显示名）与 `source`，选择器的组头与标签要用；仍不带说明。`shared/contracts.ts` 的 `BrowserPackSchema` 加两个字段，`backend` 生成目录处补上，预算测试照跑（每包至多多 200 字符）。
- 新浏览器服务 `stickerPickerKey`（`web/plugin.ts` 的 `browser` 入口一并提供，与 `stickerResolverKey` 同一份目录）：

  ```ts
  interface StickerPicker {
      /** 当前目录（响应式），按来源分组的顺序。 */
      readonly packs: Readonly<Ref<readonly PickerPack[]>>;
      /** 补全与搜索：名字包含、拼音首字母、`包/` 前缀限定；至多 limit 项。 */
      search(query: string, limit: number): Promise<readonly PickerItem[]>;
      /** 最近用过（至多 16 个，新的在前），目录里已没有的不列。 */
      readonly recent: Readonly<Ref<readonly PickerItem[]>>;
      /** 插入之后调用：记进最近用过。 */
      used(item: PickerItem): void;
      /** 面板组件：props `{autofocus?}`，emit `pick(item, keepOpen)`、`close`。 */
      readonly Panel: Component;
  }
  interface PickerItem { pack: string; name: string; url: string; width: number; height: number; writing: string; packTitle: string }
  ```

  写法 `writing` 的包段按输出 14 的规则：写文件夹名，全部有效的表情包里有同名文件夹时写 id；与槽共用一个函数（现在写在 `agent/backend/stickers/extension.ts` 的槽里，提到 `stickers/shared/`，槽改为调用它）。
- `web/recent.ts`：记录 `stickers.recent`（`{pack, name}[]`，至多 16），读坏了当空；保存失败只改显示，同 `colors.ts`。
- `web/components/StickerPickerPanel.vue` 与同名 `.md`：版式 A。标签行（最近、各包的第一张图）只用底色标当前，不画边线（决定 5 附言）；网格按包分组、格子约 52px、方向键在格子间移动、回车插入；底部一行是指着的表情（大图、名字、写法）；搜索时不分组；没有表情包时一句话加“在设置里新建”（打开表情包页）。Lab 场景：有最近、搜索、没有表情包、390 宽、英文界面。
- 面板只发 `pick`，插在哪里由宿主决定；Shift+点击与 Shift+回车发 `keepOpen: true`。

### nb-ui `SuggestionMenu`

- `SuggestionMenuItem` 加 `imageUrl?: string`：画在图标列，24px、`object-fit: contain`；整个菜单有一项带图时图标列按 24px 留。`SuggestionMenu.md` 与测试同改。

### nb-markdown：编辑器的 `:` 补全

- `editor/sticker-trigger.ts`，照 `slash-trigger.ts`：`createTriggerPlugin`，读光标前同一文本块的文字，匹配“开头或一个不是 ASCII 字母数字的字、半角 `:`、至少 1 个不是空白与 `:` 的字”；代码块、原样块、行内代码里不触发；组字时由宿主判断。导出 `activeSticker`、`dismissSticker`、`insertStickerAtTrigger(editor, writing)`（把 `:查询` 换成表情节点，节点的原文走 `parseSticker`，`closeHistory` 同斜杠）。
- 与输入规则（输出 22）的关系：打出收尾的 `:` 时输入规则先把写法变成节点，触发随之消失，不冲突。

### nb-markdown：`PromptEditor` 与 `PromptTextView`

- 文字写法加“表情”：`:名字:`、`:包/名字:`，判断用 `stickers.ts` 的 `stickerAt`，反引号代码里不认；读入、粘贴、菜单确认时成为表情小块（新 kind `sticker`），手打的在打出收尾的 `:` 时变（同输出 2 的“写完时”）。小块的样子是行内小图：经宿主端口 `stickers` 查，查到画图（`.nb-sticker` 同一套类名），查不到或没有端口时显示原文文字。写回原样。
- 触发 `:` 的边界与别的触发不同：前一个字不是 ASCII 字母数字即可（中文里紧跟汉字也算），查询至少 1 个字；规则写进 `findPromptTrigger`，只对 `:` 生效。宿主的 `triggers` 里列了 `:` 才开。
- `PromptEditorMenuItem` 加 `imageUrl?`（交给 `SuggestionMenu`）与 `appendSpace?: boolean`（缺省真；表情项为假，中文里不补空格）。
- `PromptTextView`：表情小块同上；一段（以空行分段）里只有表情与空白、表情不超过 3 个时这一段的表情是大图，规则与展示器共用一个函数（`stickerBlockSize`，现有的块后处理里提出来）。
- 新导出 `isStickerOnlyText(text)`：去掉空白后只剩 1 到 3 个写法（只看写法，不查目录），给宿主判断“只有表情的消息”。

### nb-agent-ui

- 新端口 `PromptBarenessPort = (text: string) => boolean`（同 `MarkdownPreviewPort` 的形状，宿主注入，不注入时恒为假）：用户消息没有附件、端口为真时不画气泡，内容照常经 `PromptTextView`；样式在 `AgentConversationTurn`。
- `ToolbarButtonEntry` 加第三种 `{popover: Component}`：点了在按钮上方（放不下翻到下方）开 `AnchoredPopover`，里面渲染登记的组件，交给它 `{insert(text), close()}`；`insert` 经编辑器的 `insertText` 插在光标处并把焦点交回编辑器。只读、不可发送时按钮禁用。`AgentConversationComposer.md` 同改。

### neuro-book：编辑器接线（`plugins/markdown`）

- 可选依赖 `stickerPickerKey`；没有时不出按钮、斜杠项与补全（Lab、没有表情插件的宿主）。
- `MarkdownStickerMenu.vue`：补全菜单，照 `MarkdownSlashMenu`（键盘在滚动容器捕获阶段拦，菜单开着才拦），项来自 `picker.search(query, 8)`，一行小图、名字、表情包名；确认后 `insertStickerAtTrigger` 并 `picker.used`。
- 工具栏：图片后面加“表情”（`prompt: sticker`）；斜杠菜单“块”组“图片”后面加“表情”（同样发 `prompt: sticker`，先删 `/查询`）。菜单层开 `AnchoredPopover` 装 `picker.Panel`：锚在工具栏按钮上，斜杠打开时锚在光标；选了经命令 `nbook.edit.sticker {text}` 插在光标处（`canFormat`，代码块里不可用）；Esc、点外面关上，焦点回正文。只读时按钮置灰。

### neuro-book：输入框接线（`plugins/agent/web`）

- 可选依赖 `stickerPickerKey`；有时：登记触发 `:`（`resolveTriggerMenu` 对 `:` 用 `picker.search`，项带 `imageUrl`、`appendSpace: false`，确认后 `picker.used`）；登记工具栏按钮“表情”（`popover` 装 `picker.Panel`，在 `+` 后面，单行版式放进前置按钮）；注入 `PromptBarenessPort = isStickerOnlyText`。

## Spec 与文档改动

- `agent/stickers.md`：“不承诺”去掉输入框发表情、编辑器插入菜单两条；新增输出 39 起：选择器（版式、分组顺序、最近用过、搜索规则、插入的写法、`keepOpen`）、补全（触发规则、筛选、确认）、输入框里与用户消息里的样子、只有表情的消息不画气泡；输出 18 加 `title`、`source`；验收加 11、12（编辑器、输入框各一组）。实现合同加 `stickerPickerKey`、记录 `stickers.recent`。
- `ui/prompt-editor.md`：文字写法表加“表情”；触发菜单补 `:` 的边界；`appendSpace`、`imageUrl`；静态显示的大图规则。
- `workbench/markdown-editing.md`：输出 1 工具栏、输出 11 斜杠菜单加“表情”；新增 `:` 补全一条；命令表加 `nbook.edit.sticker`。
- `ui/agent-conversation-view.md`：输入框按钮的弹层一种；只有表情的用户消息不画气泡。
- 组件 `.md`：`SuggestionMenu`、`PromptEditor`、`PromptTextView`、`AgentConversationComposer`、`MarkdownToolbar`、`MarkdownMenus`、新的 `StickerPickerPanel`、`MarkdownStickerMenu`。

## 切片

1. **Spec**（主工作区，planned 条目）。
2. **目录与服务**：浏览器目录加字段、写法函数提到 shared、`stickerPickerKey`（search、recent、used），面板先不做。验证：`bun test src/plugins/stickers src/plugins/agent/stickers-slot.test.ts`、typecheck。
3. **nb-ui 与 nb-markdown**：`SuggestionMenu.imageUrl`；`PromptEditor`/`PromptTextView` 的表情小块、`:` 触发、`appendSpace`、大图规则、`isStickerOnlyText`；编辑器的 `sticker-trigger.ts`。验证：nb-ui、nb-markdown 的 vitest 与 typecheck，`check:dist`。
4. **选择器面板**：`StickerPickerPanel` 与 Lab 场景，DOM 测试（分组、搜索、方向键、Shift 不关、最近用过）。
5. **编辑器接线**：补全菜单、工具栏、斜杠、命令、弹层。验证：markdown 的 DOM 测试、e2e。
6. **输入框接线**：nb-agent-ui 的弹层按钮与无气泡；agent 插件的触发、按钮、端口。验证：nb-agent-ui 测试、agent 的 DOM 测试、e2e。
7. 收口：实现审查（前端派 Sonnet；切片 2 的目录字段很小，按任务大小降级不另开 omp），Spec 晋升。

## 验收映射

| Spec | 覆盖 |
|---|---|
| stickers 输出 18（新字段） | `stickers.test.ts` 目录预算用例 |
| stickers 新输出：搜索、最近、写法 | `web/picker.test.ts`（真实目录数据，替身只换记录存储） |
| stickers 新输出：面板 | `StickerPickerPanel.dom.test.ts`、Lab 场景 |
| prompt-editor 表情写法、`:` 触发、`appendSpace`、大图 | `PromptEditor.dom.test.ts`、`prompt-text.test.ts`、`PromptTextView.dom.test.ts` |
| markdown-editing `:` 补全、工具栏、斜杠、命令 | `sticker-trigger.dom.test.ts`（nb-markdown）、`MarkdownMenus.dom.test.ts` |
| agent-conversation-view 弹层按钮、无气泡 | `AgentConversationComposer.dom.test.ts`、`AgentUserContent.dom.test.ts` |
| stickers 验收 11（编辑器） | `e2e/sticker-picker.e2e.ts`：打 `:开` 回车、保存是 `:lyra/开心:`；工具栏按钮选一个、重开后“最近用过”里有它 |
| stickers 验收 12（输入框） | 同文件：打 `:k` 选“开心”发送，请求里是写法原文、消息里是图；只发一个表情的消息没有气泡、是大图；行内小图与文字的竖直中心差不超过 2px |

## 验证

- 每片自跑上面的命令；改到的包跑各自的 typecheck。
- e2e 合入前一次：`sticker-picker.e2e.ts`（新）、`stickers.e2e.ts`、`sticker-packs.e2e.ts`（目录字段变了）、覆盖输入框与提示词编辑器的 `agent-conversation.e2e.ts`、`lab-agent-ui.e2e.ts`、`lab-markdown.e2e.ts`，共 6 个。实施中只重跑改到的那个。
- 未验证边界：真实输入法组字中的 `:`（CDP 不能完整模拟组字，同 t02）。

## 不做与风险

- 不做：表情的拖放插入、选择器里的收藏与排序、按 Profile 限制列出的包（决定 2）、全角冒号触发（决定 3）。
- 风险：`PromptEditor` 加一种小块要守住“文字原样往返”（输出 1），由 `prompt-text.test.ts` 的往返用例加表情写法兜底，用真实解析函数。
- 风险：`isStickerOnlyText` 只看写法不查目录，认不出的写法单发时也不画气泡、显示原文；记为已知限制写进 Spec。
