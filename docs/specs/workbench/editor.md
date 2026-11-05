---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: workbench.editor
owners:
  - nbook.editor
---

# 编辑器区

## 目标与非目标

主页面的编辑器区：插件 `nbook.editor` 把打开的文件放进编辑组与标签，持有每份打开文件的权威正文与磁盘基线，按文件类型选编辑器（自带 Markdown 富文本与源码编辑器，别的插件经贡献点加编辑器与语言），按基线保存并处理冲突与外部修改；资源管理器复制、移动、删除前经它结算未保存的修改；页面因服务端重启或项目关闭进入终态时，未保存的正文仍可取回。

不承诺：

- 把标签拖出窗口；拖动时按 Ctrl 复制标签；资源管理器拖到编辑区边缘拆分（只打开到那一组，输出 35）；固定标签的紧凑样式；标签条的滚动按钮。
- 自动保存；未保存的修改跨页面刷新保留。
- Markdown 富文本里的批注侧栏、Agent 与 AI 引用、工作区引用标签、frontmatter 面板（这些语法在正文里原样保留，见输出 19）。工具栏、选区菜单、斜杠菜单、块按钮与正文右键见 [`workbench.markdown-editing`](markdown-editing.md)。
- 差异比较界面；跨文件撤销；同一文档在两个组里共享撤销历史。
- 预读；`project://`、`user://` 之外的方案。
- [files-explorer 的性能标准](files-explorer.md#打开与切换)在参考机器上的测量另行交付；本 Spec 只规定结构上的保证（输出 7、10）。
- 语言智能（补全、跳转、诊断，即 LSP）；TextMate 语法（语言贡献的 `format` 这期只有 `monarch`）；非 UTF-8 文本的编码转换；PDF、音视频、字体的查看。
- 第三方插件使用 `editor.editors`、`editor.languages` 两个贡献点的公开说明与例子：合同写在本 Spec，这期只有内置插件使用。

## 术语与参与者

- **文档**：一份打开文件在本窗口里的权威正文、磁盘基线与状态，按资源地址唯一；同一文件在几个组里打开也只有一份文档。
- **磁盘基线**：沿 [workspace.files](../workspace/files.md#读取与保存)，读取或保存时确认的内容哈希。
- **dirty**：文档正文与它的基线对应的正文不同。
- **编辑组**：编辑器区里一个有自己标签条与内容区的窗格；组按 grid 排列。
- **标签**：文档在一个组里的打开实例，记着用哪种编辑器；`preview` 标签会被同组下一次 preview 打开替换，`permanent` 不会。
- **视图**：标签在内容区里的编辑器实例，有自己的光标、滚动与撤销历史；同组同种编辑器共用一个控件，切换文档时换内容与视图状态。
- **输入回执**：视图把输入交给文档时带上它看到的正文修订；修订已过期且内容不同时，这份输入不进入正文，成为**未裁决输入**，留在产生它的视图里等用户裁决。
- **磁盘冲突**：保存时磁盘基线已经不是文档的基线。
- **编辑器**：一种打开文件的方式，由贡献点 `editor.editors` 登记（输出 36）；它的贡献 id 就是**编辑器 id**，记在标签上。内置的两个是 `nbook.editor.markdown`（Markdown 富文本）与 `nbook.editor.code`（源码编辑器，也是默认的文本编辑器）。
- **preview 标签**与**预览编辑器**：前者是第 1 条单击打开、会被下一次单击替换的标签；后者是声明了 `role: "preview"` 的编辑器（例如 HTML 预览），它打开的标签叫**预览视图**。两个词不混用。
- **文件条目**：文档模型里一个地址的一份记录，承担这个文件在本窗口里的生命周期（改名、删除、外部变化）。读文本的标签持有它的**文本引用**，正文与基线只在有文本引用时读取；按字节显示的标签（`input: "bytes"` 的编辑器，例如图片查看器）只持有**字节引用**，不读正文。上文的“文档”是有文本引用的文件条目。
- **语言**：源码编辑器给文本着色与提供编辑规则的方式，由贡献点 `editor.languages` 登记（输出 43）；贡献 id 是语言 id。
- **文档身份**：`{workspaceKey, generation, documentId, path}`，沿[命令目录](commands.md)`nbook.editor.go-to-line` 的四字段；改名只换 `path`，项目换代换 `generation`。

## 输入与前置条件

- 插件 `nbook.editor` 只有浏览器入口；依赖 `nbook.files` 的文件客户端、命令服务、Storage、窗口的项目绑定、配置、宿主时钟与宿主的抢救能力（[runtime.browser-host](../runtime/browser-host.md)）。
- 编辑器槽：工作台的贡献点 `workbench.editor-area`（[ui.workbench-shell](../ui/workbench-shell.md)）。
- 打开：命令 `nbook.editor.open {address, mode: "preview" | "permanent", editor?: string, reveal?: "end", group?: string}`；`editor` 是编辑器 id，缺省按输出 37 的顺序选；`reveal: "end"` 打开后把光标放到末尾（输出 29）；`group` 见输出 35。
- 页面贡献点 `editor.pages`（输出 33，只接受浏览器入口）：声明 `{title, icon, openOnFirstVisit?}`，实现 `{load(): Promise<Component>}`，组件收到 `{context: {recent}}`（`recent` 是输出 31 的最近打开）。页面 id 的规则与视图相同。
- 编辑器贡献点 `editor.editors`（输出 36–41，只接受浏览器入口）：
  - 声明 `{title, selector?: {extensions?: string[], filenames?: string[]}, priority: "default" | "option", input: "text" | "bytes", role?: "preview", cursor?: "offset" | "line"}`。`extensions` 写不带点的小写后缀，可以多段（`d.ts`）；`filenames` 写完整文件名。`cursor` 是这种编辑器记光标的写法（输出 30），没有就不记。
  - 实现 `{load(): Promise<Component>}`；组件按下面的控件合同接收绑定。
  - 编辑器 id 的规则与页面 id 相同。
- 语言贡献点 `editor.languages`（输出 43–45，只接受浏览器入口）：声明 `{aliases: string[], extensions?: string[], filenames?: string[], firstLine?: string, mimetypes?: string[]}`，与 Monaco 的语言登记同一套字段：`aliases` 至少一个，第一个是显示的名字，全部（不分大小写）也是 Markdown 代码块这类按名字找语言时认的名字；`extensions` 与 `editor.editors` 的写法相同（不带点、小写）；`firstLine` 是匹配首行的正则；`mimetypes` 是 HTML 的 `<script type>` 这类按类型嵌入时认的类型。实现 `{load(): Promise<{format: "monarch", language, configuration}>}`，`language` 是 Monarch 分词规则，`configuration` 是括号、注释、自动闭合与缩进规则。语言 id 以小写字母开头，只用小写字母、数字与 `.`、`-`、`_`，不要求带插件前缀：语言 id 是跨编辑器共用的名字（例如 `python`），与 Monaco 和 VS Code 一致。`plaintext`（纯文本）与 `json` 由源码编辑器自带，不接受贡献；同一 id 被两个插件登记时两条都被拒（[runtime.plugins](../runtime/plugins.md) 的 `duplicate-contribution`）。
- 控件合同（类型在 `editor/shared/contracts.ts`，供编辑器的实现组件使用）：

  ```ts
  /** 文本编辑器（input: "text"）收到的绑定：文档的只读视图加输入回执。 */
  interface TextEditorBinding {
      readonly kind: "text";
      readonly token: string;
      readonly tabId: string;
      readonly editor: string;
      /** 改名后随之变化。 */
      readonly address: Readonly<Ref<string>>;
      readonly text: Readonly<Ref<string>>;
      readonly revision: Readonly<Ref<number>>;
      commit(baseRevision: number, text: string): {status: "accepted" | "conflict"; revision: number} | {status: "stale"};
      attach(flush: () => void): () => void;
      unresolved(): boolean;
      readonly cursor: {offset: number} | {line: number; column: number} | null;
      remember(cursor: {offset: number} | {line: number; column: number}): void;
      /** 标签记下的语言（输出 45）；换语言不换绑定。 */
      readonly language: Readonly<Ref<string | null>>;
      readonly slot: ViewStateSlot;
  }
  /** 字节编辑器（input: "bytes"）收到的绑定：`url` 读文件字节，`version` 在文件每次变化时加一。 */
  interface BytesEditorBinding {
      readonly kind: "bytes";
      readonly token: string;
      readonly tabId: string;
      readonly editor: string;
      readonly address: Readonly<Ref<string>>;
      readonly url: string;
      readonly version: Readonly<Ref<number>>;
      readonly slot: ViewStateSlot;
  }
  ```

  能不能输入由组件属性 `readonly` 给出（输出 48 的预览视图、只读文档为真）。组件属性为 `{binding, host, readonly, visible, label, locale}`（`locale` 是界面语言，控件自己显示的说明按它取），事件为 `ready(handle | null)`、`focus(boolean)`；句柄在现有的聚焦、撤销、重做、结算、行号导航之外，可以交出 `status: Readonly<Ref<LocalizedText | null>>`，由状态栏的编辑器状态条目显示（输出 42）；分语言的控件（源码编辑器）交出 `language: Readonly<Ref<string | null>>`，即视图此刻用的语言 id（标签记着的，或识别出的），由语言条目显示（输出 45）。提供编辑动作的控件（Markdown 富文本）交出 `editing`（[`workbench.markdown-editing`](markdown-editing.md)）。按标题组织的控件（Markdown 富文本）交出 `outline: Readonly<Ref<{binding: string; version: number; items: ReadonlyArray<{id: string; level: number; text: string}>; current: string | null} | null>>` 与 `revealHeading(binding, version, id): "ok" | "stale"`，供面包屑（输出 60）使用：`binding` 是当前绑定的 `token`，正文每变一次 `version` 加一，`id` 按位置区分同名标题；换绑定、没有绑定、卸载时同步为 `null`；`binding` 或 `version` 对不上为 `stale`，不移动光标。
- 地址参数：`/?project=<短名>&open=<地址>&at=end`，书架页的“继续写作”用它跨页传递打开目标（输出 29）。
- 命令（`editor` 域；参数为 `{}` 的作用于活动编辑组的活动标签）：

  | 命令 | 参数 | `when` | `effect` | agent 暴露 | 编辑器区内的键位 |
  |---|---|---|---|---|---|
  | `nbook.editor.open` | 见上 | 无 | read | auto | — |
  | `nbook.editor.open-page` | `{id}`（页面贡献的 id） | 无 | read | auto（不进命令面板） | — |
  | `nbook.editor.save` | `{}` | `dirty` | write | confirm | Ctrl+S |
  | `nbook.editor.save-all` | `{}` | 无 | write | confirm | — |
  | `nbook.editor.revert` | `{}` | `active` | write | never | — |
  | `nbook.editor.close` | `{tabId?}` | `active` | read | auto | Ctrl+W |
  | `nbook.editor.close-others` | `{tabId?}` | `active` | read | auto | — |
  | `nbook.editor.close-to-right` | `{tabId?}` | `active` | read | auto | — |
  | `nbook.editor.close-saved` | `{tabId?}` | `active` | read | auto | — |
  | `nbook.editor.pin-tab` | `{tabId?}` | `active` | read | auto | — |
  | `nbook.editor.unpin-tab` | `{tabId?}` | `active` | read | auto | — |
  | `nbook.editor.copy-path` | `{tabId?}` | `active` | read | never | — |
  | `nbook.editor.copy-relative-path` | `{tabId?}` | `active` | read | never | — |
  | `nbook.editor.split-right` | `{tabId?}` | `active` | read | auto | Ctrl+\\ |
  | `nbook.editor.split-down` | `{tabId?}` | `active` | read | auto | — |
  | `nbook.editor.focus-breadcrumbs` | `{}` | `active` | read | never | — |
  | `nbook.editor.reopen-with` | `{editor?}`（不给时弹出选择，输出 39） | `active` | read | auto | — |
  | `nbook.editor.open-preview` | `{side?: boolean}` | `hasPreview` | read | auto | — |
  | `nbook.editor.change-language` | `{language?}`（不给时弹出选择，输出 45） | `hasLanguage` | read | auto | — |

  `tabId` 是要作用的标签，缺省为活动组的活动标签；标签不存在为 `unavailable`。`when` 仍按活动标签求值（命令面板、快捷键与 Agent 用）；标签右键菜单里编辑器自己的项不经命令的 `when`，按被右击的标签判断（输出 57）。`close-others`、`close-to-right`、`close-saved` 作用于目标标签所在的组（输出 51）。`when` 列写 `nbook.editor/` 下的公开键名。`revert` 丢弃未保存修改，对 Agent 不开放。键位只在编辑器区有焦点时由编辑器区处理并执行同一命令，不写成全局键位，`when` 也不含焦点：命令面板取得焦点时这些命令仍可选。第一批的 `nbook.editor.focus`、`nbook.edit.undo`、`nbook.edit.redo`、`nbook.editor.go-to-line` 由本插件登记，`when` 改用下面的公开键，其余声明不变。
- 公开状态（布尔）：`nbook.editor/focused`（编辑区获得焦点）、`nbook.editor/active`（有活动视图）、`nbook.editor/writable`（活动视图可写）、`nbook.editor/lineNavigation`（活动视图支持行导航）、`nbook.editor/dirty`（活动文档 dirty）、`nbook.editor/hasUnsavedDocuments`（本窗口有任一打开的文档需要保存，按文档去重）、`nbook.editor/hasCursorPosition`（活动控件给出光标位置）、`nbook.editor/ready`（编辑器区已建好：绑定项目的窗口读完会话记录之后），前四个对应命令目录第一批的 `editor-focus`、`editor-active`、`editor-writable`、`editor-line-navigation`。公开状态（字符串）：`nbook.editor/activeDocument`（活动组的活动标签的地址，文档还没读到也有；没有时为空串），资源管理器在打开作品时据此揭示活动文件（[workbench.files-explorer](files-explorer.md)）。`nbook.editor/active` 是“活动组有活动的文件标签且它的控件交出了句柄”，不要求文本文档；字符串 `nbook.editor/activeEditor` 是活动标签的编辑器 id（页面标签或空组为空串）；另有布尔 `nbook.editor/hasPreview`（活动标签的文件有可用的预览编辑器，且活动标签本身不是预览视图）、`nbook.editor/hasDocument`（活动标签有文本文档；字节标签与页面为假）、`nbook.editor/hasEditorStatus`（活动控件交出了一行状态，输出 42）、`nbook.editor/hasLanguage`（活动控件交出了语言，即活动视图是源码编辑器，输出 45）；`nbook.editor/writable` 是活动视图能输入（预览视图为假，输出 48）。
- 文档协调服务 `documentCoordinatorKey`（`nbook.editor` 的共享合同），资源管理器作为可选依赖使用：

  ```ts
  interface DocumentCoordinator {
      /** 地址本身或其后代里需要结算的文档。 */
      affected(addresses: ReadonlyArray<string>): ReadonlyArray<{address: string; state: "dirty" | "saving" | "unresolved" | "conflict"}>;
      /** 结算这些文档的视图输入、等在途保存，然后挡住它们的新保存直到 end；有未裁决输入或磁盘冲突时为 blocked。 */
      begin(addresses: ReadonlyArray<string>): Promise<{ok: true; lease: Lease} | {ok: false; reason: "blocked"; documents: ReadonlyArray<string>}>;
      /** 保存这些地址下的 dirty 文档，逐项结果。 */
      save(addresses: ReadonlyArray<string>): Promise<ReadonlyArray<{address: string; ok: boolean; code?: string}>>;
      /** 本窗口的保存形成了从 token 起的身份链时返回链尾的令牌，否则原样返回。 */
      translate(address: string, token: string): string;
      /** 用户确认删除并删除成功后：关闭这些地址及其后代的标签、丢弃正文。 */
      close(addresses: ReadonlyArray<string>): void;
  }
  interface Lease {
      /** moved 给出成功项的实际目标，文档随之改地址；unknown 时租约保持，直到再次 end。 */
      end(result: {kind: "done"; moved?: ReadonlyArray<{from: string; to: string}>} | {kind: "unknown"}): void;
  }
  ```

## 输出与可观察行为

**编辑组与标签**

1. 单击打开（`preview`）替换本组已有的 preview 标签；目标已在本组打开时只激活它。“已在本组打开”按地址加编辑器判断：不指定编辑器的打开，本组有这个地址、编辑器不是预览编辑器的标签（不论是不是 preview 标签）就激活它；指定了编辑器时找地址与编辑器都相同的标签。所以同一组里一个文件的源码标签与它的预览视图可以并存。`permanent` 打开、在标签里编辑或双击标签都把 preview 转为 permanent。
2. 打开在活动组进行；活动组是最近获得焦点或执行过打开的组。拆分在活动组右侧或下方新建组、打开同一文档，新组成为活动组；两个组的视图共用一份文档，各有自己的撤销历史。组与组之间是 1px 的分隔线，拖动它（或聚焦后用方向键）调整两边的大小，规则同 nb-layout 的 grid（[ui.nested-grid](../ui/nested-grid.md)）；编辑组至少 220×120px，调整后的尺寸随第 5 条的会话记录保存。
3. 关闭标签后同组激活它右侧的标签（没有时左侧）；组里最后一个标签关闭且还有别的组时，组随之关闭，焦点到相邻组。
4. 关闭文档的最后一个标签时，文档 dirty 或有未裁决输入就询问“保存 / 不保存 / 取消”，默认在取消；文档仍在别的组打开时不问。preview 打开不会换掉这样的标签：本组的 preview 标签是要结算的文档最后一个能编辑的标签时（例如别处改过的正式标签关掉时因为还有它而没问），它先转为 permanent，新文件另开 preview 标签，不询问也不丢修改。“仍在别处打开”只算可编辑的标签：剩下的只有预览视图或只读的编辑器时照常询问，选“不保存”时修改丢掉，这些视图回到磁盘上的内容。预览视图显示 dirty 圆点，在它上面可以保存。
5. 绑定项目的窗口把组的布局、每组的标签（地址、编辑器、preview、固定）与活动项存进 project/local 记录 `editor.session`，不存正文；重新打开时按记录恢复，标签先出现，正文按打开流程读取。读不到的标签显示原因，不静默删除。未绑定项目的窗口只在内存里。

**打开与切换**

6. 点击后同一帧切换活动标签；目标文档没就绪时内容区空白，800 毫秒后仍未就绪才在组顶部显示进度条（[files-explorer 打开与切换](files-explorer.md#打开与切换)）；不显示旧文件的正文。
7. 打开成功以正确正文可编辑为完成点；读取失败在内容区显示原因与重试，不显示空白编辑器。已打开、视图状态还在的文档切回不读磁盘，控件不重建。
8. 快速连续打开时只有最后一次意图生效；先发出的读取迟到不改变活动标签与焦点。
9. 换文档前先结算旧视图的输入；旧视图有未裁决输入时不换，提示先裁决。
10. 切回已打开的文档恢复它在该组的光标、滚动与撤销历史：A 中输入、切到 B 输入、回到 A，撤销与重做只作用于 A 的输入。

**文档与保存**

11. 同一地址并发打开只读一次。读取在该方案的变更订阅就绪之后才发出；读取在途时该文件有变化，结果回来后再读一次。
12. 同一文档在几个组里的视图共用正文：一个视图的输入被接受后其它视图随之更新，更新不进入它们的撤销历史。
13. 两个视图基于同一修订输入了不同内容时，后到的成为未裁决输入：所在组顶部给出“采用当前正文”（丢弃这份输入）与“保留本视图的内容”（以最新修订重新提交，再冲突仍保留）。未裁决输入阻止该文档的保存，并计入第 4、21 条的询问。
14. 保存以开始时的正文与基线为快照，同一文档的保存排队、不并发；成功后基线推进到快照，保存期间的新输入保持 dirty（[files 验收 4](../workspace/files.md#验收与-smoke)）。保存失败保持 dirty 并说明；结果未知时重读磁盘：哈希等于快照即为已保存，否则保持 dirty 并说明。
15. 保存遇磁盘冲突时，组顶部给出“重新载入磁盘版本”（丢弃修改）与“覆盖磁盘版本”（以冲突带回的当前基线写入）；冲突未处理前普通保存不发出写入。
16. 文件有变化时（含本插件自己的保存产生的事件）读一次核对：读到的内容等于本窗口已提交或正在提交的正文时不更新视图；否则文档不 dirty 就用读到的正文更新视图，dirty 就只标“磁盘已变化”，下一次保存得到磁盘冲突。
17. 改名或移动（`renamed` 事件，或资源管理器的移动成功）把地址本身及其后代的文档与标签改到新地址，正文、dirty、未裁决输入与视图状态保留，文档身份的 `path` 随之改变。
18. 被其它来源删除（`deleted` 事件）的文档标“已删除”并只读，正文保留；dirty 的“保存”在原路径排他新建空文件后写入，原路径已被占用时说明冲突并保持 dirty；“关闭”丢弃。`resync` 时对全部打开文档按第 11、16 条核对；订阅 `ended` 时该方案下的文档不可保存，组顶部说明原因。正文超过文件服务上限时打开失败并说明 `too-large`。

**编辑器**

19. `.md` 缺省用 Markdown 富文本编辑器（输出 37 的选择顺序里，它是 `.md`、`.markdown` 的默认编辑器）。打开后不编辑，切走、关闭或保存都不改变磁盘字节。读写规则由 [workspace.markdown-dialect](../workspace/markdown-dialect.md) 规定：未编辑的块字节不变（含换行符、列表标记、方言写法），被编辑的块按原写法写出且必须读得回来；写不出读得回来的内容时进入输出 61 的写不出状态。frontmatter 不进入富文本，原样保留；工作区与领域链接按普通链接保留源码。Markdown 控件由 `nbook.markdown` 的服务交出，编辑器区把它当内置编辑器直接持有。生效的方言由 `nbook.markdown` 决定（[workspace.markdown-syntaxes](../workspace/markdown-syntaxes.md)）：一个 Markdown 编辑器实例在建立时取定语言，整个寿命都用这一份；之后建立的实例用当时的语言。作品里的文件链接显示为引用小块、图片按作品里的文件显示（[workspace.markdown-dialect](../workspace/markdown-dialect.md) 输出 18、27），写回的源码不变。
20. 其余可编辑文本用源码编辑器；Markdown 也可以“用源码编辑器重新打开”，选择记在标签上（经输出 39 的“用其它编辑器重新打开”）。只读文档的视图不接受输入；撤销、重做、跳转到行按命令目录作用于活动视图。

**离开与终态**

21. 有 dirty、未裁决输入或在途保存的文档时离开或刷新页面，先结算视图输入，再请求浏览器的离开确认。
22. 页面转入服务端已重启、项目已关闭或版本不一致的终态页时，终态页列出本窗口未保存的正文（文件路径与可复制的文本，含未裁决输入）。

**资源管理器的结算**

23. 复制的源包含需要结算的文档时，在冻结源之前询问“先保存再复制 / 复制磁盘版本 / 取消”，默认在取消；先保存失败或冲突时不复制并说明。
24. 移动、拖动与改名提交前取得租约：视图输入结算、在途保存完成、新的保存排队；有未裁决输入或磁盘冲突的文档时不提交并说明。剪贴板或拖动冻结的源身份经 `translate` 换成本窗口保存后的身份：剪切后保存再粘贴照常移动，外部替换仍为 `source-changed`。成功项按第 17 条改地址，失败项不动；结果未知时租约保持，资源管理器核对或放弃后才释放。
25. 删除确认列出将丢失未保存修改的文档；删除成功的项关闭标签、丢弃正文（第 18 条只适用于其它来源的删除）。

**状态栏条目**

编辑器插件向 `workbench.statusbar-items` 贡献下面几个条目，都在右侧（[`ui.workbench-shell`](../ui/workbench-shell.md) 输出 33–35）：

| id | 文字 | `when` | 点击 | order | priority |
|---|---|---|---|---|---|
| `nbook.editor.unsaved` | 未保存 N 个 | `nbook.editor/hasUnsavedDocuments` | `nbook.editor.save-all` | 10 | 30 |
| `nbook.editor.word-count` | 活动文档的字数，例如“1,234 字” | `nbook.editor/active` 且 `nbook.editor/hasDocument` | 无 | 20 | 20 |
| `nbook.editor.editor-status` | 活动控件交出的一行状态，例如图片的尺寸 | `nbook.editor/hasEditorStatus` | 无 | 25 | 15 |
| `nbook.editor.language` | 活动视图的语言名，例如“Python” | `nbook.editor/hasLanguage` | `nbook.editor.change-language` | 28 | 12 |
| `nbook.editor.cursor` | 第 L 行，第 C 列 | `nbook.editor/hasCursorPosition` | 无 | 30 | 10 |

26. 未保存数按文档计（同一文件在几个组里打开只算一个），含非活动的文档；“需要保存”与第 4 条询问的判据相同（dirty、未裁决输入、写不出，输出 61）。提示列出至多 5 个文件；有文档正在保存时写“正在保存”；有保存失败的文档时条目为 `error` 状态，提示列出失败的文件与原因。点击执行全部保存。
27. 字数取活动文档当前正文：汉字、假名、谚文每字计 1，连续的拉丁字母与数字（中间可夹 `'`、`’`、`-`）计 1 个词，标点、空白与 Markdown 标记不计，开头的 YAML frontmatter 不计；Markdown 方言的标签与属性、原样内容不计，规则与已知偏差见 [workspace.markdown-dialect](../workspace/markdown-dialect.md) 的“副作用与数据”；方言的字数规则来自它们的声明（[workspace.markdown-syntaxes](../workspace/markdown-syntaxes.md) 输出 9）。打开或切换文档时立即显示它的字数；输入时停手 300ms 后更新，停手之前显示上一次的值（全文计数随正文变长，不在每次按键时算）。书架的作品统计用同一套算法（[`runtime.projects`](../runtime/projects.md)）。
28. 光标位置只由源码编辑器给出：选区活动端的行号与列号，都从 1 起，列按源码编辑器的列计（制表符计 1）。Markdown 富文本编辑器不给出位置：富文本里的段落位置与源文件的行号不同（frontmatter 与写出时的格式都会改变行数），条目在它活动时不显示。控件换文档或卸载时位置随之撤回。

**继续写作**（随书架页实现）

29. `nbook.editor.open` 的 `reveal: "end"` 与地址参数 `open`、`at=end` 走同一条路径（[workbench.bookshelf](bookshelf.md) 的“继续写作”）：
    - 地址参数一读到就以 `replace` 去掉 `open` 与 `at`：刷新不重复定位，失败也不反复出现。地址必须是 `project://` 下的资源，否则只在组顶部提示、不打开。
    - 等编辑器区建好（会话记录读完）后以 `permanent` 打开该地址（`open` 成功时给出标签 id），记下这个标签；等到它的文档就绪、它所在组的控件交出句柄，再调控件的 `revealEnd()`：源码编辑器把光标放到最后一行行尾，Markdown 编辑器把选区放到文档末尾，并聚焦。
    - 这是一个可取消的过程：等待期间用户切到别的标签或组、标签关闭、焦点移到编辑器区之外、窗口停止，都取消；迟到的就绪不再移动光标与焦点，就绪后到定位那一刻之间切走的也不动。
    - 文档读取失败或文件不在：项目照常打开，组顶部提示“上次编辑的片段已不在原处”，不猜别的文件；控件不支持 `revealEnd` 时只打开文件。

**回到上次写的地方与纸面**

30. **上次的光标**：每个标签记下上次的光标，随第 5 条的会话记录保存：Markdown 富文本记文档里的位置，源码编辑器记行与列（都从 1 起）；别的编辑器按声明的 `cursor` 写法记，没有声明就不记。光标停下 1 秒、编辑器失焦或换文档时记下。恢复会话后，第一次为这份文档建视图时把光标放回记下的位置并滚到它；正文变短、记下的位置已不在时夹到末尾；编辑器种类换了（“用源码编辑器重新打开”）的标签丢掉记下的光标；拆分出的标签带着原标签的光标。恢复会话时等活动组的活动标签就绪、控件交出句柄后聚焦一次，可以直接接着写；在此之前用户切走、关掉标签或把焦点移到编辑器区之外就不聚焦（与第 29 条同一套取消规则）；读取失败时内容区说明原因，不另提示。第 29 条的继续写作优先：带 `open`、`at=end` 打开时定位到末尾。
31. **最近打开**：绑定项目的窗口把打开过的地址按最近在前存进 project/local 记录 `editor.recent`，至多 10 个，单击（preview）与双击都算；切换已打开的标签、恢复出来的标签不算。地址只在打开时记，改名与删除不回头改，读的一方（欢迎页）按需核对文件还在不在。
32. **纸面与空态**：编辑组是面板底色，卡片外壳里就是编辑区那张卡片，平铺时与外壳同一块底色（[`ui.workbench-shell`](../ui/workbench-shell.md) 输出 38）。Markdown 富文本用界面字体，版心 720px（含左右各 48px 留白）、上 64px 下 120px、正文 17px、行距 1.95、段距 1.1em；这些值是 Markdown 控件自己的变量，以后做成偏好时只换变量。源码编辑器不变。组里没有标签时内容区正中是一个淡色的图形标志（132px，组被拆得很矮时缩小），下面几行提示，像 VS Code 的空编辑区：“显示所有命令”写出命令面板的快捷键（从命令声明读，按平台写），“新建文件”“打开欢迎页”写出入口的位置（资源管理器标题行、帮助 › 欢迎）；每一行对应一条命令，命令不存在或此刻不可用时那一行不显示，点一行就执行它。

**页面**

33. **页面标签**：贡献点 `editor.pages` 登记不对应文件的页面（例如欢迎页）。`nbook.editor.open-page {id}` 打开它：窗口里已经开着就切过去（连同它所在的组），否则在活动组开一个正式标签；贡献方还没交付实现时为 `unavailable`。页面标签显示页面标题，内容区渲染页面组件；它没有文档：不读磁盘、不算 dirty、没有光标与字数，不能拆分、不能换编辑器，可以照常关闭。页面标签不进第 5 条的会话记录，刷新后不恢复（活动的是页面时，记录里的活动项是它左边最近的文件标签）。`nbook.editor.open` 不接受页面地址。声明 `openOnFirstVisit` 的页面在这部作品第一次在本窗口打开（会话记录读到“不存在”）时自动打开，晚交付的等交付后再开；带继续写作参数打开时不自动打开。贡献方停止后已开的页面标签说明“这个页面已经不在了”。页面组件加载期间，内容区是一句给读屏的“正在加载页面”（`role="status"`，这个容器带 `aria-busy="true"`）；加载失败时换成失败原因（`role="alert"`），不再带 `aria-busy`。
34. **编辑区标题**：活动编辑组的标签条右侧是标题动作（别的组不画：编辑器的命令与它们的可用性都按活动组算）：编辑器自己的“向右拆分”（按钮）与“用其它编辑器重新打开”（“⋯”里），之后是别的插件经贡献点 `editor.title` 贡献的项（共同规则见 [`workbench.menus`](menus.md)）。当前文件是这个组的活动标签：是文件时给出它的地址，`context: "resource"` 的项执行时收到 `{address}`；是页面标签或组里没有标签时没有当前文件。按钮（自己的加贡献来的）至多 4 个；编辑组窄时按它的宽度再少，给标签条至少留一个截断标签的宽度（96px），一个按钮也放不下时只剩“⋯”。放不下的按钮回到它所在的节收进“⋯”（编辑器自己的在自己那一节，贡献的在它原来的节）。另一个组成为活动组时，标题动作随之移到那个组；“⋯”打开期间活动组或活动标签变了，菜单关闭、之前的选择不执行。标签多时标签条照旧横向滚动，标题动作不随之滚动。

**打开到哪一组**

35. **指定编辑组**：`nbook.editor.open` 的 `group` 缺省在活动组打开；给编辑组的 id 时在那一组打开并让它成为活动组，id 不存在（组已关闭）为 `unavailable`；给 `"side"` 时在活动组右侧相邻的组打开，右侧没有组就先向右拆分出一个空组（不带走活动标签）再打开。编辑组按 [ui.layout-drag](../ui/layout-drag.md) 输出 16 登记落点 `EDITOR_GROUP_FILE`（`editor/shared/contracts.ts`）：别的插件拖动时用 `dropTargetAt` 查到组 id，放下时执行带 `group` 的 `open`（资源管理器的“拖到编辑区”，[workbench.files-explorer](files-explorer.md) 的“拖动”）；这个种类的名字与数据按公开接口处理。根元素上的 `data-editor-group` 只是样式与测试钩子，不是接口。

**编辑器贡献与选择**

36. **编辑器贡献**：编辑器区接受 `editor.editors` 的声明；内置的 `nbook.editor.markdown`（default，扩展名 `md`、`markdown`，`cursor: "offset"`）与 `nbook.editor.code`（没有 selector、`cursor: "line"`）也是这样声明的，但它们的组件由编辑器区直接持有，不等交付。
37. **选择顺序**：没有指定编辑器时，按顺序取第一个成立的：
    1. 文件的扩展名属于已知二进制扩展名（pdf、mp3、mp4、m4a、mov、webm、wav、flac、ogg、ttf、otf、woff、woff2、zip、gz、7z、rar、exe、dll、so、dylib），且没有编辑器的 selector 命中它：标签显示“不能在这里打开”，不读文件；
    2. `priority: "default"`、selector 命中的编辑器：`filenames` 命中优先于 `extensions`；扩展名取已登记的最长后缀；匹配不区分大小写；同一级有两个时按编辑器 id 的码元顺序取第一个，并记一条诊断；
    3. `nbook.editor.code`；它读到 `not-text` 时内容区写“这个文件不是 UTF-8 文本（可能是二进制文件或其它编码），不能在这里打开”，没有“重试”。

    选择只看已接受的声明，不看实现有没有交付，所以结果不随插件激活的先后变化。
38. **指定编辑器**：`open` 与 `reopen-with` 的 `editor` 必须是已接受声明的 id，否则为 `unavailable`；`input: "bytes"` 的编辑器只能打开 selector 命中的文件，`input: "text"` 的编辑器可以打开任何文本（否则为 `unavailable`）。
39. **用其它编辑器重新打开**：不带参数时经工作台的选择服务（[workbench.quick-open](quick-open.md) 的选择模式）列出候选，选中后换：候选是 selector 命中这个文件的全部编辑器（含 `option` 档与预览编辑器），加上 `nbook.editor.code`；当前的那个标“当前”。带参数时直接换。要换成的编辑器在本组已有同一地址的标签时，切到那个标签、关掉当前这个。换编辑器丢掉标签记下的光标与语言（输出 30、45）。从文本编辑器换成按字节显示的编辑器时，这个标签若是这份文档最后一个能编辑的标签、而文档 dirty 或有未裁决输入，则为 `unavailable`（先保存或放弃修改），不丢正文。
40. **编辑器的三种状态**：标签的编辑器声明不在、贡献方停止、或贡献方交付之前激活失败时，内容区写“这个编辑器已经不在了”并给出“用默认编辑器打开”（按输出 37 重选，不再选这个编辑器）；声明在、实现还没交付时内容区空白，800 毫秒后仍未交付才显示进度条（与输出 6 同一规则）；交付后渲染。会话恢复与继续写作时编辑器还没交付，标签照常恢复，等交付后渲染。
41. **字节标签**：`input: "bytes"` 的编辑器打开的标签只持有文件条目的字节引用，不读正文：它不 dirty、不可写、没有字数与光标位置；控件经绑定的 `url` 读文件（[workspace.files](../workspace/files.md) 的“按地址读取字节”），文件每次变化 `version` 加一、控件据此重新读。改名、移动、资源管理器的删除、其它来源的删除与文本标签同样处理（输出 17、18、24、25，删除后只有“关闭”）：同一组里改名后不会出现两个地址与编辑器都相同的标签。关闭、拆分、重新打开、聚焦照常可用。同一文件同时有文本标签时，文本引用照常读正文，两者互不影响；最后一个文本标签关闭后（需要结算的正文已按第 4 条结算）条目丢掉正文，只按字节。订阅第一次就绪时字节引用的 `version` 也加一：就绪之前的变化没有事件。
42. **编辑器状态条目**：状态栏右侧条目 `nbook.editor.editor-status`（`when: nbook.editor/hasEditorStatus`，order 25、priority 15）显示活动控件句柄交出的 `status`；没有交出或为 null 时不显示。图片查看器用它显示尺寸与大小（[workbench.image-viewer](image-viewer.md)）。

**语言**

43. **语言登记**：源码编辑器加载时一次登记全部已接受的 `editor.languages` 声明（id、别名、扩展名、文件名、首行、mimetypes），分词规则与编辑规则在第一次遇到这门语言时才加载，包括 HTML 里的 `<script>`、`<style>` 与 Markdown 代码块按名字或 mimetype 嵌入的语言。内置：`nbook.editor` 登记源码编辑器（Monaco）自带的全部 Monarch 语言；JSON 另有语言服务（校验与格式化）。
44. **选语言**：标签记着语言（输出 45）且它已登记时用它；否则按文件名、扩展名、首行识别，都不中为纯文本。记下的语言已不在时回退到识别，不改写记录。
45. **语言条目与切换**：状态栏右侧条目 `nbook.editor.language`（`when: nbook.editor/hasLanguage`，order 28、priority 12）显示当前语言的名字，点击执行 `nbook.editor.change-language`：经选择服务列出全部已登记的语言（纯文本与 JSON 在前，当前的标“当前”），选中后换当前视图的语言并记在标签上，随会话记录保存；选择期间活动标签换了为 `stale-target`，不改别的标签。带 `language` 参数时直接换，语言未登记为 `unavailable`。语言随拆分复制，换编辑器时丢弃。

**预览**

46. **打开预览**：`nbook.editor.open-preview` 对活动标签的文件，取 selector 命中、`role: "preview"` 的第一个编辑器，以 `permanent` 打开：`side` 为假时在当前组，为真时 `group: "side"`（输出 35）。本组已有它的预览视图时激活它。没有可用的预览编辑器为 `unavailable`。
47. **标题动作**：编辑器自己那一节在“向右拆分”之前加按钮“打开预览”（`when: hasPreview`），“⋯”里加“在侧边打开预览”；活动的是预览视图时两项都不出现。预览视图的标签标题写“预览 <文件名>”。
48. **预览视图绑定同一份文档**：预览编辑器是 `input: "text"`，收到与源码标签同一份文档的绑定、只读，所以没保存的修改也会显示；它进会话记录，刷新后恢复。

**标签栏、移动与面包屑**

49. **移动标签**：标签可以在组内换位置、移到别的组，或移到某个组的一边拆出新组（输出 55 的拖动与输出 57 的命令）。移动前先结算源组与目标组的活动视图；任一组有未裁决输入就不移动，组顶部给出与换文档相同的提示。移到别的组的视图在那一组按标签记下的光标恢复（输出 30），撤销历史从空开始（与拆分相同）；那一组以前为同一文档、同一编辑器留下的视图状态照常沿用。真实发生移动的 preview 标签转为 permanent，每组至多一个 preview 标签。源组空了随之关闭（输出 3）。目标组已有地址与编辑器都相同的标签时不再多开：激活那个标签，再按第 3、4 条关闭被移动的标签：共享的修改不问，只问被移动的视图自己的未裁决输入；用户取消时被移动的标签留在原处。移动后焦点在目标组的活动视图。
50. **固定标签**：标签可以固定（输出 57）。每组里固定标签排在前、普通标签在后；固定标签不是 preview，固定时转为 permanent 并排到固定标签的末尾，取消固定时排到普通标签的开头；页面标签不能固定。新打开的标签插在活动标签之后，但不插进固定标签之间（活动标签是固定的时插在普通标签开头）；preview 替换只找普通标签；Alt+←/→ 只在同一类标签里移动；拖动的落点跨过两类的分界时随之固定或取消固定。换编辑器保留固定（并到同组已有的同编辑器标签时，两者有一个固定就固定）；拆分出的标签不固定；改名保留固定；资源管理器删除与普通关闭照常关闭固定标签。固定记进会话记录（第 5 条），旧记录没有这一项时为不固定；记录里两类交错时按出现顺序把固定的排到前面，活动标签不变。
51. **批量关闭**：“关闭其他”“关闭右侧”“关闭已保存”作用于一个组：开始时定下要关的标签（跳过固定标签；“关闭已保存”先结算各视图的输入，再取不需要保存、没有未裁决输入、没有在途保存的标签），之后新开或移进来的标签不在其中。逐个按第 3、4 条关闭：已经不在这一组的跳过；用户在询问里取消、或选“保存”而保存失败时停下，已关的不恢复，结果写明关了几个、停在哪个文件、为什么停。同一时刻只进行一次批量关闭，第二次为 `unavailable`。
52. **设置**：设置窗口的“编辑器”分区有“标签”与“代码编辑器”两个小组，改了都立即生效。“标签”三项，缺省都开：`nbook.editor/enablePreview`（预览标签页：关掉时单击打开也是 permanent，已有的 preview 标签立即转为 permanent，恢复的会话同样）；`nbook.editor/wrapTabs`（多行标签，输出 54；切换后活动标签滚到可见，键盘焦点留在原标签）；`nbook.editor/breadcrumbs`（面包屑，输出 60；关掉时它的下拉收起、在途读取作废，焦点在面包屑里时交给本组的编辑器）。“代码编辑器”管源码编辑器（Monaco）的排版，Markdown 正文不归它：`nbook.editor/code.fontFamily`（CSS 字体列表，空串跟随主题的等宽字体）、`code.fontSize`（8–40 的整数，缺省 14）、`code.lineHeight`（0 按字号自动，小于 8 是字号的倍数，8 以上是像素）、`code.tabSize`（1–8 的整数，缺省 4）、`code.detectIndentation`（缺省开：按文件内容推测空格还是制表符与缩进格数，推测不出时用 `code.tabSize` 与空格；关掉时一律用 `code.tabSize` 与空格）、`code.lineNumbers`（显示、不显示、相对，缺省显示）、`code.minimap`（缺省关）、`code.wordWrap`（缺省开）。改动时源码编辑器不重建，光标、滚动与撤销栈都在；缩进两项用到已打开的文件：当前的文件立即用，停放的文件在下次显示时用，设置没变时再显示不重新推测，切走再切回缩进不变。
53. **标签栏的样子**：标签条的底色比正文低一档（主题 token `--editor-tabs-surface`，[theme.system](../theme/system.md)），活动标签是与正文同色的一块、顶部两角圆，像从正文里长出来；不用加粗区分。别的组的活动标签同样是一块，文字为次级色。每个标签依次是文件图标（与资源管理器同一套）、名字、同名提示（输出 56）与状态位：未保存时是圆点，活动或悬停时换成关闭按钮，固定标签是图钉（点它取消固定）；关闭按钮不显示时仍占位，preview 标签的名字是斜体。同一行相邻标签之间是 1px 的竖线，上下各空出四分之一的高度，活动与悬停标签两侧不画。切换活动标签、悬停与状态变化都不改变标签的宽度。
54. **多行标签**：多行时固定标签单独占第一行，这一行不换行，放不下时在行内横向滚动；普通标签放不下时换行，最多显示 3 行，再多在标签区里纵向滚动（悬停滚动条）；编辑区标题（输出 34）在最后一行的右侧。组矮的时候标签区跟着让：先给正文留至少一行字的高度、给组顶部的提示条与面包屑它们本来的高度，余下的才给标签区（至多 3 行，至少 1 行，在区内滚动）；编辑组最小（220×120）时正文、提示条的按钮、标题动作与菜单都仍能用。关掉多行时所有标签在一行里横向滚动，固定标签排在最前。
55. **拖动标签**：按住标签的名字或图标拖动（鼠标与笔移动 6px、触摸按住 200 毫秒起拖），关闭按钮、图钉与编辑区标题不起拖；按下落在组与组之间分隔线的命中带里时是调整大小，不是拖标签。落点有两种：某组的标签条（插入位置画一条竖线，多行时先按纵向距离选行；行尾的插入位是下一行的行首之前），或某组的正文区（中央是移到那一组普通标签的末尾，四边按 nb-layout 的边缘落点拆出新组，画出预览区域）。拖动中指针右下有一个跟手的拖影，写被拖标签的图标与名字（与标签条上的相同），指针不在任何落点上时也跟着；光标是抓手。放在原位不移动。手势按 [ui.layout-drag](../ui/layout-drag.md)：Escape、指针被取消或丢失、窗口失焦、页面隐藏、焦点移到编辑器区之外都取消且不改任何东西，拖动中方向键等归拖动，标签带不响应。拖动中组或标签的结构变了（组关闭、标签增减、固定状态或多行设置变化）整场取消；只是窗口尺寸或滚动变了时按当前位置重新显示落点。松手时按当前位置再算一次，与最后显示的落点相同才按第 49 条移动。
56. **同名提示**：同一组里显示名相同的文件标签，名字后面用次级色附上能区分它们的最短上级目录（例如 `notes`；只取了末几段时前面加 `…/`，如 `…/卷一`）；目录一直到根都相同（例如 `project://` 与 `user://` 下的同一路径）时附根的名字（“作品”“用户资产”）；同一个文件的两种非预览编辑器附编辑器的名字。改名或关掉其中一个后，提示按剩下的标签重新算。
57. **标签的右键菜单**：在标签上右击（或聚焦标签按 Shift+F10、菜单键）打开菜单，作用于被右击的标签，不先激活它。编辑器自己的项直接作用于这个标签（与带 `tabId` 的同名命令同一个动作），有没有、能不能点都按这个标签判断，不受活动标签的影响：关闭、关闭其他、关闭右侧、关闭已保存；固定或取消固定；向右拆分、向下拆分；文件标签另有复制路径、复制相对路径（`nbook.editor.copy-path`、`copy-relative-path`：服务端机器上的绝对路径取自 Files 的 `realPath`，相对路径是相对所在根的路径，写进系统剪贴板；取不到路径或剪贴板不可用时为 `unavailable`）、在资源管理器中显示（执行 `nbook.files.reveal` 并带这个标签的地址；资源管理器还没就绪时同它自己的规则）。之后是别的插件经贡献点 `editor.tab-context` 贡献的项（共同规则见 [workbench.menus](menus.md)，`context: "resource"` 的项收到 `{address}`）。菜单打开期间被右击的标签被关闭、移到别的组或换了编辑器时菜单关闭，之前的选择不执行。
58. **悬停时显示**：编辑区标题（输出 34）只在鼠标位于这个编辑组上、焦点在组里或它的“⋯”打开时显示，其余时候透明（仍占位、仍能用 Tab 到达），淡入淡出 100 毫秒；不能悬停的设备一直显示（规则同 [workbench.views](views.md) 输出 10）。标签的关闭按钮按标签算，不随整组显示：只在活动标签、鼠标所在的标签与键盘聚焦的标签上显示（输出 53），不进 Tab 顺序（键盘用 Delete 关闭）；不能悬停的设备上每个标签都显示。
59. **标签的键盘**：多行时 ↑/↓ 换到上一行或下一行水平位置最近的标签并激活；其余按键见组件合同（←/→、Home/End、Delete、Alt+←/→）。
60. **面包屑**：标签条下面一行：作品名（`user://` 下为“用户资产”）› 目录 › 文件；Markdown 文件再接光标所在的标题。每个组显示自己活动标签的路径；页面标签没有面包屑。放不下时中间的目录段先缩短（截断，悬停提示完整地址），文件段与标题段不缩短；不换行、不横向滚动。点目录段列出它的子项：目录点了在下拉里进入下一层，文件点了在这一组打开，符号链接、其它类型与缺失的项显示但不可选；读取中显示进度，空目录写“空”，读取失败写原因并给“重试”。点文件段列出同级。点标题段列出这一章的大纲（按标题层级缩进，当前标题高亮），选中后光标跳到那个标题；下拉打开后正文或绑定变了，旧的选项不再跳转，下拉关闭。下拉关闭、换段或换文档后，还没回来的读取结果丢掉。键盘：`nbook.editor.focus-breadcrumbs` 聚焦面包屑，←/→ 换段，Enter 或 ↓ 打开下拉，Escape 先关下拉、再回到编辑器。
61. **写不出**：Markdown 编辑器把输入交给文档时（停手、失焦、切走、保存与资源管理器操作之前的结算），有块写不出读得回来的 Markdown（[workspace.markdown-dialect](../workspace/markdown-dialect.md) 输出 3）：这次输入不交给文档，视图保留自己的内容，文档标“写不出”；这个视图之前的未裁决输入（比屏幕上的旧）随之丢弃。别的视图的输入被接受后，这个视图不随之更新。写不出的文档：保存不发出写入并说明原因；按第 4 条关闭时询问“不保存 / 取消”（没有“保存”）；第 21 条照常请求离开确认；第 22 条的终态页列出这个视图的正文，写不出的那一块只有文字、并标明丢了格式；第 23 条按需要结算处理，“先保存再复制”不可选。所在组顶部写明是哪一块，给“定位”（选中那一块并滚动过去）与“采用当前正文”（丢弃这个视图的输入，回到文档的正文）。第 9 条（换文档）、第 24 条（资源管理器的移动、改名、删除前的结算）、第 49 条（移动标签）与视图状态的淘汰，把写不出与未裁决输入同样对待：不换、不提交、不移动、不淘汰，并给出同样的提示。写不出属于视图：两个组里各有一个视图写不出时各自显示；只有这个视图自己的一次输入写得出并交了出去（被接受，或成为未裁决输入）才解除它，别的视图的输入被接受不解除；每次写不出时终态页可取回的正文都按这个视图此刻的内容更新。别的组“重新载入磁盘版本”也不解除写不出：那个视图的输入从没进过正文，它保留自己的内容。

62. **在格式的边界打字**：Markdown 编辑器里光标在一段格式的末尾时，接着打的字是否带上这种格式：
    - 带上：粗体、斜体、删除线、文字颜色、上标、下标（与常见的文字处理软件相同）；
    - 不带：链接（含引用小块）、行内代码、高亮、批注、注音；光标在链接的开头打字同样不进链接；
    - 用退格删字后接着打字，同样按上面两条：带上的仍带（粗体删到只剩一个字、删光了再打仍是粗体），不带的不带（链接的文字删光后接着打的是普通文字，不留空链接）；
    - 打出的网址与邮箱是文字，不自动变成链接（写回时按 [workspace.markdown-dialect](../workspace/markdown-dialect.md) 输出 4 转义）。
    输入法上屏的字与键盘打的字相同。

### 约定键

页面与编辑器声明里的 `title` 是界面文字值（[`ui.i18n`](../ui/i18n.md)），不写时登记时补成贡献方插件目录里的键：页面（`editor.pages`）取 `editorPages.<本地 id>.title`，编辑器（`editor.editors`）取 `editors.<本地 id>.title`（规则见 [`ui.i18n`](../ui/i18n.md) 的“约定键”）。本地 id 是贡献 id 去掉开头的 `<插件 id>.`。编辑区标题与编辑器标签右键两处菜单位置没有约定键，只按 [`workbench.menus`](menus.md) 输出 9 补命名空间。

## 状态与转换

| 文档状态 | 进入 | 离开 |
|---|---|---|
| loading | 第一次被打开 | 读到为 ready；失败为 failed |
| ready | 读到或重新载入 | 其它来源删除为 deleted；订阅结束为只读 |
| failed | 读取失败 | 重试；标签关闭时丢弃 |
| deleted | 其它来源删除 | 保存重建为 ready；关闭丢弃 |

dirty、saving（有在途保存）、unresolved（有未裁决输入）、conflict（磁盘冲突）、disk-changed（dirty 时磁盘已变化）是 ready 与 deleted 上的标记；租约期间保存排队。

时序与寿命：

- 文档在第一个标签打开时建立，最后一个标签关闭时丢弃；需要结算的文档在标签关闭前已结算（第 4 条）。
- 视图的输入经输入回执交给文档：被接受才算进入正文。切换、保存、关闭、离开与资源管理器的操作之前先同步结算视图输入。
- 每次视图绑定文档都签发新的绑定标识；换文档、关闭标签、项目换代后，旧绑定的回调不再改变任何文档或视图。
- 读取结果只在目标仍存活、输入修订未前进、不 dirty、无在途保存与冲突时替换正文；否则只更新“磁盘已变化”的标记。
- 项目换代：旧代的文档全部作废，标签按新代重新打开；旧代的读取与保存结果不应用到新代。
- 同组同种编辑器的视图状态（Monaco 的模型与视图状态、富文本的编辑状态与撤销历史）按“文档 × 组 × 编辑器”保留到标签关闭；只淘汰不 dirty、无未裁决输入、无在途保存的非活动视图状态，每组每种最多 3 份。
- 文件条目在第一个引用（文本或字节）取得时建立，最后一个引用释放时丢弃；有文本引用期间读正文、按第 11、16 条核对，只剩字节引用时停止读取、正文不再保留（需要结算的正文在最后一个文本标签关闭前已按第 4 条结算）。字节引用的 `version` 在第 16 条的每次“文件有变化”时加一。
- 编辑器的实现交付晚于会话恢复是正常情形：标签与它的文件条目照常建立，控件等交付后挂上；贡献撤回时这种编辑器的控件卸载、标签保留并按输出 40 显示。贡献方的 `activate` 在交出贡献之前就失败时，接收方收不到任何通知，这种编辑器停在“还没交付”（进度条），直到贡献方再次激活。
- 语言的分词与编辑规则在本页第一次遇到这门语言时向贡献方要一次：那时语言已撤回或加载失败，这门语言按纯文本显示，之后再交付也要刷新页面才生效（源码编辑器对一门语言只要一次规则）。
- 继续写作的定位（第 29 条）绑定到打开时记下的标签与组：切换、关闭、焦点离开编辑器区、窗口停止即取消，迟到的就绪不动光标与焦点；定位那一刻再核对一次标签与句柄仍是活动的。

## 副作用与数据

- 正文与基线只在内存；写入经 [workspace.files](../workspace/files.md) 的条件保存，写入来源为 `{kind: "user", plugin: "nbook.editor"}`。
- 记录 `editor.session`：owner `nbook.editor`，project/local，版本 1；只存布局与标签，不存正文。标签的 `cursor`（第 30 条，`{offset}` 或 `{line, column}`）是后加的可选字段，没有它的旧记录照样合法，版本不变。标签的 `editor` 是编辑器 id；读到旧值 `markdown`、`code` 时当作 `nbook.editor.markdown`、`nbook.editor.code`；新增可选字段 `language`（输出 45）。版本仍为 1：旧版本的程序读到新的编辑器 id 会把记录判为损坏、保护原件并从空组开始，只在降级时发生。
- 页面（输出 33）只在内存里：不写会话记录，也不写别的记录。
- 记录 `editor.recent`：owner `nbook.editor`，project/local，版本 1；`{addresses}`，至多 10 个、不重复，最近在前（第 31 条）。

## 失败与恢复

| 情形 | 表现 | 用户怎么办 |
|---|---|---|
| 读取失败（`not-found`、`not-text`、`too-large`、`permission-denied`、断线） | 内容区说明原因 | 重试或关闭 |
| 未裁决输入 | 第 13 条 | 采用当前正文或保留本视图内容 |
| 磁盘冲突 | 第 15 条 | 重新载入或覆盖 |
| 保存失败或结果未知 | 第 14 条 | 重试保存 |
| 被其它来源删除 | 第 18 条 | 保存重建或关闭 |
| 订阅结束、页面终态 | 第 18、22 条 | 复制正文后刷新 |
| 已知二进制或不是 UTF-8 文本 | 第 37 条 | 用别的编辑器打开或关闭 |
| 编辑器不在了 | 第 40 条 | 用默认编辑器打开或关闭 |
| 编辑器 id 未登记、字节编辑器打开不匹配的文件 | 第 38 条，命令为 `unavailable` | 换一个编辑器 |

## 边界与兼容

- 公开接口：命令与参数（含 `reveal`）、地址参数 `open`、`at`、公开状态键、`documentCoordinatorKey`、贡献点 `workbench.editor-area`；贡献点 `editor.editors`、`editor.languages` 与控件合同。
- 编辑器与语言由贡献点登记，这期只有内置插件使用（`nbook.editor`、[`nbook.image-viewer`](image-viewer.md)、[`nbook.html-preview`](html-preview.md)）；第三方插件的公开说明另行交付。

## 验收与 Smoke

1. Given 资源管理器里两个 Markdown 文件，When 单击 A、单击 B、双击 B，Then 只有一个标签且最后为 permanent；编辑 B 后单击 A，A 以 preview 新开、B 保留。
2. Given 读取被扣住与手动时钟，When 打开文件，Then 标签当帧切换，799 毫秒时内容区空白、800 毫秒时出现进度条；放行后正文出现、进度条消失；放行前再打开 C，A 的结果迟到也不改变活动标签。
3. Given 编辑未保存，When 外部改写同一文件，Then 显示“磁盘已变化”，保存得到磁盘冲突；“重新载入”后正文为磁盘内容、不 dirty；另一次“覆盖”后磁盘为编辑内容。
4. Given 保存被扣住，When 继续输入再放行，Then 磁盘是保存时的正文，文档仍 dirty；同时按两次保存只发出一次写入后再发第二次。
5. Given 含全部方言、CRLF 换行与 frontmatter 的章节，When 用 Markdown 编辑器打开、不编辑、切走再关闭，Then 磁盘字节不变；编辑一个段落后保存，只有那一块变化（[workspace.markdown-dialect](../workspace/markdown-dialect.md) 输出 2）。
6. Given 两个组打开同一文档，When 在一组输入，Then 另一组显示同样正文；两组基于同一修订输入不同内容时，后到的一组出现裁决条，裁决前不能保存。
7. Given 编辑未保存，When 在资源管理器剪切、保存、再粘贴到另一目录，Then 移动成功，标签跟到新路径，正文与 dirty 保留；复制时询问三选，删除时确认框列出该文档。
8. Given 三个标签两个组，When 刷新页面，Then 组与标签按记录恢复，活动标签的正文出现。
9. Given Monaco 与富文本各打开 A、B，When A 输入、切 B 输入、回 A 撤销与重做，Then 只作用于 A。
10. Given 一个 dirty 文档，When 服务端重启，Then 终态页列出该文件与可复制的正文。
11. Given 保存成功，When 另一窗口打开同一文件，Then 看到新正文。
12. Given 两个组打开同一份 dirty 文档、另有一份非活动的 dirty 文档，When 读状态栏，Then 写“未保存 2 个”；点击后两份都保存、条目消失；一份保存失败时条目为错误状态，提示写明失败的文件与原因。
13. Given 一个 Markdown 文档，When 输入中文与英文，Then 字数条目按第 27 条计数并随输入更新；frontmatter 里的字不计。
14. Given 源码编辑器与 Markdown 编辑器各打开一个文档，When 在两者之间切换，Then 光标位置只在源码编辑器活动时出现，移动光标后行列随之更新；两个窗口的状态栏各自显示自己的数据。
15. Given 书架上的“继续写作”，When 以 `?open=<地址>&at=end` 打开项目，Then 文件以正式标签打开、光标在末尾、可以接着输入，地址栏里不再有这两个参数，刷新后不再定位；Markdown 与源码两种文件各一例；读取被扣住时切到别的标签再放行，焦点与光标不被抢走；文件不在时项目照常打开、组顶部有提示。
16. Given 一个打开的文档，When 连续输入，Then 停手 300ms 之前字数条目仍是输入前的值，期间状态栏的反复刷新不推迟它，到点后更新；When 切到另一个文档或新开文件，Then 立即显示它的字数。

17. Given 一个源码文件的光标在第 2 行第 4 列、一个 Markdown 文件的光标在正文中间，When 外部把源码文件改到只剩一行再刷新页面，Then Markdown 标签是活动标签、编辑器已聚焦，直接输入的字落在原来的光标处；切到源码标签，光标在第 1 行行尾（夹到末尾）。
18. Given 先后打开两个文件，When 读 `editor.recent`，Then 后打开的在前；When 再打开已经在最前的那个，Then 记录不写。
19. Given 没有标签的编辑组，When 看内容区，Then 正中是 132px 的淡色标志与“显示所有命令 Ctrl Shift P”“新建文件”“打开欢迎页”三行提示；When 点“显示所有命令”，Then 命令面板打开；When 点“打开欢迎页”，Then 欢迎页以标签打开；When 打开 Markdown 文件，Then 正文在 720px 的版心里，17px、行距 1.95，编辑区是面板底色。
20. Given 一个声明了 `openOnFirstVisit` 的页面，When 新客户端第一次打开作品，Then 页面标签自动打开、只有它；When 刷新，Then 它不恢复；When 再执行 `open-page`，Then 不开第二个、切到已开的那个；页面标签不能拆分、不能换编辑器，可以关闭。

21. Given 一个测试插件往 `editor.title` 贡献一个 `extensions: [".md"]`、`context: "resource"` 的按钮，When 编辑组里活动的是 `a.md`，Then 标签条右侧有“向右拆分”与这个按钮、末尾是“⋯”（里面有“用其它编辑器重新打开”）；When 切到 `b.txt`，Then 这个按钮消失；When 有两个组，Then 只有活动组画标题动作，点另一个组的标签后标题动作移过去；When 连续拆分到活动组放不下一个按钮，Then 标题行里只剩“⋯”，“⋯”与标签条都在这一组里，“⋯”里能执行拆分与贡献的项；When 点测试插件的按钮，Then 命令收到 `{address: a.md 的地址}`；When 活动的是欢迎页，Then 这个按钮不出现。
22. Given 一个 `a.png`、一个 `b.svg`、一个 2 MB 的 `c.pdf`、一个 GBK 编码的 `d.txt`，When 依次单击打开，Then `a.png` 与 `b.svg` 以图片显示；`c.pdf` 显示“不能在这里打开”且没有发出读取；`d.txt` 说明不是 UTF-8 文本；When 在 `b.svg` 上“用其它编辑器重新打开”，Then 选择里有图片查看器（当前）与源码编辑器，选源码后看到 SVG 的源码。
23. Given 打开着的 `a.png`，When 外部改写它，Then 图片随之更新；When 在资源管理器改名为 `b.png`，Then 标签跟过去；When 在资源管理器删除它，Then 标签关闭；When 按 Ctrl+W，Then 标签关闭。
24. Given 打开着的 `a.html` 源码标签，When 点标题栏的“打开预览”，Then 本组多一个“预览 a.html”标签且它是活动标签；When 回到源码输入不保存，Then 停手后预览更新；When 关闭源码标签，Then 因只剩预览视图而询问保存；When 执行“在侧边打开预览”，Then 预览在右侧组打开。
25. Given 会话记录里有一个图片标签，When 刷新页面且图片查看器晚于编辑器区交付，Then 标签照常恢复，交付后显示图片，期间不出现“这个编辑器已经不在了”；When 停用图片查看器插件，Then 标签显示“这个编辑器已经不在了”，点“用默认编辑器打开”后显示“不是 UTF-8 文本”。
26. Given `a.py`、`a.html`（含 `<script>`）与一个含 ```` ```ts ```` 代码块的 `a.md`，When 用源码编辑器打开，Then 三者都有高亮，`<script>` 里与代码块里是嵌入语言的着色；状态栏显示“Python”；When 执行“更改语言模式”选“纯文本”，Then 着色消失；When 刷新，Then 仍是纯文本。

27. Given 两个组、左组活动标签有刚输入还没交出的字，When 把它拖到右组，Then 标签在右组、两边输入都在，保存后磁盘上都有；When 右组有未裁决输入时再拖，Then 不移动并给出提示；When 拖到右组已有同一文件的标签上，Then 不多开标签。
28. Given 固定了 `a.md`、`b.md` 的组，When 在固定标签上打开新文件、按 Alt+←/→、换编辑器、刷新，Then 新文件在普通标签里、固定标签不跨到普通区、换编辑器后仍固定、刷新后仍固定；When 执行“关闭其他”，Then 固定标签留下；When “关闭右侧”途中在询问里取消，Then 停在那个文件、之前的已关。
29. Given 多行标签，When 打开很多文件，Then 固定标签单独一行、普通标签最多 3 行后在标签区里滚动，220×120 的组里正文仍可见；When 关掉“多行标签”，Then 一行横向滚动、活动标签可见；When 关掉“预览标签页”，Then 已有的 preview 标签转正、单击打开的是普通标签。
30. Given 两个组，When 把标签拖到另一组的正文中央、标签条的某个位置、正文的右边，Then 分别移到那一组末尾、那个位置、新拆出的右侧组；When 拖动中按 Escape，或从关闭按钮、离分隔线 4px 处按下，Then 什么都不变。
31. Given 活动组的 A、另一组的 B 与资源管理器选着的 C，When 右击 B 选“关闭其他”“复制相对路径”“在资源管理器中显示”，Then 作用于 B 所在的组与 B 的地址，A 与 C 不受影响；When 菜单打开期间 B 被关闭，Then 菜单关闭。
32. Given 一组里 `notes/README.md` 与 `drafts/README.md`，When 看标签，Then 各附 `notes`、`drafts`；关掉一个后另一个不再附目录。
33. Given 打开的 `正文/第二章.md` 有三个标题，When 看面包屑，Then 是“作品名 › 正文 › 第二章.md › 光标所在的标题”；When 点“正文”，Then 列出同级的章节，选一章即打开；When 点标题段选另一个标题，Then 光标跳过去；When 下拉打开期间切到另一个文件，Then 下拉关闭、旧选项不跳。
34. Given 一段只有引用小块 `[123](project://123)` 的文字（在源码编辑器里写好、换回富文本），When 光标在行尾或行首打字、用输入法打字，Then 字写在链接外；When 在行尾退格删光链接文字再打字，Then 是普通文字；When 打 `https://example.com` 再打空格，Then 写回的是转义的文字。

Smoke：产品页 e2e `e2e/editor-area.e2e.ts`（生产构建、本机 Chrome、真实 Files）运行场景 1、3–11；场景 2 的阈值由注入时钟的组件与模型测试验收，e2e 只核对正常打开不出现进度条。场景 15 由编辑器的 Bun 测试（`area.test.ts` 的“继续写作”一组、`continue-writing.test.ts`）与 `e2e/bookshelf-stats.e2e.ts` 运行。场景 16 的停手时间由注入时钟的 `status-items.test.ts` 验收，e2e 的状态栏用例核对输入后字数会更新。场景 22–24、26 由 `e2e/editor-types.e2e.ts` 运行；场景 27–33 由 `editor-area.e2e.ts` 的标签栏样子、多行键盘与 120px 组、拖动、右键菜单、面包屑几例运行，场景 27、28、31、32 的模型部分另由 `area.test.ts`、`groups.test.ts`、`tab-menu.test.ts`、`tab-hints.test.ts` 覆盖；触摸拖动只按代码与 `tree-drag.ts` 的同一套门槛，没有在真机上验；场景 23 的改名与删除、场景 24 的关闭时询问另由 `area.test.ts` 覆盖；场景 25 由 `editor-registry.test.ts`（真实插件宿主，交付先后与停止）与 `area.test.ts`（用默认编辑器打开）覆盖。场景 34 与输出 62 由 `MarkdownControl.dom.test.ts` 的“在格式的边界打字”一组（经编辑内核的输入入口逐种格式测）与 `e2e/markdown-input.e2e.ts`（本机 Chrome 的键盘、输入法事件与方向键，源码与富文本来回换；按快捷键打出的粗体、斜体、删除线看得出来）运行。

## 实现合同

- 公开入口：命令与参数（含 `reveal`）、地址参数 `open`、`at`、公开状态键、`documentCoordinatorKey`、贡献点 `workbench.editor-area`（见“边界与兼容”）；插件定义见 [`editor/plugin.ts`](../../../packages/neuro-book/src/plugins/editor/plugin.ts)。
- owner 与依赖方向：`nbook.editor` 拥有文档、编辑组、标题动作贡献点与会话记录（`editor.session`、`editor.recent`，project/local）；依赖 `nbook.files` 的文件客户端、命令服务、Storage、窗口的项目绑定、配置与宿主时钟/抢救能力（[`runtime.browser-host`](../runtime/browser-host.md)）。资源管理器经 `documentCoordinatorKey` 反向依赖它（可选依赖，[`workbench.files-explorer`](files-explorer.md)），不是本插件的依赖方向。
- 不变量：
  - 文档在第一个标签打开时建立、最后一个标签关闭前已结算（第 4 条），关闭后丢弃（`documents.test.ts`、`area.test.ts`）；
  - 读取结果只在目标仍存活、输入修订未前进、不 dirty、无在途保存与冲突时替换正文，否则只标记“磁盘已变化”（`documents.test.ts` 的输出 16）；
  - 同组同种编辑器的视图状态按“文档 × 组 × 编辑器”保留到标签关闭，只淘汰非活动、无 dirty/未裁决输入/在途保存的视图状态，每组每种最多 3 份（`groups.test.ts`）；
  - 继续写作的定位绑定到打开时记下的标签与组：切换、关闭、焦点离开编辑器区、窗口停止即取消，迟到的就绪不再移动光标与焦点（`continue-writing.test.ts`、`area.test.ts` 的“继续写作”一组）；
  - 项目换代时旧代的文档全部作废，标签按新代重新打开，旧代的读取与保存结果不应用到新代（`area.test.ts`）；
  - 选编辑器只看已接受的声明（`web/editors.ts` 的纯函数），组件的交付状态另由 `web/editor-registry.ts` 给出：内置的两个编辑器由编辑器区直接持有组件，早于自己的交付（`editors.test.ts`、`editor-registry.test.ts`）；
  - 文本与字节引用共用文件条目的计数，只有文本引用计数大于 0 时读正文；字节引用的 `version` 在订阅就绪与每次文件变化时加一（`documents.test.ts`）；
  - 移动标签是控制器的一次事务：先结算活动视图会变的组、有未裁决输入就不动，再改结构，只撤下真正换了活动视图的绑定并释放源组里它的视图状态；并到同一标签走关闭的结算，询问的回答回来后按此刻的状态重判（`area.test.ts` 的输出 49–51 一组）；
  - 每组固定标签在前、固定的不是 preview，所有改标签的入口都守着它（`groups.test.ts` 的输出 50 一组）；批量关闭冻结目标、逐项重验、同一时刻一批（`area.test.ts`）；
  - 拖动的落点按此刻的布局算，起拖后结构变了整场取消，松手与最后显示的落点相同才提交（`web/tab-drag.ts`，`editor-area.e2e.ts` 的拖动一例）；
  - 标签右键菜单里编辑器自己的项直接作用于被右击的标签，不经命令的 `when`（`tab-menu.test.ts`）；
  - 面包屑按组读本组控件句柄的大纲，大纲带绑定与版本、对不上不跳；目录读取按请求序号作废迟到的结果（`EditorBreadcrumbs.dom.test.ts`）；
  - 语言声明在源码编辑器建模型之前一次登记进 Monaco，分词与编辑规则在第一次遇到这门语言时才经交付加载；Monaco 自带的语言表由 `scripts/gen-monaco-languages.ts` 生成，与已装的 Monaco 一致（`languages.test.ts`）；纯文本与 JSON 不经贡献点。

## 证据

- 批准依据：输出 49–60 与场景 27–33 来自 w00025 t03 的“开发者的决定”1–11 与实施计划第二版，开发者 2026-10-15 确认（记录在主工作区 master 的 `.agents/works/w00025-editor/tasks/t03-tabs-and-split/README.md` 与 `plan.md`）。
- 批准依据：输出 36–48 与场景 22–26 来自 [w00025 t01 的决定](../../../.agents/works/w00025-editor/tasks/t01-requirements/README.md#开发者的决定) 1–6 与 [t02 实施计划](../../../.agents/works/w00025-editor/tasks/t02-editor-types/plan.md)，开发者 2026-10-14 确认。
- 批准依据：输出 35（`group` 参数与 `data-editor-group` 公开标记）来自[t86 的决定](../../../.agents/works/w00017-application-runtime-architecture/tasks/t86-explorer-polish/README.md#决定)与[实施计划](../../../.agents/works/w00017-application-runtime-architecture/tasks/t86-explorer-polish/plan.md)，开发者 2026-10-14 确认。
- 批准依据：输出 30–33 为 [t79 计划](../../../.agents/works/w00017-application-runtime-architecture/tasks/t79-workbench-polish/plan.md) 第 4 节，开发者 2026-10-12 确认；[NeuroBook v2：并排重建应用](../../proposals/neuro-book-v2-rebuild.md) 第 5 节（编辑器组件从旧包迁入）与推进顺序第 6 条；[项目文件底座与 Files 竖切](../../proposals/project-file-foundation.md)（沿用第一版切换设计）；本 Spec 的取舍见 [w00017 待确认清单](../../../.agents/works/w00017-application-runtime-architecture/pending-confirmations.md) 2026-10-09 的 t71 条目（按推荐先做，开发者 2026-10-14 整体追认）；输出 32 的空态改为标志与提示，为 t79 计划第二轮第 11 节，开发者 2026-10-12 选第五轮稿 E1。
- 实现入口：[`editor/plugin.ts`](../../../packages/neuro-book/src/plugins/editor/plugin.ts)、[`editor/web/area.ts`](../../../packages/neuro-book/src/plugins/editor/web/area.ts)、[`groups/groups.ts`](../../../packages/neuro-book/src/plugins/editor/web/groups/groups.ts)、[`editor/web/tab-drag.ts`](../../../packages/neuro-book/src/plugins/editor/web/tab-drag.ts)、[`editor/web/tab-menu.ts`](../../../packages/neuro-book/src/plugins/editor/web/tab-menu.ts)、[`editor/web/tab-hints.ts`](../../../packages/neuro-book/src/plugins/editor/web/tab-hints.ts)、[`EditorTabBar.vue`](../../../packages/neuro-book/src/plugins/editor/web/components/EditorTabBar.vue)、[`EditorBreadcrumbs.vue`](../../../packages/neuro-book/src/plugins/editor/web/components/EditorBreadcrumbs.vue)、[`editor/shared/settings.ts`](../../../packages/neuro-book/src/plugins/editor/shared/settings.ts)、[`documents/store.ts`](../../../packages/neuro-book/src/plugins/editor/web/documents/store.ts)、[`editor/web/editors.ts`](../../../packages/neuro-book/src/plugins/editor/web/editors.ts)、[`editor/web/code/languages.ts`](../../../packages/neuro-book/src/plugins/editor/web/code/languages.ts)
- 合同测试：标签栏、移动与面包屑（输出 49–60）为 `groups.test.ts` 的输出 49、50 两组（纯模型）、`area.test.ts` 的输出 49–51 一组（真实 Files 场地与请求闸门）、[`editor/tab-menu.test.ts`](../../../packages/neuro-book/src/plugins/editor/tab-menu.test.ts)（真实编辑器区与命令注册表）、[`editor/web/tab-hints.test.ts`](../../../packages/neuro-book/src/plugins/editor/web/tab-hints.test.ts)、组件测试 `EditorTabBar.dom.test.ts` 与 `EditorBreadcrumbs.dom.test.ts`；编辑器与语言（输出 36–45）为 [`editor/editors.test.ts`](../../../packages/neuro-book/src/plugins/editor/editors.test.ts)、[`editor/editor-registry.test.ts`](../../../packages/neuro-book/src/plugins/editor/editor-registry.test.ts)（真实插件宿主）、[`editor/languages.test.ts`](../../../packages/neuro-book/src/plugins/editor/languages.test.ts) 与 `area.test.ts` 的输出 1、4、37–41、45、48 几组；编辑区标题（输出 34）为 [`editor/title-actions.test.ts`](../../../packages/neuro-book/src/plugins/editor/title-actions.test.ts)（真实命令注册表与编辑组布局：自己的与贡献的项、按后缀、resource 参数、按钮上限、菜单身份）；空编辑组的提示（输出 32）为 [`editor/empty-tips.test.ts`](../../../packages/neuro-book/src/plugins/editor/empty-tips.test.ts)（真实命令系统：筛选、按键与位置、语言）；页面标签（输出 33）为 `area.test.ts` 的“页面标签”一例与 `groups.test.ts` 的“页面标签不进快照”一例；上次的光标与最近打开（输出 30、31）为 `area.test.ts` 的“上次的光标与最近打开”一组、`groups.test.ts` 的快照往返、[`editor/recent.test.ts`](../../../packages/neuro-book/src/plugins/editor/recent.test.ts)（真实 Storage 场地）；[`editor/status-items.test.ts`](../../../packages/neuro-book/src/plugins/editor/status-items.test.ts)（状态栏条目，场景 12–14、16）、[`shared/word-count.test.ts`](../../../packages/neuro-book/src/plugins/markdown/shared/word-count.test.ts)、[`editor/documents.test.ts`](../../../packages/neuro-book/src/plugins/editor/documents.test.ts)、[`editor/area.test.ts`](../../../packages/neuro-book/src/plugins/editor/area.test.ts)、[`groups.test.ts`](../../../packages/neuro-book/src/plugins/editor/web/groups/groups.test.ts)、[`source-merge.test.ts`](../../../packages/neuro-book/src/plugins/editor/web/code/source-merge.test.ts)、[`explorer/documents.test.ts`](../../../packages/neuro-book/src/plugins/explorer/documents.test.ts)；在格式的边界打字（输出 62）为 `MarkdownControl.dom.test.ts` 的同名一组；Markdown 编辑器与写不出（输出 19、61）为 [`MarkdownControl.dom.test.ts`](../../../packages/neuro-book/src/plugins/markdown/web/components/MarkdownControl.dom.test.ts)（真实编辑器、真实编辑器区与文档模型）、`documents.test.ts` 与 `area.test.ts` 的“写不出”两组、[`explorer/documents.test.ts`](../../../packages/neuro-book/src/plugins/explorer/documents.test.ts) 的复制一组
- Smoke：[`markdown-input.e2e.ts`](../../../packages/neuro-book/e2e/markdown-input.e2e.ts)（场景 34：在格式的边界打字）、[`editor-area.e2e.ts`](../../../packages/neuro-book/e2e/editor-area.e2e.ts)（产品页；验收 21 与编辑区标题在 390px 下的布局为“编辑区标题”一组，测试插件 `test.menus`；场景 17、18 的“重新打开回到上次的光标”一例）、[`bookshelf-stats.e2e.ts`](../../../packages/neuro-book/e2e/bookshelf-stats.e2e.ts)（继续写作之后刷新回到记下的光标）、[`welcome.e2e.ts`](../../../packages/neuro-book/e2e/welcome.e2e.ts)（验收 20：欢迎页自动打开、不恢复、只开一个）、[`lab-editor.e2e.ts`](../../../packages/neuro-book/e2e/lab-editor.e2e.ts)（Lab 集成场景）、[`editor-types.e2e.ts`](../../../packages/neuro-book/e2e/editor-types.e2e.ts)（场景 22–24、26：图片、二进制与非 UTF-8、HTML 预览、语言）
