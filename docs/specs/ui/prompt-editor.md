---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: ui.prompt-editor
owners:
  - packages/nb-markdown
---

# 写给 Agent 的编辑组件

## 目标与非目标

`PromptEditor` 是写给 Agent 的一段话的编辑组件：Agent 输入框与历史消息的就地编辑共用它；`PromptTextView` 用同一套写法静态显示已发送的消息。正文不做格式，但几类内容有专门的样子：引用、技能、命令显示为小块；图片与文件进上方的附件条，正文在插入处留 `#N` 小块；大段粘贴按大小折叠成粘贴块或转为文件附件。另有触发菜单与输入历史。两个组件是 nb-markdown 包的组件；neuro-book 经 `nbook.markdown` 的服务 `markdownKey` 交出，给的是作品文件的目标分类与文件图标。

**文字是唯一真相**：组件对外只交出一段文字，特殊内容都按“文字写法”写在文字里；读进来的文字原样写回，一个字符都不变。

属性、事件、布局与各状态的样子是组件合同，见组件文档 [`PromptEditor.md`](../../../packages/nb-markdown/src/prompt/PromptEditor.md) 与 [`PromptTextView.md`](../../../packages/nb-markdown/src/prompt/PromptTextView.md)。

不承诺：

- 格式命令与 Markdown 结构（表格、列表、标题）；文字里的 Markdown 不解释，原样是文字。
- 输入框的外壳：模型与模式切换、发送与停止按钮、排队的消息、横幅与提问向导。
- 候选的来源：`@`、`/`、`$` 的候选由宿主给出。
- 上传、登记附件、校验文件类型与大小、持久化草稿与输入历史：都由宿主负责。
- 写到一半的写法变成小块；菜单跟随光标定位；全屏编辑。

## 术语与参与者

- **宿主**：挂上组件的界面（以后的 Agent 输入框；本轮是 Lab 场景）。
- **小块**：与正文同一行高、不可拆的行内块，外观是 [`InlineChip`](../../../packages/nb-markdown/src/chip/InlineChip.md)。
- **草稿**：宿主给的 `{text, version}`；版本号变了才读入。

## 输入与前置条件

文字写法：

| 内容 | 写法 | 组件里的样子 |
|---|---|---|
| 引用 | `[名称](目标)`；目标的写法与 Markdown 链接相同（含尖括号、括号与空格的写法）。目标是不带方案的相对地址时，只有旧应用的工作区路径（`lorebook/`、`workspace/` 等开头）算引用 | 引用小块，按目标分类取图标（[workspace.markdown-dialect](../workspace/markdown-dialect.md) 输出 27） |
| 技能 | `$名称` 或 `${名称}` | 技能小块 |
| 选区引用 | `[[路径]]`、`[[路径#L起-L止]]`，或不带方括号的 `目录/文件#起-止`；`L` 不分大小写、可以省略 | 选区小块 |
| 命令 | 正文开头的 `/名称`，名称须在宿主给的命令表里 | 命令小块，后面的参数是普通文字 |
| 图片 | `![image #N](附件目标)` | 正文里的图片小块 `#N`；附件条里的缩略图 |
| 文件附件 | `[file #N · 文件名](附件目标)` | 正文里的文件小块 `#N`；附件条里的卡片 |
| 粘贴块 | 独占几行：`<paste id="N">`、内容、`</paste>` | 可折叠的粘贴块 |
| 粘贴块的位置标记 | `[paste #N]`，只在粘贴块放到开头时出现 | 粘贴小块 `#N` |

- 编号分两套：图片一套，文件附件与粘贴块共用另一套。每套在一次编辑里只增不减，删掉的号不再使用。读入的文字里没有编号的图片（`![任意名称](目标)`）按出现顺序接着编号，文字本身不改。
- 附件目标是会话工作区里的地址 `session://attachments/名称`（[`agent.resources`](../agent/resources.md)），由宿主在上传完成时给出：名称在会话内唯一，不含空白与括号。
- 技能写法的 `$` 与触发字符前面须是正文开头、空白、`(` 或中文标点。
- 反引号代码片段与围栏代码块（三个以上的反引号或波浪号）里的写法都是文字：贴给 Agent 的代码里的 `![x](a.png)` 不是图片，`handlers[key](event)` 不是引用。
- `@` 插入的作品里的文件，文件名里的 `%`、`#`、`?` 按百分号编码，读回仍指向同一个文件。

## 输出与可观察行为

1. **原样往返**：读入的文字不编辑写回，逐字符相同；能识别的写法显示为小块，识别不了的照常是文字。
2. **变成小块的时机**：读入文字、粘贴、菜单确认时出现；手打的写法在写完时变成小块：`$名称` 与开头的命令在后面打了空白或标点时，以括号收尾的写法在打出收尾的括号时。变成小块只是显示，写回的文字不变；Ctrl/⌘+Shift+V 粘贴的原文与“转为文字”得到的文字不会自己变。
3. **引用的插入**：`@` 菜单确认的作品里的文件写成以 `/` 开头的作品根地址（组件没有“当前文件”，不写相对地址）。
4. **提交与按键**：每次编辑后发出 `change`，带完整文字；宿主换了草稿版本时正文整体替换，不发 `change`，撤销历史清空。`enterSubmits` 为真时回车发出 `submit`（`mod` 为假），Shift+回车换行；为假时回车换行。Ctrl/⌘+回车总是发出 `submit`（`mod` 为真）。菜单开着且有可确认的项时回车交给菜单；输入法组字过程中的回车交还输入法。Escape 在菜单开着时关闭菜单（直到触发字符后的文字再变化才重新打开），否则发出 `escape`。Shift+Tab 发出 `shift-tab`，不移动焦点。点击正文空白处光标移到末尾。正文为空时 Ctrl/⌘+A 什么也不做。
5. **触发菜单**：触发字符位于正文开头、空白、`(` 或中文标点之后时开始一次查询，查询文字是它后面到光标为止、不含空白的部分；查询变化时用 `resolveMenu({trigger, query, atStart})` 重新取菜单。输入空白、光标移出、失去焦点关闭菜单；每次从关到开发出一次 `menu-open`。上下方向键移动高亮、跳过禁用项、到头回到另一端；回车或 Tab 确认；点击确认且不让正文失去焦点。没有可确认的项时，回车照常发送、Tab 照常移动焦点。确认后触发字符与查询文字替换为该项的 `insertText`，能识别的写法变成小块，后面补一个空格；`continues` 为真的项不补空格，插入后仍构成触发时按新的查询继续。菜单开着时 `resolveMenu` 换成新函数，按当前查询重新取。菜单是 nb-ui 的候选菜单（`SuggestionMenu`）：与外框同宽，按 `menuPlacement` 固定在外框上方或下方，可用高度不够时收矮；项超过 8 个时截在第 9 项中间、内部滚动；加载中已有项照常显示，底部一行加载提示；没有按键提示。
6. **小块的编辑**：光标一次跨过一整枚；紧挨光标时退格或 Delete 删除整枚；复制得到原文。Home、End 到屏幕行的行首行尾，按住 Shift 同时选中。选区覆盖的小块与粘贴块显示为选中。点击小块或附件条的卡片发出 `token-activate`。删除图片或文件小块时附件条里的卡片一起消失，反过来也一样；悬停或聚焦卡片时正文里同号的小块高亮，反过来也一样。
7. **粘贴分档**：普通粘贴只取纯文本，按 `pastePolicy` 分三档：小的原样插入；中的在粘贴处成为粘贴块（`blockPlacement` 为 `"start"` 时放到正文开头、命令那一行之后，粘贴处留位置标记）；大的在 `acceptFiles` 为真时转为文件附件（`paste-N.txt`，发出 `attachment-add`），否则按中处理。内容里有恰好是 `</paste>` 的一行时按大处理，`acceptFiles` 为假时按普通文字插入。Ctrl/⌘+Shift+V 全部按普通文字插入。从本组件复制再粘贴回来保留结构，带编号的副本换成新编号。剪贴板或拖入的文件按 `acceptImages`、`acceptFiles` 接受（发出 `attachment-add`）或拒绝（发出 `attachment-reject`）。
8. **粘贴块**：收起时只显示前 3 行；展开后可以就地编辑，编辑进撤销历史，连续输入合并成一步。“转为文字”把整块换成同样内容的普通文字；“删除”连同位置标记一起删除。粘贴块与它的位置标记成对：删掉其中一个，另一个一起删掉。在粘贴块下一行的行首按退格，删掉整个粘贴块。
9. **附件状态**：新加入的附件由组件生成 `localId`，状态按 `attachments` 里同一 `localId` 的项显示：上传中、失败（点“重试”发出 `attachment-retry`）、就绪。就绪后小块写回 `![image #N](目标)` 或 `[file #N · 文件名](目标)` 并发出一次 `change`；就绪前附件不在文字里。未就绪的附件从正文消失时发出一次 `attachment-remove`；撤销把它带回来时换新的 `localId` 并重新发出 `attachment-add`。
10. **输入历史**：正文为空、或仍是刚调出且未改动的那一条时，光标在第一行按上方向键调出更早的一条，在最后一行按下方向键调出较新的一条，越过最新一条回到空正文；一旦编辑就不再处于翻看状态。Ctrl+R 打开输入历史搜索：输入文字过滤，方向键选择，回车替换正文并把焦点移回正文，Escape 关闭且正文不变。
11. **只读**：不能编辑（包括粘贴块的内容）、粘贴、拖入，不开菜单、不翻看输入历史；可以选中与复制；附件条与粘贴块的按钮只剩“展开”。
12. **界面语言**：按钮、提示与说明按界面语言显示：宿主注入了翻译端口时按端口的语言，没有注入时按 `locale`（见“边界与兼容”）；语言变了随即换成新的文字，正文不变。
13. **可访问性**：正文区是 `role="textbox"`、`aria-multiline="true"`，可访问名称取 `ariaLabel`，为空时取 `placeholder`；菜单开着时正文区带 `aria-expanded`、`aria-controls`、`aria-activedescendant`；菜单是 `role="listbox"`，每项 `role="option"`，禁用项带 `aria-disabled`、没有选项 id；`aria-activedescendant` 指向的就是高亮的那一项（id 由 nb-ui 的 `suggestionOptionId` 按可选项的顺序给出）。输入历史开着时，搜索框是 `role="combobox"`，带同样的 `aria-controls`、`aria-activedescendant`；附件卡片与粘贴块的按钮都有可访问名称，失败原因写在卡片的可访问描述里。
14. **静态显示**：`PromptTextView` 按同一套文字写法显示已发送的文字：小块与编辑组件里的一样，粘贴块默认折叠，附件进附件条；小块可聚焦，回车或空格发出 `token-activate`。

## 状态与转换

- **草稿**：只在版本号变化时读入；同一版本里 `text` 的变化是组件自己上报的回声，不读入。
- **菜单**：关、开（加载中、有结果、没有结果）。
- **附件**：上传中 → 就绪或失败；失败 → 重试 → 上传中。

时序与寿命：

- `attachments` 要覆盖组件发出过的每个 `localId`，直到它就绪或收到 `attachment-remove`；缺了的项按上传中显示。
- 编号只在一次编辑里稳定：重新读入时没有编号的图片按顺序补号，删掉的号留下的空缺不填、不重排。

## 副作用与数据

不写任何数据；文字、附件与历史的持久化归宿主。

## 失败与恢复

| 情形 | 表现 |
|---|---|
| 附件上传失败 | 卡片用危险色，带“重试”与“移除”；失败原因在可访问描述与悬停提示里 |
| 不接受的文件 | 发出 `attachment-reject`，说明由宿主负责 |
| 菜单的数据还没到 | 显示“正在加载”，已有的项照常显示 |

## 边界与兼容

- 公开接口：两个组件的属性、事件与命令面（`focus`、`insertText`、`insertFiles`）。
- 文字写法是与宿主、服务端共用的数据格式：改写法要保证旧文字照常读入、原样写回。旧应用写出的引用目标（`chapter://` 等领域地址）照常是引用小块的原文，按目标分类归为“其它”。
- 编辑内核是 Tiptap（ProseMirror）。撤销重做、输入法、选区与光标移动、拼写检查来自上游，不作承诺；按键与粘贴行为只在 Chromium 上验证。
- 界面文字在 nb-markdown 自带的消息目录里（命名空间 `nb-markdown`，源语言 zh-CN，经 `@notnotype/nb-markdown/locales` 导出），按[界面语言与消息目录](i18n.md)显示：宿主注入了翻译端口时登记这份目录，语言以端口为准，`locale` 属性不起作用；没有注入时两个组件按 `locale`（缺省 zh-CN）用缺省端口，单独挂载的零件用中文。

## 验收与 Smoke

1. Given 一段含引用、技能、开头命令、图片、文件、粘贴块与位置标记的文字，When 读入后不编辑，Then 写回逐字符相同；When 删掉位置标记，Then 粘贴块一起消失，写回的文字里两者都没有。
2. Given 中等长度的一段粘贴且 `blockPlacement` 为 `"start"`、正文开头是命令，When 粘贴，Then 粘贴块在命令那一行之后，粘贴处是位置标记。
3. Given 一个上传中的图片，When 宿主把它标为就绪，Then 文字里出现 `![image #1](session://attachments/…)` 并发出一次 `change`；When 退格删掉它再撤销，Then 发出新 `localId` 的 `attachment-add`。
4. Given `@` 菜单列出作品里的 `设定/林雪.md`，When 确认，Then 文字是 `[林雪](/设定/林雪.md)`，显示为引用小块。
5. Given 界面语言从中文换成英文，When 组件挂着，Then 粘贴块与附件条的按钮文字换成英文，正文与撤销历史不变。

Smoke：`packages/nb-markdown/src/prompt/` 下的 `prompt-text.test.ts`、`prompt-editor-extensions.dom.test.ts`、`PromptEditor.dom.test.ts`、`PromptTextView.dom.test.ts` 运行场景 1–5 与各输出条目；Lab 场景 `PromptEditor` 另在本机 Chrome 上由 `packages/neuro-book/e2e/lab-markdown.e2e.ts` 运行真实按键与粘贴的一组。

## 实现合同

- 公开入口：`@notnotype/nb-markdown/prompt` 的 `PromptEditor` 与 `PromptTextView`，属性、事件与命令面见组件文档；引用小块的目标分类与文件图标来自祖先提供的宿主（`@notnotype/nb-markdown/host`），不提供时只认外部链接。宿主拼 `@` 菜单的插入文字用 `promptReferenceText(名称, 地址, 目标分类)`，文件地址按宿主的 `encodeFile` 编码。neuro-book 里是服务 `markdownKey` 交出的 `components.PromptEditor` 与 `components.PromptTextView`。
- owner 与依赖方向：nb-markdown 拥有。小块的外观用 `InlineChip`，引用的目标分类来自宿主，与 Markdown 编辑器、展示器用同一份（[workspace.markdown-dialect](../workspace/markdown-dialect.md) 输出 27）；链接的词法与编解码器写地址的函数共用一份。不用方言与语言，不依赖编辑器区。
- 不变量：
  - 读入的文字不编辑写回逐字符相同（`prompt-text.test.ts` 的读入与写回一组、`PromptEditor.dom.test.ts` 的场景 1）；
  - 识别的先后：命令与粘贴块先找出并遮住，再找选区与链接，重叠时起点早的胜；跨行的、代码片段与围栏代码块里的写法都是文字（`prompt-text.test.ts` 的链接与代码一组）；
  - 链接的词法与编解码器的 `marked` 读出相同的文字与目标（同一组的对照表）；
  - 识别是线性的：没闭合的方括号、反引号与引号很多的 12 万字仍在限时内（同一组的线性一例）。

## 证据

- 批准依据：开发者 2026-10-16 的决定，记录在主工作区 master 的 `.agents/works/w00025-editor/tasks/t07-markdown-plugins/README.md`（“开发者的决定”2、4、6）与同目录的 `plan.md`；行为来自 w00019 t07 经开发者 2026-09-30 逐条确认的 `PromptEditor` 需求（分支 `archive/legacy-ui-tuning`，提交 `865c9f593`）。
- 实现入口：[`PromptEditor.vue`](../../../packages/nb-markdown/src/prompt/PromptEditor.vue)、[`PromptTextView.vue`](../../../packages/nb-markdown/src/prompt/PromptTextView.vue)、[`prompt-text.ts`](../../../packages/nb-markdown/src/prompt/prompt-text.ts)（文字写法的读写）、[`prompt-selection.ts`](../../../packages/nb-markdown/src/prompt/prompt-selection.ts)（选区写法）、[`prompt-editor-extensions.ts`](../../../packages/nb-markdown/src/prompt/prompt-editor-extensions.ts)（节点、按键与菜单）、[nb-markdown 的 `link-syntax.ts`](../../../packages/nb-markdown/src/link-syntax.ts)（链接的词法）
- 合同测试：[`prompt-text.test.ts`](../../../packages/nb-markdown/src/prompt/prompt-text.test.ts)、[`prompt-editor-extensions.dom.test.ts`](../../../packages/nb-markdown/src/prompt/prompt-editor-extensions.dom.test.ts)、[`PromptEditor.dom.test.ts`](../../../packages/nb-markdown/src/prompt/PromptEditor.dom.test.ts)（场景 1–5）、[`PromptTextView.dom.test.ts`](../../../packages/nb-markdown/src/prompt/PromptTextView.dom.test.ts)（输出 14）、neuro-book 的 [`prompt-reference.dom.test.ts`](../../../packages/neuro-book/src/plugins/markdown/web/prompt-reference.dom.test.ts)（场景 4 按作品文件的分类往返）、[`MarkdownHosted.dom.test.ts`](../../../packages/neuro-book/src/plugins/markdown/web/components/MarkdownHosted.dom.test.ts)（作品文件的分类经宿主到达 PromptTextView）
- Smoke：[`lab-markdown.e2e.ts`](../../../packages/neuro-book/e2e/lab-markdown.e2e.ts)（Lab 场景 `PromptEditor` 的真实按键与粘贴分档；候选菜单的位置、宽度、跳过禁用项、Tab 确认、加载、输入历史与英文界面，即输出 5、10、12、13，本机 Chrome）
